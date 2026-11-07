import { write_log } from "./debug-log.js";
import { settingText } from "./setup-model.js";
import { compoundName, DRY_COMPOUNDS, drivingSummary, equipmentSummary, lapTime, runSummary } from "./result-format.js";

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metric(parent, label, value) {
  const group = element("div");
  group.append(element("dt", label), element("dd", value)); parent.append(group);
}

/** Group checkpoints by driver; retain expanded details while new results arrive. */
export function renderResults(ui, result, { validation, diagnostics = true }) {
  const input = result.source;
  const opened = new Set([...ui["input-details"].querySelectorAll("details[open]")].map(node => node.dataset.key));
  ui["input-details"].replaceChildren();
  function details(parent, title, key, lines) {
    const node = element("details", undefined, "score-details");
    node.dataset.key = key; node.open = opened.has(key); node.append(element("summary", title));
    for (const line of lines) node.append(element("p", line));
    parent.append(node); return node;
  }
  const temperature = input.weather.temperature_source === "generated" ? input.weather.temperature_c.toFixed(2) : String(input.weather.temperature_c);
  ui["input-summary"].textContent = `${input.team} · Season ${input.season}, week ${input.week} · ${input.track.name} · ${temperature} °C · ${input.weather.wetness_mm} mm water`;
  ui["run-summary"].textContent = `${runSummary(result)} ${drivingSummary(input)}. ${equipmentSummary(input)}`;
  const error = result.search?.message || result.grading_message;
  ui["run-error"].textContent = error || ""; ui["run-error"].hidden = !error;
  for (const driver of input.drivers) {
    const rows = result.grading.rows.filter(row => row.entry === driver.entry && row.driver === driver.name);
    if (!rows.length) continue;
    const group = element("section", undefined, "driver-results"); group.setAttribute("aria-label", driver.name);
    group.append(element("p", driver.name, "driver-name"));
    const grid = element("div", undefined, "compound-grid"); group.append(grid);
    for (const row of rows) {
      const average = row.compound === "avg_dry";
      const card = element("section", undefined, "compound-result"); card.dataset.compound = row.compound;
      const heading = element("div", undefined, "compound-heading");
      heading.append(element("h2", `${row.driver} | ${compoundName(row.compound, input)}`), element("span", row.grade, "grade")); card.append(heading);
      const metrics = element("dl", undefined, "lap-summary");
      metric(metrics, average ? "Average setup rating" : "Setup rating", `${row.score.toFixed(2)}/100`);
      if (!average) metric(metrics, "Predicted lap", lapTime(row.lap_time_s));
      card.append(metrics);
      if (average) {
        const table = element("table"), head = element("thead"), header = element("tr"), body = element("tbody");
        table.append(element("caption", "One shared setup, scored separately on each dry compound."));
        for (const label of ["Compound", "Rating /100", "Predicted lap"]) { const cell = element("th", label); cell.scope = "col"; header.append(cell); }
        head.append(header); table.append(head, body);
        for (const name of DRY_COMPOUNDS) {
          const line = element("tr"), label = element("th", compoundName(name, input)); label.scope = "row";
          line.append(label, element("td", row.compound_scores[name].toFixed(2)), element("td", lapTime(row.compound_lap_times_s[name]))); body.append(line);
        }
        card.append(table);
      }
      const setup = element("div", undefined, "setup-result"), values = element("dl", undefined, "setup-values");
      setup.append(element("h3", "Setup"), values);
      for (const axis of input.setupAxes) metric(values, axis.label, settingText(axis, (row.settings || input.settings)[axis.key]));
      card.append(setup);
      if (!average) details(card, "Score details", JSON.stringify([row.entry, row.compound]), [
        `Pace ${row.pace_score.toFixed(2)}/100 · Driver preference fit ${row.preference_score.toFixed(2)}/100.`,
        `Pace loss ${row.pace_delta_s.toFixed(3)} s against a ${lapTime(row.reference_lap_s)} reference.`,
        `Warmed tyres ${row.tyre_temperature_c.toFixed(1)} °C · Balance ${row.balance.toFixed(1)} · Traction ${row.traction.toFixed(1)}.`,
      ]);
      if (result.search) {
        const reasons = { perfect: "Maximum rating reached", refinement: "Refinement lap limit reached", stall: "No further material improvement", idle: "No new laps to evaluate" };
        card.append(element("p", `${reasons[row.stop_reason] || "Best result so far"}${row.refinement ? ` · ${row.refinement.laps} refinement laps` : ""}.`, "hint"));
      }
      grid.append(card);
    }
    ui["input-details"].append(group);
  }
  const run = details(ui["input-details"], "Run details", "run", [
    `Data mod: ${ui["input-mod"].textContent}. Saved pack: ${input.savedPack}. Use definitions matching the save's career.`,
    `Ambient ${temperature} °C (${input.weather.temperature_source === "generated" ? `generated session average across ${input.weather.temperature_laps} laps` : "entered manually"}).`,
    `Saved rules: ${input.activePolicies.car.name}; ${input.activePolicies.tyres.name}.`,
    `Seed ${result.prediction.seed} · Initial wind ${result.prediction.wind.speed_kmh.toFixed(1)} km/h at ${result.prediction.wind.direction_deg.toFixed(1)}°.`,
    `${result.grading.reference_laps_evaluated} reference laps · ${(result.grading.timing_ms.end_to_end / 1000).toFixed(2)} s total, including preparation.${result.search ? ` Search phase ${(result.search.elapsed_search_ms / 1000).toFixed(2)} s; limit ${result.search.limits.seconds} s.` : ""}`,
    ...(result.search?.message || result.grading_message ? [result.search?.message || result.grading_message] : []),
  ]); run.className = "run-details";
  if (diagnostics) logResults(result, validation);
  ui["input-results"].hidden = false;
  ui.status.textContent = result.search ? runSummary(result) : "Entered setup graded locally.";
}

/** Keep detailed diagnostics local and independent of the visible presentation. */
function logResults(result, validation) {
  for (const row of result.grading.rows) write_log("setup_graded", { validation, driver: row.driver, compound: row.compound, grade: row.grade, score: row.score,
    ...(result.search ? { settings: row.settings, stop_reason: row.stop_reason || result.search.status, refinement: row.refinement } : {}),
    ...(row.compound === "avg_dry" ? { compound_scores: row.compound_scores } : { pace_score: row.pace_score, preference_score: row.preference_score,
      pace_delta_s: row.pace_delta_s, reference_lap_s: row.reference_lap_s, reference_settings: row.reference_settings }) });
  for (const row of result.prediction.rows) write_log("lap_predicted", { validation, driver: row.driver, entry: row.entry, compound: row.compound,
    lap_time_s: row.lap_time_s, tyre_temperature_c: row.tyre_temperature_c, tyre_grip: row.tyre_grip || [row.inputs.tyre_lat_mult, row.inputs.tyre_long_mult] });
  write_log("lap_prediction_completed", { validation, seed: result.prediction.seed, wind: result.prediction.wind, timing_ms: result.prediction.timing_ms });
  write_log("grading_completed", { validation, reference_laps_evaluated: result.grading.reference_laps_evaluated, timing_ms: result.grading.timing_ms });
}
