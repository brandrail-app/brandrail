/**
 * Governance: deprecations, semantic versions and changelogs for Brand Kit publishes.
 *
 * A deprecated token keeps working but is marked in its DTCG node:
 *   { "$value": "#0969da", "$deprecated": "Use color.accent.emphasis",
 *     "$extensions": { "dev.brandrail": { "replacement": "color.accent.emphasis", "removeAfter": "2027-03-31" } } }
 * `$deprecated` is the DTCG field (true or a reason); the replacement and removal date are Brandrail's.
 */
import { diffTokens, flattenTokens } from "./tokens.ts";
import { EXT } from "./tokens.ts";

export interface Deprecation {
  /** Token path (color.accent.default) or component name. */
  path: string;
  /** What to use instead: a token path or a component name. */
  replacement?: string;
  /** ISO date after which it may be removed. */
  removeAfter?: string;
  reason?: string;
}

export type Bump = "major" | "minor" | "patch";

export interface KitChangelog {
  /** null when nothing changed. */
  bump: Bump | null;
  added: string[];
  removed: string[];
  changed: Array<{ path: string; from: string; to: string }>;
  /** Newly deprecated in this version. */
  deprecated: Deprecation[];
  /** No longer deprecated. */
  restored: string[];
}

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every deprecated token in a DTCG document. */
export function tokenDeprecations(doc: unknown): Deprecation[] {
  const out: Deprecation[] = [];
  const walk = (n: unknown, path: string) => {
    if (!isObj(n)) return;
    if ("$value" in n) {
      const d = n.$deprecated;
      if (d === undefined || d === false) return;
      const ext = isObj(n.$extensions) && isObj(n.$extensions[EXT]) ? (n.$extensions[EXT] as Node) : {};
      out.push({
        path,
        ...(typeof ext.replacement === "string" && ext.replacement ? { replacement: ext.replacement } : {}),
        ...(typeof ext.removeAfter === "string" && DATE.test(ext.removeAfter) ? { removeAfter: ext.removeAfter } : {}),
        ...(typeof d === "string" && d.trim() ? { reason: d.trim() } : {}),
      });
      return;
    }
    for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) walk(v, path ? `${path}.${k}` : k);
  };
  walk(doc, "");
  return out;
}

/** A copy of `doc` with exactly these tokens deprecated (others un-deprecated). Paths that don't exist are ignored. */
export function applyTokenDeprecations(doc: unknown, deps: Deprecation[]): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(doc ?? {})) as Node;
  const byPath = new Map(deps.map((d) => [d.path, d]));
  const walk = (n: unknown, path: string) => {
    if (!isObj(n)) return;
    if ("$value" in n) {
      const d = byPath.get(path);
      const ext = isObj(n.$extensions) ? (n.$extensions as Node) : undefined;
      const own = ext && isObj(ext[EXT]) ? { ...(ext[EXT] as Node) } : {};
      delete own.replacement;
      delete own.removeAfter;
      delete n.$deprecated;
      if (d) {
        n.$deprecated = d.reason?.trim() || true;
        if (d.replacement) own.replacement = d.replacement;
        if (d.removeAfter && DATE.test(d.removeAfter)) own.removeAfter = d.removeAfter;
      }
      if (Object.keys(own).length) n.$extensions = { ...(ext ?? {}), [EXT]: own };
      else if (ext) {
        const { [EXT]: _drop, ...rest } = ext;
        if (Object.keys(rest).length) n.$extensions = rest;
        else delete n.$extensions;
      }
      return;
    }
    for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) walk(v, path ? `${path}.${k}` : k);
  };
  walk(copy, "");
  return copy;
}

/**
 * What changed between two Brand Kit versions, and the semantic version bump it needs:
 * a removed token or a changed token type breaks code (major); new or newly deprecated tokens are additions (minor);
 * new values are fixes (patch).
 */
