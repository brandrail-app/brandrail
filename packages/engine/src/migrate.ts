import { findComponents } from "./components.ts";
import type { ResolvedConfig } from "./config.ts";
import { resolveUsage, type ResolvedUsage } from "./frameworks.ts";
import type { FileKind } from "./source.ts";
import type { ComponentEntry, Framework } from "./types.ts";

/**
 * Migration from other UI libraries to the design system: what each library's pieces are (a "concept" such as
 * button or select), where they're used in code, and which registry component replaces them.
 */

export type Concept =
  | "button" | "input" | "textarea" | "select" | "checkbox" | "radio" | "toggle" | "dialog" | "tooltip" | "avatar"
  | "label" | "loader" | "progressbar" | "breadcrumb" | "divider" | "notification" | "datepicker" | "tabs" | "card" | "table";

export type LibraryId = "mui" | "angular-material" | "bootstrap" | "antd" | "chakra" | "react-bootstrap" | "primeng";

export const LIBRARY_LABEL: Record<LibraryId, string> = {
  mui: "MUI (Material UI)",
  "angular-material": "Angular Material",
  bootstrap: "Bootstrap",
  antd: "Ant Design",
  chakra: "Chakra UI",
  "react-bootstrap": "React Bootstrap",
  primeng: "PrimeNG",
};

/** Raw HTML a concept stands for, used to find the replacing component through `replaces`. */
const CONCEPT_TAG: Partial<Record<Concept, string>> = {
  button: "button",
  input: "input",
  textarea: "textarea",
  select: "select",
  checkbox: "input[type=checkbox]",
  radio: "input[type=radio]",
  table: "table",
};

/** React component names in React libraries → concept. */
const REACT_LIBS: Array<{ id: LibraryId; packages: RegExp; names: Record<string, Concept> }> = [
  {
    id: "mui",
    packages: /^(@mui\/material|@mui\/joy|@material-ui\/core|@mui\/x-date-pickers)(\/|$)/,
    names: {
      Button: "button", IconButton: "button", Fab: "button", LoadingButton: "button", TextField: "input", Input: "input", OutlinedInput: "input",
      Select: "select", Autocomplete: "select", NativeSelect: "select", Checkbox: "checkbox", Radio: "radio", RadioGroup: "radio", Switch: "toggle",
      Dialog: "dialog", Modal: "dialog", Drawer: "dialog", Tooltip: "tooltip", Avatar: "avatar", Chip: "label", Badge: "label",
      CircularProgress: "loader", Skeleton: "loader", LinearProgress: "progressbar", Breadcrumbs: "breadcrumb", Divider: "divider",
      Snackbar: "notification", Alert: "notification", DatePicker: "datepicker", DateField: "datepicker", Tabs: "tabs", Tab: "tabs",
      Card: "card", Paper: "card", Table: "table", TextareaAutosize: "textarea",
    },
  },
  {
    id: "antd",
    packages: /^antd(\/|$)/,
    names: {
      Button: "button", Input: "input", InputNumber: "input", Select: "select", Checkbox: "checkbox", Radio: "radio", Switch: "toggle", Modal: "dialog",
      Drawer: "dialog", Tooltip: "tooltip", Popover: "tooltip", Avatar: "avatar", Tag: "label", Badge: "label", Spin: "loader", Progress: "progressbar",
      Breadcrumb: "breadcrumb", Divider: "divider", Alert: "notification", DatePicker: "datepicker", Tabs: "tabs", Card: "card", Table: "table",
    },
  },
  {
    id: "chakra",
    packages: /^@chakra-ui\/react(\/|$)/,
    names: {
      Button: "button", IconButton: "button", Input: "input", Textarea: "textarea", Select: "select", Checkbox: "checkbox", Radio: "radio", Switch: "toggle",
      Modal: "dialog", Drawer: "dialog", Tooltip: "tooltip", Avatar: "avatar", Tag: "label", Badge: "label", Spinner: "loader", Progress: "progressbar",
      Breadcrumb: "breadcrumb", Divider: "divider", Alert: "notification", Tabs: "tabs", Card: "card", Table: "table",
    },
  },
  {
    id: "react-bootstrap",
    packages: /^react-bootstrap(\/|$)/,
    names: {
      Button: "button", Form: "input", FormControl: "input", FormSelect: "select", FormCheck: "checkbox", Modal: "dialog", Offcanvas: "dialog",
      Tooltip: "tooltip", OverlayTrigger: "tooltip", Badge: "label", Spinner: "loader", ProgressBar: "progressbar", Breadcrumb: "breadcrumb",
      Alert: "notification", Toast: "notification", Tabs: "tabs", Tab: "tabs", Card: "card", Table: "table",
    },
  },
];

