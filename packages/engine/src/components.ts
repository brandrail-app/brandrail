import type { BrandrailConfig, ComponentEntry } from "./types.ts";

/** Common words people (and AI tools) use for UI pieces, mapped to canonical terms. */
const SYNONYMS: Record<string, string[]> = {
  button: ["btn", "cta", "action", "submit", "click"],
  input: ["textinput", "textfield", "field", "text", "inputtext", "entry", "form"],
  select: ["dropdown", "picker", "combobox", "menu", "options", "choose"],
  textarea: ["multiline", "comment", "notes", "message", "inputtextarea"],
  checkbox: ["check", "tick", "toggle", "agree"],
  radio: ["radiogroup", "option", "choice"],
  toggle: ["switch", "onoff"],
  dialog: ["modal", "popup", "overlay", "lightbox"],
  tooltip: ["hint", "hover", "popover"],
  notification: ["toast", "alert", "flash", "banner", "snackbar", "message"],
  avatar: ["profile", "user", "picture", "initials"],
  datepicker: ["date", "calendar", "day", "schedule"],
  progressbar: ["progress", "loading", "percent", "meter"],
  loader: ["spinner", "loading", "busy"],
  breadcrumb: ["path", "trail", "navigation", "nav"],
  divider: ["separator", "rule", "hr", "line"],
  table: ["datatable", "grid", "rows", "list"],
  card: ["box", "panel", "tile", "container"],
  label: ["badge", "tag", "chip", "pill", "status"],
  tabs: ["tab", "segmented"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function expand(words: string[]): Set<string> {
  const out = new Set(words);
  for (const w of words) {
    for (const [canon, syns] of Object.entries(SYNONYMS)) {
      if (w === canon || syns.includes(w)) {
        out.add(canon);
        for (const s of syns) out.add(s);
      }
    }
  }
  return out;
}

export interface ComponentMatch {
  component: ComponentEntry;
  score: number;
}

/** Ranks registry components for a free-text intent like "date picker for next service". */
export function findComponents(config: Pick<BrandrailConfig, "components">, intent: string, limit = 5): ComponentMatch[] {
  const words = norm(intent).split(" ").filter((w) => w.length > 1);
  const query = expand(words);
  const q = squash(intent);
  const out: ComponentMatch[] = [];

  for (const c of config.components ?? []) {
    if (c.status === "deprecated") continue;
    const name = squash(c.name);
    let score = 0;
    if (name === q) score += 100;
    else if (q.includes(name) || name.includes(q)) score += 40;
    const nameTerms = expand([name, ...(c.aliases ?? []).map(squash), ...(c.replaces ?? [])]);
    for (const w of query) {
      if (nameTerms.has(w)) score += 20;
      else if (name.includes(w) && w.length > 2) score += 10;
    }
    const text = norm([c.description ?? "", ...(c.usageRules ?? [])].join(" "));
    for (const w of words) if (w.length > 2 && text.includes(w)) score += 3;
    // Only real matches count; status just breaks ties.
    if (score >= 3) out.push({ component: c, score: score + (c.status === "stable" ? 1 : 0) });
  }
  return out.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name)).slice(0, limit);
}

export function findComponentByName(config: Pick<BrandrailConfig, "components">, name: string): ComponentEntry | undefined {
  const n = squash(name);
  return (config.components ?? []).find((c) => squash(c.name) === n || (c.aliases ?? []).some((a) => squash(a) === n));
}
