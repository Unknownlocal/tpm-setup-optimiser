import assert from "node:assert/strict";
import test from "node:test";
import { compoundName, compoundOptions } from "../public/assets/compounds.js";
import { createSaveCatalogue, saveSummary } from "../public/assets/save-catalogue.js";
import { prepareInputs } from "../public/assets/input-preparation.js";

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
