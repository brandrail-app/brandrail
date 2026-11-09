import { deltaE, parseColor, rgbToLab } from "./color.ts";
import { isGenericFont, nearest, normalizeFontFamily, type ResolvedConfig } from "./config.ts";
import { FRAMEWORK_LABEL, resolveUsage, type ResolvedUsage } from "./frameworks.ts";
import { componentForConcept, findLegacyUsages, LIBRARY_LABEL } from "./migrate.ts";
import type { FileKind } from "./source.ts";
import type { ComponentEntry, EventSpec, Framework, PropSpec, Severity } from "./types.ts";

export interface Finding {
  offset: number;
  message: string;
  suggestion?: string;
  severity?: Severity;
}

export interface RuleContext {
  path: string;
  kind: FileKind;
  /** Source with comments blanked out (same offsets as the original). */
  code: string;
  config: ResolvedConfig;
  /** Whose components apply in this file: react for .tsx, angular for templates and @Component files, vue for .vue, html for PHP/Twig/Mustache. */
  framework: Framework;
}

export interface Rule {
  id: string;
  title: string;
  description: string;
  defaultSeverity: Severity;
  kinds: FileKind[];
  check(ctx: RuleContext): Finding[];
}

const MARKUP: FileKind[] = ["jsx", "vue", "svelte", "html", "template"];
const ALL: FileKind[] = ["jsx", "vue", "svelte", "html", "template", "css"];

function* matches(re: RegExp, text: string) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}

const lineBefore = (code: string, offset: number, max = 80) => {
  const start = Math.max(code.lastIndexOf("\n", offset - 1) + 1, offset - max);
  return code.slice(start, offset);
};

const lineOf = (code: string, offset: number) => {
  const start = code.lastIndexOf("\n", offset - 1) + 1;
  const end = code.indexOf("\n", offset);
  return code.slice(start, end === -1 ? undefined : end);
};

const fmt = (n: number) => `${Math.round(n * 100) / 100}px`;

function neighbours(scale: number[], v: number): string {
  const lower = [...scale].reverse().find((x) => x <= v);
  const upper = scale.find((x) => x >= v);
  const opts = [...new Set([lower, upper].filter((x): x is number => x !== undefined))];
  return opts.map(fmt).join(" or ");
}

function pxValues(value: string): Array<{ n: number; index: number }> {
  const out: Array<{ n: number; index: number }> = [];
  for (const m of matches(/(-?\d*\.?\d+)(px|rem)\b/g, value)) {
    const n = Math.abs(parseFloat(m[1]!)) * (m[2] === "rem" ? 16 : 1);
    out.push({ n, index: m.index });
  }
  return out;
}


const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Style values set outside a CSS declaration, which the declaration regexes miss:
 * - quoted keys, as in Angular [ngStyle]="{'padding': '13px', 'margin.px': 6}" or Vue :style="{ 'border-radius': '5px' }"
 * - camelCase keys with a string value: { paddingTop: '13px' }
 * - Angular style bindings: [style.padding.px]="13", [style.border-radius]="'5px'", [style.font-family]="'Comic Sans MS'"
 * Each value comes back with px added when the key or binding carries the unit.
 */
