export function handleFolder(handle) {
  return {
    name: handle.name,
    async directory(name) { return handleFolder(await handle.getDirectoryHandle(name)); },
    async file(name) { return (await handle.getFileHandle(name)).getFile(); },
    async *entries() {
      for await (const [name, entry] of handle.entries()) {
        yield entry.kind === "directory" ? { name, folder: handleFolder(entry) }
          : { name, file: () => entry.getFile() };
      }
    },
  };
}

export function entryFolder(entry) {
  // Dropped entries expose immediate children on demand, not a recursive FileList.
  async function child(name) {
    let count = 0;
    for await (const candidate of folder.entries()) {
      if (++count > 5000) throw new Error("Folder lookup limit reached. Drop the mod folder directly.");
      if (candidate.name === name) return candidate;
    }
    throw new DOMException("The requested entry was not found.", "NotFoundError");
  }
  const folder = {
    name: entry.name,
    async directory(name) {
      const found = await child(name);
      if (!found.folder) throw new DOMException("The entry is not a folder.", "TypeMismatchError");
      return found.folder;
    },
    async file(name) {
      const found = await child(name);
      if (!found.file) throw new DOMException("The entry is not a file.", "TypeMismatchError");
      return found.file();
    },
    async *entries() {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) return;
        for (const item of batch) {
          yield item.isDirectory ? { name: item.name, folder: entryFolder(item) }
            : { name: item.name, file: () => new Promise((resolve, reject) => item.file(resolve, reject)) };
        }
      }
    },
  };
  return folder;
}

export function droppedFolder(dataTransfer) {
  // Capture entries synchronously: the drop data store closes after this event.
  const items = [...dataTransfer.items].filter(item => item.kind === "file");
  if (items.length !== 1) throw new Error("Drop exactly one folder from your file manager.");
  const item = items[0];
  const entry = (item.getAsEntry || item.webkitGetAsEntry)?.call(item);
  if (!entry?.isDirectory) throw new Error("Drop a folder, rather than a file or link.");
  return entryFolder(entry);
}

export async function resolveFolder(root, parts) {
  for (const part of parts) root = await root.directory(part);
  return root;
}

async function breathe(signal, count) {
  signal.throwIfAborted();
  if (count % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}

export async function readCatalogue(dataFolder, signal) {
  const mods = [];
  let issues = 0, count = 0, partial = false;
  for await (const entry of dataFolder.entries()) {
    await breathe(signal, ++count);
    if (count > 1000) { partial = true; break; }
    if (!entry.folder) continue;
    try {
      const file = await entry.folder.file("workshop.json");
      signal.throwIfAborted();
      if (file.size > 262144) throw new Error("Workshop metadata is too large.");
      const text = await file.text();
      signal.throwIfAborted();
      const metadata = JSON.parse(text);
      if (typeof metadata?.title !== "string" || !metadata.title.trim() || metadata.title.length > 512) {
        throw new Error("Missing Workshop title.");
      }
      mods.push({ title: metadata.title.trim(), path: `data/${entry.name}` });
    } catch (error) {
      signal.throwIfAborted();
      if (error.name !== "NotFoundError") issues++;
    }
  }
  signal.throwIfAborted();
  return { mods, issues, partial };
}

export async function scanMetadata(root, signal, progress) {
  const files = [], stack = [{ folder: root, path: "", depth: 0 }];
  let partial = false, unreadable = 0, visited = 0;
  while (stack.length) {
    const current = stack.pop();
    try {
      for await (const entry of current.folder.entries()) {
        await breathe(signal, ++visited);
        if (visited > 5000) return { files, partial: true, unreadable };
        const path = current.path + entry.name;
        if (entry.folder) {
          if (current.depth >= 16) partial = true;
          else stack.push({ folder: entry.folder, path: path + "/", depth: current.depth + 1 });
        } else {
          if (files.length >= 1000) return { files, partial: true, unreadable };
          try {
            const file = await entry.file();
            signal.throwIfAborted();
            files.push({ name: entry.name, path, size: file.size, lastModified: file.lastModified });
          } catch {
            signal.throwIfAborted();
            unreadable++;
          }
        }
        signal.throwIfAborted();
        if (visited % 25 === 0) progress(files.length);
      }
    } catch (error) {
      if (error.name === "AbortError") throw error;
      unreadable++;
    }
  }
  signal.throwIfAborted();
  return { files, partial, unreadable };
}
