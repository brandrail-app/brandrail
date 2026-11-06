import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { check, findTemplate, PAGE_TEMPLATES, renderTemplate, starterConfig, templateMarkdown, type BrandrailConfig, type Framework, type PropSpec } from "../src/index.ts";

const KIT = ["Button", "InputText", "InputTextArea", "Combobox", "DatePicker", "Toggle", "Checkbox", "Modal", "Tabs", "Card", "Table", "Badge", "Toast", "Menu", "Breadcrumb"];
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
// The kit's real props (packages/kit: pnpm run props), as the web app's registry gives them.
// Not in the public repo, which leaves the kit out: the tests that need it are skipped there.
const KIT_PROPS = new URL("../../kit/src/props.generated.json", import.meta.url);
const kitSkip = existsSync(KIT_PROPS) ? false : "needs packages/kit";
const kitProps = (kitSkip ? {} : JSON.parse(readFileSync(KIT_PROPS, "utf8"))) as Record<string, { props: PropSpec[] }>;
const HEADING = new Set(["Card", "Modal", "Toast"]);
const kitConfig: BrandrailConfig = {
  ...starterConfig,
  components: kitSkip ? [] : KIT.map((name) => ({
    name,
    importPath: "@brandrail/kit",
    props: kitProps[name]!.props,
    frameworks: {
      "web-components": {
        importPath: "@brandrail/kit/elements",
        tag: `br-${kebab(name)}`,
        props: kitProps[name]!.props.filter((p) => !(p.type ?? "").includes("=>")).map((p) => ({ ...p, name: p.name === "title" && HEADING.has(name) ? "heading" : kebab(p.name) })),
        events: kitProps[name]!.props.filter((p) => (p.type ?? "").includes("=>")).map((p) => ({ name: `br-${kebab(p.name.replace(/^on/, ""))}` })),
      },
    },
  })),
};
const FWS: Framework[] = ["react", "angular", "vue", "svelte", "solid", "html", "web-components"];

test("finds templates by id, alias and description words", () => {
  assert.equal(findTemplate("list")?.id, "list");
  assert.equal(findTemplate("Login")?.id, "sign-in");
  assert.equal(findTemplate("admin index page")?.id, "list");
  assert.equal(findTemplate("KPI")?.id, "dashboard");
  assert.equal(findTemplate("zzz"), undefined);
});

test("every template passes the Checker in every framework with the kit", { skip: kitSkip }, () => {
  for (const t of PAGE_TEMPLATES) {
    for (const fw of FWS) {
      const r = renderTemplate(kitConfig, t, fw);
      assert.deepEqual(r.parts.filter((p) => !p.component).map((p) => p.part), [], `${t.id}/${fw}: every part has a component`);
      const report = check(r.files.map((f) => ({ path: f.path, content: f.content })), { ...kitConfig, framework: fw });
      assert.deepEqual(report.violations.map((v) => `${v.file}:${v.line} ${v.ruleId}`), [], `${t.id}/${fw}`);
    }
  }
});

test("React uses the kit's enums, theme and typed data; state for the modal", { skip: kitSkip }, () => {
  const r = renderTemplate(kitConfig, findTemplate("detail")!, "react");
  const tsx = r.files[0]!.content;
  assert.match(tsx, /import \{ [^}]*ButtonType[^}]*\} from "@brandrail\/kit";/);
  assert.match(tsx, /type={ButtonType\.GHOST}/);
  assert.match(tsx, /theme="brandrail"/);
  assert.match(tsx, /const \[confirmOpen, setConfirmOpen\] = useState\(false\);/);
  assert.match(tsx, /onSelect=\{\(value\) => \{ if \(value === "delete"\) setConfirmOpen\(true\); \}\}/);
  const list = renderTemplate(kitConfig, findTemplate("list")!, "react").files[0]!.content;
  assert.match(list, /const columns: TableColumn\[\] = \[/);
});