function styleBindings(code: string): Array<{ prop: string; value: string; offset: number }> {
  const out: Array<{ prop: string; value: string; offset: number }> = [];
  const withUnit = (v: string, unit?: string) => (unit && /^-?\d*\.?\d+$/.test(v.trim()) ? `${v.trim()}${unit === "%" ? "%" : unit}` : v);
  for (const m of matches(/(['"])([a-zA-Z-]+)(?:\.(px|rem|em|%))?\1\s*:\s*(?:(['"`])([^'"`\n]*)\4|(-?\d*\.?\d+)(?![\w.]))/g, code)) {
    const value = m[5] ?? m[6]!;
    const offset = m.index + m[0].length - value.length - (m[5] !== undefined ? 1 : 0);
    out.push({ prop: kebab(m[2]!), value: withUnit(value, m[3]), offset });
  }
  for (const m of matches(/(?<![\w.'"-])((?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block)(?:Start|End)?|rowGap|columnGap|border(?:Top|Bottom)?(?:Left|Right)?Radius)\s*:\s*(['"`])([^'"`\n]*\d(?:px|rem)[^'"`\n]*)\2/g, code)) {
    out.push({ prop: kebab(m[1]!), value: m[3]!, offset: m.index + m[0].length - m[3]!.length - 1 });
  }
  for (const m of matches(/\[style\.([a-zA-Z-]+)(?:\.(px|rem|em|%))?\]\s*=\s*(["'])([\s\S]*?)\3/g, code)) {
    const inner = m[4]!.trim();
    // "'13px'" is a string literal inside the binding; "13" is a number; anything else is an expression we can't judge.
    const lit = /^(['"`])(.*)\1$/.exec(inner)?.[2] ?? (/^-?\d*\.?\d+$/.test(inner) ? inner : null);
    if (lit === null) continue;
    out.push({ prop: kebab(m[1]!), value: withUnit(lit, m[2]), offset: m.index + m[0].length - 1 - m[4]!.length + m[4]!.indexOf(inner) });
  }
  return out;
}

/**
 * A declaration's value without what follows it in markup: in `style="margin: 7px">…20px…` only "7px" counts.
 * A quoted value (JSX `padding: "13px"`) runs to its closing quote.
 */
function declValue(v: string, kind: FileKind): string {
  if (kind === "css") return v;
  const q = v[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = v.indexOf(q, 1);
    return end === -1 ? v : v.slice(0, end + 1);
  }
  const cut = v.search(/["'`>]/);
  return cut === -1 ? v : v.slice(0, cut);
}

const SPACING_PROP = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)$/;
const RADIUS_PROP = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;

/* ------------------------------------------------------------------ */

export const noHardcodedColor: Rule = {
  id: "no-hardcoded-color",
  title: "Hard-coded colour",
  description: "Colours must come from Brand Kit tokens, not hex / rgb / hsl literals.",
  defaultSeverity: "error",
  kinds: ALL,
  check({ code, kind, config }) {
    if (config.colors.length === 0) return [];
    const out: Finding[] = [];
    const re = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|(?<![\w-])(?:rgba?|hsla?)\(\s*[^()]*\)/g;
    for (const m of matches(re, code)) {
      const raw = m[0];
      const before = lineBefore(code, m.index);
      const line = lineOf(code, m.index);
      if (raw.startsWith("#")) {
        const prev = code[m.index - 1] ?? "";
        if (/[A-Za-z0-9_&/]/.test(prev)) continue; // issue#123, &#123;, /path#anchor
        if (/(?:href|to|id|xlink:href|for|aria-[a-z]+)\s*=\s*["'{`]?\s*$/i.test(before)) continue;
        if (/url\(\s*["']?$/.test(before)) continue;
      }
      if (/--[\w-]+\s*:\s*[^;{}]*$/.test(before)) continue; // CSS custom property definitions are the tokens themselves
      if (kind !== "css" && /^\s*(import|export)\s/.test(line) && !/style|color/i.test(line)) continue;
      const rgb = parseColor(raw);
      if (!rgb) continue;
      const lab = rgbToLab(rgb);
      let best = config.colors[0]!;
      let bestD = Infinity;
      for (const c of config.colors) {
        // A translucent token is a different colour from the same hex at full opacity.
        const d = deltaE(lab, c.lab) + Math.abs(rgb.a - (c.alpha ?? 1)) * 100;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (bestD <= config.colorTolerance) {
        out.push({
          offset: m.index,
          severity: "warning",
          message: `Hard-coded ${raw} matches the token ${best.path}`,
          suggestion: `Use var(${best.cssVar}) so it follows Brand Kit updates`,
        });
      } else {
        out.push({
          offset: m.index,
          message: `${raw} is not in the Brand Kit`,
          suggestion: `Closest token is ${best.path} (${best.hex}, ΔE ${bestD.toFixed(1)}): use var(${best.cssVar})`,
        });
      }
    }
    return out;
  },
};

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTIL = "bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|from|via|to|outline|divide|placeholder|accent|caret|decoration|shadow";

export const noRawPaletteClass: Rule = {
  id: "no-raw-palette-class",
  title: "Raw Tailwind palette class",
  description: "Use semantic token classes (bg-primary, text-muted) instead of Tailwind's default palette.",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code }) {
    const out: Finding[] = [];
    const re = new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*)(${UTIL})-(${PALETTE})-(50|[1-9]00|950)(?:/\\d{1,3})?(?![\\w-])`, "g");
    for (const m of matches(re, code)) {
      out.push({
        offset: m.index + m[1]!.length,
        message: `Tailwind palette class ${m[0].slice(m[1]!.length)} bypasses the Brand Kit`,
        suggestion: `Use a semantic class mapped to a token, e.g. ${m[2]}-primary or ${m[2]}-muted`,
      });
    }
    return out;
  },
};

export const spacingScale: Rule = {
  id: "spacing-scale",
  title: "Off-scale spacing",
  description: "Padding, margin and gap must use the spacing scale.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, kind, config }) {
    const out: Finding[] = [];
    const scale = config.spacing;
    const ok = (n: number) => scale.some((s) => Math.abs(s - n) < 0.01);
    // CSS declarations (also styled-components / <style> blocks)
    for (const m of matches(/(?<![\w-])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;{}\n]+)/g, code)) {
      const valueStart = m.index + m[0].length - m[2]!.length;
      for (const v of pxValues(declValue(m[2]!, kind))) {
        if (!ok(v.n)) out.push({ offset: valueStart + v.index, message: `${m[1]} ${fmt(v.n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, v.n)}` });
      }
    }
    // JSX style objects with unitless numbers: { padding: 13 }
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])(padding|margin|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Inline|Block|X|Y)?\s*:\s*(['"`]?)(-?\d*\.?\d+)\2(?=\s*[,}\n])/g, code)) {
        const n = Math.abs(parseFloat(m[3]!));
        if (!ok(n)) out.push({ offset: m.index, message: `${m[1]} ${fmt(n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, n)}` });
      }
      // Tailwind arbitrary values: p-[13px]
      for (const m of matches(/(?<![\w-])-?(p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-\[(-?\d*\.?\d+)(px|rem)\]/g, code)) {
        const n = Math.abs(parseFloat(m[2]!)) * (m[3] === "rem" ? 16 : 1);
        if (!ok(n)) out.push({ offset: m.index, message: `${m[0]} is off the spacing scale`, suggestion: `Use ${neighbours(scale, n)}` });
      }
      // [ngStyle], :style objects with quoted keys, [style.padding.px]
      for (const b of styleBindings(code)) {
        if (!SPACING_PROP.test(b.prop)) continue;
        for (const v of pxValues(b.value)) {
          if (!ok(v.n)) out.push({ offset: b.offset + Math.min(v.index, b.value.length), message: `${b.prop} ${fmt(v.n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, v.n)}` });
        }
      }
    }
    return out;
  },
};

export const radiusScale: Rule = {
  id: "radius-scale",
  title: "Off-scale corner radius",
  description: "Border radius must use the radius tokens.",
  defaultSeverity: "info",
  kinds: ALL,
  check({ code, kind, config }) {
    const out: Finding[] = [];
    const ok = (n: number) => n >= 999 || config.radii.some((r) => Math.abs(r - n) < 0.01);
    for (const m of matches(/(?<![\w-])border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;{}\n]+)/g, code)) {
      const valueStart = m.index + m[0].length - m[1]!.length;
      for (const v of pxValues(declValue(m[1]!, kind))) {
        if (!ok(v.n)) out.push({ offset: valueStart + v.index, message: `border-radius ${fmt(v.n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), v.n)}` });
      }
    }
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])borderRadius\s*:\s*(['"`]?)(\d*\.?\d+)\1(?=\s*[,}\n])/g, code)) {
        const n = parseFloat(m[2]!);
        if (!ok(n)) out.push({ offset: m.index, message: `borderRadius ${fmt(n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), n)}` });
      }
      for (const m of matches(/(?<![\w-])rounded(?:-[a-z]{1,2})?-\[(\d*\.?\d+)px\]/g, code)) {
        const n = parseFloat(m[1]!);
        if (!ok(n)) out.push({ offset: m.index, message: `${m[0]} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), n)}` });
      }
      for (const b of styleBindings(code)) {
        if (!RADIUS_PROP.test(b.prop)) continue;
        for (const v of pxValues(b.value)) {
          if (!ok(v.n)) out.push({ offset: b.offset, message: `${b.prop} ${fmt(v.n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), v.n)}` });
        }
      }
    }
    return out;
  },
};

export const fontFamily: Rule = {
  id: "font-family",
  title: "Unapproved font",
  description: "Only the Brand Kit's font families may be used.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, kind, config }) {
    if (config.fonts.length === 0) return [];
    const out: Finding[] = [];
    const allowed = config.fonts;
    const test = (value: string, offset: number) => {
      const fam = normalizeFontFamily(value);
      if (!fam || isGenericFont(fam) || allowed.includes(fam)) return;
      out.push({
        offset,
        message: `Font "${fam}" is not in the Brand Kit`,
        suggestion: `Use var(--font-family-sans) (${allowed[0]})`,
      });
    };
    for (const m of matches(/(?<![\w-])font-family\s*:\s*([^;{}\n]+)/g, code)) test(declValue(m[1]!, kind), m.index);
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])fontFamily\s*:\s*(['"`])([^'"`]+)\1/g, code)) test(m[2]!, m.index);
      for (const m of matches(/(?<![\w-])font-\[([^\]]+)\]/g, code)) test(m[1]!.replace(/_/g, " "), m.index);
      for (const b of styleBindings(code)) if (b.prop === "font-family") test(b.value, b.offset);
    }
    return out;
  },
};

