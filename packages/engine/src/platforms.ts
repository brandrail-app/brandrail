/**
 * The Brand Kit for every platform, from the same DTCG tokens: CSS, Tailwind and JSON for the web, and native files
 * for iOS (SwiftUI), Android (Jetpack Compose or XML resources), React Native and Flutter.
 *
 * Every export carries light and dark colours (dark follows the system setting), the spacing and radius scales, and
 * the type scale as ready-made text styles, so a mobile screen uses the same names as the web: color.action.primary
 * is BrandColor.actionPrimary in Swift, BrandTheme.colors.actionPrimary in Compose, colors.actionPrimary in React Native.
 */
import { flattenTokens, type FlatToken } from "./tokens.ts";
import { tokenDeprecations } from "./governance.ts";
import { generateTokensCss } from "./tokens-css.ts";

export type ExportFormat = "css" | "tailwind" | "json" | "ios" | "compose" | "android-xml" | "react-native" | "flutter";

export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; platform: "web" | "mobile"; description: string }> = [
  { id: "css", label: "CSS variables", platform: "web", description: "One variable per token, dark mode included" },
  { id: "tailwind", label: "Tailwind v4", platform: "web", description: "@theme mapping onto the CSS variables" },
  { id: "json", label: "DTCG JSON", platform: "web", description: "The W3C design tokens file" },
  { id: "ios", label: "iOS (SwiftUI)", platform: "mobile", description: "Color, spacing, radius and Font extensions; dark mode follows the system" },
  { id: "compose", label: "Android (Compose)", platform: "mobile", description: "Kotlin: colour schemes for light and dark, dp and sp scales, TextStyles" },
  { id: "android-xml", label: "Android (XML)", platform: "mobile", description: "colors.xml with a values-night copy, and dimens.xml" },
  { id: "react-native", label: "React Native", platform: "mobile", description: "A typed module with light and dark colours and a useBrandColors hook" },
  { id: "flutter", label: "Flutter", platform: "mobile", description: "A ThemeExtension for colours, plus spacing, radius and TextStyles" },
];

export interface ExportedFile {
  path: string;
  content: string;
}

export interface PlatformExport {
  format: ExportFormat;
  files: ExportedFile[];
  /** How to use it, one step per line. */
  usage: string[];
}

/* ───────── Reading the tokens into platform-neutral groups ───────── */

interface Groups {
  colors: Array<{ name: string; path: string; light: Rgba; dark: Rgba; description?: string; deprecated?: string }>;
  spacing: Array<{ name: string; path: string; px: number }>;
  radius: Array<{ name: string; path: string; px: number }>;
  type: Array<{ name: string; size: number; lineHeight?: number; weight: number }>;
  fonts: Array<{ name: string; path: string; family: string | null; stack: string }>;
  other: Array<{ name: string; path: string; px: number }>;
}

type Rgba = { r: number; g: number; b: number; a: number };

const hexToRgba = (hex: string): Rgba | null => {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] ? Number.parseInt(m[2], 16) / 255 : 1 };
};

const px = (v: string): number | null => {
  const m = /^(-?\d*\.?\d+)(px|rem|em)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "rem" || m[2] === "em" ? n * 16 : n;
};

/** color.action.primary → actionPrimary; space.4 → space4; font.size.2xl → fontSize2xl. */
export function tokenIdentifier(segments: string[], prefix?: string): string {
  const words = [...(prefix ? [prefix] : []), ...segments].flatMap((s) => s.split(/[^A-Za-z0-9]+/)).filter(Boolean);
  const id = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join("");
  return /^[0-9]/.test(id) ? `t${id}` : id || "token";
}

const GENERIC = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-serif|ui-monospace|sfmono-regular|segoe ui|roboto|helvetica|helvetica neue|arial|noto sans|sans-serif|serif|monospace|menlo|consolas)$/i;