test("Angular binds data and events on the custom elements, with a handler for conditional actions", { skip: kitSkip }, () => {
  const r = renderTemplate(kitConfig, findTemplate("detail")!, "angular");
  const [ts, html] = [r.files[0]!.content, r.files[1]!.content];
  assert.match(ts, /schemas: \[CUSTOM_ELEMENTS_SCHEMA\]/);
  assert.match(ts, /onMoreSelect\(value: string\) \{\n\s+if \(value === "delete"\) this\.confirmOpen = true;/);
  assert.match(html, /\[items\]="moreActions"/);
  assert.match(html, /\(br-select\)="onMoreSelect\(\$any\(\$event\)\.detail\)"/);
  assert.match(html, /<br-card heading="Summary"/);
});

test("Plain HTML loads the kit and wires state with listeners", { skip: kitSkip }, () => {
  const html = renderTemplate(kitConfig, findTemplate("form")!, "html").files[0]!.content;
  assert.match(html, /<script type="module" src="https:\/\/cdn\.jsdelivr\.net\/npm\/@brandrail\/kit@[\d.]+\/dist\/elements\.js"><\/script>/);
  assert.match(html, /<br-toast id="saved"[^>]* open="false">/);
  assert.match(html, /getElementById\("save"\)\.addEventListener\("br-click"/);
});

test("an org's own components fill the parts; missing ones get a comment, never another library", () => {
  const r = renderTemplate(starterConfig, findTemplate("sign-in")!, "react");
  const tsx = r.files[0]!.content;
  assert.match(tsx, /import \{ Button, TextInput \} from "@acme\/ui";/);
  assert.match(tsx, /<TextInput label="Email"/);
  assert.match(tsx, /\{\/\* Form: no Card in your registry for React\./);
  assert.ok(!/theme="brandrail"/.test(tsx), "kit-only props stay off other components");
  const md = templateMarkdown(starterConfig, findTemplate("sign-in")!, "react", "Acme");
  assert.match(md, /1 part has no component in the registry/);
});

test("Svelte 5: runes, properties and onbr- events; the kit loads in onMount", { skip: kitSkip }, () => {
  const [svelte] = renderTemplate(kitConfig, findTemplate("detail")!, "svelte").files;
  assert.equal(svelte!.path, "DetailPage.svelte");
  assert.match(svelte!.content, /onMount\(\(\) => \{\n  import\("@brandrail\/kit\/elements"\);\n\}\);/);
  assert.match(svelte!.content, /let confirmOpen = \$state\(false\);/);
  assert.match(svelte!.content, /<br-tabs label="Project sections" tabs=\{tabs\} selected=\{tab\} onbr-change=\{\(e: CustomEvent\) => \(tab = e\.detail\)\}>/);
  assert.match(svelte!.content, /onbr-select=\{\(e: CustomEvent\) => onMoreSelect\(e\.detail\)\}/);
  assert.match(svelte!.content, /function onMoreSelect\(value: string\) \{\n  if \(value === "delete"\) confirmOpen = true;/);
});

test("Solid: signals, prop: and on:, and a declaration for the custom elements", { skip: kitSkip }, () => {
  const files = renderTemplate(kitConfig, findTemplate("detail")!, "solid").files;
  assert.deepEqual(files.map((f) => f.path), ["DetailPage.tsx", "detail-page.css", "brandrail-elements.d.ts"]);
  const tsx = files[0]!.content;
  assert.match(tsx, /const \[confirmOpen, setConfirmOpen\] = createSignal\(false\);/);
  assert.match(tsx, /<br-modal [^>]*prop:open=\{confirmOpen\(\)\} on:br-close=\{\(\) => setConfirmOpen\(false\)\}/);
  assert.match(tsx, /<br-menu label="More" prop:items=\{moreActions\}/);
  assert.match(tsx, /onMount\(\(\) => void import\("@brandrail\/kit\/elements"\)\);/);
  assert.match(files[2]!.content, /\[tag: `br-\$\{string\}`\]: any;/);
});
