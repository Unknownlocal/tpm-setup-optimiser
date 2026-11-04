import { lapEngineReadiness, loadEngine } from "./lap-physics.js";
import { prepareInputs } from "./input-preparation.js";
import { resolveTemperature } from "./session-conditions.js";

let active = null, engine;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const now = () => performance.timeOrigin + performance.now();
function send(job, type, details = {}) { self.postMessage({ id: job.id, type, ...details }); }
function close(job) { if (job.native) { engine.CloseJob(job.id); job.native = false; } }
function checkpoints(job) { for (const snapshot of JSON.parse(engine.JobSnapshots(job.id))) send(job, "checkpoint", { snapshot }); }

/** The worker owns scheduling/deadlines; every native job is closed on completion or abandonment. */
self.onmessage = async ({ data }) => {
  if (data.type === "stop") {
    if (active?.id === data.id) {
      active.controller.abort();
      if (active.stage === "prepared") { close(active); send(active, "stopped"); active = null; }
    }
    return;
  }
  if (["inputs", "prepare", "grade"].includes(data.type)) {
    if (active) { active.controller.abort(); if (active.stage === "prepared") close(active); }
    const job = { id: data.id, controller: new AbortController(), native: false }; active = job;
    try {
      if (data.type === "inputs") {
        const result = await prepareInputs(data.payload);
        job.controller.signal.throwIfAborted();
        result.source.weather = await resolveTemperature(result.source, data.payload.seed);
        job.controller.signal.throwIfAborted(); send(job, "inputs", { result }); return;
      }
      engine.OpenJob(job.id, JSON.stringify({ source: data.source, payload: data.payload, names: data.names, mode: data.type === "grade" ? "grade" : "search" }));
      job.native = true;
      let complete = false, lastReference = null;
      while (!complete) {
        job.controller.signal.throwIfAborted();
        const result = JSON.parse(engine.PrepareJob(job.id));
        if (result.reference) {
          const key = JSON.stringify(result.reference);
          if (key !== lastReference) { send(job, "reference", result.reference); lastReference = key; }
        }
        if (result.snapshot) send(job, "checkpoint", { snapshot: result.snapshot });
        complete = result.complete;
        if (!complete) await yieldTask();
      }
      job.controller.signal.throwIfAborted();
      if (data.type === "grade") { close(job); send(job, "stopped", { reason: "finished" }); }
      else { job.stage = "prepared"; send(job, "prepared"); }
    } catch (error) {
      close(job); send(job, error.name === "AbortError" ? "stopped" : "failed", { message: error.message });
    } finally {
      if (job.stage !== "prepared") { close(job); if (active === job) active = null; }
    }
    return;
  }
  if (data.type !== "start" || active?.id !== data.id) return;
  const job = active; job.stage = "searching"; let lastCheckpoint = 0;
  try {
    while (now() < data.deadline) {
      job.controller.signal.throwIfAborted();
      const more = engine.StepJob(job.id);
      if (performance.now() - lastCheckpoint >= 200) { checkpoints(job); lastCheckpoint = performance.now(); }
      if (!more) break;
      // Cached/pruned rounds also return in short slices so Stop and edits remain responsive.
      await yieldTask();
    }
  } catch (error) {
    if (error.name !== "AbortError") { close(job); send(job, "failed", { message: error.message }); if (active === job) active = null; return; }
  }
  try {
    checkpoints(job); close(job);
    send(job, "stopped", { reason: now() >= data.deadline ? "deadline" : "finished" });
  } finally { close(job); if (active === job) active = null; }
};

try { engine = await loadEngine(); self.postMessage({ type: "ready", lap_engine: await lapEngineReadiness() }); }
catch (error) { self.postMessage({ type: "unavailable", message: error.message }); }
