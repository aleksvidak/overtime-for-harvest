/* Shared data layer: loaded by popup.html via <script> and by background.js
   via importScripts. No DOM access in here. */
var HL = (function () {
  var API = "https://api.harvestapp.com/v2";
  var HARVEST_INTRODUCTION = "2017-01-01";
  var CREDS_KEY = "harvest_ledger_creds";
  var CACHE_PREFIX = "harvest_ledger_cache_v2:";   /* v2: minute-snapped sums */
  var LAST_REFRESH_KEY = "harvest_ledger_last_refresh";
  var REPORT_KEY = "harvest_ledger_last_report_v3";

  /* ── storage ── */
  function stGet(key) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(key, function (o) { resolve(o[key] || null); });
    });
  }
  function stSet(key, value) {
    return new Promise(function (resolve) {
      var o = {}; o[key] = value;
      chrome.storage.local.set(o, resolve);
    });
  }

  function clampPageSize(v) {
    var n = parseInt(v, 10);
    if (!n || n < 1) return 2000;     /* Harvest maximum */
    return Math.min(n, 2000);
  }

  /* each weekday's share of a normal working day, indexed by Date.getDay()
     (0 = Sunday … 6 = Saturday): 1 = full day, 0.5 = half day, 0 = off.
     Default: full Monday–Friday. */
  var DEFAULT_WORKDAYS = [0, 1, 1, 1, 1, 1, 0];
  function toWeight(x) {
    if (x === true) return 1;          /* tolerate the earlier boolean format */
    var n = +x;
    if (n >= 1) return 1;
    if (n >= 0.5) return 0.5;
    return 0;
  }
  function normalizeWorkdays(w) {
    if (!Array.isArray(w) || w.length !== 7) return DEFAULT_WORKDAYS.slice();
    var norm = w.map(toWeight);
    /* never allow an all-off week: it would mean no expected hours ever */
    return norm.some(function (x) { return x > 0; }) ? norm : DEFAULT_WORKDAYS.slice();
  }
  function dayWeight(dow, workdays) {
    return toWeight((workdays || DEFAULT_WORKDAYS)[dow]);
  }
  function isWorkday(dow, workdays) {
    return dayWeight(dow, workdays) > 0;
  }
  /* a 100% week is five full days: the weekly target is the full-time figure,
     so a full day is always target ÷ 5 regardless of how many days you work */
  var FULL_WEEK_DAYS = 5;

  /* ── Harvest API ── */
  async function hv(path, creds) { return hvRaw(API + path, creds); }

  async function hvRaw(url, creds) {
    var res;
    try {
      res = await fetch(url, {
        headers: {
          "Authorization": "Bearer " + creds.token,
          "Harvest-Account-Id": creds.accountId
        }
      });
    } catch (e) {
      throw new Error("Network error reaching Harvest.");
    }
    if (res.status === 401) throw new Error("Harvest rejected the token (401). Check the token and account ID in settings.");
    if (!res.ok) throw new Error("Harvest returned HTTP " + res.status + ".");
    return res.json();
  }

  /* ── sync: fetch entries (cache-aware), persist cache + report, return report ── */
  async function syncReport(creds, fullRefresh) {
    var now = new Date();
    var me = await hv("/users/me", creds);
    /* Harvest capacity is the fallback; a manual weekly target overrides it.
       weeklyTargetH is the full-time (100%) figure; a full day is target ÷ 5.
       The working-days weights then set the actual expected hours per day, so a
       part-time week (days at half or off) comes out below the full-time total. */
    var workdays = normalizeWorkdays(creds.workdays);
    var harvestWeeklyH = (me.weekly_capacity || 144000) / 3600;
    var weeklyTargetH = creds.weeklyTargetH > 0 ? creds.weeklyTargetH : harvestWeeklyH;
    /* dailyCapH is a full day's target; a day's expected hours = weight × this */
    var dailyCapH = weeklyTargetH / FULL_WEEK_DAYS;

    var company = null;
    try { company = await hv("/company", creds); } catch (e) { /* links fall back */ }

    var from = HARVEST_INTRODUCTION;
    var to = iso(now);

    /* closed years never change: their monthly buckets are cached.
       cache = { coveredFrom, coveredTo, firstDay, savedAt, months: {"YYYY-MM": [hours, entryCount]} } */
    var cacheId = CACHE_PREFIX + creds.accountId + ":" + me.id;
    var lastDec31 = (now.getFullYear() - 1) + "-12-31";
    var cache = fullRefresh ? null : await stGet(cacheId);
    if (cache && !(cache.months && cache.firstDay && cache.coveredFrom <= from)) cache = null;

    var months = {};   /* "YYYY-MM" -> [hours, entryCount] */
    var days = {};     /* "YYYY-MM-DD" -> hours, recent window only */
    var firstDay = null;
    var fetchFrom = from;
    if (cache) {
      Object.keys(cache.months).forEach(function (k) { months[k] = cache.months[k].slice(); });
      firstDay = cache.firstDay;
      fetchFrom = maxStr(from, nextDay(cache.coveredTo));
    }

    var recentFrom = addDays(now, -28);
    if (fetchFrom <= to) {
      var url = API + "/time_entries?user_id=" + me.id + "&from=" + fetchFrom + "&to=" + to
          + "&per_page=" + clampPageSize(creds.pageSize);
      while (url) {
        var page = await hvRaw(url, creds);
        page.time_entries.forEach(function (e) {
          /* Harvest stores decimals rounded to 2 places (0:20 -> 0.33 = 19.8min);
             its UI sums whole minutes per entry, so snap each entry to minutes
             before aggregating or totals drift a minute low */
          var h = Math.round(e.hours * 60) / 60;
          var k = e.spent_date.slice(0, 7);
          if (!months[k]) months[k] = [0, 0];
          months[k][0] += h;
          months[k][1]++;
          if (!firstDay || e.spent_date < firstDay) firstDay = e.spent_date;
          if (e.spent_date >= recentFrom) days[e.spent_date] = (days[e.spent_date] || 0) + h;
        });
        url = page.links && page.links.next;
      }
    }

    /* your first tracked day stands in for your company start date */
    if (!firstDay) firstDay = (me.created_at || "").slice(0, 10);
    if (firstDay && firstDay > from) from = firstDay;

    var keep = {};
    var lastClosedMonth = lastDec31.slice(0, 7);
    Object.keys(months).forEach(function (k) { if (k <= lastClosedMonth) keep[k] = months[k]; });
    await stSet(cacheId, {
      coveredFrom: HARVEST_INTRODUCTION,
      coveredTo: lastDec31,
      firstDay: firstDay,
      savedAt: iso(now),
      months: keep
    });

    var report = {
      me: { first_name: me.first_name, last_name: me.last_name },
      company: company ? { name: company.name, full_domain: company.full_domain } : null,
      from: from, to: to, dailyCapH: dailyCapH, months: months, days: days,
      harvestWeeklyH: harvestWeeklyH, workdays: workdays
    };

    /* persist so the popup paints instantly and the badge can be drawn cold */
    await stSet(REPORT_KEY, report);
    await stSet(LAST_REFRESH_KEY, Date.now());

    return report;
  }

  /* all-time balance in hours from a report */
  function computeBalance(report) {
    var totExp = 0;
    var d = parseISO(report.from), end = parseISO(report.to);
    while (d <= end) {
      totExp += dayWeight(d.getDay(), report.workdays) * report.dailyCapH;
      d.setDate(d.getDate() + 1);
    }
    var totLog = 0;
    Object.keys(report.months).forEach(function (k) {
      if (k >= report.from.slice(0, 7) && k <= report.to.slice(0, 7)) totLog += report.months[k][0];
    });
    return totLog - totExp;
  }

  /* ── date and format helpers ── */
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nextDay(s) { var d = parseISO(s); d.setDate(d.getDate() + 1); return iso(d); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return iso(x); }
  function maxStr(a, b) { return a > b ? a : b; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function weekStartIso() {
    var d = new Date();
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);   /* back to Monday */
    return iso(d);
  }
  function prevWorkdayIso() {
    var d = new Date();
    do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return iso(d);
  }
  function splitHM(hours) {
    var a = Math.abs(hours);
    var h = Math.floor(a);
    var m = Math.round((a - h) * 60);
    if (m === 60) { h++; m = 0; }
    return { h: h, m: m };
  }
  function fmtHM(hours) {
    var s = splitHM(hours);
    if (s.h === 0) return s.m + "m";
    if (s.m === 0) return s.h + "h";
    return s.h + "h " + pad(s.m) + "m";
  }
  function fmtAgo(ts) {
    var sec = Math.round((Date.now() - ts) / 1000);
    if (sec < 60) return "just now";
    if (sec < 3600) return Math.round(sec / 60) + "m ago";
    if (sec < 86400) return Math.round(sec / 3600) + "h ago";
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(ts));
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  return {
    CREDS_KEY: CREDS_KEY,
    REPORT_KEY: REPORT_KEY,
    LAST_REFRESH_KEY: LAST_REFRESH_KEY,
    stGet: stGet,
    stSet: stSet,
    clampPageSize: clampPageSize,
    DEFAULT_WORKDAYS: DEFAULT_WORKDAYS,
    normalizeWorkdays: normalizeWorkdays,
    dayWeight: dayWeight,
    isWorkday: isWorkday,
    hv: hv,
    syncReport: syncReport,
    computeBalance: computeBalance,
    parseISO: parseISO,
    iso: iso,
    addDays: addDays,
    pad: pad,
    weekStartIso: weekStartIso,
    prevWorkdayIso: prevWorkdayIso,
    splitHM: splitHM,
    fmtHM: fmtHM,
    fmtAgo: fmtAgo,
    esc: esc
  };
})();
