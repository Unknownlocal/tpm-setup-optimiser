import { DEFINITION_FILES } from "./input-preparation.js";
import { write_log, write_input_logs } from "./debug-log.js";
import { renderResults } from "./result-panel.js";
import { setupModel } from "./setup-model.js";
import { createResultExport } from "./result-export.js";
import { searchLimits } from "./search-settings.js";
import { createSaveCatalogue } from "./save-catalogue.js";
import { createCompoundSelection } from "./compound-selection.js";
import { compoundName } from "./compounds.js";
import { gradingSummary } from "./result-format.js";
import { normaliseNumbers } from "./number-inputs.js";

/** Keep local file selections in memory and display the worker's checked source inputs. */
export function createInputPanel(ui, { job, request, invalidate, isReady, isBusy, search }) {
  let mod = null, save = null, savePack = null, calendarDefault = null, preparationSignal = null, listedPack = null;
  let defaultSave = null, saveChosen = false;
  const tracks = new Map(), allTracks = new Map();
  const catalogue = createSaveCatalogue(request, updateSaves);
  const compounds = createCompoundSelection(ui, () => {
    if (preparationSignal && !preparationSignal.aborted) invalidate(); else clearResult();
    refreshControls();
  });
  const setupAxes = setupModel("formula").axes;
  const exports = createResultExport(ui);
  for (const axis of setupAxes) {
    const label = document.createElement("label"), control = document.createElement("input");
    label.append(document.createTextNode(`${axis.label}${axis.unit ? ` (${axis.unit})` : ""}`));
    // The selected mod defines the step. The worker checks it before grading or searching.
    control.id = axis.control; control.type = "number"; control.step = "any"; control.required = true;
    control.disabled = true; control.placeholder = "Select a data mod";
    ui[axis.control] = control; label.append(control); ui["setup-fields"].append(label);
  }
  function setSetupAxes(axes = []) {
    for (const axis of setupAxes) {
      const control = ui[axis.control], resolved = axes.find(item => item.key === axis.key);
      control.disabled = !resolved;
      for (const key of ["min", "max", "step"]) control[key] = resolved ? String(resolved[key]) : key === "step" ? "any" : "";
      control.defaultValue = control.value = resolved ? String(resolved.initial) : "";
    }
  }
  function options(select, placeholder, entries = []) {
    select.replaceChildren(new Option(placeholder, ""));
    for (const [value, label] of entries) select.add(new Option(label, value));
  }
  function clearResult() {
    ui["input-results"].hidden = true;
    ui["input-details"].replaceChildren();
    ui["input-summary"].textContent = ui["run-summary"].textContent = "";
    ui["run-error"].textContent = ""; ui["run-error"].hidden = true;
    exports.clear();
  }
  function showResult(result, options) { renderResults(ui, result, options); exports.setResult(result); }
  function updateSaves(state) {
    if (listedPack !== state.pack || state.matches.size < ui["save-choice"].options.length - 1) {
      listedPack = state.pack;
      options(ui["save-choice"], state.pack ? "Select a matching save…" : "Select a data mod first…");
    }
    const shown = new Set([...ui["save-choice"].options].map(option => option.value));
    for (const name of state.matches.keys()) if (!shown.has(name)) ui["save-choice"].add(new Option(name, name));
    ui["save-choice"].value = save && state.matches.get(save.name) === save ? save.name : "";
    ui["save-note"].textContent = !state.pack ? `${state.total} save files found. Select a data mod to show matches, or choose a JSON save file.`
      : `${state.matches.size} matching saves; ${state.checked}/${state.total} files checked.${state.unreadable ? ` ${state.unreadable} could not be read or had no data-mod name.` : ""}${state.scanning ? " Checking locally in the background…" : !state.complete && state.checked < state.total ? " Scan stopped. Select the mod again to check the remaining files." : ""}`;
    if (state.complete && !save && !saveChosen) defaultSave = state.latest;
    refreshControls();
    selectDefaultSave();
  }
  function saveWarning(message = "") {
    ui["save-error"].hidden = !message; ui["save-error"].textContent = message;
  }
  function clearSave() {
    save = savePack = calendarDefault = null;
    tracks.clear(); options(ui["track-choice"], "Select a save first…");
    ui["save-name"].textContent = ""; ui["save-choice"].value = ui["track-choice"].value = "";
    ui["session-summary"].textContent = "Select a save to detect the next session.";
    ui["track-note"].textContent = "Select a save to choose the calendar default.";
  }
  function refreshControls() {
    refreshWeights();
    ui["choose-save"].disabled = !isReady();
    ui["save-choice"].disabled = !isReady() || !catalogue.matches.size;
    ui["track-choice"].disabled = !isReady() || !tracks.size;
    ui["search-setups"].disabled = ui["prepare-inputs"].disabled = !isReady() || isBusy() || !save || !mod || !ui["track-choice"].value || !compounds.values().length;
    compounds.enable(isReady() && mod !== null);
    // Stop also covers background metadata work, independently of calculations.
    ui.cancel.disabled = !isBusy() && !catalogue.scanning;
    ui["drop-save"].setAttribute("aria-disabled", String(!isReady()));
  }
  function refreshWeights() {
    ui["weight-note"].textContent = ui["pace-weight"].validity.valid
      ? `${gradingSummary({ pace_weight_pct: ui["pace-weight"].valueAsNumber })}.`
      : "Enter a pace weight from 0 to 100 percent.";
  }
  function selectDefaultSave() {
    // Wait for the whole scan and any foreground job; never replace a user's choice.
    if (defaultSave && !saveChosen && isReady() && !isBusy()) {
      const file = defaultSave; defaultSave = null;
      job(signal => selectSave(file, signal));
    }
  }
  async function filesIn(folder, limit, signal) {
    const files = new Map(); let seen = 0;
    for await (const entry of folder.entries()) {
      signal.throwIfAborted();
      if (++seen > 1000) throw new Error("Too many folder entries. Choose the save or circuit from a smaller data folder.");
      if (!entry.folder && entry.name.toLowerCase().endsWith(".json")) {
        if (files.size >= limit) throw new Error(`Folder has more than ${limit} JSON files.`);
        files.set(entry.name, await entry.file());
      }
    }
    signal.throwIfAborted();
    return files;
  }
  async function setRoot(folder, signal) {
    clear();
    try {
      const found = await filesIn(await folder.directory("saves"), 500, signal);
      catalogue.setFiles(found);
    } catch (error) {
      signal.throwIfAborted();
      ui["save-note"].textContent = "Could not list saves in this root. Choose or drop a JSON save instead.";
    }
    refreshControls();
  }
  async function setMod(folder, label, signal) {
    resetMod();
    options(ui["track-choice"], "Reading circuit names…");
    ui["input-mod"].textContent = label;
    try {
      const found = await filesIn(await folder.directory("tracks"), 128, signal);
      const trackCatalogue = await request("track-options", [...found].map(([name, file]) => ({ name, file })), signal);
      signal.throwIfAborted();
      for (const option of trackCatalogue.options) allTracks.set(option.file, { file: found.get(option.file), name: option.name });
      options(ui["track-choice"], "Select a save first…");
      ui["track-note"].textContent = "Select a save to list circuits from its season calendar.";
      const [tyreFile, configFile] = await Promise.all([folder.file("tyremodel.json"), folder.file("config.json")]);
      const [available, axes] = await Promise.all([
        request("compound-options", tyreFile, signal),
        request("setup-options", configFile, signal),
      ]);
      signal.throwIfAborted();
      mod = folder;
      compounds.set(available);
      setSetupAxes(axes);
      if (save && savePack !== folder.name) {
        saveWarning(`Cleared ${save.name}: it uses data mod "${savePack}", while the selected folder is "${folder.name}".`);
        clearSave();
      }
      // The resolved folder identifier is the game's data_pack value, not a fuzzy title.
      catalogue.filter(folder.name);
      await loadCalendar(signal);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      // Metadata inspection remains useful for folders without circuit definitions.
      tracks.clear(); allTracks.clear(); compounds.set(); setSetupAxes();
      options(ui["track-choice"], "No circuits available");
      ui["track-note"].textContent = `Cannot use this mod for setup calculations: ${error.message}`;
    }
    refreshControls();
  }
  async function loadCalendar(signal) {
    if (!save || !mod || !allTracks.size) return;
    calendarDefault = null;
    tracks.clear(); options(ui["track-choice"], "Reading season calendar…");
    ui["session-summary"].textContent = "Detecting the next session from your save…";
    ui["track-choice"].value = "";
    ui["track-note"].textContent = "Resolving the next calendar event…";
    let calendar = null;
    try {
      // Missing test definitions omit unresolved tests, without admitting off-calendar tracks.
      let testFile;
      try { testFile = await mod.file("test.json"); } catch { /* Needed only for testing events. */ }
      signal.throwIfAborted();
      calendar = await request("season-calendar", { saveFile: save, testFile }, signal);
      signal.throwIfAborted();
      let missing = 0;
      for (const event of calendar.events) {
        const matches = [...allTracks.keys()].filter(name => name.toLowerCase() === `${event.track_id}.json`.toLowerCase());
        if (matches.length !== 1) { missing++; continue; }
        const file = matches[0], existing = tracks.get(file);
        // For repeated circuits, prefer the first remaining event to a completed test/race.
        if (!existing || existing.event.event_week < calendar.saved_week && event.event_week >= calendar.saved_week) {
          tracks.set(file, { ...allTracks.get(file), event });
        }
        if (event.event_week === calendar.next?.event_week) calendarDefault = { ...event, saved_week: calendar.saved_week, team: calendar.team, season: calendar.season, file, name: allTracks.get(file).name };
      }
      options(ui["track-choice"], tracks.size ? "Select a season circuit…" : "No season circuits available",
        [...tracks].sort(([, a], [, b]) => a.name.localeCompare(b.name)).map(([file, track]) => [file, track.name]));
      const issues = `${missing ? ` ${missing} calendar events have missing or ambiguous circuit files.` : ""}${calendar.issues.length ? ` ${calendar.issues.join(" ")}` : ""}`;
      if (calendarDefault) {
        const event = calendarDefault;
        ui["session-summary"].textContent = `${calendar.team || "Player team"}${calendar.season ? ` · Season ${calendar.season}` : ""} · Next event: week ${event.event_week}, ${event.name} (${event.testing ? "Testing" : "Race weekend"}).`;
        ui["track-choice"].value = event.file;
        ui["track-note"].textContent = `Calendar default: week ${event.event_week} — ${event.name} (${event.testing ? "Testing" : "Race weekend"}). Only this season's circuits are listed.${issues}`;
        write_log("calendar_default_selected", { calendar: calendarDefault });
      } else {
        ui["session-summary"].textContent = "Choose a circuit from this save's season calendar.";
        ui["track-note"].textContent = `${calendar.next_error}${issues}`;
        write_log("calendar_default_unavailable", { message: ui["track-note"].textContent });
      }
      write_log("season_circuits_selected", { circuits: tracks.size, events: calendar.events.length, unresolved_files: missing, issues: calendar.issues });
    } catch (error) {
      signal.throwIfAborted();
      tracks.clear(); options(ui["track-choice"], "No season circuits available");
      ui["track-note"].textContent = error.message;
      ui["session-summary"].textContent = "A valid save calendar is needed to select a circuit.";
      write_log("calendar_default_unavailable", { message: error.message });
    }
  }
  async function selectSave(file, signal) {
    saveChosen = true; defaultSave = null;
    if (!file || !file.name.toLowerCase().endsWith(".json")) throw new Error("Choose or drop one JSON save file.");
    clearSave(); saveWarning(); refreshControls();
    let summary;
    try {
      summary = await catalogue.summary(file, signal);
      signal.throwIfAborted();
      if (mod && summary.pack !== mod.name) throw new Error(`This save uses data mod "${summary.pack}"; the selected folder is "${mod.name}". Select the matching mod.`);
    } catch (error) { if (!signal.aborted) saveWarning(error.message); throw error; }
    save = file; savePack = summary.pack;
    ui["save-name"].textContent = file.name;
    ui["save-choice"].value = catalogue.matches.get(file.name) === file ? file.name : "";
    ui.status.textContent = "Checking the save's next event…";
    write_log("save_selected", { name: file.name, bytes: file.size });
    await loadCalendar(signal);
    signal.throwIfAborted();
    ui.status.textContent = "Save selected. Check the circuit and conditions, then find or grade setups.";
    refreshControls();
  }
  function clear() {
    defaultSave = null; saveChosen = false;
    mod = save = savePack = calendarDefault = preparationSignal = null;
    catalogue.setFiles(); compounds.set(); tracks.clear(); allTracks.clear(); setSetupAxes(); clearResult(); saveWarning();
    options(ui["save-choice"], "Select a data mod first…");
    options(ui["track-choice"], "Select a circuit…");
    for (const key of ["save-name", "save-note", "track-note", "input-mod"]) ui[key].textContent = "";
    ui["session-summary"].textContent = "Choose a save and its data mod to detect your team and next event.";
    refreshControls();
  }
  function resetMod() {
    defaultSave = null; saveChosen = false;
    mod = calendarDefault = null; tracks.clear(); allTracks.clear(); setSetupAxes(); clearResult();
    catalogue.filter(null); compounds.set(); saveWarning();
    options(ui["track-choice"], "Select a circuit…");
    ui["track-note"].textContent = ui["input-mod"].textContent = "";
    ui["session-summary"].textContent = "Select the data mod used by your save.";
    refreshControls();
  }
  ui["choose-save"].onclick = () => ui["save-file"].click();
  ui["save-file"].onchange = () => {
    const file = ui["save-file"].files[0]; ui["save-file"].value = "";
    if (file) job(signal => selectSave(file, signal));
  };
  ui["save-choice"].onchange = () => {
    const file = catalogue.matches.get(ui["save-choice"].value);
    job(async signal => {
      if (file) await selectSave(file, signal);
      else {
        saveChosen = true; defaultSave = null;
        clearSave(); saveWarning();
        write_log("save_cleared");
      }
    });
  };
  const drop = ui["drop-save"];
  drop.ondragover = event => { event.preventDefault(); if (isReady()) event.dataTransfer.dropEffect = "copy"; };
  drop.ondrop = event => {
    event.preventDefault();
    if (!isReady()) return;
    const files = [...event.dataTransfer.files];
    job(async signal => {
      if (files.length !== 1) throw new Error("Drop exactly one JSON save.");
      await selectSave(files[0], signal);
    });
  };
  for (const key of ["ambient", "water", "fuel-load", "driving-pace", "engine-mode", "pace-weight", "session-seed", "search-seconds", "search-refine", "search-stall", "search-idle", "search-cache", ...setupAxes.map(axis => axis.control)]) {
    ui[key].oninput = () => {
      if (key === "pace-weight") refreshWeights();
      // Scenario edits invalidate validation results, but folder/calendar work can finish.
      if (preparationSignal && !preparationSignal.aborted) invalidate();
      else clearResult();
    };
  }
  ui["reset-pace-weight"].onclick = () => {
    const control = ui["pace-weight"];
    control.value = control.defaultValue;
    // Follow the normal edit path so reset also clears results and cancels an active calculation.
    control.dispatchEvent(new Event("input", { bubbles: true }));
  };
  ui["track-choice"].oninput = () => {
    invalidate();
    ui["track-note"].textContent = ui["track-choice"].value
      ? `Circuit selected manually.${calendarDefault ? ` Calendar default: ${calendarDefault.name}, week ${calendarDefault.event_week}.` : ""}`
      : "Choose a circuit.";
    ui.status.textContent = "Circuit selected. Check the conditions, then find or grade setups.";
    write_log("circuit_selected", { file: ui["track-choice"].value, name: ui["track-choice"].selectedOptions[0]?.textContent || null, selection: "manual" });
  };
  async function calculate(signal, isSearch) {
    preparationSignal = signal;
    normaliseNumbers(document);
    ui.status.textContent = isSearch ? "Preparing saved inputs for local setup search..." : "Building reference setups and grading the entered setup locally…";
    const numeric = id => ui[id].value.trim() ? Number(ui[id].value) : NaN;
    const controls = ["ambient", "water", "fuel-load", "driving-pace", "engine-mode", "pace-weight", "session-seed", ...setupAxes.map(axis => axis.control),
      ...(isSearch ? ["search-seconds", "search-refine", "search-stall", "search-idle", "search-cache"] : [])];
    for (const id of controls) if (!ui[id].checkValidity()) {
      const section = ui[id].closest("details"); if (section) section.open = true;
      ui[id].focus(); ui[id].reportValidity();
      throw new Error(`Check ${ui[id].labels?.[0]?.textContent.trim() || "the session controls"}.`);
    }
    const limits = { seconds: numeric("search-seconds"), refine_laps: numeric("search-refine"), stall_laps: numeric("search-stall"), idle_batches: numeric("search-idle"), cache_entries: numeric("search-cache") };
    if (isSearch) searchLimits(limits);
    if (!compounds.values().length) throw new Error("Select at least one tyre compound.");
    const files = {};
    for (const name of DEFINITION_FILES) {
      try { files[name] = await mod.file(name); }
      catch { throw new Error(`The selected data mod is missing or cannot read ${name}.`); }
      signal.throwIfAborted();
    }
    const seed = ui["session-seed"].value.trim() ? numeric("session-seed") : Math.floor(Math.random() * 1000000);
    const track = tracks.get(ui["track-choice"].value);
    if (!track) throw new Error("Choose a circuit from this save's season calendar.");
    const payload = { saveFile: save, trackFile: track.file, files, seed, testing: track.event.testing,
      trackId: track.event.track_id,
      weather: { temperature_c: ui.ambient.value.trim() || ui.ambient.validity.badInput ? numeric("ambient") : null, wetness_mm: numeric("water") }, compounds: compounds.values(), dataPack: mod.name,
      driving: { fuel_kg: numeric("fuel-load"), pace: ui["driving-pace"].value, engine: ui["engine-mode"].value },
      paceWeightPct: numeric("pace-weight"),
      settings: Object.fromEntries(setupAxes.map(axis => [axis.key, numeric(axis.control)])),
      search: limits };
    const prepared = await search.prepareInputs(payload, signal);
    signal.throwIfAborted();
    const validation = write_input_logs(prepared, { save: save.name, mod: ui["input-mod"].textContent, calendar: calendarDefault });
    ui["session-summary"].textContent = `${prepared.source.team} · Season ${prepared.source.season}, week ${prepared.source.week} · ${prepared.source.track.name}.`;
    let lastLog = -Infinity;
    const progress = (checkpoint, reference) => {
      if (signal.aborted) return;
      if (checkpoint.grading.rows.length) showResult(checkpoint, { validation, diagnostics: false });
      ui.status.textContent = reference ? `Preparing ${reference.driver} / ${compoundName(reference.compound, prepared.source)} reference...`
        : isSearch ? `${checkpoint.search.status === "preparing" ? "Preparing reference setups" : "Searching for improvements"}: ${checkpoint.search.drivers_ready}/${checkpoint.search.drivers_total} driver entries ready; ${checkpoint.search.statistics.evaluated || 0} candidate laps.` : "Grading the entered setup...";
      if (isSearch && performance.now() - lastLog >= 500) {
        write_log("search_progress", { validation, phase: checkpoint.search.status, drivers_ready: checkpoint.search.drivers_ready,
          drivers_total: checkpoint.search.drivers_total, evaluated: checkpoint.search.statistics.evaluated || 0 });
        lastLog = performance.now();
      }
    };
    const result = await (isSearch ? search.run : search.grade)(prepared, payload, signal, progress);
    signal.throwIfAborted();
    if (result.grading.rows.length) { showResult(result, { validation }); ui["input-result-title"].focus(); }
    else { clearResult(); ui.status.textContent = "Stopped before an entry finished preparation."; }
    if (!isSearch && result.grading_status === "cancelled") ui.status.textContent = "Grading stopped; completed entries are shown.";
    if (!isSearch && result.grading_status === "worker_error") ui.status.textContent = `Grading stopped: ${result.grading_message} Completed entries are shown.`;
    if (isSearch) write_log("search_completed", { validation, ...result.search });
  }
  ui["prepare-inputs"].onclick = () => job(signal => calculate(signal, false));
  ui["search-setups"].onclick = () => job(signal => calculate(signal, true));
  clear();
  return { setRoot, setMod, resetMod, clear, clearResult, refreshControls, selectDefaultSave, stopScan: catalogue.stop };
}
