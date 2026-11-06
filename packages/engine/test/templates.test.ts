import { test } from "node:test";
import assert from "node:assert/strict";
import { check, checkSnippet, fileKind, starterConfig, type BrandrailConfig, type ComponentEntry } from "../src/index.ts";
import { fileFramework } from "../src/source.ts";

const Button: ComponentEntry = {
  name: "Button",
  importPath: "@acme/ui",
  replaces: ["button"],
  props: [{ name: "variant" }, { name: "children" }],
  frameworks: {
    angular: {
      importPath: "@acme/ui-angular",
      importName: "AcmeButtonModule",
      tag: "acme-button",
      props: [{ name: "variant" }, { name: "size" }, { name: "label", required: true }],
    },
    vue: { importPath: "@acme/ui-vue", importName: "AcmeButton", tag: "AcmeButton", props: [{ name: "variant" }, { name: "modelValue" }] },
    "web-components": { importPath: "@acme/wc/button.js", tag: "acme-wc-button", props: [{ name: "variant" }, { name: "full-width" }] },
  },
};
const Chart: ComponentEntry = { name: "Chart", importPath: "@acme/ui", replaces: ["canvas"] };

const config: BrandrailConfig = { ...starterConfig, components: [Button, Chart] };
const run = (code: string, file: string, cfg: BrandrailConfig = config) => checkSnippet(code, file, cfg).violations;
const rule = (code: string, file: string, id: string, cfg?: BrandrailConfig) => run(code, file, cfg).filter((v) => v.ruleId === id);

test("template files are scanned", () => {
  for (const f of ["a.mustache", "a.hbs", "a.handlebars", "a.php", "views/a.blade.php", "a.phtml", "a.html.twig", "a.njk", "a.liquid"]) {
    assert.equal(fileKind(f), "template", f);
  }
  assert.equal(fileKind("a.component.html"), "html");
});

test("each file gets the right framework", () => {
  assert.equal(fileFramework("src/app/a.component.html", "html", "<div></div>"), "angular");
  assert.equal(fileFramework("src/a.html", "html", '<div *ngIf="x"></div>'), "angular");
  assert.equal(fileFramework("src/a.html", "html", "<div>@if (x) {}</div>"), "angular");
  assert.equal(fileFramework("index.html", "html", "<div></div>"), "html");
  assert.equal(fileFramework("index.html", "html", "<div></div>", "angular"), "angular");
  assert.equal(fileFramework("a.component.ts", "jsx", "@Component({ selector: 'x', template: `<b></b>` })"), "angular");
  assert.equal(fileFramework("a.tsx", "jsx", "<b/>", "angular"), "react");
  assert.equal(fileFramework("a.vue", "vue", ""), "vue");
  assert.equal(fileFramework("a.twig", "template", ""), "html");
});

test("Angular template: raw <button> points at the Angular selector, not a React import", () => {
  const [v] = rule(`<button (click)="save()">Save</button>`, "src/app/form.component.html", "prefer-official-component");
  assert.ok(v);
  assert.match(v.suggestion!, /Use <acme-button> \(import \{ AcmeButtonModule \} from "@acme\/ui-angular";\)/);
});

test("Angular inline template in a .component.ts", () => {
  const code = `@Component({\n  selector: 'app-form',\n  template: \`<div>\n  <button type="submit">Go</button>\n</div>\`,\n})\nexport class FormComponent {}`;
  const [v] = rule(code, "src/app/form.component.ts", "prefer-official-component");
  assert.equal(v?.line, 4);
  assert.match(v!.suggestion!, /acme-button/);
});

test("no version for the framework → no finding (instead of a useless React import)", () => {
  assert.equal(rule(`<canvas></canvas>`, "src/app/chart.component.html", "prefer-official-component").length, 0);
  assert.equal(rule(`<canvas></canvas>`, "src/Chart.tsx", "prefer-official-component").length, 1);
});

test("the component's own implementation may use the raw element", () => {
  const code = `@Component({ selector: 'acme-button', template: '<button><ng-content></ng-content></button>' })\nexport class AcmeButtonComponent {}`;
  assert.equal(rule(code, "lib/button.component.ts", "prefer-official-component").length, 0);
});

test("web component covers plain HTML, PHP, Twig and Mustache", () => {
  for (const f of ["index.html", "views/a.php", "templates/a.html.twig", "a.mustache"]) {
    const [v] = rule(`<form><button>Send</button></form>`, f, "prefer-official-component");
    assert.ok(v, f);
    assert.match(v.suggestion!, /Use <acme-wc-button>/, f);
  }
});

