import { test } from "node:test";
import assert from "node:assert/strict";
import {
  availableFrameworks,
  bindingHowTo,
  checkSnippet,
  detectFramework,
  generateInstructions,
  resolveUsage,
  starterConfig,
  validateFrameworks,
  type BrandrailConfig,
  type ComponentEntry,
} from "../src/index.ts";

const Button: ComponentEntry = {
  name: "Button",
  importPath: "@acme/ui",
  replaces: ["button"],
  example: "<Button variant=\"primary\">Save</Button>",
  props: [{ name: "variant" }],
  frameworks: {
    angular: { importPath: "@acme/ui-angular", importName: "AcmeButtonModule", tag: "acme-button", example: "<acme-button variant=\"primary\">Save</acme-button>" },
    "web-components": { importPath: "@acme/ui-wc/button.js", tag: "acme-button" },
  },
};
const DatePicker: ComponentEntry = { name: "DatePicker", importPath: "@acme/ui", frameworks: { "web-components": { importPath: "@acme/ui-wc", tag: "acme-date-picker" } } };
const Chart: ComponentEntry = { name: "Chart", importPath: "@acme/charts" };

test("React usage comes from the top-level fields", () => {
  const u = resolveUsage(Button, "react")!;
  assert.equal(u.importLine, 'import { Button } from "@acme/ui";');
  assert.equal(u.tag, "Button");
  assert.equal(u.lang, "tsx");
  assert.deepEqual(u.props, [{ name: "variant" }]);
});

test("Angular uses its own entry: module import, selector and setup", () => {
  const u = resolveUsage(Button, "angular")!;
  assert.equal(u.importLine, 'import { AcmeButtonModule } from "@acme/ui-angular";');
  assert.equal(u.tag, "acme-button");
  assert.match(u.setup!, /imports/);
  assert.equal(u.via, undefined);
  assert.equal(u.props, undefined);
});

test("a web component stands in for Angular, Vue and HTML, with the right setup", () => {
  const ng = resolveUsage(DatePicker, "angular")!;
  assert.equal(ng.via, "web-components");
  assert.equal(ng.tag, "acme-date-picker");
  assert.match(ng.setup!, /CUSTOM_ELEMENTS_SCHEMA/);
  const vue = resolveUsage(DatePicker, "vue")!;
  assert.match(vue.setup!, /isCustomElement.*"acme-"/);
  const html = resolveUsage(DatePicker, "html")!;
  assert.equal(html.importLine, undefined);
  assert.match(html.setup!, /script type="module"/);
});

test("no version for the framework → null", () => {
  assert.equal(resolveUsage(Chart, "angular"), null);
  assert.deepEqual(availableFrameworks(Chart), ["react"]);
  assert.deepEqual(availableFrameworks(DatePicker), ["react", "angular", "vue", "svelte", "solid", "web-components", "html"]);
});

test("detectFramework reads package.json", () => {
  assert.equal(detectFramework({ dependencies: { "@angular/core": "^14.0.0", rxjs: "7" } }), "angular");
  assert.equal(detectFramework({ dependencies: { vue: "^3.4.0" } }), "vue");
  assert.equal(detectFramework({ dependencies: { nuxt: "^3" } }), "vue");
  assert.equal(detectFramework({ dependencies: { next: "16", react: "19" } }), "react");
  assert.equal(detectFramework({ devDependencies: { svelte: "5", "@sveltejs/kit": "2" } }), "svelte");
  assert.equal(detectFramework({ dependencies: { "solid-js": "1.9" } }), "solid");
  assert.equal(detectFramework({ dependencies: { lit: "3" } }), "web-components");
  assert.equal(detectFramework({ dependencies: { express: "4" } }), "html");
  assert.equal(detectFramework(null), "html");
});

