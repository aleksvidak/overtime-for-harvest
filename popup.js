(function () {
  var API = "https://api.harvestapp.com/v2";
  var HARVEST_INTRODUCTION = "2017-01-01";
  var CREDS_KEY = "harvest_ledger_creds";
  var CACHE_PREFIX = "harvest_ledger_cache_v2:";   /* v2: minute-snapped sums */
  var LAST_REFRESH_KEY = "harvest_ledger_last_refresh";
  var REPORT_KEY = "harvest_ledger_last_report_v3";

  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), settings = $("settings"), results = $("results");
  var now = new Date();

  /* ── storage helpers ── */
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

  /* ── views ── */
  function showSettings(allowBack) {
    settings.hidden = false;
    main.hidden = true;
    $("back").hidden = !allowBack;
  }
  function showMain() {
    settings.hidden = true;
    main.hidden = false;
  }

  $("gear").addEventListener("click", function () { showSettings(true); });
  $("back").addEventListener("click", showMain);

  /* ── sync indicator ── */
  function setSyncing(on) {
    $("syncIcon").classList.toggle("spinning", on);
    if (on) $("syncLabel").textContent = "Syncing…";
  }
  function setSyncedLabel(ts) {
    $("syncLabel").textContent = ts ? "Synced " + fmtAgo(ts) : "";
  }

  /* ── page size ── */
  function clampPageSize(v) {
    var n = parseInt(v, 10);
    if (!n || n < 1) return 2000;     /* Harvest maximum */
    return Math.min(n, 2000);
  }

  /* ── error banner ── */
  function fail(err) {
    setSyncing(false);
    stGet(LAST_REFRESH_KEY).then(setSyncedLabel);
    results.classList.remove("stale");
    $("errorText").textContent = err.message || String(err);
    $("errorBanner").hidden = false;
    setConn("err", "Connection failed", "");
  }

  $("errSettings").addEventListener("click", function () {
    $("errorBanner").hidden = true;
    showSettings(true);
  });
  $("errRetry").addEventListener("click", function () { rerun(false); });

  function rerun(fullRefresh) {
    stGet(CREDS_KEY).then(function (creds) {
      if (creds) run(creds, fullRefresh).catch(fail);
    });
  }

  $("refresh").addEventListener("click", function () { rerun(false); });
  $("resync").addEventListener("click", function () {
    showMain();
    rerun(true);
  });

  /* ── settings: save, test, forget ── */
  $("save").addEventListener("click", function () {
    stGet(CREDS_KEY).then(function (existing) {
      var creds = {
        accountId: $("accountId").value.trim(),
        /* blank token field means: keep the one already saved */
        token: $("token").value.trim() || (existing && existing.token) || "",
        pageSize: clampPageSize($("pageSize").value)
      };
      if (!creds.accountId || !creds.token) {
        setConn("err", "Missing details", "Account ID and token are both required");
        return;
      }
      stSet(CREDS_KEY, creds).then(function () {
        $("token").value = "";
        $("token").placeholder = "saved · leave blank to keep";
        showMain();
        run(creds, false).catch(fail);
      });
    });
  });

  $("testConn").addEventListener("click", function () {
    stGet(CREDS_KEY).then(function (existing) {
      var creds = {
        accountId: $("accountId").value.trim() || (existing && existing.accountId) || "",
        token: $("token").value.trim() || (existing && existing.token) || ""
      };
      if (!creds.accountId || !creds.token) {
        setConn("err", "Missing details", "Account ID and token are both required");
        return;
      }
      setConn("", "Testing…", "");
      Promise.all([hv("/users/me", creds), hv("/company", creds)])
        .then(function (res) {
          setConn("ok", "Connected", "· " + res[1].name + " · " + res[0].first_name);
        })
        .catch(function (e) {
          setConn("err", "Failed", e.message || "");
        });
    });
  });

  function setConn(state, status, meta) {
    var card = $("connCard");
    card.className = "conn-card" + (state ? " " + state : "");
    $("connStatus").textContent = status;
    $("connMeta").textContent = meta;
  }

  /* wipe token, cache and report from this browser */
  $("forget").addEventListener("click", function () {
    chrome.storage.local.clear(function () {
      $("accountId").value = "";
      $("token").value = "";
      $("token").placeholder = "xxxxxxx.pt.xxxxxxxx...";
      $("pageSize").value = 2000;
      $("syncLabel").textContent = "";
      hasData = false;
      results.hidden = true;
      setConn("", "Not connected", "");
      showSettings(false);
    });
  });

  /* ── boot: paint the last report instantly, refresh in the background ── */
  var freshRendered = false;
  var hasData = false;

  stGet(CREDS_KEY).then(function (creds) {
    if (creds && creds.token) {
      $("accountId").value = creds.accountId;
      /* the saved token is never echoed back into the UI */
      $("token").placeholder = "saved · leave blank to keep";
      $("pageSize").value = creds.pageSize || 2000;
      showMain();
      stGet(LAST_REFRESH_KEY).then(setSyncedLabel);
      stGet(REPORT_KEY).then(function (rep) {
        if (rep && rep.months && !freshRendered) {
          render(rep);
          results.classList.add("stale");
        }
      });
      run(creds, false).catch(fail);
    } else {
      $("pageSize").value = 2000;
      setConn("", "Not connected", "");
      showSettings(false);
    }
  });

  /* ── the ledger ── */
  var running = false;
  var queued = null;

  /* single-flight with a one-slot queue: a trigger that arrives mid-fetch
     runs once the current fetch finishes, latest wins */
  async function run(creds, fullRefresh) {
    if (running) {
      queued = { creds: creds, fullRefresh: fullRefresh };
      return;
    }
    running = true;
    try {
      await doRun(creds, fullRefresh);
    } finally {
      running = false;
      if (queued) {
        var q = queued;
        queued = null;
        run(q.creds, q.fullRefresh).catch(fail);
      }
    }
  }

  async function doRun(creds, fullRefresh) {
    $("errorBanner").hidden = true;
    setSyncing(true);
    if (hasData) results.classList.add("stale");
    else results.hidden = true;

    var me = await hv("/users/me", creds);
    var dailyCapH = (me.weekly_capacity || 144000) / 5 / 3600;

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
      from: from, to: to, dailyCapH: dailyCapH, months: months, days: days
    };
    render(report);
    freshRendered = true;

    setConn("ok", "Connected",
        "· " + (company ? company.name : creds.accountId) + " · " + me.first_name);

    /* persist the report so the next popup open paints instantly */
    await stSet(REPORT_KEY, report);

    var stamp = Date.now();
    await stSet(LAST_REFRESH_KEY, stamp);
    setSyncing(false);
    setSyncedLabel(stamp);
  }

  /* ── render ── */
  function render(rep) {
    var dailyCapH = rep.dailyCapH;
    var days = rep.days || {};
    var todayIso = iso(now);

    /* all-time balance from monthly buckets */
    var workdays = {};
    var d = parseISO(rep.from), end = parseISO(rep.to);
    while (d <= end) {
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1);
      var dow = d.getDay();
      if (dow !== 0 && dow !== 6) workdays[key] = (workdays[key] || 0) + 1;
      d.setDate(d.getDate() + 1);
    }
    var totExp = 0, totLog = 0;
    Object.keys(workdays).forEach(function (k) { totExp += workdays[k] * dailyCapH; });
    Object.keys(rep.months).forEach(function (k) {
      if (k >= rep.from.slice(0, 7) && k <= rep.to.slice(0, 7)) totLog += rep.months[k][0];
    });
    var balance = totLog - totExp;

    /* hero */
    var balEl = $("balance");
    balEl.className = "balance " + (Math.abs(balance) < 1 ? "neutral" : (balance < 0 ? "neg" : ""));
    balEl.innerHTML = "";
    var hm = splitHM(balance);
    addSpan(balEl, "b-sign", balance < 0 ? "-" : "+");
    addSpan(balEl, "b-h", String(hm.h));
    addSpan(balEl, "b-hu", "h");
    if (hm.m !== 0) {
      addSpan(balEl, "b-m", pad(hm.m));
      addSpan(balEl, "b-mu", "m");
    }

    $("sinceLine").textContent = "Tracked since "
        + new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(parseISO(rep.from));

    /* week chip: this week vs elapsed weekday capacity */
    var weekFrom = weekStartIso();
    var weekH = 0, weekExpDays = 0;
    var wd = parseISO(weekFrom), lim = parseISO(todayIso);
    while (wd <= lim) {
      if (wd.getDay() !== 0 && wd.getDay() !== 6) weekExpDays++;
      wd.setDate(wd.getDate() + 1);
    }
    Object.keys(days).forEach(function (k) { if (k >= weekFrom && k <= todayIso) weekH += days[k]; });
    var weekDiff = weekH - weekExpDays * dailyCapH;
    var chip = $("weekChip");
    chip.className = "chip " + (weekDiff >= 0 ? "up" : "down");
    chip.textContent = (weekDiff >= 0 ? "↑ " : "↓ ") + fmtHM(Math.abs(weekDiff));

    /* today card */
    var todayH = days[todayIso] || 0;
    var isWorkday = now.getDay() !== 0 && now.getDay() !== 6;
    var todayExp = isWorkday ? dailyCapH : 0;
    if (todayExp > 0) {
      $("todayNums").innerHTML = "<b>" + esc(fmtHM(todayH)) + "</b> / " + esc(fmtHM(todayExp)) + " expected";
      $("todayBar").style.width = Math.min(100, todayH / todayExp * 100).toFixed(1) + "%";
      var left = todayExp - todayH;
      $("todayCaption").textContent = left > 0.01
          ? fmtHM(left) + " left to reach today's expected hours"
          : "Expected hours reached";
    } else {
      $("todayNums").innerHTML = "<b>" + esc(fmtHM(todayH)) + "</b> tracked";
      $("todayBar").style.width = todayH > 0 ? "100%" : "0";
      $("todayCaption").textContent = "No expected hours today";
    }

    /* weekly chart: bars and target line share the container baseline,
       labels live in their own row below */
    var chart = $("weekChart");
    var labels = $("weekLabels");
    chart.querySelectorAll(".day-bar").forEach(function (n) { n.remove(); });
    labels.innerHTML = "";
    var names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    var week = [];
    var maxH = 10;
    for (var i = 0; i < 7; i++) {
      var dayIso = addDays(parseISO(weekFrom), i);
      var h = days[dayIso] || 0;
      week.push({ iso: dayIso, name: names[i], hours: h, weekend: i >= 5 });
      maxH = Math.max(maxH, h);
    }
    var pxPerH = 96 / maxH;
    $("targetLine").style.bottom = (dailyCapH * pxPerH).toFixed(1) + "px";
    $("targetLabel").textContent = fmtHM(dailyCapH) + " target";

    week.forEach(function (w) {
      var bar = document.createElement("div");
      bar.className = "day-bar";
      var label = document.createElement("span");
      label.className = "day-label";
      label.textContent = w.name;

      if (w.hours > 0) {
        bar.style.height = Math.max(6, w.hours * pxPerH).toFixed(1) + "px";
      } else {
        bar.style.height = "6px";
        bar.classList.add(w.weekend ? "weekend" : "empty");
      }
      if (w.iso === todayIso) {
        if (w.hours > 0) bar.classList.add("today-bar");
        label.classList.add("today-label");
      } else if (w.iso > todayIso) {
        label.classList.add(w.weekend ? "dimmer" : "dim");
      } else if (w.weekend) {
        label.classList.add("dimmer");
      }
      bar.title = w.name + ": " + fmtHM(w.hours);

      chart.appendChild(bar);
      labels.appendChild(label);
    });

    /* recent ledger: last tracked days before today */
    var list = $("recentList");
    list.innerHTML = "";
    var recent = Object.keys(days)
        .filter(function (k) { return k < todayIso && days[k] > 0; })
        .sort()
        .reverse()
        .slice(0, 4);
    if (!recent.length) {
      var empty = document.createElement("div");
      empty.className = "recent-empty";
      empty.textContent = "No tracked days in the last four weeks.";
      list.appendChild(empty);
    }
    var fmtRecent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" });
    recent.forEach(function (k) {
      var dd = parseISO(k);
      var exp = (dd.getDay() !== 0 && dd.getDay() !== 6) ? dailyCapH : 0;
      var diff = days[k] - exp;
      var parts = fmtRecent.formatToParts(dd);
      var wk = "", mo = "", dnum = "";
      parts.forEach(function (p) {
        if (p.type === "weekday") wk = p.value;
        if (p.type === "month") mo = p.value;
        if (p.type === "day") dnum = p.value;
      });

      var row = document.createElement("div");
      row.className = "recent-row";
      var left = document.createElement("div");
      left.className = "recent-day";
      var date = document.createElement("span");
      date.className = "recent-date";
      date.textContent = wk + " · " + mo + " " + dnum;
      var sub = document.createElement("span");
      sub.className = "recent-sub";
      sub.textContent = fmtHM(days[k]) + " tracked";
      left.appendChild(date);
      left.appendChild(sub);

      var right = document.createElement("span");
      right.className = "recent-diff " + (diff >= 0 ? "up" : "down");
      right.textContent = (diff >= 0 ? "+" : "-") + fmtHM(Math.abs(diff));

      row.appendChild(left);
      row.appendChild(right);
      list.appendChild(row);
    });

    /* footer links */
    if (rep.company && rep.company.full_domain) {
      $("trackLink").href = "https://" + rep.company.full_domain + "/time";
      $("reportLink").href = "https://" + rep.company.full_domain + "/reports";
    }

    hasData = true;
    results.classList.remove("stale");
    results.hidden = false;
  }

  function addSpan(parent, cls, text) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    parent.appendChild(s);
  }

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

  /* ── date and format helpers ── */
  function parseISO(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +(p[2] || 1)); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nextDay(s) { var d = parseISO(s); d.setDate(d.getDate() + 1); return iso(d); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return iso(x); }
  function maxStr(a, b) { return a > b ? a : b; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function weekStartIso() {
    var d = new Date(now);
    d.setDate(d.getDate() - (d.getDay() + 6) % 7);   /* back to Monday */
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
})();
