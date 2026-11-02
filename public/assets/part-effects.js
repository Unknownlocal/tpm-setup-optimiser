import { clamp, finite } from "./lap-contract.js";

export const ZONES = ["slow", "med", "high", "straight"];
export const CAR_RATINGS = [...ZONES, "team_pace", "acceleration", "braking", "tyre_management", "aero_efficiency_rating"];
const ALIASES = { tyre_wear: "tyre_management", reliability: "chassis_reliability", dirty_air: "dirty_air_sensitivity" };
const LEGACY = ["team_pace", "acceleration", "braking", "tyre_management", "tyre_wear", "reliability", "dirty_air", "car_mass_kg"];
export const hasEffects = map => map && Object.keys(map).length > 0;
export const effectNumber = value => finite(value || 0, "Saved part effect");
// Ordinary car ratings start at one; aero efficiency alone permits zero.
export const clampCarRating = (key, value) => clamp(value, key === "aero_efficiency_rating" ? 0 : 1, 100);

/** New rating effects take precedence over legacy seconds-based effects. */
export function normaliseEffect(raw) {
  const effect = { ...raw };
  let ratings = effect.rating_effects || {};
  if (!hasEffects(ratings) && effect.seasonal_package) {
    ratings = Object.fromEntries(ZONES.filter(key => Math.abs(effectNumber(effect.pace?.[key])) > 1e-9).map(key => [key, effect.pace[key]]));
    for (const key of LEGACY) if (Math.abs(effectNumber(effect[key])) > 1e-9) {
      const target = ALIASES[key] || key;
      ratings[target] = effectNumber(ratings[target]) + effectNumber(effect[key]);
    }
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(ratings)) {
    const target = ALIASES[key] || key;
    cleaned[target] = effectNumber(cleaned[target]) + effectNumber(value);
  }
  if (hasEffects(cleaned)) {
    if (effect.aero_efficiency_rating != null && Object.hasOwn(cleaned, "aero_efficiency_rating")) cleaned.aero_efficiency_rating = effectNumber(effect.aero_efficiency_rating);
    effect.rating_effects = cleaned;
  }
  if (!("attr" in effect) && effect.pace) effect.attr = { ...effect.pace };
  if (!("tyre_management" in effect) && "tyre_wear" in effect) effect.tyre_management = effect.tyre_wear;
  return effect;
}

/** Understanding scales the fitted design, without changing the saved inventory. */
export function scaleEffect(raw, multiplier) {
  const effect = { ...raw };
  if (Math.abs(multiplier - 1) <= 1e-6) return effect;
  for (const key of ["pace", "attr", "rating_effects"]) if (effect[key]) {
    effect[key] = Object.fromEntries(Object.entries(effect[key]).map(([name, value]) => [name, effectNumber(value) * multiplier]));
  }
  if (!("attr" in effect) && effect.pace) effect.attr = { ...effect.pace };
  for (const key of [...LEGACY, "lap_time", "lap_time_base", "aero_efficiency_rating", "ratio"]) if (key in effect) effect[key] = effectNumber(effect[key]) * multiplier;
  return effect;
}

export function understanding(source, key, item) {
  if (!item.name) return 1;
  const info = source.definitions.car_parts.parts[key];
  const start = clamp(finite(info.understanding_start ?? .5, "Initial part understanding"), 0, 1);
  const full = Math.max(0, Math.trunc(finite(info.understanding_laps_to_full ?? 250, "Understanding lap target")));
  const used = Math.max(0, Math.trunc(finite(source.teamInputs.part_understanding_laps?.[item.name] || 0, "Saved understanding laps")));
  return full <= 0 ? 1 : clamp(start + (1 - start) * used / full, 0, 1);
}

/** Apply only quantities used by a fresh flying lap; reliability/traffic/wear are outside it. */
export function applyPartEffect(row, raw, unbounded, constants) {
  const effect = normaliseEffect(raw);
  const apply = (key, value) => {
    if (key === "car_mass_kg") row[key] = Math.max(640, row[key] + value);
    else if (CAR_RATINGS.includes(key)) row[key] = unbounded.has(key) ? row[key] + value : clampCarRating(key, row[key] + value);
  };
  if (hasEffects(effect.rating_effects)) {
    for (const [key, value] of Object.entries(effect.rating_effects)) apply(key, effectNumber(value));
    return;
  }
  const paceDelta = (key, value) => {
    // Conversion clamps before and after the legacy seconds adjustment. Edited
    // baseline values carry their excess through this intermediate conversion.
    const carry = unbounded.has(key) ? row[key] - 50 : 0;
    const seconds = (50 - clamp(row[key] - carry, 0, 100)) * .1 + effectNumber(value);
    const rating = clamp(50 - clamp(seconds, -5, 5) / .1, 0, 100);
    row[key] = unbounded.has(key) ? carry + rating : clampCarRating(key, rating);
  };
  for (const key of ZONES) if (Object.hasOwn(effect.attr || {}, key)) paceDelta(key, effect.attr[key]);
  for (const key of ["team_pace", "acceleration", "braking"]) if (key in effect) paceDelta(key, effect[key]);
  for (const key of ["tyre_management", "tyre_wear"]) if (key in effect) {
    const best = constants.TYRE_MANAGEMENT_MIN ?? .5, worst = constants.TYRE_MANAGEMENT_MAX ?? 1.5;
    const carry = unbounded.has("tyre_management") ? row.tyre_management - 50 : 0;
    const wear = worst + (best - worst) * clamp(row.tyre_management - carry, 0, 100) / 100 + effectNumber(effect[key]);
    const rating = best === worst ? 50 : clamp((wear - worst) / (best - worst) * 100, 0, 100);
    row.tyre_management = unbounded.has("tyre_management") ? carry + rating : clampCarRating("tyre_management", rating);
  }
  for (const key of ["aero_efficiency_rating", "car_mass_kg"]) if (key in effect) apply(key, effectNumber(effect[key]));
}
