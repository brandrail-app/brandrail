/**
 * Page templates: whole pages (list, detail, form, settings, dashboard, sign-in) described once and rendered in the
 * project's framework from the organisation's own registry components and Brand Kit tokens. AI tools get a page that
 * already follows the design system; people who don't write frontend code get a page they only fill with data.
 */
import { resolveConfig, type ResolvedConfig } from "./config.ts";
import { findComponentByName } from "./components.ts";
import { FRAMEWORK_LABEL, resolveUsage, type ResolvedUsage } from "./frameworks.ts";
import { pickColorRoles } from "./kit-bridge.ts";
import { componentForConcept, type Concept } from "./migrate.ts";
import { flattenTokens } from "./tokens.ts";
import type { BrandrailConfig, ComponentEntry, Framework, PropSpec } from "./types.ts";

/* ───────────────────────── Model ───────────────────────── */

/** Changes page state: sets a flag, or stores the event's value. `when` only acts for that value (e.g. a menu item). */
type Act = { set: string; to: boolean; when?: string } | { store: string };

type Layout = "page" | "header" | "stack" | "row" | "grid" | "actions" | "center" | "narrow";
type TNode =
  | { kind: "layout"; as: Layout; children: TNode[] }
  | { kind: "text"; as: "h1" | "h2" | "p" | "muted" | "stat"; text: string }
  | {
      kind: "c";
      /** The kit component this part is modelled on; the org's own component is used when it has one. */
      component: string;
      /** Names this part, e.g. "create" → an id and a label in the parts table. */
      part: string;
      purpose: string;
      props?: Record<string, unknown>;
      /** Prop → state variable (e.g. open → confirmOpen). */
      bind?: Record<string, string>;
      /** Callback prop → what it does. */
      on?: Record<string, Act>;
      children?: TNode[];
    };

/** A reference to sample data declared next to the page. */
const data = (name: string) => ({ $data: name });
const isData = (v: unknown): v is { $data: string } => !!v && typeof v === "object" && "$data" in (v as object);

export interface PageTemplate {
  id: string;
  name: string;
  description: string;
  /** Other words people use for it, for matching a request like "admin index page". */
  aliases: string[];
  /** Page rules: layout, states, accessibility. */
  rules: string[];
  /** Sample data, replaced by the app's own. */
  data: Record<string, unknown>;
  /** State flags and values the page keeps, with their starting value. */
  state: Record<string, boolean | string>;
  tree: TNode;
}

const L = (as: Layout, ...children: TNode[]): TNode => ({ kind: "layout", as, children });
const T = (as: "h1" | "h2" | "p" | "muted" | "stat", text: string): TNode => ({ kind: "text", as, text });
const C = (component: string, part: string, purpose: string, props: Record<string, unknown> = {}, extra: Partial<Extract<TNode, { kind: "c" }>> = {}): TNode => ({
  kind: "c",
  component,
  part,
  purpose,
  // Cards sit under the page's h1, so their titles are h2.
  props: component === "Card" && props.title && props.headingLevel === undefined ? { ...props, headingLevel: 2 } : props,
  ...extra,
});

const OWNERS = [
  { label: "Alex Chen", value: "alex" },
  { label: "Priya Nair", value: "priya" },
  { label: "Sam Taylor", value: "sam" },
];

const confirmDelete = (what: string, lost: string): TNode =>
  C("Modal", "confirm-delete", "Confirms the destructive action", { title: `Delete ${what}?`, description: lost, primaryLabel: "Delete", danger: true, size: "small" }, {
    bind: { open: "confirmOpen" },
    on: { onClose: { set: "confirmOpen", to: false }, onPrimary: { set: "confirmOpen", to: false } },
  });