/** The first family that isn't a system font, which the app has to bundle; null means the platform's own font. */
function bundledFamily(stack: string): string | null {
  for (const raw of stack.split(",")) {
    const f = raw.trim().replace(/^["']|["']$/g, "");
    if (f && !GENERIC.test(f)) return /^[\p{L}\p{N} ._&-]{1,80}$/u.test(f) ? f : null; // goes into string literals in four languages
  }
  return null;
}

/** Words Swift, Kotlin, Dart or TypeScript won't take as a name. */
const RESERVED = new Set(
  "as break case catch class const continue default do else enum extends extension false final for fun func if import in interface is let new null object operator package private protocol public return static struct super switch this throw true try type typealias val var void when where while with yield".split(" "),
);

function groups(tokens: unknown): Groups {
  const flat = flattenTokens(tokens);
  const deprecated = new Map(tokenDeprecations(tokens).map((d) => [d.path, d]));
  const g: Groups = { colors: [], spacing: [], radius: [], type: [], fonts: [], other: [] };
  const sizes = new Map<string, number>();
  const lines = new Map<string, number>();
  const weights = new Map<string, number>();
  const used = new Set<string>();
  const unique = (raw: string) => {
    const id = RESERVED.has(raw) ? `${raw}Token` : raw;
    let out = id;
    for (let i = 2; used.has(out); i++) out = `${id}${i}`;
    used.add(out);
    return out;
  };
  for (const t of flat) {
    const seg = t.path.split(".");
    if (t.type === "color") {
      const light = hexToRgba(t.value);
      if (!light) continue;
      const d = deprecated.get(t.path);
      g.colors.push({
        name: unique(tokenIdentifier(seg[0] === "color" ? seg.slice(1) : seg)),
        path: t.path,
        light,
        dark: (t.dark && hexToRgba(t.dark)) || light,
        description: commentText(t.description) || undefined,
        deprecated: d ? commentText(`Deprecated${d.replacement ? `: use ${d.replacement}` : ""}${d.removeAfter ? ` (removed after ${d.removeAfter})` : ""}${d.reason ? `. ${d.reason}` : ""}`) : undefined,
      });
    } else if (t.path.startsWith("font.size.")) {
      const v = px(t.value);
      if (v !== null) sizes.set(seg.slice(2).join("."), v);
    } else if (t.path.startsWith("font.line-height.")) {
      const v = px(t.value);
      if (v !== null) lines.set(seg.slice(2).join("."), v);
    } else if (t.path.startsWith("font.weight.") || t.type === "fontWeight") {
      const v = Number.parseInt(t.value, 10);
      if (Number.isFinite(v)) weights.set(seg.slice(2).join("."), v);
    } else if (t.type === "fontFamily" || t.path.startsWith("font.family.")) {
      g.fonts.push({ name: unique(tokenIdentifier(seg.slice(2).length ? seg.slice(2) : seg)), path: t.path, family: bundledFamily(t.value), stack: t.value });
    } else if (/^(space|spacing)\./.test(t.path)) {
      const v = px(t.value);
      if (v !== null && !/\.unit$/.test(t.path)) g.spacing.push({ name: unique(tokenIdentifier(seg.slice(1), "space")), path: t.path, px: v });
    } else if (/^(radius|radii)\./.test(t.path)) {
      const v = px(t.value);
      if (v !== null) g.radius.push({ name: unique(tokenIdentifier(seg.slice(1), "radius")), path: t.path, px: Math.min(v, 9999) });
    } else if (t.type === "dimension" || t.type === "number") {
      const v = px(t.value);
      if (v !== null) g.other.push({ name: unique(tokenIdentifier(seg)), path: t.path, px: v });
    }
  }
  for (const [step, size] of sizes) {
    g.type.push({ name: unique(tokenIdentifier(step.split("."), "text")), size, lineHeight: lines.get(step), weight: weights.get(step) ?? 400 });
  }
  g.type.sort((a, b) => a.size - b.size);
  return g;
}

/* ───────── Number formatting ───────── */

const num = (n: number, places = 2) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10 ** places) / 10 ** places));
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0").toUpperCase();
/** 0xAARRGGBB, the order Android and Flutter use. */
const argb = (c: Rgba) => `0x${hex2(c.a * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
const rgbHex = (c: Rgba) => `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ""}`.toLowerCase();
const head = (comment: string, opts: ExportOptions) => {
  const org = commentText(opts.org);
  const version = /^\d+\.\d+\.\d+$/.test(opts.version ?? "") ? opts.version : "";
  return `${comment} Generated by Brandrail from the ${org ? `${org} ` : ""}Brand Kit${version ? ` v${version}` : ""}. Do not edit: run \`npx brandrail export\` to update.`;
};

/**
 * Text from the Brand Kit that goes into a comment or a string in generated code: one line, no characters that
 * end a comment or a string in Swift, Kotlin, Dart, TypeScript, CSS or XML, at most 300 characters.
 */
