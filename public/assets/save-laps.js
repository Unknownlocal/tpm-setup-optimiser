import { prepareInputs } from "./input-preparation.js";
import { createLapScenario } from "./lap-scenario.js";

/** Read once and share the fitted car/weather between predictions and references. */
export async function prepareLapScenario(payload, signal) {
  const result = await prepareInputs(payload);
  return { result, scenario: await createLapScenario(result.source, payload, signal) };
}

export async function predictLaps(payload, signal) {
  const start = performance.now(), { result, scenario } = await prepareLapScenario(payload, signal);
  const rows = result.source.drivers.flatMap(driver => result.source.tyres.map(compound => scenario.row(driver, compound)));
  const timing = await scenario.laps(rows, signal);
  return { ...result, prediction: { seed: scenario.seed, wind: scenario.wind,
    rows, timing_ms: { ...timing, end_to_end: performance.now() - start } } };
}
