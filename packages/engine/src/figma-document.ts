/**
 * A starter Brand Kit from a Figma file that has no variables and no styles: the colours, fonts, sizes, radii and
 * spacing typed straight onto its layers. Everything we can't infer keeps the Brandrail default, so the result is
 * always a complete kit (light and dark) the person can then edit.
 *
 * Input: the `document` from GET /v1/files/:key. Pure and dependency-free.
 */
import { contrastRatio, parseHex, toHex, type RGB } from "./color.ts";
import type { FlatToken } from "./tokens.ts";

type Paint = { type?: string; visible?: boolean; opacity?: number; color?: { r: number; g: number; b: number; a?: number } };
type FNode = {
  type?: string;
  visible?: boolean;
  fills?: Paint[] | unknown;
  strokes?: Paint[] | unknown;
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeightPx?: number };
  cornerRadius?: number;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  layoutMode?: string;
  absoluteBoundingBox?: { width: number; height: number };
  children?: FNode[];
};

export interface FigmaDocumentStarter {
  tokens: FlatToken[];
  /** What was taken from the file, in plain words, for the import notes. */
  found: string[];
  /** Whether the file had anything usable at all. */
  usable: boolean;
}

type Hsl = { h: number; s: number; l: number };
const hsl = ({ r, g, b }: RGB): Hsl => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h, s, l };
};
const lum = (c: RGB) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const rgb = (hex: string) => parseHex(hex)!;
const isBrand = (hex: string) => {
  const c = hsl(rgb(hex));
  return c.s >= 0.35 && c.l >= 0.2 && c.l <= 0.75;
};
const hueIn = (hex: string, from: number, to: number) => {
  const { h } = hsl(rgb(hex));
  return from <= to ? h >= from && h <= to : h >= from || h <= to;
};
/** Mixes towards white (amount > 0) or black (amount < 0). */
const mix = (hex: string, amount: number) => {
  const c = rgb(hex);
  const t = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  return toHex({ r: c.r + (t - c.r) * a, g: c.g + (t - c.g) * a, b: c.b + (t - c.b) * a, a: 1 });
};
/** A version of a brand colour that reads on the other theme's background. */
const forTheme = (hex: string, bg: string) => {
  let out = hex;
  const towardsWhite = lum(rgb(bg)) < 0.2;
  for (let i = 0; i < 8 && contrastRatio(rgb(out), rgb(bg)) < 4.5; i++) out = mix(out, towardsWhite ? 0.15 : -0.15);
  return out;
};
const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const near = (a: string, b: string) => {
  const x = rgb(a);
  const y = rgb(b);
  return Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b) < 24;
};
const SANS_FALLBACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
const fontStack = (f: string) => (/mono|code/i.test(f) ? `'${f}', ui-monospace, SFMono-Regular, Menlo, monospace` : `'${f}', ${SANS_FALLBACK}`);

