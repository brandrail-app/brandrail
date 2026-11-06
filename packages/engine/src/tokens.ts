/**
 * Token import, flattening and diffing.
 *
 * Everything ends up as a W3C DTCG document (the Brand Kit's storage format). Dark-mode values
 * live in `$extensions["dev.brandrail"].modes.dark` so a token keeps one name and one CSS variable.
 *
 * Supported inputs:
 *  - DTCG JSON ($value / $type), including {alias.references}
 *  - Tokens Studio JSON (value / type, token sets, a set named "dark")
 *  - Figma REST "GET /v1/files/:key/variables/local" responses (collections, modes, aliases)
 *  - Plain mode-keyed objects such as { light: {...}, dark: {...}, compact: {...} }
 *    (what most "export Figma variables" scripts produce)
 *  - Figma colour and text styles (fallback for plans without the Variables API)
 *  - Figma's own variables export (Variables → Export modes): one DTCG file per mode, colours as
 *    DTCG 2025.10 objects, `com.figma.*` extensions. Several files (or a ZIP) are combined with
 *    `importTokenFiles`, Light and Dark becoming one token with a dark value.
 */
import { parseColor, toHex } from "./color.ts";
import type { DtcgDoc } from "./types.ts";

export const EXT = "dev.brandrail";

export type TokenType = "color" | "dimension" | "fontFamily" | "fontWeight" | "number" | "string";

export interface FlatToken {
  path: string;
  type: TokenType;
  value: string;
  dark?: string;
  description?: string;
}

export type ImportFormat = "dtcg" | "tokens-studio" | "figma-variables" | "figma-export" | "figma-styles" | "mode-object";

export interface ImportResult {
  format: ImportFormat;
  tokens: DtcgDoc;
  count: number;
  /** Raw palette tokens that semantic tokens point at; left out unless includePrimitives. */
  primitives: number;
  notes: string[];
}

export interface ImportOptions {
  includePrimitives?: boolean;
}

/* ───────────────────────── naming ───────────────────────── */

