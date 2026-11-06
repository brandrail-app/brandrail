/**
 * Bridges a Brand Kit to the Brandrail UI kit (@brandrail/kit).
 *
 * The kit styles every component with its own CSS variables (--stateBrandActive, --spacing7,
 * --fontA-fontSizeBase, --defaultRadius-rad3 …). This maps the Brand Kit onto them, so kit
 * components follow the Brand Kit's colours, font, spacing, radius and type scale.
 *
 * Used by `brandrail init` (appended to brandrail.tokens.css, global) and by the dashboard
 * (scoped to the live library and the Brand Kit preview).
 */
import { flattenTokens, type FlatToken } from "./tokens.ts";

export type ColorRole = "canvas" | "subtle" | "fg" | "muted" | "border" | "primary" | "accent" | "danger";
type RoleColor = { path: string; value: string; dark?: string };

const ROLE_PATTERNS: Record<ColorRole, RegExp[]> = {
  canvas: [/canvas\.default$/, /^color\.(bg|background)(\.default)?$/, /surface(\.1|\.default)?$/, /canvas$/, /(bg|background)/],
  subtle: [/canvas\.subtle$/, /(bg|background)\.subtle$/, /surface\.2$/, /fill\.1$/, /subtle$/],
  fg: [/fg\.default$/, /text\.(default|primary|dark-primary)$/, /^color\.(fg|text|foreground)$/, /fg|text/],
  muted: [/fg\.muted$/, /text\.(muted|secondary|dark-secondary)$/, /muted|secondary/],
  border: [/border\.default$/, /^color\.(base\.)?border$/, /border/],
  primary: [/action\.primary$/, /^color\.(brand\.)?primary$/, /brand(-active)?$/, /primary/, /brand/],
  accent: [/accent(\.default)?$/, /link/, /info/, /accent/],
  danger: [/danger(\.default|-active)?$/, /error/, /danger/],
};
const ROLE_FALLBACK: Record<ColorRole, [string, string]> = {
  canvas: ["#ffffff", "#0d1117"],
  subtle: ["#f6f8fa", "#151b23"],
  fg: ["#1f2328", "#f0f6fc"],
  muted: ["#59636e", "#9198a1"],
  border: ["#d1d9e0", "#3d444d"],
  primary: ["#1f883d", "#238636"],
  accent: ["#0969da", "#4493f8"],
  danger: ["#cf222e", "#f85149"],
};
const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Which Brand Kit colour plays which part (page background, body text, primary action …), by name. */
export function pickColorRoles(colors: RoleColor[], dark = false): Record<ColorRole, { value: string; path?: string }> {
  const out = {} as Record<ColorRole, { value: string; path?: string }>;
  for (const role of Object.keys(ROLE_PATTERNS) as ColorRole[]) {
    let hit: RoleColor | undefined;
    for (const re of ROLE_PATTERNS[role]) {
      hit = colors.find((c) => re.test(c.path) && HEX.test(c.value));
      if (hit) break;
    }
    const fb = ROLE_FALLBACK[role][dark ? 1 : 0];
    if (!hit) out[role] = { value: fb };
    else if (!dark) out[role] = { value: hit.value, path: hit.path };
    else if (hit.dark) out[role] = { value: hit.dark, path: hit.path };
    // No dark value: keep brand colours (primary/accent/danger), swap neutrals for dark ones.
    else out[role] = role === "primary" || role === "accent" || role === "danger" ? { value: hit.value, path: hit.path } : { value: fb, path: hit.path };
  }
  return out;
}

