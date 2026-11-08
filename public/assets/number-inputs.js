import { clamp } from "./lap-contract.js";

/** Snap to a valid step as well as a bound; a non-aligned maximum is not a valid tick. */
export function boundedNumber(value, min = -Infinity, max = Infinity, step = 0) {
  value = clamp(value, min, max);
  if (step > 0) {
    const base = Number.isFinite(min) ? min : 0;
    const low = Number.isFinite(min) ? Math.ceil((min - base) / step) : -Infinity;
    const high = Number.isFinite(max) ? Math.floor((max - base) / step + 1e-9) : Infinity;
    value = base + clamp(Math.round((value - base) / step + 1e-9), low, high) * step;
  }
  return Number(value.toPrecision(15));
}

function normalise(control) {
  const before = control.value;
  let value = control.valueAsNumber;
  if (!Number.isFinite(value)) {
    // Optional blank fields mean generated weather/seed; required fields restore their default.
    if (!control.required) { control.value = ""; return before !== control.value; }
    value = Number(control.defaultValue);
  }
  control.value = String(boundedNumber(value, control.min === "" ? -Infinity : Number(control.min),
    control.max === "" ? Infinity : Number(control.max), control.step === "any" ? 0 : Number(control.step || 1)));
  return before !== control.value;
}

export function normaliseNumbers(root) {
  let changed = false;
  // Update refinement first so an old stall maximum cannot clip a newly valid value.
  for (const control of root.querySelectorAll('input[type="number"]:not(:disabled)')) {
    if (control.id !== "search-stall") changed = normalise(control) || changed;
  }
  const refine = root.querySelector("#search-refine"), stall = root.querySelector("#search-stall");
  if (refine && stall) {
    stall.max = String(refine.valueAsNumber - 1);
    changed = normalise(stall) || changed;
  }
  return changed;
}

export function bindNumberInputs(root) {
  // Clamp committed edits, not each keystroke: typing 100000 must be possible with min=100.
  root.addEventListener("change", event => {
    if (event.target.matches('input[type="number"]:not(:disabled)') && normaliseNumbers(root)) {
      event.target.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}