/** "base$Fill1" / "Base/Fill 1" / "fontSizeXs" → kebab segments */
export function slug(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

const segs = (name: string) => name.split(/[/$.]+/).map(slug).filter(Boolean);
const stripPrefix = (s: string, ...prefixes: string[]) => {
  for (const p of prefixes) if (s === p) return "";
  for (const p of prefixes) if (s.startsWith(`${p}-`)) return s.slice(p.length + 1);
  return s;
};

const WEIGHTS: Record<string, string> = {
  thin: "100",
  hairline: "100",
  "extra-light": "200",
  "ultra-light": "200",
  light: "300",
  regular: "400",
  regulare: "400",
  normal: "400",
  book: "400",
  medium: "500",
  "semi-bold": "600",
  semibold: "600",
  "demi-bold": "600",
  bold: "700",
  "extra-bold": "800",
  "ultra-bold": "800",
  black: "900",
  heavy: "900",
};

export function fontWeight(v: string | number): string {
  if (typeof v === "number") return String(v);
  return WEIGHTS[slug(v)] ?? (/^\d{3}$/.test(v.trim()) ? v.trim() : v);
}

function colorValue(v: unknown): string | null {
  // DTCG 2025.10: { colorSpace: "srgb", components: [r, g, b], alpha?, hex? } (Figma's export uses this)
  if (v && typeof v === "object" && ("components" in v || "hex" in v)) {
    const c = v as { colorSpace?: string; components?: Array<number | string>; alpha?: number; hex?: string };
    const alpha = typeof c.alpha === "number" ? c.alpha : 1;
    const withAlpha = (hex: string) => (alpha < 1 ? `${hex.slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : hex.slice(0, 7));
    if (typeof c.hex === "string" && /^#[0-9a-f]{6}/i.test(c.hex)) return withAlpha(c.hex.toLowerCase());
    const comps = c.components?.map((x) => (typeof x === "number" ? x : 0));
    if (comps?.length === 3 && (!c.colorSpace || /srgb|display-p3/i.test(c.colorSpace))) {
      return withAlpha(toHex({ r: comps[0]! * 255, g: comps[1]! * 255, b: comps[2]! * 255, a: 1 }));
    }
    return null;
  }
  if (v && typeof v === "object" && "r" in v) {
    const c = v as { r: number; g: number; b: number; a?: number };
    const hex = toHex({ r: c.r * 255, g: c.g * 255, b: c.b * 255, a: 1 });
    const a = c.a ?? 1;
    return a < 1 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}` : hex;
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(s)) {
    const h = s.slice(1).toLowerCase();
    return h.length === 3 || h.length === 4 ? `#${[...h].map((c) => c + c).join("")}` : `#${h}`;
  }
  const rgb = parseColor(s);
  if (!rgb) return null;
  const hex = toHex(rgb);
  return rgb.a < 1 ? `${hex}${Math.round(rgb.a * 255).toString(16).padStart(2, "0")}` : hex;
}

const dim = (v: unknown): string => {
  // DTCG 2025.10: { value: 16, unit: "px" | "rem" }
  if (v && typeof v === "object" && "value" in v) {
    const d = v as { value: number | string; unit?: string };
    const n = typeof d.value === "number" ? d.value : parseFloat(d.value);
    return d.unit === "rem" ? `${Math.round(n * 16 * 100) / 100}px` : `${Math.round(n * 100) / 100}px`;
  }
  return typeof v === "number" ? `${Math.round(v * 100) / 100}px` : String(v).trim();
};

/**
 * Decides where a token lives in the Brand Kit from its name, its Figma scopes and its value.
 * `name` is the full "collection/group/name" string; the path uses only the variable name.
 */
export function classify(
  name: string,
  kind: "color" | "number" | "string" | "boolean",
  value: unknown,
  opts: { scopes?: string[]; context?: string } = {},
): { path: string; type: TokenType; value: string } | null {
  const parts = segs(name);
  const hay = slug(`${opts.context ?? ""} ${name}`);
  const scopes = opts.scopes ?? [];
  const last = parts[parts.length - 1] ?? "";
  const rest = parts.slice(0, -1);

  if (kind === "boolean") return null;

  if (kind === "color") {
    const v = colorValue(value);
    if (!v) return null;
    let p = parts[0] === "color" || parts[0] === "colors" ? parts.slice(1) : parts;
    if (p.length === 1) p = [stripPrefix(p[0]!, "colors", "color") || p[0]!];
    // "gray-200" → gray.200 so palettes group naturally
    const tail = p[p.length - 1]!;
    const m = tail.match(/^(.*[a-z])-(\d+)$/);
    if (m && p.length <= 2) p = [...p.slice(0, -1), m[1]!, m[2]!];
    return { path: ["color", ...p].join("."), type: "color", value: v };
  }

  if (kind === "string") {
    const s = String(value);
    if (scopes.includes("FONT_FAMILY") || /font-family|typeface|font-name/.test(hay) || last === "font") {
      const n = stripPrefix(last, "font-family", "font", "family") || "sans";
      return { path: `font.family.${/mono|code/.test(s.toLowerCase()) && n === "sans" ? "mono" : n}`, type: "fontFamily", value: s };
    }
    if (scopes.includes("FONT_STYLE") || scopes.includes("FONT_WEIGHT") || /font-weight|weight/.test(hay)) {
      return { path: `font.weight.${stripPrefix(last, "font-weight", "weight") || last}`, type: "fontWeight", value: fontWeight(s) };
    }
    const c = colorValue(s);
    if (c && /^#|^rgb|^hsl/i.test(s.trim())) return classify(name, "color", s, opts);
    return null; // free text variables aren't design tokens
  }

  // numbers / dimensions
  const v = dim(value);
  const has = (...scope: string[]) => scope.some((x) => scopes.includes(x));
  const nm = (...prefixes: string[]) => stripPrefix(last, ...prefixes) || last;
  if (has("CORNER_RADIUS") || /radius|(^|-)rad(-|$)|corner|rounded/.test(hay)) return { path: `radius.${nm("radius", "rad", "corner", "rounded")}`, type: "dimension", value: v };
  if (has("FONT_SIZE") || /font-size|text-size/.test(hay)) return { path: `font.size.${nm("font-size", "text-size", "size")}`, type: "dimension", value: v };
  if (has("LINE_HEIGHT") || /line-height|leading/.test(hay)) return { path: `font.line-height.${nm("line-height", "leading")}`, type: "dimension", value: v };
  if (has("LETTER_SPACING") || /letter-spacing|tracking/.test(hay)) return { path: `font.letter-spacing.${nm("letter-spacing", "tracking")}`, type: "dimension", value: v };
  if (has("FONT_WEIGHT") || /font-weight/.test(hay)) return { path: `font.weight.${nm("font-weight", "weight")}`, type: "fontWeight", value: String(value) };
  if (/icon/.test(last)) return { path: `size.icon.${nm("icon")}`, type: "dimension", value: v };
  if (has("GAP") || /spac|gap|padding|margin|inset|(^|-)space(-|$)/.test(hay)) return { path: `space.${nm("spacing", "space", "gap")}`, type: "dimension", value: v };
  if (has("STROKE_FLOAT") || /stroke|border-width/.test(hay)) return { path: `border.width.${nm("border-width", "stroke")}`, type: "dimension", value: v };
  if (has("WIDTH_HEIGHT") || /size|width|height/.test(hay)) return { path: ["size", ...rest.filter((x) => x !== "size"), last].join("."), type: "dimension", value: v };
  return { path: ["number", ...parts].join("."), type: "number", value: String(value) };
}

/* ───────────────────────── DTCG in/out ───────────────────────── */

type Raw = { path: string; type?: string; value: unknown; description?: string; dark?: unknown };

function rawLeaves(node: unknown, prefix: string, out: Raw[], studio: boolean, inherited?: string) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const o = node as Record<string, unknown>;
  const groupType = (o.$type as string | undefined) ?? inherited;
  const isLeaf = "$value" in o || (studio && "value" in o && (typeof o.value !== "object" || o.value === null || "type" in o));
  if (isLeaf) {
    const ext = (o.$extensions as Record<string, { modes?: Record<string, unknown> }> | undefined)?.[EXT];
    out.push({
      path: prefix,
      type: (o.$type as string | undefined) ?? (o.type as string | undefined) ?? groupType,
      value: "$value" in o ? o.$value : o.value,
      description: (o.$description ?? o.description) as string | undefined,
      dark: ext?.modes?.dark,
    });
    return;
  }
  for (const [k, v] of Object.entries(o)) if (!k.startsWith("$")) rawLeaves(v, prefix ? `${prefix}.${k}` : k, out, studio, groupType);
}

const REF = /^\{([^}]+)\}$/;

function resolveRefs(raws: Raw[]): Raw[] {
  const byPath = new Map(raws.map((r) => [r.path, r]));
  const deref = (v: unknown, mode: "light" | "dark", depth = 0): unknown => {
    if (typeof v !== "string" || depth > 10) return v;
    const m = v.trim().match(REF);
    if (!m) return v.replace(/\{([^}]+)\}/g, (all, p: string) => String(byPath.get(p)?.value ?? all));
    const target = byPath.get(m[1]!);
    if (!target) return v;
    return deref(mode === "dark" && target.dark !== undefined ? target.dark : target.value, mode, depth + 1);
  };
  return raws.map((r) => ({ ...r, value: deref(r.value, "light"), dark: r.dark !== undefined ? deref(r.dark, "dark") : undefined }));
}

