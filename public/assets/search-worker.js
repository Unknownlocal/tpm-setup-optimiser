import { lapEngineReadiness } from "./lap-physics.js";
import { prepareDriver, stepDriver, driverSnapshot } from "./driver-search.js";

let active = null;
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));
const now = () => performance.timeOrigin + performance.now();

function send(job, type, details = {}) { self.postMessage({ id: job.id, type, ...details }); }

self.onmessage = async ({ data }) => {
  if (data.type === "stop") {
    if (active?.id === data.id) {
      active.controller.abort();
      if (active.stage === "prepared") { send(active, "stopped"); active = null; }
    }
    return;
  }
  if (data.type === "prepare") {
    active?.controller.abort();
    const job = { id: data.id, controller: new AbortController(), drivers: [] }; active = job;
    try {
      for (const name of data.names) {
        const driver = await prepareDriver(data.source, data.payload, name, job.controller.signal,
          detail => send(job, "reference", detail));
        job.drivers.push(driver); send(job, "checkpoint", { snapshot: driverSnapshot(driver) });
      }
      job.controller.signal.throwIfAborted(); job.stage = "prepared"; send(job, "prepared");
    } catch (error) {
      send(job, error.name === "AbortError" ? "stopped" : "failed", { message: error.message });
      if (active === job) active = null;
    }
    return;
  }
  if (data.type !== "start" || active?.id !== data.id) return;
  const job = active; job.stage = "searching"; let cursor = 0, lastCheckpoint = 0;
  try {
    while (now() < data.deadline && job.drivers.some(driver => driver.cases.some(state => !state.stop_reason))) {
      job.controller.signal.throwIfAborted();
      const driver = job.drivers[cursor++ % job.drivers.length];
      await stepDriver(driver, job.controller.signal);
      if (performance.now() - lastCheckpoint >= 200) {
        for (const driver of job.drivers) send(job, "checkpoint", { snapshot: driverSnapshot(driver) });
        lastCheckpoint = performance.now();
      }
      // Cached/pruned rounds also yield so Stop never waits for another physical lap.
      await yieldTask();
    }
  } catch (error) {
    if (error.name !== "AbortError") { send(job, "failed", { message: error.message }); if (active === job) active = null; return; }
  }
  for (const driver of job.drivers) send(job, "checkpoint", { snapshot: driverSnapshot(driver) });
  send(job, "stopped", { reason: now() >= data.deadline ? "deadline" : "finished" }); if (active === job) active = null;
};

self.postMessage({ type: "ready", lap_engine: await lapEngineReadiness() });
