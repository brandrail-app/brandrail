import { test } from "node:test";
import assert from "node:assert/strict";
import { changedLinesFromPatch, mergeProjectConfig, projectFiles, starterConfig, RULES_START } from "../src/index.ts";

test("projectFiles: config, tokens CSS and rule files; keeps the project's own text", () => {
  const files = projectFiles({ ...starterConfig, framework: "angular" }, {
    org: "Acme",
    tokensCss: "src/brandrail.tokens.css",
    read: (p) => (p === "CLAUDE.md" ? "# Our notes\n\nKeep this.\n" : undefined),
  });
  const paths = files.map((f) => f.path);
  assert.deepEqual(paths.slice(0, 2), ["brandrail.config.json", "src/brandrail.tokens.css"]);
  const claude = files.find((f) => f.path === "CLAUDE.md")!.content;
  assert.match(claude, /^# Our notes\n\nKeep this\./);
  assert.ok(claude.includes(RULES_START));
  assert.match(files.find((f) => f.path === ".cursor/rules/brandrail.mdc")!.content, /^---\ndescription/);
  const only = projectFiles(starterConfig, { read: (p) => (p === "AGENTS.md" ? "x" : undefined), onlyExistingRules: true, tokensCss: false });
  assert.deepEqual(only.map((f) => f.path), ["brandrail.config.json", "AGENTS.md"]);
});

test("mergeProjectConfig keeps local settings", () => {
  const m = mergeProjectConfig({ ...starterConfig, rules: { "img-alt": "off" }, ignore: ["legacy/**"], tokensCss: "app/tokens.css", framework: "vue" }, { ...starterConfig, tokenVersion: "2.0.0" });
  assert.equal(m.tokenVersion, "2.0.0");
  assert.equal(m.rules!["img-alt"], "off");
  assert.deepEqual(m.ignore, ["legacy/**"]);
  assert.equal(m.tokensCss, "app/tokens.css");
  assert.equal(m.framework, "vue");
});

test("changedLinesFromPatch", () => {
  const patch = "@@ -1,3 +1,4 @@\n line1\n-old\n+new2\n+new3\n line4\n@@ -10,0 +12,1 @@\n+added12";
  assert.deepEqual([...changedLinesFromPatch(patch)], [2, 3, 12]);
  assert.equal(changedLinesFromPatch(undefined).size, 0);
});
