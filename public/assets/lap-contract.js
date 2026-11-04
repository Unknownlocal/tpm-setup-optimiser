// This boundary accepts prepared numerical inputs, not saved car ratings.
export const ENGINE_VERSION = 1;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const INPUT_DEFAULTS = {
  slow_rating_points: 0, med_rating_points: 0, high_rating_points: 0, corner_rating_points: 0,
  straight_rating_points: 0, team_pace_rating_points: 0, engine_pace_rating_points: 0,
  braking_rating_points: 0, acceleration_rating_points: 0, engine_power_rating: 50,
  car_mass_kg: 650, engine_mass_kg: 150, fuel_mass_kg: 0, mass_ref_kg: 800,
  driver_cornering_kmh_bonus: 0, driver_braking_ms2_bonus: 0, tyre_lat_mult: 1, tyre_long_mult: 1,
  oval_driver_discipline_rating: 10, oval_driver_control_rating: 10, wind_aero_efficiency_rating: 50,
  oval_trait_corner_kmh_delta: 0, oval_trait_brake_mult: 1, drs_extra_speed_kmh: 0,
};

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
export function finite(value, label, min = -Infinity, max = Infinity) {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, `Invalid lap input: ${label}.`);
  return value;
}
/** Numerical self-test data only; never use neutral inputs in place of save data. */
export function selfTestPayload() {
  return { version: ENGINE_VERSION, track: { length_km: 1,
    micro_sectors: [{ type: "straight", length_pct: 100, target_speed_kmh: 180 }] },
    inputs: [{ ...INPUT_DEFAULTS, drs_speed_windows: [] }] };
}
