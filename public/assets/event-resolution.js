import { readJson } from "./input-preparation.js";

/** Match the desktop calendar rule, including events in the saved week. */
export async function resolveDefaultCircuit({ saveFile, testFile }) {
  const save = await readJson(saveFile, "Save", 64 * 1024 * 1024);
  if (!save || !Array.isArray(save.schedule) || !Number.isInteger(save.week_index) || save.week_index < 0) {
    throw new Error("The save has no valid season calendar. Select a circuit manually.");
  }
  const index = save.schedule.findIndex((track, index) => index >= save.week_index && track !== null);
  if (index < 0) throw new Error("No circuit events remain in this season. Select a circuit manually.");
  let track = save.schedule[index], ordinal = null, rotationLength = null;
  const testing = track === "test";
  if (testing) {
    if (!testFile) throw new Error("Testing needs test.json from this data mod. Select a circuit manually.");
    const rotation = (await readJson(testFile, "test.json"))?.tracks;
    if (!Array.isArray(rotation) || !rotation.length) throw new Error("test.json has no testing tracks. Select a circuit manually.");
    ordinal = save.schedule.slice(0, index + 1).filter(event => event === "test").length - 1;
    rotationLength = rotation.length;
    track = rotation[ordinal % rotationLength];
    if (typeof track === "string") track = track.toLowerCase();
  }
  // A catalogue lookup must identify one immediate circuit file, never a path.
  if (typeof track !== "string" || !track.trim() || track.length > 128 || /[\\/:\u0000]/u.test(track) || [".", ".."].includes(track)) {
    throw new Error("The scheduled circuit identifier is unsupported. Select a circuit manually.");
  }
  return { saved_week: save.week_index + 1, event_week: index + 1, track_id: track,
    testing, test_ordinal: testing ? ordinal + 1 : null, test_rotation_length: rotationLength };
}