const TYPE_KIND: Record<string, "color" | "number" | "string"> = {
  color: "color",
  dimension: "number",
  spacing: "number",
  sizing: "number",
  borderradius: "number",
  fontsizes: "number",
  fontsize: "number",
  lineheights: "number",
  lineheight: "number",
  letterspacing: "number",
  number: "number",
  fontfamilies: "string",
  fontfamily: "string",
  fontweights: "string",
  fontweight: "string",
};

/** Flattens a DTCG (or Tokens Studio) doc. Keeps paths as they are; aliases are resolved. */
export function flattenTokens(doc: unknown): FlatToken[] {
  const raws = resolveRefs(collectRaw(doc).raws);
  const out: FlatToken[] = [];
  for (const r of raws) {
    const t = (r.type ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (t === "color" || (!t && r.path.startsWith("color"))) {
      const v = colorValue(r.value);
      if (!v) continue;
      const d = r.dark !== undefined ? colorValue(r.dark) : null;
      out.push({ path: r.path, type: "color", value: v, ...(d ? { dark: d } : {}), ...(r.description ? { description: r.description } : {}) });
    } else if (typeof r.value === "string" || typeof r.value === "number" || (r.value && typeof r.value === "object" && "unit" in (r.value as object))) {
      const type: TokenType =
        typeof r.value === "object" ? "dimension" : t === "fontfamily" || t === "fontfamilies" ? "fontFamily" : t === "fontweight" || t === "fontweights" ? "fontWeight" : TYPE_KIND[t] === "number" ? "dimension" : t === "number" ? "number" : /^font\.family\./.test(r.path) ? "fontFamily" : typeof r.value === "number" ? "number" : /px$|rem$/.test(String(r.value)) ? "dimension" : "string";
      out.push({ path: r.path, type, value: type === "dimension" ? dim(r.value) : String(r.value), ...(r.description ? { description: r.description } : {}) });
    }
  }
  return out;
}

function collectRaw(doc: unknown): { raws: Raw[]; studio: boolean } {
  const o = (doc ?? {}) as Record<string, unknown>;
  const studio = !hasDollarValue(o) && hasStudioValue(o);
  const order = (o.$metadata as { tokenSetOrder?: string[] } | undefined)?.tokenSetOrder;
  if (!studio) {
    const raws: Raw[] = [];
    rawLeaves(o, "", raws, false);
    return { raws, studio };
  }
  // Tokens Studio: top-level keys are token sets unless the doc is a single set.
  const setNames = (order ?? Object.keys(o).filter((k) => !k.startsWith("$"))).filter((k) => o[k] && typeof o[k] === "object");
  const looksLikeSets = setNames.length > 0 && setNames.every((k) => !hasLeafAtTop(o[k]));
  if (!looksLikeSets) {
    const raws: Raw[] = [];
    rawLeaves(o, "", raws, true);
    return { raws, studio };
  }
  const merged = new Map<string, Raw>();
  const darkSets = setNames.filter((n) => /dark/i.test(n));
  for (const set of setNames.filter((n) => !/dark/i.test(n))) {
    const raws: Raw[] = [];
    rawLeaves(o[set], "", raws, true);
    for (const r of raws) merged.set(r.path, r);
  }
  for (const set of darkSets) {
    const raws: Raw[] = [];
    rawLeaves(o[set], "", raws, true);
    for (const r of raws) {
      const base = merged.get(r.path);
      if (base) base.dark = r.value;
      else merged.set(r.path, r);
    }
  }
  return { raws: [...merged.values()], studio };
}

function hasDollarValue(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || depth > 12) return false;
  if ("$value" in (node as object)) return true;
  return Object.values(node as object).some((v) => hasDollarValue(v, depth + 1));
}
function hasStudioValue(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object" || depth > 12) return false;
  const o = node as Record<string, unknown>;
  if ("value" in o && "type" in o) return true;
  return Object.values(o).some((v) => hasStudioValue(v, depth + 1));
}
function hasLeafAtTop(node: unknown): boolean {
  return !!node && typeof node === "object" && ("value" in (node as object) || "$value" in (node as object));
}

