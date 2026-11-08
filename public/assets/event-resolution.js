import { readJson } from "./input-preparation.js";

/** Resolve the entire saved season, including testing rotation and same-week events. */
export async function resolveSeasonCalendar({ saveFile, testFile }) {
  const save = await readJson(saveFile, "Save", 64 * 1024 * 1024);
  if (!save || !Array.isArray(save.schedule) || !Number.isInteger(save.week_index) || save.week_index < 0) {
    throw new Error("The save has no valid season calendar.");
  }
  let rotation = [], testIssue = null;
  if (save.schedule.includes("test")) {
    try {
      if (!testFile) throw new Error("Testing circuits need test.json from this data mod.");
      rotation = (await readJson(testFile, "test.json"))?.tracks;
      if (!Array.isArray(rotation) || !rotation.length) throw new Error("test.json has no testing tracks.");
    } catch (error) { rotation = []; testIssue = error.message; }
  }
  const events = [], issues = new Set(); let ordinal = 0;
  const nextIndex = save.schedule.findIndex((track, index) => index >= save.week_index && track !== null);
  for (const [index, scheduled] of save.schedule.entries()) {
    if (scheduled === null) continue;
    const testing = scheduled === "test", testOrdinal = testing ? ordinal++ : null;
    if (testing && !rotation.length) { issues.add(testIssue); continue; }
    let track = testing ? rotation[testOrdinal % rotation.length] : scheduled;
    // Only immediate catalogue identifiers are allowed, never filesystem paths.
    if (typeof track !== "string" || !track.trim() || track.length > 128 || /[\\/:\u0000]/u.test(track) || [".", ".."].includes(track)) {
      issues.add(`Unsupported circuit identifier in week ${index + 1}.`); continue;
    }
    if (testing) track = track.toLowerCase();
    events.push({ event_week: index + 1, track_id: track, testing,
      test_ordinal: testing ? testOrdinal + 1 : null, test_rotation_length: testing ? rotation.length : null });
  }
  return { saved_week: save.week_index + 1, team: typeof save.player_team === "string" ? save.player_team : null,
    season: Number.isInteger(save.season_no) ? save.season_no : null, events,
    next: events.find(event => event.event_week === nextIndex + 1) || null, issues: [...issues],
    next_error: nextIndex < 0 ? "No events remain in this season. Choose another circuit from its calendar."
      : "The next calendar circuit could not be resolved. Choose another circuit from this season." };
}
