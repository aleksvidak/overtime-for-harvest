# Chrome Web Store submission kit: Overtime for Harvest v1.1.0

Everything to paste into https://chrome.google.com/webstore/devconsole when uploading
`overtime-for-harvest-v1.1.0.zip`.

## Store listing

**Name:** Overtime for Harvest

**Summary (132 chars max):**
See your overtime balance at a glance: tracked Harvest hours vs. expected, today's progress, and your week.

**Category:** Productivity > Workflow & Planning

**Detailed description:**

Overtime for Harvest answers one question the moment you click it: am I ahead or behind on my hours?

It reads your own time entries through the official Harvest API and compares them with your expected
working time (your Harvest weekly capacity, Monday to Friday), all the way back to your first tracked day.

WHAT YOU SEE
- Your live overtime balance right on the toolbar icon, no click needed
- Your all-time overtime balance, in hours and minutes
- How this week is going vs. your capacity
- Today's progress toward your expected hours
- A Monday-to-Sunday chart of the current week with your daily target
- Your most recent tracked days and their over/under
- One-click shortcuts to track time and open reports in Harvest

PRIVACY BY DESIGN
- You authenticate with your own Harvest personal access token (created at id.getharvest.com/developers)
- The token and cached hour totals are stored only in your browser (chrome.storage.local)
- The extension talks exclusively to api.harvestapp.com, enforced by its content security policy
- No analytics, no tracking, no third-party servers, and nothing is ever sent to the developer
- "Forget token & clear cached data" wipes everything at any time

HOW EXPECTED HOURS ARE COMPUTED
Expected time = weekdays x your Harvest daily capacity. Vacation and public holidays count as
tracked time, so keep them logged in Harvest (most teams already do).

Not affiliated with Harvest. Harvest is a trademark of Iridesco LLC.

## Privacy tab

**Single purpose description:**
Shows the user's personal overtime balance by comparing their tracked Harvest time entries
against their expected working hours.

**Permission justifications:**
- `storage`: Stores the user's Harvest personal access token and cached aggregate hour totals
  locally so the balance loads instantly and closed years are not refetched.
- `alarms`: Schedules a background sync every 30 minutes so the toolbar icon always shows the
  user's current overtime balance.
- Host permission `https://api.harvestapp.com/*`: Fetches the user's own time entries, profile,
  and company info from the official Harvest API. This is the only host the extension contacts.

**Remote code:** No, all code is packaged in the extension.

**Data usage disclosures:**
- Check ONLY "Authentication information" (the Harvest personal access token) and
  "Website content" if the reviewer counts time-entry data (hours per day) as such.
- All three certifications apply and should be checked:
  - Not being sold to third parties
  - Not being used or transferred for purposes unrelated to the single purpose
  - Not being used or transferred to determine creditworthiness or for lending
- Data is NOT transmitted to the developer; it stays on-device except for direct calls
  to api.harvestapp.com.

**Privacy policy URL:** required because the extension handles authentication data.
Host the text below anywhere public (GitHub repo README/Pages, a gist, or your site) and paste the URL.

---

### Privacy policy (host this text publicly)

**Overtime for Harvest: Privacy Policy**

Last updated: July 2, 2026

Overtime for Harvest is a browser extension that shows your personal overtime balance
based on your Harvest time entries.

**What data the extension handles**
- Your Harvest account ID and personal access token, which you provide yourself
- Aggregated hour totals derived from your Harvest time entries (per month and per day)

**Where it is stored**
All data is stored locally in your browser using Chrome's extension storage. Nothing is stored
on any server operated by the developer.

**Where it is sent**
The extension communicates exclusively with the official Harvest API at api.harvestapp.com,
using your token, to read your own time entries, user profile, and company name. The extension's
content security policy technically prevents it from contacting any other host. No data is ever
sent to the developer or any third party.

**Analytics and tracking**
None. The extension contains no analytics, telemetry, or tracking of any kind.

**Data removal**
Use "Forget token & clear cached data" in the extension's settings to delete everything it has
stored, or simply uninstall the extension.

**Contact**
[your email address]

---

## Assets checklist

- [x] ZIP: `overtime-for-harvest-v1.0.0.zip` (sibling of this folder)
- [x] Icon 128x128: included in the package (`icons/icon128.png`)
- [ ] At least 1 screenshot, 1280x800 or 640x400 PNG: open the popup, capture it with
      Cmd+Shift+4 on a clean desktop, place it on a 1280x800 canvas (Preview > Tools > Adjust Size,
      or any editor). Show the main view with real-looking numbers.
- [ ] Optional small promo tile 440x280

## Submission steps

1. Register the developer account at https://chrome.google.com/webstore/devconsole ($5 one-time).
2. "New item" > upload the ZIP.
3. Paste the listing texts above, upload the screenshot.
4. Fill the Privacy tab from the section above, including the hosted privacy policy URL.
5. Set visibility: Public, or Unlisted if it is just for the 3AP team (unlisted skips no review
   but hides it from search; people install via direct link).
6. Submit for review. MV3, one narrow host permission, and no remote code make this a
   straightforward review, typically a few days.
