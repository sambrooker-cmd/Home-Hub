// The wall dashboard page. Deliberately old-fashioned: plain HTML, CSS with
// flexbox, and ES5 JavaScript (var, XMLHttpRequest, no arrow functions) so it
// runs on old Amazon Fire tablet browsers inside Fully Kiosk Browser.

export function dashboardHtml(token: string): string {
  const t = JSON.stringify(token);
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Home Hub</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    background: #0c0e11; color: #f1ede4;
    font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    overflow: hidden; -webkit-font-smoothing: antialiased;
  }
  .wrap { display: -webkit-box; display: -webkit-flex; display: flex; height: 100%; padding: 2.2vh 2vw; }
  .left { -webkit-flex: 0 0 38%; flex: 0 0 38%; display: -webkit-flex; display: flex;
          -webkit-flex-direction: column; flex-direction: column; padding-right: 2vw; }
  .right { -webkit-flex: 1 1 auto; flex: 1 1 auto; display: -webkit-flex; display: flex;
           -webkit-flex-direction: column; flex-direction: column; min-width: 0; }

  .clock { font-size: 17vh; font-weight: 300; line-height: 1; letter-spacing: -0.02em; }
  .date { font-size: 4.2vh; color: #a9a397; margin-top: 1vh; }
  .weather { margin-top: auto; }
  .w-now { font-size: 9vh; font-weight: 300; line-height: 1; }
  .w-now small { font-size: 3.6vh; color: #a9a397; margin-left: 1vw; vertical-align: middle; }
  .w-days { display: -webkit-flex; display: flex; margin-top: 2vh; }
  .w-day { margin-right: 3vw; font-size: 3vh; color: #cfc9bd; }
  .w-day b { display: block; font-size: 2.2vh; color: #7d786e; font-weight: 600;
             letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 0.4vh; }
  .nextbins { margin-top: 2.4vh; font-size: 2.6vh; color: #7d786e; }

  .tile { border-radius: 1.4vh; padding: 2vh 1.8vw; margin-bottom: 1.6vh; background: #161a1f;
          border-left: 0.8vh solid #2a3038; }
  .tile .k { font-size: 2.1vh; letter-spacing: 0.1em; text-transform: uppercase; color: #8d877c; font-weight: 600; }
  .tile .v { font-size: 4.6vh; font-weight: 500; margin-top: 0.6vh; line-height: 1.15; }
  .tile .s { font-size: 2.6vh; color: #b7b1a5; margin-top: 0.6vh; }
  .hidden { display: none !important; }

  .t-bins { border-color: #4caf6a; background: #14211a; }
  .t-dart { border-color: #f0a500; background: #241d0d; }
  .t-dart.overdue { border-color: #e5484d; background: #2a1314; }
  .st-green { border-color: #4caf6a; }
  .st-amber { border-color: #f0a500; }
  .st-red { border-color: #e5484d; background: #2a1314; }
  .t-f1 { border-color: #d6453a; }
  .t-watch { border-color: #5b8def; }
  .t-energy { border-color: #4caf6a; margin-top: 2.4vh; margin-bottom: 0; }
  .t-energy.alert { border-color: #f0a500; background: #241d0d; }
  .t-veh { border-color: #2a3038; }
  .t-veh.amber { border-color: #f0a500; }
  .t-veh.red { border-color: #e5484d; background: #2a1314; }
  .veh-line { font-size: 3vh; font-weight: 500; margin-top: 0.6vh; }
  .veh-line.red { color: #ff9b9e; }
  .veh-line.amber { color: #f0c766; }
  .veh-sub { font-size: 2.2vh; color: #b7b1a5; }
  .spark { display: block; width: 100%; height: 4.5vh; margin-top: 1vh; }
  .e-alert { font-size: 2.3vh; color: #f0c766; margin-top: 0.6vh; }

  .row { display: -webkit-flex; display: flex; }
  .half { -webkit-flex: 1 1 0; flex: 1 1 0; min-width: 0; }
  .half + .half { margin-left: 1.6vh; }
  .watch { display: -webkit-flex; display: flex; margin-top: 1vh; }
  .watch img { width: 9vh; height: 13.5vh; border-radius: 0.6vh; margin-right: 1.2vw; background: #222; object-fit: cover; }
  .watch .wt { font-size: 3vh; font-weight: 600; line-height: 1.15; }
  .watch .wm { font-size: 2.2vh; color: #a9a397; margin-top: 0.4vh; }
  .btn { display: inline-block; margin-top: 1vh; margin-right: 0.6vw; padding: 0.8vh 1.2vw; font-size: 2vh;
         border: 1px solid #39404a; border-radius: 0.8vh; color: #cfc9bd; background: transparent; }
  .podium { font-size: 2.6vh; color: #cfc9bd; margin-top: 0.6vh; }
  .tmdb { font-size: 1.5vh; color: #5d5950; margin-top: auto; padding-top: 0.6vh; }
  .stale { font-size: 1.8vh; color: #e5484d; }

  /* Night mode: clock only, very dim. */
  body.night .right, body.night .weather, body.night .nextbins, body.night .t-energy { display: none !important; }
  body.night .left { -webkit-flex: 1 1 auto; flex: 1 1 auto; -webkit-justify-content: center; justify-content: center;
                     -webkit-align-items: center; align-items: center; padding: 0; }
  body.night .clock { color: #3a3631; font-size: 26vh; }
  body.night .date { color: #2a2723; }
</style>
</head>
<body>
<div class="wrap">
  <div class="left">
    <div class="clock" id="clock">--:--</div>
    <div class="date" id="date"></div>
    <div class="tile t-energy hidden" id="energy"><div class="k" id="energy-k">Energy</div>
      <div class="v" id="energy-v"></div><div class="s" id="energy-s"></div><div class="s" id="energy-w"></div>
      <div id="energy-spark"></div><div class="e-alert hidden" id="energy-a"></div></div>
    <div class="weather hidden" id="weather">
      <div class="w-now" id="w-now"></div>
      <div class="w-days">
        <div class="w-day" id="w-today"></div>
        <div class="w-day" id="w-tomorrow"></div>
      </div>
    </div>
    <div class="nextbins hidden" id="nextbins"></div>
  </div>

  <div class="right">
    <div class="tile t-bins hidden" id="bins"><div class="k" id="bins-k">Bins</div><div class="v" id="bins-v"></div></div>
    <div class="tile t-dart hidden" id="dart"><div class="k">Dart Charge</div><div class="v" id="dart-v"></div>
      <div class="s" id="dart-s"></div></div>
    <div class="tile hidden" id="commute"><div class="k" id="commute-k">Commute</div><div class="v" id="commute-v"></div>
      <div class="s" id="commute-s"></div></div>
    <div class="tile t-veh hidden" id="veh"><div class="k">MOT and tax</div><div id="veh-list"></div></div>
    <div class="row">
      <div class="tile t-f1 half hidden" id="f1"><div class="k">F1</div><div class="v" id="f1-v"></div>
        <div class="s" id="f1-s"></div><div class="podium" id="f1-p"></div></div>
      <div class="tile t-watch half hidden" id="watch"><div class="k">Tonight</div><div id="watch-list"></div></div>
    </div>
    <div class="tmdb hidden" id="tmdb">Film and TV data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</div>
    <div class="stale hidden" id="stale">Can't reach the hub, showing the last data.</div>
  </div>
</div>

<script>
(function () {
  var TOKEN = ${t};
  var state = null;
  var f1Start = null;

  function $(id) { return document.getElementById(id); }
  function show(id, on) {
    var el = $(id);
    if (!el) return;
    var c = el.className.replace(/\\s*hidden/g, "");
    el.className = on ? c : c + " hidden";
  }
  function text(id, s) { $(id).textContent = s == null ? "" : s; }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  // UK time without relying on the tablet's own timezone setting.
  function ukNow() {
    var d = new Date();
    try {
      var parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false,
        weekday: "long", day: "numeric", month: "long"
      }).formatToParts(d);
      var o = {};
      for (var i = 0; i < parts.length; i++) o[parts[i].type] = parts[i].value;
      return { h: parseInt(o.hour, 10) % 24, m: parseInt(o.minute, 10), date: o.weekday + " " + o.day + " " + o.month };
    } catch (e) {
      var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      return { h: d.getHours(), m: d.getMinutes(), date: days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()] };
    }
  }

  function tickClock() {
    var n = ukNow();
    text("clock", pad(n.h) + ":" + pad(n.m));
    text("date", n.date);
    var mins = n.h * 60 + n.m;
    var night = mins >= 22 * 60 || mins < 6 * 60 + 30;
    document.body.className = night ? "night" : "";
    if (f1Start) {
      var diff = Math.round((f1Start - Date.now()) / 60000);
      if (diff > 0 && diff < 72 * 60) {
        var h = Math.floor(diff / 60), m = diff % 60;
        text("f1-s", "In " + (h ? h + "h " : "") + m + "m");
      }
    }
  }

  function render(s) {
    // Weather
    if (s.weather) {
      var w = s.weather;
      $("w-now").innerHTML = w.now.temp + "&deg;<small>" + w.now.text + " &middot; " + w.now.wind + " mph</small>";
      $("w-today").innerHTML = "<b>Today</b>" + w.today.max + "&deg; / " + w.today.min + "&deg; &middot; " + w.today.rainChance + "% rain";
      $("w-tomorrow").innerHTML = "<b>Tomorrow</b>" + w.tomorrow.max + "&deg; / " + w.tomorrow.min + "&deg; &middot; " + w.tomorrow.text;
    }
    show("weather", !!s.weather);

    // Bins
    var b = s.bins;
    show("bins", !!(b && b.showTile));
    if (b && b.showTile) { text("bins-k", b.headline); text("bins-v", b.bins.join(" + ")); }
    show("nextbins", !!(b && b.nextLine));
    if (b && b.nextLine) text("nextbins", b.nextLine);

    // Dart Charge
    var d = s.dart;
    show("dart", !!(d && d.count));
    if (d && d.count) {
      text("dart-v", d.count + " crossing" + (d.count > 1 ? "s" : "") + " to pay");
      text("dart-s", d.overdue ? "Overdue: pay now" : "Pay by midnight " + d.dueLabel);
      $("dart").className = "tile t-dart" + (d.overdue ? " overdue" : "");
    }

    // Commute: only shown in the morning and evening windows
    var c = s.commute;
    show("commute", !!c);
    if (c) {
      $("commute").className = "tile st-" + c.status;
      text("commute-k", c.direction === "home" ? "Drive home" : "Drive to work");
      var delay = c.main.delayMinutes;
      text("commute-v", c.main.minutes + " min" + (delay >= 2 ? "  (+" + delay + ")" : ""));
      var sub = c.main.typicalMinutes ? "Usually " + c.main.typicalMinutes + " min" : "";
      if (c.alt && c.alt.minutes < c.main.minutes) sub += (sub ? " · " : "") + "Alternative route " + c.alt.minutes + " min";
      text("commute-s", sub);
    }

    // MOT and tax: only when something is due soon or a new result came in
    var vl = s.vehicles;
    if (vl && vl.length) renderVehicles(vl);
    show("veh", !!(vl && vl.length));

    // Energy: yesterday's cost, this week so far, 14-day bars
    var e = s.energy;
    show("energy", !!e);
    if (e) {
      text("energy-k", "Energy · " + e.label);
      text("energy-v", e.total);
      text("energy-s", e.split);
      text("energy-w", e.week || "");
      $("energy-spark").innerHTML = sparkSvg(e.spark || []);
      text("energy-a", e.alert || "");
      show("energy-a", !!e.alert);
      $("energy").className = "tile t-energy" + (e.alert ? " alert" : "");
    }

    // F1
    var f = s.f1;
    show("f1", !!(f && (f.next || f.last)));
    f1Start = null;
    if (f && f.next) {
      text("f1-v", f.next.session + ", " + f.next.label);
      text("f1-s", f.next.race);
      f1Start = new Date(f.next.start).getTime();
    } else if (f) { text("f1-v", "Season finished"); text("f1-s", ""); }
    if (f && f.last && f.last.top10 && f.last.top10.length) {
      var p = f.last.top10;
      text("f1-p", "Last race: " + p[0].code + ", " + (p[1] ? p[1].code : "") + ", " + (p[2] ? p[2].code : ""));
    } else text("f1-p", "");

    // What to Watch
    var wp = s.watch;
    var list = $("watch-list");
    list.innerHTML = "";
    var items = wp ? [wp.movie, wp.tv] : [];
    var any = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      any = true;
      var row = document.createElement("div");
      row.className = "watch";
      var img = it.poster ? '<img src="' + it.poster + '" alt="">' : "";
      row.innerHTML = img + '<div><div class="wt"></div><div class="wm"></div>' +
        '<span class="btn" data-a="seen">Seen it</span><span class="btn" data-a="nope">Not for me</span></div>';
      row.querySelector(".wt").textContent = it.title;
      row.querySelector(".wm").textContent = (it.type === "tv" ? "Series" : "Film") + " · " + it.year + " · " + it.rating + "/10";
      wire(row, it);
      list.appendChild(row);
    }
    show("watch", any);
    show("tmdb", any);
  }

  // 14 daily bars as inline SVG (oldest first); missing days are left as gaps.
  function sparkSvg(vals) {
    var max = 0, i;
    for (i = 0; i < vals.length; i++) if (vals[i] !== null && vals[i] > max) max = vals[i];
    if (!max) return "";
    var out = '<svg class="spark" viewBox="0 0 140 30" preserveAspectRatio="none" aria-hidden="true">';
    for (i = 0; i < vals.length; i++) {
      if (vals[i] === null) continue;
      var h = Math.max(1, Math.round((vals[i] / max) * 28));
      var last = i === vals.length - 1;
      out += '<rect x="' + (i * 10 + 1) + '" y="' + (30 - h) + '" width="8" height="' + h + '" rx="1" fill="' + (last ? "#4caf6a" : "#3a4a3f") + '"></rect>';
    }
    return out + "</svg>";
  }

  function renderVehicles(lines) {
    var list = $("veh-list");
    list.innerHTML = "";
    var worst = "";
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var row = document.createElement("div");
      row.className = "veh-line" + (l.status === "ok" ? "" : " " + l.status);
      row.textContent = l.label + ": " + l.text;
      list.appendChild(row);
      if (l.advisories && l.advisories.length) {
        var sub = document.createElement("div");
        sub.className = "veh-sub";
        sub.textContent = "Last MOT advised: " + l.advisories.join(", ");
        list.appendChild(sub);
      }
      if (l.status === "red" || (l.status === "amber" && worst !== "red")) worst = l.status;
    }
    $("veh").className = "tile t-veh" + (worst ? " " + worst : "");
  }

  function wire(row, it) {
    var btns = row.querySelectorAll(".btn");
    for (var j = 0; j < btns.length; j++) {
      btns[j].onclick = function () {
        this.textContent = "...";
        post("/api/watch/feedback?token=" + encodeURIComponent(TOKEN) + "&type=" + it.type + "&id=" + it.id, load);
      };
    }
  }

  function request(method, url, done) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.timeout = 15000;
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status === 200) {
        show("stale", false);
        try { done(JSON.parse(x.responseText)); } catch (e) {}
      } else show("stale", true);
    };
    x.send();
  }
  function post(url, done) { request("POST", url, function () { done(); }); }

  function load() {
    request("GET", "/api/state?token=" + encodeURIComponent(TOKEN), function (s) { state = s; render(s); });
  }

  tickClock();
  load();
  setInterval(tickClock, 10000);
  setInterval(load, 60000);
  // Full reload every 4 hours keeps old tablet browsers healthy.
  setTimeout(function () { location.reload(); }, 4 * 3600 * 1000);
})();
</script>
</body>
</html>`;
}
