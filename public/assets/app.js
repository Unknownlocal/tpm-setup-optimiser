import { droppedFolder, handleFolder, readCatalogue, resolveFolder, scanMetadata } from "./folder-access.js";
import { parseModQuery } from "./mod-resolver.js";
import { createInputPanel } from "./input-panel.js";
import { write_log } from "./debug-log.js";

const ui = Object.fromEntries([...document.querySelectorAll("[id]")].map(element => [element.id, element]));
const worker = new Worker("/assets/metadata-worker.js", { type: "module" });
const requests = new Map();
const supported = typeof window.showDirectoryPicker === "function";
const dropSupported = typeof DataTransferItem !== "undefined" &&
  ["getAsEntry", "webkitGetAsEntry"].some(name => typeof DataTransferItem.prototype[name] === "function");
let ready = false, busy = false, root = null, external = null, catalogue = null;
let controller = new AbortController(), nextId = 0;
const inputs = createInputPanel(ui, { job, request, invalidate, isReady: () => ready, isBusy: () => busy });

function controls() {
  ui["choose-root"].disabled = !ready || !supported;
  ui["choose-mod"].disabled = !ready || !supported;
  ui["mod-query"].disabled = !ready || !root;
  ui.inspect.disabled = !ready || busy || (!external && (!root || !ui["mod-query"].value.trim()));
  ui.cancel.disabled = !busy;
  ui.clear.disabled = !ready || (!supported && !dropSupported);
  for (const id of ["drop-root", "drop-mod"]) ui[id].setAttribute("aria-disabled", String(!ready || !dropSupported));
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
    if (signal === controller.signal) { busy = false; controls(); }
  }
}

function request(type, payload, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const id = ++nextId;
    const abort = () => {
      requests.delete(id);
      if (type === "simulate-laps" || type === "predict-laps") worker.postMessage({ id, type: "cancel" });
      write_log("worker_cancelled", { id, operation: type }); reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    requests.set(id, { resolve, reject, type, started: performance.now(), cleanup: () => signal.removeEventListener("abort", abort) });
    write_log("worker_requested", { id, operation: type });
    worker.postMessage({ id, type, payload });
  });
}

worker.onmessage = ({ data }) => {
  if (data.ready) {
    ready = true;
    ui.status.textContent = supported ? "Ready. Choose or drop your game folder to begin." : dropSupported
      ? "Ready. Drop your game folder or a mod folder to begin."
      : "This browser does not support local folder access for this POC.";
    controls();
    ui["engine-note"].textContent = "Lap engine loaded and self-test passed. Fixed-setup lap preview is ready.";
    write_log("ready", { folder_picker: supported, folder_drop: dropSupported, lap_engine: data.lap_engine });
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

async function selectFolder(folder, isRoot, signal) {
  signal.throwIfAborted();
  if (isRoot) {
    try { await folder.directory("data"); }
    catch { throw new Error("Choose the game root containing data/, rather than a data mod folder."); }
  }
  signal.throwIfAborted();
  if (isRoot) {
    root = folder;
    external = null;
    catalogue = null;
    ui["root-name"].textContent = folder.name;
    ui["mod-query"].value = "";
    await inputs.setRoot(folder, signal);
    ui.status.textContent = "Game folder selected. Enter a mod folder, relative path or title.";
  } else {
    external = folder;
    inputs.resetMod();
    ui["mod-query"].value = folder.name;
    ui.status.textContent = `Separate folder selected: ${folder.name}. Click Inspect.`;
  }
  write_log("folder_selected", { role: isRoot ? "game_root" : "data_mod", name: folder.name });
}

for (const [button, isRoot] of [["choose-root", true], ["choose-mod", false]]) {
  ui[button].onclick = () => job(async signal => {
    const handle = await window.showDirectoryPicker({ mode: "read" });
    await selectFolder(handleFolder(handle), isRoot, signal);
  });
}
ui["browser-note"].hidden = supported;
ui["browser-note"].textContent = dropSupported
  ? "The folder picker is unavailable in this browser. Drag a folder from your file manager into one of the marked areas."
  : "This browser does not provide folder picking or folder entries from drag-and-drop.";

// Prevent a dropped file outside the targets from navigating away from the POC.
for (const type of ["dragover", "drop"]) document.addEventListener(type, event => {
  if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
});
for (const [id, isRoot] of [["drop-root", true], ["drop-mod", false]]) {
  const target = ui[id];
  target.ondragover = event => {
    event.preventDefault();
    if (ready && dropSupported) {
      event.dataTransfer.dropEffect = "copy";
      target.classList.add("drag-over");
    }
  };
  target.ondragleave = () => target.classList.remove("drag-over");
  target.ondrop = event => {
    event.preventDefault();
    target.classList.remove("drag-over");
    if (!ready || !dropSupported) return;
    job(signal => selectFolder(droppedFolder(event.dataTransfer), isRoot, signal));
  };
}

ui.inspect.onclick = () => job(async signal => {
  if (external) return inspectFolder(external, external.name + " (separate folder)", signal);
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
    "No matching title in the indexed metadata. Try its folder name/path or choose the mod folder directly.";
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
  external = null;
  ui.status.textContent = "Ready to inspect the entered mod.";
  controls();
};
ui.cancel.onclick = () => { invalidate(); ui.status.textContent = "Operation cancelled."; write_log("cancelled"); };
ui.clear.onclick = () => {
  invalidate();
  root = external = catalogue = null;
  inputs.clear();
  ui["root-name"].textContent = "No game folder selected";
  ui["mod-query"].value = "";
  ui.status.textContent = "Selection and results cleared.";
  write_log("cleared");
  controls();
};
