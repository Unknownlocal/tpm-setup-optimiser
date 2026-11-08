import { rankMods } from "./mod-resolver.js";
import { readJson, trackOptions } from "./input-preparation.js";
import { compoundOptions } from "./compounds.js";
import { saveSummary } from "./save-catalogue.js";
import { resolveSeasonCalendar } from "./event-resolution.js";
import { setupModel, resolveSetupAxes } from "./setup-model.js";

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === "save-summary") {
      result = await saveSummary(payload);
    } else if (type === "compound-options") {
      result = compoundOptions(await readJson(payload, "tyremodel.json"));
    } else if (type === "setup-options") {
      result = resolveSetupAxes(setupModel("formula"), (await readJson(payload, "config.json"))?.car_setup);
    } else if (type === "season-calendar") {
      result = await resolveSeasonCalendar(payload);
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
self.postMessage({ ready: true });