/** Input types that are text-like, so a generic "input" replacement applies. */
const TEXT_INPUT_TYPES = new Set(["", "text", "email", "password", "number", "search", "tel", "url"]);

export const preferOfficialComponent: Rule = {
  id: "prefer-official-component",
  title: "Re-invented component",
  description: "Use the design system component instead of a raw HTML element.",
  defaultSeverity: "error",
  kinds: MARKUP,
  check({ code, config, framework }) {
    if (config.replaces.size === 0) return [];
    const out: Finding[] = [];
    const baseTags = [...new Set([...config.replaces.keys()].map((k) => k.replace(/\[.*$/, "").replace(/[^a-z0-9-]/g, "")))].filter(Boolean);
    for (const m of matches(new RegExp(`<(${baseTags.join("|")})(?=[\\s>/])([^>]*)>`, "g"), code)) {
      const tag = m[1]!;
      const attrs = m[2]!;
      let comp = config.replaces.get(tag);
      if (tag === "input" || tag === "button") {
        const type = (attrs.match(/\btype\s*=\s*\{?\s*["'`]([\w-]+)["'`]/)?.[1] ?? "").toLowerCase();
        const specific = config.replaces.get(`${tag}[type=${type}]`);
        if (specific) comp = specific;
        else if (tag === "input" && !TEXT_INPUT_TYPES.has(type)) comp = type === "submit" || type === "button" ? config.replaces.get("button") : undefined;
      }
      if (!comp) continue;
      // Only when the registry has a version for this file's framework: telling an Angular template to import a React component helps nobody.
      const usage = resolveUsage(comp, framework);
      if (!usage) continue;
      // Skip the component's own implementation file
      if (new RegExp(`(?:function|const|class)\\s+${escapeRe(comp.name)}\\b`).test(code)) continue;
      if (framework !== "react" && implementsTag(code, usage.tag)) continue;
      out.push({
        offset: m.index,
        message: `Raw <${tag}${tag === "input" && /type=/.test(attrs) ? ` type="${attrs.match(/type\s*=\s*\{?\s*["'`]([\w-]+)/)?.[1]}"` : ""}> re-implements ${comp.name}`,
        suggestion: useSuggestion(comp, usage),
      });
    }
    return out;
  },
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A JavaScript identifier: what an import alias has to be before it goes into a RegExp. */
const IDENT = /^[A-Za-z_$][\w$]{0,99}$/;

/** The file that defines the selector / custom element itself (it has to use the raw element). */
const implementsTag = (code: string, tag: string) =>
  new RegExp(`selector\\s*:\\s*['"\`]${escapeRe(tag)}['"\`]|customElements\\.define\\(\\s*['"\`]${escapeRe(tag)}['"\`]|@customElement\\(\\s*['"\`]${escapeRe(tag)}['"\`]`).test(code);

function useSuggestion(comp: ComponentEntry, u: ResolvedUsage): string {
  if (u.framework === "react") return `import { ${comp.name} } from "${comp.importPath}"`;
  const parts = [`Use <${u.tag}>`];
  if (u.importLine) parts.push(`(${u.importLine})`);
  return parts.join(" ");
}

export const forbiddenImport: Rule = {
  id: "forbidden-import",
  title: "Other UI library",
  description: "Only the design system's component library may be imported.",
  defaultSeverity: "error",
  kinds: ALL,
  check({ code, config }) {
    const out: Finding[] = [];
    const lib = config.components[0]?.importPath;
    const re = /(?:\bimport\s[^'";]*?from\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*|@import\s+(?:url\(\s*)?)(['"])([^'"]+)\1/g;
    for (const m of matches(re, code)) {
      const spec = m[2]!;
      const bad = config.forbiddenImports.find((p) => spec === p || spec.startsWith(`${p}/`));
      if (!bad) continue;
      out.push({
        offset: m.index + m[0].indexOf(spec),
        message: `Imports ${bad}, which isn't part of the design system`,
        suggestion: lib ? `Use components from "${lib}"` : "Use the design system's components",
      });
    }
    return out;
  },
};

export const imgAlt: Rule = {
  id: "img-alt",
  title: "Image without alt text",
  description: "Every <img> needs an alt attribute (empty for decorative images).",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code }) {
    const out: Finding[] = [];
    for (const m of matches(/<img(?=[\s/>])([^>]*)>/g, code)) {
      if (/(?<![\w-])alt\s*=/.test(m[1]!) || /\{\s*\.\.\./.test(m[1]!)) continue;
      out.push({ offset: m.index, message: "<img> has no alt text", suggestion: 'Add alt="…" describing the image, or alt="" if decorative' });
    }
    return out;
  },
};

/** Native attributes accepted by components that extend an HTML element (htmlAttributes). */
const NATIVE_ATTRS = new Set(
  "id className style title role tabIndex hidden lang dir name value defaultValue defaultChecked checked disabled required readOnly autoFocus autoComplete placeholder type min max step maxLength minLength pattern form accept multiple href target rel download children".split(" "),
);
const ALWAYS_OK = new Set(["key", "ref"]);

/** Local names imported from each component's package: `import { Avatar, Button as Btn } from "@acme/ui"`. */
function importedComponents(code: string, components: ComponentEntry[]): Map<string, ComponentEntry> {
  const out = new Map<string, ComponentEntry>();
  for (const m of matches(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g, code)) {
    const from = m[3]!;
    for (const part of m[1]!.split(",")) {
      const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
      if (!orig) continue;
      const comp = components.find((c) => c.name === orig && c.importPath === from && c.props?.length);
      const name = alias || orig;
      if (comp && IDENT.test(name)) out.set(name, comp); // only real identifiers reach a RegExp
    }
  }
  return out;
}

/** Skips a {…} expression or a quoted string starting at i; returns the index after it. */
function skipBalanced(code: string, i: number): number {
  const open = code[i];
  if (open === '"' || open === "'") {
    const end = code.indexOf(open, i + 1);
    return end === -1 ? code.length : end + 1;
  }
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < code.length; j++) {
    const c = code[j]!;
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return code.length;
}

/** Attributes of the JSX opening tag starting right after `<Name`. */
function parseAttributes(code: string, start: number): { attrs: Array<{ name: string; offset: number }>; spread: boolean; selfClosing: boolean } | null {
  const attrs: Array<{ name: string; offset: number }> = [];
  let spread = false;
  let i = start;
  while (i < code.length) {
    while (/\s/.test(code[i] ?? "")) i++;
    const c = code[i];
    if (c === undefined) return null;
    if (c === ">") return { attrs, spread, selfClosing: false };
    if (c === "/" && code[i + 1] === ">") return { attrs, spread, selfClosing: true };
    if (c === "{") {
      spread = true;
      i = skipBalanced(code, i);
      continue;
    }
    const name = /^[A-Za-z_$][\w$:.-]*/.exec(code.slice(i, i + 80))?.[0];
    if (!name) return null; // not JSX after all
    attrs.push({ name, offset: i });
    i += name.length;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] === "=") {
      i++;
      while (/\s/.test(code[i] ?? "")) i++;
      i = skipBalanced(code, i);
    }
  }
  return null;
}

/** Attributes of an HTML-style opening tag (Angular, Vue, web components, server templates) starting right after `<tag`. */
function parseHtmlAttributes(code: string, start: number): { attrs: Array<{ name: string; offset: number }>; end: number } | null {
  const attrs: Array<{ name: string; offset: number }> = [];
  let i = start;
  while (i < code.length) {
    while (/\s/.test(code[i] ?? "")) i++;
    const c = code[i];
    if (c === undefined) return null;
    if (c === ">" || (c === "/" && code[i + 1] === ">")) return { attrs, end: i };
    if (c === "{" && code[i + 1] !== "{" && code[i + 1] !== "%") {
      // Svelte: {items} sets items; {...rest} spreads.
      const end = skipBalanced(code, i);
      const inner = code.slice(i + 1, end - 1).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(inner)) attrs.push({ name: inner, offset: i });
      i = end;
      continue;
    }
    if (c === "{" || (c === "<" && code[i + 1] === "?")) {
      // {{ … }}, {% … %}, <?php … ?> inside a tag: skip it.
      const close = c === "{" ? (code[i + 1] === "%" ? "%}" : "}}") : "?>";
      const e = code.indexOf(close, i + 2);
      i = e === -1 ? code.length : e + close.length;
      continue;
    }
    const name = /^[^\s=>/"'{]+/.exec(code.slice(i, i + 120))?.[0];
    if (!name) return null;
    attrs.push({ name, offset: i });
    i += name.length;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] === "=") {
      i++;
      while (/\s/.test(code[i] ?? "")) i++;
      const q = code[i];
      if (q === "{") i = skipBalanced(code, i);
      else if (q === '"' || q === "'") {
        const e = code.indexOf(q, i + 1);
        i = e === -1 ? code.length : e + 1;
      } else while (i < code.length && !/[\s>]/.test(code[i]!)) i++;
    }
  }
  return null;
}

/** Native attributes every element takes, and framework syntax that isn't an input. */
const HTML_GLOBAL = /^(?:id|class|style|title|role|hidden|tabindex|lang|dir|slot|part|is|key|ref|name|for|form|aria-.+|data-.+)$/;

/**
 * The input / prop an attribute sets, or null when it's an event, directive, reference or native attribute.
 * Angular: [value], [(value)], value, bind-value; Vue: :value, v-bind:value, v-model:value.
 */
function propName(raw: string, framework?: Framework): string | null {
  let n = raw;
  if (/^(?:\(|@|on-|v-on:|\*|#|let-|ref-|v-(?!bind:|model:))/.test(n)) return null;
  // Svelte: class:x, use:x, transition:x… are directives; bind:value sets value. Solid: prop:x / attr:x / bool:x set x.
  if (/^(?:class|style|use|transition|in|out|animate|let|ref|on|oncapture|use):/.test(n)) return null;
  n = n.replace(/^(?:bind|prop|attr|bool):/, "");
  if (framework === "svelte" && /^on[a-z]/.test(n)) return null;
  n = n.replace(/^v-bind:|^v-model:|^bind-|^:/, "").replace(/^\[\(?|\)?\]$/g, "");
  if (/^(?:attr|class|style)\./.test(n) || /^ng[A-Z]/.test(n) || /^(?:formControl|formControlName|formGroup|routerLink|routerLinkActive)$/.test(n)) return null;
  n = n.replace(/\.(?:px|rem|em|%)$/, "").replace(/\..*$/, "");
  if (HTML_GLOBAL.test(n.toLowerCase())) return null;
  return n;
}

const sameName = (a: string, b: string) => a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();

/** Unknown and missing inputs on registry components in Angular / Vue / web component / HTML markup, when the registry lists them. */
/** DOM events every element fires (they bubble out of a component's inner elements), so binding them is fine. */
const NATIVE_EVENT = /^(?:click|dblclick|auxclick|contextmenu|focus|blur|focusin|focusout|key(?:down|up|press)|mouse\w+|pointer\w+|touch\w+|wheel|drag\w*|drop|scroll|animation\w+|transition\w+)$/;

/** The event an attribute listens to: Angular (x) / on-x, Vue @x / v-on:x. Null when it isn't a listener. */
function eventName(raw: string, framework?: Framework): string | null {
  const m = /^\(([^)]+)\)$|^on-(.+)$|^@([^.]+)|^v-on:([^.]+)|^on(?:capture)?:([^|]+)/.exec(raw);
  if (m) return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5])!.replace(/\..*$/, "");
  // Svelte 5: onclick, onbr-change.
  if (framework === "svelte" && /^on[a-z][\w-]*$/.test(raw)) return raw.slice(2);
  return null;
}

/** How to listen for an event, in the framework's syntax. */
const listen = (framework: Framework, ev: string) =>
  framework === "angular" ? `(${ev})` : framework === "vue" ? `@${ev}` : framework === "svelte" ? `on${ev}={…}` : framework === "solid" ? `on:${ev}={…}` : `"${ev}"`;
const detailOf = (framework: Framework) => (framework === "angular" ? "$any($event).detail" : framework === "vue" ? "$event.detail" : framework === "svelte" || framework === "solid" ? "e.detail" : "event.detail");

/**
 * Unknown and missing inputs, and unknown events, on registry components in Angular / Vue / web component / HTML
 * markup, when the registry lists them. Catches the usual AI slip on custom elements: (change) instead of (br-change).
 */
function templateProps({ code, config, framework }: RuleContext): Finding[] {
  const tagged: Array<{ comp: ComponentEntry; tag: string; props?: PropSpec[]; events?: EventSpec[]; ce: boolean }> = [];
  for (const comp of config.components) {
    const u = resolveUsage(comp, framework);
    if (u && (u.props?.length || u.events?.length)) tagged.push({ comp, tag: u.tag, props: u.props, events: u.events, ce: Boolean(u.customElement || u.via) });
  }
  if (!tagged.length) return [];
  const out: Finding[] = [];
  // Vue resolves both <AcmeButton> and <acme-button>.
  const forms = new Map<string, (typeof tagged)[number]>();
  for (const t of tagged) {
    forms.set(t.tag, t);
    if (framework === "vue") forms.set(t.tag.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), t);
  }
  const names = [...forms.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  for (const m of matches(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
    const t = forms.get(m[1]!)!;
    const parsed = parseHtmlAttributes(code, m.index + m[0].length);
    if (!parsed) continue;
    const list = (t.props ?? []).map((p) => (p.required ? `${p.name} (required)` : p.name)).join(", ");
    const passed: string[] = [];
    for (const a of parsed.attrs) {
      const raw = a.name;
      const ev = eventName(raw, framework);
      if (ev) {
        if (!t.events?.length || NATIVE_EVENT.test(ev) || t.events.some((e) => e.name === ev)) continue;
        const like = t.events.find((e) => e.name.endsWith(`-${ev}`) || e.name.endsWith(ev)) ?? (t.events.length === 1 ? t.events[0] : undefined);
        out.push({
          offset: a.offset,
          message: `<${t.tag}> has no "${ev}" event`,
          suggestion: `${like ? `Listen to ${listen(framework, like.name)}${like.detail ? ` and read ${detailOf(framework)} (${like.detail})` : ""}. ` : ""}Events: ${t.events.map((e) => e.name).join(", ")}`,
        });
        continue;
      }
      if (/^v-model$/.test(raw)) passed.push("modelValue", "value");
      if (/^\[\(ngModel\)\]$/.test(raw)) passed.push("value");
      const n = propName(raw, framework);
      if (!n || !t.props?.length) continue;
      passed.push(n);
      // A binding sets the element's property: [selected-date] / :selected-date sets nothing on a custom element.
      if (t.ce && n.includes("-") && (framework === "angular" || framework === "vue") && /^(?:\[(?!attr\.)|:|v-bind:|bind-)/.test(raw)) {
        const camel = n.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        out.push({
          offset: a.offset,
          message: `${raw} binds a property that doesn't exist on <${t.tag}>`,
          suggestion: `Bind the camelCase property: ${framework === "vue" ? `:${camel}` : `[${camel}]`}="…" (kebab-case is only for static attributes: ${n}="…")`,
        });
        continue;
      }
      if (t.props.some((p) => sameName(p.name, n))) continue;
      out.push({ offset: a.offset, message: `<${t.tag}> has no "${n}" input`, suggestion: `Remove it. ${t.comp.name} takes: ${list}` });
    }
    for (const p of t.props ?? []) {
      if (!p.required || passed.some((n) => sameName(n, p.name))) continue;
      if (p.name === "children" || p.name === "content") continue;
      out.push({ offset: m.index, message: `<${t.tag}> is missing the required "${p.name}" input`, suggestion: `Add ${p.name}${p.type ? ` (${p.type})` : ""}` });
    }
  }
  return out;
}

export const componentProps: Rule = {
  id: "component-props",
  title: "Unknown or missing prop",
  description: "Design system components only accept their documented props, and required props must be passed.",
  defaultSeverity: "error",
  kinds: MARKUP,
  check(ctx) {
    if (ctx.framework !== "react" || ctx.kind !== "jsx") return templateProps(ctx);
    const { code, config } = ctx;
    if (!config.components.some((c) => c.props?.length)) return [];
    const imported = importedComponents(code, config.components);
    if (imported.size === 0) return [];
    const out: Finding[] = [];
    const names = [...imported.keys()].map(escapeRe).join("|");
    for (const m of matches(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
      if (/[\w)\]]\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue; // generics / comparisons
      const comp = imported.get(m[1]!)!;
      const parsed = parseAttributes(code, m.index + m[0].length);
      if (!parsed) continue;
      const own = new Map(comp.props!.map((p) => [p.name, p]));
      const list = comp.props!.map((p) => (p.required ? `${p.name} (required)` : p.name)).join(", ");
      for (const a of parsed.attrs) {
        if (own.has(a.name) || ALWAYS_OK.has(a.name) || a.name.includes("-")) continue;
        if (comp.htmlAttributes && (NATIVE_ATTRS.has(a.name) || /^on[A-Z]/.test(a.name) || /^aria/.test(a.name))) continue;
        const sibling = config.components.find(
          (c) => c !== comp && c.importPath === comp.importPath && (c.name.startsWith(comp.name) || comp.name.startsWith(c.name)) && c.props?.some((p) => p.name === a.name),
        );
        out.push({
          offset: a.offset,
          message: `<${comp.name}> has no "${a.name}" prop`,
          suggestion: sibling ? `Use <${sibling.name}>, which has "${a.name}", or remove it. ${comp.name} props: ${list}` : `Remove it. ${comp.name} props: ${list}`,
        });
      }
      if (!parsed.spread) {
        const passed = new Set(parsed.attrs.map((a) => a.name));
        for (const p of comp.props!) {
          if (!p.required || passed.has(p.name) || (p.name === "children" && !parsed.selfClosing)) continue;
          out.push({ offset: m.index, message: `<${comp.name}> is missing the required "${p.name}" prop`, suggestion: `Add ${p.name}${p.type ? ` (${p.type})` : ""}` });
        }
      }
    }
    return out;
  },
};

export const legacyLibrary: Rule = {
  id: "legacy-library",
  title: "Other UI library in use",
  description: "Pieces of Material, MUI, Bootstrap, Ant Design, Chakra or PrimeNG that a design system component replaces. The count is the migration still to do.",
  defaultSeverity: "warning",
  kinds: ["jsx", "vue", "svelte", "html", "template"],
  check({ code, kind, config, framework }) {
    const out: Finding[] = [];
    for (const u of findLegacyUsages(code, kind)) {
      const comp = componentForConcept(config, u.concept);
      const usage = comp ? resolveUsage(comp, framework) : null;
      out.push({
        offset: u.offset,
        message: `${u.what} (${LIBRARY_LABEL[u.library]}) should be ${comp ? comp.name : `a design system ${u.concept}`}`,
        suggestion: comp && usage
          ? useSuggestion(comp, usage)
          : comp
            ? `${comp.name} has no ${FRAMEWORK_LABEL[framework]} version yet: add one in the registry, or build it with tokens`
            : `No ${u.concept} component in the registry yet: add one, or build it with tokens and semantic HTML`,
      });
    }
    return out;
  },
};

const whenGone = (d: { removeAfter?: string }) => (d.removeAfter ? ` and will be removed after ${d.removeAfter}` : "");

export const deprecatedToken: Rule = {
  id: "deprecated-token",
  title: "Deprecated token",
  description: "Tokens the design system is retiring. They still work until their removal date; switch to the replacement.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, config }) {
    if (!config.deprecatedTokens.size) return [];
    const out: Finding[] = [];
    for (const m of matches(/var\(\s*(--[\w-]+)/g, code)) {
      const d = config.deprecatedTokens.get(m[1]!);
      if (!d) continue;
      const repl = d.replacement ? `var(--${d.replacement.replace(/\./g, "-")})` : undefined;
      out.push({
        offset: m.index,
        message: `${m[1]} (${d.path}) is deprecated${whenGone(d)}`,
        suggestion: repl ? `Use ${repl}${d.reason ? `. ${d.reason}` : ""}` : d.reason || "Ask the design system team what replaces it",
      });
    }
    return out;
  },
};

export const deprecatedComponent: Rule = {
  id: "deprecated-component",
  title: "Deprecated component",
  description: "Components the design system is retiring. They still work until their removal date; switch to the replacement.",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code, kind, config, framework }) {
    const dep = config.components.filter((c) => c.status === "deprecated");
    if (!dep.length) return [];
    const out: Finding[] = [];
    const report = (offset: number, c: ComponentEntry) => {
      const d = c.deprecation ?? {};
      out.push({
        offset,
        message: `${c.name} is deprecated${whenGone(d)}`,
        suggestion: d.replacement ? `Use ${d.replacement}${d.reason ? `. ${d.reason}` : ""}` : d.reason || "Ask the design system team what replaces it",
      });
    };
    if (framework === "react" && kind === "jsx") {
      // Imported from the component's package under its name (or an alias).
      for (const m of matches(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g, code)) {
        for (const part of m[1]!.split(",")) {
          const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
          const c = dep.find((x) => x.name === orig && x.importPath === m[3]);
          if (!c || !IDENT.test(alias || orig || "")) continue;
          const local = escapeRe((alias || orig)!);
          let used = false;
          for (const u of matches(new RegExp(`<${local}(?=[\\s/>])`, "g"), code)) {
            used = true;
            report(u.index, c);
          }
          if (!used) report(m.index, c);
        }
      }
      return out;
    }
    for (const c of dep) {
      const u = resolveUsage(c, framework);
      if (!u) continue;
      const tag = u.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const m of matches(new RegExp(`<${tag}(?=[\\s/>])`, "g"), code)) report(m.index, c);
    }
    return out;
  },
};

export const RULES: Rule[] = [
  noHardcodedColor,
  noRawPaletteClass,
  preferOfficialComponent,
  forbiddenImport,
  spacingScale,
  fontFamily,
  radiusScale,
  imgAlt,
  componentProps,
  legacyLibrary,
  deprecatedToken,
  deprecatedComponent,
];

export const RULE_IDS = RULES.map((r) => r.id);

