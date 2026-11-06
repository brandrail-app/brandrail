import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTokenDeprecations,
  bumpVersion,
  changelogMarkdown,
  checkSnippet,
  generateInstructions,
  kitChangelog,
  starterConfig,
  tokenDeprecations,
  type BrandrailConfig,
} from "../src/index.ts";

const base = {
  color: {
    accent: { default: { $type: "color", $value: "#0969da" }, emphasis: { $type: "color", $value: "#0550ae" } },
    fg: { default: { $type: "color", $value: "#1f2328" } },
  },
  space: { md: { $type: "dimension", $value: "16px" } },
};

test("deprecations round-trip through the DTCG document", () => {
  const doc = applyTokenDeprecations(base, [{ path: "color.accent.default", replacement: "color.accent.emphasis", removeAfter: "2027-03-31", reason: "Too light on white." }]);
  const node = (doc.color as any).accent.default;
  assert.equal(node.$deprecated, "Too light on white.");
  assert.deepEqual(node.$extensions["dev.brandrail"], { replacement: "color.accent.emphasis", removeAfter: "2027-03-31" });
  assert.deepEqual(tokenDeprecations(doc), [{ path: "color.accent.default", replacement: "color.accent.emphasis", removeAfter: "2027-03-31", reason: "Too light on white." }]);
  // Un-deprecating removes every trace, and the original isn't touched.
  const back = applyTokenDeprecations(doc, []);
  assert.deepEqual(back, base);
  assert.equal((base.color.accent.default as any).$deprecated, undefined);
});

test("semantic version bump from the change", () => {
  const changed = { ...base, color: { ...base.color, fg: { default: { $type: "color", $value: "#111111" } } } };
  assert.equal(kitChangelog(base, changed).bump, "patch");
  const added = { ...base, radius: { md: { $type: "dimension", $value: "6px" } } };
  assert.equal(kitChangelog(base, added).bump, "minor");
  const deprecated = applyTokenDeprecations(base, [{ path: "color.fg.default" }]);
  const c = kitChangelog(base, deprecated);
  assert.equal(c.bump, "minor");
  assert.deepEqual(c.deprecated.map((d) => d.path), ["color.fg.default"]);
  assert.deepEqual(kitChangelog(deprecated, base).restored, ["color.fg.default"]);
  const { space: _s, ...removed } = base;
  assert.equal(kitChangelog(base, removed).bump, "major");
  assert.equal(kitChangelog(base, base).bump, null);

  assert.equal(bumpVersion(null, "major"), "1.0.0");
  assert.equal(bumpVersion("1.4.2", "major"), "2.0.0");
  assert.equal(bumpVersion("1.4.2", "minor"), "1.5.0");
  assert.equal(bumpVersion("1.4.2", "patch"), "1.4.3");
  assert.equal(bumpVersion("1.4.2", null), "1.4.3");
  assert.match(changelogMarkdown(kitChangelog(base, removed), { from: "1.4.2", to: "2.0.0" }), /\*\*v1\.4\.2 → v2\.0\.0\*\* \(major\): 1 removed\.\n\n⚠️ Breaking/);
});

const config: BrandrailConfig = {
  ...starterConfig,
  tokens: applyTokenDeprecations(base, [{ path: "color.accent.default", replacement: "color.accent.emphasis", removeAfter: "2027-03-31" }]) as BrandrailConfig["tokens"],
  components: [
    { name: "Button", importPath: "@acme/ui", replaces: ["button"] },
    { name: "Panel", importPath: "@acme/ui" },
    {
      name: "Box",
      importPath: "@acme/ui",
      replaces: ["section"],
      status: "deprecated",
      deprecation: { replacement: "Panel", removeAfter: "2027-01-31" },
      frameworks: { "web-components": { importPath: "@acme/el", tag: "acme-box" } },
    },
  ],
};

test("the Checker warns on deprecated tokens with the replacement", () => {
  const vs = checkSnippet(`.a { color: var(--color-accent-default); border-color: var(--color-accent-emphasis); }`, "a.css", config).violations.filter((v) => v.ruleId === "deprecated-token");
  assert.equal(vs.length, 1);
  assert.equal(vs[0]!.severity, "warning");
  assert.match(vs[0]!.message, /--color-accent-default \(color\.accent\.default\) is deprecated and will be removed after 2027-03-31/);
  assert.equal(vs[0]!.suggestion, "Use var(--color-accent-emphasis)");
});

test("the Checker warns on deprecated components in React and in markup, and never points raw elements at them", () => {
  const tsx = `import { Box, Button } from "@acme/ui";\nexport const A = () => <Box><Button /></Box>;`;
  const vs = checkSnippet(tsx, "A.tsx", config).violations.filter((v) => v.ruleId === "deprecated-component");
  assert.deepEqual(vs.map((v) => [v.line, v.message, v.suggestion]), [[2, "Box is deprecated and will be removed after 2027-01-31", "Use Panel"]]);
  const html = checkSnippet(`<acme-box><section>x</section></acme-box>`, "a.html", config).violations;
  assert.equal(html.filter((v) => v.ruleId === "deprecated-component").length, 1);
  assert.equal(html.filter((v) => v.ruleId === "prefer-official-component").length, 0, "no one is sent to a deprecated component");
});

test("AI rule files leave deprecated items out of the lists and name the replacements", () => {
  const md = generateInstructions(config, { org: "Acme" });
  assert.match(md, /## Deprecated: don't use in new code/);
  assert.match(md, /`var\(--color-accent-default\)` → use `var\(--color-accent-emphasis\)` \(removed after 2027-03-31\)/);
  assert.match(md, /- `Box` → use `Panel` \(removed after 2027-01-31\)/);
  const comps = md.split("## Components")[1]!.split("##")[0]!;
  assert.ok(!comps.includes("Box"), "Box isn't in the components to use");
  const colours = md.split("## Colours")[1]!.split("##")[0]!;
  assert.ok(!colours.includes("--color-accent-default`"), "the deprecated colour isn't offered");
});
