import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkSnippet,
  classify,
  diffTokens,
  flattenTokens,
  generateInstructions,
  importTokens,
  mergeTokens,
  resolveConfig,
  slug,
  type FigmaVariablesMeta,
} from "../src/index.ts";

const flat = (doc: unknown) => Object.fromEntries(flattenTokens(doc).map((t) => [t.path, t]));

test("slug and classify", () => {
  assert.equal(slug("base$Fill1"), "base-fill-1");
  assert.equal(slug("Brand / Primary Hover"), "brand-primary-hover");
  assert.deepEqual(classify("colors/Gray/200", "color", { r: 1, g: 1, b: 1, a: 1 }), { path: "color.gray.200", type: "color", value: "#ffffff" });
  assert.equal(classify("rad3", "number", 6, { context: "defaultRadius" })!.path, "radius.3");
  assert.equal(classify("fontSizeXs", "number", 12)!.path, "font.size.xs");
  assert.equal(classify("spacing4", "number", 6)!.path, "space.4");
  assert.equal(classify("gap/md", "number", 12, { scopes: ["GAP"] })!.path, "space.md");
  assert.equal(classify("Corner/sm", "number", 4, { scopes: ["CORNER_RADIUS"] })!.value, "4px");
  assert.deepEqual(classify("fontWeightSemiBold", "string", "Semi Bold"), { path: "font.weight.semi-bold", type: "fontWeight", value: "600" });
  assert.equal(classify("fontFamily", "string", "Inter")!.path, "font.family.sans");
  assert.equal(classify("copy/hello", "string", "Hello world"), null);
});

const figma: FigmaVariablesMeta = {
  variableCollections: {
    prim: { id: "prim", name: "Primitives", defaultModeId: "pl", modes: [{ modeId: "pl", name: "Light" }, { modeId: "pd", name: "Dark" }] },
    sem: { id: "sem", name: "Semantic", defaultModeId: "s1", modes: [{ modeId: "s1", name: "Brand A" }, { modeId: "s2", name: "Brand B" }] },
    num: { id: "num", name: "Radius", defaultModeId: "n1", modes: [{ modeId: "n1", name: "Default" }] },
  },
  variables: {
    g100: { id: "g100", name: "Gray/100", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { pl: { r: 0.95, g: 0.95, b: 0.96, a: 1 }, pd: { r: 0.2, g: 0.2, b: 0.2, a: 1 } } },
    g200: { id: "g200", name: "Gray/200", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { pl: { r: 0.88, g: 0.88, b: 0.89, a: 1 }, pd: { r: 0.24, g: 0.24, b: 0.24, a: 1 } } },
    g300: { id: "g300", name: "Gray/300", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { pl: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, pd: { r: 0.3, g: 0.3, b: 0.3, a: 1 } } },
    green: { id: "green", name: "Green/600", resolvedType: "COLOR", variableCollectionId: "prim", valuesByMode: { pl: { r: 0.12, g: 0.53, b: 0.24, a: 1 }, pd: { r: 0.25, g: 0.73, b: 0.31, a: 1 } } },
    border: {
      id: "border",
      name: "Base/Border",
      description: "Default borders",
      resolvedType: "COLOR",
      variableCollectionId: "sem",
      valuesByMode: { s1: { type: "VARIABLE_ALIAS", id: "g200" }, s2: { type: "VARIABLE_ALIAS", id: "g100" } },
    },
    primary: { id: "primary", name: "Action/Primary", resolvedType: "COLOR", variableCollectionId: "sem", valuesByMode: { s1: { type: "VARIABLE_ALIAS", id: "green" }, s2: { type: "VARIABLE_ALIAS", id: "green" } } },
    overlay: { id: "overlay", name: "Overlay", resolvedType: "COLOR", variableCollectionId: "sem", valuesByMode: { s1: { r: 0, g: 0, b: 0, a: 0.5 }, s2: { r: 0, g: 0, b: 0, a: 0.5 } } },
    radius: { id: "radius", name: "md", resolvedType: "FLOAT", variableCollectionId: "num", scopes: ["CORNER_RADIUS"], valuesByMode: { n1: 6 } },
    secret: { id: "secret", name: "Internal/Thing", resolvedType: "COLOR", variableCollectionId: "sem", hiddenFromPublishing: true, valuesByMode: { s1: { r: 1, g: 0, b: 0, a: 1 }, s2: { r: 1, g: 0, b: 0, a: 1 } } },
    flag: { id: "flag", name: "Feature/On", resolvedType: "BOOLEAN", variableCollectionId: "num", valuesByMode: { n1: true } },
  },
};

