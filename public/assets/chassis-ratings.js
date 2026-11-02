import { finite, requireValue } from "./lap-contract.js";
import { ZONES, CAR_RATINGS, normaliseEffect, scaleEffect, understanding, applyPartEffect, hasEffects, effectNumber, clampCarRating } from "./part-effects.js";

const OLD_KEYS = [...ZONES, "team_pace", "acceleration", "braking"];

function designIdentity(item) {
  const id = /^chassis:(\d+):(\d+)$/u.exec(item.design_id || "");
  const name = /^C(\d+)-(\d+)$/u.exec(item.name || "");
  return id ? [+id[1], +id[2]] : name ? [+name[1], +name[2]] : [item.design_year, null];
}

function resolveChassis(item, designs) {
  if (hasEffects(item.effect)) return item;
  const design = designs.find(entry => item.design_id
    ? `chassis:${entry.year}:${entry.index}` === item.design_id : entry.name === item.name);
  if (!hasEffects(design?.effect)) return item;
  const resolved = { ...item, effect: design.effect };
  // Seasonal inheritance needs the design identity even when its name is free text.
  if (!Object.hasOwn(resolved, "design_id") && design.year > 0 && design.index > 0) resolved.design_id = `chassis:${design.year}:${design.index}`;
  if (!Object.hasOwn(resolved, "design_year") && design.year > 0) resolved.design_year = design.year;
  return resolved;
}

function seasonalEffect(raw, item, designs, multiplier) {
  const total = normaliseEffect(raw).rating_effects || {};
  let inherited = raw.inherited_rating_effects || {}, step = raw.step_rating_effects || {};
  if (!hasEffects(inherited) && !hasEffects(step)) {
    const [year, index] = designIdentity(item);
    const previous = index > 1 && designs.find(design => design.year === year && design.index === index - 1);
    inherited = normaliseEffect(previous?.effect || {}).rating_effects || {};
  }
  if (!hasEffects(step)) step = Object.fromEntries([...new Set([...Object.keys(total), ...Object.keys(inherited)])]
    .map(key => [key, effectNumber(total[key]) - effectNumber(inherited[key])]));
  const keys = new Set([...Object.keys(total), ...Object.keys(inherited), ...Object.keys(step)]);
  return { ...raw, rating_effects: Object.fromEntries([...keys].map(key => [key, effectNumber(inherited[key]) + effectNumber(step[key]) * multiplier])) };
}

/** Rebuild the fitted package once, before any candidate laps are generated. */
export function fittedRatings(source, driver) {
  const designs = source.teamInputs.chassis_designs || [];
  const fitted = driver.parts.filter(part => source.definitions.car_parts.order.includes(part.category));
  const item = resolveChassis(fitted.find(part => part.category === "chassis").item, designs), chassis = item.effect;
  const baseline = chassis.baseline_targets;
  requireValue(hasEffects(baseline), "This lap preview needs a fitted chassis baseline snapshot.");
  const unbounded = new Set([...(chassis.baseline_edit_keys || []), "aero_efficiency_rating"]);
  const row = Object.fromEntries(CAR_RATINGS.map(key => {
    const value = finite(baseline[key], `Fitted chassis ${key}`);
    return [key, unbounded.has(key) && key !== "aero_efficiency_rating" ? value : clampCarRating(key, value)];
  }));
  row.car_mass_kg = Math.max(640, finite(chassis.car_mass_kg_target ?? chassis.car_mass_kg_current, "Fitted chassis mass"));
  const year = item.design_year ?? /^C(\d+)-/u.exec(item.name)?.[1];
  const old = item.name.toLowerCase().includes("(old)") || (year != null && year < source.calendarYear);
  const penalty = Math.max(0, source.definitions.constants.OLD_CHASSIS_RATING_PENALTY ?? 5);
  for (const part of fitted) {
    const isChassis = part.category === "chassis", installed = isChassis ? item : part.item;
    let raw = { ...installed.effect };
    if (isChassis && old) {
      raw.rating_effects = { ...raw.rating_effects };
      for (const key of OLD_KEYS) raw.rating_effects[key] = Math.min(effectNumber(raw.rating_effects[key]), -penalty);
    }
    const multiplier = understanding(source, part.category, installed);
    const effect = isChassis && raw.seasonal_package ? seasonalEffect(raw, installed, designs, multiplier) : scaleEffect(raw, multiplier);
    if (isChassis) {
      // The baseline already contains chassis aero and non-seasonal gains. Keep
      // incremental seasonal gains and the old-chassis penalty without adding mass twice.
      delete effect.aero_efficiency_rating;
      if (effect.rating_effects) effect.rating_effects = { ...effect.rating_effects };
      if (effect.rating_effects) delete effect.rating_effects.aero_efficiency_rating;
      if (!effect.seasonal_package) {
        for (const key of ["pace", "attr", "team_pace", "tyre_management", "tyre_wear", "car_mass_kg", "lap_time"]) delete effect[key];
        for (const key of [...ZONES, "team_pace", "tyre_management", "car_mass_kg"]) {
          if (!(old && effectNumber(effect.rating_effects?.[key]) < 0) && effect.rating_effects) delete effect.rating_effects[key];
        }
      } else {
        delete effect.car_mass_kg;
        if (effect.rating_effects) delete effect.rating_effects.car_mass_kg;
      }
      if (old) {
        // Understanding must not weaken the old-chassis penalty.
        effect.rating_effects ||= {};
        for (const key of OLD_KEYS) effect.rating_effects[key] = Math.min(effectNumber(effect.rating_effects[key]), -penalty);
      }
    }
    applyPartEffect(row, effect, unbounded, source.definitions.constants);
  }
  for (const key of CAR_RATINGS) {
    const potential = chassis.potential?.[key] ?? source.teamInputs.chassis_profile?.potential?.[key];
    row[key] = Math.min(clampCarRating(key, row[key]), clampCarRating(key, finite(potential, `Fitted chassis potential ${key}`)));
  }
  return { row, chassis };
}