/** XML comments can't contain `--` at all. */
const xmlComment = (text: string) => text.replace(/-{2,}/g, "-").replace(/-$/, "");

export function commentText(text: string | undefined): string {
  return (text ?? "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\*\/|\/\*|<!--|-->/g, " ")
    .replace(/[\\`$]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface ExportOptions {
  org?: string;
  version?: string;
}

/* ───────── iOS (SwiftUI) ───────── */

function swift(g: Groups, o: ExportOptions): PlatformExport {
  const ui = (c: Rgba) => `rgb(0x${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? `, ${num(c.a, 3)}` : ""})`;
  const font = g.fonts[0];
  const lines = [
    head("//", o),
    "import SwiftUI",
    "#if canImport(UIKit)",
    "import UIKit",
    "",
    "private func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> UIColor {",
    "    UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)",
    "}",
    "",
    "private func dynamic(_ light: UIColor, _ dark: UIColor) -> Color {",
    "    Color(UIColor { $0.userInterfaceStyle == .dark ? dark : light })",
    "}",
    "",
    "/// Brand colours. Each one switches with the system's light or dark appearance.",
    "public enum BrandColor {",
    ...g.colors.flatMap((c) => [
      ...(c.description ? [`    /// ${c.description}`] : []),
      ...(c.deprecated ? [`    @available(*, deprecated, message: ${JSON.stringify(c.deprecated)})`] : []),
      `    public static let ${c.name} = dynamic(${ui(c.light)}, ${ui(c.dark)})`,
    ]),
    "}",
    "#endif",
    "",
    "/// Spacing scale in points. Padding, margins and stack spacing use these.",
    "public enum BrandSpacing {",
    ...g.spacing.map((s) => `    public static let ${s.name}: CGFloat = ${num(s.px)}`),
    "}",
    "",
    "/// Corner radius scale in points.",
    "public enum BrandRadius {",
    ...g.radius.map((r) => `    public static let ${r.name}: CGFloat = ${num(r.px)}`),
    "}",
    "",
    `/// The type scale${font?.family ? `, in ${font.family} (add the font files to the app and Info.plist)` : " in the system font"}.`,
    "public enum BrandFont {",
    ...g.type.map((t) => {
      const w = t.weight >= 700 ? ".bold" : t.weight >= 600 ? ".semibold" : t.weight >= 500 ? ".medium" : t.weight <= 300 ? ".light" : ".regular";
      return font?.family
        ? `    public static let ${t.name} = Font.custom("${font.family}", size: ${num(t.size)}).weight(${w})`
        : `    public static let ${t.name} = Font.system(size: ${num(t.size)}, weight: ${w})`;
    }),
    "",
    "    /// Extra space between lines for each step (line height minus font size), for .lineSpacing().",
    ...g.type.filter((t) => t.lineHeight).map((t) => `    public static let ${t.name}LineSpacing: CGFloat = ${num(Math.max(0, t.lineHeight! - t.size))}`),
    "}",
    "",
  ];
  return {
    format: "ios",
    files: [{ path: "BrandTokens.swift", content: lines.join("\n") }],
    usage: [
      "Add BrandTokens.swift to the app target.",
      "Use the names in views: .foregroundStyle(BrandColor.fgDefault), .padding(BrandSpacing.space4), .font(BrandFont.textBase).",
      "Dark mode follows the system appearance automatically.",
    ],
  };
}

/* ───────── Android: Jetpack Compose ───────── */

