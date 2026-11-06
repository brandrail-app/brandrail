import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSnippet, findLegacyUsages, migrationMapMarkdown, resolveConfig, starterConfig, type BrandrailConfig } from "../src/index.ts";

const config: BrandrailConfig = {
  ...starterConfig,
  components: [
    { name: "Button", importPath: "@acme/ui", replaces: ["button"], frameworks: { "web-components": { importPath: "@acme/el", tag: "acme-button" } } },
    { name: "Dropdown", importPath: "@acme/ui", replaces: ["select"], aliases: ["Select"] },
    { name: "DatePicker", importPath: "@acme/ui", aliases: ["Calendar"], frameworks: { angular: { importPath: "@acme/ng", importName: "DateModule", tag: "acme-date" } } },
  ],
};
const legacy = (code: string, file: string) => checkSnippet(code, file, config).violations.filter((v) => v.ruleId === "legacy-library");

test("MUI in React: imported names, aliases and default imports", () => {
  const tsx = `import { Button as B, TextField } from "@mui/material";\nimport Select from "@mui/material/Select";\nexport const A = () => <><B variant="contained">Go</B><TextField /><Select /></>;`;
  const vs = legacy(tsx, "A.tsx");
  assert.deepEqual(vs.map((v) => v.message), [
    "MUI <Button> (MUI (Material UI)) should be Button",
    "MUI <TextField> (MUI (Material UI)) should be a design system input",
    "MUI <Select> (MUI (Material UI)) should be Dropdown",
  ]);
  assert.equal(vs[0]!.suggestion, 'import { Button } from "@acme/ui"');
});

test("Angular Material: elements and attributes, suggestions in Angular form", () => {
  const html = `<button mat-raised-button color="primary">Save</button>\n<mat-form-field><input matInput></mat-form-field>\n<mat-select></mat-select>\n<mat-datepicker></mat-datepicker>`;
  const vs = legacy(html, "src/app/a.component.html");
  assert.deepEqual(vs.map((v) => [v.line, v.message.split(" (")[0]]), [
    [1, "<button mat-raised-button>"],
    [2, "<mat-form-field>"],
    [2, "<input matInput>"],
    [3, "<mat-select>"],
    [4, "<mat-datepicker>"],
  ]);
  assert.match(vs[0]!.suggestion!, /acme-button/);
  assert.match(vs.at(-1)!.suggestion!, /acme-date/);
  assert.match(vs[3]!.suggestion!, /Dropdown has no Angular version/);
});

test("Bootstrap only where the file clearly uses Bootstrap (Moodle Mustache)", () => {
  const mustache = `<button class="btn btn-primary">{{#str}}save{{/str}}</button>\n<select class="custom-select"></select>\n<div class="alert alert-info">{{message}}</div>`;
  const vs = legacy(mustache, "templates/form.mustache");
  assert.deepEqual(vs.map((v) => v.message.split(" (")[0]), ['class "btn"', 'class "form-select"', 'class "alert"']);
  assert.equal(findLegacyUsages(`<div class="card alert">mine</div>`, "html").length, 0);
});

test("migration map in Markdown", () => {
  const md = migrationMapMarkdown(resolveConfig(config), "angular", ["angular-material"]);
  assert.match(md, /\| `<mat-select>` \| Angular Material \| _Dropdown has no angular version yet_ \|/);
  assert.match(md, /\| `mat-raised-button` \| Angular Material \| `<acme-button>`/);
  assert.doesNotMatch(md, /MUI/);
});

test("migration status and handover report", async () => {
  const { migrationStatus, formatHandoverHtml, projectFiles, MIGRATE_SKILL_FILE } = await import("../src/index.ts");
  const files = [
    { path: "src/a.tsx", content: `import { Button } from "@mui/material";\nexport const A = () => <Button>Go</Button>;` },
    { path: "src/b.tsx", content: `export const B = () => <p style={{ color: "#ff00aa" }}>Hi</p>;` },
    { path: "src/c.tsx", content: `export const C = () => <p>fine</p>;` },
  ];
  const s = migrationStatus(files, config);
  assert.equal(s.filesScanned, 3);
  assert.equal(s.filesClean, 1);
  assert.equal(s.progress, 33);
  assert.equal(s.libraries.mui, 1);
  assert.equal(s.files[0]!.path, "src/a.tsx");
  const html = formatHandoverHtml(s, { project: "acme/<web>", org: "Acme", kitVersion: "1.4.0" });
  assert.match(html, /acme\/&lt;web&gt;/);
  assert.match(html, /33%/);
  assert.match(html, /MUI \(Material UI\)/);
  assert.doesNotMatch(html, /#ff00aa/); // no code in the report

  const skill = projectFiles({ ...config, framework: "angular" }, { org: "Acme", read: () => undefined, pkg: { dependencies: { "@angular/material": "14" } }, tokensCss: false }).find((f) => f.path === MIGRATE_SKILL_FILE)!.content;
  assert.match(skill, /^---\nname: brandrail-migrate\n/);
  assert.match(skill, /Libraries in this project: Angular Material, Bootstrap/);
  assert.match(skill, /`<mat-select>`/);
  assert.doesNotMatch(skill, /\| MUI \(Material UI\) \|/);
  assert.match(skill, /CUSTOM_ELEMENTS_SCHEMA/);
});
