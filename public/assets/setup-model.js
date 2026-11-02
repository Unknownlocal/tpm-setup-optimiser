import { finite, requireValue } from "./lap-contract.js";

/** Formula-specific names/configuration live here; forms, output and search consume axes. */
const FORMULA = { id: "formula", axes: [
  { key: "front_wing", label: "Front wing", control: "setup-front", path: ["wing_levels"], minKey: "min_level", maxKey: "max_level", initial: 20, scale: 1, coarse: 3, decimals: 0 },
  { key: "rear_wing", label: "Rear wing", control: "setup-rear", path: ["wing_levels"], minKey: "min_level", maxKey: "max_level", initial: 14, scale: 1, coarse: 3, decimals: 0 },
  { key: "front_pressure_psi", label: "Front tyre pressure", unit: "psi", control: "setup-front-pressure", path: ["tyre_pressures", "front"], minKey: "min_psi", maxKey: "max_psi", stepKey: "step_psi", initial: 20.3, scale: 10, coarse: 10, decimals: 1 },
  { key: "rear_pressure_psi", label: "Rear tyre pressure", unit: "psi", control: "setup-rear-pressure", path: ["tyre_pressures", "rear"], minKey: "min_psi", maxKey: "max_psi", stepKey: "step_psi", initial: 21.7, scale: 10, coarse: 10, decimals: 1 },
  { key: "suspension_level", label: "Suspension", control: "setup-suspension", path: ["suspension_setup"], minKey: "min_level", maxKey: "max_level", initial: 2, scale: 1, coarse: 2, decimals: 0 },
] };

export function setupModel(mode) {
  requireValue(mode === FORMULA.id, `No verified setup model is available for ${mode}.`);
  return FORMULA;
}

export function resolveSetupAxes(model, config) {
  return model.axes.map(axis => {
    const definition = axis.path.reduce((value, key) => value?.[key], config);
    const min = finite(definition?.[axis.minKey], `${axis.label} minimum`);
    const max = finite(definition?.[axis.maxKey], `${axis.label} maximum`, min);
    const step = finite(axis.stepKey ? definition?.[axis.stepKey] : 1, `${axis.label} step`, Number.MIN_VALUE);
    return { ...axis, min, max, step };
  });
}

/** Integer coordinates are independent of the number and names of adjustable settings. */
export function createSettingSpace(axes) {
  requireValue(Array.isArray(axes) && axes.length > 0 && axes.length <= 32 && new Set(axes.map(axis => axis.key)).size === axes.length, "Invalid setup axes.");
  const bounds = axes.map(axis => {
    finite(axis.scale, `${axis.label} scale`, Number.MIN_VALUE);
    requireValue(Math.abs(axis.step * axis.scale - 1) < 1e-8, `Search requires ${1 / axis.scale} ${axis.unit || "unit"} steps for ${axis.label}.`);
    const low = axis.min * axis.scale, high = axis.max * axis.scale;
    requireValue(Number.isFinite(low) && Number.isFinite(high) && high >= low && high - low <= 1000000
      && Math.abs(low - Math.round(low)) < 1e-7 && Math.abs(high - Math.round(high)) < 1e-7, `Unsupported search range for ${axis.label}.`);
    requireValue(Number.isInteger(axis.coarse) && axis.coarse >= 1, `Invalid search radius for ${axis.label}.`);
    return [Math.round(low), Math.round(high)];
  });
  return { bounds, coarse: axes.map(axis => axis.coarse),
    toTicks: settings => axes.map(axis => Math.round(settings[axis.key] * axis.scale)),
    toSettings: values => Object.fromEntries(axes.map((axis, i) => [axis.key, values[i] / axis.scale])) };
}

export function settingText(axis, value) {
  return `${value.toFixed(axis.decimals)}${axis.unit ? ` ${axis.unit}` : ""}`;
}
