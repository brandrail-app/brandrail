/**
 * Quality checks on a Brand Kit before it's published: readable text, buttons whose labels
 * can be read, and the status colours components need. Everything an AI builds inherits these,
 * so a gap here shows up in every app (e.g. a missing success colour falls back to the kit's green).
 */
import { contrastRatio, parseColor } from "./color.ts";
import { pickColorRoles } from "./kit-bridge.ts";
import { flattenTokens } from "./tokens.ts";

export interface KitIssue {
  /** error: likely unreadable for users; publishing asks for confirmation. warning: worth fixing. */
  severity: "error" | "warning";
  code: "text-contrast" | "muted-contrast" | "on-fill-contrast" | "status-contrast" | "missing-color";
  message: string;
  /** Tokens involved, to highlight in the editor. */
  paths: string[];
  mode?: "light" | "dark";
}

const ratio = (a: string, b: string) => {
  const x = parseColor(a);
  const y = parseColor(b);
  return x && y ? Math.round(contrastRatio(x, y) * 100) / 100 : 21;
};
const r1 = (n: number) => `${Math.round(n * 10) / 10}:1`;

type Color = { path: string; value: string; dark?: string };

const STATUS: Array<{ key: "success" | "warning" | "danger"; re: RegExp; label: string; usedBy: string }> = [
  { key: "success", re: /success|positive/, label: "success", usedBy: "success notifications, checks and toggles" },
  { key: "warning", re: /warning|attention|caution/, label: "warning", usedBy: "warning notifications and states" },
  { key: "danger", re: /danger|error|critical|negative/, label: "danger / error", usedBy: "errors, destructive buttons and invalid fields" },
];

export function auditBrandKit(tokens: unknown): KitIssue[] {
  const colors: Color[] = flattenTokens(tokens)
    .filter((t) => t.type === "color")
    .map((t) => ({ path: t.path, value: t.value, dark: t.dark }));
  const issues: KitIssue[] = [];
  if (!colors.length) return issues;

  const modes: Array<"light" | "dark"> = colors.some((c) => c.dark) ? ["light", "dark"] : ["light"];
  const light = pickColorRoles(colors, false);

  for (const mode of modes) {
    const dark = mode === "dark";
    const r = pickColorRoles(colors, dark);
    const where = modes.length > 1 ? ` (${mode} mode)` : "";
    const paths = (...xs: Array<string | undefined>) => xs.filter((x): x is string => !!x);

    const text = ratio(r.fg.value, r.canvas.value);
    if (text < 4.5) {
      issues.push({
        severity: "error",
        code: "text-contrast",
        mode,
        paths: paths(r.fg.path, r.canvas.path),
        message: `Body text on the page background is ${r1(text)}${where}. It needs at least 4.5:1 to be readable.`,
      });
    }

    const muted = ratio(r.muted.value, r.canvas.value);
    if (muted < 4.5) {
      issues.push({
        severity: muted < 3 ? "error" : "warning",
        code: "muted-contrast",
        mode,
        paths: paths(r.muted.path, r.canvas.path),
        message: `Secondary text on the page background is ${r1(muted)}${where}. Captions and help text need 4.5:1; darken ${r.muted.path ?? "the muted colour"}.`,
      });
    }

    // Labels on filled buttons: the bridge picks whichever Brand Kit neutral reads better.
    for (const [role, what] of [
      ["primary", "primary buttons"],
      ["danger", "destructive buttons"],
    ] as const) {
      if (!r[role].path) continue;
      const fill = r[role].value;
      const best = Math.max(ratio(light.canvas.value, fill), ratio(light.fg.value, fill));
      if (best < 4.5) {
        issues.push({
          severity: best < 3 ? "error" : "warning",
          code: "on-fill-contrast",
          mode,
          paths: [r[role].path!],
          message: `Labels on ${what} are at most ${r1(best)}${where}: neither your background nor your text colour reads well on ${fill}. Use a darker or lighter ${r[role].path} (4.5:1 for text).`,
        });
      }
    }

    // Brand colours as text on the page: ghost buttons, links, selected states.
    for (const [role, what] of [
      ["primary", "ghost buttons, selected items and focus rings"],
      ["accent", "links and highlights"],
    ] as const) {
      if (!r[role].path) continue;
      const vs = ratio(r[role].value, r.canvas.value);
      if (vs < 4.5) {
        issues.push({
          severity: vs < 3 ? "error" : "warning",
          code: "status-contrast",
          mode,
          paths: [r[role].path!],
          message: `${r[role].path} (${r[role].value}) is ${r1(vs)} on the page background${where}. Components use it as text and outlines for ${what}, which need 4.5:1 for text and 3:1 for icons and borders. Darken it, or add a darker variant for text.`,
        });
      }
    }

    for (const s of STATUS) {
      const c = colors.find((x) => s.re.test(x.path));
      if (!c) continue;
      const value = dark ? c.dark ?? c.value : c.value;
      const vs = ratio(value, r.canvas.value);
      if (vs < 3) {
        issues.push({
          severity: "warning",
          code: "status-contrast",
          mode,
          paths: [c.path],
          message: `${c.path} (${value}) is ${r1(vs)} on the page background${where}: too light for text or icons (3:1 for icons, 4.5:1 for text). It's fine as a fill behind dark text; add a darker variant for text.`,
        });
      }
    }
  }

  if (!light.primary.path) {
    issues.push({
      severity: "warning",
      code: "missing-color",
      paths: [],
      message: "No primary colour (e.g. color.action.primary). Buttons and links fall back to the kit's default green.",
    });
  }
  for (const s of STATUS) {
    if (colors.some((x) => s.re.test(x.path))) continue;
    issues.push({
      severity: "warning",
      code: "missing-color",
      paths: [],
      message: `No ${s.label} colour (e.g. color.status.${s.key}). It's used for ${s.usedBy}, which fall back to the kit's own colour instead of your brand.`,
    });
  }

  // Same problem in both modes with the same tokens: report once.
  const seen = new Set<string>();
  return issues
    .filter((i) => {
      const key = `${i.code}:${i.paths.join(",")}:${i.message.replace(/ \((light|dark) mode\)/, "").replace(/[\d.]+:1/g, "")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}
