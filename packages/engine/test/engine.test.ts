import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkSnippet, computeScore, findComponentByName, findComponents, formatGithubAnnotations, formatMarkdown, generateInstructions, resolveConfig, starterConfig } from "../src/index.ts";
import { globMatcher, stripComments } from "../src/source.ts";

const cfg = starterConfig;
const ids = (code: string, file = "src/App.tsx") => checkSnippet(code, file, cfg).violations.map((v) => v.ruleId);
const only = (code: string, rule: string, file = "src/App.tsx") =>
  checkSnippet(code, file, cfg).violations.filter((v) => v.ruleId === rule);

test("resolves tokens into colours, spacing, radii and fonts", () => {
  const r = resolveConfig(cfg);
  assert.equal(r.colors.length, 10);
  assert.ok(r.spacing.includes(8) && r.spacing.includes(16) && r.spacing.includes(4));
  assert.ok(!r.spacing.includes(13));
  assert.deepEqual(r.radii.filter((x) => x < 999), [0, 3, 6, 12]);
  assert.equal(r.fonts[0], "-apple-system");
  assert.equal(r.replaces.get("button")?.name, "Button");
  assert.equal(r.replaces.get("input")?.name, "TextInput");
});

test("no-hardcoded-color: off-palette colour is an error with closest token", () => {
  const v = only(`<div style={{ color: "#3b82f6" }} />`, "no-hardcoded-color");
  assert.equal(v.length, 1);
  assert.equal(v[0]!.severity, "error");
  assert.match(v[0]!.suggestion!, /color\.accent\.default/);
});

test("no-hardcoded-color: exact token value is a warning suggesting the variable", () => {
  const v = only(`const s = { background: "#1F883D" }`, "no-hardcoded-color");
  assert.equal(v[0]!.severity, "warning");
  assert.match(v[0]!.suggestion!, /var\(--color-action-primary\)/);
});

test("no-hardcoded-color: rgb(), hsl() and Tailwind arbitrary values", () => {
  assert.equal(only(`<p className="text-[#ff0000]" />`, "no-hardcoded-color").length, 1);
  assert.equal(only(`.a { color: rgb(255, 0, 0); }`, "no-hardcoded-color", "a.css").length, 1);
  assert.equal(only(`.a { color: hsl(210 50% 40%); }`, "no-hardcoded-color", "a.css").length, 1);
});

test("no-hardcoded-color: ignores anchors, entities, comments and token definitions", () => {
  const code = `
    <a href="#add">x</a>
    <a href="/docs#fff">y</a>
    <span>issue#123 &#123;</span>
    // color: "#ff0000"
    /* background: #00ff00 */
    <use href="#abc" />
  `;
  assert.deepEqual(only(code, "no-hardcoded-color"), []);
  assert.deepEqual(only(`:root { --color-brand: #ff0000; }`, "no-hardcoded-color", "tokens.css"), []);
});

test("no-raw-palette-class flags Tailwind palette classes, including variants", () => {
  const v = only(`<div className="p-4 bg-blue-500 hover:text-gray-700/80 bg-primary" />`, "no-raw-palette-class");
  assert.equal(v.length, 2);
  assert.match(v[1]!.message, /text-gray-700\/80/);
});

test("spacing-scale: CSS, JSX numbers and Tailwind arbitrary values", () => {
  assert.equal(only(`.a { padding: 13px 16px; margin: 0; gap: 8px }`, "spacing-scale", "a.css").length, 1);
  assert.equal(only(`<div style={{ padding: 13, marginTop: 16 }} />`, "spacing-scale").length, 1);
  assert.equal(only(`<div className="p-[13px] gap-[16px]" />`, "spacing-scale").length, 1);
  assert.match(only(`.a{padding:13px}`, "spacing-scale", "a.css")[0]!.suggestion!, /12px or 16px/);
});