test("Figma variables: aliases, dark mode through aliases, primitives hidden, notes", () => {
  const r = importTokens({ status: 200, error: false, meta: figma });
  assert.equal(r.format, "figma-variables");
  const t = flat(r.tokens);
  assert.deepEqual(Object.keys(t).sort(), ["color.action.primary", "color.base.border", "color.overlay", "radius.md"]);
  assert.equal(t["color.base.border"]!.value, "#e0e0e3");
  assert.equal(t["color.base.border"]!.dark, "#3d3d3d");
  assert.equal(t["color.base.border"]!.description, "Default borders");
  assert.equal(t["color.overlay"]!.value, "#00000080");
  assert.equal(t["color.overlay"]!.dark, undefined);
  assert.equal(t["radius.md"]!.value, "6px");
  assert.equal(r.primitives, 4);
  assert.ok(r.notes.some((n) => /Brand A/.test(n)));
  assert.ok(r.notes.some((n) => /hidden from publishing/.test(n)));

  const all = importTokens({ meta: figma }, { includePrimitives: true });
  assert.ok(flat(all.tokens)["color.gray.200"]);
});

test("Tokens Studio: sets, references and a dark set", () => {
  const studio = {
    global: {
      colors: { green: { value: "#1f883d", type: "color" }, white: { value: "#fff", type: "color" } },
      spacing: { sm: { value: "8", type: "spacing" } },
    },
    light: { bg: { value: "{colors.white}", type: "color" }, primary: { value: "{colors.green}", type: "color", description: "CTA" } },
    dark: { bg: { value: "#0d1117", type: "color" } },
    $metadata: { tokenSetOrder: ["global", "light", "dark"] },
  };
  const r = importTokens(studio);
  assert.equal(r.format, "tokens-studio");
  const t = flat(r.tokens);
  assert.equal(t["color.bg"]!.value, "#ffffff");
  assert.equal(t["color.bg"]!.dark, "#0d1117");
  assert.equal(t["color.primary"]!.value, "#1f883d");
  assert.equal(t["color.primary"]!.description, "CTA");
  assert.equal(t["spacing.sm"]!.value, "8");
});

test("DTCG passes through, with alias references and the dark extension", () => {
  const doc = {
    color: {
      $type: "color",
      brand: { $value: "#0969da" },
      link: { $value: "{color.brand}", $extensions: { "dev.brandrail": { modes: { dark: "#4493f8" } } } },
    },
    radius: { md: { $type: "dimension", $value: "6px" } },
  };
  const t = flat(importTokens(doc).tokens);
  assert.equal(t["color.link"]!.value, "#0969da");
  assert.equal(t["color.link"]!.dark, "#4493f8");
  assert.equal(t["radius.md"]!.value, "6px");
});

