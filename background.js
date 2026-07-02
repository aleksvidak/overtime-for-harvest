/* Background worker: keeps the toolbar icon showing the live balance.
   Read-only, same data layer as the popup. */
importScripts("core.js");

var SYNC_ALARM = "hl-sync";

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

/* the popup syncs through the same report key: repaint the icon on any change,
   including when "forget" clears storage or the icon-style setting changes */
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== "local") return;
  if (changes[HL.REPORT_KEY]) {
    updateBadge(changes[HL.REPORT_KEY].newValue || null);
  } else if (changes[HL.CREDS_KEY]) {
    HL.stGet(HL.REPORT_KEY).then(updateBadge);
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
  } catch (e) {
    /* keep the stale badge */
    var stored = await HL.stGet(HL.REPORT_KEY);
    updateBadge(stored);
  }
}

/* The balance is drawn INTO the icon (no badge): a badge overlay is a fixed
   size Chrome does not let us tune and it swamps a 16px icon. User-configurable:
   "none" = plain logo, "dot" = logo with a state-colored corner dot,
   "tile" = state-colored square with the signed hour count. */
var DEFAULT_ICON = {
  path: { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" }
};

async function updateBadge(report) {
  chrome.action.setBadgeText({ text: "" });
  if (!report || !report.months) {
    chrome.action.setIcon(DEFAULT_ICON);
    return;
  }
  var creds = await HL.stGet(HL.CREDS_KEY);
  var style = (creds && creds.iconStyle) || "dot";
  if (style === "none") {
    chrome.action.setIcon(DEFAULT_ICON);
    return;
  }
  var bal = HL.computeBalance(report);
  var color = Math.abs(bal) < 1 ? "#9A9083" : (bal < 0 ? "#B24A2E" : "#4C9A6A");

  var imageData = {};
  if (style === "dot") {
    var logo = await getLogo();
    [16, 32].forEach(function (size) {
      imageData[size] = drawDot(size, logo, color);
    });
  } else {
    var h = HL.splitHM(bal).h;
    var text = h > 99 ? "99+" : (bal < 0 ? "-" : "+") + h;
    [16, 32].forEach(function (size) {
      imageData[size] = drawTile(size, text, color);
    });
  }
  chrome.action.setIcon({ imageData: imageData });
}

var logoBitmap = null;
async function getLogo() {
  if (logoBitmap) return logoBitmap;
  var res = await fetch(chrome.runtime.getURL("icons/icon128.png"));
  logoBitmap = await createImageBitmap(await res.blob());
  return logoBitmap;
}

function drawDot(size, logo, color) {
  var c = new OffscreenCanvas(size, size);
  var ctx = c.getContext("2d");
  ctx.drawImage(logo, 0, 0, size, size);

  var r = size * 0.26;
  var cx = size - r, cy = size - r;

  /* punch a transparent gap so the dot reads on any toolbar theme */
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.4, 0, 2 * Math.PI);
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.fill();

  return ctx.getImageData(0, 0, size, size);
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

