import { finite } from "./lap-contract.js";
import { prepareLapScenario } from "./save-laps.js";
import { solveReference } from "./setup-reference.js";

const ANCHORS = [[0, 100], [.02, 98], [.05, 95], [.1, 90], [.2, 82], [.35, 73], [.55, 64], [.8, 52], [1.1, 38], [1.5, 24], [2, 0]];
const GRADES = [[98, "S+"], [95, "S"], [90, "A+"], [82, "A"], [73, "B+"], [64, "B"], [52, "C"], [38, "D"], [24, "E"]];
export const gradeFromScore = score => GRADES.find(([cutoff]) => finite(score, "setup score") >= cutoff)?.[1] || "F";

/** The game measures pace loss relative to a 90-second reference lap. */
export function paceScore(delta, reference) {
  const normalised = Math.max(0, finite(delta, "pace delta")) * 90 / finite(reference, "reference lap", Number.MIN_VALUE);
  for (let i = 1; i < ANCHORS.length; i++) {
    const [left, leftScore] = ANCHORS[i - 1], [right, rightScore] = ANCHORS[i];
    if (normalised <= right) return leftScore + (rightScore - leftScore) * ((normalised - left) / (right - left));
  }
  return 0;
}

export function assessSetup(row, driver, reference) {
  const fit = 100 * Math.max(0, 1 - (Math.abs(row.balance - driver.preferences.balance_preference) + Math.abs(row.traction - driver.preferences.traction_preference)) / 70);
  // Staged guidance can be beaten; the game caps the resulting pace score at 100.
  const delta = Math.max(0, row.lap_time_s - reference.lap_time_s), pace = paceScore(delta, reference.lap_time_s);
  const score = .85 * pace + .15 * fit;
  return { ...row, score, grade: gradeFromScore(score), preference_score: fit, pace_score: pace,
    pace_delta_s: delta, reference_lap_s: reference.lap_time_s, reference_settings: reference.settings };
}

/** Grade the entered setup only. Reference solving is required preparation, not setup search. */
export async function gradeSetups(payload, signal) {
  const start = performance.now(), { result, scenario } = await prepareLapScenario(payload, signal);
  const rows = result.source.drivers.flatMap(driver => result.source.tyres.map(compound => scenario.row(driver, compound)));
  const predictionTiming = await scenario.laps(rows, signal), referenceStart = performance.now(), graded = [];
  let evaluated = 0;
  for (const driver of result.source.drivers) {
    const components = [];
    for (const compound of result.source.tyres) {
      const reference = await solveReference(scenario, driver, compound, signal);
      evaluated += reference.evaluated;
      const row = rows.find(row => row.driver === driver.name && row.compound === compound.name);
      components.push(assessSetup(row, driver, reference));
    }
    const dry = ["soft", "medium", "hard"].map(name => components.find(row => row.compound === name));
    if (dry.every(Boolean)) {
      const score = dry.reduce((sum, row) => sum + row.score, 0) / 3;
      graded.push({ driver: driver.name, entry: driver.entry, compound: "avg_dry", score, grade: gradeFromScore(score),
        compound_scores: Object.fromEntries(dry.map(row => [row.compound, row.score])),
        compound_lap_times_s: Object.fromEntries(dry.map(row => [row.compound, row.lap_time_s])) });
    }
    graded.push(...components);
  }
  return { ...result, prediction: { seed: scenario.seed, wind: scenario.wind, rows, timing_ms: predictionTiming },
    grading: { rows: graded, reference_laps_evaluated: evaluated, timing_ms: { references: performance.now() - referenceStart, end_to_end: performance.now() - start } } };
}
