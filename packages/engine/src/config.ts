import { parseColor, rgbToLab, toHex, type Lab } from "./color.ts";
import { tokenDeprecations, type Deprecation } from "./governance.ts";
import type { BrandrailConfig, ComponentEntry, DtcgDoc, Framework, RuleSetting } from "./types.ts";

export type TokenColor = { path: string; cssVar: string; hex: string; lab: Lab; alpha: number; /** Set on the extra entry for a dark-mode value. */ mode?: "dark" };

export interface ResolvedConfig {
  tokenVersion?: string;
  colors: TokenColor[];
  /** Allowed px values for padding / margin / gap / inset. */
  spacing: number[];
  /** Allowed px values for border-radius. */
  radii: number[];
  /** Allowed first font families, lower-cased, quotes removed. */
  fonts: string[];
  /** px values of font.size.* tokens (the type scale), sorted. */
  fontSizes: number[];
  /** CSS variables of the font family tokens, e.g. --font-family-sans. */
  fontVars: string[];
  components: ComponentEntry[];
  /** Deprecated tokens by CSS variable (--color-accent-default). */
  deprecatedTokens: Map<string, Deprecation>;
  /** html tag (or tag[type=x]) -> component that replaces it */
  replaces: Map<string, ComponentEntry>;
  rules: Record<string, RuleSetting>;
  ignore: string[];
  forbiddenImports: string[];
  colorTolerance: number;
  /** The project's framework from the config, when set. */
  framework?: Framework;
}

export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/.nuxt/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/*.min.*",
  "**/*.map",
  "**/*.d.ts",
  "**/tailwind.config.*",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.stories.*",
  "**/__tests__/**",
  "**/__mocks__/**",
];

export const DEFAULT_FORBIDDEN_IMPORTS = [
  "@mui/material",
  "@mui/joy",
  "@material-ui/core",
  "antd",
  "@chakra-ui/react",
  "react-bootstrap",
  "bootstrap",
  "@mantine/core",
  "semantic-ui-react",
  "primereact",
];

/** Tags each well-known component name replaces, used when `replaces` isn't given. */
const NAME_TO_TAGS: Record<string, string[]> = {
  button: ["button"],
  input: ["input"],
  textinput: ["input"],
  inputtext: ["input"],
  textfield: ["input"],
  select: ["select"],
  dropdown: ["select"],
  textarea: ["textarea"],
  inputtextarea: ["textarea"],
  link: ["a"],
  table: ["table"],
  checkbox: ["input[type=checkbox]"],
  radio: ["input[type=radio]"],
};

const GENERIC_FONTS = new Set([
  "inherit",
  "initial",
  "unset",
  "system-ui",
  "-apple-system",
  "blinkmacsystemfont",
  "sans-serif",
  "serif",
  "monospace",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "cursive",
  "fantasy",
]);

type Leaf = { path: string; type?: string; value: unknown; dark?: unknown };

