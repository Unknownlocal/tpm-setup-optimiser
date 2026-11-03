import { createLapScenario } from "./lap-scenario.js";
import { solveReference } from "./setup-reference.js";

/** Grade the entered setup only; reference solving is preparation, not setup search. */
export async function gradeDriver(source, payload, name, signal, onReference = () => {}) {
  const scenario = await createLapScenario(source, payload, signal), driver = source.drivers.find(driver => driver.name === name);
  if (!driver) throw new Error("The grading entry is missing from the prepared save.");
  const rows = source.tyres.map(compound => scenario.row(driver, compound));
  await scenario.laps(rows, signal);
  const graded = [], components = [];
  let evaluated = 0;
  for (const compound of source.tyres) {
    onReference({ driver: name, compound: compound.name });
    // Each tyre uses its own reference, even though every row uses the entered setup.
    const reference = await solveReference(scenario, driver, compound, signal);
    evaluated += reference.evaluated;
    const row = rows.find(row => row.driver === driver.name && row.compound === compound.name);
    components.push(scenario.grading.assess([row], driver, reference)[0]);
  }
  const dry = ["soft", "medium", "hard"].map(name => components.find(row => row.compound === name));
  // An AVG_DRY result needs all three dry compounds; a partial selection has no dry average.
  if (dry.every(Boolean)) {
    graded.push({ driver: driver.name, entry: driver.entry, compound: "avg_dry", ...scenario.grading.average(dry) });
  }
  graded.push(...components);
  return { driver: name, entry: driver.entry, wind: scenario.wind, rows: graded, statistics: { reference_laps: evaluated } };
}