test("mode-keyed objects (Figma variable export scripts)", () => {
  const kit = {
    themeA: { color: { base$Border: "colorsGray200", state$Danger: "colorsRed600" } },
    themeB: { color: { base$Border: "colorsGray100", state$Danger: "colorsRed600" } },
    light: { color: { colorsGray100: "#f4f4f5", colorsGray200: "#e1e1e2", colorsGray300: "#d0d0d4", colorsRed600: "#dc2828" } },
    dark: { color: { colorsGray100: "#333333", colorsGray200: "#3d3d3d", colorsGray300: "#5f5f5f", colorsRed600: "#ff9393" } },
    defaultRadius: { number: { rad0: "0px", rad1: "2px", rad2: "4px" } },
    rounded: { number: { rad0: "0px", rad1: "4px", rad2: "8px" } },
    fontA: { number: { fontSizeBase: "16px", lineHeightBase: "24px" }, string: { fontFamily: "Inter", fontWeightBold: "Bold" } },
  };
  const r = importTokens(kit);
  assert.equal(r.format, "mode-object");
  const t = flat(r.tokens);
  assert.equal(t["color.base.border"]!.value, "#e1e1e2");
  assert.equal(t["color.base.border"]!.dark, "#3d3d3d");
  assert.equal(t["color.state.danger"]!.dark, "#ff9393");
  assert.equal(t["color.gray.300"], undefined, "unreferenced steps of a used ramp are primitives too");
  assert.deepEqual(["radius.0", "radius.1", "radius.2"].map((p) => t[p]!.value), ["0px", "2px", "4px"]);
  assert.equal(t["font.family.sans"]!.value, "Inter");
  assert.equal(t["font.weight.bold"]!.value, "700");
  assert.equal(t["font.size.base"]!.value, "16px");
  assert.ok(r.notes.some((n) => /defaultRadius \/ rounded/.test(n)));
});

test("Figma styles fallback", () => {
  const r = importTokens({
    styles: [
      { name: "Brand/Primary", styleType: "FILL", node: { fills: [{ type: "SOLID", color: { r: 0.12, g: 0.53, b: 0.24 } }] } },
      { name: "Gradient", styleType: "FILL", node: { fills: [{ type: "GRADIENT_LINEAR" }] } },
      { name: "Heading/H1", styleType: "TEXT", node: { style: { fontFamily: "Inter", fontSize: 32, fontWeight: 600, lineHeightPx: 40.2 } } },
      { name: "Body", styleType: "TEXT", node: { style: { fontFamily: "Inter", fontSize: 14 } } },
      { name: "Code", styleType: "TEXT", node: { style: { fontFamily: "JetBrains Mono", fontSize: 13 } } },
    ],
  });
  const t = flat(r.tokens);
  assert.equal(t["color.brand.primary"]!.value, "#1f873d");
  assert.equal(t["font.size.heading-h-1"]!.value, "32px");
  assert.equal(t["font.line-height.heading-h-1"]!.value, "40px");
  assert.equal(t["font.family.sans"]!.value, "Inter");
  assert.equal(t["font.family.mono"]!.value, "JetBrains Mono");
  assert.match(r.notes[0]!, /1 fill style/);
});

test("diff and merge", () => {
  const before = { color: { a: { $type: "color", $value: "#111111" }, b: { $type: "color", $value: "#222222" }, c: { $type: "color", $value: "#333333" } } };
  const after = { color: { a: { $type: "color", $value: "#111111" }, b: { $type: "color", $value: "#2a2a2a" }, d: { $type: "color", $value: "#444444" } } };
  const d = diffTokens(before, after);
  assert.deepEqual(d.added.map((x) => x.path), ["color.d"]);
  assert.deepEqual(d.removed.map((x) => x.path), ["color.c"]);
  assert.deepEqual(d.changed.map((x) => [x.path, x.before.value, x.after.value]), [["color.b", "#222222", "#2a2a2a"]]);
  assert.equal(d.unchanged, 1);
  assert.deepEqual(Object.keys(flat(mergeTokens(before, after))).sort(), ["color.a", "color.b", "color.c", "color.d"]);
});