const COMMON_RULES = [
  "Use only the components and CSS variables shown; no other UI library and no hard-coded colours, spacing or fonts.",
  "One primary (cta) button per view. Secondary actions are ghost buttons; destructive ones are danger and confirmed in a Modal.",
  "Every field has a visible label. Every table has a caption (captionHidden keeps it for screen readers).",
  "Show three states for data that loads: loading (Loader), empty (the component's empty message) and error (Notification with type error and what to do next).",
  "Keep the page within the layout classes below: they use the Brand Kit's spacing scale and collapse to one column on phones.",
];

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    id: "list",
    name: "List page",
    description: "A table of records with a create button, filters and search. The index page of any section (projects, orders, users).",
    aliases: ["index", "table page", "records", "collection", "admin list", "crud", "overview list", "search results"],
    rules: [
      "The page title says what the records are; the create button names the thing (\"New project\", not \"Add\").",
      "Filters sit above the table and apply immediately; don't add an Apply button.",
      "Clicking a row opens its detail page. Long tables paginate on the server (manualSort and onSort).",
      "Confirm deletes with a Modal and report the result with a Toast offering Undo.",
    ],
    data: {
      owners: OWNERS,
      statusTabs: [
        { label: "All", value: "all" },
        { label: "Active", value: "active" },
        { label: "Archived", value: "archived" },
      ],
      columns: [
        { key: "name", label: "Project", sortable: true },
        { key: "owner", label: "Owner", sortable: true },
        { key: "status", label: "Status" },
        { key: "tasks", label: "Open tasks", align: "right", sortable: true },
      ],
      rows: [
        { id: "p1", name: "Website redesign", owner: "Alex Chen", status: "Active", tasks: 12 },
        { id: "p2", name: "Mobile app", owner: "Priya Nair", status: "Active", tasks: 7 },
        { id: "p3", name: "Q3 report", owner: "Sam Taylor", status: "Archived", tasks: 0 },
      ],
    },
    state: { status: "all" },
    tree: L(
      "page",
      L("header", L("stack", T("h1", "Projects"), T("muted", "Every project in your workspace.")), C("Button", "create", "The page's one primary action", { label: "New project", type: "cta" })),
      L(
        "row",
        C("Tabs", "status-filter", "Filters the table by status", { label: "Status", tabs: data("statusTabs"), variant: "pills", size: "small" }, { bind: { selected: "status" }, on: { onChange: { store: "status" } } }),
        C("Combobox", "owner-filter", "Filters by owner; searchable for long lists", { label: "Owner", placeholder: "Anyone", options: data("owners"), size: "small" }),
      ),
      C("Table", "results", "The records; sortable, with an empty state", { caption: "Projects", captionHidden: true, rowKey: "id", columns: data("columns"), rows: data("rows"), emptyMessage: "No projects match these filters." }),
    ),
  },
  {
    id: "detail",
    name: "Detail page",
    description: "One record: breadcrumb, title with status, actions, tabs for its sections and a delete confirmation.",
    aliases: ["show page", "view page", "record page", "profile", "item page", "single"],
    rules: [
      "The breadcrumb leads back to the list page; the last item is the current record.",
      "Status is a Badge next to the title, using tone for meaning.",
      "Edit is a ghost button; rarer actions go in the More menu, destructive ones last with danger.",
      "Each tab is one section; keep the most used first.",
    ],
    data: {
      trail: [
        { label: "Projects", href: "/projects" },
        { label: "Website redesign", isCurrent: true },
      ],
      tabs: [
        { label: "Overview", value: "overview" },
        { label: "Tasks", value: "tasks", count: 12 },
        { label: "Files", value: "files" },
      ],
      moreActions: [
        { label: "Duplicate", value: "duplicate" },
        { label: "Archive", value: "archive" },
        { label: "Delete", value: "delete", danger: true, divider: true },
      ],
    },
    state: { tab: "overview", confirmOpen: false },
    tree: L(
      "page",
      C("Breadcrumb", "trail", "Where this record sits", { items: data("trail"), size: "small" }),
      L(
        "header",
        L("stack", L("row", T("h1", "Website redesign"), C("Badge", "status", "The record's status", { label: "Active", tone: "success", dot: true })), T("muted", "Owned by Alex Chen · due 30 Nov")),
        L(
          "row",
          C("Button", "edit", "Opens the edit form", { label: "Edit", type: "ghost" }),
          C("Menu", "more", "Less frequent actions", { label: "More", items: data("moreActions"), align: "end" }, { on: { onSelect: { set: "confirmOpen", to: true, when: "delete" } } }),
        ),
      ),
      C(
        "Tabs",
        "sections",
        "The record's sections",
        { label: "Project sections", tabs: data("tabs") },
        {
          bind: { selected: "tab" },
          on: { onChange: { store: "tab" } },
          children: [
            L(
              "grid",
              C("Card", "summary", "A group of facts", { title: "Summary", description: "Rebuild the marketing site on the new design system." }),
              C("Card", "budget", "A group of facts", { title: "Budget", description: "$48,000 · 62% used" }),
              C("Card", "team", "A group of facts", { title: "Team", description: "Alex Chen, Priya Nair and 3 others" }),
            ),
          ],
        },
      ),
      confirmDelete("this project", "Its tasks and files are deleted too. This can't be undone."),
    ),
  },
  {
    id: "form",
    name: "Form page",
    description: "Create or edit a record: grouped fields, validation messages, Cancel and Save, and a confirmation Toast.",
    aliases: ["create page", "edit page", "new record", "input form", "wizard step", "submission"],
    rules: [
      "Group related fields in Cards with a title; one column of fields reads fastest.",
      "Validate on submit and on blur, never while typing. Show the error under the field (state error and caption) and say how to fix it.",
      "The primary button names the result (\"Create project\"); Cancel is a ghost button to its left.",
      "After saving, show a success Toast and go back to the list or detail page.",
    ],
    data: {
      trail: [
        { label: "Projects", href: "/projects" },
        { label: "New project", isCurrent: true },
      ],
      owners: OWNERS,
    },
    state: { saved: false },
    tree: L(
      "page",
      C("Breadcrumb", "trail", "Where this form sits", { items: data("trail"), size: "small" }),
      L("header", L("stack", T("h1", "New project"), T("muted", "Projects group tasks, files and people."))),
      L(
        "narrow",
        C("Card", "details", "Groups the main fields", { title: "Details" }, {
          children: [
            L(
              "stack",
              C("InputText", "name", "Required text field", { label: "Project name", placeholder: "Website redesign" }),
              C("InputTextArea", "description", "Optional longer text", { label: "Description", placeholder: "What is it for?" }),
              C("Combobox", "owner", "Pick one from a long list", { label: "Owner", options: data("owners") }),
              C("DatePicker", "due", "A date", { placeholder: "Due date" }),
            ),
          ],
        }),
        C("Card", "notifications", "Groups the settings", { title: "Notifications" }, {
          children: [
            L(
              "stack",
              C("Toggle", "notify", "An instant on/off setting", { label: "Email me when tasks change" }),
              C("Checkbox", "public", "A yes/no choice saved with the form", { label: "Visible to everyone in the workspace" }),
            ),
          ],
        }),
        L(
          "actions",
          C("Button", "cancel", "Leaves without saving", { label: "Cancel", type: "ghost" }),
          C("Button", "save", "Saves the form", { label: "Create project", type: "cta" }, { on: { onClick: { set: "saved", to: true } } }),
        ),
      ),
      C("Toast", "saved", "Confirms the save", { title: "Project created", type: "success" }, { bind: { open: "saved" }, on: { onClose: { set: "saved", to: false } } }),
    ),
  },
  {
    id: "settings",
    name: "Settings page",
    description: "Settings in tabbed sections, each a Card, with a danger zone that confirms before deleting.",
    aliases: ["preferences", "account settings", "configuration", "admin settings", "profile settings"],
    rules: [
      "Toggles apply immediately; text fields save with a button in their Card.",
      "Put destructive settings last, in their own Card, with a danger button and a confirmation Modal.",
      "Tabs hold sections of five or fewer Cards; more sections means another tab.",
    ],
    data: {
      sections: [
        { label: "General", value: "general" },
        { label: "Notifications", value: "notifications" },
        { label: "Billing", value: "billing" },
      ],
      timezones: [
        { label: "Perth (AWST)", value: "Australia/Perth" },
        { label: "Sydney (AEDT)", value: "Australia/Sydney" },
        { label: "London (GMT)", value: "Europe/London" },
      ],
    },
    state: { section: "general", confirmOpen: false },
    tree: L(
      "page",
      L("header", L("stack", T("h1", "Settings"), T("muted", "Workspace settings apply to everyone."))),
      C(
        "Tabs",
        "sections",
        "Settings sections",
        { label: "Settings sections", tabs: data("sections") },
        {
          bind: { selected: "section" },
          on: { onChange: { store: "section" } },
          children: [
            L(
              "stack",
              C("Card", "workspace", "A group of related settings", { title: "Workspace", description: "Shown to members and in emails." }, {
                children: [
                  L(
                    "stack",
                    C("InputText", "workspace-name", "A text setting", { label: "Workspace name", placeholder: "Acme" }),
                    C("Combobox", "timezone", "Pick one from a long list", { label: "Time zone", options: data("timezones") }),
                    L("actions", C("Button", "save", "Saves this Card", { label: "Save changes", type: "cta" })),
                  ),
                ],
              }),
              C("Card", "alerts", "Instant settings", { title: "Alerts" }, {
                children: [
                  L(
                    "stack",
                    C("Toggle", "weekly", "An instant on/off setting", { label: "Weekly summary email", checked: true }),
                    C("Toggle", "mentions", "An instant on/off setting", { label: "Email me when I'm mentioned" }),
                  ),
                ],
              }),
              C("Card", "danger-zone", "Destructive settings, last", { title: "Danger zone", description: "Deleting the workspace removes every project for everyone." }, {
                children: [L("actions", C("Button", "delete", "Starts the destructive action", { label: "Delete workspace", type: "danger" }, { on: { onClick: { set: "confirmOpen", to: true } } }))],
              }),
            ),
          ],
        },
      ),
      confirmDelete("the workspace", "Every project, task and file is deleted for all members. This can't be undone."),
    ),
  },
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Key numbers in Cards, a time range, and a table of recent activity.",
    aliases: ["home", "overview", "analytics", "metrics", "kpi", "stats", "report"],
    rules: [
      "Four key numbers at most, each with what it measures and how it changed.",
      "Use Badge tone for trends (success up, danger down) and say the period (\"this week\").",
      "The table shows the latest items only and links to the full list page.",
    ],
    data: {
      ranges: [
        { label: "7 days", value: "7d" },
        { label: "30 days", value: "30d" },
        { label: "90 days", value: "90d" },
      ],
      columns: [
        { key: "item", label: "Project" },
        { key: "event", label: "What happened" },
        { key: "when", label: "When", align: "right" },
      ],
      rows: [
        { id: "a1", item: "Website redesign", event: "12 tasks completed", when: "Today" },
        { id: "a2", item: "Mobile app", event: "New release 2.4", when: "Yesterday" },
        { id: "a3", item: "Q3 report", event: "Archived", when: "3 Nov" },
      ],
    },
    state: { range: "7d" },
    tree: L(
      "page",
      L(
        "header",
        L("stack", T("h1", "Overview"), T("muted", "How your workspace is doing.")),
        C("Tabs", "range", "The period every number uses", { label: "Period", tabs: data("ranges"), variant: "pills", size: "small" }, { bind: { selected: "range" }, on: { onChange: { store: "range" } } }),
      ),
      L(
        "grid",
        C("Card", "active", "A key number", { title: "Active projects" }, { children: [T("stat", "24"), C("Badge", "active-trend", "How it changed", { label: "+3 this week", tone: "success" })] }),
        C("Card", "done", "A key number", { title: "Tasks completed" }, { children: [T("stat", "186"), C("Badge", "done-trend", "How it changed", { label: "+12%", tone: "success" })] }),
        C("Card", "overdue", "A key number", { title: "Overdue tasks" }, { children: [T("stat", "9"), C("Badge", "overdue-trend", "How it changed", { label: "+4 this week", tone: "danger" })] }),
      ),
      C("Table", "recent", "The latest activity", { caption: "Recent activity", rowKey: "id", columns: data("columns"), rows: data("rows"), emptyMessage: "Nothing has happened yet." }),
    ),
  },
  {
    id: "sign-in",
    name: "Sign-in page",
    description: "A centred sign-in form with email, password and an error message.",
    aliases: ["login", "log in", "auth", "authentication", "sign up", "register", "password"],
    rules: [
      "Only ask for what's needed. Label fields \"Email\" and \"Password\"; no placeholders as labels.",
      "Show sign-in errors in a Notification above the form, without saying which field was wrong.",
      "The submit button stays enabled; disable it only while the request runs.",
    ],
    data: {},
    state: {},
    tree: L(
      "center",
      L(
        "narrow",
        T("h1", "Sign in to Acme"),
        C("Card", "form", "Holds the form", {}, {
          children: [
            L(
              "stack",
              C("InputText", "email", "The account's email", { label: "Email", placeholder: "you@company.com" }),
              C("InputText", "password", "The account's password", { label: "Password", type: "password" }),
              C("Button", "submit", "Signs in", { label: "Sign in", type: "cta" }),
            ),
          ],
        }),
        T("muted", "No account? Ask your workspace owner for an invite."),
      ),
    ),
  },
];

