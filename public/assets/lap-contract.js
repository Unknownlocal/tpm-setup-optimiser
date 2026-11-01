// This boundary accepts prepared numerical inputs, not saved car ratings.
export const ENGINE_VERSION = 1;
export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
export const SPEED_BOUNDS = { low: [40, 220], med: [70, 280], high: [95, 340], corner: [40, 400], straight: [120, 420] };
const TYPES = [...Object.keys(SPEED_BOUNDS), "braking", "acceleration"];
const INPUT_DEFAULTS = {
  slow_rating_points: 0, med_rating_points: 0, high_rating_points: 0, corner_rating_points: 0,
  straight_rating_points: 0, team_pace_rating_points: 0, engine_pace_rating_points: 0,
  braking_rating_points: 0, acceleration_rating_points: 0, engine_power_rating: 50,
  car_mass_kg: 650, engine_mass_kg: 150, fuel_mass_kg: 0, mass_ref_kg: 800,
  driver_cornering_kmh_bonus: 0, driver_braking_ms2_bonus: 0, tyre_lat_mult: 1, tyre_long_mult: 1,
  oval_driver_discipline_rating: 10, oval_driver_control_rating: 10, wind_aero_efficiency_rating: 50,
  oval_trait_corner_kmh_delta: 0, oval_trait_brake_mult: 1, drs_extra_speed_kmh: 0,
};

export function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
export function finite(value, label, min = -Infinity, max = Infinity) {
  requireValue(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, `Invalid lap input: ${label}.`);
  return value;
}
function sectors(raw, label, targets) {
  requireValue(Array.isArray(raw) && raw.length > 0 && raw.length <= 2048, `${label} needs 1–2,048 sectors.`);
  const result = raw.map((sector, index) => {
    requireValue(sector && TYPES.includes(sector.type), `Unsupported ${label} sector ${index + 1}.`);
    const length = finite(sector.length_pct, `${label} sector length`, Number.MIN_VALUE, 100);
    let target = 0;
    if (targets && SPEED_BOUNDS[sector.type]) {
      const [low, high] = SPEED_BOUNDS[sector.type];
      target = clamp(finite(sector.target_speed_kmh, "target speed", Number.MIN_VALUE), low, high);
    }
    return { type: sector.type, length_pct: length, target_speed_kmh: target };
  });
  const total = result.reduce((sum, sector) => sum + sector.length_pct, 0);
  // Track definitions are relative lengths; prepared wind geometry already covers a lap.
  requireValue(targets || Math.abs(total - 100) <= 1e-8, "Prepared wind sectors must cover one complete lap.");
  const scale = targets ? 100 / total : 1;
  finite(scale, "sector length scale", Number.MIN_VALUE);
  for (const sector of result) {
    sector.length_pct *= scale;
    requireValue(sector.length_pct > 1e-9, "A sector is too short for this lap-engine slice.");
  }
  return result;
}

export function prepareContext({ version, track, car_profile = {}, wind = null, inputs }) {
  requireValue(version === ENGINE_VERSION, "Unsupported lap-engine contract version.");
  requireValue(track && typeof track === "object", "A track is required for lap physics.");
  const length = finite(track.length_km, "track length", 0.01, 25) * 1000;
  const micro = sectors(track.micro_sectors, "track", true);
  requireValue(car_profile && typeof car_profile === "object" && !Array.isArray(car_profile), "Invalid prepared car profile.");
  const profile = {};
  for (const key of ["corner_speed_multiplier", "acceleration_multiplier", "braking_multiplier", "drag_multiplier"]) {
    profile[key] = finite(car_profile[key] ?? 1, key, 0.01, 4);
  }
  for (const sector of micro) if (["low", "med", "high"].includes(sector.type)) sector.target_speed_kmh *= profile.corner_speed_multiplier;
  requireValue(Array.isArray(inputs) && inputs.length <= 64, "A lap batch supports at most 64 prepared inputs.");
  const candidates = inputs.map(raw => {
    requireValue(raw && typeof raw === "object" && !Array.isArray(raw), "Each prepared lap input must be an object.");
    requireValue(Object.keys(raw).every(key => Object.hasOwn(INPUT_DEFAULTS, key) || key === "drs_speed_windows"), "Unknown prepared lap-input field.");
    const value = {};
    for (const key of Object.keys(INPUT_DEFAULTS)) value[key] = finite(raw[key], key);
    // These require separate race/oval models; never ignore requested effects.
    for (const key of ["drs_extra_speed_kmh", "oval_trait_corner_kmh_delta", "oval_trait_brake_mult", "oval_driver_discipline_rating", "oval_driver_control_rating"]) {
      requireValue(value[key] === INPUT_DEFAULTS[key], "DRS and oval effects are outside this lap-engine slice.");
    }
    requireValue(Array.isArray(raw.drs_speed_windows) && raw.drs_speed_windows.length === 0, "DRS windows are outside this lap-engine slice.");
    return value;
  });
  let field = null;
  if (wind !== null) {
    requireValue(wind && typeof wind === "object", "Invalid prepared wind field.");
    const zones = sectors(wind.sectors, "wind", false), count = zones.length;
    field = { sectors: zones, brake_cap: finite(wind.brake_cap, "wind brake cap", 0, 1) };
    for (const key of ["sources", "losses", "tails"]) {
      requireValue(Array.isArray(wind[key]) && wind[key].length === count, `Wind ${key} must match its sector count.`);
      field[key] = wind[key].map(value => {
        finite(value, `wind ${key}`);
        if (key === "sources") requireValue(Number.isInteger(value) && value >= 0 && value < micro.length, "Invalid wind source-sector index.");
        if (key === "losses") requireValue(value >= 0 && value < 1, "Invalid wind corner loss.");
        if (key === "tails") requireValue(Math.abs(value) <= 100, "Wind tail speed exceeds this engine's supported range.");
        return value;
      });
    }
  }
  return { length, micro, profile, wind: field, inputs: candidates };
}

/** Numerical self-test data only; never use neutral inputs in place of save data. */
export function selfTestPayload() {
  return { version: ENGINE_VERSION, track: { length_km: 1,
    micro_sectors: [{ type: "straight", length_pct: 100, target_speed_kmh: 180 }] },
    inputs: [{ ...INPUT_DEFAULTS, drs_speed_windows: [] }] };
}
