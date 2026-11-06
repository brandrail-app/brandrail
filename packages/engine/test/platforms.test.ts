import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTokenDeprecations, EXPORT_FORMATS, exportTokens, tokenIdentifier } from "../src/index.ts";

const kit = applyTokenDeprecations(
  {
    color: {
      action: { primary: { $type: "color", $value: "#1f883d", $description: "One primary action\nper view", $extensions: { "dev.brandrail": { modes: { dark: "#2ea043" } } } } },
      overlay: { default: { $type: "color", $value: "#00000080" } },
      default: { $type: "color", $value: "#123456" },
      attention: { default: { $type: "color", $value: "#9a6700" } },
    },
    font: {
      family: { sans: { $type: "fontFamily", $value: "Inter, -apple-system, sans-serif" } },
      size: { base: { $type: "dimension", $value: "14px" }, "2xl": { $type: "dimension", $value: "1.5rem" } },
      "line-height": { base: { $type: "dimension", $value: "22px" } },
      weight: { "2xl": { $type: "fontWeight", $value: 600 } },
    },
    space: { "1": { $type: "dimension", $value: "4px" }, "4": { $type: "dimension", $value: "16px" } },
    radius: { md: { $type: "dimension", $value: "6px" } },
  },
  [{ path: "color.attention.default", replacement: "color.action.primary", reason: 'Say "warning"' }],
);

test("identifiers are valid in every language", () => {
  assert.equal(tokenIdentifier(["action", "primary"]), "actionPrimary");
  assert.equal(tokenIdentifier(["1"], "space"), "space1");
  assert.equal(tokenIdentifier(["2xl"]), "t2xl");
  assert.equal(tokenIdentifier(["line-height", "base"]), "lineHeightBase");
});

test("iOS: exact colours, dark variants, deprecations, scales and the type scale", () => {
  const swift = exportTokens(kit, "ios", { org: "Acme", version: "1.4.0" }).files[0]!.content;
  assert.match(swift, /public static let actionPrimary = dynamic\(rgb\(0x1F883D\), rgb\(0x2EA043\)\)/);
  assert.match(swift, /public static let overlayDefault = dynamic\(rgb\(0x000000, 0\.502\), rgb\(0x000000, 0\.502\)\)/);
  assert.match(swift, /public static let defaultToken = /, "reserved words get a suffix");
  assert.match(swift, /\/\/\/ One primary action per view\n/, "descriptions stay on one line");
  assert.match(swift, /@available\(\*, deprecated, message: "Deprecated: use color\.action\.primary\. Say \\"warning\\""\)\n    public static let attentionDefault/);
  assert.match(swift, /public static let space4: CGFloat = 16/);
  assert.match(swift, /public static let textBase = Font\.custom\("Inter", size: 14\)\.weight\(\.regular\)/);
  assert.match(swift, /public static let text2xl = Font\.custom\("Inter", size: 24\)\.weight\(\.semibold\)/, "rem converts to points");
  assert.match(swift, /public static let textBaseLineSpacing: CGFloat = 8/);
});

test("Android: ARGB colours, night resources and dp/sp dimensions", () => {
  const kt = exportTokens(kit, "compose").files[0]!.content;
  assert.match(kt, /actionPrimary = Color\(0xFF1F883D\),[\s\S]*val BrandDarkColors = BrandColors\(\n    actionPrimary = Color\(0xFF2EA043\)/);
  assert.match(kt, /overlayDefault = Color\(0x80000000\)/);
  assert.match(kt, /@Deprecated\("Deprecated: use color\.action\.primary\. Say \\"warning\\""\) val attentionDefault: Color,/);
  assert.match(kt, /val textBase = TextStyle\(fontSize = 14\.sp, lineHeight = 22\.sp, fontWeight = FontWeight\(400\)\)/);
  const xml = exportTokens(kit, "android-xml").files;
  assert.deepEqual(xml.map((f) => f.path), ["values/brand_colors.xml", "values-night/brand_colors.xml", "values/brand_dimens.xml"]);
  assert.match(xml[0]!.content, /<color name="brand_action_primary">#FF1F883D<\/color>/);
  assert.match(xml[1]!.content, /<color name="brand_action_primary">#FF2EA043<\/color>/);
  assert.match(xml[2]!.content, /<dimen name="brand_space4">16dp<\/dimen>[\s\S]*<dimen name="brand_text_base_size">14sp<\/dimen>/);
});

test("React Native and Flutter", () => {
  const rn = exportTokens(kit, "react-native").files[0]!.content;
  assert.match(rn, /export const lightColors = \{\n  actionPrimary: "#1f883d",/);
  assert.match(rn, /overlayDefault: "#00000080"/);
  assert.match(rn, /textBase: \{ fontSize: 14, lineHeight: 22, fontWeight: "400" as const, fontFamily: "Inter" \}/);
  const dart = exportTokens(kit, "flutter").files[0]!.content;
  assert.match(dart, /actionPrimary: Color\(0xFF1F883D\),[\s\S]*static const dark = BrandColors\(\n    actionPrimary: Color\(0xFF2EA043\)/);
  assert.match(dart, /@Deprecated\('Deprecated: use color\.action\.primary\. Say "warning"'\)\n  final Color attentionDefault;/);
  assert.match(dart, /static const TextStyle textBase = TextStyle\(fontSize: 14, height: 1\.571, fontWeight: FontWeight\.w400, fontFamily: 'Inter'\);/);
});

test("every format exports", () => {
  for (const f of EXPORT_FORMATS) {
    const r = exportTokens(kit, f.id);
    assert.ok(r.files.length && r.files.every((x) => x.content.length > 20), f.id);
    assert.ok(r.usage.length, `${f.id} says how to use it`);
  }
});
