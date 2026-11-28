import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseKml, simplify, trackFromFile, unzipKml } from "../src/kml.js";
import { SAMPLE_KML } from "./fixtures/kml.js";


/** A one-file zip, as Google Earth writes a KMZ. */
function kmz(name: string, body: string): Buffer {
  const data = deflateRawSync(Buffer.from(body));
  const n = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt16LE(n.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(data.length, 20);
  cd.writeUInt16LE(n.length, 28);
  cd.writeUInt32LE(0, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cd.length + n.length, 12);
  eocd.writeUInt32LE(local.length + n.length + data.length, 16);
  return Buffer.concat([local, n, data, cd, n, eocd]);
}

describe("route KML", () => {
  it("reads lines as [lat, lng] and named points as stops", () => {
    const t = parseKml(SAMPLE_KML);
    expect(t.lines).toHaveLength(1);
    expect(t.lines[0]![0]).toEqual([41.0371, 22.5756]);
    expect(t.stops).toEqual([{ name: "Πηγή & βρύση", lat: 41.0362, lng: 22.575 }]);
  });

  it("unwraps longitudes past 180 and reads gx:Track", () => {
    const wrapped = `<kml><Placemark><LineString><coordinates>382.54,40.98 382.55,40.99</coordinates></LineString></Placemark>
      <Placemark><gx:Track><gx:coord>22.1 38.1 100</gx:coord><gx:coord>22.2 38.2 110</gx:coord></gx:Track></Placemark></kml>`;
    const t = parseKml(wrapped);
    expect(t.lines[0]![0]![1]).toBeCloseTo(22.54, 6);
    expect(t.lines[1]).toEqual([[38.1, 22.1], [38.2, 22.2]]);
  });

  it("drops points that sit on a straight line", () => {
    const straight: [number, number][] = Array.from({ length: 50 }, (_, i) => [41 + i * 0.0001, 22]);
    expect(simplify(straight, 8)).toEqual([straight[0], straight[49]]);
    const bend: [number, number][] = [[41, 22], [41.001, 22.001], [41, 22.002]];
    expect(simplify(bend, 8)).toHaveLength(3);
  });

  it("opens KMZ files uploaded as .kml", () => {
    const buf = kmz("doc.kml", SAMPLE_KML);
    expect(unzipKml(buf)).toBe(SAMPLE_KML);
    expect(trackFromFile(buf).stops).toHaveLength(1);
  });

  it("keeps big tracks under the point budget", () => {
    const coords = Array.from({ length: 20000 }, (_, i) => `${22 + Math.sin(i / 7) * 0.01 + i * 0.00001},${41 + Math.cos(i / 5) * 0.01}`).join(" ");
    const t = trackFromFile(Buffer.from(`<kml><Placemark><LineString><coordinates>${coords}</coordinates></LineString></Placemark></kml>`));
    expect(t.lines[0]!.length).toBeLessThanOrEqual(1500);
  });
});
