import { test } from "node:test";
import assert from "node:assert/strict";
import { auditBrandKit, starterConfig } from "../src/index.ts";

const kit = (colors: Record<string, string | [string, string]>) => {
  const doc: Record<string, unknown> = {};
  for (const [path, v] of Object.entries(colors)) {
    const [light, dark] = Array.isArray(v) ? v : [v];
    let node = doc;
    const parts = path.split(".");
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = { $type: "color", $value: light, ...(dark ? { $extensions: { "dev.brandrail": { modes: { dark } } } } : {}) };
  }
  return doc;
};

const complete = {
  "color.canvas.default": "#ffffff",
  "color.fg.default": "#1f2328",
  "color.fg.muted": "#59636e",
  "color.action.primary": "#1f883d",
  "color.danger.default": "#cf222e",
  "color.success.default": "#1a7f37",
  "color.attention.default": "#9a6700",
};

test("the starter Brand Kit passes", () => {
  assert.deepEqual(auditBrandKit(starterConfig.tokens), []);
  assert.deepEqual(auditBrandKit(kit(complete)), []);
});

test("a light primary colour fails as text (the Acme yellow)", () => {
  const issues = auditBrandKit(kit({ ...complete, "color.action.primary": "#a5a805" }));
  const i = issues.find((x) => x.paths.includes("color.action.primary"))!;
  assert.equal(i.severity, "error");
  assert.match(i.message, /2\.6:1/);
});

test("unreadable body text is an error; missing status colours are warnings", () => {
  const { "color.success.default": _s, "color.attention.default": _w, ...rest } = complete;
  const issues = auditBrandKit(kit({ ...rest, "color.fg.default": "#bbbbbb" }));
  assert.equal(issues[0]!.severity, "error");
  assert.equal(issues[0]!.code, "text-contrast");
  const missing = issues.filter((i) => i.code === "missing-color").map((i) => i.message);
  assert.equal(missing.length, 2);
  assert.ok(missing.some((m) => /No success colour/.test(m)) && missing.some((m) => /No warning colour/.test(m)));
});

test("checks dark mode separately", () => {
  const issues = auditBrandKit(kit({ ...complete, "color.canvas.default": ["#ffffff", "#0d1117"], "color.fg.default": ["#1f2328", "#30363d"] }));
  const dark = issues.find((i) => i.code === "text-contrast")!;
  assert.equal(dark.mode, "dark");
  assert.match(dark.message, /dark mode/);
});
