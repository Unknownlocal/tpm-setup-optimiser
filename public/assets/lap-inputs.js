import { clamp, prepareContext, SPEED_BOUNDS, ENGINE_VERSION } from "./lap-contract.js";

const ATTR = { low: .084375, med: .09375, high: .15, corner: .15, straight: 0 };
const UNIVERSAL = { low: .045, med: .055, high: .07, corner: .07 };

function candidateMotion(model, input) {
  const referenceMass = Math.max(300, input.mass_ref_kg);
  const mass = Math.max(300, input.car_mass_kg + input.engine_mass_kg + Math.max(0, input.fuel_mass_kg));
  const cornerMass = clamp(1 + (Math.sqrt(referenceMass / mass) - 1) * .5, .84, 1.08);
  const steady = model.micro.map(sector => {
    const type = sector.type;
    if (!SPEED_BOUNDS[type]) return null;
    const points = input[`${type === "low" ? "slow" : type}_rating_points`] ?? 0;
    let speed = sector.target_speed_kmh + ATTR[type] * (type === "straight" ? 0 : points);
    if (type !== "straight") {
      speed += UNIVERSAL[type] * input.team_pace_rating_points;
      speed += input.driver_cornering_kmh_bonus;
      speed *= cornerMass;
      speed *= clamp(input.tyre_lat_mult, .3, 1.4);
    }
    return clamp(speed, ...SPEED_BOUNDS[type]);
  });
  function nearest(index, direction) {
    for (let next = index + direction; next >= 0 && next < steady.length; next += direction) if (steady[next] !== null) return steady[next];
    return null;
  }
  const targets = steady.map((value, index) => {
    if (value !== null) return value;
    // Transition-zone lookup does not wrap; the speed solver closes the lap later.
    const previous = nearest(index, -1), next = nearest(index, 1);
    return Math.max(5, previous === null && next === null ? 200 : Math.max(previous ?? 0, next ?? 0));
  });
  const accel = clamp((7 * model.profile.acceleration_multiplier + input.acceleration_rating_points * .015) * clamp(input.tyre_long_mult, .25, 1.5), 1, 10);
  const brake = clamp((12 * model.profile.braking_multiplier + input.braking_rating_points * .06 + input.driver_braking_ms2_bonus) * clamp(input.tyre_long_mult, .25, 1.5), 3, 16);
  const power = clamp(1 + .75 * (((750 + (clamp(input.engine_power_rating, 0, 100) - 50) * 4) / 750) - 1), .55, 1.45);
  const propulsion = accel * power * clamp(1 + (referenceMass / mass - 1) * .5, .7, 1.25);
  const drag = .00018 * model.profile.drag_multiplier * clamp(1 - input.straight_rating_points * .01, .55, 1.6);
  let caps, distances, brakes, tails;
  if (model.wind) {
    const field = model.wind, sensitivity = 2 ** ((50 - clamp(input.wind_aero_efficiency_rating, 0, 100)) / 50);
    const speeds = field.sources.map((source, index) => targets[source] * (1 - field.losses[index] * sensitivity) / 3.6);
    caps = speeds.map(speed => Math.max(.5, speed));
    distances = field.sectors.map(sector => model.length * sector.length_pct / 100);
    tails = field.tails;
    brakes = speeds.map((speed, index) => {
      const air = Math.max(0, speed - tails[index] * clamp((speed - 5) / 15, 0, 1));
      const delta = drag * (air ** 2 - speed ** 2), limit = brake * field.brake_cap;
      return Math.max(.05, brake + clamp(delta, -limit, limit));
    });
  } else {
    caps = targets.map(speed => Math.max(.5, speed / 3.6));
    distances = model.micro.map(sector => model.length * (sector.length_pct / 100));
    brakes = caps.map(() => brake); tails = caps.map(() => 0);
  }
  return [distances, caps, brakes, tails, propulsion, drag, model.wind !== null];
}

/** Prepare motion arrays from checked Formula inputs; integration lives in .NET. */
export function prepareLapRows(payload) {
  const model = prepareContext(payload);
  return model.inputs.map(input => candidateMotion(model, input));
}

/** Version, lap count, then per lap: sector count, propulsion, drag, wind flag,
 * followed by distances, speed caps, brakes and tailwinds (all doubles). */
export function packLaps(rows) {
  const packet = new Float64Array(2 + rows.reduce((sum, row) => sum + 4 + 4 * row[1].length, 0));
  packet.set([ENGINE_VERSION, rows.length]);
  let offset = 2;
  for (const [distances, caps, brakes, tails, propulsion, drag, windy] of rows) {
    packet.set([caps.length, propulsion, drag, Number(windy)], offset); offset += 4;
    for (const array of [distances, caps, brakes, tails]) { packet.set(array, offset); offset += array.length; }
  }
  return packet;
}
