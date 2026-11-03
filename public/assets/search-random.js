import { loadEngine } from "./lap-physics.js";

/** Search still chooses integers/samples in JS; random words and continuation state
 * come from C# in batches, avoiding a runtime crossing for each proposal draw. */
class SearchRandom {
  constructor(seed, engine) { this.seed = String(seed); this.engine = engine; this.state = []; this.words = []; this.index = 0; }
  uint32() {
    if (this.index === this.words.length) {
      const packet = Array.from(this.engine.RandomWords(this.seed, this.state));
      this.state = packet.slice(0, 625); this.words = packet.slice(625); this.index = 0;
    }
    return this.words[this.index++];
  }
  integer(low, high) {
    const size = high - low + 1, bits = Math.floor(Math.log2(size)) + 1;
    let value;
    do { value = this.uint32() >>> (32 - bits); } while (value >= size);
    return low + value;
  }
  choice(values) { return values[this.integer(0, values.length - 1)]; }
  sampleIndices(size, count) {
    const selected = [], threshold = 21 + (count > 5 ? 4 ** Math.ceil(Math.log(count * 3) / Math.log(4)) : 0);
    if (size > threshold) {
      const used = new Set();
      for (let i = 0; i < count; i++) {
        let index; do { index = this.integer(0, size - 1); } while (used.has(index));
        used.add(index); selected.push(index);
      }
      return selected;
    }
    const pool = Array.from({ length: size }, (_, i) => i);
    for (let i = 0; i < count; i++) {
      const index = this.integer(0, size - i - 1);
      selected.push(pool[index]); pool[index] = pool[size - i - 1];
    }
    return selected;
  }
}

export async function createSearchRandom(seed) { return new SearchRandom(seed, await loadEngine()); }
