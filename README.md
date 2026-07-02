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

Expected time = weekdays x your Harvest daily capacity (weekly capacity / 5). Vacation and public
holidays count as tracked time, so keep them logged in Harvest. Closed years are cached locally;
only the current year is refetched on sync.

---

Not affiliated with Harvest. Harvest is a trademark of Iridesco LLC.
