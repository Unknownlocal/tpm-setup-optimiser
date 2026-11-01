let sequence = 0;
let validation = 0;

/** Print a JSON snapshot that can be copied from the local browser console. */
export function write_log(event, details = {}) {
  const json = JSON.stringify({ tool: "tpm-setup-optimiser", schema: 2, sequence: sequence + 1, event, ...details });
  if (json.length > 900) {
    // Escaping JSON text inside a chunk can double its length; leave room for that.
    const message = sequence + 1, parts = Math.ceil(json.length / 300);
    for (let part = 0; part < parts; part++) {
      write_log("diagnostic_chunk", { message, part: part + 1, parts, text: json.slice(part * 300, (part + 1) * 300) });
    }
    return;
  }
  sequence++;
  console.log(json);
}

/** Summarise the scenario and each driver without large physics tables. */
export function write_input_logs(result, { save, mod, calendar }) {
  const input = result.source, run = ++validation;
  write_log("inputs_validated", { validation: run, save, mod, saved_pack: input.savedPack,
    team: input.team, season: input.season, week: input.week,
    calendar_default: calendar ? { week: calendar.event_week, circuit: calendar.name, testing: calendar.testing } : null,
    circuit: { file: result.fileNames[1], name: input.track.name, length_km: input.track.length_km, micro_sectors: input.track.micro_sectors.length },
    compounds: input.tyres.map(tyre => tyre.name), weather: input.weather, settings: input.settings,
    drivers: input.drivers.length, files: result.fileNames.length, constants: result.constantsCount });
  for (const driver of input.drivers) {
    write_log("driver_inputs", { validation: run, driver: driver.name, entry: driver.entry,
      skills: driver.skills, preferences: driver.preferences,
      // Slot/name pairs retain every fitted item, even if slot names repeat.
      parts: driver.parts.map(part => [part.category, part.item.name]) });
  }
}
