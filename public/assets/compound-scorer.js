import { settingKey } from "./search-settings.js";

/** One driver/compound cache, valid only while its fitted car and conditions stay fixed. */
export class CompoundScorer {
  constructor(scenario, driver, compound, reference, stats, space) {
    Object.assign(this, { scenario, driver, compound, reference, stats, space });
    this.cache = new Map(); this.bestKnown = null;
  }
  info(value) {
    const key = settingKey(value);
    if (!this.cache.has(key)) {
      // C# supplies the best possible score from preference fit alone; no lap is needed yet.
      const row = this.scenario.row(this.driver, this.compound, this.space.toSettings(value));
      this.cache.set(key, { settings: row.settings, maximum_score: row.maximum_score });
    }
    return this.cache.get(key);
  }
  upperBound(value) { const info = this.info(value); return info.score ?? info.maximum_score; }
  async evaluate(values, incumbent = -1, signal) {
    const found = [], pending = [];
    for (const value of new Map(values.map(value => [settingKey(value), value])).values()) {
      const info = this.info(value);
      if (info.score !== undefined) { this.stats.cached++; found.push(info); }
      // Skip a lap only when even perfect pace cannot beat the current result.
      else if (info.maximum_score + 1e-10 < incumbent) this.stats.pruned++;
      else pending.push(value);
    }
    for (let i = 0; i < pending.length; i += 16) {
      signal?.throwIfAborted();
      const batch = pending.slice(i, i + 16), rows = batch.map(value => this.scenario.row(this.driver, this.compound, this.space.toSettings(value)));
      await this.scenario.laps(rows, signal);
      this.stats.evaluated += rows.length;
      this.scenario.grading.assess(rows, this.driver, this.reference).forEach((scored, index) => {
        const row = rows[index];
        scored.tyre_grip = [row.inputs.tyre_lat_mult, row.inputs.tyre_long_mult];
        delete scored.inputs; // Retain scores/settings, not a physics vector for every visited setup.
        this.cache.set(settingKey(batch[index]), scored); found.push(scored);
        if (!this.bestKnown || scored.score > this.bestKnown.score) this.bestKnown = scored;
      });
    }
    return found;
  }
}