const KIT_SPACING: Record<number, number> = { 3: 4, 4: 6, 5: 8, 6: 10, 7: 12, 8: 16, 9: 20, 10: 24, 11: 28, 12: 32, 13: 36, 14: 40, 15: 44, 16: 48, 17: 56, 18: 64 };
const KIT_RADIUS: Record<number, number> = { 1: 2, 2: 4, 3: 6, 4: 8, 5: 10, 6: 12, 7: 16, 8: 22, 9: 28 };
const KIT_RADIUS_NAME: Record<number, string> = { 2: "sm", 3: "md", 6: "lg" };
const KIT_TYPE: Array<[string, number, number]> = [
  ["Xs", 12, 18],
  ["Sm", 14, 22],
  ["Base", 16, 24],
  ["Md", 16, 24],
  ["Lg", 18, 28],
  ["Xl", 20, 32],
  ["2xl", 24, 38],
  ["3xl", 30, 42],
  ["4xl", 36, 52],
];
const KIT_THEMES = ["brandrail", "themeA", "themeB"];

const px = (v: string) => {
  const m = v.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  return m ? Number.parseFloat(m[1]!) * (m[2] === "rem" ? 16 : 1) : null;
};
const nearest = (values: number[], v: number) => values.reduce((best, x) => (Math.abs(x - v) < Math.abs(best - v) ? x : best), values[0]!);

