/** Match Python's nearest-integer rule when a value lies exactly between integers. */
export function roundEven(value) {
  const low = Math.floor(value), fraction = value - low;
  return fraction === .5 ? (low % 2 === 0 ? low : low + 1) : Math.round(value);
}