test("radius-scale and font-family", () => {
  assert.equal(only(`.a { border-radius: 10px; }`, "radius-scale", "a.css").length, 1);
  assert.equal(only(`.a { border-radius: 6px; }`, "radius-scale", "a.css").length, 0);
  assert.equal(only(`.a { font-family: "Comic Sans MS", cursive; }`, "font-family", "a.css").length, 1);
  assert.equal(only(`.a { font-family: inherit; }`, "font-family", "a.css").length, 0);
  assert.equal(only(`<p style={{ fontFamily: "Inter" }} />`, "font-family").length, 1);
});

test("prefer-official-component: raw elements, but not hidden inputs or the component itself", () => {
  assert.equal(only(`<button onClick={go}>Save</button>`, "prefer-official-component").length, 1);
  assert.equal(only(`<input type="hidden" name="x" />`, "prefer-official-component").length, 0);
  assert.equal(only(`export function Button(){ return <button /> }`, "prefer-official-component").length, 0);
  assert.match(only(`<textarea />`, "prefer-official-component")[0]!.suggestion!, /Textarea/);
});

test("forbidden-import and img-alt", () => {
  assert.equal(only(`import { Button } from "@mui/material";\nimport x from "@mui/material/Button";`, "forbidden-import").length, 2);
  assert.equal(only(`import { useState } from "react";`, "forbidden-import").length, 0);
  assert.equal(only(`<img src="/a.png" />`, "img-alt").length, 1);
  assert.equal(only(`<img src="/a.png" alt="" />`, "img-alt").length, 0);
});

test("rules can be turned off or re-levelled in config", () => {
  const r = checkSnippet(`<button style={{ color: "#ff0000" }} />`, "a.tsx", {
    ...cfg,
    rules: { "prefer-official-component": "off", "no-hardcoded-color": "info" },
  });
  assert.deepEqual(r.violations.map((v) => [v.ruleId, v.severity]), [["no-hardcoded-color", "info"]]);
});

test("ignore globs and non-UI files are skipped", () => {
  const r = check(
    [
      { path: "node_modules/x/index.tsx", content: `<button/>` },
      { path: "src/Button.stories.tsx", content: `<button/>` },
      { path: "README.md", content: `#ff0000` },
      { path: "src/legacy/Old.tsx", content: `<button/>` },
      { path: "src/New.tsx", content: `<button/>` },
    ],
    { ...cfg, ignore: ["src/legacy/**"] },
  );
  assert.equal(r.filesScanned, 1);
  assert.deepEqual(r.violations.map((v) => v.file), ["src/New.tsx"]);
});

test("onlyLines limits findings to changed lines", () => {
  const r = check([{ path: "a.tsx", content: `<button/>\n<button/>` }], cfg, { onlyLines: new Map([["a.tsx", new Set([2])]]) });
  assert.deepEqual(r.violations.map((v) => v.line), [2]);
  const r2 = check(
    [
      { path: "a.tsx", content: `<button/>` },
      { path: "untouched.tsx", content: `<button/>` },
    ],
    cfg,
    { onlyLines: new Map([["a.tsx", new Set([1])]]) },
  );
  assert.deepEqual(r2.violations.map((v) => v.file), ["a.tsx"]);
  assert.equal(r2.filesScanned, 1);
});

test("line and column positions are 1-based", () => {
  const v = only(`const a = 1;\n  <div style={{color:"#ff0000"}} />`, "no-hardcoded-color")[0]!;
  assert.equal(v.line, 2);
  assert.equal(v.column, 23);
});

test("score is 100 with no findings and drops with density", () => {
  assert.equal(computeScore({ error: 0, warning: 0, info: 0 }, 500), 100);
  assert.ok(computeScore({ error: 1, warning: 0, info: 0 }, 2000) > 90);
  assert.ok(computeScore({ error: 10, warning: 0, info: 0 }, 2000) < 60);
  assert.equal(checkSnippet(`export const A = () => <Button>Ok</Button>`, "a.tsx", cfg).score, 100);
});

