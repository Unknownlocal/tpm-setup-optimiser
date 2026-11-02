import { clamp, finite, requireValue } from "./lap-contract.js";
import { PythonRandom } from "./python-random.js";
import { roundEven } from "./python-numbers.js";

const RANGES = [[[10, 18], [12, 22]], [[18, 24], [18, 28]], [[24, 32], [28, 36]],
  [[30, 36], [18, 24]], [[15, 22], [30, 38]], [[30, 38], [32, 40]]];

function temperatureProfile(laps, random) {
  const [startRange, endRange] = random.choice(RANGES);
  const start = random.uniform(...startRange), end = random.uniform(...endRange), points = [[0, start]];
  if (laps > 1) {
    const mids = laps > 6 ? random.integer(0, 3) : 0;
    const picks = random.sampleIndices(laps - 2, mids).map(index => index + 1).sort((a, b) => a - b);
    picks.forEach((lap, i) => points.push([lap, clamp(start + (end - start) * ((i + 1) / (mids + 1)) + random.uniform(-5, 5), 10, 40)]));
    points.push([laps - 1, end]);
  }
  return Array.from({ length: laps }, (_, lap) => {
    let value = points.at(-1)[1];
    for (let i = 1; i < points.length; i++) if (lap <= points[i][0]) {
      const [left, low] = points[i - 1], [right, high] = points[i];
      value = low + (high - low) * ((lap - left) / (right - left));
      break;
    }
    return clamp(value + random.uniform(-.8, .8), 10, 40);
  });
}

/** Wetness stays user supplied. Replay the game's wet-forecast draws because they
 * precede temperature blending in the same random stream; no wet curve is needed. */
function advanceWetForecast(random, laps, source) {
  const constants = source.definitions.constants;
  let dry = finite(constants.RACE_WEATHER_DRY_PROB ?? .95, "Dry forecast probability", 0, 1);
  let wet = [constants.RACE_WEATHER_PASSING_SHOWERS_PROB ?? .02, constants.RACE_WEATHER_DRY_TO_WET_PROB ?? .015, constants.RACE_WEATHER_WET_TO_DRY_PROB ?? .015];
  wet.forEach(value => finite(value, "Wet forecast probability", 0, 1));
  const raw = source.track.wet_weather_probability_multiplier;
  const multiplier = (typeof raw === "number" || (typeof raw === "string" && raw.trim())) && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : 1;
  if (multiplier !== 1) {
    const wetSum = wet.reduce((sum, value) => sum + value, 0);
    const total = wetSum + Math.max(0, 1 - (dry + wetSum));
    const chance = total <= 0 ? 0 : Math.min(1, total * multiplier);
    wet = wet.map(value => total <= 0 ? 0 : value * (chance / total)); dry = 1 - chance;
  }
  const roll = random.random();
  if (roll < dry) return;
  let draws;
  if (roll < dry + wet[0]) draws = 7; // Passing showers.
  else if (roll < dry + wet[0] + wet[1]) draws = 5; // Dry to wet.
  else if (roll < dry + wet[0] + wet[1] + wet[2]) draws = 6; // Wet to dry.
  else draws = random.random() < .5 ? 7 * random.integer(2, 3) : 6; // Unsettled pulses or storm.
  // After the control points, every non-dry forecast draws one noise value per lap.
  for (let i = 0; i < draws + laps; i++) random.random();
}

/** Fresh practice/testing first generates qualifying weather in its base environment,
 * then blends a separate practice curve with it. Match that desktop-adapter sequence. */
export function sessionTemperatureProfile(source, seed) {
  finite(seed, "session seed", 0, 999999);
  requireValue(Number.isInteger(seed), "The session seed must be a whole number.");
  const base = Math.trunc(finite(source.sessionOptions.laps ?? 12, "Session lap count"));
  const modifier = source.trackLapModifiersEnabled ? finite(source.track.lap_modifier ?? 1, "Circuit lap modifier") : 1;
  const laps = Math.max(1, roundEven(base * modifier));
  requireValue(laps <= 10000, "Session temperature profile exceeds 10,000 laps.");
  const earlier = temperatureProfile(laps, new PythonRandom(seed + 137));
  const random = new PythonRandom(seed + 73), practice = temperatureProfile(laps, random);
  if (source.weather.wetness_mm > 0) advanceWetForecast(random, laps, source);
  return practice.map((value, i) => clamp(.72 * value + .28 * earlier[i] + random.uniform(-1.5, 1.5), 10, 40));
}

/** Resolve once before driver workers start, so references and candidates share it. */
export function resolveTemperature(source, seed) {
  if (source.weather.temperature_c !== null) return { ...source.weather, temperature_source: "manual" };
  const profile = sessionTemperatureProfile(source, seed);
  return { ...source.weather, temperature_c: profile.reduce((sum, value) => sum + value, 0) / profile.length,
    temperature_source: "generated", temperature_laps: profile.length };
}
