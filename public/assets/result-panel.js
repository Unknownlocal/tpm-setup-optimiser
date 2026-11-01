import { write_log } from "./debug-log.js";

/** Render complete checkpoints without repeating console records on every update. */
export function renderResults(ui, result, { validation, diagnostics = true }) {
  function addDetail(title, lines) {
    const section = document.createElement("section"), heading = document.createElement("h3");
    heading.textContent = title; section.append(heading);
    for (const line of lines) {
      const paragraph = document.createElement("p"); paragraph.textContent = line; section.append(paragraph);
    }
    ui["input-details"].append(section);
  }
  ui["input-details"].replaceChildren();
  const input = result.source;
  ui["input-summary"].textContent = `${input.team} · Season ${input.season}, week ${input.week} · ${input.track.name} · ${input.weather.temperature_c} °C · ${input.weather.wetness_mm} mm`;
  addDetail("Scenario", [
    `Data mod: ${ui["input-mod"].textContent}; saved pack reference: ${input.savedPack}.`,
    `Compounds: ${input.tyres.map(tyre => tyre.name.toUpperCase()).join(" / ")}. Saved rules: ${input.activePolicies.car.name}; ${input.activePolicies.tyres.name}.`,
    `${result.search ? "Starting setup" : "Fixed setup"}: wings ${input.settings.front_wing}/${input.settings.rear_wing}; suspension ${input.settings.suspension_level}; pressures ${input.settings.front_pressure_psi}/${input.settings.rear_pressure_psi} psi.`,
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
    addDetail(`${row.driver} | ${row.compound.toUpperCase()} | ${row.grade} (${scores.map(score => score.toFixed(2)).join("|")}/100) | ${times.map(lapTime).join(" | ")}`, average ? [
      "One shared setup, averaged across SOFT / MEDIUM / HARD. Each component uses its own reference.",
    ] : [
      `Pace ${row.pace_score.toFixed(2)}; preference fit ${row.preference_score.toFixed(2)}; pace loss ${row.pace_delta_s.toFixed(3)} s against ${lapTime(row.reference_lap_s)} reference.`,
      `Warmed tyres ${row.tyre_temperature_c.toFixed(1)} °C; balance ${row.balance.toFixed(1)}, traction ${row.traction.toFixed(1)}.`,
    ]);
    if (result.search) addDetail("Setup", [
      `Wings: front ${row.settings.front_wing}, rear ${row.settings.rear_wing}; suspension ${row.settings.suspension_level}; pressures ${row.settings.front_pressure_psi}/${row.settings.rear_pressure_psi} psi.`,
      `Search cutoff: ${row.stop_reason || result.search.status}${row.refinement ? `; ${row.refinement.laps} refinement laps, ${row.refinement.stale_laps} without a material gain.` : "."}`,
    ]);
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
  if (!result.search) for (const driver of input.drivers) addDetail(`${driver.name} — entry ${driver.entry}`, [
    `Skills: ${Object.entries(driver.skills).map(([key, value]) => `${key} ${value.toFixed(2)}`).join("; ")}.`,
    `Preferences: balance ${driver.preferences.balance_preference}; traction ${driver.preferences.traction_preference}.`,
    ...driver.parts.map(part => `${part.label}: ${part.item.name}${part.item.condition === undefined ? "" : ` (${part.item.condition.toFixed(1)}% condition)`}`),
  ]);
  ui["input-results"].hidden = false;
  ui.status.textContent = result.search
    ? `${result.search.status}: ${result.search.drivers_ready}/${result.search.drivers_total} entries; ${result.search.statistics.evaluated || 0} candidate laps. ${result.search.message || ""}`
    : "Fixed setup graded locally.";
}
