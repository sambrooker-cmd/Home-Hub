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

The dashboard dims to just a clock from 10pm to 6:30am.

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
MODULES = "bins,commute,dartcharge,f1,watch,weather"
```

Remove any you don't want, then `npm run deploy`. Other settings there: `COMMUTE_ALERT_MINUTES` (how much slower before you're alerted).

---

## Day-to-day

- **Change a setting:** edit `wrangler.toml`, then `npm run deploy`.
- **Change a secret:** `npx wrangler secret put NAME`.
- **See what's happening:** `npx wrangler tail` streams the hub's logs live.
- **Run tests:** `npm test`.

## Costs

Everything here fits in free tiers: Cloudflare Workers (100,000 requests/day; the hub uses about 150 scheduled runs a day plus dashboard refreshes), Cloudflare KV, ntfy, Open-Meteo, Jolpica-F1, TMDB and TomTom's free tier. The dashboard refreshes once a minute, so one tablet uses about 1,440 requests a day.

## Data sources and credits

Weather: Open-Meteo. F1: Jolpica-F1. Traffic: TomTom. Film and TV: TMDB ("This product uses the TMDB API but is not endorsed or certified by TMDB"). Notifications: ntfy. Unofficial; not associated with Formula 1.
