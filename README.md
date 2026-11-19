# Knock Map

A prospecting map for door-to-door commercial sales. Every business in the territory is a pin. Walk in, tap the pin, tap what happened, and the app keeps the history, follow-ups and stats for you.

Built for a Bay Alarm commercial territory in the West Valley (El Mirage, Peoria, Sun City, Sun City West, Surprise).

**Open it:** https://nathanvaden.github.io/knock-map/ (on a phone, add it to your home screen so it opens like an app)

## Using it

| Tab | What it's for |
|---|---|
| **Map** | Every business, colored by where it stands. Tap a pin to open it and log a visit. `+` marks a For Lease sign, a construction site, or a business that's missing. |
| **Nearby** | The same businesses as a list, closest first. |
| **Plan** | Where to go: *Plan my day* builds a route (due follow-ups first, then the closest new doors). Also due follow-ups, contracts ending soon, new permits, construction and For Lease pins, and the biggest commercial landlords / property managers. |
| **Pipeline** | Every deal by stage: appointments set, quotes to build, quotes out, sold in the last 30 days, plus future proposals for other venues. |
| **Stats** | Daily log (copy into HubSpot), doors per day, how often you reach a decision maker, pipeline dollars, territory coverage. |
| **Settings** | One-time setup: load businesses, connect cloud backup, import permit and customer spreadsheets. |

Each business has four tabs: **Visit** (door outcome, deal stage, follow-up, deal $, future proposals, card scan, history), **Appt** (start/end an appointment with its own notes, running log and photos), **Notes & photos** (general notes, walkthrough photos), **Details** (contact, current provider, contract end, property owner).

The deal path: *Appt set* → (end the appointment) *Building quote* → *Quote sent* → *Sold* or *Not a fit*.

Pin colors: gray = not visited, tan = closed/nobody there, red = booted, amber = gatekeeper, teal = talked to the decision maker, blue = follow-up, purple = appointment set, pink with white ring = building quote, lime = quote sent, green = sold, dark slate = not a fit, orange = building permit, red ring = Bay Alarm customer, square teal = For Lease, square yellow = construction. A faded pin means you were booted recently and it's cooling off.

The app also has a built-in guide: **Settings → How this app works**.

## Setup for a new person

1. Open the link and go to **Settings**.
2. **Businesses:** tap *Load businesses*. It pulls every business in the territory from OpenStreetMap (free), one zip code at a time.
3. **Cloud backup:** visits are saved to a private GitHub repo so nothing is lost and every device stays in sync. You need a GitHub account, a private repo (e.g. `knock-data`), and a fine-grained access token with **Contents: Read and write** on that repo only. Enter your username, the repo name and the token, then tap *Save & sync now*. The cloud icon at the top turns green.
4. **Property owners:** nothing to set up. *Who owns this property?* on any business, and the landlords list in Plan, read the Maricopa County Assessor's public parcel data.
5. **Permits (optional):** download the Maricopa County weekly permit spreadsheet (link is in Settings) or any city's permit list, and import it. Commercial permits in the territory show up as orange pins.

## Where things live

| File | What it is |
|---|---|
| `index.html` | Page layout, tab bar and icons |
| `style.css` | All styling. Brand colors are the first lines (`--brand`, `--accent`) |
| `js/core.js` | Statuses, on-device storage, app state |
| `js/sync.js` | Loading businesses from OpenStreetMap; cloud backup through GitHub |
| `js/map.js` | Map, pins, GPS, filters |
| `js/business.js` | The business sheet: visit, appointments, notes & photos, details, future proposals, card scanning |
| `js/plan.js` | Nearby list, Plan tab and Pipeline tab |
| `js/leads.js` | Permits, property owners/landlords, Bay Alarm customers, For Lease and construction pins |
| `js/stats.js` | Daily log and Stats tab |
| `js/ui.js` | Settings, filters, help guide, tab switching, startup |
| `card.js` | Business card scanner (reads the photo on the phone, no API key) |
| `territory.js` | Zip code boundaries for the territory |
| `.github/workflows/pages.yml` | Publishes the site on every push |

No build step and no server. It's a static site on GitHub Pages; visit data goes straight from the browser to the private data repo.

**Changing the territory:** `territory.js` holds the zip boundaries (from the U.S. Census ZCTA shapes). Swap in different zips there and reload businesses.