function compose(g: Groups, o: ExportOptions, pkg = "com.brand.tokens"): PlatformExport {
  const weight = (w: number) => `FontWeight(${Math.round(w / 100) * 100})`;
  const font = g.fonts[0];
  const content = [
    head("//", o),
    `package ${pkg}`,
    "",
    "import androidx.compose.foundation.isSystemInDarkTheme",
    "import androidx.compose.runtime.Composable",
    "import androidx.compose.runtime.Immutable",
    "import androidx.compose.runtime.ReadOnlyComposable",
    "import androidx.compose.runtime.staticCompositionLocalOf",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.text.TextStyle",
    "import androidx.compose.ui.text.font.FontWeight",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.sp",
    "",
    "/** Brand colours. Read them with BrandTheme.colors, which follows the system's dark theme. */",
    "@Immutable",
    "data class BrandColors(",
    ...g.colors.map((c) => `    ${c.deprecated ? `@Deprecated(${JSON.stringify(c.deprecated).replace(/\$/g, "\\$")}) ` : ""}val ${c.name}: Color,`),
    ")",
    "",
    "val BrandLightColors = BrandColors(",
    ...g.colors.map((c) => `    ${c.name} = Color(${argb(c.light)}),`),
    ")",
    "",
    "val BrandDarkColors = BrandColors(",
    ...g.colors.map((c) => `    ${c.name} = Color(${argb(c.dark)}),`),
    ")",
    "",
    "val LocalBrandColors = staticCompositionLocalOf { BrandLightColors }",
    "",
    "object BrandTheme {",
    "    val colors: BrandColors",
    "        @Composable @ReadOnlyComposable get() = LocalBrandColors.current",
    "}",
    "",
    "/** Picks light or dark colours from the system setting. Wrap the app (or a screen) in it. */",
    "@Composable",
    "fun brandColors(darkTheme: Boolean = isSystemInDarkTheme()): BrandColors = if (darkTheme) BrandDarkColors else BrandLightColors",
    "",
    "/** Spacing scale. Padding, margins and Arrangement.spacedBy use these. */",
    "object BrandSpacing {",
    ...g.spacing.map((s) => `    val ${s.name} = ${num(s.px)}.dp`),
    "}",
    "",
    "/** Corner radius scale: RoundedCornerShape(BrandRadius.radiusMd). */",
    "object BrandRadius {",
    ...g.radius.map((r) => `    val ${r.name} = ${num(r.px)}.dp`),
    "}",
    "",
    `/** The type scale${font?.family ? `. Set fontFamily to ${font.family} once it's in res/font` : ""}. */`,
    "object BrandType {",
    ...g.type.map((t) => `    val ${t.name} = TextStyle(fontSize = ${num(t.size)}.sp${t.lineHeight ? `, lineHeight = ${num(t.lineHeight)}.sp` : ""}, fontWeight = ${weight(t.weight)})`),
    "}",
    "",
  ].join("\n");
  return {
    format: "compose",
    files: [{ path: "BrandTokens.kt", content }],
    usage: [
      `Add BrandTokens.kt to the app module (package ${pkg}; change it to yours).`,
      "Provide the colours once: CompositionLocalProvider(LocalBrandColors provides brandColors()) { App() }",
      "Then use BrandTheme.colors.actionPrimary, Modifier.padding(BrandSpacing.space4), BrandType.textBase.",
    ],
  };
}

/* ───────── Android: XML resources ───────── */

