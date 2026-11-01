let sequence = 0;

/** Print a JSON snapshot that can be copied from the local browser console. */
export function write_log(event, details = {}) {
  console.log(JSON.stringify({ tool: "tpm-setup-optimiser", schema: 1, sequence: ++sequence, event, ...details }, null, 2));
}