test("Angular style bindings and [ngStyle] are checked", () => {
  const html = [
    `<div [style.padding.px]="13"></div>`,
    `<div [style.margin]="'7px'"></div>`,
    `<div [ngStyle]="{'padding': '13px', 'border-radius': '5px', 'font-family': 'Comic Sans MS'}"></div>`,
    `<div [ngStyle]="{'gap.px': 9}"></div>`,
    `<div [style.border-radius.px]="5"></div>`,
    `<div [style.padding.px]="16" [style.padding]="pad"></div>`,
    `<div [style.color]="'#ff00aa'"></div>`,
  ].join("\n");
  const vs = run(html, "src/app/card.component.html");
  const at = (id: string) => vs.filter((v) => v.ruleId === id).map((v) => v.line);
  assert.deepEqual(at("spacing-scale"), [1, 2, 3, 4]);
  assert.deepEqual(at("radius-scale"), [3, 5]);
  assert.deepEqual(at("font-family"), [3]);
  assert.deepEqual(at("no-hardcoded-color"), [7]);
});

test("Vue :style objects with quoted keys and camelCase string values", () => {
  const vue = `<template>\n  <div :style="{ 'padding-top': '13px' }"></div>\n  <div :style="{ paddingLeft: '7px' }"></div>\n  <div :style="{ padding: '16px' }"></div>\n</template>`;
  assert.deepEqual(rule(vue, "Card.vue", "spacing-scale").map((v) => v.line), [2, 3]);
});

test("template comments are ignored", () => {
  const twig = `{# <button style="padding: 13px">old</button> #}\n<p>ok</p>`;
  const hbs = `{{!-- <button>old</button> --}}\n{{! <button>x</button> }}\n<p>{{name}}</p>`;
  const php = `<?php // echo '<button style="padding:13px">'; ?>\n<?php /* <button> */ ?>\n<p><?= $x ?></p>`;
  const blade = `{{-- <button>old</button> --}}\n<p>{{ $x }}</p>`;
  for (const [code, f] of [[twig, "a.twig"], [hbs, "a.hbs"], [php, "a.php"], [blade, "a.blade.php"]] as const) {
    assert.equal(run(code, f).length, 0, f);
  }
});

test("PHP and Twig markup is still checked around template tags", () => {
  const php = `<div class="card" style="padding: 13px; color: #ff00aa"><?php if ($ok): ?><button <?= $attrs ?>>Go</button><?php endif; ?></div>`;
  const ids = run(php, "card.php").map((v) => v.ruleId).sort();
  assert.deepEqual(ids, ["no-hardcoded-color", "prefer-official-component", "spacing-scale"]);
  const twig = `{% for item in items %}<img src="{{ item.src }}">{% endfor %}`;
  assert.deepEqual(run(twig, "list.html.twig").map((v) => v.ruleId), ["img-alt"]);
});

test("Angular inputs: unknown and missing, events and directives allowed", () => {
  const ok = `<acme-button label="Save" [variant]="'primary'" size="sm" (click)="go()" *ngIf="show" #btn class="x" [attr.aria-label]="l" [class.on]="a" [style.width.px]="10" data-id="1"></acme-button>`;
  assert.deepEqual(rule(ok, "a.component.html", "component-props"), []);
  const bad = `<acme-button [colour]="'red'" [(open)]="x"></acme-button>`;
  const vs = rule(bad, "a.component.html", "component-props");
  assert.deepEqual(vs.map((v) => v.message), ['<acme-button> is missing the required "label" input', '<acme-button> has no "colour" input', '<acme-button> has no "open" input']);
});

test("Vue props: PascalCase and kebab-case tags, v-model counts as modelValue", () => {
  const vue = `<template>\n  <AcmeButton variant="primary" v-model="x" @click="go" />\n  <acme-button :tone="t" />\n</template>`;
  const vs = rule(vue, "A.vue", "component-props");
  assert.deepEqual(vs.map((v) => [v.line, v.message]), [[3, '<AcmeButton> has no "tone" input']]);
});

test("web component attributes: kebab and camel match", () => {
  const html = `<acme-wc-button variant="primary" fullWidth></acme-wc-button><acme-wc-button full-width size="lg"></acme-wc-button>`;
  assert.deepEqual(rule(html, "index.html", "component-props").map((v) => v.message), ['<acme-wc-button> has no "size" input']);
});