function androidXml(g: Groups, o: ExportOptions): PlatformExport {
  const res = (id: string) => `brand_${id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`;
  const color = (c: Rgba) => `#${hex2(c.a * 255)}${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const xml = (body: string[]) => [`<?xml version="1.0" encoding="utf-8"?>`, `<!-- ${xmlComment(head("", o).trim())} -->`, "<resources>", ...body, "</resources>", ""].join("\n");
  return {
    format: "android-xml",
    files: [
      { path: "values/brand_colors.xml", content: xml(g.colors.map((c) => `    <color name="${res(c.name)}">${color(c.light)}</color>${c.deprecated ? ` <!-- ${xmlComment(c.deprecated)} -->` : ""}`)) },
      { path: "values-night/brand_colors.xml", content: xml(g.colors.map((c) => `    <color name="${res(c.name)}">${color(c.dark)}</color>`)) },
      {
        path: "values/brand_dimens.xml",
        content: xml([
          ...g.spacing.map((s) => `    <dimen name="${res(s.name)}">${num(s.px)}dp</dimen>`),
          ...g.radius.map((r) => `    <dimen name="${res(r.name)}">${num(r.px)}dp</dimen>`),
          ...g.type.map((t) => `    <dimen name="${res(t.name)}_size">${num(t.size)}sp</dimen>`),
          ...g.type.filter((t) => t.lineHeight).map((t) => `    <dimen name="${res(t.name)}_line_height">${num(t.lineHeight!)}sp</dimen>`),
        ]),
      },
    ],
    usage: [
      "Copy the three files into app/src/main/res/ (values-night switches the colours in dark mode).",
      "Use them as @color/brand_action_primary and @dimen/brand_space4 in layouts, or R.color.brand_action_primary in code.",
    ],
  };
}

/* ───────── React Native ───────── */

function reactNative(g: Groups, o: ExportOptions): PlatformExport {
  const font = g.fonts[0];
  const obj = (pairs: Array<[string, string]>, pad = "  ") => pairs.map(([k, v]) => `${pad}${k}: ${v},`).join("\n");
  const content = [
    head("//", o),
    'import { useColorScheme } from "react-native";',
    "",
    "/** Brand colours in light mode. */",
    `export const lightColors = {\n${obj(g.colors.map((c) => [c.name, JSON.stringify(rgbHex(c.light))]))}\n} as const;`,
    "",
    "/** Brand colours in dark mode. */",
    `export const darkColors: { [K in keyof typeof lightColors]: string } = {\n${obj(g.colors.map((c) => [c.name, JSON.stringify(rgbHex(c.dark))]))}\n};`,
    "",
    "export type BrandColors = { [K in keyof typeof lightColors]: string };",
    "",
    "/** The colours for the system's light or dark appearance. */",
    "export function useBrandColors(): BrandColors {",
    '  return useColorScheme() === "dark" ? darkColors : lightColors;',
    "}",
    "",
    "/** Spacing scale, for padding, margin and gap. */",
    `export const spacing = {\n${obj(g.spacing.map((s) => [s.name, num(s.px)]))}\n} as const;`,
    "",
    "/** Corner radius scale, for borderRadius. */",
    `export const radius = {\n${obj(g.radius.map((r) => [r.name, num(r.px)]))}\n} as const;`,
    "",
    `/** The type scale as Text styles${font?.family ? ` (${font.family} must be linked into the app)` : ""}. */`,
    `export const type = {\n${obj(
      g.type.map((t) => [
        t.name,
        `{ ${[`fontSize: ${num(t.size)}`, ...(t.lineHeight ? [`lineHeight: ${num(t.lineHeight)}`] : []), `fontWeight: "${Math.round(t.weight / 100) * 100}" as const`, ...(font?.family ? [`fontFamily: ${JSON.stringify(font.family)}`] : [])].join(", ")} }`,
      ]),
    )}\n} as const;`,
    "",
  ].join("\n");
  return {
    format: "react-native",
    files: [{ path: "brandTokens.ts", content }],
    usage: [
      "Add brandTokens.ts to the app (e.g. src/theme/).",
      "In a component: const colors = useBrandColors(); style={{ backgroundColor: colors.canvasDefault, padding: spacing.space4 }} and <Text style={type.textBase}>.",
    ],
  };
}

/* ───────── Flutter ───────── */

function flutter(g: Groups, o: ExportOptions): PlatformExport {
  const font = g.fonts[0];
  const fields = g.colors;
  const content = [
    head("//", o),
    "import 'package:flutter/material.dart';",
    "",
    "/// Brand colours as a ThemeExtension: add BrandColors.light and BrandColors.dark to your ThemeData,",
    "/// then read them with Theme.of(context).extension<BrandColors>()!.",
    "@immutable",
    "class BrandColors extends ThemeExtension<BrandColors> {",
    "  const BrandColors({",
    ...fields.map((c) => `    required this.${c.name},`),
    "  });",
    "",
    ...fields.flatMap((c) => [...(c.description ? [`  /// ${c.description}`] : []), ...(c.deprecated ? [`  @Deprecated('${c.deprecated.replace(/[\\'$]/g, "\\$&")}')`] : []), `  final Color ${c.name};`]),
    "",
    "  static const light = BrandColors(",
    ...fields.map((c) => `    ${c.name}: Color(${argb(c.light)}),`),
    "  );",
    "",
    "  static const dark = BrandColors(",
    ...fields.map((c) => `    ${c.name}: Color(${argb(c.dark)}),`),
    "  );",
    "",
    "  @override",
    "  BrandColors copyWith({",
    ...fields.map((c) => `    Color? ${c.name},`),
    "  }) {",
    "    return BrandColors(",
    ...fields.map((c) => `      ${c.name}: ${c.name} ?? this.${c.name},`),
    "    );",
    "  }",
    "",
    "  @override",
    "  BrandColors lerp(ThemeExtension<BrandColors>? other, double t) {",
    "    if (other is! BrandColors) return this;",
    "    return BrandColors(",
    ...fields.map((c) => `      ${c.name}: Color.lerp(${c.name}, other.${c.name}, t)!,`),
    "    );",
    "  }",
    "}",
    "",
    "/// Spacing scale, for EdgeInsets and SizedBox.",
    "abstract final class BrandSpacing {",
    ...g.spacing.map((s) => `  static const double ${s.name} = ${num(s.px)};`),
    "}",
    "",
    "/// Corner radius scale: BorderRadius.circular(BrandRadius.radiusMd).",
    "abstract final class BrandRadius {",
    ...g.radius.map((r) => `  static const double ${r.name} = ${num(r.px)};`),
    "}",
    "",
    `/// The type scale${font?.family ? ` (declare the ${font.family} font in pubspec.yaml)` : ""}.`,
    "abstract final class BrandText {",
    ...g.type.map((t) => {
      const parts = [`fontSize: ${num(t.size)}`, ...(t.lineHeight ? [`height: ${num(t.lineHeight / t.size, 3)}`] : []), `fontWeight: FontWeight.w${Math.min(900, Math.max(100, Math.round(t.weight / 100) * 100))}`, ...(font?.family ? [`fontFamily: '${font.family.replace(/'/g, "\\'")}'`] : [])];
      return `  static const TextStyle ${t.name} = TextStyle(${parts.join(", ")});`;
    }),
    "}",
    "",
  ].join("\n");
  return {
    format: "flutter",
    files: [{ path: "brand_tokens.dart", content }],
    usage: [
      "Add brand_tokens.dart to lib/.",
      "ThemeData(extensions: [BrandColors.light]) and darkTheme: ThemeData(extensions: [BrandColors.dark]).",
      "Then Theme.of(context).extension<BrandColors>()!.actionPrimary, EdgeInsets.all(BrandSpacing.space4), BrandText.textBase.",
    ],
  };
}

