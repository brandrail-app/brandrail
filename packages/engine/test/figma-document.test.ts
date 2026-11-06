import { test } from "node:test";
import assert from "node:assert/strict";
import { auditBrandKit, buildDtcg, flattenTokens, importTokens, starterFromFigmaDocument, type FlatToken } from "../src/index.ts";

const c = (hex: string) => {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5), a: 1 };
};
const solid = (hex: string) => [{ type: "SOLID", color: c(hex) }];
const text = (hex: string, size: number, family = "Inter", weight = 400) => ({ type: "TEXT", fills: solid(hex), style: { fontFamily: family, fontSize: size, fontWeight: weight, lineHeightPx: size * 1.5 } });
const button = (hex: string) => ({ type: "FRAME", fills: solid(hex), cornerRadius: 8, layoutMode: "HORIZONTAL", itemSpacing: 8, paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8, children: [text("#ffffff", 14, "Inter", 600)] });

const BASE: FlatToken[] = [
  { path: "color.action.primary", type: "color", value: "#1f883d", dark: "#2ea043" },
  { path: "color.accent.default", type: "color", value: "#0969da", dark: "#4493f8" },
  { path: "color.fg.default", type: "color", value: "#1f2328", dark: "#f0f6fc" },
  { path: "color.fg.muted", type: "color", value: "#59636e", dark: "#9198a1" },
  { path: "color.canvas.default", type: "color", value: "#ffffff", dark: "#0d1117" },
  { path: "color.danger.default", type: "color", value: "#cf222e", dark: "#f85149" },
  { path: "font.family.sans", type: "fontFamily", value: "system-ui" },
  { path: "font.size.base", type: "dimension", value: "14px" },
  { path: "radius.md", type: "dimension", value: "6px" },
  { path: "radius.full", type: "dimension", value: "9999px" },
  { path: "space.1", type: "dimension", value: "4px" },
];

const lightFile = {
  type: "DOCUMENT",
  children: [
    {
      type: "CANVAS",
      children: [
        {
          type: "FRAME",
          fills: solid("#fafafa"),
          absoluteBoundingBox: { width: 1440, height: 900 },
          layoutMode: "VERTICAL",
          itemSpacing: 24,
          paddingTop: 32,
          children: [
            text("#18181b", 32, "Inter", 700),
            ...Array.from({ length: 8 }, () => text("#18181b", 16)),
            ...Array.from({ length: 4 }, () => text("#71717a", 13)),
            text("#71717a", 13),
            ...Array.from({ length: 5 }, () => button("#6c5ce7")),
            button("#e11d48"),
            { type: "RECTANGLE", fills: solid("#ffffff"), strokes: solid("#e4e4e7"), cornerRadius: 12 },
            { type: "RECTANGLE", fills: solid("#ffffff"), strokes: solid("#e4e4e7"), cornerRadius: 12 },
          ],
        },
      ],
    },
  ],
};

