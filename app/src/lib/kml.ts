/** Pull [lat, lng] points from the LineString(s) of a KML track (ruralgreece.gr route files). */
export function kmlToLatLngs(kml: string): [number, number][][] {
  const lines: [number, number][][] = [];
  const re = /<coordinates>([\s\S]*?)<\/coordinates>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kml))) {
    const pts = m[1]!
      .trim()
      .split(/\s+/)
      .map((t) => t.split(",").map(Number))
      .filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [p[1]!, Math.abs(p[0]!) <= 180 ? p[0]! : ((((p[0]! + 180) % 360) + 360) % 360) - 180] as [number, number]);
    if (pts.length > 1) lines.push(pts);
  }
  return lines;
}