/* ───────── Web ───────── */

const cssVar = (path: string) => `--${path.replace(/\./g, "-")}`;

function tailwind(flat: FlatToken[]): string {
  const step = (p: string, re: RegExp) => p.replace(re, "").replace(/\./g, "-");
  const lines = [
    ...flat.filter((t) => t.type === "color").map((t) => `  --color-${step(t.path, /^color\./)}: var(${cssVar(t.path)});`),
    ...flat.filter((t) => t.path.startsWith("font.family.")).map((t) => `  --font-${step(t.path, /^font\.family\./)}: var(${cssVar(t.path)});`),
    ...flat.filter((t) => t.path.startsWith("font.size.")).flatMap((t) => {
      const name = step(t.path, /^font\.size\./);
      const lh = flat.find((x) => x.path === `font.line-height.${t.path.slice("font.size.".length)}`);
      return [`  --text-${name}: ${t.value};`, ...(lh ? [`  --text-${name}--line-height: ${lh.value};`] : [])];
    }),
    ...flat.filter((t) => /^(radius|radii)\./.test(t.path)).map((t) => `  --radius-${step(t.path, /^(radius|radii)\./)}: ${t.value};`),
    ...flat.filter((t) => /^(space|spacing)\./.test(t.path) && !/\.unit$/.test(t.path)).map((t) => `  --spacing-${step(t.path, /^(space|spacing)\./)}: ${t.value};`),
  ];
  return `/* Paste after the CSS variables export, in your main stylesheet */\n@theme inline {\n  --color-*: initial;\n  --spacing-*: initial;\n  --radius-*: initial;\n  --text-*: initial;\n${lines.join("\n")}\n}\n`;
}

/** The Brand Kit in a format for one platform. */
export function exportTokens(tokens: unknown, format: ExportFormat, opts: ExportOptions = {}): PlatformExport {
  switch (format) {
    case "css":
      return { format, files: [{ path: "brandrail.tokens.css", content: generateTokensCss(tokens, opts) }], usage: ["Import it once at the app entry, before other styles."] };
    case "tailwind":
      return { format, files: [{ path: "brandrail-theme.css", content: tailwind(flattenTokens(tokens)) }], usage: ["Import it after brandrail.tokens.css in the stylesheet that loads Tailwind v4."] };
    case "json":
      return { format, files: [{ path: "tokens.json", content: `${JSON.stringify(tokens ?? {}, null, 2)}\n` }], usage: ["Feed it to Style Dictionary, Tokens Studio or any DTCG tool."] };
    case "ios":
      return swift(groups(tokens), opts);
    case "compose":
      return compose(groups(tokens), opts);
    case "android-xml":
      return androidXml(groups(tokens), opts);
    case "react-native":
      return reactNative(groups(tokens), opts);
    case "flutter":
      return flutter(groups(tokens), opts);
  }
}

export const isExportFormat = (x: unknown): x is ExportFormat => EXPORT_FORMATS.some((f) => f.id === x);