/** Builds a DTCG doc from flat tokens. Later duplicates win. */
export function buildDtcg(tokens: FlatToken[]): DtcgDoc {
  const tree: DtcgDoc = {};
  for (const t of tokens) {
    const parts = t.path.split(".");
    let node = tree as Record<string, unknown>;
    parts.forEach((p, i) => {
      if (i === parts.length - 1) {
        node[p] = {
          $type: t.type,
          $value: t.value,
          ...(t.description ? { $description: t.description } : {}),
          ...(t.dark && t.dark !== t.value ? { $extensions: { [EXT]: { modes: { dark: t.dark } } } } : {}),
        };
      } else {
        const next = node[p];
        // A token and a group can't share a name: the group wins and the token moves to ".default".
        if (next && typeof next === "object" && "$value" in (next as object)) node[p] = { default: next };
        node = (node[p] ??= {}) as Record<string, unknown>;
      }
    });
  }
  return tree;
}

/* ───────────────────────── Figma variables ───────────────────────── */

type FigmaAlias = { type: "VARIABLE_ALIAS"; id: string };
export interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  valuesByMode: Record<string, unknown>;
  variableCollectionId: string;
  description?: string;
  hiddenFromPublishing?: boolean;
  remote?: boolean;
  scopes?: string[];
}
export interface FigmaCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
  hiddenFromPublishing?: boolean;
  remote?: boolean;
}
export interface FigmaVariablesMeta {
  variables: Record<string, FigmaVariable>;
  variableCollections: Record<string, FigmaCollection>;
}

const isAlias = (v: unknown): v is FigmaAlias => !!v && typeof v === "object" && (v as FigmaAlias).type === "VARIABLE_ALIAS";
const DARK = /dark|night/i;
const LIGHT = /light|default|day|base/i;

function finish(format: ImportFormat, all: Array<FlatToken & { referenced?: boolean }>, notes: string[], opts: ImportOptions): ImportResult {
  const PALETTE = /^(color\.[a-z-]+)\.\d{1,3}$/;
  const usedFamilies = new Set(all.filter((t) => t.referenced).map((t) => t.path.match(PALETTE)?.[1]).filter(Boolean));
  // Palette ramps (color.blue.50…900) are primitives once any ramp is referenced by a semantic token.
  if (usedFamilies.size) {
    const steps = new Map<string, number>();
    for (const t of all) {
      const f = t.path.match(PALETTE)?.[1];
      if (f) steps.set(f, (steps.get(f) ?? 0) + 1);
    }
    for (const t of all) {
      const f = t.path.match(PALETTE)?.[1];
      if (f && (usedFamilies.has(f) || (steps.get(f) ?? 0) >= 3)) t.referenced = true;
    }
  }
  const hasSemantic = all.some((t) => !t.referenced) && all.some((t) => t.referenced);
  const keep = opts.includePrimitives || !hasSemantic ? all : all.filter((t) => !t.referenced);
  const primitives = hasSemantic ? all.filter((t) => t.referenced).length : 0;
  // Dedupe on path (first wins), so two collections can't silently overwrite each other.
  const seen = new Set<string>();
  const tokens: FlatToken[] = [];
  for (const { referenced: _r, ...t } of keep) {
    if (seen.has(t.path)) continue;
    seen.add(t.path);
    tokens.push(t);
  }
  tokens.sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true }));
  return { format, tokens: buildDtcg(tokens), count: tokens.length, primitives, notes };
}

