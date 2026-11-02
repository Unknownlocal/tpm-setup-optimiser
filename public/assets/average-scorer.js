import { gradeFromScore } from "./setup-grading.js";
import { settingKey } from "./search-settings.js";

/** A shared setup must be assessed separately against all three dry references. */
export class AverageScorer {
  constructor(scorers) { this.scorers = scorers; this.stats = scorers[0].stats; this.reference = null; }
  async evaluate(values, incumbent = -1, signal) {
    values = [...new Map(values.map(value => [settingKey(value), value])).values()].filter(value => {
      if (this.scorers.reduce((sum, scorer) => sum + scorer.upperBound(value), 0) / 3 + 1e-10 >= incumbent) return true;
      this.stats.pruned++; return false;
    });
    const components = [];
    for (const scorer of this.scorers) components.push(new Map((await scorer.evaluate(values, -1, signal)).map(row => [settingKey(scorer.space.toTicks(row.settings)), row])));
    return values.map(value => {
      const rows = components.map(component => component.get(settingKey(value))), score = rows.reduce((sum, row) => sum + row.score, 0) / 3;
      return { driver: rows[0].driver, entry: rows[0].entry, compound: "avg_dry", settings: rows[0].settings, score, grade: gradeFromScore(score),
        compound_scores: Object.fromEntries(rows.map(row => [row.compound, row.score])),
        compound_lap_times_s: Object.fromEntries(rows.map(row => [row.compound, row.lap_time_s])) };
    });
  }
}

