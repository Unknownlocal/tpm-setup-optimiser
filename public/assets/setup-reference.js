import { requireValue } from "./lap-contract.js";

const range = (low, high, step = 1) => Array.from({ length: Math.max(0, Math.floor((high - low) / step) + 1) }, (_, i) => low + i * step);
const unique = values => [...new Set(values)].sort((a, b) => a - b);

/** Reproduce the game's staged guidance, rather than finding a new optimum.
 * Each stage keeps its earlier winner on ties and holds the other settings fixed. */
export async function solveReference(scenario, driver, compound, signal) {
  const cfg = scenario.source.setupDefinitions, wing = cfg.wing_levels, suspension = cfg.suspension_setup;
  const front = cfg.tyre_pressures.front, rear = cfg.tyre_pressures.rear;
  requireValue([wing, suspension].every(axis => [axis.min_level, axis.max_level, axis.neutral_level].every(Number.isInteger)
    && axis.min_level <= axis.neutral_level && axis.neutral_level <= axis.max_level && axis.max_level - axis.min_level <= 50),
  "Reference guidance needs whole-number wing/suspension ranges of at most 51 settings, with neutral inside the range.");
  // Integer tenths keep the game's 0.1 psi grids stable across both runtimes.
  const tick = value => Math.round(value * 10);
  requireValue([front, rear].every(axis => [axis.min_psi, axis.max_psi, axis.neutral_psi]
    .every(value => Number.isFinite(value) && Math.abs(value * 10 - tick(value)) < 1e-8)
    && axis.min_psi <= axis.neutral_psi && axis.neutral_psi <= axis.max_psi && axis.max_psi - axis.min_psi <= 20),
  "Reference guidance needs pressure bounds in tenths of a psi, spanning at most 20 psi, with neutral inside the range.");
  const neutral = { front_wing: wing.neutral_level, rear_wing: wing.neutral_level, suspension_level: suspension.neutral_level,
    front_pressure_psi: front.neutral_psi, rear_pressure_psi: rear.neutral_psi };
  const cache = new Map();
  const key = settings => [settings.front_wing, settings.rear_wing, settings.suspension_level, tick(settings.front_pressure_psi), tick(settings.rear_pressure_psi)].join(",");
  async function evaluate(settings) {
    signal?.throwIfAborted();
    // Each grid has unique settings; the cache removes overlap between stages.
    const pending = settings.filter(value => !cache.has(key(value))).map(value => scenario.row(driver, compound, value));
    for (let i = 0; i < pending.length; i += 32) {
      const batch = pending.slice(i, i + 32);
      await scenario.laps(batch, signal);
      for (const row of batch) cache.set(key(row.settings), row);
    }
    return settings.map(value => cache.get(key(value)));
  }
  async function best(settings, incumbent = null) {
    for (const row of await evaluate(settings)) if (!incumbent || row.lap_time_s < incumbent.lap_time_s) incumbent = row;
    return incumbent;
  }
  function wingPairs(fronts, rears) { return fronts.flatMap(f => rears.map(r => ({ ...neutral, front_wing: f, rear_wing: r }))); }
  const coarse = unique([...range(wing.min_level, wing.max_level, 3), wing.min_level, wing.max_level, wing.neutral_level]);
  let wings = await best(wingPairs(coarse, coarse));
  wings = await best(wingPairs(range(Math.max(wing.min_level, wings.settings.front_wing - 2), Math.min(wing.max_level, wings.settings.front_wing + 2)),
    range(Math.max(wing.min_level, wings.settings.rear_wing - 2), Math.min(wing.max_level, wings.settings.rear_wing + 2))), wings);
  const suspended = await best(range(suspension.min_level, suspension.max_level).map(level => ({ ...wings.settings, suspension_level: level })));
  const coarseFront = unique([...range(tick(front.min_psi), tick(front.max_psi), 10), tick(front.max_psi), tick(front.neutral_psi)]);
  const coarseRear = unique([...range(tick(rear.min_psi), tick(rear.max_psi), 5), tick(rear.max_psi), tick(rear.neutral_psi)]);
  const pressures = (fronts, rears) => fronts.flatMap(f => rears.map(r => ({ ...suspended.settings, front_pressure_psi: f / 10, rear_pressure_psi: r / 10 })));
  let pressure = await best(pressures(coarseFront, coarseRear));
  pressure = await best(pressures(range(Math.max(tick(front.min_psi), tick(pressure.settings.front_pressure_psi) - 5), Math.min(tick(front.max_psi), tick(pressure.settings.front_pressure_psi) + 5)),
    range(Math.max(tick(rear.min_psi), tick(pressure.settings.rear_pressure_psi) - 5), Math.min(tick(rear.max_psi), tick(pressure.settings.rear_pressure_psi) + 5))), pressure);
  return { settings: pressure.settings, lap_time_s: pressure.lap_time_s, evaluated: cache.size };
}
