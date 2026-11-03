import { settingKey } from "./search-settings.js";

/** A shared setup must be assessed separately against all three dry references. */
export class AverageScorer {
  constructor(scorers) { this.scorers = scorers; this.stats = scorers[0].stats; this.reference = null; }
  async evaluate(values, incumbent = -1, signal) {
    values = [...new Map(values.map(value => [settingKey(value), value])).values()].filter(value => {
      // The mean of the component ceilings is also a ceiling for the shared setup's score.
      if (this.scorers.reduce((sum, scorer) => sum + scorer.upperBound(value), 0) / 3 + 1e-10 >= incumbent) return true;
      this.stats.pruned++; return false;
    });
    const components = [];
    for (const scorer of this.scorers) components.push(new Map((await scorer.evaluate(values, -1, signal)).map(row => [settingKey(scorer.space.toTicks(row.settings)), row])));
    return values.map(value => {
      const rows = components.map(component => component.get(settingKey(value)));
      return { driver: rows[0].driver, entry: rows[0].entry, compound: "avg_dry", settings: rows[0].settings, ...this.scorers[0].scenario.grading.average(rows) };
    });
  }
}

