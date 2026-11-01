/** MT19937 with Python's integer seeding and 53-bit random() output. */
export class PythonRandom {
  constructor(seed) {
    this.state = new Uint32Array(624);
    let n = BigInt(seed); if (n < 0n) n = -n;
    const keys = [];
    do { keys.push(Number(n & 0xffffffffn)); n >>= 32n; } while (n);
    this.state[0] = 19650218;
    for (let i = 1; i < 624; i++) this.state[i] = (Math.imul(1812433253, this.state[i - 1] ^ (this.state[i - 1] >>> 30)) + i) >>> 0;
    let i = 1, j = 0;
    for (let count = Math.max(624, keys.length); count; count--) {
      this.state[i] = ((this.state[i] ^ Math.imul(this.state[i - 1] ^ (this.state[i - 1] >>> 30), 1664525)) + keys[j] + j) >>> 0;
      if (++i === 624) { this.state[0] = this.state[623]; i = 1; }
      if (++j === keys.length) j = 0;
    }
    for (let count = 623; count; count--) {
      this.state[i] = ((this.state[i] ^ Math.imul(this.state[i - 1] ^ (this.state[i - 1] >>> 30), 1566083941)) - i) >>> 0;
      if (++i === 624) { this.state[0] = this.state[623]; i = 1; }
    }
    this.state[0] = 0x80000000; this.index = 624;
  }
  uint32() {
    if (this.index === 624) {
      for (let i = 0; i < 624; i++) {
        const y = (this.state[i] & 0x80000000) | (this.state[(i + 1) % 624] & 0x7fffffff);
        this.state[i] = this.state[(i + 397) % 624] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = this.state[this.index++];
    y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18;
    return y >>> 0;
  }
  random() { return ((this.uint32() >>> 5) * 67108864 + (this.uint32() >>> 6)) / 9007199254740992; }
  uniform(low, high) { return low + (high - low) * this.random(); }
  integer(low, high) {
    const size = high - low + 1, bits = Math.floor(Math.log2(size)) + 1;
    let value;
    do { value = this.uint32() >>> (32 - bits); } while (value >= size);
    return low + value;
  }
  choice(values) { return values[this.integer(0, values.length - 1)]; }
  pair() {
    const pool = [0, 1, 2, 3, 4], first = this.integer(0, 4), a = pool[first];
    pool[first] = pool[4];
    return [a, pool[this.integer(0, 3)]];
  }
}