/* ───────────────────────── Finding templates ───────────────────────── */

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The template for a request like "list", "admin index page" or "login". */
export function findTemplate(query: string): PageTemplate | undefined {
  const q = squash(query);
  if (!q) return undefined;
  const exact = PAGE_TEMPLATES.find((t) => squash(t.id) === q || squash(t.name) === q || t.aliases.some((a) => squash(a) === q));
  if (exact) return exact;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !["page", "the", "for", "with", "screen"].includes(w));
  let best: { t: PageTemplate; score: number } | undefined;
  for (const t of PAGE_TEMPLATES) {
    const hay = [t.id, t.name, ...t.aliases, t.description].join(" ").toLowerCase();
    const score = words.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
    if (score && (!best || score > best.score)) best = { t, score };
  }
  return best?.t;
}

/* ───────────────────────── Resolving parts to the org's components ───────────────────────── */

/** For each kit component: the concept to look for, and other names an org's own component might have. */
const PART_LOOKUP: Record<string, { concept?: Concept; names: string[] }> = {
  Button: { concept: "button", names: ["Btn"] },
  InputText: { concept: "input", names: ["TextInput", "TextField", "Input"] },
  InputTextArea: { concept: "textarea", names: ["Textarea", "TextArea"] },
  Combobox: { names: ["Autocomplete", "Typeahead", "SearchSelect"] },
  DatePicker: { concept: "datepicker", names: ["DateInput", "Calendar"] },
  Toggle: { concept: "toggle", names: ["Switch"] },
  Checkbox: { concept: "checkbox", names: [] },
  Modal: { concept: "dialog", names: ["Dialog"] },
  Tabs: { concept: "tabs", names: ["TabBar", "TabList"] },
  Card: { concept: "card", names: ["Panel", "Tile"] },
  Table: { concept: "table", names: ["DataTable", "DataGrid"] },
  Badge: { names: ["Tag", "Chip", "Pill", "Lozenge", "StatusLabel"] },
  Toast: { names: ["Snackbar"] },
  Menu: { names: ["ActionMenu", "DropdownMenu"] },
  Breadcrumb: { concept: "breadcrumb", names: ["Breadcrumbs"] },
};

interface Part {
  node: Extract<TNode, { kind: "c" }>;
  component?: ComponentEntry;
  usage?: ResolvedUsage | null;
}

function resolvePart(config: ResolvedConfig, kitName: string): ComponentEntry | undefined {
  const look = PART_LOOKUP[kitName] ?? { names: [] };
  for (const n of [kitName, ...look.names]) {
    const c = findComponentByName(config, n);
    if (c && c.status !== "deprecated") return c;
  }
  if (look.concept) {
    const c = componentForConcept(config, look.concept);
    if (c && c.status !== "deprecated") return c;
  }
  return undefined;
}

