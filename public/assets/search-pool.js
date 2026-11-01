import { searchLimits } from "./search-settings.js";

/** Preload a bounded worker pool before file access. Each driver owns independent search state;
 * teams larger than the pool share slots in round-robin slices under one deadline. */
export function createSearchPool(count = Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))) {
  let active = null, sequence = 0;
  const slots = Array.from({ length: count }, () => {
    const worker = new Worker("/assets/search-worker.js", { type: "module" }), slot = { worker, dead: false };
    slot.ready = new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === "ready") { resolve(); return; }
        if (active?.id === data.id) active.message(slot, data);
      };
      worker.onerror = event => {
        event.preventDefault(); slot.dead = true;
        reject(new Error("A search worker could not load. Reload the page to retry."));
        if (active) active.fail("A search worker failed. Reload the page before another search.", slot);
      };
    });
    return slot;
  });
  function cancel() { if (!active) return false; active.stop("cancelled"); return true; }
  async function run(result, payload, signal, onProgress = () => {}) {
    await ready; signal.throwIfAborted();
    if (slots.some(slot => slot.dead)) throw new Error("A search worker is unavailable. Reload the page to retry.");
    if (active) throw new Error("A setup search is already running.");
    const limits = searchLimits(payload.search), source = result.source;
    const used = slots.slice(0, Math.min(slots.length, source.drivers.length));
    const started = performance.now(), latest = new Map(), prepared = new Set(), stopped = new Set();
    const id = ++sequence; let deadlineTimer, forcedTimer, searchStarted = null, reason = null, error = null, reachedDeadline = false;
    return new Promise((resolve, reject) => {
      function snapshot() {
        const drivers = source.drivers.map(driver => latest.get(driver.name)).filter(Boolean);
        const rows = drivers.flatMap(driver => driver.rows), sums = {};
        for (const driver of drivers) for (const [key, value] of Object.entries(driver.statistics)) sums[key] = (sums[key] || 0) + value;
        return { ...result, prediction: { seed: payload.seed, wind: drivers[0]?.wind || { speed_kmh: 0, direction_deg: 0 }, rows: rows.filter(row => row.compound !== "avg_dry"), timing_ms: {} },
          grading: { rows, reference_laps_evaluated: sums.reference_laps || 0, timing_ms: { references: (searchStarted ?? performance.now()) - started, end_to_end: performance.now() - started } },
          search: { status: reason || (searchStarted === null ? "preparing" : "searching"), message: error, limits,
            drivers_ready: drivers.length, drivers_total: source.drivers.length, statistics: sums,
            elapsed_search_ms: searchStarted === null ? 0 : performance.now() - searchStarted, workers: used.length } };
      }
      function cleanup() {
        clearTimeout(deadlineTimer); clearTimeout(forcedTimer); signal.removeEventListener("abort", abort);
        if (active?.id === id) active = null;
      }
      function finish() {
        const output = snapshot(); cleanup();
        if (error && !output.grading.rows.length) reject(new Error(error));
        else resolve(output);
      }
      function stop(status) {
        if (reason) return;
        reason = status;
        for (const slot of used) if (!stopped.has(slot)) slot.worker.postMessage({ id, type: "stop" });
        // A stalled worker cannot hold the UI open or discard the last complete checkpoint.
        forcedTimer = setTimeout(() => {
          for (const slot of used) if (!stopped.has(slot)) { slot.worker.terminate(); slot.dead = true; }
          finish();
        }, 500);
        if (used.every(slot => stopped.has(slot))) finish();
      }
      function abort() {
        for (const slot of used) slot.worker.postMessage({ id, type: "stop" });
        cleanup(); reject(signal.reason);
      }
      active = { id, stop, fail(message, slot) {
        if (!used.includes(slot)) return;
        error = message; stopped.add(slot); stop("worker_error");
      },
        message(slot, data) {
          if (!used.includes(slot)) return;
          if (data.type === "reference") onProgress(snapshot(), { driver: data.driver, compound: data.compound });
          if (data.type === "checkpoint") { latest.set(data.snapshot.driver, data.snapshot); onProgress(snapshot()); }
          if (data.type === "failed") active.fail(data.message, slot);
          if (data.type === "prepared") {
            prepared.add(slot);
            if (!reason && prepared.size === used.length) {
              searchStarted = performance.now();
              const deadline = performance.timeOrigin + searchStarted + limits.seconds * 1000;
              for (const slot of used) slot.worker.postMessage({ id, type: "start", deadline });
              deadlineTimer = setTimeout(() => stop("deadline"), limits.seconds * 1000);
              onProgress(snapshot());
            }
          }
          if (data.type === "stopped") {
            reachedDeadline ||= data.reason === "deadline";
            stopped.add(slot);
            if (used.every(slot => stopped.has(slot))) { reason ||= reachedDeadline ? "deadline" : "finished"; finish(); }
          }
        } };
      signal.addEventListener("abort", abort, { once: true });
      for (const [index, slot] of used.entries()) slot.worker.postMessage({ id, type: "prepare", source,
        payload: { seed: payload.seed, testing: payload.testing, trackId: payload.trackId ?? payload.trackFile.name.replace(/\.json$/iu, ""), search: limits },
        names: source.drivers.filter((_, driverIndex) => driverIndex % used.length === index).map(driver => driver.name) });
    });
  }
  const ready = Promise.all(slots.map(slot => slot.ready));
  ready.catch(() => {}); // The page reports loading failures when its metadata worker is also ready.
  return { ready, run, cancel, size: slots.length };
}
