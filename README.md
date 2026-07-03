# Overtime for Harvest

A Chrome extension that answers one question the moment you click it: **am I ahead or behind on my hours?**

It reads your own time entries through the official [Harvest API](https://help.getharvest.com/api-v2/) and
compares them with your expected working time (your Harvest weekly capacity, Monday to Friday), all the way
back to your first tracked day.

## Features

- Live balance on the toolbar badge, synced every 30 minutes in the background
- All-time overtime balance in hours and minutes
- This week vs. capacity, today's progress toward expected hours
- Monday-to-Sunday chart of the current week with your daily target
- Recent tracked days with their over/under
- Shortcuts to track time and open reports in Harvest

## Privacy

- You authenticate with your own Harvest personal access token
  (create one at [id.getharvest.com/developers](https://id.getharvest.com/developers))
- Token and cached hour totals live only in your browser (`chrome.storage.local`)
- Talks exclusively to `api.harvestapp.com`, enforced by the extension's CSP
- No analytics, no tracking, no third-party servers

See [PRIVACY.md](PRIVACY.md) for the full policy.

## Install (unpacked)

1. Clone this repo
2. Open `chrome://extensions`, enable **Developer mode**
3. **Load unpacked** and select the repo folder

## How expected hours are computed

"Hours per week" is your full-time (100%) figure. A full working day expects that ÷ 5. It defaults to
your Harvest weekly capacity, but you can override it in Settings ("Weekly target -> Hours per week")
if it differs. The "Working days" setting then sets which days you actually work and at what fraction:
tap a day to cycle full -> half -> off. Days at half or off lower your expected hours below full-time.
Example: 100% of 40h means an 8h full day, so full Monday–Thursday plus a half Friday expects
4×8 + 4 = 36h per week (90%). Vacation and public holidays count as tracked time, so keep them logged
in Harvest. Closed years are cached locally; only the current year is refetched on sync.

---

Not affiliated with Harvest. Harvest is a trademark of Iridesco LLC.
