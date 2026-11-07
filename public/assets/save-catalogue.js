import { readJson } from "./input-preparation.js";

/** Only this small record leaves the metadata worker; parsed saves are discarded. */
export async function saveSummary(file) {
  const save = await readJson(file, "Save", 64 * 1024 * 1024);
  if (typeof save?.data_pack !== "string" || !save.data_pack.trim()) throw new Error("The save has no data_pack identifier.");
  return { pack: save.data_pack };
}

/** Scan one save at a time, cache metadata by File identity, and discard stale scans. */
export function createSaveCatalogue(request, changed) {
  let files = new Map(), metadata = new WeakMap(), matches = new Map(), controller = null;
  let pack = null, checked = 0, unreadable = 0, complete = false, latest = null;
  const update = () => changed({ matches, latest, pack, checked, unreadable, total: files.size, scanning: controller !== null, complete });
  async function summary(file, signal) {
    signal.throwIfAborted();
    if (metadata.has(file)) return metadata.get(file);
    const result = await request("save-summary", file, signal);
    signal.throwIfAborted(); metadata.set(file, result); return result;
  }
  function stop() {
    if (!controller) return false;
    controller.abort(); controller = null; update(); return true;
  }
  async function filter(selectedPack) {
    stop(); pack = selectedPack; matches = new Map(); checked = unreadable = 0; complete = false; latest = null;
    if (!pack || !files.size) { update(); return; }
    const active = new AbortController(); controller = active; update();
    try {
      for (const [name, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
        try {
          const result = await summary(file, active.signal);
          active.signal.throwIfAborted();
          if (result.pack === selectedPack) {
            matches.set(name, file);
            // Equal timestamps keep the first filename in the sorted scan.
            if (!latest || file.lastModified > latest.lastModified) latest = file;
          }
        } catch {
          if (active.signal.aborted) return;
          unreadable++;
        }
        checked++;
        // Batch option rendering; a selected save can be used while the scan continues.
        if (checked % 8 === 0) update();
      }
      complete = true;
    } finally {
      if (controller === active) { controller = null; update(); }
    }
  }
  return {
    summary, filter, stop,
    get matches() { return matches; },
    get scanning() { return controller !== null; },
    setFiles(selected = new Map()) { stop(); files = selected; metadata = new WeakMap(); return filter(null); },
  };
}
