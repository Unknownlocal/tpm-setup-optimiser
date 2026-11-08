import { finite, requireValue } from "./lap-contract.js";

/** Validate controls before sending them to C#; native search enforces these budgets. */
export function searchLimits(raw = {}) {
  const limits = { seconds: raw.seconds ?? 15, refine_laps: raw.refine_laps ?? 500, stall_laps: raw.stall_laps ?? 100, idle_batches: raw.idle_batches ?? 64, cache_entries: raw.cache_entries ?? 4096 };
  finite(limits.seconds, "search seconds", .1, 300);
  for (const key of ["refine_laps", "stall_laps", "idle_batches"]) {
    finite(limits[key], key, 1, 100000);
    requireValue(Number.isInteger(limits[key]), `${key} must be a whole number.`);
  }
  finite(limits.cache_entries, "maximum cached setups", 100, 100000);
  requireValue(Number.isInteger(limits.cache_entries), "Maximum cached setups must be a whole number.");
  requireValue(limits.stall_laps < limits.refine_laps, "Stall laps must be less than refinement laps.");
  return limits;
}
