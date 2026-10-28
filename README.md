# Home Hub

Your personal hub: phone notifications for bins, traffic, Dart Charge, F1 and tonight's TV, plus a wall dashboard for an old Fire tablet. It runs free on Cloudflare, so nothing at home needs to stay switched on.

**Easiest way to set it up:** open this folder in Claude Code and say *"Read BRIEF.md and help me set this up, starting with step 1."* It will walk you through everything below. This README is the reference.

---

## What it does

| Feature | Phone notification | Dashboard |
|---|---|---|
| **Bins** | 7pm the night before: "Bins tomorrow: Green + Food" | Big tile from 4pm the day before until 9am on the day; otherwise a small "Next bins" line |
| **Commute** | Only when the drive is 10+ min slower than usual. Once per morning (06:30–08:30) and once per evening (16:30–18:30), weekdays | Journey time with green/amber/red, plus a quicker alternative route if there is one |
| **Dart Charge** | 6pm and 9pm on the day payment is due, with "Pay now" and "Mark paid" buttons | "2 crossings to pay" until marked paid |
| **F1** | Weekend schedule at 9am on day one, 30 min before qualifying/sprint/race, result and championship lead after the race | Next session with countdown, last race podium |
| **What to Watch** | 7:30pm: one film and one series on your services | Posters, with "Seen it" / "Not for me" buttons |
| **Weather** | — | Now, today and tomorrow |
| **MOT and tax** | 30 days, 7 days and the day before each due date; a new MOT result with its advisories | Shown only when something's due within 30 days; amber within 7, red when overdue |
| **Energy** | "Something's been left on" (overnight use up 2 nights running), an unusually expensive day, meter gone quiet, and a Monday summary | Yesterday's cost, this week against last, 14-day bars |
| **Alexa** (optional) | Bins, morning traffic, Dart Charge and F1 reminders spoken on the kitchen and hallway Echo Dots; bin-night lamp and TV on before the race | — |

The dashboard dims to just a clock from 10pm to 6:30am. Alexa stays silent from 9pm to 7am.

---

## Accounts you need (all free)

1. **Cloudflare**: https://dash.cloudflare.com/sign-up (hosts the hub).
2. **ntfy app** on your iPhone (App Store, free). No account needed.
3. **TomTom developer**: https://developer.tomtom.com (commute). Create an app/key in the dashboard.
4. **TMDB**: https://www.themoviedb.org/signup, then Settings → API → request a free personal API key (What to Watch).

You also need:
- Your council's bin calendar link (the ICS/iCal feed you already use).
- Your home and work locations as latitude,longitude. In Google Maps, right-click (or long-press) the spot and the first line shown is the coordinates.

---

## Setup (one-off)

You'll type commands into a terminal in this folder. Claude Code can run them for you.

```bash
npm install                      # 1. install the tools
npx wrangler login               # 2. sign in to Cloudflare (opens your browser)
npx wrangler kv namespace create HUB
#                                  3. copy the id it prints into wrangler.toml,
#                                     replacing REPLACE_WITH_KV_NAMESPACE_ID
npm run make-token               # 4. run this three times to get three random strings:
                                 #    DASHBOARD_TOKEN, SHORTCUT_TOKEN and your NTFY_TOPIC name
```

5. Set your secrets. Run each line and paste the value when asked:

```bash
npx wrangler secret put DASHBOARD_TOKEN
npx wrangler secret put SHORTCUT_TOKEN
npx wrangler secret put NTFY_TOPIC
npx wrangler secret put BIN_ICS_URL
npx wrangler secret put HOME_LATLON      # e.g. 51.4501,0.2502
npx wrangler secret put WORK_LATLON
npx wrangler secret put TOMTOM_KEY
npx wrangler secret put TMDB_KEY
```

6. Deploy:

```bash
npm run deploy
```

It prints your hub's address, like `https://home-hub.<you>.workers.dev`. Save it as a secret too, so notification buttons link back correctly:

```bash
npx wrangler secret put PUBLIC_URL
```

