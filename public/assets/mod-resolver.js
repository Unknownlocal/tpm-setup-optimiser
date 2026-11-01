export function parseModQuery(value) {
  const path = value.trim().replaceAll("\\", "/");
  if (!path || path.length > 256 || path.startsWith("/") || /^[a-z]:/iu.test(path) || /[\u0000-\u001f]/u.test(path)) {
    throw new Error("Enter a mod name or a relative path within the selected game folder.");
  }
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === "..")) {
    throw new Error("Use a relative path without empty, . or .. segments.");
  }
  if (parts.length > 1 && /[:*?"<>|]/u.test(path)) throw new Error("That path contains unsupported folder characters.");
  // Punctuation is valid in a friendly title even when it cannot name a folder.
  return { parts, explicit: parts.length > 1, titleOnly: /[:*?"<>|]/u.test(path) };
}

function normalise(value) {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function similarity(a, b) {
  // A small edit-distance calculation allows spelling mistakes in title tokens.
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) {
      next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
    }
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length, 1);
}

export function rankMods(query, mods) {
  const wanted = normalise(query);
  if (!wanted) return [];
  const tokens = wanted.split(" ");
  return mods.map(mod => {
    const title = normalise(mod.title);
    const words = title.split(" ");
    let score = title === wanted ? 100 : title.includes(wanted) ? 95
      : tokens.every(token => words.includes(token)) ? 90
      : Math.round(80 * tokens.reduce((sum, token) =>
        sum + Math.max(...words.map(word => similarity(token, word))), 0) / tokens.length);
    // Similar titles from different seasons must not outrank the requested year.
    if (tokens.some(token => /^\d+$/u.test(token) && !words.includes(token))) score -= 35;
    return { ...mod, score };
  }).filter(mod => mod.score >= 60)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
}