/* ───────────────────────── Rendering ───────────────────────── */

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const camel = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string) => s.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase());
const setter = (v: string) => `set${v[0]!.toUpperCase()}${v.slice(1)}`;
const KIT = "@brandrail/kit";
/** Types the kit exports for list props, so sample data in React is typed (align: "right" stays a literal). */
const KIT_TYPES = new Set(["TableColumn", "TableRow", "TabItem", "MenuItem", "ComboboxOption"]);

/** Kit enum props take Enum.MEMBER in React: "cta" → ButtonType.CTA. */
function enumOf(type: string | undefined, value: string): { name: string; ref: string } | undefined {
  const m = type ? /^(\w+) \(([^)]*)\)$/.exec(type) : null;
  if (!m) return undefined;
  const member = m[2]!.split("|").map((x) => x.trim()).find((x) => x.split(".")[1]?.toLowerCase().replace(/_/g, "-") === value.toLowerCase());
  return member ? { name: m[1]!, ref: member } : undefined;
}

/** Which of the part's props the component accepts, and under which name. Unknown prop lists pass everything through. */
function acceptedProps(part: Part, fw: Framework): Array<[string, string, unknown, PropSpec | undefined]> {
  const props = part.node.props ?? {};
  const list = part.usage?.props;
  const out: Array<[string, string, unknown, PropSpec | undefined]> = [];
  for (const [name, value] of Object.entries(props)) {
    if (!list?.length) {
      out.push([name, fw === "react" ? name : kebab(name), value, undefined]);
      continue;
    }
    const candidates = fw === "react" ? [name] : [kebab(name), name, ...(name === "title" ? ["heading"] : [])];
    const spec = list.find((p) => candidates.includes(p.name));
    if (spec) out.push([name, spec.name, value, spec]);
  }
  return out;
}

/** The DOM/framework event for a callback prop in this framework. */
function eventFor(part: Part, prop: string): string {
  const u = part.usage;
  const bare = kebab(prop.replace(/^on/, ""));
  const custom = u?.customElement || u?.via === "web-components";
  const events = u?.events ?? [];
  const hit = events.find((e) => e.name === `br-${bare}` || e.name === bare || e.name.endsWith(`-${bare}`) || camel(e.name) === camel(bare));
  if (hit) return hit.name;
  return custom ? `br-${bare}` : bare;
}

/** Sample data as code: one object per line. */
function literal(v: unknown, pad = ""): string {
  const one = (x: unknown): string =>
    x && typeof x === "object" && !Array.isArray(x)
      ? `{ ${Object.entries(x as Record<string, unknown>).map(([k, y]) => `${/^\w+$/.test(k) ? k : JSON.stringify(k)}: ${one(y)}`).join(", ")} }`
      : Array.isArray(x)
        ? `[${x.map(one).join(", ")}]`
        : JSON.stringify(x);
  if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object")) return `[\n${v.map((x) => `${pad}  ${one(x)},`).join("\n")}\n${pad}]`;
  return one(v);
}

const tokenVar = (path: string) => `var(--${path.replace(/\./g, "-")})`;

function nearest(scale: number[], want: number): number {
  const s = scale.filter((v) => v > 0 && v < 999);
  return s.length ? s.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a)) : want;
}

/** Layout classes on the Brand Kit's spacing scale and colour variables. */
export function templateCss(config: BrandrailConfig): string {
  const r = resolveConfig(config);
  const sp = (v: number) => `${nearest(r.spacing, v)}px`;
  const flat = flattenTokens(config.tokens ?? {});
  const roles = pickColorRoles(flat.filter((t) => t.type === "color").map((t) => ({ path: t.path, value: String(t.value), dark: t.dark ? String(t.dark) : undefined })));
  const color = (role: "fg" | "muted" | "canvas" | "border") => (roles[role].path ? tokenVar(roles[role].path!) : undefined);
  const font = flat.find((t) => t.type === "fontFamily" || /^font\.family\./.test(t.path));
  const decl = (prop: string, v: string | undefined) => (v ? ` ${prop}: ${v};` : "");
  return [
    `/* Page layout on the Brand Kit's spacing scale. Components style themselves. */`,
    `.pg {${decl("color", color("fg"))}${decl("background", color("canvas"))}${decl("font-family", font ? tokenVar(font.path) : undefined)} display: grid; grid-template-columns: minmax(0, 1fr); gap: ${sp(24)}; max-width: 1200px; margin: 0 auto; padding: ${sp(32)} ${sp(24)}; }`,
    `.pg-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: ${sp(16)}; }`,
    `.pg h1 { margin: 0; font-size: 24px; line-height: 1.25; }`,
    `.pg-muted { margin: 0;${decl("color", color("muted"))} }`,
    `.pg-stat { margin: 0 0 ${sp(8)}; font-size: 30px; font-weight: 600; line-height: 1.2; }`,
    `.pg-stack { display: grid; grid-template-columns: minmax(0, 1fr); gap: ${sp(16)}; align-content: start; }`,
    `.pg-row { display: flex; flex-wrap: wrap; align-items: center; gap: ${sp(12)}; }`,
    `.pg-grid { display: grid; gap: ${sp(16)}; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }`,
    `.pg-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: ${sp(8)}; }`,
    `.pg-narrow { display: grid; grid-template-columns: minmax(0, 1fr); gap: ${sp(16)}; width: 100%; max-width: 640px; }`,
    `.pg-center { min-height: 100dvh; display: grid; place-items: center; padding: ${sp(24)}; }`,
    `.pg-center .pg-narrow { max-width: 400px; }`,
    `@media (max-width: 640px) { .pg { padding: ${sp(24)} ${sp(16)}; } .pg-header { flex-direction: column; } }`,
  ].join("\n");
}

const LAYOUT_TAG: Record<Layout, string> = { page: "main", header: "header", stack: "div", row: "div", grid: "div", actions: "div", center: "main", narrow: "div" };
const LAYOUT_CLASS: Record<Layout, string> = { page: "pg", header: "pg-header", stack: "pg-stack", row: "pg-row", grid: "pg-grid", actions: "pg-actions", center: "pg pg-center", narrow: "pg-narrow" };
const TEXT_TAG = { h1: "h1", h2: "h2", p: "p", muted: "p", stat: "p" } as const;
const TEXT_CLASS = { h1: "", h2: "", p: "", muted: "pg-muted", stat: "pg-stat" } as const;