export function fromFigmaVariables(meta: FigmaVariablesMeta, opts: ImportOptions = {}): ImportResult {
  const vars = meta.variables ?? {};
  const cols = meta.variableCollections ?? {};
  const notes: string[] = [];
  const referenced = new Set<string>();

  const modeFor = (col: FigmaCollection, want: "default" | "dark", likeName?: string) => {
    if (likeName) {
      const same = col.modes.find((m) => m.name.toLowerCase() === likeName.toLowerCase());
      if (same) return same.modeId;
    }
    if (want === "dark") return col.modes.find((m) => DARK.test(m.name))?.modeId;
    return col.defaultModeId ?? col.modes[0]?.modeId;
  };

  const resolve = (v: FigmaVariable, want: "default" | "dark", modeName?: string, depth = 0): unknown => {
    const col = cols[v.variableCollectionId];
    if (!col) return undefined;
    const modeId = modeFor(col, want, modeName) ?? col.defaultModeId;
    const raw = v.valuesByMode[modeId!] ?? Object.values(v.valuesByMode)[0];
    if (!isAlias(raw)) return raw;
    referenced.add(raw.id);
    const target = vars[raw.id];
    if (!target || depth > 10) return undefined;
    const name = col.modes.find((m) => m.modeId === modeId)?.name;
    return resolve(target, want, name, depth + 1);
  };

  // Mark aliases in every mode first, so primitives are known.
  for (const v of Object.values(vars)) for (const val of Object.values(v.valuesByMode)) if (isAlias(val)) referenced.add(val.id);

  for (const col of Object.values(cols)) {
    if (col.remote) continue;
    const dark = col.modes.find((m) => DARK.test(m.name));
    const others = col.modes.filter((m) => m.modeId !== col.defaultModeId && m !== dark);
    if (others.length) {
      const def = col.modes.find((m) => m.modeId === col.defaultModeId)?.name;
      notes.push(`“${col.name}” has modes ${col.modes.map((m) => m.name).join(", ")}; used “${def}”${dark ? ` (and “${dark.name}” as dark)` : ""}.`);
    }
  }

  const out: Array<FlatToken & { referenced?: boolean }> = [];
  let hidden = 0;
  for (const v of Object.values(vars)) {
    const col = cols[v.variableCollectionId];
    if (!col || v.remote || col.remote) continue;
    if (v.hiddenFromPublishing) {
      hidden++;
      continue;
    }
    const kind = v.resolvedType === "COLOR" ? "color" : v.resolvedType === "FLOAT" ? "number" : v.resolvedType === "STRING" ? "string" : "boolean";
    const value = resolve(v, "default");
    if (value === undefined) continue;
    const c = classify(v.name, kind, value, { scopes: v.scopes?.filter((s) => s !== "ALL_SCOPES"), context: col.name });
    if (!c) continue;
    let darkValue: string | undefined;
    if (c.type === "color") {
      const hasDarkSomewhere = Object.values(cols).some((x) => x.modes.some((m) => DARK.test(m.name)));
      if (hasDarkSomewhere) {
        const d = colorValue(resolve(v, "dark"));
        if (d && d !== c.value) darkValue = d;
      }
    }
    out.push({ ...c, ...(darkValue ? { dark: darkValue } : {}), ...(v.description ? { description: v.description } : {}), referenced: referenced.has(v.id) });
  }
  if (hidden) notes.push(`${hidden} variable${hidden === 1 ? "" : "s"} hidden from publishing were skipped.`);
  return finish("figma-variables", out, notes, opts);
}

/* ───────────────────────── Figma styles (any plan) ───────────────────────── */

export interface FigmaStyleNode {
  name: string;
  styleType: "FILL" | "TEXT" | "EFFECT" | "GRID";
  description?: string;
  /** The style's node document from GET /v1/files/:key/nodes */
  node?: {
    fills?: Array<{ type: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } }>;
    style?: { fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeightPx?: number; letterSpacing?: number };
  };
}

export function fromFigmaStyles(styles: FigmaStyleNode[], opts: ImportOptions = {}): ImportResult {
  const out: FlatToken[] = [];
  const families = new Map<string, number>();
  let skipped = 0;
  for (const s of styles) {
    if (s.styleType === "FILL") {
      const fill = s.node?.fills?.find((f) => f.type === "SOLID" && f.visible !== false && f.color);
      if (!fill?.color) {
        skipped++;
        continue;
      }
      const c = classify(s.name, "color", { ...fill.color, a: (fill.color.a ?? 1) * (fill.opacity ?? 1) });
      if (c) out.push({ ...c, ...(s.description ? { description: s.description } : {}) });
    } else if (s.styleType === "TEXT" && s.node?.style) {
      const st = s.node.style;
      const name = segs(s.name).join("-");
      if (st.fontSize) out.push({ path: `font.size.${name}`, type: "dimension", value: dim(st.fontSize) });
      if (st.lineHeightPx) out.push({ path: `font.line-height.${name}`, type: "dimension", value: dim(Math.round(st.lineHeightPx)) });
      if (st.fontWeight) out.push({ path: `font.weight.${name}`, type: "fontWeight", value: String(st.fontWeight) });
      if (st.fontFamily) families.set(st.fontFamily, (families.get(st.fontFamily) ?? 0) + 1);
    }
  }
  const fams = [...families.entries()].sort((a, b) => b[1] - a[1]);
  fams.forEach(([f], i) => out.push({ path: `font.family.${i === 0 ? "sans" : /mono|code/i.test(f) ? "mono" : slug(f)}`, type: "fontFamily", value: f }));
  const notes = skipped ? [`${skipped} fill style${skipped === 1 ? "" : "s"} (gradients or images) were skipped.`] : [];
  return finish("figma-styles", out, notes, opts);
}

/* ───────────────────────── mode-keyed objects ───────────────────────── */

type Plain = Record<string, unknown>;

function plainLeaves(node: unknown, prefix: string[], out: Array<{ key: string[]; value: unknown }>) {
  if (node === null || node === undefined) return;
  if (typeof node !== "object" || (typeof node === "object" && "r" in (node as object) && "g" in (node as object))) {
    out.push({ key: prefix, value: node });
    return;
  }
  for (const [k, v] of Object.entries(node as Plain)) plainLeaves(v, [...prefix, k], out);
}