export function starterFromFigmaDocument(document: unknown, base: FlatToken[]): FigmaDocumentStarter {
  const fillsAny = new Map<string, number>();
  const fillsText = new Map<string, number>();
  const fillsShape = new Map<string, number>();
  const backgrounds = new Map<string, number>(); // fills of big frames: the page background
  const strokes = new Map<string, number>();
  const families = new Map<string, number>();
  const sizes = new Map<number, { n: number; lh: number[]; w: Map<number, number> }>();
  const radii = new Map<number, number>();
  const gaps = new Map<number, number>();

  const solid = (paints: unknown): string | null => {
    if (!Array.isArray(paints)) return null;
    for (const p of paints as Paint[]) {
      if (p?.type === "SOLID" && p.visible !== false && p.color && (p.opacity ?? 1) * (p.color.a ?? 1) > 0.5) {
        return toHex({ r: p.color.r * 255, g: p.color.g * 255, b: p.color.b * 255, a: 1 });
      }
    }
    return null;
  };
  const add = <K>(m: Map<K, number>, k: K, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

  const walk = (n: FNode | undefined, depth: number) => {
    if (!n || typeof n !== "object" || depth > 80 || n.visible === false) return;
    const fill = solid(n.fills);
    if (fill) {
      add(fillsAny, fill);
      if (n.type === "TEXT") add(fillsText, fill);
      else {
        add(fillsShape, fill);
        const box = n.absoluteBoundingBox;
        if ((n.type === "FRAME" || n.type === "COMPONENT" || n.type === "SECTION") && box && box.width >= 320 && box.height >= 320) add(backgrounds, fill);
      }
    }
    const stroke = solid(n.strokes);
    if (stroke && n.type !== "TEXT") add(strokes, stroke);
    if (n.type === "TEXT" && n.style) {
      const s = n.style;
      if (s.fontFamily) add(families, s.fontFamily);
      if (s.fontSize && s.fontSize >= 8 && s.fontSize <= 96) {
        const size = Math.round(s.fontSize);
        const e = sizes.get(size) ?? { n: 0, lh: [] as number[], w: new Map<number, number>() };
        e.n++;
        if (s.lineHeightPx) e.lh.push(s.lineHeightPx);
        if (s.fontWeight) add(e.w, s.fontWeight);
        sizes.set(size, e);
      }
    }
    if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) add(radii, n.cornerRadius >= 999 ? 9999 : Math.round(n.cornerRadius));
    if (n.layoutMode && n.layoutMode !== "NONE") {
      for (const v of [n.itemSpacing, n.paddingLeft, n.paddingRight, n.paddingTop, n.paddingBottom]) if (typeof v === "number" && v > 0 && v <= 128) add(gaps, Math.round(v));
    }
    if (Array.isArray(n.children)) for (const c of n.children) walk(c, depth + 1);
  };
  walk(document as FNode, 0);

  const tokens = new Map(base.map((t) => [t.path, { ...t }]));
  const found: string[] = [];
  const set = (path: string, light: string | undefined, dark: string | undefined, note?: string) => {
    const t = tokens.get(path) ?? { path, type: "color" as const, value: light ?? dark ?? "#000000" };
    if (light) t.value = light;
    if (dark) t.dark = dark;
    if (note) t.description = note;
    tokens.set(path, t);
  };
  const baseOf = (path: string) => tokens.get(path);

  // ── Theme: the page background tells us whether the file is drawn in light or dark.
  const bg = top(backgrounds)[0]?.[0] ?? top(fillsShape).find(([c]) => !isBrand(c))?.[0];
  const darkFile = bg ? lum(rgb(bg)) < 0.2 : false;
  const which = (light: string, dark: string) => (darkFile ? [undefined, dark] : [light, undefined]) as [string | undefined, string | undefined];
  const lightBg = baseOf("color.canvas.default")?.value ?? "#ffffff";
  const darkBg = baseOf("color.canvas.default")?.dark ?? "#0d1117";

  if (bg) {
    set("color.canvas.default", ...which(bg, bg));
    found.push(`page background ${bg}`);
    const subtle = top(fillsShape).find(([c]) => c !== bg && !isBrand(c) && Math.abs(lum(rgb(c)) - lum(rgb(bg))) < 0.12 && !near(c, bg))?.[0];
    if (subtle) set("color.canvas.subtle", ...which(subtle, subtle));
  }
  const bgHex = bg ?? (darkFile ? darkBg : lightBg);

  // ── Text: the most used readable text colour is the body text; the next one is muted text.
  const readable = top(fillsText).filter(([c]) => !isBrand(c) && contrastRatio(rgb(c), rgb(bgHex)) >= 4.5);
  const fg = readable[0]?.[0];
  if (fg) {
    set("color.fg.default", ...which(fg, fg));
    found.push(`text ${fg}`);
    // Secondary text is often too light to read: keep its hue, adjust it until it passes AA (4.5:1).
    const muted = top(fillsText).find(
      ([c]) => !isBrand(c) && !near(c, fg) && contrastRatio(rgb(c), rgb(bgHex)) >= 2 && contrastRatio(rgb(c), rgb(bgHex)) < contrastRatio(rgb(fg), rgb(bgHex)),
    )?.[0];
    if (muted) {
      const m = forTheme(muted, bgHex);
      set("color.fg.muted", ...which(m, m));
    }
  }

  // ── Borders: the most used neutral stroke.
  const border = top(strokes).find(([c]) => !isBrand(c) && !near(c, bgHex))?.[0];
  if (border) set("color.border.default", ...which(border, border));

  // ── Brand colours: saturated colours, most used first. Status colours by hue.
  const brand = top(fillsAny).filter(([c]) => isBrand(c));
  const status = { danger: [345, 15], success: [90, 165], attention: [30, 55] } as const;
  const isStatus = (c: string) => Object.values(status).some(([a, b]) => hueIn(c, a, b));
  const primary = brand.find(([c]) => !isStatus(c))?.[0] ?? brand[0]?.[0];
  if (primary) {
    // Kept exactly where it reads at 4.5:1 (as text on the page and as a button fill), otherwise nudged just
    // enough: darker for the light theme, lighter for the dark one. Dark labels on fills use the light theme's
    // text colour, so the dark value must clear whichever of that and the dark page is lighter.
    const lightText = baseOf("color.fg.default")?.value ?? "#1f2328";
    const darkRef = lum(rgb(lightText)) > lum(rgb(darkBg)) ? lightText : darkBg;
    const pair = (c: string) => [forTheme(c, lightBg), forTheme(c, darkRef)] as const;
    const [light, dark] = pair(primary);
    set("color.action.primary", light, dark, "One primary action per view");
    const second = brand.find(([c]) => c !== primary && !isStatus(c) && Math.abs(hsl(rgb(c)).h - hsl(rgb(primary)).h) > 25)?.[0];
    const accent = second ?? primary;
    set("color.accent.default", ...pair(accent), "Links, focus, selection");
    found.push(`brand colour ${primary}${light !== primary && !darkFile ? ` (shown as ${light} where it's text, to stay readable)` : ""}${second ? ` and accent ${second}` : ""}`);
  }
  for (const [name, [a, b]] of Object.entries(status)) {
    const c = brand.find(([x]) => x !== primary && hueIn(x, a, b))?.[0];
    if (c) set(`color.${name}.default`, forTheme(c, lightBg), forTheme(c, darkBg));
  }

  // ── Fonts.
  const fams = top(families);
  const sans = fams.find(([f]) => !/mono|code/i.test(f))?.[0];
  const mono = fams.find(([f]) => /mono|code/i.test(f))?.[0];
  if (sans) set2("font.family.sans", "fontFamily", fontStack(sans));
  if (mono) set2("font.family.mono", "fontFamily", fontStack(mono));
  if (sans || mono) found.push(`font ${[sans, mono].filter(Boolean).join(" and ")}`);

  // ── Type scale: the most used sizes, named around the body size (the most used one).
  const bySize = [...sizes.entries()].filter(([, e]) => e.n >= 2 || sizes.size <= 4);
  if (bySize.length >= 2) {
    const names = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl"];
    const chosen = top(new Map(bySize.map(([s, e]) => [s, e.n])))
      .slice(0, 7)
      .map(([s]) => s)
      .sort((a, b) => a - b);
    const body = top(new Map(bySize.filter(([s]) => s <= 18).map(([s, e]) => [s, e.n])))[0]?.[0] ?? chosen[0]!;
    const offset = 2 - chosen.indexOf(body);
    for (const p of [...tokens.keys()]) if (/^font\.(size|line-height|weight)\./.test(p)) tokens.delete(p);
    chosen.forEach((size, i) => {
      const name = names[i + offset];
      if (!name) return;
      const e = sizes.get(size)!;
      set2(`font.size.${name}`, "dimension", `${size}px`);
      const lh = e.lh.length ? Math.round(e.lh.reduce((a, b) => a + b, 0) / e.lh.length) : Math.round(size * (size >= 20 ? 1.3 : 1.55));
      set2(`font.line-height.${name}`, "dimension", `${lh}px`);
      const w = top(e.w)[0]?.[0];
      if (w && w !== 400) set2(`font.weight.${name}`, "fontWeight", String(w));
    });
    found.push(`${chosen.length} text sizes (${chosen.join(", ")}px)`);
  }

  // ── Radius: up to three most used corner radii (plus "full" for pills).
  const rads = top(radii).filter(([r]) => r < 9999).slice(0, 3).map(([r]) => r).sort((a, b) => a - b);
  if (rads.length) {
    for (const p of [...tokens.keys()]) if (/^radius\./.test(p) && p !== "radius.full") tokens.delete(p);
    const names = rads.length === 1 ? ["md"] : rads.length === 2 ? ["sm", "md"] : ["sm", "md", "lg"];
    rads.forEach((r, i) => set2(`radius.${names[i]}`, "dimension", `${r}px`));
    found.push(`corner radius ${rads.join(", ")}px`);
  }

  // ── Spacing: a 4- or 8-based scale, whichever the auto-layout gaps and padding follow.
  const g = top(gaps);
  const totalGaps = g.reduce((n, [, c]) => n + c, 0);
  if (totalGaps >= 5) {
    const on8 = g.filter(([v]) => v % 8 === 0).reduce((n, [, c]) => n + c, 0);
    const unit = on8 / totalGaps >= 0.7 ? 8 : 4;
    const steps = unit >= 8 ? [0.5, 1, 1.5, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 6, 8, 10, 12];
    for (const p of [...tokens.keys()]) if (/^space\./.test(p)) tokens.delete(p);
    steps.forEach((m, i) => set2(`space.${i + 1}`, "dimension", `${unit * m}px`));
    found.push(`${unit}px spacing`);
  }

  return { tokens: [...tokens.values()].sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true })), found, usable: found.length > 0 };

  function set2(path: string, type: FlatToken["type"], value: string) {
    tokens.set(path, { path, type, value });
  }
}
