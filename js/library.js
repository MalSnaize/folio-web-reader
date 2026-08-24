import { defaultThemeStore } from "./theme.js";

// Reads the shared library straight out of the chosen folder — the same on-disk shape
// Folio.Library.SharedLibraryRepository writes on the desktop app:
//   Performers\<name>\performer.json  — { performer, songs }
//   Performers\<name>\theme.json      — that performer's own theme (optional; falls back
//                                        to defaults if they've never opened Styles)
//   Sets\sets.json                    — { sets }
export async function scanLibrary(rootHandle) {
  const performers = [];

  let performersRoot;
  try {
    performersRoot = await rootHandle.getDirectoryHandle("Performers");
  } catch {
    performersRoot = null;
  }

  if (performersRoot) {
    for await (const [, handle] of performersRoot.entries()) {
      if (handle.kind !== "directory") continue;

      let performerFile;
      try {
        const fileHandle = await handle.getFileHandle("performer.json");
        const file = await fileHandle.getFile();
        performerFile = JSON.parse(await file.text());
      } catch {
        continue; // no performer.json here yet — not a real performer folder
      }
      if (!performerFile?.performer) continue;

      let themeStore = defaultThemeStore();
      try {
        const themeHandle = await handle.getFileHandle("theme.json");
        const themeFile = await themeHandle.getFile();
        const parsed = JSON.parse(await themeFile.text());
        if (parsed?.sections?.length) themeStore = parsed;
      } catch {
        // No theme.json yet for this performer — defaults are fine.
      }

      performers.push({
        performer: performerFile.performer,
        songs: performerFile.songs || [],
        themeStore,
        dirHandle: handle,
      });
    }
  }

  let sets = [];
  try {
    const setsRoot = await rootHandle.getDirectoryHandle("Sets");
    const setsHandle = await setsRoot.getFileHandle("sets.json");
    const file = await setsHandle.getFile();
    const setsFile = JSON.parse(await file.text());
    sets = setsFile.sets || [];
  } catch {
    sets = [];
  }

  performers.sort((a, b) =>
    a.performer.name.localeCompare(b.performer.name, undefined, { sensitivity: "base" }));
  sets.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return { performers, sets };
}

// Songs are filed under NormalisedFilePath, an absolute path from whichever machine
// ingested them — not portable across devices. Only the filename is, and every song's
// .docx already lives right next to that performer's own performer.json/theme.json, so
// resolving by filename inside that folder is robust regardless of drive letter or path.
export function songFileName(song) {
  return song.normalisedFilePath.split(/[\\/]/).pop();
}

// Every song a set references, resolved against whichever performer folder actually has
// it (a set can mix songs filed under several performers). Missing songs are skipped
// rather than failing the whole set — the same tolerance SharedLibraryRepository already
// has for a stale/partial sync.
export function resolveSetSongs(set, performers) {
  const bySongId = new Map();
  for (const entry of performers)
    for (const song of entry.songs) bySongId.set(song.id, entry);

  return set.items
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((item) => {
      const entry = bySongId.get(item.songId);
      if (!entry) return null;
      const song = entry.songs.find((s) => s.id === item.songId);
      return song ? { song, performerEntry: entry } : null;
    })
    .filter(Boolean);
}
