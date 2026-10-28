# Home Hub: handover brief for Claude Code

This project has already been built. Your job is to help Sam set it up, test it against the real services, and fix anything the real data reveals. Sam isn't a developer: explain plainly, run commands for him where you can, and tell him exactly what to click or paste when he has to do something himself.

Start by reading `README.md` (the setup guide) and skimming `src/`.

---

## What's built

A Cloudflare Worker (TypeScript) with a Cron Trigger every 10 minutes and KV storage.

| File | What it does |
|---|---|
| `src/index.ts` | Routes (dashboard, API, Shortcut endpoints) and the scheduler that runs each module in isolation |
| `src/dashboard.ts` | The wall dashboard page. Plain HTML/CSS and **ES5 JavaScript only** (XHR, `var`, no arrow functions) for old Fire tablets. A test enforces this. |
| `src/time.ts` | Europe/London time helpers. All scheduling decisions use UK time. |
| `src/notify.ts` | ntfy notifications, with `notifyOnce` de-duplication via KV |
| `src/modules/bins.ts` | ICS parsing, 7pm reminder, tile/line visibility rules |
| `src/modules/commute.ts` | TomTom routing with live traffic; alerts when live time exceeds the historic (typical) time by `COMMUTE_ALERT_MINUTES` |
| `src/modules/dartcharge.ts` | Crossing log from iPhone Shortcuts, reminders at 6pm/9pm on the due day, ignores 22:00–06:00 |
| `src/modules/f1.ts` | Jolpica-F1 calendar/results, schedule, pre-session and result notifications |
| `src/modules/watch.ts` | TMDB discover by UK provider, daily film + series pick, seen/not-for-me feedback |
| `src/modules/weather.ts` | Open-Meteo, every 30 minutes |
| `src/modules/vehicles.ts` | MOT and tax watcher (DVLA + DVSA), weekly read, reminders at 30/7/1 days. See `BRIEF-vehicles-energy.md` |
| `src/modules/energy.ts` | Smart meter usage and cost via Glowmarkt (Bright app), daily read, always-on and cost alerts. See `BRIEF-vehicles-energy.md` |
| `src/alexa.ts` | Alexa via Voice Monkey: speaks reminders on the kitchen and hallway Echo Dots, starts the bin-lamp and race-TV routines, quiet hours 21:00–07:00 |

**Tests:** `npm test` runs 36 tests (the original 20 plus vehicles, energy and Alexa) with sample data (UK clock change, ICS parsing, alert de-duplication, F1 notification sequence, route auth, and the dashboard rendering in a fake browser). `npm run check` type-checks. `npx wrangler deploy --dry-run` bundles cleanly (~41 KB).

## What has NOT been tested

The code was written without network access to the real services, so these are assumptions to verify on the first real run:

1. **TomTom:** the response fields `travelTimeInSeconds`, `historicTrafficTravelTimeInSeconds` (needs `computeTravelTimeFor=all`) and `trafficDelayInSeconds`. Check the current free-tier daily limit; the hub uses about 25 requests per weekday.
2. **Sam's bin ICS feed:** check how its event titles are worded. `binsFromSummary()` in `bins.ts` turns titles like "Green bin collection" into "Green"; adjust it if his council words them differently. Also check whether events are all-day or timed.
3. **Jolpica-F1:** confirm the sprint session field names in the current season's schedule (`SprintQualifying` vs `SprintShootout`); both are handled.
4. **TMDB:** confirm discover filters (`with_watch_providers`, `watch_region=GB`, `with_watch_monetization_types=flatrate`) return sensible titles, and that the API key works as `api_key` (v3). Use `/api/providers` to get Sam's provider ids.
5. **ntfy:** confirm notifications with action buttons ("Pay now", "Mark paid") appear correctly on iOS.
6. **The Fire tablet:** get the model and Fire OS version, load the dashboard in Fully Kiosk Browser and check it renders and stays up. If the browser is very old and `Intl.DateTimeFormat.formatToParts` isn't supported, the clock falls back to the tablet's own time zone, so make sure the tablet is set to UK time.

7. **Voice Monkey / Alexa:** confirm announcements play on the kitchen and hallway Dots (`/api/alexa-test`), and that the Routine Triggers start the bin-lamp and race-TV routines. Sky Stream has no Alexa control, so the race routine only turns the TV on and switches to the Sky Stream input.
8. **Vehicles and energy:** see the "To check on the first real run" list at the end of `BRIEF-vehicles-energy.md`.

## Setup steps (do these with Sam, in order)

1. Ask Sam to create the free accounts in the README (Cloudflare, ntfy app, TomTom, TMDB) and to find his bin calendar link and home/work coordinates.
2. `npm install`, `npx wrangler login`, create the KV namespace and paste its id into `wrangler.toml`.
3. Generate tokens (`npm run make-token`), set all secrets, `npm run deploy`, then set `PUBLIC_URL`.
4. Sam subscribes to the ntfy topic on his iPhone; hit `/api/test` and confirm the notification arrives.
5. Hit `/api/run` and fix any module that reports an error, using `npx wrangler tail` to see logs.
6. Check `/api/state` looks right, then open the dashboard on a laptop, then on the Fire tablet.
7. Set `WATCH_PROVIDERS` from `/api/providers`, redeploy.
8. Dart Charge: ask whether Sam has (or will set up) a pay-as-you-go or pre-pay Dart Charge account. If yes, remove `dartcharge` from `MODULES`. If not, walk him through the two Shortcuts automations in the README.
9. Walk through the Fire tablet setup in the README.
10. Alexa (README, "Alexa"): Voice Monkey account and skill, kitchen and hallway speakers, then the two Alexa Routines.
11. MOT/tax and energy (README sections): Bright app first (consent can take days), then the DVSA (and DVLA, if registrations reopen) keys.

## After a week of real use (Phase 5 from the original plan)

- Tune `COMMUTE_ALERT_MINUTES` based on how many alerts Sam got.
- Adjust tile sizes/layout once it's seen on the actual tablet from across the room.
- Optional: a simple settings page for switching modules on and off without redeploying.

## Ground rules

- Keep the dashboard script ES5 (the dashboard test checks this).
- Stay inside free tiers. Warn Sam before anything that could cost money. KV free tier is 1,000 writes/day; `putJSON` skips unchanged writes, so keep it that way.
- Notifications should be rare and useful. Always use `notifyOnce` with a key that includes the date.
- Secrets only via `wrangler secret put`; never commit `.dev.vars` or tokens.
- Run `npm test` and `npm run check` after every change.
