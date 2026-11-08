import assert from "node:assert/strict";
import test from "node:test";
import { compoundName, compoundOptions } from "../public/assets/compounds.js";
import { createSaveCatalogue, saveSummary } from "../public/assets/save-catalogue.js";
import { prepareInputs } from "../public/assets/input-preparation.js";
import { searchLimits } from "../public/assets/search-settings.js";
import { resolveSeasonCalendar } from "../public/assets/event-resolution.js";
import { resolveSetupAxes, setupModel } from "../public/assets/setup-model.js";
import { boundedNumber } from "../public/assets/number-inputs.js";

test("season circuits resolve same-week and repeated tests without admitting unrelated venues", async () => {
  const file = data => new File([JSON.stringify(data)], "calendar.json");
  const saved = { week_index: 1, season_no: 4, player_team: "Example Team", schedule: ["test", "test", "test", "SPA", "spa", null] };
  const payload = { saveFile: file(saved), testFile: file({ tracks: ["CAT", "sak", "imo", "off_calendar"] }) };
  const calendar = await resolveSeasonCalendar(payload);
  assert.equal(calendar.next.event_week, 2); assert.equal(calendar.next.track_id, "sak");
  assert.deepEqual(calendar.events.map(event => event.track_id), ["cat", "sak", "imo", "SPA", "spa"]);
  const rotated = await resolveSeasonCalendar({ ...payload, testFile: file({ tracks: ["CAT", "sak"] }) });
  assert.equal(rotated.events[2].track_id, "cat"); assert.equal(rotated.events[2].test_ordinal, 3);
  const missing = await resolveSeasonCalendar({ saveFile: file(saved) });
  assert.deepEqual(missing.events.map(event => event.track_id), ["SPA", "spa"]); assert.equal(missing.next, null); assert.equal(missing.issues.length, 1);
  const finished = await resolveSeasonCalendar({ ...payload, saveFile: file({ ...saved, week_index: 8 }) });
  assert.equal(finished.next, null); assert.equal(finished.events.length, 5);
  await assert.rejects(resolveSeasonCalendar({ saveFile: file({}) }), /valid season calendar/);
});

test("entered setup defaults follow the mod's neutral settings and step-aligned ranges", () => {
  const config = { wing_levels: { min_level: 1, max_level: 20, neutral_level: 10 },
    tyre_pressures: { front: { min_psi: 20, max_psi: 28, neutral_psi: 24, step_psi: .1 }, rear: { min_psi: 20, max_psi: 25, neutral_psi: 22.5, step_psi: .1 } },
    suspension_setup: { min_level: 1, max_level: 11, neutral_level: 6 } };
  assert.deepEqual(resolveSetupAxes(setupModel("formula"), config).map(axis => axis.initial), [10, 10, 24, 22.5, 6]);
  config.tyre_pressures.front = { min_psi: 21, max_psi: 28, step_psi: .2 };
  const front = resolveSetupAxes(setupModel("formula"), config)[2];
  assert.equal(front.initial, 24.6); assert.equal(front.min, 21); assert.equal(front.step, .2);
});

test("numeric entries clamp to valid bounds and steps, including non-aligned endpoints", () => {
  assert.equal(boundedNumber(-1, 0, 5), 0); assert.equal(boundedNumber(6, 0, 5), 5);
  assert.equal(boundedNumber(100.5, 100, 100000, 1), 101);
  assert.equal(boundedNumber(24.15, 20, 28, .1), 24.2);
  assert.equal(boundedNumber(10, 1, 1.25, .1), 1.2);
  assert.equal(boundedNumber(175.5, 0), 175.5);
});

test("search cache bounds accept whole-number endpoints and reject invalid entries", () => {
  assert.equal(searchLimits().cache_entries, 4096);
  for (const value of [100, 101, 100000]) assert.equal(searchLimits({ cache_entries: value }).cache_entries, value);
  for (const value of [99, 100001, 100.5, NaN]) assert.throws(() => searchLimits({ cache_entries: value }));
});

