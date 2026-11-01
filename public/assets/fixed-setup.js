import { clamp, finite, requireValue } from "./lap-contract.js";

const ZONES = ["slow", "med", "high", "straight"];

function axis(value, low, neutral, high, below, above) {
  return value < neutral ? clamp((neutral - value) / Math.max(1e-9, neutral - low), 0, 1) * below
    : clamp((value - neutral) / Math.max(1e-9, high - neutral), 0, 1) * above;
}
function effects(value, cfg, pressure = false) {
  const [low, neutral, high] = pressure ? [cfg.min_psi, cfg.neutral_psi, cfg.max_psi] : [cfg.min_level, cfg.neutral_level, cfg.max_level];
  const keys = new Set([...Object.keys(cfg.min_effects), ...Object.keys(cfg.max_effects)]);
  return Object.fromEntries([...keys].map(key => [key, axis(value, low, neutral, high, cfg.min_effects[key] || 0, cfg.max_effects[key] || 0)]));
}

/** Physical setup deltas and the driver's balance/traction preferences. */
export function setupEffects(source, driver, aero, chassis) {
  const s = source.settings, cfg = source.setupDefinitions, wing = cfg.wing_levels;
  const front = s.front_wing - wing.neutral_level, rear = s.rear_wing - wing.neutral_level;
  const dim = wing.diminishing_returns || {}, d = Math.sqrt(front * front + rear * rear);
  const limits = [dim.min_efficiency || .7, dim.max_efficiency || 1].sort((a, b) => a - b);
  const efficiency = dim.enabled === false ? 1 : clamp(1 - (dim.coefficient ?? .025) * (d > 0 ? d ** (dim.exponent || 1.35) : 0), ...limits);
  const delta = Object.fromEntries(ZONES.map(key => [key, (wing.front_per_click_kmh[key] * front + wing.rear_per_click_kmh[key] * rear) * efficiency]));
  const ac = wing.aero_efficiency || {};
  if (delta.straight < 0 && ac.enabled !== false) {
    const neutral = clamp(ac.neutral_rating ?? 50, 1, 100);
    const limits = [ac.minimum_drag_penalty_multiplier ?? .5, ac.maximum_drag_penalty_multiplier ?? 1.5].sort((a, b) => a - b);
    delta.straight *= clamp(1 - Math.max(0, ac.drag_penalty_strength ?? .5) * ((aero - neutral) / neutral), ...limits);
  }
  const f = effects(s.front_pressure_psi, cfg.tyre_pressures.front, true), r = effects(s.rear_pressure_psi, cfg.tyre_pressures.rear, true);
  const pressure = Object.fromEntries([...new Set([...Object.keys(f), ...Object.keys(r)])].map(key => [key, (f[key] || 0) + (r[key] || 0)]));
  const suspension = effects(s.suspension_level, cfg.suspension_setup);
  const conceptKey = chassis.car_concept || source.definitions.car_concepts.default || "balanced";
  const concept = source.definitions.car_concepts.concepts[conceptKey];
  requireValue(concept, `Unsupported fitted car concept: ${conceptKey}.`);
  const wAxis = (value, below, above) => axis(value, wing.min_level, wing.neutral_level, wing.max_level, below, above);
  const su = cfg.suspension_setup;
  const pAxis = (value, config, below, above) => axis(value, config.min_psi, config.neutral_psi, config.max_psi, below, above);
  const balance = clamp(concept.balance + wAxis(s.front_wing, -30, 30) + wAxis(s.rear_wing, 20, -20)
    + axis(s.suspension_level, su.min_level, su.neutral_level, su.max_level, -20, 20), 0, 100);
  const traction = clamp(concept.traction + wAxis(s.rear_wing, -20, 20)
    + axis(s.suspension_level, su.min_level, su.neutral_level, su.max_level, 20, -20)
    + pAxis(s.front_pressure_psi, cfg.tyre_pressures.front, -10, 10) + pAxis(s.rear_pressure_psi, cfg.tyre_pressures.rear, 10, -10), 0, 100);
  const loss = Math.abs(balance - driver.preferences.balance_preference) * .015;
  for (const key of ZONES) delta[key] += (pressure[key] || 0) + (suspension[key] || 0) - (key === "straight" ? 0 : loss);
  return { delta, pressure, balance, traction };
}

/** Fresh tyres at equilibrium, using the same neutral supplier context as the desktop adapter. */
export function tyreGrip(source, compound, pressure, skill, protectedTemperature) {
  const water = source.weather.wetness_mm;
  const temperature = clamp(source.weather.temperature_c + (water > 1 ? 60 : 70) + (pressure.target_temp_delta_c || 0), 20, 180);
  let band = compound.wetness_states.find(b => water >= b.min_mm - 1e-9 && water <= b.max_mm + 1e-9);
  if (!band) band = compound.wetness_states.reduce((best, next) => {
    const distance = b => Math.max(b.min_mm - water, water - b.max_mm, 0);
    return distance(next) < distance(best) ? next : best;
  });
  const shift = skill < 10 ? (skill - 10) * (5 / 9) : (skill - 10) * .5;
  let [low, high] = compound.temp_window_c; low -= shift; high += shift;
  if (high < low) low = high = (low + high) * .5;
  const thermal = protectedTemperature ? 1 : Math.max(.8, 1 - .00005 * Math.max(0, low - temperature) - .00025 * Math.max(0, temperature - high));
  return { temperature_c: temperature, lateral: clamp(finite(compound.lat_grip_base * band.lat_mult * thermal, "tyre lateral grip"), .35, 1.25),
    longitudinal: clamp(finite(compound.long_grip_base * band.long_mult * thermal, "tyre longitudinal grip"), .3, 1.25), band: band.name };
}
