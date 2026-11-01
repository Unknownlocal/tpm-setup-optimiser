// Data-only constants files: no eval, imports, calls or attribute access.
export function parseConstants(source) {
  const tokens = [];
  const pattern = /(?<space>[ \t\r]+)|(?<comment>#[^\n]*)|(?<newline>\n)|(?<string>'(?:\\[^\n]|[^'\\\n])*'|"(?:\\[^\n]|[^"\\\n])*")|(?<number>(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|(?<word>[A-Za-z_]\w*)|(?<punct>[=+\-\[\]{}():,])|(?<invalid>.)/guy;
  let offset = 0, line = 1;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) throw new Error(`constants.py:${line}: unsupported syntax.`);
    const type = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
    if (type === "invalid") throw new Error(`constants.py:${line}: unsupported syntax.`);
    if (type !== "space" && type !== "comment") tokens.push({ type, value: match[0], line });
    if (type === "newline") line++;
    offset = pattern.lastIndex;
    if (tokens.length > 100000) throw new Error("constants.py has too many values.");
  }
  tokens.push({ type: "end", value: "", line });
  let index = 0;
  const current = () => tokens[index];
  const fail = () => { throw new Error(`constants.py:${current()?.line ?? line}: only literal assignments are supported.`); };
  const take = value => {
    if (current().value !== value) fail();
    return tokens[index++];
  };
  const newlines = () => { while (current().type === "newline") index++; };
  function string(token) {
    return token.value.slice(1, -1).replace(/\\(x[^\n]{0,2}|u[^\n]{0,4}|U[^\n]{0,8}|.)/gu,
      (_, escape) => {
        if (/^[xuU]/u.test(escape)) {
          const widths = { x: 2, u: 4, U: 8 };
          if (escape.length !== widths[escape[0]] + 1 || !/^[xuU][\da-fA-F]+$/u.test(escape) || parseInt(escape.slice(1), 16) > 0x10ffff) fail();
          return String.fromCodePoint(parseInt(escape.slice(1), 16));
        }
        const escapes = { "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
        if (!Object.hasOwn(escapes, escape)) fail();
        return escapes[escape];
      });
  }
  function value(depth = 0) {
    if (depth > 48) fail();
    if (depth > 0) newlines();
    const token = tokens[index++];
    if (token.type === "number") {
      const result = Number(token.value);
      if (!Number.isFinite(result) || (/^\d+$/u.test(token.value) && (!Number.isSafeInteger(result) || /^0\d/u.test(token.value)))) fail();
      return result;
    }
    if (token.type === "string") return string(token);
    if (token.type === "word" && ["True", "False", "None"].includes(token.value)) {
      return { True: true, False: false, None: null }[token.value];
    }
    if (["-", "+"].includes(token.value)) {
      if (current().type !== "number") fail();
      const result = value(depth + 1);
      if (typeof result !== "number") fail();
      return token.value === "-" ? -result : result;
    }
    if (!["[", "(", "{"].includes(token.value)) fail();
    const close = { "[": "]", "(": ")", "{": "}" }[token.value];
    const result = token.value === "{" ? Object.create(null) : [];
    const keyTypes = new Map();
    let comma = false;
    newlines();
    while (current().value !== close) {
      const start = index;
      const item = value(depth + 1);
      if (token.value === "{") {
        if (typeof item !== "string" && typeof item !== "number") fail();
        // Preserve Python's integer key spelling when the result becomes JSON.
        if (typeof item === "number" && tokens.slice(start, index).some(part => part.type === "number" && !/^\d+$/u.test(part.value))) fail();
        // JavaScript cannot retain distinct Python keys such as 1 and "1".
        const key = String(item), type = typeof item;
        if (keyTypes.has(key) && keyTypes.get(key) !== type) fail();
        keyTypes.set(key, type);
        take(":"); result[item] = value(depth + 1);
      } else result.push(item);
      newlines();
      if (current().value !== ",") break;
      take(","); comma = true; newlines();
    }
    take(close);
    return token.value === "(" && result.length === 1 && !comma ? result[0] : result;
  }
  const result = Object.create(null);
  newlines();
  while (current().type !== "end") {
    const name = tokens[index++];
    if (name.type !== "word" || !/^[A-Z][A-Z0-9_]*$/u.test(name.value)) fail();
    take("="); result[name.value] = value();
    if (!["newline", "end"].includes(current().type)) fail();
    newlines();
  }
  return result;
}
