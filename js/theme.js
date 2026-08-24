// Faithful JS port of Folio-Multi-User's Folio.Core.Theming (ColourUtility +
// ThemeVariantGenerator + ThemeDefaults). Kept in lockstep with that C# by hand — there's
// no shared source between the WPF app and this static site, so a change to the desktop
// app's auto-colour algorithm needs the same change made here too.

const ROLES = [
  "headerBackground", "headerForeground", "bodyBackground",
  "bodyForeground", "chordForeground", "border", "accent",
];

const BUILT_IN_SECTIONS = [
  { id: "verse", label: "Verse", theme: "#64748B" },
  { id: "chorus", label: "Chorus", theme: "#2878D0" },
  { id: "pre-chorus", label: "Pre-Chorus", theme: "#0F8F84" },
  { id: "bridge", label: "Bridge", theme: "#7C4FB2" },
  { id: "intro", label: "Intro", theme: "#C27A16" },
  { id: "outro", label: "Outro", theme: "#53636F" },
  { id: "other", label: "Other", theme: "#8A6E52" },
];

function normalizeHex(value) {
  if (!value) return null;
  let text = value.trim();
  if (text.startsWith("#")) text = text.slice(1);
  if (text.length === 3) text = [...text].map((c) => c + c).join("");
  if (text.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return "#" + text.toUpperCase();
}

function parseHex(value) {
  const normalized = normalizeHex(value);
  if (!normalized) throw new Error(`'${value}' is not a valid hexadecimal colour.`);
  return {
    r: parseInt(normalized.slice(1, 3), 16) / 255,
    g: parseInt(normalized.slice(3, 5), 16) / 255,
    b: parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

function toLinear(v) { return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function toSrgb(v) { return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; }

function rgbToHex({ r, g, b }) {
  const toByte = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const hex = (v) => toByte(v).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function toOklch(hexOrRgb) {
  const { r, g, b } = typeof hexOrRgb === "string" ? parseHex(hexOrRgb) : hexOrRgb;
  const red = toLinear(r), green = toLinear(g), blue = toLinear(b);

  const l = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue;
  const m = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue;
  const s = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue;
  const lRoot = Math.cbrt(l), mRoot = Math.cbrt(m), sRoot = Math.cbrt(s);

  const lightness = 0.2104542553 * lRoot + 0.7936177850 * mRoot - 0.0040720468 * sRoot;
  const a = 1.9779984951 * lRoot - 2.4285922050 * mRoot + 0.4505937099 * sRoot;
  const bb = 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.8086757660 * sRoot;
  const chroma = Math.sqrt(a * a + bb * bb);
  let hue = chroma < 0.00001 ? 0 : (Math.atan2(bb, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return { l: lightness, c: chroma, h: hue };
}

function oklchToRgbUnclamped({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);
  const lRoot = l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = l - 0.0894841775 * a - 1.2914855480 * b;
  const ll = lRoot ** 3, mm = mRoot ** 3, ss = sRoot ** 3;
  return {
    r: toSrgb(4.0767416621 * ll - 3.3077115913 * mm + 0.2309699292 * ss),
    g: toSrgb(-1.2684380046 * ll + 2.6097574011 * mm - 0.3413193965 * ss),
    b: toSrgb(-0.0041960863 * ll - 0.7034186147 * mm + 1.7076147010 * ss),
  };
}

function inGamut({ r, g, b }) { return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1; }

function fromOklch({ l, c, h }) {
  const lightness = Math.min(1, Math.max(0, l));
  let chroma = Math.max(0, c);
  for (let attempt = 0; attempt < 30; attempt++) {
    const rgb = oklchToRgbUnclamped({ l: lightness, c: chroma, h });
    if (inGamut(rgb)) return rgbToHex(rgb);
    chroma *= 0.9;
  }
  const rgb = oklchToRgbUnclamped({ l: lightness, c: chroma, h });
  return rgbToHex({ r: Math.min(1, Math.max(0, rgb.r)), g: Math.min(1, Math.max(0, rgb.g)), b: Math.min(1, Math.max(0, rgb.b)) });
}

function relativeLuminance(rgb) {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

function contrastRatio(first, second) {
  const a = relativeLuminance(parseHex(first));
  const b = relativeLuminance(parseHex(second));
  const lighter = Math.max(a, b), darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableNeutral(background) {
  const blackContrast = contrastRatio("#111827", background);
  const whiteContrast = contrastRatio("#FFFFFF", background);
  return whiteContrast >= blackContrast ? "#FFFFFF" : "#111827";
}

function tone(baseTheme, lightness, chromaMultiplier) {
  const source = toOklch(baseTheme);
  return fromOklch({ l: lightness, c: source.c * chromaMultiplier, h: source.h });
}

// Mirrors ThemeVariantGenerator.Generate — the "Auto" palette for a base theme colour.
function generate(baseTheme, appearance) {
  const normalized = normalizeHex(baseTheme) || "#64748B";
  const isLight = appearance === "light";

  const header = isLight ? tone(normalized, 0.46, 0.95) : tone(normalized, 0.32, 0.82);
  const body = isLight ? tone(normalized, 0.93, 0.22) : tone(normalized, 0.20, 0.22);
  let chord = isLight ? tone(normalized, 0.45, 0.96) : tone(normalized, 0.78, 0.90);
  chord = ensureContrast(chord, body);
  const border = tone(normalized, isLight ? 0.72 : 0.46, isLight ? 0.50 : 0.62);
  const accent = isLight ? normalized : tone(normalized, 0.68, 0.90);

  return {
    headerBackground: header,
    headerForeground: readableNeutral(header),
    bodyBackground: body,
    bodyForeground: readableNeutral(body),
    chordForeground: chord,
    border,
    accent,
  };
}

function ensureContrast(foreground, background, target = 4.5) {
  if (contrastRatio(foreground, background) >= target) return normalizeHex(foreground);

  const source = toOklch(foreground);
  const preferLight = contrastRatio("#FFFFFF", background) >= contrastRatio("#111827", background);
  for (let step = 1; step <= 100; step++) {
    const progress = step / 100;
    const targetLightness = preferLight ? 1 : 0.08;
    const candidate = fromOklch({
      l: source.l + (targetLightness - source.l) * progress,
      c: source.c * (1 - progress * 0.55),
      h: source.h,
    });
    if (contrastRatio(candidate, background) >= target) return candidate;
  }
  return readableNeutral(background);
}

// Mirrors JsonThemeRepository.Rehydrate: start from the Auto palette for this section's
// base theme colour, then apply any persisted per-role Manual overrides on top.
function resolveSectionPalette(section, appearance) {
  const auto = generate(section.theme, appearance);
  const overrides = (appearance === "light" ? section.lightOverrides : section.darkOverrides) || {};
  const resolved = {};
  for (const role of ROLES) resolved[role] = overrides[role] || auto[role];
  return resolved;
}

// Builds the default theme store used when a performer has no theme.json of their own yet
// (mirrors ThemeDefaults.CreateStore).
function defaultThemeStore() {
  return {
    typography: {
      fontFamily: "Consolas", fontSize: 15,
      headerSpacingBefore: 16, headerSpacingAfter: 12,
      chordSpacingBefore: 12, chordSpacingAfter: 6,
      bodySpacingBefore: 6, bodySpacingAfter: 6,
    },
    sections: BUILT_IN_SECTIONS.map((s) => ({
      sectionTypeId: s.id, sectionLabel: s.label, theme: s.theme, isBuiltIn: true,
      lightOverrides: {}, darkOverrides: {},
    })),
  };
}

export { ROLES, BUILT_IN_SECTIONS, normalizeHex, generate, resolveSectionPalette, defaultThemeStore, contrastRatio };