test("dark values are allowed by the Checker and listed for AI tools", () => {
  const tokens = {
    color: { canvas: { $type: "color", $value: "#ffffff", $extensions: { "dev.brandrail": { modes: { dark: "#0d1117" } } } } },
    font: { family: { body: { $type: "fontFamily", $value: "Inter" } } },
  };
  const r = resolveConfig({ tokens });
  assert.equal(r.colors.length, 2);
  const v = checkSnippet(`.a { background: #0d1117; }`, "a.css", { tokens }).violations.filter((x) => x.ruleId === "no-hardcoded-color");
  assert.equal(v[0]!.severity, "warning");
  assert.match(v[0]!.suggestion!, /var\(--color-canvas\)/);
  const md = generateInstructions({ tokens });
  assert.match(md, /color\.canvas \(#ffffff, dark #0d1117\)/);
  assert.match(md, /var\(--font-family-body\)/);
});

test("translucent tokens don't match opaque colours", () => {
  const tokens = {
    color: {
      disabled: { $type: "color", $value: "#1a1a1a2e" },
      ink: { $type: "color", $value: "#1a1a1a" },
    },
  };
  const v = checkSnippet(`.a { color: #1a1a1a; background: rgba(26, 26, 26, 0.18); }`, "a.css", { tokens }).violations;
  assert.deepEqual(v.map((x) => [x.severity, x.suggestion]), [
    ["warning", "Use var(--color-ink) so it follows Brand Kit updates"],
    ["warning", "Use var(--color-disabled) so it follows Brand Kit updates"],
  ]);
});

test("generateTokensCss writes variables with dark overrides", async () => {
  const { generateTokensCss } = await import("../src/index.ts");
  const css = generateTokensCss(
    { color: { canvas: { $type: "color", $value: "#ffffff", $extensions: { "dev.brandrail": { modes: { dark: "#0d1117" } } } } }, space: { 2: { $type: "dimension", $value: "8px" } } },
    { version: "1.3.0", org: "Acme" },
  );
  assert.match(css, /:root \{\n  --color-canvas: #ffffff;\n  --space-2: 8px;\n\}/);
  assert.match(css, /\[data-theme="dark"\] \{\n  --color-canvas: #0d1117;/);
  assert.match(css, /Acme Brand Kit v1\.3\.0/);
  assert.match(generateInstructions({ tokens: {} }, { tokensCss: "src/brandrail.tokens.css" }), /`src\/brandrail\.tokens\.css` defines every CSS variable/);
});

test("kitBridgeCss maps the Brand Kit onto the kit's variables", async () => {
  const { kitBridgeCss } = await import("../src/index.ts");
  const tokens = {
    color: {
      action: { primary: { $type: "color", $value: "#d1242f" } },
      canvas: { default: { $type: "color", $value: "#ffffff", $extensions: { "dev.brandrail": { modes: { dark: "#0d1117" } } } } },
    },
    font: { family: { sans: { $type: "fontFamily", $value: "Georgia, serif" } }, size: { sm: { $type: "dimension", $value: "13px" }, base: { $type: "dimension", $value: "15px" } } },
    space: { 1: { $type: "dimension", $value: "4px" }, 2: { $type: "dimension", $value: "8px" }, 3: { $type: "dimension", $value: "16px" } },
    radius: { sm: { $type: "dimension", $value: "2px" }, md: { $type: "dimension", $value: "12px" } },
  };
  const global = kitBridgeCss(tokens);
  assert.match(global, /^html:root \{/);
  assert.match(global, /--spacing6: 8px;/, "kit 10px snaps to the 8px step");
  assert.match(global, /--defaultRadius-rad3: 12px;/, "kit md radius follows the Brand Kit md");
  assert.match(global, /--fontA-fontSizeSm: 13px;/);
  assert.match(global, /html:root, html:root :is\(\.brandrail, \.themeA, \.themeB\)\.light \{[^}]*--stateBrandActive: #d1242f;[^}]*--fontA-fontFamily: Georgia, serif;/);
  assert.match(global, /\.dark \{[^}]*--baseSurface1: #0d1117;/);
  assert.match(kitBridgeCss(tokens, { scope: "#x" }), /^#x \{/m);
});

test("instructions tell the AI to load the kit stylesheet when kit components are registered", async () => {
  const { starterConfig } = await import("../src/index.ts");
  const withKit = generateInstructions({ ...starterConfig, components: [{ name: "Button", importPath: "@brandrail/kit" }] } as never, { tokensCss: "src/brandrail.tokens.css" });
  assert.match(withKit, /@brandrail\/kit\/styles\.css/);
  assert.match(withKit, /src\/brandrail\.tokens\.css/);
  const without = generateInstructions({ ...starterConfig, components: [{ name: "Button", importPath: "@/components/ui/button" }] } as never);
  assert.doesNotMatch(without, /styles\.css/);
});
