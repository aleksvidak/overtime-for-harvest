/* Background worker: keeps the toolbar badge showing the live balance and
   nudges when a workday goes untracked. Read-only, same data layer as the popup. */
importScripts("core.js");

var SYNC_ALARM = "hl-sync";
var NUDGE_KEY = "harvest_ledger_nudges";
var NUDGE_NOTIFICATION = "hl-nudge";

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

function init() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 30, delayInMinutes: 1 });
  /* draw the badge from the stored report immediately, then sync */
  HL.stGet(HL.REPORT_KEY).then(updateBadge);
  refresh();
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === SYNC_ALARM) refresh();
});

/* the popup syncs through the same report key: repaint the badge on any change,
   including when "forget" clears storage */
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === "local" && changes[HL.REPORT_KEY]) {
    updateBadge(changes[HL.REPORT_KEY].newValue || null);
  }
});

async function refresh() {
  var creds = await HL.stGet(HL.CREDS_KEY);
  if (!creds || !creds.token) {
    updateBadge(null);
    return;
  }
  try {
    var report = await HL.syncReport(creds, false);
    updateBadge(report);
    await maybeNudge(report);
  } catch (e) {
    /* keep the stale badge; never nudge off stale data */
    var stored = await HL.stGet(HL.REPORT_KEY);
    updateBadge(stored);
  }
}

/* The balance is drawn INTO the icon (no badge): a badge overlay is a fixed
   size Chrome does not let us tune and it swamps a 16px icon. */
function updateBadge(report) {
  chrome.action.setBadgeText({ text: "" });
  if (!report || !report.months) {
    chrome.action.setIcon({
      path: { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" }
    });
    return;
  }
  var bal = HL.computeBalance(report);
  var h = HL.splitHM(bal).h;
  var text = h > 99 ? "99+" : (bal < 0 ? "-" : "+") + h;
  var color = Math.abs(bal) < 1 ? "#9A9083" : (bal < 0 ? "#B24A2E" : "#4C9A6A");

  var imageData = {};
  [16, 32].forEach(function (size) {
    imageData[size] = drawTile(size, text, color);
  });
  chrome.action.setIcon({ imageData: imageData });
}

function drawTile(size, text, color) {
  var c = new OffscreenCanvas(size, size);
  var ctx = c.getContext("2d");

  var r = size * 0.22;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(size, 0, size, size, r);
  ctx.arcTo(size, size, 0, size, r);
  ctx.arcTo(0, size, 0, 0, r);
  ctx.arcTo(0, 0, size, 0, r);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  var px = Math.round(size * 0.72);
  do {
    ctx.font = "700 " + px + "px sans-serif";
    px--;
  } while (px > 5 && ctx.measureText(text).width > size * 0.88);
  ctx.fillText(text, size / 2, size / 2 + size * 0.04);

  return ctx.getImageData(0, 0, size, size);
}

/* ── nudges: only from a fresh sync, one of each kind per day, workdays only ── */
async function maybeNudge(report) {
  var now = new Date();
  var dow = now.getDay();
  if (dow === 0 || dow === 6) return;

  var today = HL.iso(now);
  var days = report.days || {};
  var mins = now.getHours() * 60 + now.getMinutes();
  var nudges = (await HL.stGet(NUDGE_KEY)) || {};

  /* evening: nothing tracked today */
  if (mins >= 17 * 60 + 30 && (days[today] || 0) < 0.02 && nudges.evening !== today) {
    nudges.evening = today;
    await HL.stSet(NUDGE_KEY, nudges);
    notify("Nothing tracked today",
        HL.fmtHM(report.dailyCapH) + " expected. Log your hours before you forget.");
    return;   /* one nudge at a time is enough */
  }

  /* morning: the previous workday was left empty */
  var prev = HL.prevWorkdayIso();
  if (mins >= 9 * 60 + 30 && prev >= report.from
      && (days[prev] || 0) < 0.02 && nudges.morning !== today) {
    nudges.morning = today;
    await HL.stSet(NUDGE_KEY, nudges);
    var label = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" })
        .format(HL.parseISO(prev));
    notify("A timesheet day is empty",
        "Nothing tracked on " + label + ". A minute now saves the scramble later.");
  }
}

function notify(title, message) {
  chrome.notifications.create(NUDGE_NOTIFICATION, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: title,
    message: message
  });
}

/* clicking a nudge opens Harvest's time page */
chrome.notifications.onClicked.addListener(async function (id) {
  if (id !== NUDGE_NOTIFICATION) return;
  var report = await HL.stGet(HL.REPORT_KEY);
  var url = report && report.company && report.company.full_domain
      ? "https://" + report.company.full_domain + "/time"
      : "https://harvestapp.com";
  chrome.tabs.create({ url: url });
  chrome.notifications.clear(NUDGE_NOTIFICATION);
});
