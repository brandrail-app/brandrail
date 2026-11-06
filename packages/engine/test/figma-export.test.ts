import { test } from "node:test";
import assert from "node:assert/strict";
import { flattenTokens, importTokenFiles, importTokens } from "../src/index.ts";

// Shapes from Figma's "Export modes": one DTCG file per mode, DTCG 2025.10 colours, com.figma extensions.
const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return { colorSpace: "srgb", components: [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255], alpha: 1, hex };
};
const color = (hex: string, extra: Record<string, unknown> = {}) => ({ $type: "color", $value: rgb(hex), $extensions: { "com.figma.variableId": "VariableID:1:1", "com.figma.scopes": ["ALL_SCOPES"], ...extra } });

const primitives = {
  green: { "500": color("#1f883d"), "400": color("#2ea043"), "300": color("#3fb950") },
  gray: { "900": color("#1f2328"), "50": color("#f6f8fa"), "0": color("#ffffff"), "950": color("#0d1117") },
  $extensions: { "com.figma.modeName": "Mode 1" },
};
const alias = (hex: string, target: string) => color(hex, { "com.figma.aliasData": { targetVariableName: target, targetVariableSetName: "Primitives" } });
const light = {
  color: {
    action: { primary: alias("#1f883d", "green/500") },
    canvas: { default: alias("#ffffff", "gray/0") },
    fg: { default: alias("#1f2328", "gray/900") },
  },
  spacing: { md: { $type: "number", $value: 16, $extensions: { "com.figma.scopes": ["GAP"] } } },
  radius: { md: { $type: "dimension", $value: { value: 0.375, unit: "rem" } } },
  $extensions: { "com.figma.modeName": "Light" },
};
const dark = {
  color: {
    action: { primary: alias("#2ea043", "green/400") },
    canvas: { default: alias("#0d1117", "gray/950") },
    fg: { default: alias("#f6f8fa", "gray/50") },
  },
  spacing: { md: { $type: "number", $value: 16 } },
  radius: { md: { $type: "dimension", $value: { value: 0.375, unit: "rem" } } },
  $extensions: { "com.figma.modeName": "Dark" },
};

test("Figma export: Light + Dark files become tokens with dark values; primitives are left out", () => {
  const r = importTokenFiles([
    { name: "Primitives/Mode 1.tokens.json", data: primitives },
    { name: "Semantic/Light.tokens.json", data: light },
    { name: "Semantic/Dark.tokens.json", data: dark },
  ]);
  assert.equal(r.format, "figma-export");
  const flat = new Map(flattenTokens(r.tokens).map((t) => [t.path, t]));
  assert.equal(flat.get("color.action.primary")?.value, "#1f883d");
  assert.equal(flat.get("color.action.primary")?.dark, "#2ea043");
  assert.equal(flat.get("color.canvas.default")?.dark, "#0d1117");
  assert.equal(flat.get("space.md")?.value, "16px");
  assert.equal(flat.get("radius.md")?.value, "6px");
  assert.ok(![...flat.keys()].some((p) => p.startsWith("color.green")), "primitives referenced by semantic tokens are left out");
  assert.ok(r.primitives >= 3);
  assert.ok(r.notes.some((n) => /Light, Dark/.test(n)));
});

test("Figma export: a single mode file imports on its own (via importTokens too)", () => {
  const r = importTokens(light);
  assert.equal(r.format, "figma-export");
  assert.equal(flattenTokens(r.tokens).find((t) => t.path === "color.fg.default")?.value, "#1f2328");
});

test("Figma export without a folder: mode from com.figma.modeName", () => {
  const r = importTokenFiles([
    { name: "Light.tokens.json", data: light },
    { name: "Dark.tokens.json", data: dark },
  ]);
  assert.equal(flattenTokens(r.tokens).find((t) => t.path === "color.fg.default")?.dark, "#f6f8fa");
});

test("plain DTCG with 2025.10 colour and dimension objects", () => {
  const r = importTokens({ brand: { $type: "color", $value: { colorSpace: "srgb", components: [1, 0, 0], alpha: 0.5 } }, space: { sm: { $type: "dimension", $value: { value: 8, unit: "px" } } } });
  const flat = new Map(flattenTokens(r.tokens).map((t) => [t.path, t.value]));
  assert.equal(flat.get("color.brand"), "#ff000080");
  assert.equal(flat.get("space.sm"), "8px");
});

test("plain DTCG light/dark files (not from Figma) combine by file name", () => {
  const r = importTokenFiles([
    { name: "tokens.light.json", data: { color: { bg: { $type: "color", $value: "#ffffff" } } } },
    { name: "tokens.dark.json", data: { color: { bg: { $type: "color", $value: "#000000" } } } },
  ]);
  assert.equal(flattenTokens(r.tokens).find((t) => t.path === "color.bg")?.dark, "#000000");
});
