import { DRY_COMPOUNDS } from "./compounds.js";

/** Render the selected mod's compounds without a fixed number of controls or codes. */
export function createCompoundSelection(ui, changed) {
  const group = ui["input-compounds"], choices = ui["compound-choices"];
  let options = [];
  function values() { return [...choices.querySelectorAll("input:checked")].map(control => control.value); }
  function note() {
    const selected = values();
    const dry = DRY_COMPOUNDS.map(id => options.find(option => option.id === id)?.label);
    ui["compound-help"].textContent = !options.length ? "Select a data mod to load its tyre compounds."
      : `${selected.length} of ${options.length} compounds selected.${!selected.length ? " Select at least one to calculate." : ""}${dry.every(Boolean) ? ` Selecting ${dry.join(" / ")} also adds AVG_DRY: one shared setup for all three.` : ""}`;
  }
  group.oninput = () => { note(); changed(); };
  return {
    values,
    enable(ready) { group.disabled = !ready || !options.length; },
    set(available = []) {
      options = available; choices.replaceChildren();
      for (const { id, label } of options) {
        const control = document.createElement("input"), text = document.createElement("label");
        control.type = "checkbox"; control.value = id; control.checked = true;
        text.append(control, document.createTextNode(label)); choices.append(text);
      }
      group.disabled = !options.length; note();
    },
  };
}
