import { clamp, finite, requireValue } from "./lap-contract.js";

const ZONES = ["slow", "med", "high", "straight"];
const MAIN = ["team_pace", "acceleration", "braking", "tyre_management", "aero_efficiency_rating"];
export const partFor = (driver, category) => driver.parts.find(part => part.category === category);

/** Only accept the fitted baseline format verified for this first end-to-end slice.
 * Developed/older chassis effects need their own parity gate before they are usable. */
export function fittedCar(source, driver) {
  const chassisItem = partFor(driver, "chassis").item, effect = chassisItem.effect;
  const baseline = effect.baseline_targets;
  const designYear = chassisItem.design_year ?? Number(/^C(\d+)-/u.exec(chassisItem.name)?.[1] || source.calendarYear);
  requireValue(baseline && !effect.seasonal_package && !chassisItem.name.toLowerCase().includes("(old)") && designYear >= source.calendarYear,
    "This lap preview needs a fitted chassis with a current baseline snapshot.");
  requireValue(!effect.baseline_edit_keys?.length, "Edited chassis baseline limits are not supported by this lap preview yet.");
  for (const part of driver.parts.filter(part => source.definitions.car_parts.order.includes(part.category))) {
    const e = part.item.effect;
    const deltas = [...Object.values(e.rating_effects || {}), ...Object.values(e.pace || {}), ...Object.values(e.attr || {}),
      ...["team_pace", "acceleration", "braking", "car_mass_kg", "lap_time", "aero_efficiency_rating", "tyre_wear", "tyre_management", "reliability", "dirty_air", "year_old_debuff"].map(key => e[key] || 0)];
    requireValue(!e.seasonal_package && deltas.every(value => value === 0), `Developed effects on ${part.item.name} are not supported by this lap preview yet.`);
  }
  const row = {};
  for (const key of [...ZONES, ...MAIN]) row[key] = clamp(finite(baseline[key], `fitted chassis ${key}`), 0, 100);
  row.car_mass_kg = finite(effect.car_mass_kg_target ?? effect.car_mass_kg_current, "fitted chassis mass", 300);
  row.car_mass_kg = Math.max(row.car_mass_kg, 640);
  for (const key of [...ZONES, ...MAIN]) row[key] = Math.min(row[key], clamp(finite(effect.potential?.[key], `fitted chassis potential ${key}`), 0, 100));
  const attrs = { ...row };
  // The desktop adapter builds a fresh session with the default electronics ban.
  // It does not apply the saved regulation manager's pending/runtime effects.
  const level = key => ["active_suspension", "traction_control", "abs"].includes(key) ? 0
    : clamp(Math.trunc(partFor(driver, key)?.item.level || 0), 0, 5);
  const supplier = {};
  for (const part of driver.parts.filter(part => part.supplierDefinition)) {
    const rating = clamp(clamp((part.supplierDefinition.pace_rating ?? 50) + (part.supplierState.pace_offset || 0), 1, 100) + (part.item.pace_bonus || 0), 1, 100);
    const scale = rating >= 50 ? (rating - 50) / 50 : -(50 - rating) / 49;
    const mappings = { fuel: [["acceleration", 3]], gearbox: [["acceleration", 2], ["straight", 2]], suspension: [["slow", 5]], brakes: [["braking", 5]], ecu: [["team_pace", 1]] };
    requireValue(mappings[part.category], `Unsupported supplier category ${part.category}.`);
    for (const [key, cap] of mappings[part.category]) supplier[key] = (supplier[key] || 0) + scale * cap;
    if (part.category === "fuel") {
      const preferred = (part.supplierDefinition.preferred_engine || "").toLowerCase().replace(/[^a-z0-9]/gu, "");
      const signatures = source.teamInputs.engineSignatures.map(value => String(value).toLowerCase().replace(/[^a-z0-9]/gu, ""));
      if (preferred && signatures.includes(preferred)) supplier.acceleration += 1;
    }
  }
  for (const key of [...ZONES, "acceleration", "braking"]) attrs[key] = clamp(attrs[key], 0, 100) - 50 + (supplier[key] || 0);
  attrs.straight += level("active_aero");
  attrs.team_pace = clamp(row.team_pace, 0, 100) - 50 + (supplier.team_pace || 0);
  return { attrs, chassis: effect, aero: row.aero_efficiency_rating, wetBonus: level("active_aero"), protectedTemperature: level("advanced_tpms") === 5 };
}

function roundEven(value) {
  const low = Math.floor(value), fraction = value - low;
  return fraction === .5 ? low + (low % 2) : Math.round(value);
}

/** Preserve both wear stages present in the desktop adapter's native pipeline. */
export function enginePower(source, driver) {
  const engine = partFor(driver, "engine").item, rules = source.definitions.engines.unit_rules;
  const quantum = Math.max(.01, rules.power_rating_wear_quantum || .25);
  const maxLoss = rules.max_power_rating_loss_at_zero_condition ?? 6.25;
  const precise = engine.power_precision_version >= 2;
  const worn = (rating, condition) => {
    const loss = (1 - clamp(condition, 0, 100) / 100) * maxLoss;
    return precise ? rating - roundEven(loss / quantum) * quantum : roundEven((rating - loss) / quantum) * quantum;
  };
  const first = clamp(worn(clamp(engine.power_rating || 50, 1, 100), engine.condition ?? 100), 1, 100);
  // The native second stage treats a zero condition as missing; preserve its fallback.
  return clamp(worn(first, engine.condition || 100), 0, 100);
}