7. **Phone:** open the ntfy app → **+** → type your NTFY_TOPIC name exactly → Subscribe. Allow notifications.

8. **Test it:** open `https://<your-hub>/api/test?token=<DASHBOARD_TOKEN>` in a browser. A notification should arrive within seconds. Then open `https://<your-hub>/api/run?token=<DASHBOARD_TOKEN>` to fill in all the data now; it shows `ok` or an error for each feature.

9. **Dashboard:** open `https://<your-hub>/d/<DASHBOARD_TOKEN>`. Bookmark it; that's the address the tablet will load.

Keep your tokens private. Anyone with the dashboard link can see the dashboard.

---

## Choosing your streaming services

Open `https://<your-hub>/api/providers?token=<DASHBOARD_TOKEN>` to see UK services and their numbers. In `wrangler.toml`, set `WATCH_PROVIDERS` to yours separated by `|`, e.g. `"8|9|337"`. Optionally set `WATCH_GENRES` the same way (TMDB genre ids: Action 28, Comedy 35, Crime 80, Drama 18, Sci-Fi 878, Thriller 53, Documentary 99). Then `npm run deploy`.

---

## iPhone Shortcuts for Dart Charge

**Do you need this at all?** If you set up a Dart Charge **pay-as-you-go** account with a card, it pays automatically at midnight the day after you cross, so you can't forget. A **pre-pay** account does the same and gives up to 20% off. If you do either, switch this module off (below) and skip this section.

Otherwise, in the **Shortcuts** app → **Automation** → **+**:

1. **Crossing logged:** trigger *Arrive* at work (or *CarPlay → Connects*). Set it to **Run Immediately**. Action: **Get Contents of URL**, URL `https://<your-hub>/crossed?token=<SHORTCUT_TOKEN>`, Method **POST**.
2. Make a second one for the drive home (trigger *Arrive* at home), with the same action.

The hub ignores double triggers within 20 minutes and crossings between 10pm and 6am (no charge then). To mark paid, tap **Mark paid** on the reminder, or make a shortcut that calls `/paid?token=<SHORTCUT_TOKEN>`.

---

## Fire tablet setup

1. Find the model: Settings → Device Options → Device Model.
2. Install **Fully Kiosk Browser** from the Amazon Appstore.
3. Set the start URL to your dashboard link (`/d/<DASHBOARD_TOKEN>`).
4. In Fully's settings: Web Content → *Autoplay/Reload on network reconnect* on; Device Management → *Keep screen on* on; *Screen orientation* landscape. Kiosk mode (locking the tablet to the page) needs the paid Fully Plus licence; it's optional.
5. The page dims itself at night. If you also want the backlight lower, Fully can schedule screen brightness.
6. **Battery:** Fire tablets left on charge 24/7 can swell. Put the charger on a smart plug that's on for about 2 hours in the morning and 2 in the evening, or use Fully's battery warnings.

---

## Switching features on and off

In `wrangler.toml`, edit:

```toml
MODULES = "bins,commute,dartcharge,f1,watch,weather,vehicles,energy,alexa"
```

Remove any you don't want, then `npm run deploy`. Other settings there: `COMMUTE_ALERT_MINUTES` (how much slower before you're alerted).

---

## Alexa (optional)

Alexa speaks reminders in the kitchen and hallway and starts two routines. It goes through **Voice Monkey**, a free Alexa skill (free plan: 5 speakers and 3 routine triggers; this uses 2 of each).