test("reporters produce markdown and GitHub annotations", () => {
  const r = checkSnippet(`<button style={{ color: "#ff0000" }} />`, "src/a.tsx", cfg);
  const md = formatMarkdown(r, { threshold: 80 });
  assert.match(md, /Brand score: \*\*\d+\*\*\/100/);
  assert.match(md, /<!-- brandrail-report -->/);
  const ann = formatGithubAnnotations(r);
  assert.match(ann, /^::error file=src\/a\.tsx,line=1,col=\d+,title=Brandrail%3A /m);
});

test("stripComments keeps offsets and leaves strings alone", () => {
  const src = `const u = "http://x.com/#fff"; // #000\n/* #111 */ x`;
  const out = stripComments(src, "jsx");
  assert.equal(out.length, src.length);
  assert.ok(out.includes("http://x.com/#fff"));
  assert.ok(!out.includes("#000") && !out.includes("#111"));
});

test("glob matcher", () => {
  assert.ok(globMatcher("**/node_modules/**")("a/node_modules/b/c.js"));
  assert.ok(globMatcher("**/*.stories.*")("src/Button.stories.tsx"));
  assert.ok(globMatcher("src/{legacy,old}/**")("src/old/x.tsx"));
  assert.ok(!globMatcher("src/*.tsx")("src/a/b.tsx"));
});

test("findComponents ranks by name, aliases, synonyms and description", () => {
  const reg = {
    components: [
      { name: "Button", importPath: "@acme/ui", description: "Triggers an action" },
      { name: "DatePicker", importPath: "@acme/ui", description: "Pick a date or a date range" },
      { name: "Dialog", importPath: "@acme/ui", aliases: ["Modal"] },
      { name: "Select", importPath: "@acme/ui", description: "Choose one option from a list" },
      { name: "OldButton", importPath: "@acme/legacy", status: "deprecated" as const },
    ],
  };
  assert.equal(findComponents(reg, "primary action button")[0]!.component.name, "Button");
  assert.equal(findComponents(reg, "calendar to schedule a service")[0]!.component.name, "DatePicker");
  assert.equal(findComponents(reg, "popup modal")[0]!.component.name, "Dialog");
  assert.equal(findComponents(reg, "dropdown of countries")[0]!.component.name, "Select");
  assert.ok(!findComponents(reg, "button").some((m) => m.component.name === "OldButton"));
  assert.equal(findComponentByName(reg, "modal")?.name, "Dialog");
  assert.deepEqual(findComponents(reg, "zzz"), []);
  // No dialog in this registry: nothing unrelated should come back.
  assert.deepEqual(findComponents({ components: reg.components.filter((c) => c.name !== "Dialog") }, "popup modal"), []);
});

test("generateInstructions lists components, tokens and the validate step", () => {
  const md = generateInstructions(starterConfig, { org: "Acme" });
  assert.match(md, /`Button` from `@acme\/ui` \(instead of <button>\)/);
  assert.match(md, /var\(--color-action-primary\)/);
  assert.match(md, /validate_snippet/);
});

test("prefer-official-component is input-type aware", () => {
  const reg = {
    ...cfg,
    components: [
      { name: "InputText", importPath: "@k/ui", replaces: ["input"] },
      { name: "Checkbox", importPath: "@k/ui" },
      { name: "Button", importPath: "@k/ui" },
    ],
  };
  const msgs = (code: string) => checkSnippet(code, "a.tsx", reg).violations.filter((v) => v.ruleId === "prefer-official-component").map((v) => v.message);
  assert.deepEqual(msgs(`<input type="checkbox" />`), [`Raw <input type="checkbox"> re-implements Checkbox`]);
  assert.deepEqual(msgs(`<input type="email" />`), [`Raw <input type="email"> re-implements InputText`]);
  assert.deepEqual(msgs(`<input />`), [`Raw <input> re-implements InputText`]);
  assert.deepEqual(msgs(`<input type="radio" />`), []);
  assert.deepEqual(msgs(`<input type="submit" />`), [`Raw <input type="submit"> re-implements Button`]);
  assert.deepEqual(msgs(`<input type={"range"} />`), []);
});