function luminance(hex: string): number {
  const n = hex.replace("#", "").slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
/** Text on a filled brand colour: whichever Brand Kit neutral (page background or body text) reads better. */
function onColor(bg: string, candidates: string[]): string {
  return candidates.filter((c) => HEX.test(c)).sort((a, b) => contrast(b, bg) - contrast(a, bg))[0] ?? "#ffffff";
}

type Scales = { spacing: number[]; radii: Array<{ name: string; value: number }>; type: Array<{ name: string; size: number; lineHeight?: number }>; font?: string };

function scalesOf(flat: FlatToken[]): Scales {
  const leaf = (p: string) => p.split(".").pop()!;
  const spacing = flat.filter((t) => /^(space|spacing)\./.test(t.path) && !/\.unit$/.test(t.path)).map((t) => px(t.value)).filter((v): v is number => v !== null && v > 0 && v < 999);
  const unit = flat.find((t) => /^space\.unit$/.test(t.path));
  if (!spacing.length && unit && px(unit.value)) for (const m of [0.5, 1, 1.5, 2, 3, 4, 5, 6]) spacing.push(px(unit.value)! * m);
  const radii = flat.filter((t) => /^radius\./.test(t.path)).map((t) => ({ name: leaf(t.path), value: px(t.value) ?? -1 })).filter((r) => r.value > 0 && r.value < 999);
  const lineHeights = new Map(flat.filter((t) => /^font\.line-height\./.test(t.path)).map((t) => [leaf(t.path), px(t.value) ?? undefined]));
  const type = flat
    .filter((t) => /^font\.size\./.test(t.path))
    .map((t) => ({ name: leaf(t.path), size: px(t.value) ?? 0, lineHeight: lineHeights.get(leaf(t.path)) }))
    .filter((t) => t.size > 0);
  const font = flat.find((t) => t.type === "fontFamily" || /^font\.family\./.test(t.path))?.value;
  return { spacing, radii, type, font };
}

function scaleVars(s: Scales): string[] {
  const out: string[] = [];
  if (s.spacing.length) for (const [n, v] of Object.entries(KIT_SPACING)) out.push(`--spacing${n}: ${nearest(s.spacing, v)}px;`);
  if (s.radii.length) {
    const values = s.radii.map((r) => r.value);
    for (const [n, v] of Object.entries(KIT_RADIUS)) {
      const named = s.radii.find((r) => r.name === KIT_RADIUS_NAME[Number(n)]);
      out.push(`--defaultRadius-rad${n}: ${named ? named.value : nearest(values, v)}px;`);
    }
  }
  if (s.type.length) {
    const sizes = s.type.map((t) => t.size);
    for (const [name, size, lh] of KIT_TYPE) {
      const step = s.type.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? s.type.find((t) => t.size === nearest(sizes, size))!;
      out.push(`--fontA-fontSize${name}: ${step.size}px;`, `--fontA-lineHeight${name}: ${step.lineHeight ?? Math.round((step.size * lh) / size)}px;`);
    }
    const base = s.type.find((t) => t.name === "base") ?? s.type.find((t) => t.size === nearest(sizes, 14))!;
    out.push(`--fontSizeBase: ${base.size}px;`);
  }
  return out;
}

/** Colours and the font family: the kit's themes set these on each component, so they go in the per-theme blocks. */
function colorVars(colors: RoleColor[], dark: boolean, font?: string): string[] {
  const r = pickColorRoles(colors, dark);
  const find = (re: RegExp) => {
    const c = colors.find((x) => re.test(x.path));
    return c ? (dark ? c.dark ?? c.value : c.value) : undefined;
  };
  const success = find(/success/);
  const warning = find(/warning|attention/);
  const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
  const v: Record<string, string> = {
    baseSurface1: r.canvas.value,
    baseSurface2: r.subtle.value,
    baseSurface3: mix(r.subtle.value, r.border.value, 70),
    baseFill1: r.subtle.value,
    baseFill2: mix(r.subtle.value, r.border.value, 50),
    baseFill3: r.border.value,
    baseFill4: mix(r.muted.value, r.border.value, 60),
    baseFill5: r.muted.value,
    baseBorder: r.border.value,
    baseDisabled: mix(r.fg.value, "transparent", 28),
    textDarkPrimary: r.fg.value,
    textDarkSecondary: r.muted.value,
    textDarkTertiary: mix(r.muted.value, r.canvas.value, 75),
    textLightPrimary: onColor(r.primary.value, [pickColorRoles(colors, false).canvas.value, pickColorRoles(colors, false).fg.value]),
    stateBrandActive: r.primary.value,
    stateBrandHover: mix(r.primary.value, "black", 88),
    stateBrandSelected: mix(r.primary.value, "black", 75),
    stateDangerActive: r.danger.value,
    stateDangerHover: mix(r.danger.value, "black", 85),
    stateDangerSelected: mix(r.danger.value, r.canvas.value, 14),
    stateHighlightActive: r.accent.value,
    stateHighlightHover: mix(r.accent.value, r.canvas.value, 85),
    stateHighlightSelected: mix(r.accent.value, r.canvas.value, 14),
  };
  if (success) Object.assign(v, { stateSuccessActive: success, stateSuccessHover: mix(success, "black", 88), stateSuccessSelected: mix(success, r.canvas.value, 14) });
  if (warning) Object.assign(v, { stateWarningActive: warning, stateWarningHover: mix(warning, "black", 88), stateWarningSelected: mix(warning, r.canvas.value, 14) });
  if (font) Object.assign(v, { "fontA-fontFamily": font, "fontB-fontFamily": font });
  return Object.entries(v).map(([k, val]) => `--${k}: ${val};`);
}

/**
 * CSS that makes @brandrail/kit components follow a Brand Kit (a DTCG token document).
 * - `scope` (e.g. "#kit-preview"): only inside that element; the id beats the kit's theme files.
 * - no scope: the whole app. `html:root` + the theme classes beat both the kit's `:root` defaults
 *   and its `:root .brandrail.light` theme rules, whatever order the stylesheets load in.
 */
export function kitBridgeCss(tokens: unknown, opts: { scope?: string } = {}): string {
  const flat = flattenTokens(tokens);
  const colors = flat.filter((t) => t.type === "color").map((t) => ({ path: t.path, value: t.value, dark: t.dark }));
  const sc = scalesOf(flat);
  const scales = scaleVars(sc);
  const block = (sel: string, lines: string[]) => (lines.length ? `${sel} {\n  ${lines.join("\n  ")}\n}` : "");
  const themes = `:is(${KIT_THEMES.map((t) => `.${t}`).join(", ")})`;
  const s = opts.scope;
  const sel = s
    ? { scale: s, light: `${s}, ${s} .light`, dark: `${s} .dark, ${s}.dark` }
    : { scale: "html:root", light: `html:root, html:root ${themes}.light`, dark: `html:root ${themes}.dark` };
  return [block(sel.scale, scales), block(sel.light, colorVars(colors, false, sc.font)), block(sel.dark, colorVars(colors, true, sc.font))].filter(Boolean).join("\n");
}
