import { test } from "node:test";
import assert from "node:assert/strict";
import { kmlToLatLngs } from "../src/lib/kml.ts";
import { htmlToParagraphs } from "../src/lib/html.ts";
import { describeOutcome } from "../src/lib/outcome.ts";
import { fillDays } from "../src/lib/days.ts";

test("kml: lng,lat[,alt] becomes [lat, lng], one line per LineString", () => {
  const kml = `<kml><Placemark><LineString><coordinates>
    22.1,39.5,100 22.2,39.6,110
  </coordinates></LineString></Placemark><Point><coordinates>22.3,39.7</coordinates></Point></kml>`;
  assert.deepEqual(kmlToLatLngs(kml), [[[39.5, 22.1], [39.6, 22.2]]]);
});

test("html: paragraphs, line breaks and entities", () => {
  assert.deepEqual(htmlToParagraphs("<p>Καλώς <b>ήρθατε</b>&nbsp;!</p><p>A &amp; B<br>C</p>"), ["Καλώς ήρθατε !", "A & B\nC"]);
  assert.deepEqual(htmlToParagraphs(null), []);
});

test("outcome: sums visitor points and lists derived events", () => {
  const r = describeOutcome([
    { event_id: "e1", type: "checkin.qr", status: "verified", points: [{ owner_type: "visitor", owner_id: "v", points: 10 }, { owner_type: "member", owner_id: "m", points: 5 }] },
    { event_id: "e2", type: "route.completed", status: "verified", points: [{ owner_type: "visitor", owner_id: "v", points: 30 }] },
  ] as never);
  assert.deepEqual(r, { kind: "ok", points: 40, extra: ["route.completed"] });
  assert.deepEqual(describeOutcome(null), { kind: "queued" });
  assert.deepEqual(describeOutcome([{ status: "duplicate", points: [] }] as never), { kind: "duplicate" });
});

test("days: fills missing days with zero", () => {
  const out = fillDays([{ day: "2026-11-26", visits: 3 }], 3, new Date("2026-11-27T10:00:00Z"));
  assert.deepEqual(out, [
    { day: "2026-11-25", visits: 0 },
    { day: "2026-11-26", visits: 3 },
    { day: "2026-11-27", visits: 0 },
  ]);
});
