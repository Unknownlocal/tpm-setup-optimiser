import { droppedFolder, readCatalogue, resolveFolder, scanMetadata } from "./folder-access.js";
import { parseModQuery } from "./mod-resolver.js";
import { createInputPanel } from "./input-panel.js";
import { write_log } from "./debug-log.js";
import { createSearchPool } from "./search-pool.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
const worker = new Worker("/assets/metadata-worker.js", { type: "module" });
const requests = new Map();
const dropSupported = typeof DataTransferItem !== "undefined" &&
  ["getAsEntry", "webkitGetAsEntry"].some(name => typeof DataTransferItem.prototype[name] === "function");
let ready = false, busy = false, root = null, catalogue = null;
let controller = new AbortController(), nextId = 0;
const search = createSearchPool();
const inputs = createInputPanel(ui, { job, request, invalidate, search, isReady: () => ready, isBusy: () => busy });

function controls() {
  ui.status.closest(".activity").dataset.busy = String(busy);
  // Folder access starts with dropping the game root.
  ui["mod-query"].disabled = !ready || !root;
  ui.inspect.disabled = !ready || busy || !root || !ui["mod-query"].value.trim();
  ui.clear.disabled = !ready;
  ui["drop-root"].setAttribute("aria-disabled", String(!ready || !dropSupported));
  inputs.refreshControls();
}

function resetResults() {
  ui.results.hidden = true;
  for (const id of ["mod-location", "file-count", "total-size", "extensions", "limits"]) ui[id].textContent = "";
  ui.files.replaceChildren();
  ui.matches.replaceChildren();
  ui["catalogue-note"].textContent = "";
  inputs.clearResult();
}

function invalidate() {
  controller.abort();
  controller = new AbortController();
  busy = false;
  resetResults();
  controls();
}

async function job(action) {
  invalidate();
  const signal = controller.signal;
  busy = true;
  controls();
  try { await action(signal); }
  catch (error) {
    if (!signal.aborted) {
      ui.status.textContent = error.name === "AbortError"
        ? "Folder selection cancelled or access was blocked by the browser." : error.message;
      write_log("operation_failed", { name: error.name, message: ui.status.textContent });
    }
  } finally {
    if (signal === controller.signal) { busy = false; controls(); inputs.selectDefaultSave(); }
  }
}

function request(type, payload, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const id = ++nextId;
    const abort = () => {
      requests.delete(id);
      write_log("worker_cancelled", { id, operation: type }); reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    requests.set(id, { resolve, reject, type, started: performance.now(), cleanup: () => signal.removeEventListener("abort", abort) });
    write_log("worker_requested", { id, operation: type });
    worker.postMessage({ id, type, payload });
  });
}

worker.onmessage = async ({ data }) => {
  if (data.ready) {
    let engines;
    try { engines = await search.ready; }
    catch (error) {
      ui.status.textContent = "The .NET calculation engine could not load. Reload the page to retry.";
      ui["engine-note"].textContent = error.message;
      write_log("engine_unavailable", { message: error.message }); controls(); return;
    }
    ready = true;
    ui.status.textContent = dropSupported ? "Ready. Drop your game folder to begin."
      : "This browser does not support game-folder drops.";
    controls();
    ui["engine-note"].textContent = "Calculation engine ready. Grading and search run in your browser.";
    write_log("ready", { folder_picker: false, folder_drop: dropSupported, lap_engine: engines[0], search_workers: search.size });
    return;
  }
  const pending = requests.get(data.id);
  if (!pending) return; // A previous scan was cancelled or cleared.
  requests.delete(data.id);
  pending.cleanup();
  write_log(data.error ? "worker_failed" : "worker_completed", { id: data.id, operation: pending.type,
    elapsed_ms: Math.round(performance.now() - pending.started), ...(data.error ? { message: data.error } : {}) });
  if (data.error) pending.reject(new Error(data.error));
  else pending.resolve(data.result);
};
worker.onerror = event => {
  event.preventDefault();
  ready = false;
  inputs.stopScan();
  invalidate();
  ui.status.textContent = "The browser worker could not run. Reload this page to retry.";
  ui["engine-note"].textContent = "Lap engine unavailable.";
  write_log("worker_unavailable", { message: ui.status.textContent });
};

function formatBytes(bytes) {
  return `${bytes.toLocaleString("en-GB")} bytes`;
}

