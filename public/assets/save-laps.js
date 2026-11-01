import { prepareInputs } from "./input-preparation.js";
import { finite, clamp, requireValue } from "./lap-contract.js";
import { PythonRandom } from "./python-random.js";
import { initialWind } from "./session-wind.js";
import { fittedCar, enginePower, partFor } from "./saved-car.js";
import { setupEffects, tyreGrip } from "./fixed-setup.js";
import { simulateLaps } from "./lap-physics.js";

/** Convert a verified fitted baseline into the numerical engine's explicit contract.
 * This follows the desktop adapter's fresh practice-session defaults: push pace,
 * medium engine, balanced spec ERS, neutral tyre supplier, no rubber or DRS. */
export async function predictLaps(payload, signal) {
  const start = performance.now();
  const result = await prepareInputs(payload), source = result.source;
  signal?.throwIfAborted();
  requireValue(["corner_speed_multiplier", "acceleration_multiplier", "braking_multiplier", "drag_multiplier"].every(key => source.activePolicies.car[key] === 1),
    "This lap preview currently supports the standard car profile only.");
  const seed = finite(payload.seed, "session seed", 0, 999999);
  requireValue(Number.isInteger(seed), "The session seed must be a whole number.");
  // Calendar IDs, including their case, determine native wind seeds independently of filenames.
  source.trackId = payload.trackId ?? payload.trackFile.name.replace(/\.json$/iu, "");
  requireValue(typeof source.trackId === "string" && source.trackId.length > 0, "A circuit identifier is required for the session seed.");
  source.testing = payload.testing === true;
  const wind = await initialWind(source, seed);
  signal?.throwIfAborted();
  const constants = source.definitions.constants;
  const level = clamp(Math.trunc(source.sessionOptions.variability_level ?? 1), constants.WEEKEND_CORNERING_VARIABILITY_LEVEL_MIN ?? 1, constants.WEEKEND_CORNERING_VARIABILITY_LEVEL_MAX ?? 10);
  const span = level * (constants.WEEKEND_CORNERING_VARIABILITY_KMH_PER_LEVEL ?? .25), rng = new PythonRandom(seed + 977);
  const variations = new Map([...source.drivers].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(driver => [driver.name, rng.uniform(-span, span)]));
  const staff = source.dynamicsStaff[0];
  const morale = clamp(50 + (staff?.morale_effects || []).reduce((sum, effect) => sum + (effect.amount || 0), 0), 0, 100);
  const skill = clamp(Math.trunc((staff?.skills?.tire_temp ?? staff?.skill ?? 1) + (morale - 50) / 50 * 2 + .5), 1, 20);
  const rows = [];
  for (const driver of source.drivers) {
    const car = fittedCar(source, driver), setup = setupEffects(source, driver, car.aero, car.chassis);
    for (const compound of source.tyres) {
      const grip = tyreGrip(source, compound, setup.pressure, skill, car.protectedTemperature), attrs = car.attrs;
      // Setup effects are speeds in km/h; the physics boundary takes rating points.
      const input = {
        slow_rating_points: attrs.slow + setup.delta.slow / .084375,
        med_rating_points: attrs.med + setup.delta.med / .09375,
        high_rating_points: attrs.high + setup.delta.high / .15,
        corner_rating_points: 0, straight_rating_points: attrs.straight + setup.delta.straight / .18,
        team_pace_rating_points: attrs.team_pace + (source.weather.wetness_mm > 1 ? car.wetBonus : 0),
        engine_pace_rating_points: 0, braking_rating_points: attrs.braking,
        acceleration_rating_points: attrs.acceleration + (setup.pressure.accel_ms2 || 0) / .015 + 40,
        engine_power_rating: enginePower(source, driver), car_mass_kg: Math.max(300, attrs.car_mass_kg),
        engine_mass_kg: Math.max(50, partFor(driver, "engine").item.mass_kg), fuel_mass_kg: 15, mass_ref_kg: 800,
        driver_cornering_kmh_bonus: Math.max(0, driver.skills.cornering) * .1 + variations.get(driver.name) + .4,
        driver_braking_ms2_bonus: Math.max(0, driver.skills.braking) * .03,
        tyre_lat_mult: grip.lateral, tyre_long_mult: grip.longitudinal,
        wind_aero_efficiency_rating: car.aero, oval_driver_discipline_rating: 10, oval_driver_control_rating: 10,
        oval_trait_corner_kmh_delta: 0, oval_trait_brake_mult: 1, drs_extra_speed_kmh: 0, drs_speed_windows: [],
      };
      rows.push({ driver: driver.name, entry: driver.entry, compound: compound.name,
        balance: setup.balance, traction: setup.traction, tyre_temperature_c: grip.temperature_c, inputs: input });
    }
  }
  const numerical = { version: 1, track: source.track, car_profile: source.activePolicies.car, wind: wind.field, inputs: rows.map(row => row.inputs) };
  const simulation = await simulateLaps(numerical, signal);
  rows.forEach((row, i) => { row.lap_time_s = simulation.lap_times_s[i]; });
  return { ...result, prediction: { seed, wind: { speed_kmh: wind.speed_kmh, direction_deg: wind.direction_deg },
    rows, timing_ms: { ...simulation.timing_ms, end_to_end: performance.now() - start } } };
}
