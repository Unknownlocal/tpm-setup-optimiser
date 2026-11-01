import { clamp, prepareContext, SPEED_BOUNDS, ENGINE_VERSION, selfTestPayload } from "./lap-contract.js";
import { integrateLap } from "./lap-motion.js";

const ATTR = { low: .084375, med: .09375, high: .15, corner: .15, straight: 0 };
const UNIVERSAL = { low: .045, med: .055, high: .07, corner: .07 };

function candidateTime(model, input) {
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
  return integrateLap(distances, caps, brakes, tails, propulsion, drag, model.wind !== null);
}

/** Solve only prepared Formula inputs; save reconstruction and grading are separate. */
export async function simulateLaps(payload, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const started = performance.now();
  const model = prepareContext(payload), times = [];
  const contextMs = performance.now() - started;
  let solveMs = 0;
  for (const [index, input] of model.inputs.entries()) {
    signal.throwIfAborted();
    const lapStarted = performance.now();
    const seconds = candidateTime(model, input);
    solveMs += performance.now() - lapStarted;
    if (!Number.isFinite(seconds)) throw new Error("Lap physics produced a non-finite time.");
    times.push(seconds);
    // Short groups avoid per-lap timer overhead while keeping cancellation responsive.
    if ((index + 1) % 4 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return { version: ENGINE_VERSION, lap_times_s: times,
    timing_ms: { context: contextMs, solve: solveMs, total: performance.now() - started } };
}

export async function lapEngineReadiness() {
  const result = await simulateLaps(selfTestPayload());
  if (Math.abs(result.lap_times_s[0] - 20) > 1e-9) throw new Error("The browser lap engine failed its numerical self-test.");
  return { version: ENGINE_VERSION, scope: "prepared-formula-inputs", self_test: "passed" };
}
