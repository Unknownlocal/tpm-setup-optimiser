import { finite } from "./lap-contract.js";
import { createLapScenario } from "./lap-scenario.js";
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
export async function gradeDriver(source, payload, name, signal, onReference = () => {}) {
  const scenario = await createLapScenario(source, payload, signal), driver = source.drivers.find(driver => driver.name === name);
  if (!driver) throw new Error("The grading entry is missing from the prepared save.");
  const rows = source.tyres.map(compound => scenario.row(driver, compound));
  await scenario.laps(rows, signal);
  const graded = [], components = [];
  let evaluated = 0;
  for (const compound of source.tyres) {
    onReference({ driver: name, compound: compound.name });
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
  return { driver: name, entry: driver.entry, wind: scenario.wind, rows: graded, statistics: { reference_laps: evaluated } };
}
