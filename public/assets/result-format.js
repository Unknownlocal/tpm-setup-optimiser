import { settingText } from "./setup-model.js";

export const DRY_COMPOUNDS = ["soft", "medium", "hard"];
export const compoundName = compound => compound.toUpperCase();

export function lapTime(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
}

export function runSummary(result) {
  if (!result.search) return result.grading_status === "cancelled" ? "Grading stopped. Completed driver entries are shown."
    : result.grading_status === "worker_error" ? "Grading stopped after an error. Completed driver entries are shown." : "Entered setup graded for each driver and compound.";
  const descriptions = { preparing: "Preparing reference setups", searching: "Searching for improvements", finished: "Search complete",
    deadline: "Search time limit reached", cancelled: "Search stopped", worker_error: "Search stopped after an error" };
  const search = result.search;
  return `${descriptions[search.status] || "Search stopped"}. ${search.drivers_ready}/${search.drivers_total} driver entries ready; ${(result.grading.timing_ms.end_to_end / 1000).toFixed(2)} s total, including preparation. Best completed results are shown.`;
}

/** Export displayed results only: no save contents, source definitions or fitted-part inventory. */
export function resultsText(result) {
  const input = result.source;
  const lines = ["TPM Setup Optimiser", `${input.team} | Season ${input.season}, week ${input.week} | ${input.track.name}`,
    `Ambient ${input.weather.temperature_c.toFixed(2)} C | Water ${input.weather.wetness_mm} mm | Seed ${result.prediction.seed}`,
    runSummary(result), ""];
  for (const row of result.grading.rows) {
    const average = row.compound === "avg_dry";
    const scores = average ? DRY_COMPOUNDS.map(name => `${compoundName(name)} ${row.compound_scores[name].toFixed(2)}`).join(" | ") : row.score.toFixed(2);
    const times = average ? DRY_COMPOUNDS.map(name => `${compoundName(name)} ${lapTime(row.compound_lap_times_s[name])}`).join(" | ") : lapTime(row.lap_time_s);
    lines.push(`${row.driver} | ${compoundName(row.compound)} | ${row.grade} (${scores}/100) | ${times}`);
    for (const axis of input.setupAxes) lines.push(`  ${axis.label}: ${settingText(axis, (row.settings || input.settings)[axis.key])}`);
    lines.push("");
  }
  lines.push("Predicted laps use fresh, fully warmed tyres and fixed session defaults. Grades can differ from the game's nominal setup panel.");
  return lines.join("\n");
}