test("React files keep the React behaviour", () => {
  const tsx = `import { Button } from "@acme/ui";\nexport const A = () => <><Button variant="x" colour="red">Hi</Button><button>raw</button></>;`;
  const vs = run(tsx, "A.tsx");
  assert.ok(vs.some((v) => v.ruleId === "component-props" && /colour/.test(v.message)));
  assert.ok(vs.some((v) => v.ruleId === "prefer-official-component" && v.suggestion === 'import { Button } from "@acme/ui"'));
});

test("project framework from the config applies to plain .html", () => {
  const cfg = { ...config, framework: "angular" as const };
  const r = check([{ path: "src/app/legacy/form.html", content: "<button>Go</button>" }], cfg);
  assert.match(r.violations[0]!.suggestion!, /acme-button/);
});

test("inline style attributes stop at the attribute's end", () => {
  const html = `<p style="font-family: Papyrus">a</p><div style="margin: 8px"><span>20px wide</span></div>`;
  const vs = run(html, "a.html");
  assert.deepEqual(vs.map((v) => [v.ruleId, v.message]), [["font-family", 'Font "papyrus" is not in the Brand Kit']]);
  assert.deepEqual(rule(`const s = { padding: "13px", margin: '8px' };`, "a.tsx", "spacing-scale").map((v) => v.message), ["padding 13px is off the spacing scale"]);
});

const Input: ComponentEntry = {
  name: "InputText",
  importPath: "@acme/ui",
  replaces: ["input"],
  frameworks: {
    "web-components": {
      importPath: "@acme/elements",
      tag: "acme-input-text",
      props: [{ name: "label" }, { name: "value" }],
      events: [{ name: "acme-change", detail: "the new value (string)" }],
    },
  },
};
const evConfig: BrandrailConfig = { ...starterConfig, components: [Input] };

test("events on custom elements: wrong event names are caught, native and declared ones pass", () => {
  const ok = `<acme-input-text label="ID" [value]="id" (acme-change)="id = $any($event).detail" (click)="x()" (keydown.enter)="go()"></acme-input-text>`;
  assert.deepEqual(rule(ok, "a.component.html", "component-props", evConfig), []);
  const [v] = rule(`<acme-input-text label="ID" (change)="id = $event.target.value"></acme-input-text>`, "a.component.html", "component-props", evConfig);
  assert.equal(v?.message, '<acme-input-text> has no "change" event');
  assert.match(v!.suggestion!, /\(acme-change\).*\$any\(\$event\)\.detail/);
  const [vue] = rule(`<template><acme-input-text label="ID" @input="x" /></template>`, "A.vue", "component-props", evConfig);
  assert.match(vue!.suggestion!, /@acme-change/);
});

test("AI docs explain Angular binding for custom elements", async () => {
  const { generateInstructions } = await import("../src/index.ts");
  const md = generateInstructions(evConfig, { framework: "angular" });
  assert.match(md, /`<acme-input-text>` `acme-change`/);
  assert.match(md, /\$any\(\$event\)\.detail/);
  assert.match(md, /\[value\]="model" \(acme-change\)="model = \$any\(\$event\)\.detail"/);
  assert.match(md, /module federation/);
  const vue = generateInstructions(evConfig, { framework: "vue" });
  assert.match(vue, /@acme-change="model = \$event\.detail"/);
});

test("binding a kebab-case name on a custom element is caught", () => {
  const cfg: BrandrailConfig = {
    ...starterConfig,
    components: [{ name: "DatePicker", importPath: "@k", frameworks: { "web-components": { importPath: "@k/el", tag: "br-date-picker", props: [{ name: "selected-date" }, { name: "color-mode" }] } } }],
  };
  assert.deepEqual(rule(`<br-date-picker color-mode="dark" [selectedDate]="d" [attr.color-mode]="m"></br-date-picker>`, "a.component.html", "component-props", cfg), []);
  const [v] = rule(`<br-date-picker [selected-date]="d"></br-date-picker>`, "a.component.html", "component-props", cfg);
  assert.match(v!.suggestion!, /\[selectedDate\]/);
  const [vue] = rule(`<template><br-date-picker :selected-date="d" /></template>`, "A.vue", "component-props", cfg);
  assert.match(vue!.suggestion!, /:selectedDate/);
});