/** Angular Material elements and attributes (templates and inline templates). */
const MAT_TAGS: Record<string, Concept> = {
  "mat-form-field": "input", "mat-select": "select", "mat-autocomplete": "select", "mat-checkbox": "checkbox", "mat-radio-group": "radio",
  "mat-radio-button": "radio", "mat-slide-toggle": "toggle", "mat-progress-bar": "progressbar", "mat-spinner": "loader",
  "mat-progress-spinner": "loader", "mat-datepicker": "datepicker", "mat-date-range-picker": "datepicker", "mat-divider": "divider",
  "mat-chip": "label", "mat-chip-listbox": "label", "mat-chip-option": "label", "mat-tab-group": "tabs", "mat-card": "card",
  "mat-table": "table", "mat-dialog-content": "dialog", "mat-button-toggle-group": "button",
};
const MAT_ATTRS: Record<string, Concept> = {
  "mat-button": "button", "mat-raised-button": "button", "mat-flat-button": "button", "mat-stroked-button": "button", "mat-icon-button": "button",
  "mat-fab": "button", "mat-mini-fab": "button", matButton: "button", matInput: "input", matTooltip: "tooltip", matBadge: "label",
  "mat-table": "table",
};

/** PrimeNG (Angular) elements. */
const PRIME_TAGS: Record<string, Concept> = {
  "p-button": "button", "p-dropdown": "select", "p-select": "select", "p-multiselect": "select", "p-checkbox": "checkbox",
  "p-radiobutton": "radio", "p-inputswitch": "toggle", "p-toggleswitch": "toggle", "p-dialog": "dialog", "p-avatar": "avatar",
  "p-tag": "label", "p-badge": "label", "p-progressspinner": "loader", "p-progressbar": "progressbar", "p-breadcrumb": "breadcrumb",
  "p-divider": "divider", "p-toast": "notification", "p-message": "notification", "p-calendar": "datepicker", "p-datepicker": "datepicker",
  "p-tabview": "tabs", "p-tabs": "tabs", "p-card": "card", "p-table": "table",
};

/** Bootstrap classes → concept (Bootstrap 4 and 5; Moodle and many server-rendered apps use them). */
const BOOTSTRAP_CLASSES: Array<[RegExp, Concept, string]> = [
  [/^btn$/, "button", "btn"],
  [/^form-control$/, "input", "form-control"],
  [/^(form-select|custom-select)$/, "select", "form-select"],
  [/^form-switch$/, "toggle", "form-switch"],
  [/^(form-check-input|custom-control-input)$/, "checkbox", "form-check-input"],
  [/^modal$/, "dialog", "modal"],
  [/^alert$/, "notification", "alert"],
  [/^toast$/, "notification", "toast"],
  [/^badge$/, "label", "badge"],
  [/^spinner-(border|grow)$/, "loader", "spinner"],
  [/^progress$/, "progressbar", "progress"],
  [/^breadcrumb$/, "breadcrumb", "breadcrumb"],
  [/^nav-tabs$/, "tabs", "nav-tabs"],
  [/^card$/, "card", "card"],
];

