/** Fill the gaps so the bar chart shows every day in the window, including days with no visits. */
export function fillDays(rows: { day: string; visits: number }[], days: number, today = new Date()): { day: string; visits: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.visits]));
  const out: { day: string; visits: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, visits: byDay.get(key) ?? 0 });
  }
  return out;
}
