// @vitest-environment happy-dom
// Loads the real dashboard page in a fake browser, feeds it sample data and
// checks the right tiles appear. Also checks the script avoids modern syntax
// that older Fire tablet browsers can't run.

import { describe, expect, it, vi } from "vitest";
import { dashboardHtml } from "../src/dashboard";

const sample = {
  weather: {
    now: { temp: 13, text: "Rain", wind: 14 },
    today: { max: 14, min: 7, rainChance: 80, text: "Rain" },
    tomorrow: { max: 16, min: 9, rainChance: 20, text: "Partly cloudy" },
  },
  bins: { showTile: true, headline: "Bins out tonight", bins: ["Green", "Food"] },
  commute: {
    direction: "to work",
    status: "red",
    main: { minutes: 55, typicalMinutes: 35, delayMinutes: 20 },
    alt: { minutes: 44 },
  },
  dart: { count: 2, dueLabel: "tomorrow", overdue: false },
  f1: {
    next: { race: "Mexico City Grand Prix", session: "Qualifying", start: "2099-10-31T21:00:00Z", label: "Sat 21:00" },
    last: { top10: [{ code: "NOR" }, { code: "VER" }, { code: "LEC" }] },
  },
  watch: {
    movie: { id: 1, type: "movie", title: "Example Film", year: "2024", rating: 7.6, poster: null },
    tv: null,
  },
  vehicles: [{ label: "Bike", text: "MOT due Sat 14 Mar (5 days)", status: "amber", advisories: ["Tyres"] }],
  energy: {
    label: "Yesterday",
    total: "£4.82",
    split: "elec £3.10, gas £1.72",
    week: "This week £9.10 · last week £10.20 by this point",
    spark: [400, 410, null, 380, 390, 500, 470, 420, 430, 400, 410, 440, 450, 482],
    alert: "Something's been left on: overnight use 310 W, normally 220 W.",
    source: "Costs from the smart meter",
  },
};

function scriptOf(html: string): string {
  return html.split("<script>")[1].split("</script>")[0];
}

describe("dashboard page", () => {
  it("uses only old-browser-safe JavaScript", () => {
    const js = scriptOf(dashboardHtml("tok"));
    expect(js).not.toMatch(/=>/); // no arrow functions
    expect(js).not.toMatch(/\b(let|const)\s/); // no let/const
    expect(js).not.toMatch(/`/); // no template strings
    expect(js).not.toMatch(/\bfetch\(/); // XHR only
  });

  it("renders the tiles from the hub's data", async () => {
    const html = dashboardHtml("tok");
    document.body.innerHTML = html.split("<body>")[1].split("<script>")[0];

    // Fake XHR that answers /api/state with the sample data.
    class FakeXHR {
      readyState = 0; status = 0; responseText = ""; timeout = 0;
      onreadystatechange: (() => void) | null = null;
      url = "";
      open(_m: string, url: string) { this.url = url; }
      send() {
        this.readyState = 4; this.status = 200;
        this.responseText = JSON.stringify(sample);
        this.onreadystatechange?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    new Function(scriptOf(html))();

    const visible = (id: string) => !document.getElementById(id)!.className.includes("hidden");
    expect(visible("bins")).toBe(true);
    expect(document.getElementById("bins-v")!.textContent).toBe("Green + Food");
    expect(document.getElementById("dart-v")!.textContent).toBe("2 crossings to pay");
    expect(document.getElementById("commute")!.className).toContain("st-red");
    expect(document.getElementById("commute-v")!.textContent).toContain("55 min");
    expect(document.getElementById("commute-s")!.textContent).toContain("Alternative route 44 min");
    expect(document.getElementById("f1-v")!.textContent).toBe("Qualifying, Sat 21:00");
    expect(document.getElementById("f1-p")!.textContent).toBe("Last race: NOR, VER, LEC");
    expect(document.querySelectorAll("#watch-list .watch").length).toBe(1);
    expect(visible("tmdb")).toBe(true);
    expect(document.getElementById("clock")!.textContent).toMatch(/^\d\d:\d\d$/);
    expect(visible("veh")).toBe(true);
    expect(document.getElementById("veh")!.className).toContain("amber");
    expect(document.getElementById("veh-list")!.textContent).toContain("Bike: MOT due Sat 14 Mar (5 days)");
    expect(document.getElementById("veh-list")!.textContent).toContain("Last MOT advised: Tyres");
    expect(document.getElementById("energy-v")!.textContent).toBe("£4.82");
    expect(document.getElementById("energy")!.className).toContain("alert");
    expect(document.querySelectorAll("#energy-spark rect").length).toBe(13);
    vi.unstubAllGlobals();
  });
});
