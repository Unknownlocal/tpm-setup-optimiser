import { requireValue } from "./lap-contract.js";
import { loadEngine } from "./lap-physics.js";

let grading;
/** Bridge C# grading to browser result objects. C# owns the equations and thresholds;
 * this adapter packs numbers, checks responses and restores display metadata. */
export async function createGrading() {
  // Share one bridge and label table per worker; individual runs keep their own result rows.
  if (!grading) grading = loadEngine().then(engine => {
    const labels = Array.from(engine.GradeLabels());
    function grade(index) {
      requireValue(Number.isInteger(index) && typeof labels[index] === "string", "Invalid grade response.");
      return labels[index];
    }
    return {
      assess(rows, driver, reference) {
        // Input triples are balance, traction and lap time. C# returns five fields per row:
        // preference fit, pace score, pace loss, combined score and grade index.
        const raw = Array.from(engine.AssessSetups(rows.flatMap(row => [row.balance, row.traction, row.lap_time_s]),
          driver.preferences.balance_preference, driver.preferences.traction_preference, reference.lap_time_s));
        requireValue(raw.length === rows.length * 5 && raw.every(Number.isFinite), "Invalid setup grading response.");
        return rows.map((row, i) => ({ ...row, preference_score: raw[i * 5], pace_score: raw[i * 5 + 1], pace_delta_s: raw[i * 5 + 2],
          score: raw[i * 5 + 3], grade: grade(raw[i * 5 + 4]), reference_lap_s: reference.lap_time_s, reference_settings: reference.settings }));
      },
      average(rows) {
        // Average the completed compound scores in C#, retaining each original score/time
        // separately for the AVG_DRY details shown to the user.
        const values = Array.from(engine.AverageGrade(rows.map(row => row.score)));
        requireValue(values.length === 2 && values.every(Number.isFinite), "Invalid average grading response.");
        return { score: values[0], grade: grade(values[1]),
          compound_scores: Object.fromEntries(rows.map(row => [row.compound, row.score])),
          compound_lap_times_s: Object.fromEntries(rows.map(row => [row.compound, row.lap_time_s])) };
      },
    };
  });
  return grading;
}