/**
 * Handles { light: {color:{...}}, dark: {color:{...}}, defaultRadius: {number:{...}}, rounded: {...} }:
 * top-level keys that share the same leaf names are treated as modes of one collection.
 */
export function fromModeObject(obj: Plain, opts: ImportOptions = {}): ImportResult {
  const notes: string[] = [];
  const modes = Object.entries(obj).filter(([, v]) => v && typeof v === "object") as Array<[string, Plain]>;
  const leafSets = modes.map(([name, v]) => {
    const l: Array<{ key: string[]; value: unknown }> = [];
    plainLeaves(v, [], l);
    return { name, leaves: l, keys: new Set(l.map((x) => x.key.join("/"))) };
  });

  // Group modes whose leaf names mostly overlap.
  const groups: Array<typeof leafSets> = [];
  for (const m of leafSets) {
    const g = groups.find((grp) => {
      const a = grp[0]!.keys;
      let same = 0;
      for (const k of m.keys) if (a.has(k)) same++;
      return same / Math.max(a.size, m.keys.size) >= 0.8;
    });
    if (g) g.push(m);
    else groups.push([m]);
  }

  // Leaf name → values per mode, for resolving references like "colorsGray200".
  const byLeaf = new Map<string, { group: number; values: Map<string, unknown> }>();
  groups.forEach((grp, gi) => {
    for (const m of grp) for (const l of m.leaves) {
      const k = l.key[l.key.length - 1]!;
      const e = byLeaf.get(k) ?? { group: gi, values: new Map() };
      e.values.set(m.name, l.value);
      byLeaf.set(k, e);
    }
  });
  const pick = (grp: typeof leafSets, want: "default" | "dark") =>
    want === "dark" ? grp.find((m) => DARK.test(m.name)) : grp.find((m) => LIGHT.test(m.name) && !DARK.test(m.name)) ?? grp.find((m) => !DARK.test(m.name)) ?? grp[0]!;

  const referenced = new Set<string>();
  for (const m of leafSets) for (const l of m.leaves) if (typeof l.value === "string" && byLeaf.has(l.value)) referenced.add(l.value);
  const deref = (v: unknown, want: "default" | "dark", depth = 0): unknown => {
    if (typeof v !== "string" || depth > 10) return v;
    const ref = byLeaf.get(v) ?? byLeaf.get(v.replace(REF, "$1"));
    if (!ref) return v;
    referenced.add(v);
    const grp = groups[ref.group]!;
    const mode = pick(grp, want) ?? pick(grp, "default");
    return deref(ref.values.get(mode!.name) ?? [...ref.values.values()][0], want, depth + 1);
  };

  const out: Array<FlatToken & { referenced?: boolean }> = [];
  const pending: Array<{ key: string; t: FlatToken }> = [];
  for (const grp of groups) {
    const def = pick(grp, "default")!;
    const dark = pick(grp, "dark");
    if (grp.length > 1) notes.push(`${grp.map((m) => m.name).join(" / ")} look like modes of one collection; used “${def.name}”${dark && dark !== def ? ` (and “${dark.name}” as dark)` : ""}.`);
    for (const l of def.leaves) {
      const key = l.key[l.key.length - 1]!;
      const container = l.key.length > 1 ? l.key[l.key.length - 2]!.toLowerCase() : "";
      const value = deref(l.value, "default");
      const kind = container === "color" || colorValue(value) && /^#|^rgb|^hsl/i.test(String(value)) ? "color" : container === "string" || (typeof value === "string" && !/^-?[\d.]+(px|rem|%)?$/.test(value)) ? "string" : "number";
      const c = classify(key, kind, kind === "number" && typeof value === "string" && /px$/.test(value) ? parseFloat(value) : value, { context: def.name });
      if (!c) continue;
      let d: string | undefined;
      if (c.type === "color") {
        const darkLeaf = dark && dark !== def ? dark.leaves.find((x) => x.key.join("/") === l.key.join("/")) : undefined;
        const dv = colorValue(deref(darkLeaf ? darkLeaf.value : l.value, "dark"));
        if (dv && dv !== c.value) d = dv;
      }
      pending.push({ key, t: { ...c, ...(d ? { dark: d } : {}) } });
    }
  }
  for (const p of pending) out.push({ ...p.t, referenced: referenced.has(p.key) });
  return finish("mode-object", out, notes, opts);
}

/* ───────────────────────── several files: Figma "Export modes", one file per mode ───────────────────────── */

export interface TokenFile {
  /** File name, with folders when it came from a ZIP: "Semantic/Dark.tokens.json". */
  name: string;
  data: unknown;
}

type FileLeaf = { path: string; type?: string; value: unknown; description?: string; scopes?: string[]; aliasTarget?: string; hidden?: boolean };

const figmaExt = (node: Plain, key: string): unknown => {
  const ext = node.$extensions as Plain | undefined;
  if (!ext) return undefined;
  if (`com.figma.${key}` in ext) return ext[`com.figma.${key}`];
  const nested = ext["com.figma"] as Plain | undefined;
  return nested?.[key];
};

