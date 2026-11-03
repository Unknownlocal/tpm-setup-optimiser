import { clamp, finite } from "./lap-contract.js";

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