const save = (name, pack, lastModified = 0) => new File([JSON.stringify({ data_pack: pack, unrelated: { largeState: "not retained" } })], name, { lastModified });
const request = (_, file) => saveSummary(file);

test("compound choices follow definitions and retain friendly labels beyond five compounds", () => {
  const options = compoundOptions({ compounds: { endurance: { display_name: "eXtra Endurance" }, wet: {}, hard: {}, soft: {}, medium: {}, intermediate: {} } });
  assert.deepEqual(options.map(option => option.id), ["soft", "medium", "hard", "intermediate", "wet", "endurance"]);
  assert.equal(options.at(-1).label, "eXtra Endurance");
  assert.equal(compoundOptions({ compounds: { ultra_soft: {}, rain: { label: "Heavy rain" } } }).length, 2);
  assert.equal(compoundName("endurance", { tyres: [{ name: "endurance", display_name: options.at(-1).label }] }), "EXTRA ENDURANCE");
  assert.throws(() => compoundOptions({ compounds: { avg_dry: {} } }), /reserved/);
});

test("save filtering uses file metadata, caches summaries and resets on a new root", async () => {
  const a = save("wrong-title.json", "mod-a", 10), b = save("mod-a.json", "mod-b", 100);
  const recent = save("latest.json", "mod-a", 20), tied = save("tied.json", "mod-a", 20);
  let reads = 0;
  const original = a.text.bind(a); a.text = () => { reads++; return original(); };
  const files = new Map([[a.name, a], [b.name, b], [tied.name, tied], [recent.name, recent], ["broken.json", new File(["{"], "broken.json")], ["missing.json", new File(["{}"], "missing.json")]]);
  let state;
  const catalogue = createSaveCatalogue(request, value => { state = value; });
  catalogue.setFiles(files); await catalogue.filter("mod-a");
  assert.deepEqual([...catalogue.matches.keys()], ["latest.json", "tied.json", "wrong-title.json"]);
  assert.equal(state.latest, recent);
  assert.equal(state.unreadable, 2); assert.equal(state.complete, true);
  assert.deepEqual(await catalogue.summary(a, new AbortController().signal), { pack: "mod-a" });
  await catalogue.filter("mod-b");
  assert.deepEqual([...catalogue.matches.keys()], ["mod-a.json"]); assert.equal(reads, 1);
  assert.equal(state.latest, b);
  catalogue.setFiles(new Map([[a.name, save(a.name, "mod-b")]])); await catalogue.filter("mod-a");
  assert.equal(catalogue.matches.size, 0);
  assert.equal(state.latest, null);
});

test("a late cancelled scan cannot replace a new root's matches or progress", async () => {
  let release, state;
  const slow = save("old.json", "mod-a"); slow.text = () => new Promise(resolve => { release = () => resolve('{"data_pack":"mod-a"}'); });
  const catalogue = createSaveCatalogue(request, value => { state = value; });
  catalogue.setFiles(new Map([[slow.name, slow]])); const previous = catalogue.filter("mod-a");
  assert.equal(catalogue.scanning, true);
  const current = save("new.json", "mod-b"); catalogue.setFiles(new Map([[current.name, current]]));
  await catalogue.filter("mod-b"); release(); await previous;
  assert.deepEqual([...catalogue.matches.keys()], ["new.json"]);
  assert.equal(state.pack, "mod-b"); assert.equal(state.checked, 1); assert.equal(state.scanning, false);
  catalogue.setFiles(new Map([[slow.name, slow]])); const stopped = catalogue.filter("mod-a");
  assert.equal(catalogue.stop(), true); release(); await stopped;
  assert.equal(catalogue.matches.size, 0); assert.equal(state.complete, false);
});

test("input preparation rejects a different selected pack before building car inputs", async () => {
  await assert.rejects(prepareInputs({ saveFile: save("renamed.json", "actual-pack"), trackFile: new File(["{}"], "track.json"), files: {}, dataPack: "different-pack" }), /This save uses data mod "actual-pack"/);
});
