import { rankMods } from "./mod-resolver.js";

self.onmessage = ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === "rank") {
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
  } catch {
    self.postMessage({ id, error: "The browser worker could not process this metadata." });
  }
};

// All worker modules are imported before the UI enables local folder access.
self.postMessage({ ready: true });