function walk(n: TNode, visit: (p: Extract<TNode, { kind: "c" }>) => void) {
  if (n.kind === "c") {
    visit(n);
    n.children?.forEach((c) => walk(c, visit));
  } else if (n.kind === "layout") n.children.forEach((c) => walk(c, visit));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const jsonAttr = (v: unknown) => JSON.stringify(v).replace(/'/g, "&#39;");
const ind = (d: number) => "  ".repeat(d);

interface Ctx {
  fw: Framework;
  parts: Map<Extract<TNode, { kind: "c" }>, Part>;
  tpl: PageTemplate;
  /** React: enum names to import per package. */
  imports: Map<string, Set<string>>;
  /** Angular/Vue/HTML: handler functions to generate. */
  handlers: Array<{ name: string; param: boolean; body: string[] }>;
  /** HTML: listeners to attach. */
  listeners: string[];
}

function missing(part: Part, d: number, ctx: Ctx): string {
  const msg = `${pascal(part.node.part)}: no ${part.node.component} in your registry for ${FRAMEWORK_LABEL[ctx.fw]}. Ask find_component for "${part.node.purpose.toLowerCase()}", or build it with semantic HTML and the design tokens.`;
  return ctx.fw === "react" || ctx.fw === "solid" ? `${ind(d)}{/* ${msg} */}` : `${ind(d)}<!-- ${msg} -->`;
}

/** The action as code in the framework, from inside an event handler that receives `value` (or the event). */
function actStatement(a: Act, ctx: Ctx, value: string): string {
  const signals = ctx.fw === "react" || ctx.fw === "solid";
  if ("store" in a) return signals ? `${setter(a.store)}(${value})` : `${ctx.fw === "angular" ? "this." : ""}${a.store} = ${value}`;
  const assign = signals ? `${setter(a.set)}(${a.to})` : ctx.fw === "vue" ? `${a.set}.value = ${a.to}` : ctx.fw === "svelte" ? `${a.set} = ${a.to}` : `this.${a.set} = ${a.to}`;
  return a.when ? `if (${value} === ${JSON.stringify(a.when)}) ${assign};` : `${assign};`;
}

function renderNode(n: TNode, d: number, ctx: Ctx): string {
  if (n.kind === "text") {
    const tag = TEXT_TAG[n.as];
    const cls = TEXT_CLASS[n.as];
    const attr = cls ? ` ${ctx.fw === "react" ? "className" : "class"}="${cls}"` : "";
    return `${ind(d)}<${tag}${attr}>${esc(n.text)}</${tag}>`;
  }
  if (n.kind === "layout") {
    const tag = LAYOUT_TAG[n.as];
    const attr = `${ctx.fw === "react" ? "className" : "class"}="${LAYOUT_CLASS[n.as]}"`;
    return [`${ind(d)}<${tag} ${attr}>`, ...n.children.map((c) => renderNode(c, d + 1, ctx)), `${ind(d)}</${tag}>`].join("\n");
  }
  const part = ctx.parts.get(n)!;
  if (!part.usage) {
    const kids = (n.children ?? []).map((c) => renderNode(c, d, ctx));
    return [missing(part, d, ctx), ...kids].join("\n");
  }
  return ctx.fw === "react" ? renderReact(part, d, ctx) : renderMarkup(part, d, ctx);
}

function renderReact(part: Part, d: number, ctx: Ctx): string {
  const { node, usage, component } = part;
  const attrs: string[] = [];
  const isKit = component?.importPath === KIT;
  if (isKit) attrs.push(`theme="brandrail"`);
  for (const [, name, value, spec] of acceptedProps(part, "react")) {
    if (node.bind?.[name]) continue;
    if (isData(value)) attrs.push(`${name}={${value.$data}}`);
    else if (value === true) attrs.push(name);
    else if (typeof value === "string") {
      const e = isKit ? enumOf(spec?.type, value) : undefined;
      if (e) {
        attrs.push(`${name}={${e.ref}}`);
        const set = ctx.imports.get(component!.importPath) ?? new Set();
        set.add(e.name);
        ctx.imports.set(component!.importPath, set);
      } else attrs.push(`${name}="${attrEsc(value)}"`);
    } else attrs.push(`${name}={${JSON.stringify(value)}}`);
  }
  for (const [prop, v] of Object.entries(node.bind ?? {})) attrs.push(`${prop}={${v}}`);
  for (const [prop, a] of Object.entries(node.on ?? {})) {
    if ("store" in a) attrs.push(`${prop}={${setter(a.store)}}`);
    else if (a.when) attrs.push(`${prop}={(value) => { ${actStatement(a, ctx, "value")} }}`);
    else attrs.push(`${prop}={() => ${setter(a.set)}(${a.to})}`);
  }
  const open = `${ind(d)}<${usage!.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (!node.children?.length) return `${open} />`;
  return [`${open}>`, ...node.children.map((c) => renderNode(c, d + 1, ctx)), `${ind(d)}</${usage!.tag}>`].join("\n");
}

function renderMarkup(part: Part, d: number, ctx: Ctx): string {
  const { node, usage } = part;
  const fw = ctx.fw;
  const attrs: string[] = [];
  const id = node.part;
  const needsId = fw === "html" || fw === "web-components";
  const hasEvents = Object.keys(node.on ?? {}).length > 0;
  if (needsId && (hasEvents || isBoundTarget(node, ctx))) attrs.push(`id="${id}"`);
  const custom = Boolean(usage!.customElement || usage!.via === "web-components");
  if (fw === "svelte" || fw === "solid") return renderSignals(part, d, ctx, custom);
  for (const [prop, name, value] of acceptedProps(part, fw)) {
    if (node.bind?.[prop]) continue;
    if (isData(value)) {
      if (fw === "angular") attrs.push(`[${camel(prop)}]="${value.$data}"`);
      else if (fw === "vue") attrs.push(`:${camel(prop)}="${value.$data}"`);
      else attrs.push(`${name}='${jsonAttr(ctx.tpl.data[value.$data])}'`);
    } else if (value === true) attrs.push(name);
    else if (typeof value === "string") attrs.push(`${name}="${attrEsc(value)}"`);
    else attrs.push(`${name}='${jsonAttr(value)}'`);
  }
  for (const [prop, v] of Object.entries(node.bind ?? {})) {
    const start = ctx.tpl.state[v];
    const name = acceptedProps({ ...part, node: { ...node, props: { [prop]: true } } }, fw)[0]?.[1] ?? kebab(prop);
    if (fw === "angular") attrs.push(`[${camel(prop)}]="${v}"`);
    else if (fw === "vue") attrs.push(`:${camel(prop)}="${v}"`);
    else if (typeof start === "boolean") attrs.push(start ? name : `${name}="false"`);
    else if (typeof start === "string") attrs.push(`${name}="${attrEsc(start)}"`);
  }
  for (const [prop, a] of Object.entries(node.on ?? {})) {
    const ev = eventFor(part, prop);
    const detail = fw === "angular" ? (custom ? "$any($event).detail" : "$event") : custom ? "$event.detail" : "$event";
    if (fw === "angular" || fw === "vue") {
      if ("store" in a) attrs.push(`${fw === "angular" ? `(${ev})` : `@${ev}`}="${a.store} = ${detail}"`);
      else if (a.when) {
        const name = `on${pascal(node.part)}${pascal(prop.replace(/^on/, ""))}`;
        ctx.handlers.push({ name, param: true, body: [actStatement(a, ctx, "value")] });
        attrs.push(`${fw === "angular" ? `(${ev})` : `@${ev}`}="${name}(${detail})"`);
      } else attrs.push(`${fw === "angular" ? `(${ev})` : `@${ev}`}="${a.set} = ${a.to}"`);
    } else if (!("store" in a)) {
      // Plain HTML: a listener that flips the bound element's attribute.
      for (const target of boundTargets(a.set, ctx)) {
        const tPart = ctx.parts.get(target)!;
        const [prop2] = Object.entries(target.bind!).find(([, v]) => v === a.set)!;
        const attrName = acceptedProps({ ...tPart, node: { ...target, props: { [prop2]: true } } }, fw)[0]?.[1] ?? kebab(prop2);
        const set = a.to ? `setAttribute("${attrName}", "")` : `setAttribute("${attrName}", "false")`;
        const body = `document.getElementById("${target.part}").${set}`;
        ctx.listeners.push(`document.getElementById("${id}").addEventListener("${ev}", (e) => ${a.when ? `{ if (e.detail === ${JSON.stringify(a.when)}) ${body}; }` : body});`);
      }
    }
  }
  const open = `${ind(d)}<${usage!.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}>`;
  if (!node.children?.length) return `${open}</${usage!.tag}>`;
  return [open, ...node.children.map((c) => renderNode(c, d + 1, ctx)), `${ind(d)}</${usage!.tag}>`].join("\n");
}

/**
 * Svelte 5 and Solid. Custom elements get Svelte's `name={value}` (it sets the property when the element has one) or
 * Solid's `prop:name={value}`, and events as `onbr-change={…}` / `on:br-change={…}`. An org's own Svelte or Solid
 * components get plain props.
 */
function renderSignals(part: Part, d: number, ctx: Ctx, custom: boolean): string {
  const { node, usage } = part;
  const solid = ctx.fw === "solid";
  const attrs: string[] = [];
  // Solid sets attributes on custom elements unless told prop:; Svelte picks the property itself.
  const bindName = (prop: string, name: string) => (custom ? (solid ? `prop:${camel(prop)}` : camel(prop)) : name);
  for (const [prop, name, value] of acceptedProps(part, ctx.fw)) {
    if (node.bind?.[prop]) continue;
    if (isData(value)) attrs.push(`${bindName(prop, name)}={${value.$data}}`);
    else if (typeof value === "string") attrs.push(`${name}="${attrEsc(value)}"`);
    else if (value === true && !solid) attrs.push(name);
    else attrs.push(`${custom && !solid ? name : bindName(prop, name)}={${JSON.stringify(value)}}`);
  }
  for (const [prop, v] of Object.entries(node.bind ?? {})) attrs.push(`${bindName(prop, prop)}={${v}${solid ? "()" : ""}}`);
  for (const [prop, a] of Object.entries(node.on ?? {})) {
    const ev = eventFor(part, prop);
    const on = custom ? (solid ? `on:${ev}` : `on${ev}`) : prop;
    const arg = custom ? "e: CustomEvent" : "value: string";
    const val = custom ? "e.detail" : "value";
    if ("store" in a) attrs.push(`${on}={(${arg}) => ${solid ? `${setter(a.store)}(${val})` : `(${a.store} = ${val})`}}`);
    else if (a.when) {
      const name = `on${pascal(node.part)}${pascal(prop.replace(/^on/, ""))}`;
      ctx.handlers.push({ name, param: true, body: [actStatement(a, ctx, "value")] });
      attrs.push(`${on}={(${arg}) => ${name}(${val})}`);
    } else attrs.push(`${on}={() => ${solid ? `${setter(a.set)}(${a.to})` : `(${a.set} = ${a.to})`}}`);
  }
  const open = `${ind(d)}<${usage!.tag}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  if (!node.children?.length) return custom || !solid ? `${open}></${usage!.tag}>` : `${open} />`;
  return [`${open}>`, ...node.children.map((c) => renderNode(c, d + 1, ctx)), `${ind(d)}</${usage!.tag}>`].join("\n");
}

function boundTargets(stateVar: string, ctx: Ctx): Array<Extract<TNode, { kind: "c" }>> {
  const out: Array<Extract<TNode, { kind: "c" }>> = [];
  walk(ctx.tpl.tree, (n) => {
    if (Object.values(n.bind ?? {}).includes(stateVar)) out.push(n);
  });
  return out;
}

function isBoundTarget(n: Extract<TNode, { kind: "c" }>, ctx: Ctx): boolean {
  if (!n.bind) return false;
  let hit = false;
  walk(ctx.tpl.tree, (m) => {
    for (const a of Object.values(m.on ?? {})) if (!("store" in a) && Object.values(n.bind!).includes(a.set)) hit = true;
  });
  return hit;
}

export interface RenderedTemplate {
  template: PageTemplate;
  framework: Framework;
  /** Files to create, relative to the page's folder. */
  files: Array<{ path: string; lang: string; content: string }>;
  /** Each part and the component it uses (or that none was found). */
  parts: Array<{ part: string; purpose: string; component?: string; tag?: string; importLine?: string; setup?: string }>;
  /** Setup steps the components need, once per app. */
  setup: string[];
}

/** Renders a template in a framework from the org's registry and tokens. */
export function renderTemplate(config: BrandrailConfig, template: PageTemplate, framework: Framework): RenderedTemplate {
  const resolved = resolveConfig(config);
  const fw: Framework = framework === "web-components" ? "html" : framework;
  const parts = new Map<Extract<TNode, { kind: "c" }>, Part>();
  walk(template.tree, (node) => {
    const component = resolvePart(resolved, node.component);
    parts.set(node, { node, component, usage: component ? resolveUsage(component, framework) : null });
  });
  const ctx: Ctx = { fw, parts, tpl: template, imports: new Map(), handlers: [], listeners: [] };
  const base = template.id;
  const Name = `${pascal(base)}Page`;
  const css = templateCss(config);

  // Imports and setup, once each.
  const importLines = new Set<string>();
  const setup = new Set<string>();
  for (const p of parts.values()) {
    if (!p.usage) continue;
    if (p.usage.setup) setup.add(p.usage.setup);
    if (fw !== "react" && p.usage.importLine) importLines.add(p.usage.importLine);
  }

  if (fw === "react" && [...parts.values()].some((p) => p.usage && p.component?.importPath === KIT)) {
    setup.add(`Import \`${KIT}/styles.css\` and \`brandrail.tokens.css\` once at the app entry.`);
  } else setup.add("Import `brandrail.tokens.css` (from `npx brandrail init`) once at the app entry, so the layout and components get the Brand Kit's variables.");

  const body = renderNode(template.tree, fw === "react" || fw === "solid" ? 2 : fw === "vue" ? 1 : 0, ctx);
  // Custom-element packages, loaded once. Svelte and Solid load them in onMount: they need the browser (server rendering).
  const isCe = (p: Part) => Boolean(p.usage && (p.usage.via === "web-components" || p.usage.customElement));
  const cePackages = [
    ...new Set(
      [...parts.values()]
        .filter(isCe)
        .map((p) => p.component?.frameworks?.["web-components"]?.importPath ?? p.component?.frameworks?.html?.importPath)
        .filter((x): x is string => !!x && !/\.css(\?|$)/.test(x)),
    ),
  ];
  const ownImports = [...new Set([...parts.values()].filter((p) => p.usage && !isCe(p) && p.usage.importLine).map((p) => p.usage!.importLine!))];
  const usedData = Object.keys(template.data).filter((k) => JSON.stringify(template.tree).includes(`"$data":"${k}"`));
  const dataDecl = (decl: string, kw: string, pad = "", key = decl) => `${kw} ${decl} = ${literal(template.data[key], pad)};`;
  const files: RenderedTemplate["files"] = [];

  if (fw === "react") {
    // Type sample data with the kit's own types where a kit prop takes it.
    const dataType = new Map<string, string>();
    for (const p of parts.values()) {
      if (p.component?.importPath !== KIT || !p.usage) continue;
      for (const [, , value, spec] of acceptedProps(p, "react")) {
        const m = isData(value) && spec?.type ? /^(\w+)\[\]$/.exec(spec.type) : null;
        if (m && KIT_TYPES.has(m[1]!)) {
          dataType.set((value as { $data: string }).$data, `${m[1]}[]`);
          const set = ctx.imports.get(KIT) ?? new Set();
          set.add(`type ${m[1]}`);
          ctx.imports.set(KIT, set);
        }
      }
    }
    // Group React imports by package, with any kit enums used.
    const byPkg = new Map<string, Set<string>>();
    for (const p of parts.values()) {
      if (!p.usage || !p.component) continue;
      const set = byPkg.get(p.component.importPath) ?? new Set();
      set.add(p.component.name);
      byPkg.set(p.component.importPath, set);
    }
    for (const [pkg, names] of ctx.imports) for (const n of names) byPkg.get(pkg)?.add(n);
    const state = Object.entries(template.state);
    const code = [
      ...(state.length ? [`import { useState } from "react";`] : []),
      ...[...byPkg].map(([pkg, names]) => `import { ${[...names].sort((a, b) => a.replace(/^type /, "").localeCompare(b.replace(/^type /, ""))).join(", ")} } from "${pkg}";`),
      `import "./${base}-page.css";`,
      "",
      ...usedData.flatMap((k) => [dataDecl(dataType.has(k) ? `${k}: ${dataType.get(k)}` : k, "const", "", k), ""]),
      `export default function ${Name}() {`,
      ...state.map(([k, v]) => `  const [${k}, ${setter(k)}] = useState(${JSON.stringify(v)});`),
      ...(state.length ? [""] : []),
      "  return (",
      body,
      "  );",
      "}",
      "",
    ].join("\n");
    files.push({ path: `${pascal(base)}Page.tsx`, lang: "tsx", content: code }, { path: `${base}-page.css`, lang: "css", content: css + "\n" });
  } else if (fw === "angular") {
    const wc = [...parts.values()].some((p) => p.usage && (p.usage.via === "web-components" || p.usage.customElement));
    const ngImports = [...parts.values()].filter((p) => p.usage?.importLine && !(p.usage.via === "web-components" || p.usage.customElement)).map((p) => /import \{ (\w+) \}/.exec(p.usage!.importLine!)?.[1]).filter(Boolean) as string[];
    const ts = [
      `import { Component${wc ? ", CUSTOM_ELEMENTS_SCHEMA" : ""} } from "@angular/core";`,
      ...[...importLines],
      "",
      "@Component({",
      `  selector: "app-${base}-page",`,
      "  standalone: true,",
      ...(ngImports.length ? [`  imports: [${[...new Set(ngImports)].join(", ")}],`] : []),
      ...(wc ? ["  schemas: [CUSTOM_ELEMENTS_SCHEMA],"] : []),
      `  templateUrl: "./${base}-page.component.html",`,
      `  styleUrl: "./${base}-page.component.css",`,
      "})",
      `export class ${Name}Component {`,
      ...Object.entries(template.state).map(([k, v]) => `  ${k} = ${JSON.stringify(v)};`),
      ...usedData.map((k) => `  ${dataDecl(k, "readonly", "  ")}`),
      ...ctx.handlers.map((h) => `\n  ${h.name}(value: string) {\n    ${h.body.join("\n    ")}\n  }`),
      "}",
      "",
    ].join("\n");
    files.push(
      { path: `${base}-page.component.ts`, lang: "ts", content: ts },
      { path: `${base}-page.component.html`, lang: "html", content: body + "\n" },
      { path: `${base}-page.component.css`, lang: "css", content: css + "\n" },
    );
  } else if (fw === "svelte") {
    const state = Object.entries(template.state);
    const script = [
      `<script lang="ts">`,
      ...(cePackages.length ? [`import { onMount } from "svelte";`] : []),
      ...ownImports,
      `import "./${base}-page.css";`,
      "",
      ...(cePackages.length ? ["// Custom elements need the browser: load them once the page is mounted (fine with SvelteKit's server rendering).", `onMount(() => {
${cePackages.map((u) => `  import("${u}");`).join("\n")}
});`, ""] : []),
      ...state.map(([k, v]) => `let ${k} = $state(${JSON.stringify(v)});`),
      ...usedData.map((k) => dataDecl(k, "const")),
      ...ctx.handlers.map((h) => `\nfunction ${h.name}(value: string) {\n  ${h.body.join("\n  ")}\n}`),
      `</script>`,
    ].join("\n");
    files.push({ path: `${pascal(base)}Page.svelte`, lang: "svelte", content: `${script}\n\n${body}\n` }, { path: `${base}-page.css`, lang: "css", content: css + "\n" });
  } else if (fw === "solid") {
    const state = Object.entries(template.state);
    const solidImports = [...(state.length ? ["createSignal"] : []), ...(cePackages.length ? ["onMount"] : [])];
    const code = [
      ...(solidImports.length ? [`import { ${solidImports.join(", ")} } from "solid-js";`] : []),
      ...ownImports,
      `import "./${base}-page.css";`,
      "",
      ...usedData.flatMap((k) => [dataDecl(k, "const"), ""]),
      `export default function ${Name}() {`,
      ...state.map(([k, v]) => `  const [${k}, ${setter(k)}] = createSignal(${JSON.stringify(v)});`),
      ...ctx.handlers.map((h) => `  const ${h.name} = (value: string) => {\n    ${h.body.join("\n    ")}\n  };`),
      ...(cePackages.length ? ["  // Custom elements need the browser: load them once the page is in the DOM (fine with SolidStart's server rendering).", ...cePackages.map((u) => `  onMount(() => void import("${u}"));`)] : []),
      "",
      "  return (",
      body,
      "  );",
      "}",
      "",
    ].join("\n");
    files.push({ path: `${pascal(base)}Page.tsx`, lang: "tsx", content: code }, { path: `${base}-page.css`, lang: "css", content: css + "\n" });
    const prefixes = [...new Set([...parts.values()].filter(isCe).map((p) => (p.usage!.tag.includes("-") ? `${p.usage!.tag.split("-")[0]}-` : p.usage!.tag)))];
    if (prefixes.length) {
      files.push({
        path: "brandrail-elements.d.ts",
        lang: "ts",
        content: [
          "// Lets TypeScript accept the design system's custom elements in Solid TSX. Keep one copy in the app.",
          'import "solid-js";',
          "",
          'declare module "solid-js" {',
          "  namespace JSX {",
          "    interface IntrinsicElements {",
          ...prefixes.map((p) => `      [tag: \`${p}\${string}\`]: any;`),
          "    }",
          "  }",
          "}",
          "",
        ].join("\n"),
      });
    }
  } else if (fw === "vue") {
    const state = Object.entries(template.state);
    const script = [
      `<script setup lang="ts">`,
      ...(state.length ? [`import { ref } from "vue";`] : []),
      ...[...importLines],
      ...(state.length || usedData.length ? [""] : []),
      ...state.map(([k, v]) => `const ${k} = ref(${JSON.stringify(v)});`),
      ...usedData.map((k) => dataDecl(k, "const")),
      ...ctx.handlers.map((h) => `\nfunction ${h.name}(value: string) {\n  ${h.body.join("\n  ")}\n}`),
      `</script>`,
    ].join("\n");
    files.push({ path: `${pascal(base)}Page.vue`, lang: "vue", content: `${script}\n\n<template>\n${body}\n</template>\n\n<style scoped>\n${css}\n</style>\n` });
  } else {
    // Plain HTML has no import lines: load each web component package once.
    const loads = [
      ...new Set(
        [...parts.values()]
          .filter((p) => p.usage && (p.usage.via === "web-components" || p.usage.customElement))
          .map((p) => p.component?.frameworks?.["web-components"]?.importPath ?? p.component?.frameworks?.html?.importPath)
          .filter((x): x is string => !!x && !/\.css(\?|$)/.test(x)),
      ),
    ];
    const html = [
      "<!doctype html>",
      `<html lang="en">`,
      "<head>",
      `  <meta charset="utf-8" />`,
      `  <meta name="viewport" content="width=device-width, initial-scale=1" />`,
      `  <title>${esc(template.name)}</title>`,
      `  <link rel="stylesheet" href="brandrail.tokens.css" />`,
      `  <link rel="stylesheet" href="${base}-page.css" />`,
      ...loads.map((u) =>
        u === `${KIT}/elements`
          ? `  <script type="module" src="https://cdn.jsdelivr.net/npm/${KIT}@0.3/dist/elements.js"></script>`
          : `  <!-- Bundle this import, or map "${u}" to a URL with an import map. -->\n  <script type="module">import "${u}";</script>`,
      ),
      "</head>",
      "<body>",
      body
        .split("\n")
        .map((l) => `  ${l}`)
        .join("\n"),
      ...(ctx.listeners.length ? ["  <script type=\"module\">", ...ctx.listeners.map((l) => `    ${l}`), "  </script>"] : []),
      "</body>",
      "</html>",
      "",
    ].join("\n");
    files.push({ path: `${base}-page.html`, lang: "html", content: html }, { path: `${base}-page.css`, lang: "css", content: css + "\n" });
  }

  const list: RenderedTemplate["parts"] = [];
  for (const p of parts.values()) {
    list.push({
      part: p.node.part,
      purpose: p.node.purpose,
      component: p.usage ? p.component!.name : undefined,
      tag: p.usage?.tag,
      importLine: p.usage?.importLine,
      setup: p.usage?.setup,
    });
  }
  return { template, framework, files, parts: list, setup: [...setup] };
}

/** The template as Markdown for AI tools: what it's for, the files to create, its parts and rules. */
export function templateMarkdown(config: BrandrailConfig, template: PageTemplate, framework: Framework, org?: string): string {
  const r = renderTemplate(config, template, framework);
  const missingParts = r.parts.filter((p) => !p.component);
  const lines = [
    `# ${template.name} template${org ? ` (${org})` : ""} · ${FRAMEWORK_LABEL[framework]}`,
    "",
    template.description,
    "",
    "Start from these files: rename the sample data and labels to the real ones, keep the structure, components and layout classes. Then call validate_snippet with the files you wrote.",
    "",
  ];
  if (r.setup.length) lines.push("## Setup (once per app)", "", ...r.setup.map((s) => `- ${s}`), "");
  lines.push("## Files", "");
  for (const f of r.files) lines.push(`### ${f.path}`, "", "```" + f.lang, f.content.trimEnd(), "```", "");
  lines.push("## Parts", "", "| Part | Purpose | Component |", "| --- | --- | --- |");
  for (const p of r.parts) lines.push(`| ${p.part} | ${p.purpose} | ${p.component ? `${p.component} (\`<${p.tag}>\`)` : "_none in the registry_"} |`);
  if (missingParts.length) {
    lines.push("", `${missingParts.length} part${missingParts.length === 1 ? " has" : "s have"} no component in the registry for ${FRAMEWORK_LABEL[framework]}. Use find_component for each; if nothing fits, build it with semantic HTML and the design tokens, never another UI library.`);
  }
  lines.push("", "## Rules", "", ...[...template.rules, ...COMMON_RULES].map((x) => `- ${x}`), "");
  return lines.join("\n");
}

/** One line per template, for listing. */
export function templateList(): string {
  return PAGE_TEMPLATES.map((t) => `- \`${t.id}\` — ${t.name}: ${t.description}`).join("\n");
}