const BOOTSTRAP_EVIDENCE =
  /\b(?:btn-(?:primary|secondary|success|danger|warning|info|light|dark|link|outline-[a-z]+)|form-control|form-select|form-check-input|custom-select|custom-control-input|spinner-border|spinner-grow|col-(?:xs|sm|md|lg|xl|xxl)-\d{1,2}|data-bs-[a-z]+|data-toggle)\b/;

export interface LegacyUsage {
  offset: number;
  library: LibraryId;
  /** How it appears in the code, e.g. "<mat-select>", "MUI <TextField>", class "btn". */
  what: string;
  concept: Concept;
}

function* matchAll(re: RegExp, text: string) {
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while ((m = g.exec(text))) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}

/** Every place a file uses another UI library's piece. */
export function findLegacyUsages(code: string, kind: FileKind): LegacyUsage[] {
  const out: LegacyUsage[] = [];
  if (kind === "css") return out;

  // React libraries: imported names, then where they're rendered.
  for (const lib of REACT_LIBS) {
    const local = new Map<string, string>();
    for (const m of matchAll(/\bimport\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*(['"])([^'"]+)\3/g, code)) {
      if (!lib.packages.test(m[4]!)) continue;
      const sub = /\/([A-Z]\w*)$/.exec(m[4]!)?.[1]; // import Button from "@mui/material/Button"
      if (m[1] && sub && lib.names[sub]) local.set(m[1], sub);
      for (const part of (m[2] ?? "").split(",")) {
        const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
        if (orig && lib.names[orig]) local.set(alias || orig, orig);
      }
    }
    if (!local.size) continue;
    const names = [...local.keys()].map((n) => n.replace(/\$/g, "\\$")).join("|");
    for (const m of matchAll(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
      const orig = local.get(m[1]!)!;
      out.push({ offset: m.index, library: lib.id, what: `${LIBRARY_LABEL[lib.id].split(" ")[0]} <${orig}>`, concept: lib.names[orig]! });
    }
  }

  // Angular Material and PrimeNG elements and attributes.
  for (const m of matchAll(/<((?:mat|p)-[a-z-]+)(?=[\s/>])([^>]*)>/g, code)) {
    const tag = m[1]!;
    const concept = MAT_TAGS[tag] ?? PRIME_TAGS[tag];
    if (concept) out.push({ offset: m.index, library: tag.startsWith("mat-") ? "angular-material" : "primeng", what: `<${tag}>`, concept });
  }
  for (const m of matchAll(/<([a-z][\w-]*)(?=[\s/>])([^>]*)>/g, code)) {
    for (const a of matchAll(/(?<=\s)\[?(mat-raised-button|mat-flat-button|mat-stroked-button|mat-icon-button|mat-button|mat-mini-fab|mat-fab|mat-table|matButton|matInput|matTooltip|matBadge)\]?(?=[\s=>/]|$)/g, m[2]!)) {
      const name = a[1]!;
      const concept = MAT_ATTRS[name];
      if (concept) out.push({ offset: m.index, library: "angular-material", what: `<${m[1]} ${name}>`, concept });
    }
  }

  // Bootstrap classes (class="…" or className="…"). Names like "card" or "alert" are common in hand-written CSS too,
  // so only files that clearly use Bootstrap count.
  if (!BOOTSTRAP_EVIDENCE.test(code)) return out.sort((a, b) => a.offset - b.offset);
  for (const m of matchAll(/\b(?:class|className)\s*=\s*(["'])([^"']*)\1/g, code)) {
    const seen = new Set<Concept>();
    for (const cls of m[2]!.split(/\s+/)) {
      for (const [re, concept, label] of BOOTSTRAP_CLASSES) {
        if (re.test(cls) && !seen.has(concept)) {
          seen.add(concept);
          out.push({ offset: m.index, library: "bootstrap", what: `class "${label}"`, concept });
        }
      }
    }
  }
  for (const m of matchAll(/data-(?:bs-)?toggle\s*=\s*["'](tooltip|modal|popover)["']/g, code)) {
    out.push({ offset: m.index, library: "bootstrap", what: `data-bs-toggle="${m[1]}"`, concept: m[1] === "modal" ? "dialog" : "tooltip" });
  }
  return out.sort((a, b) => a.offset - b.offset);
}

/** The registry component that takes over a concept, if there is one. */
export function componentForConcept(config: Pick<ResolvedConfig, "replaces" | "components">, concept: Concept): ComponentEntry | undefined {
  const tag = CONCEPT_TAG[concept];
  if (tag && config.replaces.get(tag)) return config.replaces.get(tag);
  return findComponents({ components: config.components }, concept, 1)[0]?.component;
}

export interface MappingRow {
  library: LibraryId;
  from: string;
  concept: Concept;
  to?: { name: string; usage: ResolvedUsage | null };
}

/** Every known library piece and what replaces it in this design system, for one framework. */
export function migrationMap(config: Pick<ResolvedConfig, "replaces" | "components">, framework: Framework, libraries?: LibraryId[]): MappingRow[] {
  const rows: MappingRow[] = [];
  const add = (library: LibraryId, from: string, concept: Concept) => {
    if (libraries && !libraries.includes(library)) return;
    const c = componentForConcept(config, concept);
    rows.push({ library, from, concept, to: c ? { name: c.name, usage: resolveUsage(c, framework) } : undefined });
  };
  for (const lib of REACT_LIBS) for (const [name, concept] of Object.entries(lib.names)) add(lib.id, `<${name}>`, concept);
  for (const [tag, concept] of Object.entries(MAT_TAGS)) add("angular-material", `<${tag}>`, concept);
  for (const [attr, concept] of Object.entries(MAT_ATTRS)) add("angular-material", attr, concept);
  for (const [tag, concept] of Object.entries(PRIME_TAGS)) add("primeng", `<${tag}>`, concept);
  for (const [, concept, label] of BOOTSTRAP_CLASSES) add("bootstrap", `.${label}`, concept);
  return rows;
}

/** The migration map as a Markdown table (for the migration skill and the MCP tool). */
export function migrationMapMarkdown(config: Pick<ResolvedConfig, "replaces" | "components">, framework: Framework, libraries?: LibraryId[]): string {
  const rows = migrationMap(config, framework, libraries);
  const lines = ["| From | Library | Use instead |", "| --- | --- | --- |"];
  for (const r of rows) {
    const to = !r.to ? `_no ${r.concept} component yet: tokens + semantic HTML_` : r.to.usage ? `\`<${r.to.usage.tag}>\`${r.to.usage.importLine ? ` (\`${r.to.usage.importLine}\`)` : ""}` : `_${r.to.name} has no ${framework} version yet_`;
    lines.push(`| \`${r.from}\` | ${LIBRARY_LABEL[r.library]} | ${to} |`);
  }
  return lines.join("\n");
}

/** UI libraries a project depends on, from its package.json. */
export function detectLibraries(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null | undefined): LibraryId[] {
  if (!pkg) return [];
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const has = (re: RegExp) => Object.keys(deps).some((d) => re.test(d));
  const out: LibraryId[] = [];
  if (has(/^(@mui\/material|@mui\/joy|@material-ui\/core)$/)) out.push("mui");
  if (has(/^@angular\/material$/)) out.push("angular-material");
  if (has(/^(bootstrap|ngx-bootstrap|@ng-bootstrap\/ng-bootstrap|bootstrap-vue(-next)?)$/)) out.push("bootstrap");
  if (has(/^react-bootstrap$/)) out.push("react-bootstrap", "bootstrap");
  if (has(/^antd$/)) out.push("antd");
  if (has(/^@chakra-ui\/react$/)) out.push("chakra");
  if (has(/^primeng$/)) out.push("primeng");
  return [...new Set(out)];
}
