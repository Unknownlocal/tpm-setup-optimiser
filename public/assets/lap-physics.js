import { ENGINE_VERSION, selfTestPayload } from "./lap-contract.js";

let engine;
export async function loadEngine() {
  // A standalone runtime belongs to a calculation worker, never the UI thread.
  if (typeof WorkerGlobalScope === "undefined" || !(self instanceof WorkerGlobalScope)) throw new Error("Lap calculations require a browser worker.");
  if (!engine) engine = (async () => {
    globalThis.dotnetSidecar = true;
    const { dotnet } = await import("/engine/_framework/dotnet.js");
    const runtime = await dotnet.create();
    const exports = (await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName)).EngineExports;
    if (exports.ContractVersion() !== ENGINE_VERSION) throw new Error("Incompatible lap-engine version. Reload the page.");
    if (exports.SearchContractVersion() !== 1) throw new Error("Incompatible search-engine version. Reload the page.");
    return exports;
  })();
  return engine;
}

/** Prepared-lap bridge for validation/previews; native jobs evaluate search laps directly. */
export async function simulateLaps(payload, signal = new AbortController().signal) {
  signal.throwIfAborted();
  const start = performance.now();
  const exports = await loadEngine(), times = []; let solveMs = 0;
  if (!Array.isArray(payload.inputs) || payload.inputs.length > 64) throw new Error("A lap batch supports at most 64 prepared inputs.");
  for (let index = 0; index < payload.inputs.length; index += 16) {
    signal.throwIfAborted();
    const lapStart = performance.now(), batch = payload.inputs.slice(index, index + 16);
    const solved = Array.from(exports.EvaluatePrepared(JSON.stringify({ ...payload, inputs: batch })));
    if (solved.length !== batch.length || solved.some(value => !Number.isFinite(value))) throw new Error("Lap physics produced invalid times.");
    times.push(...solved); solveMs += performance.now() - lapStart;
    // Cooperative slices keep Stop responsive even during reference preparation.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return { version: ENGINE_VERSION, lap_times_s: times,
    timing_ms: { context: 0, solve: solveMs, total: performance.now() - start } };
}

export async function lapEngineReadiness() {
  const result = await simulateLaps(selfTestPayload());
  if (Math.abs(result.lap_times_s[0] - 20) > 1e-9) throw new Error("The .NET lap engine failed its numerical self-test.");
  return { version: ENGINE_VERSION, backend: "dotnet-10-aot", scope: "prepared-formula-inputs", self_test: "passed" };
}
