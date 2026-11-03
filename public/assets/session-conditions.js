import { requireValue } from "./lap-contract.js";
import { loadEngine } from "./lap-physics.js";

/** Resolve the shared ambient value in a calculation worker, before driver searches start. */
export async function resolveTemperature(source, seed) {
  const engine = await loadEngine();
  const values = Array.from(engine.ResolveTemperature(JSON.stringify({ weather: source.weather, sessionOptions: source.sessionOptions,
    track: source.track, trackLapModifiersEnabled: source.trackLapModifiersEnabled, definitions: { constants: source.definitions.constants } }), seed));
  requireValue(values.length === 2 && values.every(Number.isFinite), "Invalid session temperature response.");
  return { ...source.weather, temperature_c: values[0], temperature_source: values[1] ? "generated" : "manual",
    ...(values[1] ? { temperature_laps: values[1] } : {}) };
}

/** Decode numerical conditions without loading .NET in the UI or metadata worker. */
export async function createConditions(source, seed) {
  const engine = await loadEngine();
  const { config, constants } = source.definitions;
  const packet = Array.from(engine.BuildConditions(JSON.stringify({ track: source.track, trackId: source.trackId, testing: source.testing,
    sessionOptions: source.sessionOptions, weather: source.weather, drivers: source.drivers.map(driver => ({ name: driver.name })),
    dynamicsStaff: source.dynamicsStaff, tyres: source.tyres, definitions: { config, constants } }), seed));
  const [version, speed_kmh, direction_deg, brake_cap, sectors, skill, drivers, tyres] = packet;
  requireValue(version === 1 && drivers === source.drivers.length && tyres === source.tyres.length && Number.isInteger(sectors) && sectors >= 0
    && packet.length === 8 + drivers + tyres * 5 + sectors * 4 && packet.every(Number.isFinite), "Invalid session conditions response.");
  const variations = new Map(source.drivers.map((driver, i) => [driver.name, packet[8 + i]]));
  let offset = 8 + drivers;
  const models = new Map(source.tyres.map(tyre => { const model = packet.slice(offset, offset + 5); offset += 5; return [tyre.name, model]; }));
  const field = sectors ? { sectors: [], sources: [], losses: [], tails: [], brake_cap } : null;
  for (let i = 0; i < sectors; i++, offset += 4) {
    const [index, length_pct, loss, tail] = packet.slice(offset, offset + 4);
    requireValue(Number.isInteger(index) && source.track.micro_sectors[index], "Invalid wind source-sector index.");
    field.sectors.push({ ...source.track.micro_sectors[index], length_pct }); field.sources.push(index); field.losses.push(loss); field.tails.push(tail);
  }
  return { wind: { field, speed_kmh, direction_deg }, variations, tyres: models, skill };
}