function fileLeaves(node: unknown, prefix: string, out: FileLeaf[], inherited?: string) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return;
  const o = node as Plain;
  const groupType = (o.$type as string | undefined) ?? inherited;
  if ("$value" in o) {
    const alias = figmaExt(o, "aliasData") as { targetVariableName?: string } | undefined;
    const scopes = figmaExt(o, "scopes");
    out.push({
      path: prefix,
      type: (o.$type as string | undefined) ?? groupType,
      value: o.$value,
      description: o.$description as string | undefined,
      scopes: Array.isArray(scopes) ? (scopes as string[]) : undefined,
      aliasTarget: alias?.targetVariableName?.replace(/\//g, "."),
      hidden: figmaExt(o, "hiddenFromPublishing") === true || undefined,
    });
    return;
  }
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("$")) continue;
    // Figma writes a group's own value under "$root"-style keys; keep the group name.
    fileLeaves(v, prefix ? `${prefix}.${k}` : k, out, groupType);
  }
}

const hasFigmaExt = (node: unknown, depth = 0): boolean => {
  if (!node || typeof node !== "object" || depth > 12) return false;
  const ext = (node as Plain).$extensions as Plain | undefined;
  if (ext && Object.keys(ext).some((k) => k.startsWith("com.figma"))) return true;
  return Object.values(node as Plain).some((v) => hasFigmaExt(v, depth + 1));
};

function modeOf(file: TokenFile): { collection: string; mode: string } {
  const root = (file.data ?? {}) as Plain;
  const parts = file.name.replace(/\\/g, "/").split("/").filter(Boolean);
  const base = (parts.pop() ?? "tokens").replace(/(\.tokens)?\.json$/i, "");
  const named = figmaExt(root, "modeName");
  // "Semantic.Dark" / "Semantic - Dark" style names carry both parts.
  const split = base.match(/^(.+?)[\s._-]+(light|dark|night|day|default|mode[\s_-]*\d+)$/i);
  return {
    collection: parts.join("/") || (split ? split[1]! : ""),
    mode: typeof named === "string" ? named : split ? split[2]! : base,
  };
}

/**
 * Combines several token files: modes of one collection (Light.tokens.json + Dark.tokens.json)
 * become one token with a dark value; different collections (Primitives + Semantic) are merged,
 * so aliases between them resolve.
 */
export function importTokenFiles(files: TokenFile[], opts: ImportOptions = {}): ImportResult {
  const parsed = files.filter((f) => f.data && typeof f.data === "object");
  if (!parsed.length) throw new Error("No JSON token files found.");
  const figma = parsed.some((f) => hasFigmaExt(f.data));
  if (parsed.length === 1 && !figma) return importTokens(parsed[0]!.data, opts);

  const notes: string[] = [];
  const withMode = parsed.map((f) => ({ ...f, ...modeOf(f) }));
  const byCollection = new Map<string, typeof withMode>();
  for (const f of withMode) byCollection.set(f.collection, [...(byCollection.get(f.collection) ?? []), f]);

  const light = new Map<string, Raw & { leaf: FileLeaf }>();
  const darkOverrides = new Map<string, Raw & { leaf: FileLeaf }>();
  for (const [collection, list] of byCollection) {
    const dark = list.find((f) => DARK.test(f.mode));
    const def = list.find((f) => LIGHT.test(f.mode) && !DARK.test(f.mode)) ?? list.find((f) => !DARK.test(f.mode)) ?? list[0]!;
    if (list.length > 1) {
      const label = collection ? `“${collection}”` : "The files";
      notes.push(`${label}: modes ${list.map((f) => f.mode).join(", ")}; used “${def.mode}”${dark && dark !== def ? ` (and “${dark.mode}” as dark)` : ""}.`);
    }
    const read = (f: TokenFile, into: Map<string, Raw & { leaf: FileLeaf }>) => {
      const leaves: FileLeaf[] = [];
      fileLeaves(f.data, "", leaves);
      for (const l of leaves) into.set(l.path, { path: l.path, type: l.type, value: l.value, description: l.description, leaf: l });
    };
    read(def, light);
    if (dark && dark !== def) read(dark, darkOverrides);
  }

  // Resolve aliases per mode: dark uses its own values where it has them, light ones otherwise.
  const lightRaws = resolveRefs([...light.values()]);
  const darkRaws = resolveRefs([...light.values()].map((r) => darkOverrides.get(r.path) ?? r));
  const darkByPath = new Map(darkRaws.map((r) => [r.path, r.value]));

  const referenced = new Set<string>();
  for (const r of [...light.values(), ...darkOverrides.values()]) {
    if (r.leaf.aliasTarget) referenced.add(r.leaf.aliasTarget);
    const m = typeof r.value === "string" ? r.value.trim().match(REF) : null;
    if (m) referenced.add(m[1]!);
  }

  const out: Array<FlatToken & { referenced?: boolean }> = [];
  let hidden = 0;
  for (const r of lightRaws) {
    const leaf = light.get(r.path)!.leaf;
    if (leaf.hidden) {
      hidden++;
      continue;
    }
    const t = (r.type ?? "").toLowerCase();
    const kind = t === "color" ? "color" : t === "boolean" ? "boolean" : t === "string" || t === "fontfamily" || t === "fontweight" ? "string" : typeof r.value === "string" && !/^-?[\d.]+(px|rem)?$/.test(r.value) && !colorValue(r.value) ? "string" : colorValue(r.value) && t !== "number" && t !== "dimension" ? "color" : "number";
    let tok: { path: string; type: TokenType; value: string } | null;
    if (figma) {
      // Figma names (color/action/primary) go through the same mapping as the Variables API.
      const value = kind === "number" && r.value && typeof r.value === "object" ? parseFloat(dim(r.value)) : r.value;
      tok = classify(r.path.replace(/\./g, "/"), kind, value, { scopes: leaf.scopes?.filter((x) => x !== "ALL_SCOPES") });
    } else {
      const flat = flattenTokens({ x: { $type: r.type, $value: r.value } })[0];
      tok = flat ? { path: flat.type === "color" && !r.path.startsWith("color.") ? `color.${r.path}` : r.path, type: flat.type, value: flat.value } : null;
    }
    if (!tok) continue;
    let darkValue: string | undefined;
    if (tok.type === "color" && darkOverrides.size) {
      const d = colorValue(darkByPath.get(r.path));
      if (d && d !== tok.value) darkValue = d;
    }
    out.push({ ...tok, ...(darkValue ? { dark: darkValue } : {}), ...(r.description ? { description: r.description } : {}), referenced: referenced.has(r.path) });
  }
  if (hidden) notes.push(`${hidden} variable${hidden === 1 ? "" : "s"} hidden from publishing were skipped.`);
  return finish(figma ? "figma-export" : "dtcg", out, notes, opts);
}

