import { rankMods } from "./mod-resolver.js";
import { prepareInputs, trackOptions } from "./input-preparation.js";
import { resolveDefaultCircuit } from "./event-resolution.js";
import { simulateLaps, lapEngineReadiness } from "./lap-physics.js";
import { predictLaps } from "./save-laps.js";
import { gradeSetups } from "./setup-grading.js";

const lapJobs = new Map();
const lapOperations = { "simulate-laps": simulateLaps, "predict-laps": predictLaps, "grade-setups": gradeSetups };

self.onmessage = async ({ data: { id, type, payload } }) => {
  if (type === "cancel") { lapJobs.get(id)?.abort(); return; }
  try {
    let result;
    if (Object.hasOwn(lapOperations, type)) {
      const controller = new AbortController();
      lapJobs.set(id, controller);
      try { result = await lapOperations[type](payload, controller.signal); }
      finally { lapJobs.delete(id); }
    } else if (type === "default-circuit") {
      result = await resolveDefaultCircuit(payload);
    } else if (type === "prepare-inputs") {
      result = await prepareInputs(payload);
    } else if (type === "track-options") {
      result = await trackOptions(payload);
    } else if (type === "rank") {
      result = rankMods(payload.query, payload.mods);
    } else if (type === "summarise") {
      const extensions = Object.create(null);
      let bytes = 0;
      for (const file of payload) {
        const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "(none)";
        extensions[extension] = (extensions[extension] || 0) + 1;
        bytes += file.size;
      }
      result = { count: payload.length, bytes, extensions,
        rows: [...payload].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 100) };
    } else {
      throw new Error("Unknown worker operation.");
    }
    self.postMessage({ id, result });
  } catch (error) {
    if (error.name === "AbortError") return;
    self.postMessage({ id, error: String(error.message || "The browser worker could not process these inputs.").slice(0, 500) });
  }
};

// All worker modules are imported before the UI enables local folder access.
self.postMessage({ ready: true, lap_engine: await lapEngineReadiness() });
