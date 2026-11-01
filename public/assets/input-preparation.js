import { parseConstants } from "./python-literals.js";

export const DEFINITION_FILES = ["config.json", "tyremodel.json", "parts.json", "car_parts.json",
  "car_concepts.json", "engines.json", "regulations.json", "options.json", "constants.py"];
const COMPOUNDS = { S: "soft", M: "medium", H: "hard", I: "intermediate", W: "wet" };

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function object(value, label) {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object.`);
  return value;
}
function text(value, label) {
  requireValue(typeof value === "string" && value.trim().length > 0, `${label} is missing.`);
  return value.trim();
}
function number(value, label, min = -Infinity, max = Infinity) {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max,
    `${label} must be a finite number${Number.isFinite(min) && Number.isFinite(max) ? ` between ${min} and ${max}` : ""}.`);
  return value;
}
function list(value, label) {
  requireValue(Array.isArray(value), `${label} must be a list.`);
  return value;
}
function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
}

export async function readJson(file, label, maxBytes = 8 * 1024 * 1024) {
  requireValue(file && file.size > 0 && file.size <= maxBytes, `${label} is missing, empty or exceeds its size limit.`);
  try { return JSON.parse((await file.text()).replace(/^\uFEFF/u, "")); }
  catch { throw new Error(`${label} is unreadable or is not valid JSON.`); }
}

export async function trackOptions(files) {
  const options = [], errors = [];
  for (const { name, file } of files) {
    try {
      const track = object(await readJson(file, name), name);
      options.push({ file: name, name: text(track.name, `${name}: circuit name`) });
    } catch (error) { errors.push(error.message); }
  }
  options.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
  return { options, errors };
}

function validateTrack(raw) {
  object(raw, "Circuit"); text(raw.name, "Circuit name");
  number(raw.length_km, "Circuit length", Number.MIN_VALUE);
  const sectors = list(raw.micro_sectors, "Circuit micro sectors");
  requireValue(sectors.length > 0 && sectors.length <= 5000, "Circuit needs between 1 and 5,000 micro sectors.");
  for (const [index, sector] of sectors.entries()) {
    object(sector, `Micro sector ${index + 1}`);
    requireValue(["low", "med", "high", "straight"].includes(sector.type), `Unsupported micro-sector type at ${index + 1}.`);
    number(sector.length_pct, `Micro sector ${index + 1} length`, Number.MIN_VALUE);
    number(sector.target_speed_kmh, `Micro sector ${index + 1} target speed`, Number.MIN_VALUE);
  }
  return pick(raw, ["name", "length_km", "micro_sectors", "points", "sector_splits", "fuel_consumption", "tyre_wear_mult", "lap_modifier", "drs_zones", "nationality"]);
}

function activePolicy(save, definitions, key) {
  const category = list(definitions.categories, "Regulation categories").find(item => item.key === key);
  requireValue(category, `regulations.json has no ${key} definition.`);
  const current = object(save.regulations, "Saved regulations")[key]?.current;
  requireValue(current !== undefined && current !== null, `The save has no active ${category.label || key} rule.`);
  const option = list(category.options, `${key} options`).find(item => item.key === current || item.id === current);
  requireValue(option, `The active ${category.label || key} rule is not defined in this data mod.`);
  return option;
}

function setupInputs(config, supplied) {
  const setup = object(config.car_setup, "config.json: car_setup");
  const wings = object(setup.wing_levels, "Wing settings");
  const pressures = object(setup.tyre_pressures, "Tyre pressure settings");
  const suspension = object(setup.suspension_setup, "Suspension settings");
  const result = {};
  for (const [key, min, max, step] of [
    ["front_wing", wings.min_level, wings.max_level, 1], ["rear_wing", wings.min_level, wings.max_level, 1],
    ["front_pressure_psi", pressures.front?.min_psi, pressures.front?.max_psi, pressures.front?.step_psi],
    ["rear_pressure_psi", pressures.rear?.min_psi, pressures.rear?.max_psi, pressures.rear?.step_psi],
    ["suspension_level", suspension.min_level, suspension.max_level, 1],
  ]) {
    number(min, `${key} minimum`); number(max, `${key} maximum`, min); number(step, `${key} step`, Number.MIN_VALUE);
    const value = number(supplied[key], key, min, max);
    requireValue(Math.abs((value - min) / step - Math.round((value - min) / step)) < 1e-7, `${key} does not match the configured step.`);
    result[key] = value;
  }
  return { settings: result, definitions: setup };
}

function fittedItem(store, binding, label) {
  object(store, label);
  requireValue((typeof binding === "number" || typeof binding === "string") && Object.hasOwn(object(store.items, `${label} items`), String(binding)),
    `${label} has no fitted item in this save. No spare will be substituted.`);
  const item = object(store.items[String(binding)], label);
  text(item.name, `${label}: friendly item name`);
  if (item.condition !== undefined) number(item.condition, `${label} condition`, 0, 100);
  return item;
}

function driverInputs(save, team, definitions) {
  const slots = list(team.formula_entry_slots, "Registered Formula entry slots");
  requireValue(slots.length > 0, "This team has no registered Formula entries.");
  const drivers = list(save.drivers, "Saved drivers");
  const seen = new Set();
  const entryNumbers = new Set();
  return [...slots].sort((a, b) => a.number - b.number).map(slot => {
    const name = text(slot.driver_name, "Registered entry driver");
    requireValue(!seen.has(name), `Duplicate registered entry for ${name}.`); seen.add(name);
    const matches = drivers.filter(driver => driver.name === name);
    requireValue(matches.length === 1, `The save must contain exactly one driver named ${name}.`);
    const driver = matches[0];
    requireValue(driver.contract?.team === save.player_team, `${name} is not contracted to the player team.`);
    requireValue(!driver.retired && !driver.deceased && !(driver.injury_weeks > 0), `${name} is not available in this save.`);
    requireValue(Number.isInteger(slot.number) && slot.number > 0 && !entryNumbers.has(slot.number), "Entry numbers must be positive and unique.");
    entryNumbers.add(slot.number);
    const skills = Object.fromEntries(["cornering", "braking", "consistency", "smoothness", "control"]
      .map(key => [key, number(driver[key], `${name}: ${key}`, 0, 20)]));
    const preferences = Object.fromEntries(["balance_preference", "traction_preference"]
      .map(key => [key, number(driver[key], `${name}: ${key}`, 0, 100)]));
    const parts = [];
    const order = list(definitions.car_parts.order, "Car part order");
    requireValue(order.includes("chassis") && new Set(order).size === order.length, "Car part order needs a chassis and unique slots.");
    for (const key of order) {
      const definition = object(definitions.car_parts.parts?.[key], `Car part definition ${key}`);
      const item = fittedItem(team.car_parts, team.car_parts?.installed?.[name]?.[key], `${name}: ${definition.label || key}`);
      requireValue(item.key === key, `${name}: fitted car part does not match its slot.`);
      object(item.effect, `${name}: ${definition.label || key} effects`);
      parts.push({ category: key, label: text(definition.label, `Part label ${key}`), item });
    }
    const engine = fittedItem(team.engine_parts, team.engine_parts?.installed?.[name], `${name}: engine`);
    for (const key of ["power_rating", "mass_kg", "fuel_efficiency"]) number(engine[key], `${name}: engine ${key}`, 0);
    parts.push({ category: "engine", label: "Engine", item: engine });
    const supplierBindings = object(team.supplier_parts?.installed?.[name], `${name}: fitted supplier parts`);
    const categories = object(definitions.parts.categories, "Supplier part definitions");
    requireValue(Object.keys(supplierBindings).every(key => Object.hasOwn(categories, key)), `${name}: unsupported supplier part slot.`);
    for (const key of Object.keys(categories)) {
      const definition = object(definitions.parts.categories?.[key], `Supplier part category ${key}`);
      const item = fittedItem(team.supplier_parts, supplierBindings[key], `${name}: ${definition.label || key}`);
      requireValue(item.category === key, `${name}: supplier part does not match its slot.`);
      const supplierDefinition = object(definition.suppliers?.[item.supplier], `${name}: supplier definition for ${item.name}`);
      parts.push({ category: key, label: text(definition.label, `Supplier label ${key}`), item,
        supplierDefinition, supplierState: save.parts_manager?.suppliers?.[key]?.[item.supplier] || {} });
    }
    const aids = team.driver_aid_parts?.installed?.[name] || {};
    for (const [key, binding] of Object.entries(aids)) {
      const item = fittedItem(team.driver_aid_parts, binding, `${name}: driver aid`);
      requireValue(item.aid_key === key, `${name}: driver aid does not match its slot.`);
      parts.push({ category: key, label: "Driver aid", item });
    }
    const ersBinding = team.ers_parts?.installed?.[name];
    if (ersBinding !== undefined && ersBinding !== null) {
      const item = fittedItem(team.ers_parts, ersBinding, `${name}: ERS`);
      object(item.stats, `${name}: fitted ERS statistics`);
      parts.push({ category: "ers", label: "ERS", item });
    }
    return { name, entry: number(slot.number, `${name}: entry number`, 1), skills, preferences,
      traits: driver.traits || [], confidenceEffects: driver.confidence_effects || [],
      moraleEffects: driver.morale_effects || [], parts };
  });
}

/** Read local source data. Keep unrelated save and options fields out of the result. */
export async function prepareInputs({ saveFile, trackFile, files, weather, settings, compounds }) {
  object(files, "Definition files");
  const total = saveFile?.size + trackFile?.size + Object.values(files).reduce((sum, file) => sum + file.size, 0);
  requireValue(total <= 96 * 1024 * 1024, "Selected input files exceed 96 MiB.");
  const save = object(await readJson(saveFile, "Save", 64 * 1024 * 1024), "Save");
  requireValue(save.schema_version === 3 && (save.game_mode || "formula") === "formula", "Only schema-version 3 Formula saves are currently supported.");
  const teamName = text(save.player_team, "Player team");
  const team = object(object(save.teams, "Saved teams")[teamName], "Player team");
  const attributes = object(team.attr, "Saved car attributes");
  for (const key of ["slow", "med", "high", "straight"]) number(attributes[key], `Car ${key} attribute`, 0);
  for (const key of ["team_pace", "braking", "acceleration", "tyre_management", "aero_efficiency_rating"]) number(team[key], `Car ${key}`, 0);
  number(team.car_mass_kg, "Car mass", Number.MIN_VALUE);
  const definitions = {};
  for (const name of DEFINITION_FILES) {
    if (name === "constants.py") {
      requireValue(files[name]?.size > 0 && files[name].size <= 1024 * 1024, "constants.py is missing, empty or exceeds 1 MiB.");
      definitions.constants = parseConstants((await files[name].text()).replace(/^\uFEFF/u, ""));
    } else {
      const raw = object(await readJson(files[name], name), name);
      definitions[name.slice(0, -5)] = name === "options.json" ? pick(raw, ["variability_level", "wind_enabled"]) : raw;
    }
  }
  const track = validateTrack(await readJson(trackFile, "Selected circuit"));
  const selectedSetup = setupInputs(definitions.config, settings);
  const carPolicy = activePolicy(save, definitions.regulations, "car_profile");
  const tyrePolicy = activePolicy(save, definitions.regulations, "tyre_profile");
  // Match the game's profile normalisation, including older durability-delta definitions.
  let wearMultiplier = tyrePolicy.wear_rate_multiplier;
  if (wearMultiplier === undefined) {
    let delta = number(tyrePolicy.durability_rating_delta ?? tyrePolicy.durability_delta ?? 0, "Tyre durability delta");
    if (Math.abs(delta) > 0 && Math.abs(delta) <= 1) delta *= 100;
    wearMultiplier = 1 - delta / 150;
  }
  wearMultiplier = Math.max(0.5, Math.min(2, number(wearMultiplier, "Tyre wear multiplier")));
  const available = object(definitions.tyremodel.compounds, "Tyre compound definitions");
  const codes = [...new Set(text(compounds, "Compound codes").toUpperCase())];
  requireValue(codes.every(code => Object.hasOwn(COMPOUNDS, code)), "Use compound codes S, M, H, I or W.");
  const tyres = Object.entries(COMPOUNDS).filter(([code]) => codes.includes(code)).map(([, name]) => {
    const compound = object(available[name], `Compound ${name}`);
    number(compound.lat_grip_base, `${name} lateral grip`, Number.MIN_VALUE);
    number(compound.long_grip_base, `${name} longitudinal grip`, Number.MIN_VALUE);
    const bands = list(compound.wetness_states, `${name} wetness bands`);
    requireValue(bands.length > 0, `${name} has no wetness bands.`);
    for (const band of bands) {
      object(band, `${name} wetness band`);
      number(band.min_mm, `${name} wetness minimum`, 0);
      number(band.max_mm, `${name} wetness maximum`, band.min_mm);
      for (const key of ["lat_mult", "long_mult", "wear_mult"]) number(band[key], `${name} ${key}`, 0);
    }
    const window = list(compound.temp_window_c, `${name} temperature window`);
    requireValue(window.length === 2, `${name} temperature window needs two values.`);
    number(window[0], `${name} minimum temperature`); number(window[1], `${name} maximum temperature`, window[0]);
    const base = number(compound.wear_rate_base, `${name} base wear`, 0);
    return { ...compound, name, wear_rate_base: wearMultiplier === 1 ? base
      : Math.max(0.001, Math.min(0.2, base * wearMultiplier)) };
  });
  const drivers = driverInputs(save, team, definitions);
  const supplierName = text(team.tyre_contract?.supplier, "Saved tyre supplier");
  const tyreSupplier = object(save.tyre_manager?.suppliers?.[supplierName], "Saved tyre supplier ratings");
  const source = {
    version: 1, team: teamName, season: number(save.season_no, "Saved season", 1),
    calendarYear: number(save.save_editor_calendar_year ?? (definitions.constants.SEASON_START_YEAR ?? 2025) + save.season_no - 1, "Calendar year", 1),
    week: number(save.week_index, "Saved week index", 0) + 1,
    savedPack: text(save.data_pack, "Saved data pack"), track, drivers,
    weather: { temperature_c: number(weather.temperature_c, "Manual ambient temperature"),
      wetness_mm: number(weather.wetness_mm, "Water depth", 0, 5) },
    settings: selectedSetup.settings, setupDefinitions: selectedSetup.definitions,
    teamInputs: pick(team, ["attr", "team_pace", "braking", "acceleration", "car_mass_kg", "tyre_management",
      "aero_efficiency_rating", "chassis_profile", "part_understanding_laps", "tyre_contract"]),
    tyreSupplier: { ...tyreSupplier, name: supplierName }, tyres,
    activePolicies: { car: carPolicy, tyres: tyrePolicy }, regulations: save.regulations,
    sessionOptions: definitions.options,
    dynamicsStaff: list(save.staff, "Saved staff").filter(staff => staff.contract?.team === teamName && staff.role === "head_of_dynamics")
      .map(staff => pick(staff, ["skill", "skills", "morale_effects"])),
    definitions,
  };
  const engineNames = [team.engine, team.engine_supplier, team.engine_contract?.supplier, team.engine_contract?.engine].filter(value => typeof value === "string");
  source.teamInputs.engineSignatures = [...engineNames, ...engineNames.map(name => definitions.engines.suppliers?.[name]?.engine).filter(value => typeof value === "string")];
  // JSON accepts overlarge exponents as Infinity; reject unusable numeric inputs.
  function finiteTree(value, depth = 0) {
    requireValue(depth <= 64, "Input definitions are nested too deeply.");
    if (typeof value === "number") requireValue(Number.isFinite(value), "Input definitions contain a non-finite number.");
    if (value && typeof value === "object") for (const child of Object.values(value)) finiteTree(child, depth + 1);
  }
  finiteTree(source);
  return { source, fileNames: [saveFile.name, trackFile.name, ...DEFINITION_FILES],
    constantsCount: Object.keys(definitions.constants).length };
}
