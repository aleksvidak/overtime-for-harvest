/* Popup UI. All data access goes through HL (core.js, loaded first). */
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var main = $("main"), settings = $("settings"), results = $("results");
  var now = new Date();

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
    $("syncLabel").textContent = ts ? "Synced " + HL.fmtAgo(ts) : "";
  }

  /* ── error banner ── */
  function fail(err) {
    setSyncing(false);
    HL.stGet(HL.LAST_REFRESH_KEY).then(setSyncedLabel);
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
    HL.stGet(HL.CREDS_KEY).then(function (creds) {
      if (creds) run(creds, fullRefresh).catch(fail);
    });
  }

  $("refresh").addEventListener("click", function () { rerun(false); });
  $("resync").addEventListener("click", function () {
    showMain();
    rerun(true);
  });

  /* ── settings: icon style, save, test, forget ── */
  var iconStyle = "dot";
  var segBtns = document.querySelectorAll("#iconStyleSeg button");
  function setSeg(v) {
    iconStyle = v;
    segBtns.forEach(function (b) { b.classList.toggle("active", b.dataset.v === v); });
  }
  segBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      setSeg(b.dataset.v);
      /* apply instantly: persisting the setting makes the worker repaint the icon */
      HL.stGet(HL.CREDS_KEY).then(function (existing) {
        if (existing && existing.token) {
          existing.iconStyle = iconStyle;
          HL.stSet(HL.CREDS_KEY, existing);
        }
      });
    });
  });
  setSeg("dot");

  $("save").addEventListener("click", function () {
    HL.stGet(HL.CREDS_KEY).then(function (existing) {
      var creds = {
        accountId: $("accountId").value.trim(),
        /* blank token field means: keep the one already saved */
        token: $("token").value.trim() || (existing && existing.token) || "",
        pageSize: HL.clampPageSize($("pageSize").value),
        iconStyle: iconStyle
      };
      if (!creds.accountId || !creds.token) {
        setConn("err", "Missing details", "Account ID and token are both required");
        return;
      }
      HL.stSet(HL.CREDS_KEY, creds).then(function () {
        $("token").value = "";
        $("token").placeholder = "saved · leave blank to keep";
        showMain();
        run(creds, false).catch(fail);
      });
    });
  });

  $("testConn").addEventListener("click", function () {
    HL.stGet(HL.CREDS_KEY).then(function (existing) {
      var creds = {
        accountId: $("accountId").value.trim() || (existing && existing.accountId) || "",
        token: $("token").value.trim() || (existing && existing.token) || ""
      };
      if (!creds.accountId || !creds.token) {
        setConn("err", "Missing details", "Account ID and token are both required");
        return;
      }
      setConn("", "Testing…", "");
      Promise.all([HL.hv("/users/me", creds), HL.hv("/company", creds)])
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

  HL.stGet(HL.CREDS_KEY).then(function (creds) {
    if (creds && creds.token) {
      $("accountId").value = creds.accountId;
      /* the saved token is never echoed back into the UI */
      $("token").placeholder = "saved · leave blank to keep";
      $("pageSize").value = creds.pageSize || 2000;
      setSeg(creds.iconStyle || "dot");
      showMain();
      HL.stGet(HL.LAST_REFRESH_KEY).then(setSyncedLabel);
      HL.stGet(HL.REPORT_KEY).then(function (rep) {
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

  /* ── single-flight with a one-slot queue: a trigger that arrives mid-fetch
     runs once the current fetch finishes, latest wins ── */
  var running = false;
  var queued = null;

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

    var report = await HL.syncReport(creds, fullRefresh);
    render(report);
    freshRendered = true;

    setConn("ok", "Connected",
        "· " + (report.company ? report.company.name : creds.accountId) + " · " + report.me.first_name);

    setSyncing(false);
    setSyncedLabel(Date.now());
  }

  /* ── render ── */
  function render(rep) {
    var dailyCapH = rep.dailyCapH;
    var days = rep.days || {};
    var todayIso = HL.iso(now);

    /* hero */
    var balance = HL.computeBalance(rep);
    var balEl = $("balance");
    balEl.className = "balance " + (Math.abs(balance) < 1 ? "neutral" : (balance < 0 ? "neg" : ""));
    balEl.innerHTML = "";
    var hm = HL.splitHM(balance);
    addSpan(balEl, "b-sign", balance < 0 ? "-" : "+");
    addSpan(balEl, "b-h", String(hm.h));
    addSpan(balEl, "b-hu", "h");
    if (hm.m !== 0) {
      addSpan(balEl, "b-m", HL.pad(hm.m));
      addSpan(balEl, "b-mu", "m");
    }

    $("sinceLine").textContent = "Tracked since "
        + new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(HL.parseISO(rep.from));

    /* week chip: this week vs elapsed weekday capacity */
    var weekFrom = HL.weekStartIso();
    var weekH = 0, weekExpDays = 0;
    var wd = HL.parseISO(weekFrom), lim = HL.parseISO(todayIso);
    while (wd <= lim) {
      if (wd.getDay() !== 0 && wd.getDay() !== 6) weekExpDays++;
      wd.setDate(wd.getDate() + 1);
    }
    Object.keys(days).forEach(function (k) { if (k >= weekFrom && k <= todayIso) weekH += days[k]; });
    var weekDiff = weekH - weekExpDays * dailyCapH;
    var chip = $("weekChip");
    chip.className = "chip " + (weekDiff >= 0 ? "up" : "down");
    chip.textContent = (weekDiff >= 0 ? "↑ " : "↓ ") + HL.fmtHM(Math.abs(weekDiff));

    /* today card */
    var todayH = days[todayIso] || 0;
    var isWorkday = now.getDay() !== 0 && now.getDay() !== 6;
    var todayExp = isWorkday ? dailyCapH : 0;
    if (todayExp > 0) {
      $("todayNums").innerHTML = "<b>" + HL.esc(HL.fmtHM(todayH)) + "</b> / " + HL.esc(HL.fmtHM(todayExp)) + " expected";
      $("todayBar").style.width = Math.min(100, todayH / todayExp * 100).toFixed(1) + "%";
      var left = todayExp - todayH;
      $("todayCaption").textContent = left > 0.01
          ? HL.fmtHM(left) + " left to reach today's expected hours"
          : "Expected hours reached";
    } else {
      $("todayNums").innerHTML = "<b>" + HL.esc(HL.fmtHM(todayH)) + "</b> tracked";
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
      var dayIso = HL.addDays(HL.parseISO(weekFrom), i);
      var h = days[dayIso] || 0;
      week.push({ iso: dayIso, name: names[i], hours: h, weekend: i >= 5 });
      maxH = Math.max(maxH, h);
    }
    var pxPerH = 96 / maxH;
    $("targetLine").style.bottom = (dailyCapH * pxPerH).toFixed(1) + "px";
    $("targetLabel").textContent = HL.fmtHM(dailyCapH) + " target";

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
      bar.title = w.name + ": " + HL.fmtHM(w.hours);

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
      var dd = HL.parseISO(k);
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
      sub.textContent = HL.fmtHM(days[k]) + " tracked";
      left.appendChild(date);
      left.appendChild(sub);

      var right = document.createElement("span");
      right.className = "recent-diff " + (diff >= 0 ? "up" : "down");
      right.textContent = (diff >= 0 ? "+" : "-") + HL.fmtHM(Math.abs(diff));

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
})();