1. Sign up at https://voicemonkey.io, then enable the **Voice Monkey** skill in the Alexa app and link it.
2. In the Voice Monkey console, add two **Speaker** devices for the kitchen and hallway Dots. Name them `kitchen` and `hallway` (or change `ALEXA_SPEAKERS` in `wrangler.toml` to match).
3. Copy your API token from the console: `npx wrangler secret put VOICEMONKEY_TOKEN`.
4. Test: open `https://<your-hub>/api/alexa-test?token=<DASHBOARD_TOKEN>`. Both Dots should say "Home Hub is connected to Alexa."
5. **Bin-night lamp (optional):** in Voice Monkey add a **Routine Trigger** device called `bin-lamp`. In the Alexa app, make a Routine: *When this happens* → Smart Home → `bin-lamp`; action: turn your chosen bulb on, green (or a lamp's smart plug on). Set `ALEXA_TRIGGER_BINS = "bin-lamp"` in `wrangler.toml`.
6. **TV on for the race (optional):** add a Routine Trigger called `race-tv`, and a Routine that turns the living room TV on and switches to the Sky Stream's input (and dims a lamp if you like). Sky Stream has no Alexa control, so choose the channel with the Sky remote. Set `ALEXA_TRIGGER_RACE = "race-tv"`.
7. `npm run deploy`.

To change the quiet hours, edit `ALEXA_QUIET` (default `"21:00-07:00"`). Phone notifications still arrive during quiet hours. To switch Alexa off, remove `alexa` from `MODULES`.

---

## MOT and tax

1. Register for the **DVSA MOT History API**: https://documentation.history.mot.api.gov.uk/mot-history-api/register. You'll get an API key, a client ID, a client secret and a token URL by email.
2. Optional: the **DVLA Vehicle Enquiry Service** adds tax dates (https://developer-portal.driver-vehicle-licensing.api.gov.uk). Its registrations were closed in October 2026; without it you still get MOT dates, results and advisories.
3. Set the secrets:

```bash
npx wrangler secret put VEHICLES            # e.g. car:AB12CDE,bike:XY70ZZZ
npx wrangler secret put DVSA_API_KEY
npx wrangler secret put DVSA_CLIENT_ID
npx wrangler secret put DVSA_CLIENT_SECRET
npx wrangler secret put DVSA_TOKEN_URL
npx wrangler secret put DVLA_VES_KEY        # only if you have one
```

4. Open `/api/run?token=<DASHBOARD_TOKEN>` to read the vehicles now, then `/api/vehicles?token=<DASHBOARD_TOKEN>` to see what was found (including average miles a year, handy for insurance renewals). After that it checks every Sunday morning.

---

## Energy

Your smart meter's readings come through Hildebrand's free **Bright** app (EDF has no public way in). Do this first: it can take a few days before readings appear.

1. Install **Bright** on your phone, create an account and connect your smart meter. Wait until yesterday's usage shows in the app.
2. Set your Bright login as secrets:

```bash
npx wrangler secret put GLOW_USERNAME
npx wrangler secret put GLOW_PASSWORD
```

3. Optional, if the dashboard says "No cost data": add your EDF prices in pence from your bill.

```bash
npx wrangler secret put ELEC_UNIT_P        # e.g. 24.5
npx wrangler secret put ELEC_STANDING_P    # per day, e.g. 53.2
npx wrangler secret put GAS_UNIT_P
npx wrangler secret put GAS_STANDING_P
```

4. Open `/api/run?token=<DASHBOARD_TOKEN>` to read the last week now. After that it reads once a day after 10am.

---

## Day-to-day

- **Change a setting:** edit `wrangler.toml`, then `npm run deploy`.
- **Change a secret:** `npx wrangler secret put NAME`.
- **See what's happening:** `npx wrangler tail` streams the hub's logs live.
- **Run tests:** `npm test`.

## Costs

Everything here fits in free tiers (the add-ons too: Voice Monkey's free plan, the DVSA/DVLA APIs and Bright are free): Cloudflare Workers (100,000 requests/day; the hub uses about 150 scheduled runs a day plus dashboard refreshes), Cloudflare KV, ntfy, Open-Meteo, Jolpica-F1, TMDB and TomTom's free tier. The dashboard refreshes once a minute, so one tablet uses about 1,440 requests a day.

## Data sources and credits

Weather: Open-Meteo. F1: Jolpica-F1. MOT and tax: DVSA and DVLA. Energy: Hildebrand Glowmarkt (Bright). Alexa: Voice Monkey. Traffic: TomTom. Film and TV: TMDB ("This product uses the TMDB API but is not endorsed or certified by TMDB"). Notifications: ntfy. Unofficial; not associated with Formula 1.
