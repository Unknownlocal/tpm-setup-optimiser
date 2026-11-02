import { write_log } from "./debug-log.js";
import { settingText } from "./setup-model.js";

/** Render complete checkpoints without repeating console records on every update. */
export function renderResults(ui, result, { validation, diagnostics = true }) {
  function addDetail(title, lines, parent = ui["input-details"], level = "h3", tag = "section") {
    const section = document.createElement(tag), heading = document.createElement(level);
    heading.textContent = title; section.append(heading);
    for (const line of lines) {
      const paragraph = document.createElement("p"); paragraph.textContent = line; section.append(paragraph);
    }
    parent.append(section);
    return section;
  }
  ui["input-details"].replaceChildren();
  const input = result.source;
  ui["input-summary"].textContent = `${input.team} · Season ${input.season}, week ${input.week} · ${input.track.name} · ${input.weather.temperature_c} °C · ${input.weather.wetness_mm} mm`;
  addDetail("Scenario", [
    `Data mod: ${ui["input-mod"].textContent}; saved pack reference: ${input.savedPack}.`,
    `Compounds: ${input.tyres.map(tyre => tyre.name.toUpperCase()).join(" / ")}. Saved rules: ${input.activePolicies.car.name}; ${input.activePolicies.tyres.name}.`,
    `${result.search ? "Starting setup" : "Fixed setup"}: ${input.setupAxes.map(axis => `${axis.label}: ${settingText(axis, input.settings[axis.key])}`).join("; ")}.`,
    `Loaded ${result.fileNames.length} files and ${result.constantsCount} literal constants. Selected mod definitions must match this save's career.`,
    `Session seed: ${result.prediction.seed}; initial wind ${result.prediction.wind.speed_kmh.toFixed(1)} km/h, ${result.prediction.wind.direction_deg.toFixed(1)}°; worker time ${result.grading.timing_ms.end_to_end.toFixed(0)} ms (${result.grading.reference_laps_evaluated} reference laps).`,
  ]);
  const lapTime = seconds => {
    const ms = Math.round(seconds * 1000);
    return `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, "0")}`;
  };
  for (const row of result.grading.rows) {
    const average = row.compound === "avg_dry";
    const scores = average ? Object.values(row.compound_scores) : [row.score];
    const times = average ? Object.values(row.compound_lap_times_s) : [row.lap_time_s];
    const compound = addDetail(`${row.driver} | ${row.compound.toUpperCase()} | ${row.grade} (${scores.map(score => score.toFixed(2)).join("|")}/100) | ${times.map(lapTime).join(" | ")}`, average ? [
      "One shared setup, averaged across SOFT / MEDIUM / HARD. Each component uses its own reference.",
    ] : [
      `Pace ${row.pace_score.toFixed(2)}; preference fit ${row.preference_score.toFixed(2)}; pace loss ${row.pace_delta_s.toFixed(3)} s against ${lapTime(row.reference_lap_s)} reference.`,
      `Warmed tyres ${row.tyre_temperature_c.toFixed(1)} °C; balance ${row.balance.toFixed(1)}, traction ${row.traction.toFixed(1)}.`,
    ], ui["input-details"], "h2");
    compound.className = "compound-result";
    const setup = addDetail("Setup", [], compound, "h3", "div"); setup.className = "setup-result";
    const values = document.createElement("dl"); values.className = "setup-values";
    for (const axis of input.setupAxes) {
      const group = document.createElement("div"), label = document.createElement("dt"), value = document.createElement("dd");
      label.textContent = axis.label; value.textContent = settingText(axis, (row.settings || input.settings)[axis.key]);
      group.append(label, value); values.append(group);
    }
    setup.append(values);
    if (result.search) {
      const cutoff = document.createElement("p");
      cutoff.textContent = `Search cutoff: ${row.stop_reason || result.search.status}${row.refinement ? `; ${row.refinement.laps} refinement laps, ${row.refinement.stale_laps} without a material gain.` : "."}`;
      setup.append(cutoff);
    }
    if (diagnostics) write_log("setup_graded", { validation, driver: row.driver, compound: row.compound, grade: row.grade, score: row.score, ...(result.search ? { settings: row.settings, stop_reason: row.stop_reason || result.search.status, refinement: row.refinement } : {}),
      ...(average ? { compound_scores: row.compound_scores } : { pace_score: row.pace_score, preference_score: row.preference_score,
        pace_delta_s: row.pace_delta_s, reference_lap_s: row.reference_lap_s, reference_settings: row.reference_settings }) });
  }
  for (const row of result.prediction.rows) {
    if (diagnostics) write_log("lap_predicted", { validation, driver: row.driver, entry: row.entry, compound: row.compound,
      lap_time_s: row.lap_time_s, tyre_temperature_c: row.tyre_temperature_c,
      tyre_grip: row.tyre_grip || [row.inputs.tyre_lat_mult, row.inputs.tyre_long_mult] });
  }
  if (diagnostics) write_log("lap_prediction_completed", { validation, seed: result.prediction.seed,
    wind: result.prediction.wind, timing_ms: result.prediction.timing_ms });
  if (diagnostics) write_log("grading_completed", { validation, reference_laps_evaluated: result.grading.reference_laps_evaluated, timing_ms: result.grading.timing_ms });
  ui["input-results"].hidden = false;
  ui.status.textContent = result.search
    ? `${result.search.status}: ${result.search.drivers_ready}/${result.search.drivers_total} entries; ${result.search.statistics.evaluated || 0} candidate laps. ${result.search.message || ""}`
    : "Fixed setup graded locally.";
}
