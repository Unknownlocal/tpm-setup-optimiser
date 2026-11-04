import { requireValue } from "./lap-contract.js";
import { loadEngine } from "./lap-physics.js";

/** Resolve the shared ambient value in a calculation worker, before driver searches start. */
export async function resolveTemperature(source, seed) {
  const engine = await loadEngine();
  const values = Array.from(engine.ResolveTemperature(JSON.stringify({ weather: source.weather, sessionOptions: source.sessionOptions,
    track: source.track, trackLapModifiersEnabled: source.trackLapModifiersEnabled, definitions: { constants: source.definitions.constants } }), seed));
  requireValue(values.length === 2 && values.every(Number.isFinite), "Invalid session temperature response.");
  return { ...source.weather, temperature_c: values[0], temperature_source: values[1] ? "generated" : "manual",
    ...(values[1] ? { temperature_laps: values[1] } : {}) };
}
