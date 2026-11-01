import { DEFINITION_FILES } from "./input-preparation.js";
import { write_log, write_input_logs } from "./debug-log.js";

/** Keep local file selections in memory and display the worker's checked source inputs. */
export function createInputPanel(ui, { job, request, invalidate, isReady, isBusy }) {
  let mod = null, save = null, calendarDefault = null, preparationSignal = null;
  const saves = new Map(), tracks = new Map();
  function options(select, placeholder, entries = []) {
    select.replaceChildren(new Option(placeholder, ""));
    for (const [value, label] of entries) select.add(new Option(label, value));
  }
  function clearResult() {
    ui["input-results"].hidden = true;
    ui["input-details"].replaceChildren();
    ui["input-summary"].textContent = "";
  }
  function refreshControls() {
    ui["choose-save"].disabled = !isReady();
    ui["save-choice"].disabled = !isReady() || !saves.size;
    ui["track-choice"].disabled = !isReady() || !tracks.size;
    ui["prepare-inputs"].disabled = !isReady() || isBusy() || !save || !mod || !ui["track-choice"].value;
    ui["drop-save"].setAttribute("aria-disabled", String(!isReady()));
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
      for (const entry of found) saves.set(...entry);
      options(ui["save-choice"], "Select a save…", [...saves.keys()].sort().map(name => [name, name]));
      ui["save-note"].textContent = `${saves.size} saves found. You can also choose or drop one JSON save.`;
    } catch (error) {
      signal.throwIfAborted();
      ui["save-note"].textContent = "Could not list saves in this root. Choose or drop a JSON save instead.";
    }
    refreshControls();
  }
  async function setMod(folder, label, signal) {
    mod = calendarDefault = null; tracks.clear(); clearResult();
    options(ui["track-choice"], "Reading circuit names…");
    ui["input-mod"].textContent = label;
    try {
      const found = await filesIn(await folder.directory("tracks"), 128, signal);
      const catalogue = await request("track-options", [...found].map(([name, file]) => ({ name, file })), signal);
      signal.throwIfAborted();
      for (const option of catalogue.options) tracks.set(option.file, found.get(option.file));
      options(ui["track-choice"], "Select a circuit…", catalogue.options.map(option => [option.file, option.name]));
      ui["track-note"].textContent = `${tracks.size} circuits available.${catalogue.errors.length ? ` ${catalogue.errors.length} unreadable circuit files were skipped.` : ""}`;
      mod = folder;
      await defaultCircuit(signal);
      signal.throwIfAborted();
    } catch (error) {
      signal.throwIfAborted();
      // Metadata inspection remains useful for folders without circuit definitions.
      options(ui["track-choice"], "No circuits available");
      ui["track-note"].textContent = `Input preparation is unavailable for this folder: ${error.message}`;
    }
    refreshControls();
  }
  async function defaultCircuit(signal) {
    if (!save || !mod || !tracks.size) return;
    calendarDefault = null;
    ui["track-choice"].value = "";
    ui["track-note"].textContent = "Resolving the next calendar event…";
    let event = null;
    try {
      // Missing test.json must not prevent a race default or a manual selection.
      let testFile;
      try { testFile = await mod.file("test.json"); } catch { /* Needed only for testing events. */ }
      signal.throwIfAborted();
      event = await request("default-circuit", { saveFile: save, testFile }, signal);
      signal.throwIfAborted();
      const matches = [...tracks.keys()].filter(name => name.toLowerCase() === `${event.track_id}.json`.toLowerCase());
      if (matches.length !== 1) throw new Error("The calendar circuit is missing or ambiguous in this mod. Select a circuit manually.");
      const file = matches[0];
      calendarDefault = { ...event, file, name: [...ui["track-choice"].options].find(option => option.value === file).textContent };
      ui["track-choice"].value = file;
      ui["track-note"].textContent = `Calendar default: week ${event.event_week} — ${calendarDefault.name} (${event.testing ? "Testing" : "Race weekend"}). You can choose another circuit.`;
      write_log("calendar_default_selected", { calendar: calendarDefault });
    } catch (error) {
      signal.throwIfAborted();
      ui["track-note"].textContent = error.message;
      write_log("calendar_default_unavailable", { message: error.message, calendar: event });
    }
  }
  async function selectSave(file, signal) {
    if (!file || !file.name.toLowerCase().endsWith(".json")) throw new Error("Choose or drop one JSON save file.");
    save = file;
    ui["save-name"].textContent = file.name;
    ui["save-choice"].value = saves.get(file.name) === file ? file.name : "";
    ui.status.textContent = "Checking the save's next event…";
    write_log("save_selected", { name: file.name, bytes: file.size });
    await defaultCircuit(signal);
    signal.throwIfAborted();
    ui.status.textContent = "Save selected. Check the circuit and conditions to prepare inputs.";
    refreshControls();
  }
  function clear() {
    mod = save = calendarDefault = preparationSignal = null;
    saves.clear(); tracks.clear(); clearResult();
    options(ui["save-choice"], "Select a save…");
    options(ui["track-choice"], "Select a circuit…");
    for (const key of ["save-name", "save-note", "track-note", "input-mod"]) ui[key].textContent = "";
    refreshControls();
  }
  function resetMod() {
    mod = calendarDefault = null; tracks.clear(); clearResult();
    options(ui["track-choice"], "Select a circuit…");
    ui["track-note"].textContent = ui["input-mod"].textContent = "";
    refreshControls();
  }
  function addDetail(title, lines) {
    const section = document.createElement("section"), heading = document.createElement("h3");
    heading.textContent = title; section.append(heading);
    for (const line of lines) {
      const paragraph = document.createElement("p"); paragraph.textContent = line; section.append(paragraph);
    }
    ui["input-details"].append(section);
  }
  ui["choose-save"].onclick = () => ui["save-file"].click();
  ui["save-file"].onchange = () => {
    const file = ui["save-file"].files[0]; ui["save-file"].value = "";
    if (file) job(signal => selectSave(file, signal));
  };
  ui["save-choice"].onchange = () => {
    const file = saves.get(ui["save-choice"].value);
    job(async signal => {
      if (file) await selectSave(file, signal);
      else {
        save = calendarDefault = null; ui["save-name"].textContent = "";
        ui["track-note"].textContent = "Select a save to choose the calendar default.";
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
  for (const key of ["ambient", "water", "input-compounds", "session-seed", "setup-front", "setup-rear", "setup-front-pressure", "setup-rear-pressure", "setup-suspension"]) {
    ui[key].oninput = () => {
      // Scenario edits invalidate validation results, but folder/calendar work can finish.
      if (preparationSignal && !preparationSignal.aborted) invalidate();
      else clearResult();
    };
  }
  ui["track-choice"].oninput = () => {
    invalidate();
    ui["track-note"].textContent = ui["track-choice"].value
      ? `Circuit selected manually.${calendarDefault ? ` Calendar default: ${calendarDefault.name}, week ${calendarDefault.event_week}.` : ""}`
      : "Choose a circuit.";
    ui.status.textContent = "Check the circuit and conditions to prepare inputs.";
    write_log("circuit_selected", { file: ui["track-choice"].value, name: ui["track-choice"].selectedOptions[0]?.textContent || null, selection: "manual" });
  };
  ui["prepare-inputs"].onclick = () => job(async signal => {
    preparationSignal = signal;
    ui.status.textContent = "Reading and validating calculation inputs in the browser worker…";
    const files = {};
    for (const name of DEFINITION_FILES) {
      try { files[name] = await mod.file(name); }
      catch { throw new Error(`The selected data mod is missing or cannot read ${name}.`); }
      signal.throwIfAborted();
    }
    const numeric = id => ui[id].value.trim() ? Number(ui[id].value) : NaN;
    const seed = ui["session-seed"].value.trim() ? numeric("session-seed") : Math.floor(Math.random() * 1000000);
    const result = await request("predict-laps", { saveFile: save, trackFile: tracks.get(ui["track-choice"].value), files, seed, testing: calendarDefault?.testing === true,
      trackId: calendarDefault?.file === ui["track-choice"].value ? calendarDefault.track_id : undefined,
      weather: { temperature_c: numeric("ambient"), wetness_mm: numeric("water") }, compounds: ui["input-compounds"].value,
      settings: { front_wing: numeric("setup-front"), rear_wing: numeric("setup-rear"), front_pressure_psi: numeric("setup-front-pressure"),
        rear_pressure_psi: numeric("setup-rear-pressure"), suspension_level: numeric("setup-suspension") } }, signal);
    signal.throwIfAborted();
    const input = result.source;
    const validation = write_input_logs(result, { save: save.name, mod: ui["input-mod"].textContent, calendar: calendarDefault });
    ui["input-summary"].textContent = `${input.team} · Season ${input.season}, week ${input.week} · ${input.track.name} · ${input.weather.temperature_c} °C · ${input.weather.wetness_mm} mm`;
    addDetail("Scenario", [
      `Data mod: ${ui["input-mod"].textContent}; saved pack reference: ${input.savedPack}.`,
      `Compounds: ${input.tyres.map(tyre => tyre.name.toUpperCase()).join(" / ")}. Saved rules: ${input.activePolicies.car.name}; ${input.activePolicies.tyres.name}.`,
      `Fixed setup: wings ${input.settings.front_wing}/${input.settings.rear_wing}; suspension ${input.settings.suspension_level}; pressures ${input.settings.front_pressure_psi}/${input.settings.rear_pressure_psi} psi.`,
      `Loaded ${result.fileNames.length} files and ${result.constantsCount} literal constants. Selected mod definitions must match this save's career.`,
      `Session seed: ${result.prediction.seed}; initial wind ${result.prediction.wind.speed_kmh.toFixed(1)} km/h, ${result.prediction.wind.direction_deg.toFixed(1)}°; worker time ${result.prediction.timing_ms.end_to_end.toFixed(0)} ms.`,
    ]);
    for (const row of result.prediction.rows) {
      const milliseconds = Math.round(row.lap_time_s * 1000), minutes = Math.floor(milliseconds / 60000);
      const time = `${minutes}:${((milliseconds % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
      addDetail(`${row.driver} | ${row.compound.toUpperCase()} | ${time}`, [
        `Predicted flying lap; warmed tyres ${row.tyre_temperature_c.toFixed(1)} °C; balance ${row.balance.toFixed(1)}, traction ${row.traction.toFixed(1)}.`,
      ]);
      write_log("lap_predicted", { validation, driver: row.driver, entry: row.entry, compound: row.compound,
        lap_time_s: row.lap_time_s, tyre_temperature_c: row.tyre_temperature_c,
        tyre_grip: [row.inputs.tyre_lat_mult, row.inputs.tyre_long_mult] });
    }
    write_log("lap_prediction_completed", { validation, seed: result.prediction.seed,
      wind: result.prediction.wind, timing_ms: result.prediction.timing_ms });
    for (const driver of input.drivers) addDetail(`${driver.name} — entry ${driver.entry}`, [
      `Skills: ${Object.entries(driver.skills).map(([key, value]) => `${key} ${value.toFixed(2)}`).join("; ")}.`,
      `Preferences: balance ${driver.preferences.balance_preference}; traction ${driver.preferences.traction_preference}.`,
      ...driver.parts.map(part => `${part.label}: ${part.item.name}${part.item.condition === undefined ? "" : ` (${part.item.condition.toFixed(1)}% condition)`}`),
    ]);
    ui["input-results"].hidden = false;
    ui.status.textContent = "Fixed-setup laps calculated locally. Grading and setup search are not included in this preview.";
  });
  clear();
  return { setRoot, setMod, resetMod, clear, clearResult, refreshControls };
}
