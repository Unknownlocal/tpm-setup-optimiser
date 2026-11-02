import { createLapScenario } from "./lap-scenario.js";
import { solveReference } from "./setup-reference.js";
import { CompoundScorer } from "./compound-scorer.js";
import { AverageScorer } from "./average-scorer.js";
import { PythonRandom } from "./python-random.js";
import { searchLimits, candidatesFor, advanceSearch } from "./search-settings.js";
import { createSettingSpace } from "./setup-model.js";

export async function prepareDriver(source, payload, name, signal, onReference = () => {}) {
  const limits = searchLimits(payload.search), space = createSettingSpace(source.setupAxes), bounds = space.bounds;
  const scenario = await createLapScenario(source, payload, signal), ticks = space.toTicks;
  const driver = source.drivers.find(driver => driver.name === name);
  if (!driver) throw new Error("The search entry is missing from the prepared save.");
  const stats = { evaluated: 0, cached: 0, pruned: 0, reference_laps: 0, preparation_laps: 0 }, scorers = [];
  for (const compound of source.tyres) {
    onReference({ driver: name, compound: compound.name });
    const reference = await solveReference(scenario, driver, compound, signal);
    stats.reference_laps += reference.evaluated;
    scorers.push(new CompoundScorer(scenario, driver, compound, reference, stats, space));
  }
  const cases = [];
  for (const scorer of scorers) {
    const found = await scorer.evaluate([ticks(scorer.reference.settings), ticks(source.settings)], -1, signal);
    const best = found.reduce((best, row) => row.score > best.score ? row : best);
    cases.push({ scorer, space, best, reference: ticks(scorer.reference.settings), anchor: ticks(best.settings), round: 0, refinement: null, stop_reason: null });
  }
  const dry = ["soft", "medium", "hard"].map(name => scorers.find(scorer => scorer.compound.name === name));
  if (dry.every(Boolean)) {
    const scorer = new AverageScorer(dry), seeds = [...dry.map(scorer => ticks(scorer.reference.settings)), ticks(source.settings)];
    const found = await scorer.evaluate(seeds, -1, signal), best = found.reduce((best, row) => row.score > best.score ? row : best);
    cases.unshift({ scorer, space, best, reference: ticks(best.settings), anchor: ticks(best.settings), round: 0, refinement: null, stop_reason: null });
  }
  for (const state of cases) advanceSearch(state, [], 0, limits, false);
  stats.preparation_laps = stats.evaluated; stats.evaluated = 0;
  return { driver, cases, space, stats, bounds, limits, rng: new PythonRandom(payload.seed), wind: scenario.wind, cursor: 0 };
}

export async function stepDriver(driver, signal) {
  const active = driver.cases.filter(state => !state.stop_reason);
  if (!active.length) return false;
  const state = active[driver.cursor++ % active.length];
  if (state.scorer.bestKnown) advanceSearch(state, [state.scorer.bestKnown], 0, driver.limits, false);
  async function consider(values, incumbent, generated) {
    const before = driver.stats.evaluated, found = await state.scorer.evaluate(values, incumbent, signal);
    advanceSearch(state, found, driver.stats.evaluated - before, driver.limits, generated);
    return found;
  }
  if (!state.stop_reason && state.best.compound === "avg_dry") {
    await consider(driver.cases.filter(state => ["soft", "medium", "hard"].includes(state.best.compound)).map(state => driver.space.toTicks(state.best.settings)), -1, false);
  }
  if (!state.stop_reason) {
    const previous = state.best.score, found = await consider(candidatesFor(state, driver.bounds, driver.rng), state.best.score, true);
    if (found.length && state.best.score === previous && state.round % 4 === 0) state.anchor = driver.space.toTicks(driver.rng.choice(found).settings);
  }
  return true;
}

export function driverSnapshot(driver) {
  return { driver: driver.driver.name, entry: driver.driver.entry, wind: driver.wind, statistics: { ...driver.stats },
    rows: driver.cases.map(state => {
      // Every known component improvement survives later AVG_DRY trade-offs, even after its own search stops.
      const known = state.scorer.bestKnown, best = known && known.score > state.best.score ? known : state.best;
      return { ...best, stop_reason: state.stop_reason, refinement: state.refinement ? { ...state.refinement } : null };
    }) };
}
