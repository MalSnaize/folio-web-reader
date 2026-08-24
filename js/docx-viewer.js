import { resolveSectionPalette, defaultThemeStore } from "./theme.js";

// One rule per (section id, line kind), mapping the exact Word paragraph style names
// Folio.Normalise.DocumentStyler bakes into every ingested .docx (IntroHdr, VrseChrd,
// ChorBdy, etc. — see ManagedStyleNames) onto plain HTML classes mammoth can target.
const SECTION_PREFIXES = [
  ["intro", "Intro"], ["verse", "Vrse"], ["pre-chorus", "PreChor"],
  ["bridge", "Brig"], ["chorus", "Chor"], ["outro", "Outro"],
];
const KIND_SUFFIXES = [["Hdr", "header"], ["Chrd", "chord"], ["Bdy", "body"]];

const STYLE_MAP = SECTION_PREFIXES.flatMap(([sectionId, prefix]) =>
  KIND_SUFFIXES.map(([suffix, kind]) =>
    `p[style-name='${prefix}${suffix}'] => p.sec-${kind}.sec-${sectionId}:fresh`));

export async function renderSongHtml(performerEntry, song) {
  const fileName = song.normalisedFilePath.split(/[\\/]/).pop();
  const fileHandle = await performerEntry.dirHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  const arrayBuffer = await file.arrayBuffer();

  const result = await window.mammoth.convertToHtml({ arrayBuffer }, { styleMap: STYLE_MAP });

  const container = document.createElement("div");
  container.innerHTML = result.value;
  stripLeadingInfoBlock(container);
  return container.innerHTML;
}

// IngestService writes the song's [Info] block ("[Info]" / "Performer: …" /
// "Song Title: …" / "Artist: …" / a blank line) as ordinary Normal-styled paragraphs
// ahead of the first real section — SectionHeaderParser deliberately never recognises
// "[Info]" as a section header, so nothing in the desktop app's own styling pass ever
// touches those lines either. We already have Title/Artist/Performer from performer.json,
// so this block is pure noise here — strip it before it reaches the page.
function stripLeadingInfoBlock(container) {
  for (const el of Array.from(container.children)) {
    if (el.classList.contains("sec-header")) break;
    const text = el.textContent.trim();
    if (text === "" || text === "[Info]" || /^(Performer|Song Title|Artist):/i.test(text)) {
      el.remove();
    } else {
      break; // unexpected content this early — stop stripping defensively
    }
  }
}

function cssFontFamily(name) {
  const safe = (name || "Consolas").replace(/"/g, "'");
  return `"${safe}", ui-monospace, "Courier New", monospace`;
}

// Builds the <style> block content for one performer's theme, scoped under a selector so
// switching songs (possibly between performers with different themes) just means
// swapping this block's textContent — see app.js's openSong.
export function buildThemeCss(themeStore, scopeSelector) {
  const store = themeStore?.sections?.length ? themeStore : defaultThemeStore();
  const typography = store.typography || defaultThemeStore().typography;
  const ptToPx = 96 / 72; // matches SongTheme.cs's PointsToDips

  const rules = [
    `${scopeSelector} { font-family: ${cssFontFamily(typography.fontFamily)}; font-size: ${typography.fontSize}pt; white-space: pre-wrap; }`,
    `${scopeSelector} p { margin: 0; }`,
  ];

  for (const section of store.sections) {
    const palette = resolveSectionPalette(section, "light");
    const id = section.sectionTypeId;
    rules.push(`
${scopeSelector} .sec-header.sec-${id} {
  background: ${palette.headerBackground}; color: ${palette.headerForeground};
  border-bottom: 3px solid ${palette.border}; font-weight: bold;
  padding: ${typography.headerSpacingBefore * ptToPx}px 14px ${typography.headerSpacingAfter * ptToPx}px;
}
${scopeSelector} .sec-chord.sec-${id} {
  color: ${palette.chordForeground}; background: ${palette.bodyBackground}; font-weight: bold;
  padding: ${typography.chordSpacingBefore * ptToPx}px 14px ${typography.chordSpacingAfter * ptToPx}px;
}
${scopeSelector} .sec-body.sec-${id} {
  color: ${palette.bodyForeground}; background: ${palette.bodyBackground};
  padding: ${typography.bodySpacingBefore * ptToPx}px 14px ${typography.bodySpacingAfter * ptToPx}px;
}`);
  }

  return rules.join("\n");
}
