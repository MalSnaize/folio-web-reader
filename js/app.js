import { scanLibrary, resolveSetSongs } from "./library.js";
import { renderSongHtml, buildThemeCss } from "./docx-viewer.js";

const supportsFSAccess = typeof window.showDirectoryPicker === "function";

const libraryView = document.getElementById("library-view");
const viewerView = document.getElementById("viewer-view");
const chooseFolderBtn = document.getElementById("choose-folder-btn");
const folderPathEl = document.getElementById("folder-path");
const reconnectBanner = document.getElementById("reconnect-banner");
const reconnectBtn = document.getElementById("reconnect-btn");
const statusEl = document.getElementById("library-status");
const bodyEl = document.getElementById("library-body");
const performerTabsEl = document.getElementById("performer-tabs");
const songListEl = document.getElementById("song-list");
const setListEl = document.getElementById("set-list");
const themeStyleEl = document.getElementById("theme-style");

const songContentEl = document.getElementById("song-content");
const contentWrapEl = document.getElementById("song-content-wrap");
const viewerTitleEl = document.getElementById("viewer-title");
const viewerPositionEl = document.getElementById("viewer-position");
const closeBtn = document.getElementById("viewer-close-btn");
const prevBtn = document.getElementById("viewer-prev-btn");
const nextBtn = document.getElementById("viewer-next-btn");
const tapPrev = document.getElementById("viewer-tap-prev");
const tapNext = document.getElementById("viewer-tap-next");
const loadingEl = document.getElementById("viewer-loading");
const hud = document.getElementById("viewer-hud");

let library = { performers: [], sets: [] };
let selectedPerformerId = null;
let queue = []; // [{ song, performerEntry }]
let queueIndex = 0;
let pendingHandle = null;

// Pagination within the currently open song — see layoutPages(). Content is laid out as
// CSS columns exactly one viewport-width wide, and paging just translates that column
// strip sideways inside the clipped wrap, the same trick a lot of web e-readers use.
let pageIndex = 0;
let pageCount = 1;
let pageWidth = 0;

// ---------- IndexedDB (stores the last-picked directory handle) ----------

const DB_NAME = "folio-web-reader";
const STORE = "handles";
const HANDLE_KEY = "libraryFolder";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadStoredHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// ---------- Loading the chosen folder ----------

async function loadFromHandle(handle) {
  folderPathEl.textContent = handle.name;
  statusEl.textContent = "Reading library…";
  statusEl.classList.remove("hidden");
  bodyEl.classList.add("hidden");

  try {
    library = await scanLibrary(handle);
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Could not read a Folio library in this folder.";
    return;
  }

  if (library.performers.length === 0) {
    statusEl.textContent = "No performers found — choose the \"Folio Library\" folder itself (the one containing Performers\\ and Sets\\).";
    return;
  }

  statusEl.classList.add("hidden");
  bodyEl.classList.remove("hidden");
  selectedPerformerId = library.performers[0].performer.id;
  renderPerformerTabs();
  renderSongList();
  renderSetList();
}

// ---------- Library rendering ----------

function renderPerformerTabs() {
  performerTabsEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const entry of library.performers) {
    const btn = document.createElement("button");
    btn.className = "performer-tab" + (entry.performer.id === selectedPerformerId ? " active" : "");
    btn.textContent = `${entry.performer.name} (${entry.songs.length})`;
    btn.addEventListener("click", () => {
      selectedPerformerId = entry.performer.id;
      renderPerformerTabs();
      renderSongList();
    });
    frag.appendChild(btn);
  }
  performerTabsEl.appendChild(frag);
}