function leaves(doc: unknown, prefix = "", out: Leaf[] = []): Leaf[] {
  if (!doc || typeof doc !== "object") return out;
  const obj = doc as Record<string, unknown>;
  if ("$value" in obj) {
    const ext = (obj.$extensions as Record<string, { modes?: { dark?: unknown } }> | undefined)?.["dev.brandrail"];
    out.push({ path: prefix, type: obj.$type as string | undefined, value: obj.$value, dark: ext?.modes?.dark });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    leaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

const px = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return m[2] === "rem" ? n * 16 : n;
};

export function normalizeFontFamily(value: string): string {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}

export function isGenericFont(family: string) {
  return GENERIC_FONTS.has(family) || family.startsWith("var(");
}

const uniqSorted = (xs: number[]) => [...new Set(xs.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);

export function resolveConfig(config: BrandrailConfig): ResolvedConfig {
  const all = leaves(config.tokens);

  const colors: TokenColor[] = [];
  for (const l of all) {
    if (typeof l.value !== "string") continue;
    if (l.type && l.type !== "color") continue;
    if (!l.type && !l.path.startsWith("color")) continue;
    const rgb = parseColor(l.value);
    if (!rgb) continue;
    const cssVar = `--${l.path.replace(/\./g, "-")}`;
    colors.push({ path: l.path, cssVar, hex: toHex(rgb), lab: rgbToLab(rgb), alpha: rgb.a });
    const dark = typeof l.dark === "string" ? parseColor(l.dark) : null;
    if (dark) colors.push({ path: l.path, cssVar, hex: toHex(dark), lab: rgbToLab(dark), alpha: dark.a, mode: "dark" });
  }

  // Spacing: explicit space.* tokens, plus a scale from space.unit if present.
  const spaceLeaves = all.filter((l) => /^(space|spacing)\./.test(l.path));
  const spacing: number[] = [0, 1, 2];
  const unit = px(spaceLeaves.find((l) => /\.unit$/.test(l.path))?.value);
  for (const l of spaceLeaves) {
    const v = px(l.value);
    if (v !== null && !/\.unit$/.test(l.path)) spacing.push(v);
  }
  if (unit) for (const m of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24]) spacing.push(unit * m);
  if (spacing.length === 3) for (const v of [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]) spacing.push(v);

  // Radius: radius.* tokens; a single md value expands to a small scale.
  const radiusVals = all.filter((l) => /^(radius|radii|border-?radius)\./i.test(l.path)).map((l) => px(l.value)).filter((v): v is number => v !== null);
  const radii = [0, 9999, ...radiusVals];
  if (radiusVals.length === 1) radii.push(Math.round(radiusVals[0]! / 2), radiusVals[0]! * 2);
  if (radiusVals.length === 0) radii.push(2, 4, 6, 8, 12, 16);

  const fontLeaves = all.filter((l) => (l.type === "fontFamily" || /^font\.family\./.test(l.path)) && typeof l.value === "string");
  const fonts = fontLeaves.map((l) => normalizeFontFamily(l.value as string));
  const fontVars = fontLeaves.map((l) => `--${l.path.replace(/\./g, "-")}`);

  const components = config.components ?? [];
  const replaces = new Map<string, ComponentEntry>();
  for (const c of components) {
    // A deprecated component never replaces raw elements: nobody should be sent to it.
    if (c.status === "deprecated") continue;
    const tags = c.replaces ?? NAME_TO_TAGS[c.name.toLowerCase()] ?? [];
    for (const t of tags) {
      const key = t.toLowerCase().replace(/\s+/g, "").replace(/["']/g, "");
      if (!replaces.has(key)) replaces.set(key, c);
    }
  }

  return {
    tokenVersion: config.tokenVersion,
    colors,
    spacing: uniqSorted(spacing),
    radii: uniqSorted(radii),
    fonts: [...new Set(fonts)],
    fontVars: fontVars.length ? fontVars : ["--font-family-sans"],
    fontSizes: uniqSorted(all.filter((l) => /^font\.size\./.test(l.path)).map((l) => px(l.value)).filter((v): v is number => v !== null)),
    components,
    deprecatedTokens: new Map(tokenDeprecations(config.tokens).map((d) => [`--${d.path.replace(/\./g, "-")}`, d])),
    replaces,
    rules: (config.rules ?? {}) as Record<string, RuleSetting>,
    ignore: [...DEFAULT_IGNORE, ...(config.ignore ?? [])],
    forbiddenImports: config.forbiddenImports ?? DEFAULT_FORBIDDEN_IMPORTS,
    colorTolerance: config.colorTolerance ?? 2.5,
    framework: config.framework,
  };
}

export function nearest(values: number[], v: number): number {
  let best = values[0] ?? 0;
  for (const x of values) if (Math.abs(x - v) < Math.abs(best - v)) best = x;
  return best;
}