const lumOf = (h: string) => {
  const f = (i: number) => {
    const x = parseInt(h.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(1) + 0.7152 * f(3) + 0.0722 * f(5);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lumOf(a), lumOf(b)].sort((m, n) => n - m);
  return (x! + 0.05) / (y! + 0.05);
};
const get = (r: { tokens: FlatToken[] }, p: string) => r.tokens.find((t) => t.path === p);

test("starter kit: colours, fonts, sizes, radius and spacing come from the file", () => {
  const r = starterFromFigmaDocument(lightFile, BASE);
  assert.equal(r.usable, true);
  assert.equal(get(r, "color.canvas.default")?.value, "#fafafa");
  assert.equal(get(r, "color.canvas.default")?.dark, "#0d1117", "dark stays the Brandrail default");
  assert.equal(get(r, "color.fg.default")?.value, "#18181b");
  assert.equal(get(r, "color.fg.muted")?.value, "#71717a");
  assert.equal(get(r, "color.action.primary")?.value, "#6c5ce7");
  assert.ok(get(r, "color.action.primary")?.dark, "brand colour gets a dark-theme value");
  assert.equal(get(r, "color.danger.default")?.value, "#e11d48", "red becomes danger, not the brand");
  assert.match(get(r, "font.family.sans")!.value, /^'Inter'/);
  assert.equal(get(r, "font.size.base")?.value, "16px", "the most used size is the body size");
  assert.equal(get(r, "font.size.sm")?.value, "14px");
  assert.equal(get(r, "radius.sm")?.value, "8px");
  assert.equal(get(r, "radius.md")?.value, "12px");
  assert.equal(get(r, "radius.full")?.value, "9999px");
  assert.equal(get(r, "space.2")?.value, "8px", "gaps on multiples of 8 → an 8px scale");
  assert.ok(r.found.length >= 5);
});

test("starter kit: a dark file sets the dark values and derives readable light ones", () => {
  const dark = JSON.parse(JSON.stringify(lightFile).replaceAll('"r":0.9803921568627451,"g":0.9803921568627451,"b":0.9803921568627451', '"r":0.05,"g":0.06,"b":0.08'));
  // Swap text colours to light ones for a dark design.
  const s = JSON.stringify(dark).replaceAll(JSON.stringify(c("#18181b")).slice(1, -1), JSON.stringify(c("#f4f4f5")).slice(1, -1));
  const r = starterFromFigmaDocument(JSON.parse(s), BASE);
  assert.equal(get(r, "color.canvas.default")?.value, "#ffffff", "light value stays the default");
  assert.notEqual(get(r, "color.canvas.default")?.dark, "#0d1117");
  assert.equal(get(r, "color.fg.default")?.dark, "#f4f4f5");
  const darkPrimary = get(r, "color.action.primary")!.dark!;
  assert.ok(contrast(darkPrimary, "#1f2328") >= 4.5, `${darkPrimary} must carry a label and read on the dark page`);
});

test("starter kit: an empty file keeps the Brandrail defaults and says so", () => {
  const r = starterFromFigmaDocument({ type: "DOCUMENT", children: [] }, BASE);
  assert.equal(r.usable, false);
  assert.equal(get(r, "color.action.primary")?.value, "#1f883d");
});

test("starter kit: the result round-trips through the importer with dark values", () => {
  const r = starterFromFigmaDocument(lightFile, BASE);
  const imported = importTokens(buildDtcg(r.tokens));
  const flat = flattenTokens(imported.tokens);
  assert.equal(flat.find((t) => t.path === "color.action.primary")?.value, "#6c5ce7");
  assert.ok(flat.find((t) => t.path === "color.canvas.default")?.dark);
});

test("starter kit: light grey secondary text is darkened until it passes AA", () => {
  const doc = {
    type: "FRAME",
    fills: solid("#ffffff"),
    absoluteBoundingBox: { width: 800, height: 600 },
    children: [text("#222222", 15), text("#222222", 15), text("#aaaaaa", 12), text("#aaaaaa", 12)],
  };
  const r = starterFromFigmaDocument(doc, BASE);
  const muted = get(r, "color.fg.muted")!.value;
  assert.notEqual(muted, "#aaaaaa");
  const lum = (h: string) => {
    const f = (i: number) => {
      const x = parseInt(h.slice(i, i + 2), 16) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(1) + 0.7152 * f(3) + 0.0722 * f(5);
  };
  assert.ok(1.05 / (lum(muted) + 0.05) >= 4.5, `${muted} should pass AA on white`);
});

test("starter kit: any brand colour passes the Brand Kit contrast checks in light and dark", () => {
  const full: FlatToken[] = [
    ...BASE,
    { path: "color.canvas.subtle", type: "color", value: "#f6f8fa", dark: "#151b23" },
    { path: "color.border.default", type: "color", value: "#d1d9e0", dark: "#3d444d" },
    { path: "color.success.default", type: "color", value: "#1a7f37", dark: "#3fb950" },
    { path: "color.attention.default", type: "color", value: "#9a6700", dark: "#d29922" },
  ];
  for (const brand of ["#1f883d", "#0969da", "#8250df", "#bf3989", "#bc4c00", "#0e7490", "#6c5ce7", "#ff6b00", "#ffd400", "#00c2ff"]) {
    const doc = { type: "FRAME", fills: solid("#ffffff"), absoluteBoundingBox: { width: 800, height: 600 }, children: [text("#1f2328", 14), text("#1f2328", 14), button(brand), button(brand)] };
    const r = starterFromFigmaDocument(doc, full);
    const issues = auditBrandKit(buildDtcg(r.tokens)).filter((i) => /primary|accent/.test(i.paths.join(",")));
    assert.deepEqual(issues.map((i) => `${i.mode}: ${i.message}`), [], `brand ${brand}`);
  }
});
