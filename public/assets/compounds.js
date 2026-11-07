export const DRY_COMPOUNDS = ["soft", "medium", "hard"];
const ORDER = [...DRY_COMPOUNDS, "intermediate", "wet"];

/** Definition keys stay stable through physics; labels are only for presentation. */
export function compoundOptions(model) {
  const definitions = model?.compounds;
  if (!definitions || typeof definitions !== "object" || Array.isArray(definitions)) throw new Error("tyremodel.json needs compound definitions.");
  const options = Object.entries(definitions).map(([id, definition]) => {
    if (!id.trim() || id !== id.trim() || id === "avg_dry" || !definition || typeof definition !== "object" || Array.isArray(definition))
      throw new Error(`Invalid tyre compound definition: ${id}. AVG_DRY is reserved for shared results.`);
    const fallback = id.replaceAll("_", " ").replaceAll("-", " ").replace(/^./u, letter => letter.toUpperCase());
    const label = definition.display_name ?? definition.label ?? definition.name ?? fallback;
    if (typeof label !== "string" || !label.trim()) throw new Error(`Missing tyre compound label: ${id}.`);
    return { id, label: label.trim() };
  });
  if (!options.length) throw new Error("tyremodel.json has no compounds to select.");
  const rank = id => ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length;
  return options.sort((a, b) => rank(a.id) - rank(b.id));
}

export const compoundName = (id, source) =>
  (source?.tyres?.find(tyre => tyre.name === id)?.display_name ?? id).toUpperCase();