export function kitChangelog(before: unknown, after: unknown): KitChangelog {
  const d = diffTokens(before ?? {}, after ?? {});
  const typeOf = new Map(flattenTokens(before ?? {}).map((t) => [t.path, t.type]));
  const typeChanged = flattenTokens(after ?? {}).some((t) => typeOf.has(t.path) && typeOf.get(t.path) !== t.type);
  const was = new Map(tokenDeprecations(before ?? {}).map((x) => [x.path, x]));
  const now = tokenDeprecations(after ?? {});
  const deprecated = now.filter((x) => !was.has(x.path));
  const nowPaths = new Set(now.map((x) => x.path));
  const removedPaths = new Set(d.removed.map((t) => t.path));
  const restored = [...was.keys()].filter((p) => !nowPaths.has(p) && !removedPaths.has(p));
  const show = (t: { value: string; dark?: string }) => (t.dark ? `${t.value} / dark ${t.dark}` : t.value);
  const changelog: KitChangelog = {
    bump: null,
    added: d.added.map((t) => t.path),
    removed: d.removed.map((t) => t.path),
    changed: d.changed.map((c) => ({ path: c.path, from: show(c.before), to: show(c.after) })),
    deprecated,
    restored,
  };
  if (changelog.removed.length || typeChanged) changelog.bump = "major";
  else if (changelog.added.length || deprecated.length) changelog.bump = "minor";
  else if (changelog.changed.length || restored.length) changelog.bump = "patch";
  return changelog;
}

/** The next version: 1.0.0 for a first publish, otherwise the bump (a patch when nothing changed). */
export function bumpVersion(current: string | null | undefined, bump: Bump | null): string {
  if (!current) return "1.0.0";
  const [maj = 1, min = 0, pat = 0] = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
  if (bump === "major") return `${maj + 1}.0.0`;
  if (bump === "minor") return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

/** One line summing up a changelog, e.g. "2 changed, 1 added, 1 deprecated". */
export function changelogSummary(c: Pick<KitChangelog, "added" | "removed" | "changed" | "deprecated" | "restored">): string {
  const parts: string[] = [];
  if (c.changed.length) parts.push(`${c.changed.length} changed`);
  if (c.added.length) parts.push(`${c.added.length} added`);
  if (c.removed.length) parts.push(`${c.removed.length} removed`);
  if (c.deprecated.length) parts.push(`${c.deprecated.length} deprecated`);
  if (c.restored.length) parts.push(`${c.restored.length} no longer deprecated`);
  return parts.join(", ") || "No token changes";
}

const describe = (d: Deprecation, cssVars: boolean) => {
  const v = (p: string) => (cssVars && p.includes(".") ? `\`var(--${p.replace(/\./g, "-")})\`` : `\`${p}\``);
  return `${v(d.path)}${d.replacement ? ` → use ${v(d.replacement)}` : ""}${d.removeAfter ? ` (removed after ${d.removeAfter})` : ""}${d.reason ? `. ${d.reason}` : ""}`;
};

/** The changelog as Markdown, for pull requests and the dashboard. */
export function changelogMarkdown(c: KitChangelog, opts: { from?: string | null; to: string; limit?: number }): string {
  const limit = opts.limit ?? 40;
  const lines = [`**${opts.from ? `v${opts.from} → ` : ""}v${opts.to}**${c.bump ? ` (${c.bump})` : ""}: ${changelogSummary(c)}.`];
  if (c.bump === "major") lines.push("", "⚠️ Breaking: code that uses a removed token stops getting its value. The Checker flags every use.");
  if (c.changed.length || c.added.length || c.removed.length) {
    lines.push("", "| Token | Before | After |", "| --- | --- | --- |");
    for (const x of c.changed.slice(0, limit)) lines.push(`| \`${x.path}\` | ${x.from} | ${x.to} |`);
    for (const p of c.added.slice(0, limit)) lines.push(`| \`${p}\` | (new) | |`);
    for (const p of c.removed.slice(0, limit)) lines.push(`| \`${p}\` | | (removed) |`);
    const more = Math.max(0, c.changed.length - limit) + Math.max(0, c.added.length - limit) + Math.max(0, c.removed.length - limit);
    if (more) lines.push("", `…and ${more} more.`);
  }
  if (c.deprecated.length) lines.push("", "**Deprecated** (still works; the Checker warns with the replacement):", ...c.deprecated.map((d) => `- ${describe(d, true)}`));
  if (c.restored.length) lines.push("", `**No longer deprecated:** ${c.restored.map((p) => `\`${p}\``).join(", ")}`);
  return lines.join("\n");
}

/** A deprecation as one line for AI rule files. */
export const deprecationLine = describe;
