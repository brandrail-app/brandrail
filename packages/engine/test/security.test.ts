import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSnippet, EXPORT_FORMATS, exportTokens, findLegacyUsages, flattenTokens, generateTokensCss, importTokens, makeIgnore, mergeTokens, starterConfig, type BrandrailConfig } from "../src/index.ts";

/** Each attack must finish fast; a catastrophic regex would take seconds to minutes. */
const fast = (label: string, fn: () => unknown, ms = 500) => {
  const t = Date.now();
  fn();
  assert.ok(Date.now() - t < ms, `${label} took ${Date.now() - t}ms`);
};
const evil = (n = 40) => `${"a".repeat(n)}!`;

test("import aliases from the checked code can't hang the checker", () => {
  const config: BrandrailConfig = {
    ...starterConfig,
    components: [
      { name: "Avatar", importPath: "@brandrail/kit", props: [{ name: "initials", required: true }] },
      { name: "OldCard", importPath: "@brandrail/kit", deprecated: { replacement: "Card" } } as never,
    ],
  };
  for (const alias of ["(a+)+", "(a|a)*", "a(", "[", "(?<x>a)+\\1"]) {
    const code = `import { Button as ${alias} } from "@mui/material";\nimport { Avatar as ${alias}, OldCard as ${alias} } from "@brandrail/kit";\n<${evil()}\n`;
    fast(`legacy ${alias}`, () => findLegacyUsages(code, "jsx"));
    fast(`check ${alias}`, () => checkSnippet(code, "App.tsx", config));
  }
  // Real aliases still work.
  assert.equal(findLegacyUsages(`import { Button as MuiButton } from "@mui/material";\n<MuiButton />`, "jsx").length, 1);
});

test("ignore globs match in linear time and keep their meaning", () => {
  fast("globstar chain", () => makeIgnore(["**a**a**a**a**a**a**a**a**a**a"])(evil(3000)));
  fast("star chain", () => makeIgnore(["*a*a*a*a*a*a*a*a*a*a*a*a*b"])("a".repeat(3000)));
  fast("unclosed brace", () => makeIgnore(["src/{legacy"])("src/{legacy"));
  const ig = makeIgnore(["**/node_modules/**", "src/{legacy,old}/**", "*.min.{js,css}", "src/**/*.test.ts"]);
  for (const [p, want] of [["a/node_modules/x.js", true], ["src/old/x.tsx", true], ["a.min.css", true], ["src/a/b.test.ts", true], ["src/a.tsx", false], ["src/new/x.tsx", false]] as const) assert.equal(ig(p), want, p);
});

test("token files can't pollute Object.prototype", () => {
  const payload = JSON.parse('{"__proto__":{"polluted":{"$value":"1"}},"constructor":{"prototype":{"polluted2":{"$value":"2"}}},"color":{"ok":{"$type":"color","$value":"#112233"}}}');
  const merged = mergeTokens({}, payload);
  importTokens(payload);
  flattenTokens(payload);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted2, undefined);
  assert.ok(JSON.stringify(merged).includes("#112233"));
});

const hostile = {
  color: {
    primary: { $type: "color", $value: "#1f883d", $description: "Primary */ ; } <!-- --> \n injected = true // \u2028 `${x}`" },
    "bad;}{": { $type: "color", $value: "#000000" },
  },
  font: {
    family: {
      sans: { $type: "fontFamily", $value: 'Inter")\nstatic let pwned = 1\n//' },
      body: { $type: "fontFamily", $value: "Inter, sans-serif" },
    },
    size: { base: { $type: "dimension", $value: "14px" } },
  },
  space: { "4": { $type: "dimension", $value: "16px;}body{display:none" }, "2": { $type: "dimension", $value: "8px" } },
  shadow: { x: { $type: "shadow", $value: "0 0 1px red} @import url(//evil.example/x.css);" } },
};

test("Brand Kit values can't inject code into any export", () => {
  for (const f of EXPORT_FORMATS) {
    const out = exportTokens(hostile, f.id, { org: "Acme */\n<!-- evil", version: "1.0.0\n// x" }).files.map((x) => x.content).join("\n");
    if (f.id === "json") {
      JSON.parse(out); // data, not code: JSON escapes it
      continue;
    }
    const code = out.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/.*$/gm, "");
    assert.ok(!/pwned|injected|@import|display:none|evil\.example|bad;\}/.test(code), `${f.id} leaked outside a comment:\n${code}`);
    assert.ok(!/\u2028/.test(out), `${f.id} has a line separator`);
    const comments = out.match(/\/\*[\s\S]*?\*\//g) ?? [];
    for (const c of comments) assert.ok(!c.slice(2, -2).includes("*/"), `${f.id} comment breaks out: ${c}`);
    if (f.id === "android-xml") assert.ok(!/<!--(?:(?!-->)[\s\S])*--(?!>)/.test(out), "XML comment contains --");
  }
  const css = generateTokensCss(hostile, { org: "Acme */ body{}" });
  assert.match(css, /--color-primary: #1f883d;/, "safe tokens still export");
  assert.match(css, /--font-family-body: Inter, sans-serif;/);
  assert.match(css, /--space-2: 8px;/);
  assert.ok(!/display:none|@import|body\{\}|pwned/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  assert.equal(css.match(/\*\//g)?.length, 1, "the header comment is closed exactly once");
});

test("exports keep working for an ordinary kit", () => {
  const swift = exportTokens({ font: { family: { sans: { $type: "fontFamily", $value: "Inter, sans-serif" } }, size: { base: { $type: "dimension", $value: "14px" } } } }, "ios").files[0]!.content;
  assert.match(swift, /Font\.custom\("Inter", size: 14\)/);
});