test("validateFrameworks rejects bad input", () => {
  assert.equal(validateFrameworks({ angular: { tag: "acme-button", importName: "AcmeButtonModule" } }), null);
  assert.match(validateFrameworks({ react: {} })!, /Unknown framework/);
  assert.match(validateFrameworks({ ember: {} })!, /Unknown framework/);
  assert.equal(validateFrameworks({ svelte: { importPath: "@acme/ui-svelte", tag: "Button" } }), null, "an org's own Svelte library");
  assert.match(validateFrameworks({ angular: { foo: "x" } })!, /isn't a known field/);
  assert.match(validateFrameworks({ "web-components": { tag: "button" } })!, /needs a dash/);
  assert.match(validateFrameworks({ angular: { importName: "a; drop" } })!, /isn't a valid name/);
  assert.match(validateFrameworks({ vue: { example: "x".repeat(2001) } })!, /too long/);
  assert.match(validateFrameworks([])!, /object/);
});

const config: BrandrailConfig = { ...starterConfig, components: [Button, DatePicker, Chart] };

test("rule files show components in the project's framework", () => {
  const ng = generateInstructions(config, { framework: "angular" });
  assert.match(ng, /Angular project/);
  assert.match(ng, /`<acme-button>` \(`import \{ AcmeButtonModule \} from "@acme\/ui-angular";`\) — Button \(instead of <button>\)/);
  assert.match(ng, /`<acme-date-picker>`/);
  assert.match(ng, /CUSTOM_ELEMENTS_SCHEMA/);
  assert.match(ng, /No Angular version yet: Chart/);
  assert.doesNotMatch(ng, /props: variant/);

  const react = generateInstructions(config);
  assert.match(react, /`Button` from `@acme\/ui` \(instead of <button>\) — props: variant/);
  assert.doesNotMatch(react, /No React version/);

  const fromConfig = generateInstructions({ ...config, framework: "vue" });
  assert.match(fromConfig, /Vue project/);
});

test("kit custom elements: install and import steps in non-React rule files", () => {
  const kitBtn = { name: "Button", importPath: "@brandrail/kit", frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-button" } } };
  const md = generateInstructions({ ...starterConfig, components: [kitBtn] }, { framework: "angular" });
  assert.match(md, /npm i @brandrail\/kit/);
  assert.match(md, /import "@brandrail\/kit\/elements";` once at the app entry/);
  const react = generateInstructions({ ...starterConfig, components: [kitBtn] }, { framework: "react" });
  assert.match(react, /npm i @brandrail\/kit/);
  assert.doesNotMatch(react, /kit\/elements/);
});

test("binding docs use camelCase properties for dashed attributes", async () => {
  const { bindingHowTo, resolveUsage: ru } = await import("../src/index.ts");
  const dp = { name: "DatePicker", importPath: "@brandrail/kit", frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-date-picker", props: [{ name: "selected-date" }, { name: "color-mode" }], events: [{ name: "br-change", detail: "date (Date | null)" }] } } };
  const ng = bindingHowTo(ru(dp, "angular")!).join("\n");
  assert.match(ng, /\[selectedDate\]="model" \(br-change\)/);
  assert.match(ng, /never `\[selected-date\]`/);
  const vue = bindingHowTo(ru(dp, "vue")!).join("\n");
  assert.match(vue, /:selectedDate="model"/);
});

test("local MCP configs start `brandrail mcp` and hold no secret", async () => {
  const { mcpLocalConfigs } = await import("../src/index.ts");
  const cfgs = mcpLocalConfigs("angular");
  const claude = JSON.parse(cfgs.find((c) => c.id === "claude-code")!.content);
  assert.deepEqual(claude.mcpServers.brandrail.args, ["-y", "brandrail", "mcp", "--framework", "angular"]);
  for (const c of cfgs) assert.doesNotMatch(c.content, /br_live|Bearer|BRANDRAIL_KEY/);
  assert.deepEqual(JSON.parse(mcpLocalConfigs("react").find((c) => c.id === "cursor")!.content).mcpServers.brandrail.args, ["-y", "brandrail", "mcp"]);
});

test("Svelte and Solid: their syntax for props and events on custom elements", () => {
  const menu = {
    name: "Menu",
    importPath: "@brandrail/kit",
    frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-menu", props: [{ name: "label", required: true }, { name: "items" }], events: [{ name: "br-select", detail: "value (string)" }] } },
  };
  const btn = { name: "Button", importPath: "@brandrail/kit", replaces: ["button"], frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-button" } } };
  const cfg = { ...starterConfig, components: [menu, btn] };
  const sv = checkSnippet(`<script>let items = [];</script>\n<br-menu label="More" {items} onbr-select={(e) => go(e.detail)}></br-menu>\n<br-menu label="x" itemz={items} onbr-selct={() => {}}></br-menu>`, "A.svelte", cfg).violations;
  assert.deepEqual(sv.map((v) => [v.line, v.message]), [
    [3, '<br-menu> has no "itemz" input'],
    [3, '<br-menu> has no "br-selct" event'],
  ]);
  assert.match(sv[1]!.suggestion!, /Listen to onbr-select=\{…\} and read e\.detail/);
  const solidCfg = { ...cfg, framework: "solid" as const };
  const so = checkSnippet(`export const A = () => <div><br-menu label="More" prop:items={list()} on:br-select={(e) => go(e.detail)} /><br-menu prop:itemz={x} /><button>Go</button></div>;`, "A.tsx", solidCfg).violations;
  assert.deepEqual(so.map((v) => v.message).sort(), ['<br-menu> has no "itemz" input', '<br-menu> is missing the required "label" input', "Raw <button> re-implements Button"].sort());
  assert.match(so.find((v) => v.ruleId === "prefer-official-component")!.suggestion!, /<br-button>/);
  const u = resolveUsage(menu, "svelte")!;
  assert.equal(u.via, "web-components");
  assert.match(bindingHowTo(u).join(" "), /onbr-select=\{\(e\) => \(value = e\.detail\)\}/);
  assert.match(bindingHowTo(resolveUsage(menu, "solid")!).join(" "), /on:br-select=\{\(e\) => setValue\(e\.detail\)\}/);
});
