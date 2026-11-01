import { clamp, finite, requireValue } from "./lap-contract.js";

export const SETTING_KEYS = ["front_wing", "rear_wing", "front_pressure_psi", "rear_pressure_psi", "suspension_level"];
export const ticks = settings => SETTING_KEYS.map((key, i) => Math.round(settings[key] * (i === 2 || i === 3 ? 10 : 1)));
export const settingsFromTicks = values => Object.fromEntries(SETTING_KEYS.map((key, i) => [key, values[i] / (i === 2 || i === 3 ? 10 : 1)]));
export const settingKey = values => values.join(",");
const COARSE_STEPS = [3, 3, 10, 10, 2];

export function searchLimits(raw = {}) {
  const limits = { seconds: raw.seconds ?? 15, refine_laps: raw.refine_laps ?? 500, stall_laps: raw.stall_laps ?? 100, idle_batches: raw.idle_batches ?? 64 };
  finite(limits.seconds, "search seconds", .1, 300);
  for (const key of ["refine_laps", "stall_laps", "idle_batches"]) {
    finite(limits[key], key, 1, 100000);
    requireValue(Number.isInteger(limits[key]), `${key} must be a whole number.`);
  }
  requireValue(limits.stall_laps < limits.refine_laps, "Stall laps must be less than refinement laps.");
  return limits;
}

export function boundsFor(source) {
  const cfg = source.setupDefinitions, w = cfg.wing_levels, p = cfg.tyre_pressures, s = cfg.suspension_setup;
  requireValue(p.front.step_psi === .1 && p.rear.step_psi === .1, "Search currently requires 0.1 psi pressure steps.");
  return [[w.min_level, w.max_level], [w.min_level, w.max_level], [Math.round(p.front.min_psi * 10), Math.round(p.front.max_psi * 10)],
    [Math.round(p.rear.min_psi * 10), Math.round(p.rear.max_psi * 10)], [s.min_level, s.max_level]];
}

/** Same mix as the desktop search: neighbours, broad samples, guidance samples and paired moves. */
export function candidatesFor(state, bounds, rng) {
  const steps = state.round++ % 3 === 0 ? COARSE_STEPS : [1, 1, 1, 1, 1], values = [];
  for (let axis = 0; axis < 5; axis++) for (const sign of [-1, 1]) {
    const value = [...state.anchor]; value[axis] = clamp(value[axis] + sign * steps[axis], ...bounds[axis]); values.push(value);
  }
  for (let attempt = 0; attempt < 38; attempt++) {
    let value = [...state.anchor];
    if (attempt < 8) value = bounds.map(([low, high]) => rng.integer(low, high));
    else if (attempt < 20) value = state.reference.map((v, axis) => rng.integer(Math.max(bounds[axis][0], v - COARSE_STEPS[axis]), Math.min(bounds[axis][1], v + COARSE_STEPS[axis])));
    else for (const axis of rng.pair()) value[axis] = clamp(value[axis] + rng.choice([-1, 1]) * steps[axis], ...bounds[axis]);
    values.push(value);
  }
  return values;
}

/** Charge only newly simulated component laps. Cached/pruned work has its own cutoff. */
export function advanceSearch(state, found, laps, limits, generated = true) {
  for (const row of found) if (row.score > state.best.score) { state.best = row; state.anchor = ticks(row.settings); }
  const refinement = state.refinement;
  if (refinement) {
    refinement.laps += laps; refinement.stale_laps += laps;
    const gained = state.best.score - refinement.milestone >= .01 - 1e-10;
    if (gained) { refinement.milestone = state.best.score; refinement.stale_laps = 0; }
    if (laps || gained) refinement.idle_batches = 0;
    else if (generated) refinement.idle_batches++;
  } else if (state.best.grade === "S+") state.refinement = { laps: 0, stale_laps: 0, idle_batches: 0, milestone: state.best.score, first_score: state.best.score };
  const r = state.refinement;
  state.stop_reason = state.best.score >= 100 ? "perfect" : r?.laps >= limits.refine_laps ? "refinement" : r?.stale_laps >= limits.stall_laps ? "stall" : r?.idle_batches >= limits.idle_batches ? "idle" : null;
}
