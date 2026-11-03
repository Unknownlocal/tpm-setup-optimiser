import { requireValue } from "./lap-contract.js";
import { loadEngine } from "./lap-physics.js";

// Matches SavedCar/FormulaSetup in the core; CarContractVersion guards this layout.
const VALUE_LENGTH = 14, MODEL_LENGTH = 66, RECORD_LENGTH = VALUE_LENGTH + MODEL_LENGTH;
const ZONES = ["slow", "med", "high", "straight"];

/** Project assigned equipment once. The core retains no save data or mutable car handles. */
export async function createSavedCars(source) {
  const engine = await loadEngine();
  const { constants, car_parts, engines, car_concepts } = source.definitions;
  const packet = Array.from(engine.BuildCars(JSON.stringify({ calendarYear: source.calendarYear, teamInputs: source.teamInputs,
    drivers: source.drivers, setupDefinitions: source.setupDefinitions, definitions: { constants, car_parts, engines, car_concepts } })));
  requireValue(packet[0] === source.drivers.length && packet.length === 1 + packet[0] * RECORD_LENGTH && packet.every(Number.isFinite), "Invalid saved-car engine response.");
  return new Map(source.drivers.map((driver, index) => {
    const values = packet.slice(1 + index * RECORD_LENGTH, 1 + (index + 1) * RECORD_LENGTH), model = values.slice(VALUE_LENGTH);
    const attrs = Object.fromEntries([...ZONES, "team_pace", "acceleration", "braking", "car_mass_kg", "aero_efficiency_rating"].map((key, i) => [key, values[i]]));
    attrs.tyre_management = values[13];
    return [driver.name, { attrs, aero: values[8], power: values[9], engineMass: values[10], wetBonus: values[11], protectedTemperature: values[12] === 1,
      setups(settings) {
        const output = [];
        for (let start = 0; start < settings.length; start += 64) {
          const batch = settings.slice(start, start + 64);
          const raw = Array.from(engine.EvaluateSetups(model, batch.flatMap(s => [s.front_wing, s.rear_wing, s.front_pressure_psi, s.rear_pressure_psi, s.suspension_level])));
          requireValue(raw.length === batch.length * 8 && raw.every(Number.isFinite), "Invalid setup engine response.");
          for (let i = 0; i < batch.length; i++) {
            const row = raw.slice(i * 8, (i + 1) * 8);
            output.push({ delta: Object.fromEntries(ZONES.map((key, j) => [key, row[j]])),
              pressure: { accel_ms2: row[4], target_temp_delta_c: row[5] }, balance: row[6], traction: row[7] });
          }
        }
        return output;
      } }];
  }));
}