function renderSongList() {
  songListEl.innerHTML = "";
  const entry = library.performers.find((p) => p.performer.id === selectedPerformerId);
  if (!entry) return;

  const songs = entry.songs
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));

  if (songs.length === 0) {
    songListEl.innerHTML = `<li class="empty-row">No songs for ${escapeHtml(entry.performer.name)} yet.</li>`;
    return;
  }

  const frag = document.createDocumentFragment();
  songs.forEach((song) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="song-title">${escapeHtml(song.title)}</span>
      <span class="song-meta">${escapeHtml(song.artist || "")}${song.key ? ` &middot; ${escapeHtml(song.key)}` : ""}</span>`;
    li.addEventListener("click", () => openQueue([{ song, performerEntry: entry }], 0));
    frag.appendChild(li);
  });
  songListEl.appendChild(frag);
}

function renderSetList() {
  setListEl.innerHTML = "";
  if (library.sets.length === 0) {
    setListEl.innerHTML = `<li class="empty-row">No sets yet.</li>`;
    return;
  }

  const frag = document.createDocumentFragment();
  for (const set of library.sets) {
    const resolved = resolveSetSongs(set, library.performers);
    const li = document.createElement("li");
    li.innerHTML = `<span class="song-title">${escapeHtml(set.name)}</span>
      <span class="song-meta">${resolved.length} ${resolved.length === 1 ? "song" : "songs"}</span>`;
    li.addEventListener("click", () => {
      if (resolved.length === 0) return;
      openQueue(resolved, 0);
    });
    frag.appendChild(li);
  }
  setListEl.appendChild(frag);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Folder selection wiring ----------

chooseFolderBtn.addEventListener("click", async () => {
  if (!supportsFSAccess) {
    statusEl.textContent = "This browser doesn't support opening a local folder (needs Chrome or Edge). Safari and Firefox aren't supported yet.";
    statusEl.classList.remove("hidden");
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    reconnectBanner.classList.add("hidden");
    await saveHandle(handle);
    await loadFromHandle(handle);
  } catch (err) {
    if (err.name !== "AbortError") console.error(err);
  }
});

reconnectBtn.addEventListener("click", async () => {
  if (!pendingHandle) return;
  try {
    const perm = await pendingHandle.requestPermission({ mode: "read" });
    if (perm === "granted") {
      reconnectBanner.classList.add("hidden");
      await loadFromHandle(pendingHandle);
    }
  } catch (err) {
    console.error(err);
  }
});

async function restoreLastFolder() {
  if (!supportsFSAccess) return;
  try {
    const handle = await loadStoredHandle();
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: "read" });
    if (perm === "granted") {
      await loadFromHandle(handle);
    } else {
      pendingHandle = handle;
      folderPathEl.textContent = handle.name;
      reconnectBanner.classList.remove("hidden");
    }
  } catch (err) {
    console.error(err);
  }
}

// ---------- Song viewer ----------

async function openQueue(items, startIndex) {
  queue = items;
  queueIndex = startIndex;

  libraryView.classList.remove("active");
  viewerView.classList.add("active");
  requestViewerFullscreen();

  await openCurrentSong();
}

async function openCurrentSong() {
  const item = queue[queueIndex];
  if (!item) return;

  viewerTitleEl.textContent = `${item.song.title}${item.song.artist ? " — " + item.song.artist : ""}`;

  loadingEl.textContent = "Loading…";
  loadingEl.classList.remove("hidden");
  songContentEl.innerHTML = "";
  songContentEl.style.transform = "translateX(0)";

  themeStyleEl.textContent = buildThemeCss(item.performerEntry.themeStore, "#song-content");

  try {
    songContentEl.innerHTML = await renderSongHtml(item.performerEntry, item.song);
    layoutPages();
  } catch (err) {
    console.error(err);
    songContentEl.innerHTML = `<p class="viewer-error">Could not open "${escapeHtml(item.song.title)}" — its file may be missing or still syncing.</p>`;
    pageCount = 1;
  }

  pageIndex = 0;
  goToPage(0);
  loadingEl.classList.add("hidden");
  resetHudTimer();
}

// Lays the just-rendered song out as fixed-width, fixed-height CSS columns — one column
// per "page". #song-content's own box stays exactly one column wide (its normal CSS
// width), while the columns it generates overflow sideways beyond that box; the wrap
// around it clips that overflow (overflow: hidden), so only whichever column is scrolled
// into view via transform: translateX() is ever visible. Needs a real column-height, or
// the browser just makes one very tall column instead of paginating at all.
function layoutPages() {
  pageWidth = songContentEl.clientWidth;
  const wrapHeight = contentWrapEl.clientHeight;
  songContentEl.style.height = `${wrapHeight}px`;
  songContentEl.style.columnWidth = `${pageWidth}px`;
  songContentEl.style.columnGap = "0px";
  songContentEl.style.columnFill = "auto";

  const totalWidth = songContentEl.scrollWidth;
  pageCount = pageWidth > 0 ? Math.max(1, Math.round(totalWidth / pageWidth)) : 1;
}

function goToPage(index) {
  pageIndex = Math.min(Math.max(index, 0), pageCount - 1);
  songContentEl.style.transform = `translateX(-${pageIndex * pageWidth}px)`;
  updateViewerHud();
}

function updateViewerHud() {
  const songPart = queue.length > 1 ? `Song ${queueIndex + 1}/${queue.length}` : "";
  const pagePart = pageCount > 1 ? `Page ${pageIndex + 1}/${pageCount}` : "";
  viewerPositionEl.textContent = [songPart, pagePart].filter(Boolean).join(" · ");

  const showNav = queue.length > 1 || pageCount > 1;
  prevBtn.classList.toggle("hidden", !showNav);
  nextBtn.classList.toggle("hidden", !showNav);
  prevBtn.disabled = pageIndex === 0 && queueIndex === 0;
  nextBtn.disabled = pageIndex === pageCount - 1 && queueIndex === queue.length - 1;
}

// Page-turn first; only crosses into the next/previous song once you're already at that
// song's last/first page — same as flipping through a printed set list.
function nextPage() {
  if (pageIndex < pageCount - 1) goToPage(pageIndex + 1);
  else if (queueIndex < queue.length - 1) {
    queueIndex++;
    openCurrentSong();
  }
  resetHudTimer();
}

function prevPage() {
  if (pageIndex > 0) goToPage(pageIndex - 1);
  else if (queueIndex > 0) {
    queueIndex--;
    openCurrentSong();
  }
  resetHudTimer();
}

function closeViewer() {
  viewerView.classList.remove("active");
  libraryView.classList.add("active");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  clearTimeout(hudTimer);
}

function requestViewerFullscreen() {
  const el = viewerView;
  const request = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
  if (request) request.call(el).catch(() => {});
}

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && viewerView.classList.contains("active")) closeViewer();
});

closeBtn.addEventListener("click", closeViewer);
prevBtn.addEventListener("click", prevPage);
nextBtn.addEventListener("click", nextPage);
tapPrev.addEventListener("click", prevPage);
tapNext.addEventListener("click", nextPage);

document.addEventListener("keydown", (e) => {
  if (!viewerView.classList.contains("active")) return;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
      e.preventDefault();
      nextPage();
      break;
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
      e.preventDefault();
      prevPage();
      break;
    case "Escape":
      closeViewer();
      break;
  }
});

let touchStartX = 0;
let touchStartY = 0;
viewerView.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
});
viewerView.addEventListener("touchend", (e) => {
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
    if (dx < 0) nextPage();
    else prevPage();
  }
});

// Recompute the column layout on resize/orientation-change (e.g. a phone rotating, or an
// on-screen keyboard changing viewport height) and re-clamp to the nearest valid page.
window.addEventListener("resize", () => {
  if (!viewerView.classList.contains("active") || !songContentEl.innerHTML) return;
  const previousIndex = pageIndex;
  layoutPages();
  goToPage(previousIndex);
});

let hudTimer = null;
function resetHudTimer() {
  hud.classList.remove("faded");
  closeBtn.classList.remove("faded");
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    hud.classList.add("faded");
    closeBtn.classList.add("faded");
  }, 2500);
}
contentWrapEl.addEventListener("click", resetHudTimer);
window.addEventListener("mousemove", () => {
  if (viewerView.classList.contains("active")) resetHudTimer();
});

// ---------- Init ----------

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => console.error(err));
  });
}

if (!supportsFSAccess) {
  statusEl.textContent = "This browser doesn't support opening a local folder (needs Chrome or Edge). Safari and Firefox aren't supported yet.";
}

restoreLastFolder();
