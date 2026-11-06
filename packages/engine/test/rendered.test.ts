import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { checkRendered, collectRenderedNodes, isPrivateAddress, ruleTitle, type RenderedNode } from "../src/index.ts";

const tokens = {
  color: {
    fg: { default: { $type: "color", $value: "#1f2328" }, muted: { $type: "color", $value: "#59636e" } },
    canvas: { default: { $type: "color", $value: "#ffffff" } },
    action: { primary: { $type: "color", $value: "#1f883d" } },
    border: { default: { $type: "color", $value: "#d1d9e0" } },
  },
  font: { family: { sans: { $type: "fontFamily", $value: "Inter, sans-serif" } }, size: { sm: { $type: "dimension", $value: "12px" }, base: { $type: "dimension", $value: "14px" }, lg: { $type: "dimension", $value: "20px" } } },
  radius: { sm: { $type: "dimension", $value: "4px" }, md: { $type: "dimension", $value: "8px" } },
  space: { 1: { $type: "dimension", $value: "4px" }, 2: { $type: "dimension", $value: "8px" }, 3: { $type: "dimension", $value: "16px" } },
};

const node = (n: Partial<RenderedNode>): RenderedNode => ({
  selector: "div",
  tag: "div",
  color: "rgb(31, 35, 40)",
  backgroundColor: "rgba(0, 0, 0, 0)",
  effectiveBackground: "rgb(255, 255, 255)",
  fontFamily: "Inter, sans-serif",
  fontSize: 14,
  fontWeight: 400,
  radius: 0,
  minSide: 40,
  padding: [0, 0, 0, 0],
  gap: [],
  ...n,
});

test("rendered rules group findings by value", () => {
  const r = checkRendered(
    [
      {
        url: "https://acme.test/pricing?x=1",
        nodes: [
          node({ selector: "a.one", text: "Buy", color: "rgb(0, 0, 238)" }),
          node({ selector: "a.two", text: "More", color: "rgb(0, 0, 238)" }),
          node({ selector: "p.faint", text: "Fine print", color: "rgb(200, 200, 200)" }),
          node({ selector: "div.card", backgroundColor: "rgb(255, 255, 255)", borderColor: "rgb(209, 217, 224)", padding: [13, 16, 13, 16], radius: 10 }),
          node({ selector: "span.pill", radius: 9999, minSide: 20 }),
          node({ selector: "span.round", radius: 10, minSide: 20 }),
          node({ selector: "h1", text: "Hi", fontFamily: "\"Comic Sans MS\", cursive", fontSize: 30, fontWeight: 700 }),
          node({ selector: "pre", tag: "pre", text: "code", fontFamily: "Menlo, monospace" }),
          node({ selector: "p.ok", text: "ok", color: "rgb(31, 35, 40)" }),
          node({ selector: "p.overlay", text: "x", color: "rgba(31, 35, 40, 0.5)" }),
        ],
      },
    ],
    { tokens },
  );
  const by = (id: string) => r.violations.filter((v) => v.ruleId === id);
  const colors = by("no-hardcoded-color");
  assert.ok(colors.some((v) => /#0000ee isn't in the Brand Kit \(text on 2 elements\)/.test(v.message) && v.snippet === "a.one, a.two"));
  assert.ok(colors.some((v) => /#1f2328 at 50%/.test(v.message)));
  assert.equal(by("text-contrast").length, 2, "fine print, and the 50% text");
  assert.deepEqual(by("spacing-scale").map((v) => v.message), ["Spacing 13px is off the scale (1 element)"]);
  assert.deepEqual(by("radius-scale").map((v) => v.message), ["Corner radius 10px is off the scale (1 element)"], "pill and the round 20px chip are ignored");
  assert.equal(by("font-family").length, 1);
  assert.equal(by("font-size-scale").length, 1);
  assert.equal(r.violations[0]!.file, "acme.test/pricing?x=1");
  assert.ok(r.score < 100 && r.score > 0);
  assert.equal(r.linesScanned, 10);
  assert.equal(ruleTitle("text-contrast"), "Low text contrast");
  assert.equal(ruleTitle("no-hardcoded-color"), "Hard-coded colour");
});

test("private addresses are refused", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:127.0.0.1", "fe80::1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "76.76.21.21", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
});

test("collector runs in a real browser", async (t) => {
  let pw: typeof import("playwright-core");
  try {
    pw = createRequire(import.meta.url)("playwright-core") as typeof import("playwright-core");
  } catch {
    return t.skip("playwright not installed");
  }
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>>;
  try {
    browser = await pw.chromium.launch();
  } catch {
    return t.skip("no Chromium: run `npx playwright install chromium`");
  }
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body style="font-family: Inter; color:#1f2328; margin:0">
      <main class="wrap" style="padding:16px; display:flex; gap:13px">
        <button class="btn primary" style="background:#3b82f6; color:white; border-radius:10px; padding:8px 16px; border:0">Save</button>
        <p style="color:#bbb">Faint</p>
        <div style="display:none">hidden <span style="color:red">x</span></div>
        <svg width="10" height="10"><rect width="10" height="10" fill="red"/></svg>
        <a href="/about">About</a><a href="https://other.example/">Other</a>
      </main></body></html>`);
    const res = await page.evaluate(collectRenderedNodes, 500);
    const btn = res.nodes.find((n) => n.tag === "button")!;
    assert.equal(btn.selector, "main.wrap > button.btn.primary");
    assert.equal(btn.backgroundColor, "rgb(59, 130, 246)");
    assert.equal(btn.radius, 10);
    assert.deepEqual(btn.padding, [8, 16, 8, 16]);
    assert.equal(res.nodes.find((n) => n.tag === "main")!.gap.join(","), "13,13");
    assert.ok(!res.nodes.some((n) => n.text === "x"), "hidden elements are skipped");
    assert.ok(!res.nodes.some((n) => n.tag === "rect"));
    const report = checkRendered([{ url: "https://acme.test/", nodes: res.nodes }], { tokens });
    assert.ok(report.violations.some((v) => v.ruleId === "no-hardcoded-color" && /#3b82f6/.test(v.message)));
    assert.ok(report.violations.some((v) => v.ruleId === "text-contrast"));
  } finally {
    await browser.close();
  }
});

test("a blank page fails instead of scoring 100", () => {
  const r = checkRendered([{ url: "http://localhost:5173/", nodes: [] }], { tokens });
  assert.equal(r.violations[0]!.ruleId, "page-rendered");
  assert.ok(r.score < 100);
});
