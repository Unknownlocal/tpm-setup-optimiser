import { resultsText } from "./result-format.js";

/** Retain only the visible text snapshot. Clearing it releases export data along with the results. */
export function createResultExport(ui) {
  ui["copy-results"].onclick = async () => {
    const text = ui["result-text"].value;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      if (ui["result-text"].value === text) ui["export-note"].textContent = "Results copied.";
    } catch {
      // Browsers can refuse clipboard permission; the same text remains available for manual copying.
      if (ui["result-text"].value !== text) return;
      ui["export-text"].open = true;
      ui["result-text"].focus(); ui["result-text"].select();
      ui["export-note"].textContent = "Clipboard access was unavailable. Copy the selected text, or download it instead.";
    }
  };
  ui["download-results"].onclick = () => {
    const url = URL.createObjectURL(new Blob([ui["result-text"].value], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "tpm-setup-results.txt";
    document.body.append(link); link.click(); link.remove();
    // Let the browser start the local download before releasing its temporary URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui["export-note"].textContent = "Results downloaded locally.";
  };
  function clear() {
    ui["result-text"].value = ui["export-note"].textContent = "";
    ui["export-text"].open = false;
    ui["copy-results"].disabled = ui["download-results"].disabled = true;
  }
  function setResult(result) {
    ui["result-text"].value = resultsText(result);
    ui["copy-results"].disabled = ui["download-results"].disabled = false;
  }
  clear();
  return { clear, setResult };
}