async function inspectFolder(folder, label, signal) {
  signal.throwIfAborted();
  ui.status.textContent = `Inspecting ${label}…`;
  const scan = await scanMetadata(folder, signal, count => {
    ui.status.textContent = `Inspecting ${label}: ${count} files…`;
  });
  signal.throwIfAborted();
  const summary = await request("summarise", scan.files, signal);
  signal.throwIfAborted();
  ui["mod-location"].textContent = label;
  ui["file-count"].textContent = summary.count.toLocaleString("en-GB");
  ui["total-size"].textContent = formatBytes(summary.bytes);
  ui.extensions.textContent = Object.entries(summary.extensions).sort(([a], [b]) => a.localeCompare(b))
    .map(([extension, count]) => `${extension}: ${count}`).join(" · ");
  ui.limits.hidden = !scan.partial && !scan.unreadable;
  ui.limits.textContent = `Partial results. ${scan.partial ? "A scan limit was reached. " : ""}${scan.unreadable} unreadable files/folders. Totals cover inspected files only.`;
  for (const file of summary.rows) {
    const row = document.createElement("tr");
    const extension = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "—";
    for (const value of [file.path, extension, formatBytes(file.size), new Date(file.lastModified).toLocaleString("en-GB")]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    ui.files.append(row);
  }
  ui.results.hidden = false;
  await inputs.setMod(folder, label, signal);
  signal.throwIfAborted();
  write_log("mod_inspected", { folder: label, files: summary.count, partial: scan.partial, unreadable: scan.unreadable });
  ui.status.textContent = `Inspection complete${scan.partial || scan.unreadable ? " (partial)" : ""}. Processed locally by a browser worker.`;
}

async function selectRoot(folder, signal) {
  signal.throwIfAborted();
  try { await folder.directory("data"); }
  catch { throw new Error("Drop the game root containing data/, rather than a data mod folder."); }
  signal.throwIfAborted();
  root = folder;
  catalogue = null;
  ui["root-name"].textContent = folder.name;
  ui["mod-query"].value = "";
  await inputs.setRoot(folder, signal);
  ui.status.textContent = "Game folder selected. Enter a mod folder, relative path or title.";
  write_log("folder_selected", { role: "game_root", name: folder.name });
}

ui["browser-note"].hidden = dropSupported;
ui["browser-note"].textContent = "Use a browser that supports dragging folders from your file manager.";

// Prevent a dropped file outside the targets from navigating away from the page.
for (const type of ["dragover", "drop"]) document.addEventListener(type, event => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});
const rootDrop = ui["drop-root"];
rootDrop.ondragover = event => {
  event.preventDefault();
  if (ready && dropSupported) {
    event.dataTransfer.dropEffect = "copy";
    rootDrop.classList.add("drag-over");
  }
};
rootDrop.ondragleave = () => rootDrop.classList.remove("drag-over");
rootDrop.ondrop = event => {
  event.preventDefault();
  rootDrop.classList.remove("drag-over");
  if (!ready || !dropSupported) return;
  job(signal => selectRoot(droppedFolder(event.dataTransfer), signal));
};

ui.inspect.onclick = () => job(async signal => {
  const query = ui["mod-query"].value.trim();
  const { parts, explicit, titleOnly } = parseModQuery(query);
  const path = explicit ? parts : ["data", ...parts];
  let folder;
  try { if (!titleOnly) folder = await resolveFolder(root, path); }
  catch (error) {
    if (error.name !== "NotFoundError") throw error;
    if (explicit) throw new Error("That relative mod folder was not found in the selected game folder.");
  }
  signal.throwIfAborted();
  if (folder) return inspectFolder(folder, path.join("/"), signal);
  ui.status.textContent = "Searching local Workshop titles…";
  if (!catalogue) catalogue = await readCatalogue(await root.directory("data"), signal);
  const matches = await request("rank", { query, mods: catalogue.mods }, signal);
  signal.throwIfAborted();
  ui["catalogue-note"].textContent = `${catalogue.mods.length} Workshop titles indexed; ${catalogue.issues} unreadable/invalid metadata files.${catalogue.partial ? " Catalogue is partial: the scan limit was reached." : ""}`;
  if (matches.length === 1 && matches[0].score === 100) {
    return inspectFolder(await resolveFolder(root, matches[0].path.split("/")), matches[0].path, signal);
  }
  ui.status.textContent = matches.length ? "Choose a matching mod to inspect." :
    "No matching title in the indexed metadata. Try its folder name or a relative path inside the game folder.";
  for (const match of matches.slice(0, 20)) {
    const button = document.createElement("button");
    button.type = "button";
    button.append(document.createTextNode(match.title));
    const location = document.createElement("small");
    location.textContent = match.path;
    button.append(location);
    button.onclick = () => job(async current => inspectFolder(
      await resolveFolder(root, match.path.split("/")), match.path, current));
    ui.matches.append(button);
  }
});

ui["mod-query"].oninput = () => {
  invalidate();
  inputs.resetMod();
  ui.status.textContent = "Ready to inspect the entered mod.";
  controls();
};
ui.cancel.onclick = () => {
  const stoppedScan = inputs.stopScan();
  if (search.cancel()) { ui.status.textContent = "Stopping calculations; keeping completed results…"; write_log("search_stop_requested"); return; }
  if (stoppedScan && !busy) { ui.status.textContent = "Save scan stopped. Matching saves found so far remain available."; write_log("save_scan_stopped"); return; }
  invalidate(); ui.status.textContent = "Operation cancelled."; write_log("cancelled");
};
ui.clear.onclick = () => {
  invalidate();
  root = catalogue = null;
  inputs.clear();
  ui["root-name"].textContent = "No game folder selected";
  ui["mod-query"].value = "";
  for (const control of document.querySelectorAll("input:not([type=file]):not([type=checkbox])")) control.value = control.defaultValue;
  for (const id of ["driving-pace", "engine-mode"]) ui[id].value = ui[id].querySelector("option[selected]").value;
  for (const section of document.querySelectorAll("details")) section.open = false;
  ui.status.textContent = "Files and results cleared. Ready for a new session.";
  write_log("cleared");
  controls();
};
