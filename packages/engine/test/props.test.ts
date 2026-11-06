import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSnippet, generateInstructions, starterConfig, type BrandrailConfig } from "../src/index.ts";

const config: BrandrailConfig = {
  ...starterConfig,
  components: [
    {
      name: "Avatar",
      importPath: "@brandrail/kit",
      props: [{ name: "initials", required: true }, { name: "src" }, { name: "size" }, { name: "theme" }],
    },
    { name: "AvatarLabel", importPath: "@brandrail/kit", props: [{ name: "initials", required: true }, { name: "name", required: true }, { name: "theme" }] },
    { name: "Checkbox", importPath: "@brandrail/kit", htmlAttributes: "input", props: [{ name: "label" }, { name: "checked" }] },
    { name: "ButtonGroup", importPath: "@brandrail/kit", props: [{ name: "children", required: true }, { name: "size" }] },
    { name: "Button", importPath: "@brandrail/kit" }, // no props known: never checked
  ],
};

const ids = (code: string) => checkSnippet(code, "App.tsx", config).violations.filter((v) => v.ruleId === "component-props");

test("flags a prop the component doesn't have and points at the related component", () => {
  const v = ids(`import { Avatar } from "@brandrail/kit";\nexport const A = () => <Avatar theme="brandrail" name="Thiago Baptistella" />;`);
  assert.equal(v.length, 2); // unknown "name" + missing required "initials"
  const unknown = v.find((x) => x.message.includes('"name"'))!;
  assert.match(unknown.message, /<Avatar> has no "name" prop/);
  assert.match(unknown.suggestion!, /AvatarLabel/);
  assert.equal(unknown.line, 2);
  assert.ok(v.some((x) => /missing the required "initials"/.test(x.message)));
});

test("accepts valid props, expressions, spreads, aliases and data/aria attributes", () => {
  const code = `import { Avatar as Pic, ButtonGroup, Button } from "@brandrail/kit";
export const A = ({ user, rest }) => (
  <div>
    <Pic initials={user.name.split(" ").map((p) => p[0]).join("")} src={\`/u/\${user.id}.png\`} data-testid="pic" aria-hidden />
    <Pic {...rest} />
    <ButtonGroup size="small"><Button label="a" whatever="x" /></ButtonGroup>
  </div>
);`;
  assert.deepEqual(ids(code), []);
});

test("components extending an HTML element accept native attributes", () => {
  const v = ids(`import { Checkbox } from "@brandrail/kit";\nconst C = () => <Checkbox label="Ok" id="ok" onBlur={f} required bogus />;`);
  assert.equal(v.length, 1);
  assert.match(v[0]!.message, /"bogus"/);
});

test("ignores same-named components from other packages and self-closing children", () => {
  assert.deepEqual(ids(`import { Avatar } from "./my-avatar";\nconst A = () => <Avatar name="x" />;`), []);
  const v = ids(`import { ButtonGroup } from "@brandrail/kit";\nconst A = () => <ButtonGroup />;`);
  assert.match(v[0]!.message, /required "children"/);
});

test("instructions list each component's props", () => {
  const md = generateInstructions(config);
  assert.match(md, /`Avatar` from `@brandrail\/kit` — props: initials\*, src, size, theme/);
  assert.match(md, /Pass only the props listed/);
});
