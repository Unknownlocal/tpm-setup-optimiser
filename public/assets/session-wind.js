import { clamp, finite, requireValue } from "./lap-contract.js";
import { PythonRandom } from "./python-random.js";

/** Initial practice wind: seeded weather, sampled against the local track outline. */
export async function initialWind(source, seed) {
  const cfg = source.definitions.config.wind || {};
  if (source.sessionOptions.wind_enabled === false || (source.sessionOptions.wind_enabled !== true && cfg.enabled === false)) return { field: null, speed_kmh: 0, direction_deg: 0 };
  const max = clamp(cfg.maximum_speed_kmh ?? 50, 0, 80);
  const range = cfg.starting_speed_kmh || [5, 20];
  requireValue(Array.isArray(range) && range.length === 2, "Wind starting speed needs two values.");
  const bounds = range.map(value => clamp(finite(value, "wind starting speed"), 0, max)).sort((a, b) => a - b);
  const phase = source.testing ? "preseason_testing" : "practice";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`wind-v1:${seed}:${source.trackId}:${phase}:0`)));
  let windSeed = 0n; for (const byte of bytes.slice(0, 8)) windSeed = (windSeed << 8n) | BigInt(byte);
  const random = new PythonRandom(windSeed), speed = random.uniform(...bounds), direction = random.uniform(0, 360);
  const wx = speed / 3.6 * Math.sin(direction * Math.PI / 180), wy = -speed / 3.6 * Math.cos(direction * Math.PI / 180);
  const points = [];
  requireValue(Array.isArray(source.track.points) && source.track.points.length <= 100000, "Track outline is missing or too large for wind calculation.");
  for (const point of source.track.points) {
    requireValue(Array.isArray(point) && point.length >= 2, "Invalid track outline point.");
    const pair = point.slice(0, 2).map(value => finite(value, "track outline coordinate"));
    if (!points.length || pair.some((value, axis) => value !== points.at(-1)[axis])) points.push(pair);
  }
  if (points.length && points[0].some((value, axis) => value !== points.at(-1)[axis])) points.push(points[0]);
  const edges = []; let distance = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0], dy = points[i][1] - points[i - 1][1], length = Math.hypot(dx, dy);
    if (length > 0) { distance += length; edges.push({ end: distance, tangent: [dx / length, dy / length] }); }
  }
  if (edges.length < 2) return { field: null, speed_kmh: speed, direction_deg: direction };
  for (const edge of edges) edge.end /= distance;
  function tangent(progress) {
    const p = ((progress % 1) + 1) % 1;
    let low = 0, high = edges.length;
    while (low < high) { const mid = (low + high) >>> 1; if (edges[mid].end <= p) low = mid + 1; else high = mid; }
    return edges[Math.min(low, edges.length - 1)].tangent;
  }
  const field = { sectors: [], sources: [], losses: [], tails: [], brake_cap: clamp(cfg.braking_change_cap ?? .02, 0, .05) };
  const total = source.track.micro_sectors.reduce((sum, sector) => sum + sector.length_pct, 0);
  const reference = clamp(cfg.crosswind_reference_kmh ?? 30, 1, 100), lossCap = clamp(cfg.crosswind_corner_loss ?? .02, 0, .05);
  let cursor = 0;
  for (const [index, sector] of source.track.micro_sectors.entries()) {
    const length = sector.length_pct / total;
    const samples = [.125, .375, .625, .875].map(p => tangent(cursor + length * p));
    const bent = samples.slice(1).some((v, i) => v[0] * samples[i][0] + v[1] * samples[i][1] < .5);
    const count = bent ? 4 : 1;
    for (let i = 0; i < count; i++) {
      const [tx, ty] = tangent(cursor + length * (i + .5) / count), cross = -wx * ty + wy * tx;
      field.sectors.push({ ...sector, length_pct: sector.length_pct * (100 / total) / count }); field.sources.push(index);
      field.tails.push(wx * tx + wy * ty);
      field.losses.push(Math.min(lossCap, lossCap * (cross * 3.6 / reference) ** 2) * ({ low: .25, med: .6, high: 1, corner: .6 }[sector.type] || 0));
    }
    cursor += length;
  }
  return { field, speed_kmh: speed, direction_deg: direction };
}