/* ───────────────────────── entry point ───────────────────────── */

/** Detects the format of a parsed JSON document and converts it to DTCG. */
export function importTokens(input: unknown, opts: ImportOptions = {}): ImportResult {
  if (!input || typeof input !== "object") throw new Error("Expected a JSON object.");
  const o = input as Plain;
  if (Array.isArray(o.$files)) return importTokenFiles(o.$files as TokenFile[], opts);
  const meta = (o.meta ?? o) as Partial<FigmaVariablesMeta>;
  if (meta.variables && meta.variableCollections) return fromFigmaVariables(meta as FigmaVariablesMeta, opts);
  if (Array.isArray(o.styles) && (o.styles as FigmaStyleNode[]).every((s) => s && "styleType" in s)) return fromFigmaStyles(o.styles as FigmaStyleNode[], opts);

  if (hasDollarValue(o) && hasFigmaExt(o)) return importTokenFiles([{ name: "tokens.json", data: o }], opts);
  if (hasDollarValue(o) || hasStudioValue(o)) {
    const studio = !hasDollarValue(o);
    const flat = flattenTokens(o);
    if (!flat.length) throw new Error("No tokens found in that file.");
    // Paths from other tools may not follow our layout; keep the name, re-file by type.
    const out = flat.map((t) => {
      if (t.type === "color" && !t.path.startsWith("color.")) return { ...t, path: `color.${t.path}` };
      return t;
    });
    const notes = studio ? [] : [];
    const res = finish(studio ? "tokens-studio" : "dtcg", out, notes, opts);
    return res;
  }

  const leaves: Array<{ key: string[]; value: unknown }> = [];
  plainLeaves(o, [], leaves);
  if (leaves.length) return fromModeObject(o, opts);
  throw new Error("Couldn't find any tokens. Supported: DTCG, Tokens Studio, Figma variables JSON.");
}

/* ───────────────────────── diff ───────────────────────── */

export interface TokenDiff {
  added: FlatToken[];
  removed: FlatToken[];
  changed: Array<{ path: string; before: FlatToken; after: FlatToken }>;
  unchanged: number;
}

export function diffTokens(before: unknown, after: unknown): TokenDiff {
  const a = new Map(flattenTokens(before).map((t) => [t.path, t]));
  const b = new Map(flattenTokens(after).map((t) => [t.path, t]));
  const diff: TokenDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [p, t] of b) {
    const old = a.get(p);
    if (!old) diff.added.push(t);
    else if (old.value.toLowerCase() !== t.value.toLowerCase() || (old.dark ?? "").toLowerCase() !== (t.dark ?? "").toLowerCase()) diff.changed.push({ path: p, before: old, after: t });
    else diff.unchanged++;
  }
  for (const [p, t] of a) if (!b.has(p)) diff.removed.push(t);
  return diff;
}

/** Merges `incoming` over `base`: matching paths are updated, new ones added, nothing removed. */
export function mergeTokens(base: unknown, incoming: unknown): DtcgDoc {
  const m = new Map(flattenTokens(base).map((t) => [t.path, t]));
  for (const t of flattenTokens(incoming)) m.set(t.path, { ...m.get(t.path), ...t, description: t.description ?? m.get(t.path)?.description });
  return buildDtcg([...m.values()]);
}
