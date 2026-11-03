import { requireValue } from "./lap-contract.js";
import { loadEngine } from "./lap-physics.js";

/** C# owns guidance grids and winner selection. The worker reuses completed laps
 * and yields between batches so cancellation stays responsive. */
export async function solveReference(scenario, driver, compound, signal) {
  signal?.throwIfAborted();
  const engine = await loadEngine(), bounds = Array.from(engine.ReferenceBounds(JSON.stringify(scenario.source.setupDefinitions)));
  const cache = new Map(), keys = ["front_wing", "rear_wing", "front_pressure_psi", "rear_pressure_psi", "suspension_level"];
  const values = settings => keys.map(key => settings[key]);
  const key = settings => [settings.front_wing, settings.rear_wing, settings.suspension_level, Math.round(settings.front_pressure_psi * 10), Math.round(settings.rear_pressure_psi * 10)].join(",");
  let best = null;
  for (let stage = 0; stage < 5; stage++) {
    signal?.throwIfAborted();
    // The first value says whether to retain the earlier winner; the rest are setup rows.
    const packet = Array.from(engine.ReferencePlan(bounds, stage, best ? values(best.settings) : []));
    requireValue(packet.length > 1 && (packet.length - 1) % 5 === 0 && packet.every(Number.isFinite), "Invalid reference guidance response.");
    const settings = [];
    for (let i = 1; i < packet.length; i += 5) settings.push(Object.fromEntries(keys.map((key, j) => [key, packet[i + j]])));
    // Stages overlap. Reuse completed rows and count only settings that needed a physical lap.
    const pending = settings.filter(settings => !cache.has(key(settings))).map(settings => scenario.row(driver, compound, settings));
    for (let i = 0; i < pending.length; i += 32) {
      const batch = pending.slice(i, i + 32);
      await scenario.laps(batch, signal);
      for (const row of batch) cache.set(key(row.settings), row);
    }
    const rows = settings.map(settings => cache.get(key(settings)));
    const winner = engine.ReferenceWinner(rows.map(row => row.lap_time_s), packet[0] && best ? best.lap_time_s : 0);
    requireValue(winner === -1 && best || Number.isInteger(winner) && winner >= 0 && winner < rows.length, "Invalid reference winner response.");
    // A -1 result keeps the earlier winner, including when the new grid only ties it.
    if (winner !== -1) best = rows[winner];
  }
  return { settings: best.settings, lap_time_s: best.lap_time_s, evaluated: cache.size };
}
