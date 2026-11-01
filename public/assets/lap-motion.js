// Curve speeds are km/h; the integrator uses metres, seconds and m/s internally.
const CURVE = [[0, 1.75], [50, 1.6], [100, 1.45], [150, 1.25], [200, .95], [250, .75], [300, .4], [330, .2], [350, .05]];

function curve(speed) {
  if (speed <= 0) return CURVE[0][1];
  for (let index = 1; index < CURVE.length; index++) {
    const [x1, y1] = CURVE[index], [x0, y0] = CURVE[index - 1];
    if (speed < x1) return Math.max(.05, y0 + (y1 - y0) * ((speed - x0) / (x1 - x0)));
  }
  return .05;
}

/** Integrate a closed flying lap with the game's one-metre spatial steps. */
export function integrateLap(distances, caps, brakes, tails, propulsion, drag, windy) {
  const count = caps.length;
  let start = 0;
  for (let index = 1; index < count; index++) if (caps[index] < caps[start]) start = index;
  const order = Array.from({ length: count }, (_, index) => (start + index) % count);
  const nodes = new Float64Array(count + 1).fill(caps[start]);
  function acceleration(speed, tail) {
    const fade = Math.max(0, Math.min(1, (speed - 5) / 15));
    const air = Math.max(0, speed - tail * fade);
    return Math.max(.05, propulsion * curve(speed * 3.6) - drag * air * air);
  }
  // Start at the slowest zone and propagate acceleration/braking around the loop.
  for (let iteration = 0; iteration < 12; iteration++) {
    const old = nodes.slice();
    nodes[0] = Math.min(nodes[0], caps[start]);
    for (let index = 0; index < count; index++) {
      const source = order[index], cap = caps[source], distance = distances[source];
      let speed = Math.min(nodes[index], cap), travelled = 0;
      while (travelled < distance - 1e-9 && speed < cap - 1e-9) {
        const step = Math.min(1, distance - travelled);
        speed = Math.min(cap, Math.sqrt(Math.max(0, speed * speed + 2 * acceleration(speed, tails[source]) * step)));
        travelled += step;
      }
      nodes[index + 1] = Math.min(cap, speed);
    }
    nodes[count] = Math.min(nodes[count], nodes[0], caps[start]);
    for (let index = count - 1; index >= 0; index--) {
      const source = order[index], speed = Math.min(nodes[index + 1], caps[source]);
      const maximum = Math.sqrt(Math.max(0, speed * speed + 2 * brakes[source] * distances[source]));
      nodes[index] = Math.min(nodes[index], caps[source], maximum);
    }
    nodes[count] = Math.min(nodes[count], nodes[0]);
    // Repeating an identical deterministic pass cannot improve the fixed point.
    if (nodes.every((value, index) => value === old[index])) break;
  }
  const entries = new Float64Array(count), exits = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    entries[order[index]] = nodes[index]; exits[order[index]] = nodes[index + 1];
  }
  let lap = 0;
  // Sum in original track order, preserving the reference's floating-point order.
  for (let index = 0; index < count; index++) {
    const distance = distances[index], brake = brakes[index], cap = caps[index];
    let speed = Math.max(.5, entries[index]), travelled = 0, duration = 0;
    while (travelled < distance - 1e-9) {
      const step = Math.min(1, distance - travelled);
      const needed = Math.max(0, (speed * speed - exits[index] * exits[index]) / (2 * brake));
      let rate;
      if (needed >= Math.max(0, distance - travelled - step * .5)) rate = -brake;
      else if (speed >= cap - 1e-9) rate = 0;
      else rate = acceleration(speed, tails[index]);
      let next = Math.sqrt(Math.max(0, speed * speed + 2 * rate * step));
      if (rate >= 0) next = Math.min(cap, next);
      duration += step / Math.max(.1, .5 * (speed + next));
      travelled += step; speed = Math.max(.5, next);
    }
    lap += windy ? duration : Math.max(.001, duration);
  }
  return Math.max(.001, lap);
}
