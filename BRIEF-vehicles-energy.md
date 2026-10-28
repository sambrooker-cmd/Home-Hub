# Home Hub: MOT/tax watcher and energy usage

Oct 28, 2026 · @Sam

## How these fit Home Hub

Both are new modules in the existing `home-hub` Worker, built the same way as bins, commute and F1: a module file, a switch in the settings file, data in KV, notifications through ntfy and a dashboard tile. Neither needs any input after setup.

**Ground rules (from BRIEF.md, unchanged)**

- Free tiers only. KV free tier is 1,000 writes a day: use `putJSON` (skips unchanged writes), and keep these modules to a few writes a day each.
- Both run on their own slow schedule inside the 10-minute cron: MOT/tax once a week, energy once a day after 10:00 (when yesterday's data has usually landed). Store `lastRun` and skip otherwise.
- Notifications rare and useful, always `notifyOnce` with a key that includes the date or due date.
- Dashboard code stays ES5. Tiles hide when there's nothing worth showing.
- Secrets only via `wrangler secret put`. Reg plates, meter IDs and logins never in code or the repo.
- `npm test` and `npm run check` after every change; new tests use the existing `mockFetch` with canned API answers.

## 1. MOT and tax watcher (`src/modules/vehicles.ts`)

Once a week it looks up each vehicle by reg plate and warns ahead of tax and MOT due dates, with the last MOT's advisories. Nothing is entered after setup.

**Data**

- **DVLA Vehicle Enquiry Service API**: POST the reg, get make, colour, tax status, tax due date, MOT status and MOT expiry. Free; key by application. Secret `DVLA_VES_KEY`.
- **DVSA MOT History API**: every past test with date, result, mileage and advisories or defects. Free; register for an API key plus client credentials (the current API uses an OAuth token). Secrets `DVSA_API_KEY`, `DVSA_CLIENT_ID`, `DVSA_CLIENT_SECRET`, `DVSA_TOKEN_URL`, `DVSA_SCOPE`. Cache the token in KV until it expires.
- Check both providers' current docs before building: endpoints and auth have changed in the past.

**Settings**

- Secret `VEHICLES` = a short list, e.g. `car:AB12CDE,bike:XY70ZZZ` (label and reg). Labels are what notifications say ("the bike", "the car").

**What it does**

1. Weekly read (Sunday 09:00 UK), stored per vehicle in KV: tax and MOT status and dates, last test date and result, mileage per test, advisories from the last test.
2. **Notifications**: tax and MOT each at 30 days, 7 days and the day before (`notifyOnce` keyed by vehicle, kind and due date). "Tax due" / "No MOT" status from DVLA alerts straight away.
3. **New MOT result**: when a new test appears, one notification with pass or fail and the advisories in plain words.
4. **Advisories to watch**: advisories that appeared on the last test, grouped by part (tyres, brakes, suspension, lights…), shown on the tile in the month before the next MOT.
5. **New vehicles**: an MOT is first due 3 years after registration; if there's no test history, show "first MOT due \<date>" from the DVLA registration month and skip the history call.
6. **Mileage**: average miles a year from the test history, shown in the detail (handy for insurance renewals).

**Dashboard tile**

- Hidden unless something is due within 30 days, a vehicle is untaxed or has no MOT, or a new result arrived in the last 7 days.
- One line per vehicle: "Bike: MOT due 14 Mar (16 days)", amber within 7 days, red when overdue.

**Tests**: canned DVLA and DVSA answers for a taxed car with advisories, an untaxed vehicle, a new bike with no tests, a token expiry, and a DVLA 404 (wrong reg: notify once, keep the rest going).

## 2. Energy usage (`src/modules/energy.ts`)

Each morning it reads yesterday's electricity and gas from the smart meter, shows the cost on the dashboard, and alerts when always-on usage jumps or a day is unusually expensive. EDF has no public API for this, so the data comes through Hildebrand's free Glow/Bright service, which reads any DCC-connected smart meter once you consent in the Bright app.

**Data**

- **Glowmarkt API** (the API behind the Bright app): log in with the Bright account, get a token, list the virtual entity and its resources (electricity consumption, electricity cost, gas consumption, gas cost), then read half-hourly readings by date range. Secrets `GLOW_USERNAME`, `GLOW_PASSWORD`; the application id from Glowmarkt's docs. Cache the token in KV until it expires. Confirm the current endpoints and auth in Glowmarkt's API docs before building.
- Data normally lands the day after. Live usage would need a Glow display (a paid device): out of scope for now.
- **Tariff**: use the cost resources if they're populated for our meter. If not, secrets `ELEC_UNIT_P`, `ELEC_STANDING_P`, `GAS_UNIT_P`, `GAS_STANDING_P` (pence) from the EDF bill, and the module works costs out itself. Say which on the tile's detail.

**What it does**

1. Daily read after 10:00 UK: yesterday's half-hours, and any missing days in the last 7 (the meter sometimes sends late). Store a rolling 400 days of daily totals in KV (one key, small) plus the last 14 days of half-hours.
2. **Always-on usage**: the lowest-usage hour between 01:00 and 05:00, as watts. Baseline = median of the last 28 nights.
3. **Alerts** (each `notifyOnce` by date, all tunable constants):
   - always-on up 30%+ on the baseline for 2 nights running ("Something's been left on: overnight use 310 W, normally 220 W");
   - a day's electricity or gas cost 50%+ above the same weekday's 4-week average;
   - no new data for 3 days ("Smart meter hasn't sent readings since Sunday").
4. **Weekly summary** (Monday 08:00): last week's cost, against the week before and the same week last year once there's a year of data.

**Dashboard tile**

- "Yesterday £4.82 (elec £3.10, gas £1.72)", this week so far against last week, and a 14-day bar sparkline (ES5, inline SVG).
- Amber when an alert is open. Always shown; hidden only if setup isn't finished.

**Later, not in this build**: if we move to a time-of-use tariff, show tomorrow's cheapest hours and switch Apple Home smart plugs on in them.

**Tests**: canned Glowmarkt answers for a normal day, a late day back-filled, an always-on jump over 2 nights, a meter with no gas, empty cost resources (falls back to the tariff secrets), and an expired token.

## Setup and handover

The Glow consent can take a few days to start returning data, so do that first.

- [ ] Install the **Bright** app, create an account, and connect the smart meter (it asks for your address and confirms the meter through the DCC).
- [ ] Check yesterday's usage shows in the Bright app before building the energy module.
- [ ] Apply for a **DVLA Vehicle Enquiry Service** API key.
- [ ] Register for the **DVSA MOT History** API (API key plus client credentials).
- [ ] Optional: the EDF unit rates and standing charges from your latest bill, in case the meter's cost data is empty.
- [ ] In the `home-hub` folder, set each secret with `npx wrangler secret put NAME` as Claude Code asks.

**To hand over**: save this doc as `BRIEF-vehicles-energy.md` in the `home-hub` folder (Export → Markdown), open the folder in Claude Code and say: *"Read BRIEF.md and BRIEF-vehicles-energy.md, then build the vehicles module first."*

---

## Build status (added by Claude Code, 28 Oct 2026)

Both modules are built, tested with canned answers and switched on in `MODULES`. Each does nothing until its secrets are set. The Alexa add-on (Voice Monkey) was built in the same change.

**Changes from the brief**

- **DVLA registrations were closed** when this was built (the DVLA portal said "Registration for the VES API is currently closed"). The vehicles module therefore works with either service alone: DVSA only gives MOT dates, results and advisories; DVLA only gives tax and MOT dates. With both, you get everything.
- **First MOT for a new vehicle** uses the 1st of the month three years after first registration, because DVLA only gives the month. That's the earliest the real date can be, so reminders are never late.
- **Weekly energy summary** goes out on Monday once Sunday's readings have landed (normally after 10:00), or at 14:00 at the latest, rather than at 08:00, when Sunday is usually still missing.
- **Expensive-day alert** also needs the day to be at least 50p over the usual, so small gas days in summer don't trigger it (`SETTINGS.minExtraPence` in `energy.ts`).
- **Standing charges**: if `ELEC_STANDING_P` / `GAS_STANDING_P` are set they are added to each day's cost, including when the cost comes from the meter (Glowmarkt's cost readings may not include them).

**To check on the first real run** (the code was written without access to the real services)

1. DVSA: base URL `https://history.mot.api.gov.uk/v1/trade/vehicles/registration/{reg}` and the field names `motTests`, `completedDate`, `testResult`, `expiryDate`, `odometerValue`, `odometerUnit`, `defects[].type/text`, `motTestDueDate`. The public docs didn't show the spec page; confirm against the credentials email.
2. Glowmarkt: `POST /auth` answer (`token`, `exp`), `GET /virtualentity` classifiers (`electricity.consumption`, `electricity.consumption.cost`, `gas.consumption`, `gas.consumption.cost`), readings with `period=PT30M` returning `data: [[unixSeconds, value]]`, and whether cost readings are in pence. There is no official reference; this follows the community clients.
3. Voice Monkey: v3 `POST /announce` with `token`, `device`, `speech`, and `POST /trigger` with `token`, `device` (confirmed in their docs).

`/api/run` forces the weekly vehicle read and the daily energy read, so you can test straight after setting secrets. `/api/vehicles` shows everything stored about the vehicles (including average miles a year). `/api/alexa-test` says a test message on the speakers.
