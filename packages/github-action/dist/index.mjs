// src/index.ts
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { resolve as resolve2 } from "node:path";

// ../engine/src/color.ts
var clamp = (n, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));
function parseHex(hex) {
  let h = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}
function hslToRgb(h, s, l) {
  h = (h % 360 + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
function parseColor(input) {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) return parseHex(s);
  const m = s.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p, max) => p.endsWith("%") ? parseFloat(p) / 100 * max : parseFloat(p);
  const alpha = parts[3] !== void 0 ? num(parts[3], 1) : 1;
  if (m[1].startsWith("rgb")) {
    const [r2, g2, b2] = parts.slice(0, 3).map((p) => num(p, 255));
    if ([r2, g2, b2].some((v) => Number.isNaN(v))) return null;
    return { r: clamp(r2), g: clamp(g2), b: clamp(b2), a: alpha };
  }
  const [h, sat, l] = [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])];
  if ([h, sat, l].some((v) => Number.isNaN(v))) return null;
  const [r, g, b] = hslToRgb(h, sat, l);
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: alpha };
}
function toHex({ r, g, b }) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
function rgbToLab({ r, g, b }) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => t > 8856e-6 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}
function deltaE(a, b) {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// ../engine/src/tokens.ts
var EXT = "dev.brandrail";

// ../engine/src/governance.ts
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var DATE = /^\d{4}-\d{2}-\d{2}$/;
function tokenDeprecations(doc) {
  const out = [];
  const walk = (n, path) => {
    if (!isObj(n)) return;
    if ("$value" in n) {
      const d = n.$deprecated;
      if (d === void 0 || d === false) return;
      const ext = isObj(n.$extensions) && isObj(n.$extensions[EXT]) ? n.$extensions[EXT] : {};
      out.push({
        path,
        ...typeof ext.replacement === "string" && ext.replacement ? { replacement: ext.replacement } : {},
        ...typeof ext.removeAfter === "string" && DATE.test(ext.removeAfter) ? { removeAfter: ext.removeAfter } : {},
        ...typeof d === "string" && d.trim() ? { reason: d.trim() } : {}
      });
      return;
    }
    for (const [k, v] of Object.entries(n)) if (!k.startsWith("$")) walk(v, path ? `${path}.${k}` : k);
  };
  walk(doc, "");
  return out;
}

// ../engine/src/config.ts
var DEFAULT_IGNORE = [
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
  "**/__mocks__/**"
];
var DEFAULT_FORBIDDEN_IMPORTS = [
  "@mui/material",
  "@mui/joy",
  "@material-ui/core",
  "antd",
  "@chakra-ui/react",
  "react-bootstrap",
  "bootstrap",
  "@mantine/core",
  "semantic-ui-react",
  "primereact"
];
var NAME_TO_TAGS = {
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
  radio: ["input[type=radio]"]
};
var GENERIC_FONTS = /* @__PURE__ */ new Set([
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
  "fantasy"
]);
function leaves(doc, prefix = "", out = []) {
  if (!doc || typeof doc !== "object") return out;
  const obj = doc;
  if ("$value" in obj) {
    const ext = obj.$extensions?.["dev.brandrail"];
    out.push({ path: prefix, type: obj.$type, value: obj.$value, dark: ext?.modes?.dark });
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    leaves(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}
var px = (v) => {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(-?\d*\.?\d+)(px|rem)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "rem" ? n * 16 : n;
};
function normalizeFontFamily(value) {
  const first = value.split(",")[0] ?? "";
  return first.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
}
function isGenericFont(family) {
  return GENERIC_FONTS.has(family) || family.startsWith("var(");
}
var uniqSorted = (xs) => [...new Set(xs.map((x) => Math.round(x * 100) / 100))].sort((a, b) => a - b);
function resolveConfig(config) {
  const all = leaves(config.tokens);
  const colors = [];
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
  const spaceLeaves = all.filter((l) => /^(space|spacing)\./.test(l.path));
  const spacing = [0, 1, 2];
  const unit = px(spaceLeaves.find((l) => /\.unit$/.test(l.path))?.value);
  for (const l of spaceLeaves) {
    const v = px(l.value);
    if (v !== null && !/\.unit$/.test(l.path)) spacing.push(v);
  }
  if (unit) for (const m of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24]) spacing.push(unit * m);
  if (spacing.length === 3) for (const v of [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]) spacing.push(v);
  const radiusVals = all.filter((l) => /^(radius|radii|border-?radius)\./i.test(l.path)).map((l) => px(l.value)).filter((v) => v !== null);
  const radii = [0, 9999, ...radiusVals];
  if (radiusVals.length === 1) radii.push(Math.round(radiusVals[0] / 2), radiusVals[0] * 2);
  if (radiusVals.length === 0) radii.push(2, 4, 6, 8, 12, 16);
  const fontLeaves = all.filter((l) => (l.type === "fontFamily" || /^font\.family\./.test(l.path)) && typeof l.value === "string");
  const fonts = fontLeaves.map((l) => normalizeFontFamily(l.value));
  const fontVars = fontLeaves.map((l) => `--${l.path.replace(/\./g, "-")}`);
  const components = config.components ?? [];
  const replaces = /* @__PURE__ */ new Map();
  for (const c of components) {
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
    fontSizes: uniqSorted(all.filter((l) => /^font\.size\./.test(l.path)).map((l) => px(l.value)).filter((v) => v !== null)),
    components,
    deprecatedTokens: new Map(tokenDeprecations(config.tokens).map((d) => [`--${d.path.replace(/\./g, "-")}`, d])),
    replaces,
    rules: config.rules ?? {},
    ignore: [...DEFAULT_IGNORE, ...config.ignore ?? []],
    forbiddenImports: config.forbiddenImports ?? DEFAULT_FORBIDDEN_IMPORTS,
    colorTolerance: config.colorTolerance ?? 2.5,
    framework: config.framework
  };
}

// ../engine/src/frameworks.ts
var FRAMEWORK_LABEL = {
  react: "React",
  angular: "Angular",
  vue: "Vue",
  svelte: "Svelte",
  solid: "Solid",
  "web-components": "Web Components",
  html: "Plain HTML"
};
var LANG = { react: "tsx", angular: "html", vue: "vue", svelte: "svelte", solid: "tsx", "web-components": "html", html: "html" };
var kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\./g, "-").toLowerCase();
var prefixOf = (tag) => tag.includes("-") ? `${tag.split("-")[0]}-` : tag;
function webComponentSetup(target, u, tag) {
  const load = u.importPath ? `Load it once with \`import "${u.importPath}";\` at the app entry.` : "";
  switch (target) {
    case "angular":
      return `Web component: add \`CUSTOM_ELEMENTS_SCHEMA\` to the \`schemas\` of every NgModule or standalone component whose template uses it (with module federation, each remote's modules too). ${load} Importing it again in another bundle is harmless.`.trim();
    case "vue":
      return `Web component: set \`compilerOptions.isCustomElement = (tag) => tag.startsWith("${prefixOf(tag)}")\` in the Vue config. ${load}`.trim();
    case "svelte":
      return `Web component: ${load || "load it once at the app entry."} In SvelteKit, import it in the root +layout.svelte inside onMount (custom elements need the browser). Svelte sets properties on custom elements, so lists and objects pass directly.`.trim();
    case "solid":
      return `Web component: ${load || "load it once at the app entry."} For TypeScript, add the ${prefixOf(tag)}* tags to JSX.IntrinsicElements once (declare module "solid-js" { namespace JSX { interface IntrinsicElements { \u2026 } } }); page templates include the file.`.trim();
    case "html":
      return u.importPath ? `Web component: load \`${u.importPath}\` once (a bundler import or \`<script type="module">\`).` : void 0;
    default:
      return u.setup ?? (load || void 0);
  }
}
function resolveUsage(c, framework) {
  if (framework === "react") {
    return {
      framework,
      importLine: `import { ${c.name} } from "${c.importPath}";`,
      tag: c.name,
      example: c.example,
      lang: LANG.react,
      props: c.props
    };
  }
  const own = c.frameworks?.[framework];
  if (own) return fromUsage(c, framework, framework, own);
  const wc = c.frameworks?.["web-components"];
  if (wc) {
    const r = fromUsage(c, framework, "web-components", wc);
    return { ...r, via: "web-components", setup: webComponentSetup(framework, wc, r.tag), importLine: framework === "html" ? void 0 : r.importLine };
  }
  return null;
}
function fromUsage(c, framework, kind, u) {
  const path = u.importPath?.trim();
  let tag = u.tag?.trim();
  let importLine;
  let setup = u.setup?.trim() || void 0;
  switch (kind) {
    case "angular":
      tag ||= kebab(c.name);
      if (path && u.importName) {
        importLine = `import { ${u.importName} } from "${path}";`;
        setup ??= `Add \`${u.importName}\` to the standalone component's \`imports\` (or the NgModule's).`;
      }
      break;
    case "vue":
    case "svelte":
    case "solid":
      tag ||= u.importName || c.name;
      if (path) importLine = kind === "svelte" && !u.importName ? `import ${tag} from "${path}";` : `import { ${u.importName || tag} } from "${path}";`;
      break;
    case "web-components":
      tag ||= kebab(c.name);
      if (path) importLine = `import "${path}";`;
      break;
    case "html":
      tag ||= c.replaces?.[0]?.replace(/\[.*$/, "") || "div";
      if (path && !setup) setup = /\.css(\?|$)/.test(path) ? `Include \`<link rel="stylesheet" href="${path}">\` once.` : /\.m?js(\?|$)/.test(path) ? `Include \`<script type="module" src="${path}"></script>\` once.` : void 0;
      break;
  }
  return {
    framework,
    importLine,
    tag,
    setup,
    example: u.example?.trim() || void 0,
    lang: LANG[kind],
    props: u.props?.length ? u.props : void 0,
    events: u.events?.length ? u.events : void 0,
    customElement: kind === "web-components" || kind === "html" && tag.includes("-")
  };
}

// ../engine/src/components.ts
var SYNONYMS = {
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
  tabs: ["tab", "segmented"]
};
var norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function expand(words) {
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
function findComponents(config, intent, limit = 5) {
  const words = norm(intent).split(" ").filter((w) => w.length > 1);
  const query = expand(words);
  const q = squash(intent);
  const out = [];
  for (const c of config.components ?? []) {
    if (c.status === "deprecated") continue;
    const name = squash(c.name);
    let score = 0;
    if (name === q) score += 100;
    else if (q.includes(name) || name.includes(q)) score += 40;
    const nameTerms = expand([name, ...(c.aliases ?? []).map(squash), ...c.replaces ?? []]);
    for (const w of query) {
      if (nameTerms.has(w)) score += 20;
      else if (name.includes(w) && w.length > 2) score += 10;
    }
    const text = norm([c.description ?? "", ...c.usageRules ?? []].join(" "));
    for (const w of words) if (w.length > 2 && text.includes(w)) score += 3;
    if (score >= 3) out.push({ component: c, score: score + (c.status === "stable" ? 1 : 0) });
  }
  return out.sort((a, b) => b.score - a.score || a.component.name.localeCompare(b.component.name)).slice(0, limit);
}

// ../engine/src/migrate.ts
var IDENT = /^[A-Za-z_$][\w$]{0,99}$/;
var LIBRARY_LABEL = {
  mui: "MUI (Material UI)",
  "angular-material": "Angular Material",
  bootstrap: "Bootstrap",
  antd: "Ant Design",
  chakra: "Chakra UI",
  "react-bootstrap": "React Bootstrap",
  primeng: "PrimeNG"
};
var CONCEPT_TAG = {
  button: "button",
  input: "input",
  textarea: "textarea",
  select: "select",
  checkbox: "input[type=checkbox]",
  radio: "input[type=radio]",
  table: "table"
};
var REACT_LIBS = [
  {
    id: "mui",
    packages: /^(@mui\/material|@mui\/joy|@material-ui\/core|@mui\/x-date-pickers)(\/|$)/,
    names: {
      Button: "button",
      IconButton: "button",
      Fab: "button",
      LoadingButton: "button",
      TextField: "input",
      Input: "input",
      OutlinedInput: "input",
      Select: "select",
      Autocomplete: "select",
      NativeSelect: "select",
      Checkbox: "checkbox",
      Radio: "radio",
      RadioGroup: "radio",
      Switch: "toggle",
      Dialog: "dialog",
      Modal: "dialog",
      Drawer: "dialog",
      Tooltip: "tooltip",
      Avatar: "avatar",
      Chip: "label",
      Badge: "label",
      CircularProgress: "loader",
      Skeleton: "loader",
      LinearProgress: "progressbar",
      Breadcrumbs: "breadcrumb",
      Divider: "divider",
      Snackbar: "notification",
      Alert: "notification",
      DatePicker: "datepicker",
      DateField: "datepicker",
      Tabs: "tabs",
      Tab: "tabs",
      Card: "card",
      Paper: "card",
      Table: "table",
      TextareaAutosize: "textarea"
    }
  },
  {
    id: "antd",
    packages: /^antd(\/|$)/,
    names: {
      Button: "button",
      Input: "input",
      InputNumber: "input",
      Select: "select",
      Checkbox: "checkbox",
      Radio: "radio",
      Switch: "toggle",
      Modal: "dialog",
      Drawer: "dialog",
      Tooltip: "tooltip",
      Popover: "tooltip",
      Avatar: "avatar",
      Tag: "label",
      Badge: "label",
      Spin: "loader",
      Progress: "progressbar",
      Breadcrumb: "breadcrumb",
      Divider: "divider",
      Alert: "notification",
      DatePicker: "datepicker",
      Tabs: "tabs",
      Card: "card",
      Table: "table"
    }
  },
  {
    id: "chakra",
    packages: /^@chakra-ui\/react(\/|$)/,
    names: {
      Button: "button",
      IconButton: "button",
      Input: "input",
      Textarea: "textarea",
      Select: "select",
      Checkbox: "checkbox",
      Radio: "radio",
      Switch: "toggle",
      Modal: "dialog",
      Drawer: "dialog",
      Tooltip: "tooltip",
      Avatar: "avatar",
      Tag: "label",
      Badge: "label",
      Spinner: "loader",
      Progress: "progressbar",
      Breadcrumb: "breadcrumb",
      Divider: "divider",
      Alert: "notification",
      Tabs: "tabs",
      Card: "card",
      Table: "table"
    }
  },
  {
    id: "react-bootstrap",
    packages: /^react-bootstrap(\/|$)/,
    names: {
      Button: "button",
      Form: "input",
      FormControl: "input",
      FormSelect: "select",
      FormCheck: "checkbox",
      Modal: "dialog",
      Offcanvas: "dialog",
      Tooltip: "tooltip",
      OverlayTrigger: "tooltip",
      Badge: "label",
      Spinner: "loader",
      ProgressBar: "progressbar",
      Breadcrumb: "breadcrumb",
      Alert: "notification",
      Toast: "notification",
      Tabs: "tabs",
      Tab: "tabs",
      Card: "card",
      Table: "table"
    }
  }
];
var MAT_TAGS = {
  "mat-form-field": "input",
  "mat-select": "select",
  "mat-autocomplete": "select",
  "mat-checkbox": "checkbox",
  "mat-radio-group": "radio",
  "mat-radio-button": "radio",
  "mat-slide-toggle": "toggle",
  "mat-progress-bar": "progressbar",
  "mat-spinner": "loader",
  "mat-progress-spinner": "loader",
  "mat-datepicker": "datepicker",
  "mat-date-range-picker": "datepicker",
  "mat-divider": "divider",
  "mat-chip": "label",
  "mat-chip-listbox": "label",
  "mat-chip-option": "label",
  "mat-tab-group": "tabs",
  "mat-card": "card",
  "mat-table": "table",
  "mat-dialog-content": "dialog",
  "mat-button-toggle-group": "button"
};
var MAT_ATTRS = {
  "mat-button": "button",
  "mat-raised-button": "button",
  "mat-flat-button": "button",
  "mat-stroked-button": "button",
  "mat-icon-button": "button",
  "mat-fab": "button",
  "mat-mini-fab": "button",
  matButton: "button",
  matInput: "input",
  matTooltip: "tooltip",
  matBadge: "label",
  "mat-table": "table"
};
var PRIME_TAGS = {
  "p-button": "button",
  "p-dropdown": "select",
  "p-select": "select",
  "p-multiselect": "select",
  "p-checkbox": "checkbox",
  "p-radiobutton": "radio",
  "p-inputswitch": "toggle",
  "p-toggleswitch": "toggle",
  "p-dialog": "dialog",
  "p-avatar": "avatar",
  "p-tag": "label",
  "p-badge": "label",
  "p-progressspinner": "loader",
  "p-progressbar": "progressbar",
  "p-breadcrumb": "breadcrumb",
  "p-divider": "divider",
  "p-toast": "notification",
  "p-message": "notification",
  "p-calendar": "datepicker",
  "p-datepicker": "datepicker",
  "p-tabview": "tabs",
  "p-tabs": "tabs",
  "p-card": "card",
  "p-table": "table"
};
var BOOTSTRAP_CLASSES = [
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
  [/^card$/, "card", "card"]
];
var BOOTSTRAP_EVIDENCE = /\b(?:btn-(?:primary|secondary|success|danger|warning|info|light|dark|link|outline-[a-z]+)|form-control|form-select|form-check-input|custom-select|custom-control-input|spinner-border|spinner-grow|col-(?:xs|sm|md|lg|xl|xxl)-\d{1,2}|data-bs-[a-z]+|data-toggle)\b/;
function* matchAll(re, text) {
  let m;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while (m = g.exec(text)) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}
function findLegacyUsages(code, kind) {
  const out = [];
  if (kind === "css") return out;
  for (const lib of REACT_LIBS) {
    const local = /* @__PURE__ */ new Map();
    for (const m of matchAll(/\bimport\s+(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*(['"])([^'"]+)\3/g, code)) {
      if (!lib.packages.test(m[4])) continue;
      const sub = /\/([A-Z]\w*)$/.exec(m[4])?.[1];
      if (m[1] && sub && lib.names[sub]) local.set(m[1], sub);
      for (const part of (m[2] ?? "").split(",")) {
        const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
        const name = alias || orig;
        if (orig && lib.names[orig] && name && IDENT.test(name)) local.set(name, orig);
      }
    }
    if (!local.size) continue;
    const names = [...local.keys()].map((n) => n.replace(/\$/g, "\\$")).join("|");
    for (const m of matchAll(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
      const orig = local.get(m[1]);
      out.push({ offset: m.index, library: lib.id, what: `${LIBRARY_LABEL[lib.id].split(" ")[0]} <${orig}>`, concept: lib.names[orig] });
    }
  }
  for (const m of matchAll(/<((?:mat|p)-[a-z-]+)(?=[\s/>])([^>]*)>/g, code)) {
    const tag = m[1];
    const concept = MAT_TAGS[tag] ?? PRIME_TAGS[tag];
    if (concept) out.push({ offset: m.index, library: tag.startsWith("mat-") ? "angular-material" : "primeng", what: `<${tag}>`, concept });
  }
  for (const m of matchAll(/<([a-z][\w-]*)(?=[\s/>])([^>]*)>/g, code)) {
    for (const a of matchAll(/(?<=\s)\[?(mat-raised-button|mat-flat-button|mat-stroked-button|mat-icon-button|mat-button|mat-mini-fab|mat-fab|mat-table|matButton|matInput|matTooltip|matBadge)\]?(?=[\s=>/]|$)/g, m[2])) {
      const name = a[1];
      const concept = MAT_ATTRS[name];
      if (concept) out.push({ offset: m.index, library: "angular-material", what: `<${m[1]} ${name}>`, concept });
    }
  }
  if (!BOOTSTRAP_EVIDENCE.test(code)) return out.sort((a, b) => a.offset - b.offset);
  for (const m of matchAll(/\b(?:class|className)\s*=\s*(["'])([^"']*)\1/g, code)) {
    const seen = /* @__PURE__ */ new Set();
    for (const cls of m[2].split(/\s+/)) {
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
function componentForConcept(config, concept) {
  const tag = CONCEPT_TAG[concept];
  if (tag && config.replaces.get(tag)) return config.replaces.get(tag);
  return findComponents({ components: config.components }, concept, 1)[0]?.component;
}

// ../engine/src/rules.ts
var MARKUP = ["jsx", "vue", "svelte", "html", "template"];
var ALL = ["jsx", "vue", "svelte", "html", "template", "css"];
function* matches(re, text) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m;
  while (m = g.exec(text)) {
    yield m;
    if (m[0].length === 0) g.lastIndex++;
  }
}
var lineBefore = (code, offset, max = 80) => {
  const start = Math.max(code.lastIndexOf("\n", offset - 1) + 1, offset - max);
  return code.slice(start, offset);
};
var lineOf = (code, offset) => {
  const start = code.lastIndexOf("\n", offset - 1) + 1;
  const end = code.indexOf("\n", offset);
  return code.slice(start, end === -1 ? void 0 : end);
};
var fmt = (n) => `${Math.round(n * 100) / 100}px`;
function neighbours(scale, v) {
  const lower = [...scale].reverse().find((x) => x <= v);
  const upper = scale.find((x) => x >= v);
  const opts = [...new Set([lower, upper].filter((x) => x !== void 0))];
  return opts.map(fmt).join(" or ");
}
function pxValues(value) {
  const out = [];
  for (const m of matches(/(-?\d*\.?\d+)(px|rem)\b/g, value)) {
    const n = Math.abs(parseFloat(m[1])) * (m[2] === "rem" ? 16 : 1);
    out.push({ n, index: m.index });
  }
  return out;
}
var kebab2 = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
function styleBindings(code) {
  const out = [];
  const withUnit = (v, unit) => unit && /^-?\d*\.?\d+$/.test(v.trim()) ? `${v.trim()}${unit === "%" ? "%" : unit}` : v;
  for (const m of matches(/(['"])([a-zA-Z-]+)(?:\.(px|rem|em|%))?\1\s*:\s*(?:(['"`])([^'"`\n]*)\4|(-?\d*\.?\d+)(?![\w.]))/g, code)) {
    const value = m[5] ?? m[6];
    const offset = m.index + m[0].length - value.length - (m[5] !== void 0 ? 1 : 0);
    out.push({ prop: kebab2(m[2]), value: withUnit(value, m[3]), offset });
  }
  for (const m of matches(/(?<![\w.'"-])((?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block)(?:Start|End)?|rowGap|columnGap|border(?:Top|Bottom)?(?:Left|Right)?Radius)\s*:\s*(['"`])([^'"`\n]*\d(?:px|rem)[^'"`\n]*)\2/g, code)) {
    out.push({ prop: kebab2(m[1]), value: m[3], offset: m.index + m[0].length - m[3].length - 1 });
  }
  for (const m of matches(/\[style\.([a-zA-Z-]+)(?:\.(px|rem|em|%))?\]\s*=\s*(["'])([\s\S]*?)\3/g, code)) {
    const inner = m[4].trim();
    const lit = /^(['"`])(.*)\1$/.exec(inner)?.[2] ?? (/^-?\d*\.?\d+$/.test(inner) ? inner : null);
    if (lit === null) continue;
    out.push({ prop: kebab2(m[1]), value: withUnit(lit, m[2]), offset: m.index + m[0].length - 1 - m[4].length + m[4].indexOf(inner) });
  }
  return out;
}
function declValue(v, kind) {
  if (kind === "css") return v;
  const q = v[0];
  if (q === '"' || q === "'" || q === "`") {
    const end = v.indexOf(q, 1);
    return end === -1 ? v : v.slice(0, end + 1);
  }
  const cut = v.search(/["'`>]/);
  return cut === -1 ? v : v.slice(0, cut);
}
var SPACING_PROP = /^(?:(?:padding|margin)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)$/;
var RADIUS_PROP = /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/;
var noHardcodedColor = {
  id: "no-hardcoded-color",
  title: "Hard-coded colour",
  description: "Colours must come from Brand Kit tokens, not hex / rgb / hsl literals.",
  defaultSeverity: "error",
  kinds: ALL,
  check({ code, kind, config }) {
    if (config.colors.length === 0) return [];
    const out = [];
    const re = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|(?<![\w-])(?:rgba?|hsla?)\(\s*[^()]*\)/g;
    for (const m of matches(re, code)) {
      const raw = m[0];
      const before = lineBefore(code, m.index);
      const line = lineOf(code, m.index);
      if (raw.startsWith("#")) {
        const prev = code[m.index - 1] ?? "";
        if (/[A-Za-z0-9_&/]/.test(prev)) continue;
        if (/(?:href|to|id|xlink:href|for|aria-[a-z]+)\s*=\s*["'{`]?\s*$/i.test(before)) continue;
        if (/url\(\s*["']?$/.test(before)) continue;
      }
      if (/--[\w-]+\s*:\s*[^;{}]*$/.test(before)) continue;
      if (kind !== "css" && /^\s*(import|export)\s/.test(line) && !/style|color/i.test(line)) continue;
      const rgb = parseColor(raw);
      if (!rgb) continue;
      const lab = rgbToLab(rgb);
      let best = config.colors[0];
      let bestD = Infinity;
      for (const c of config.colors) {
        const d = deltaE(lab, c.lab) + Math.abs(rgb.a - (c.alpha ?? 1)) * 100;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (bestD <= config.colorTolerance) {
        out.push({
          offset: m.index,
          severity: "warning",
          message: `Hard-coded ${raw} matches the token ${best.path}`,
          suggestion: `Use var(${best.cssVar}) so it follows Brand Kit updates`
        });
      } else {
        out.push({
          offset: m.index,
          message: `${raw} is not in the Brand Kit`,
          suggestion: `Closest token is ${best.path} (${best.hex}, \u0394E ${bestD.toFixed(1)}): use var(${best.cssVar})`
        });
      }
    }
    return out;
  }
};
var PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
var UTIL = "bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|fill|stroke|from|via|to|outline|divide|placeholder|accent|caret|decoration|shadow";
var noRawPaletteClass = {
  id: "no-raw-palette-class",
  title: "Raw Tailwind palette class",
  description: "Use semantic token classes (bg-primary, text-muted) instead of Tailwind's default palette.",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code }) {
    const out = [];
    const re = new RegExp(`(?<![\\w-])((?:[a-z0-9-]+:)*)(${UTIL})-(${PALETTE})-(50|[1-9]00|950)(?:/\\d{1,3})?(?![\\w-])`, "g");
    for (const m of matches(re, code)) {
      out.push({
        offset: m.index + m[1].length,
        message: `Tailwind palette class ${m[0].slice(m[1].length)} bypasses the Brand Kit`,
        suggestion: `Use a semantic class mapped to a token, e.g. ${m[2]}-primary or ${m[2]}-muted`
      });
    }
    return out;
  }
};
var spacingScale = {
  id: "spacing-scale",
  title: "Off-scale spacing",
  description: "Padding, margin and gap must use the spacing scale.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, kind, config }) {
    const out = [];
    const scale = config.spacing;
    const ok = (n) => scale.some((s) => Math.abs(s - n) < 0.01);
    for (const m of matches(/(?<![\w-])(padding|margin|gap|row-gap|column-gap)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?\s*:\s*([^;{}\n]+)/g, code)) {
      const valueStart = m.index + m[0].length - m[2].length;
      for (const v of pxValues(declValue(m[2], kind))) {
        if (!ok(v.n)) out.push({ offset: valueStart + v.index, message: `${m[1]} ${fmt(v.n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, v.n)}` });
      }
    }
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])(padding|margin|gap|rowGap|columnGap)(?:Top|Right|Bottom|Left|Inline|Block|X|Y)?\s*:\s*(['"`]?)(-?\d*\.?\d+)\2(?=\s*[,}\n])/g, code)) {
        const n = Math.abs(parseFloat(m[3]));
        if (!ok(n)) out.push({ offset: m.index, message: `${m[1]} ${fmt(n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, n)}` });
      }
      for (const m of matches(/(?<![\w-])-?(p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-\[(-?\d*\.?\d+)(px|rem)\]/g, code)) {
        const n = Math.abs(parseFloat(m[2])) * (m[3] === "rem" ? 16 : 1);
        if (!ok(n)) out.push({ offset: m.index, message: `${m[0]} is off the spacing scale`, suggestion: `Use ${neighbours(scale, n)}` });
      }
      for (const b of styleBindings(code)) {
        if (!SPACING_PROP.test(b.prop)) continue;
        for (const v of pxValues(b.value)) {
          if (!ok(v.n)) out.push({ offset: b.offset + Math.min(v.index, b.value.length), message: `${b.prop} ${fmt(v.n)} is off the spacing scale`, suggestion: `Use ${neighbours(scale, v.n)}` });
        }
      }
    }
    return out;
  }
};
var radiusScale = {
  id: "radius-scale",
  title: "Off-scale corner radius",
  description: "Border radius must use the radius tokens.",
  defaultSeverity: "info",
  kinds: ALL,
  check({ code, kind, config }) {
    const out = [];
    const ok = (n) => n >= 999 || config.radii.some((r) => Math.abs(r - n) < 0.01);
    for (const m of matches(/(?<![\w-])border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius\s*:\s*([^;{}\n]+)/g, code)) {
      const valueStart = m.index + m[0].length - m[1].length;
      for (const v of pxValues(declValue(m[1], kind))) {
        if (!ok(v.n)) out.push({ offset: valueStart + v.index, message: `border-radius ${fmt(v.n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), v.n)}` });
      }
    }
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])borderRadius\s*:\s*(['"`]?)(\d*\.?\d+)\1(?=\s*[,}\n])/g, code)) {
        const n = parseFloat(m[2]);
        if (!ok(n)) out.push({ offset: m.index, message: `borderRadius ${fmt(n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), n)}` });
      }
      for (const m of matches(/(?<![\w-])rounded(?:-[a-z]{1,2})?-\[(\d*\.?\d+)px\]/g, code)) {
        const n = parseFloat(m[1]);
        if (!ok(n)) out.push({ offset: m.index, message: `${m[0]} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), n)}` });
      }
      for (const b of styleBindings(code)) {
        if (!RADIUS_PROP.test(b.prop)) continue;
        for (const v of pxValues(b.value)) {
          if (!ok(v.n)) out.push({ offset: b.offset, message: `${b.prop} ${fmt(v.n)} is not a radius token`, suggestion: `Use ${neighbours(config.radii.filter((r) => r < 999), v.n)}` });
        }
      }
    }
    return out;
  }
};
var fontFamily = {
  id: "font-family",
  title: "Unapproved font",
  description: "Only the Brand Kit's font families may be used.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, kind, config }) {
    if (config.fonts.length === 0) return [];
    const out = [];
    const allowed = config.fonts;
    const test = (value, offset) => {
      const fam = normalizeFontFamily(value);
      if (!fam || isGenericFont(fam) || allowed.includes(fam)) return;
      out.push({
        offset,
        message: `Font "${fam}" is not in the Brand Kit`,
        suggestion: `Use var(--font-family-sans) (${allowed[0]})`
      });
    };
    for (const m of matches(/(?<![\w-])font-family\s*:\s*([^;{}\n]+)/g, code)) test(declValue(m[1], kind), m.index);
    if (kind !== "css") {
      for (const m of matches(/(?<![\w-])fontFamily\s*:\s*(['"`])([^'"`]+)\1/g, code)) test(m[2], m.index);
      for (const m of matches(/(?<![\w-])font-\[([^\]]+)\]/g, code)) test(m[1].replace(/_/g, " "), m.index);
      for (const b of styleBindings(code)) if (b.prop === "font-family") test(b.value, b.offset);
    }
    return out;
  }
};
var TEXT_INPUT_TYPES = /* @__PURE__ */ new Set(["", "text", "email", "password", "number", "search", "tel", "url"]);
var preferOfficialComponent = {
  id: "prefer-official-component",
  title: "Re-invented component",
  description: "Use the design system component instead of a raw HTML element.",
  defaultSeverity: "error",
  kinds: MARKUP,
  check({ code, config, framework }) {
    if (config.replaces.size === 0) return [];
    const out = [];
    const baseTags = [...new Set([...config.replaces.keys()].map((k) => k.replace(/\[.*$/, "").replace(/[^a-z0-9-]/g, "")))].filter(Boolean);
    for (const m of matches(new RegExp(`<(${baseTags.join("|")})(?=[\\s>/])([^>]*)>`, "g"), code)) {
      const tag = m[1];
      const attrs = m[2];
      let comp = config.replaces.get(tag);
      if (tag === "input" || tag === "button") {
        const type = (attrs.match(/\btype\s*=\s*\{?\s*["'`]([\w-]+)["'`]/)?.[1] ?? "").toLowerCase();
        const specific = config.replaces.get(`${tag}[type=${type}]`);
        if (specific) comp = specific;
        else if (tag === "input" && !TEXT_INPUT_TYPES.has(type)) comp = type === "submit" || type === "button" ? config.replaces.get("button") : void 0;
      }
      if (!comp) continue;
      const usage = resolveUsage(comp, framework);
      if (!usage) continue;
      if (new RegExp(`(?:function|const|class)\\s+${escapeRe(comp.name)}\\b`).test(code)) continue;
      if (framework !== "react" && implementsTag(code, usage.tag)) continue;
      out.push({
        offset: m.index,
        message: `Raw <${tag}${tag === "input" && /type=/.test(attrs) ? ` type="${attrs.match(/type\s*=\s*\{?\s*["'`]([\w-]+)/)?.[1]}"` : ""}> re-implements ${comp.name}`,
        suggestion: useSuggestion(comp, usage)
      });
    }
    return out;
  }
};
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var IDENT2 = /^[A-Za-z_$][\w$]{0,99}$/;
var implementsTag = (code, tag) => new RegExp(`selector\\s*:\\s*['"\`]${escapeRe(tag)}['"\`]|customElements\\.define\\(\\s*['"\`]${escapeRe(tag)}['"\`]|@customElement\\(\\s*['"\`]${escapeRe(tag)}['"\`]`).test(code);
function useSuggestion(comp, u) {
  if (u.framework === "react") return `import { ${comp.name} } from "${comp.importPath}"`;
  const parts = [`Use <${u.tag}>`];
  if (u.importLine) parts.push(`(${u.importLine})`);
  return parts.join(" ");
}
var forbiddenImport = {
  id: "forbidden-import",
  title: "Other UI library",
  description: "Only the design system's component library may be imported.",
  defaultSeverity: "error",
  kinds: ALL,
  check({ code, config }) {
    const out = [];
    const lib = config.components[0]?.importPath;
    const re = /(?:\bimport\s[^'";]*?from\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*|@import\s+(?:url\(\s*)?)(['"])([^'"]+)\1/g;
    for (const m of matches(re, code)) {
      const spec = m[2];
      const bad = config.forbiddenImports.find((p) => spec === p || spec.startsWith(`${p}/`));
      if (!bad) continue;
      out.push({
        offset: m.index + m[0].indexOf(spec),
        message: `Imports ${bad}, which isn't part of the design system`,
        suggestion: lib ? `Use components from "${lib}"` : "Use the design system's components"
      });
    }
    return out;
  }
};
var imgAlt = {
  id: "img-alt",
  title: "Image without alt text",
  description: "Every <img> needs an alt attribute (empty for decorative images).",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code }) {
    const out = [];
    for (const m of matches(/<img(?=[\s/>])([^>]*)>/g, code)) {
      if (/(?<![\w-])alt\s*=/.test(m[1]) || /\{\s*\.\.\./.test(m[1])) continue;
      out.push({ offset: m.index, message: "<img> has no alt text", suggestion: 'Add alt="\u2026" describing the image, or alt="" if decorative' });
    }
    return out;
  }
};
var NATIVE_ATTRS = new Set(
  "id className style title role tabIndex hidden lang dir name value defaultValue defaultChecked checked disabled required readOnly autoFocus autoComplete placeholder type min max step maxLength minLength pattern form accept multiple href target rel download children".split(" ")
);
var ALWAYS_OK = /* @__PURE__ */ new Set(["key", "ref"]);
function importedComponents(code, components) {
  const out = /* @__PURE__ */ new Map();
  for (const m of matches(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g, code)) {
    const from = m[3];
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
      if (!orig) continue;
      const comp = components.find((c) => c.name === orig && c.importPath === from && c.props?.length);
      const name = alias || orig;
      if (comp && IDENT2.test(name)) out.set(name, comp);
    }
  }
  return out;
}
function skipBalanced(code, i) {
  const open = code[i];
  if (open === '"' || open === "'") {
    const end = code.indexOf(open, i + 1);
    return end === -1 ? code.length : end + 1;
  }
  let depth = 0;
  let quote = null;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (quote) {
      if (c === "\\") j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return code.length;
}
function parseAttributes(code, start) {
  const attrs = [];
  let spread = false;
  let i = start;
  while (i < code.length) {
    while (/\s/.test(code[i] ?? "")) i++;
    const c = code[i];
    if (c === void 0) return null;
    if (c === ">") return { attrs, spread, selfClosing: false };
    if (c === "/" && code[i + 1] === ">") return { attrs, spread, selfClosing: true };
    if (c === "{") {
      spread = true;
      i = skipBalanced(code, i);
      continue;
    }
    const name = /^[A-Za-z_$][\w$:.-]*/.exec(code.slice(i, i + 80))?.[0];
    if (!name) return null;
    attrs.push({ name, offset: i });
    i += name.length;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] === "=") {
      i++;
      while (/\s/.test(code[i] ?? "")) i++;
      i = skipBalanced(code, i);
    }
  }
  return null;
}
function parseHtmlAttributes(code, start) {
  const attrs = [];
  let i = start;
  while (i < code.length) {
    while (/\s/.test(code[i] ?? "")) i++;
    const c = code[i];
    if (c === void 0) return null;
    if (c === ">" || c === "/" && code[i + 1] === ">") return { attrs, end: i };
    if (c === "{" && code[i + 1] !== "{" && code[i + 1] !== "%") {
      const end = skipBalanced(code, i);
      const inner = code.slice(i + 1, end - 1).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(inner)) attrs.push({ name: inner, offset: i });
      i = end;
      continue;
    }
    if (c === "{" || c === "<" && code[i + 1] === "?") {
      const close = c === "{" ? code[i + 1] === "%" ? "%}" : "}}" : "?>";
      const e = code.indexOf(close, i + 2);
      i = e === -1 ? code.length : e + close.length;
      continue;
    }
    const name = /^[^\s=>/"'{]+/.exec(code.slice(i, i + 120))?.[0];
    if (!name) return null;
    attrs.push({ name, offset: i });
    i += name.length;
    while (/\s/.test(code[i] ?? "")) i++;
    if (code[i] === "=") {
      i++;
      while (/\s/.test(code[i] ?? "")) i++;
      const q = code[i];
      if (q === "{") i = skipBalanced(code, i);
      else if (q === '"' || q === "'") {
        const e = code.indexOf(q, i + 1);
        i = e === -1 ? code.length : e + 1;
      } else while (i < code.length && !/[\s>]/.test(code[i])) i++;
    }
  }
  return null;
}
var HTML_GLOBAL = /^(?:id|class|style|title|role|hidden|tabindex|lang|dir|slot|part|is|key|ref|name|for|form|aria-.+|data-.+)$/;
function propName(raw, framework) {
  let n = raw;
  if (/^(?:\(|@|on-|v-on:|\*|#|let-|ref-|v-(?!bind:|model:))/.test(n)) return null;
  if (/^(?:class|style|use|transition|in|out|animate|let|ref|on|oncapture|use):/.test(n)) return null;
  n = n.replace(/^(?:bind|prop|attr|bool):/, "");
  if (framework === "svelte" && /^on[a-z]/.test(n)) return null;
  n = n.replace(/^v-bind:|^v-model:|^bind-|^:/, "").replace(/^\[\(?|\)?\]$/g, "");
  if (/^(?:attr|class|style)\./.test(n) || /^ng[A-Z]/.test(n) || /^(?:formControl|formControlName|formGroup|routerLink|routerLinkActive)$/.test(n)) return null;
  n = n.replace(/\.(?:px|rem|em|%)$/, "").replace(/\..*$/, "");
  if (HTML_GLOBAL.test(n.toLowerCase())) return null;
  return n;
}
var sameName = (a, b) => a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();
var NATIVE_EVENT = /^(?:click|dblclick|auxclick|contextmenu|focus|blur|focusin|focusout|key(?:down|up|press)|mouse\w+|pointer\w+|touch\w+|wheel|drag\w*|drop|scroll|animation\w+|transition\w+)$/;
function eventName(raw, framework) {
  const m = /^\(([^)]+)\)$|^on-(.+)$|^@([^.]+)|^v-on:([^.]+)|^on(?:capture)?:([^|]+)/.exec(raw);
  if (m) return (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]).replace(/\..*$/, "");
  if (framework === "svelte" && /^on[a-z][\w-]*$/.test(raw)) return raw.slice(2);
  return null;
}
var listen = (framework, ev) => framework === "angular" ? `(${ev})` : framework === "vue" ? `@${ev}` : framework === "svelte" ? `on${ev}={\u2026}` : framework === "solid" ? `on:${ev}={\u2026}` : `"${ev}"`;
var detailOf = (framework) => framework === "angular" ? "$any($event).detail" : framework === "vue" ? "$event.detail" : framework === "svelte" || framework === "solid" ? "e.detail" : "event.detail";
function templateProps({ code, config, framework }) {
  const tagged = [];
  for (const comp of config.components) {
    const u = resolveUsage(comp, framework);
    if (u && (u.props?.length || u.events?.length)) tagged.push({ comp, tag: u.tag, props: u.props, events: u.events, ce: Boolean(u.customElement || u.via) });
  }
  if (!tagged.length) return [];
  const out = [];
  const forms = /* @__PURE__ */ new Map();
  for (const t of tagged) {
    forms.set(t.tag, t);
    if (framework === "vue") forms.set(t.tag.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), t);
  }
  const names = [...forms.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  for (const m of matches(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
    const t = forms.get(m[1]);
    const parsed = parseHtmlAttributes(code, m.index + m[0].length);
    if (!parsed) continue;
    const list = (t.props ?? []).map((p) => p.required ? `${p.name} (required)` : p.name).join(", ");
    const passed = [];
    for (const a of parsed.attrs) {
      const raw = a.name;
      const ev = eventName(raw, framework);
      if (ev) {
        if (!t.events?.length || NATIVE_EVENT.test(ev) || t.events.some((e) => e.name === ev)) continue;
        const like = t.events.find((e) => e.name.endsWith(`-${ev}`) || e.name.endsWith(ev)) ?? (t.events.length === 1 ? t.events[0] : void 0);
        out.push({
          offset: a.offset,
          message: `<${t.tag}> has no "${ev}" event`,
          suggestion: `${like ? `Listen to ${listen(framework, like.name)}${like.detail ? ` and read ${detailOf(framework)} (${like.detail})` : ""}. ` : ""}Events: ${t.events.map((e) => e.name).join(", ")}`
        });
        continue;
      }
      if (/^v-model$/.test(raw)) passed.push("modelValue", "value");
      if (/^\[\(ngModel\)\]$/.test(raw)) passed.push("value");
      const n = propName(raw, framework);
      if (!n || !t.props?.length) continue;
      passed.push(n);
      if (t.ce && n.includes("-") && (framework === "angular" || framework === "vue") && /^(?:\[(?!attr\.)|:|v-bind:|bind-)/.test(raw)) {
        const camel = n.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out.push({
          offset: a.offset,
          message: `${raw} binds a property that doesn't exist on <${t.tag}>`,
          suggestion: `Bind the camelCase property: ${framework === "vue" ? `:${camel}` : `[${camel}]`}="\u2026" (kebab-case is only for static attributes: ${n}="\u2026")`
        });
        continue;
      }
      if (t.props.some((p) => sameName(p.name, n))) continue;
      out.push({ offset: a.offset, message: `<${t.tag}> has no "${n}" input`, suggestion: `Remove it. ${t.comp.name} takes: ${list}` });
    }
    for (const p of t.props ?? []) {
      if (!p.required || passed.some((n) => sameName(n, p.name))) continue;
      if (p.name === "children" || p.name === "content") continue;
      out.push({ offset: m.index, message: `<${t.tag}> is missing the required "${p.name}" input`, suggestion: `Add ${p.name}${p.type ? ` (${p.type})` : ""}` });
    }
  }
  return out;
}
var componentProps = {
  id: "component-props",
  title: "Unknown or missing prop",
  description: "Design system components only accept their documented props, and required props must be passed.",
  defaultSeverity: "error",
  kinds: MARKUP,
  check(ctx) {
    if (ctx.framework !== "react" || ctx.kind !== "jsx") return templateProps(ctx);
    const { code, config } = ctx;
    if (!config.components.some((c) => c.props?.length)) return [];
    const imported = importedComponents(code, config.components);
    if (imported.size === 0) return [];
    const out = [];
    const names = [...imported.keys()].map(escapeRe).join("|");
    for (const m of matches(new RegExp(`<(${names})(?=[\\s/>])`, "g"), code)) {
      if (/[\w)\]]\s*$/.test(code.slice(Math.max(0, m.index - 20), m.index))) continue;
      const comp = imported.get(m[1]);
      const parsed = parseAttributes(code, m.index + m[0].length);
      if (!parsed) continue;
      const own = new Map(comp.props.map((p) => [p.name, p]));
      const list = comp.props.map((p) => p.required ? `${p.name} (required)` : p.name).join(", ");
      for (const a of parsed.attrs) {
        if (own.has(a.name) || ALWAYS_OK.has(a.name) || a.name.includes("-")) continue;
        if (comp.htmlAttributes && (NATIVE_ATTRS.has(a.name) || /^on[A-Z]/.test(a.name) || /^aria/.test(a.name))) continue;
        const sibling = config.components.find(
          (c) => c !== comp && c.importPath === comp.importPath && (c.name.startsWith(comp.name) || comp.name.startsWith(c.name)) && c.props?.some((p) => p.name === a.name)
        );
        out.push({
          offset: a.offset,
          message: `<${comp.name}> has no "${a.name}" prop`,
          suggestion: sibling ? `Use <${sibling.name}>, which has "${a.name}", or remove it. ${comp.name} props: ${list}` : `Remove it. ${comp.name} props: ${list}`
        });
      }
      if (!parsed.spread) {
        const passed = new Set(parsed.attrs.map((a) => a.name));
        for (const p of comp.props) {
          if (!p.required || passed.has(p.name) || p.name === "children" && !parsed.selfClosing) continue;
          out.push({ offset: m.index, message: `<${comp.name}> is missing the required "${p.name}" prop`, suggestion: `Add ${p.name}${p.type ? ` (${p.type})` : ""}` });
        }
      }
    }
    return out;
  }
};
var legacyLibrary = {
  id: "legacy-library",
  title: "Other UI library in use",
  description: "Pieces of Material, MUI, Bootstrap, Ant Design, Chakra or PrimeNG that a design system component replaces. The count is the migration still to do.",
  defaultSeverity: "warning",
  kinds: ["jsx", "vue", "svelte", "html", "template"],
  check({ code, kind, config, framework }) {
    const out = [];
    for (const u of findLegacyUsages(code, kind)) {
      const comp = componentForConcept(config, u.concept);
      const usage = comp ? resolveUsage(comp, framework) : null;
      out.push({
        offset: u.offset,
        message: `${u.what} (${LIBRARY_LABEL[u.library]}) should be ${comp ? comp.name : `a design system ${u.concept}`}`,
        suggestion: comp && usage ? useSuggestion(comp, usage) : comp ? `${comp.name} has no ${FRAMEWORK_LABEL[framework]} version yet: add one in the registry, or build it with tokens` : `No ${u.concept} component in the registry yet: add one, or build it with tokens and semantic HTML`
      });
    }
    return out;
  }
};
var whenGone = (d) => d.removeAfter ? ` and will be removed after ${d.removeAfter}` : "";
var deprecatedToken = {
  id: "deprecated-token",
  title: "Deprecated token",
  description: "Tokens the design system is retiring. They still work until their removal date; switch to the replacement.",
  defaultSeverity: "warning",
  kinds: ALL,
  check({ code, config }) {
    if (!config.deprecatedTokens.size) return [];
    const out = [];
    for (const m of matches(/var\(\s*(--[\w-]+)/g, code)) {
      const d = config.deprecatedTokens.get(m[1]);
      if (!d) continue;
      const repl = d.replacement ? `var(--${d.replacement.replace(/\./g, "-")})` : void 0;
      out.push({
        offset: m.index,
        message: `${m[1]} (${d.path}) is deprecated${whenGone(d)}`,
        suggestion: repl ? `Use ${repl}${d.reason ? `. ${d.reason}` : ""}` : d.reason || "Ask the design system team what replaces it"
      });
    }
    return out;
  }
};
var deprecatedComponent = {
  id: "deprecated-component",
  title: "Deprecated component",
  description: "Components the design system is retiring. They still work until their removal date; switch to the replacement.",
  defaultSeverity: "warning",
  kinds: MARKUP,
  check({ code, kind, config, framework }) {
    const dep = config.components.filter((c) => c.status === "deprecated");
    if (!dep.length) return [];
    const out = [];
    const report = (offset, c) => {
      const d = c.deprecation ?? {};
      out.push({
        offset,
        message: `${c.name} is deprecated${whenGone(d)}`,
        suggestion: d.replacement ? `Use ${d.replacement}${d.reason ? `. ${d.reason}` : ""}` : d.reason || "Ask the design system team what replaces it"
      });
    };
    if (framework === "react" && kind === "jsx") {
      for (const m of matches(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g, code)) {
        for (const part of m[1].split(",")) {
          const [orig, alias] = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).map((s) => s.trim());
          const c = dep.find((x) => x.name === orig && x.importPath === m[3]);
          if (!c || !IDENT2.test(alias || orig || "")) continue;
          const local = escapeRe(alias || orig);
          let used = false;
          for (const u of matches(new RegExp(`<${local}(?=[\\s/>])`, "g"), code)) {
            used = true;
            report(u.index, c);
          }
          if (!used) report(m.index, c);
        }
      }
      return out;
    }
    for (const c of dep) {
      const u = resolveUsage(c, framework);
      if (!u) continue;
      const tag = u.tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      for (const m of matches(new RegExp(`<${tag}(?=[\\s/>])`, "g"), code)) report(m.index, c);
    }
    return out;
  }
};
var RULES = [
  noHardcodedColor,
  noRawPaletteClass,
  preferOfficialComponent,
  forbiddenImport,
  spacingScale,
  fontFamily,
  radiusScale,
  imgAlt,
  componentProps,
  legacyLibrary,
  deprecatedToken,
  deprecatedComponent
];
var RULE_IDS = RULES.map((r) => r.id);

// ../engine/src/source.ts
var TEMPLATE_EXTENSIONS = ["mustache", "hbs", "handlebars", "php", "phtml", "twig", "njk", "liquid"];
function fileKind(path) {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (TEMPLATE_EXTENSIONS.includes(ext)) return "template";
  if (["tsx", "jsx", "ts", "js", "mjs", "cjs", "mdx"].includes(ext)) return "jsx";
  if (ext === "vue") return "vue";
  if (ext === "svelte") return "svelte";
  if (["html", "htm", "astro"].includes(ext)) return "html";
  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) return "css";
  return "other";
}
var SCANNABLE = /* @__PURE__ */ new Set(["jsx", "vue", "svelte", "html", "template", "css"]);
var ANGULAR_COMPONENT = /@Component\s*\(\s*\{/;
var ANGULAR_TEMPLATE = /\s(?:\[[\w.()-]+\]|\([\w.]+\)|\*ng[A-Z]\w*)\s*=|@(?:if|for|switch)\s*\(/;
function fileFramework(path, kind, code, project) {
  const p = path.toLowerCase();
  switch (kind) {
    case "vue":
      return "vue";
    case "svelte":
      return "svelte";
    case "template":
      return "html";
    case "css":
      return project ?? "react";
    case "html":
      if (p.endsWith(".component.html") || project === "angular" || ANGULAR_TEMPLATE.test(code)) return "angular";
      return project === "vue" || project === "web-components" ? project : "html";
    case "jsx":
      if (ANGULAR_COMPONENT.test(code)) return "angular";
      if (project === "solid" && /\.(tsx|jsx)$/.test(p)) return "solid";
      if (/\.(tsx|jsx|mdx)$/.test(p)) return "react";
      return project ?? "react";
    default:
      return project ?? "react";
  }
}
var blank = (s) => s.replace(/[^\n]/g, " ");
function stripComments(code, kind) {
  let out = code;
  if (kind === "html" || kind === "vue" || kind === "svelte" || kind === "template") {
    out = out.replace(/<!--[\s\S]*?-->/g, blank);
  }
  if (kind === "template") {
    out = out.replace(/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|\{\{--[\s\S]*?--\}\}|\{#[\s\S]*?#\}|\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, blank).replace(/<\?(?:php|=)?[\s\S]*?(?:\?>|$)/g, (block) => block.replace(/\/\*[\s\S]*?\*\/|(?<![:"'])\/\/[^\n]*?(?=\?>|\n|$)|(?<=\s)#[^\n]*?(?=\?>|\n|$)/g, blank));
    return out;
  }
  if (kind === "css") {
    return out.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)));
  }
  const chars = out.split("");
  let i = 0;
  let quote = null;
  while (i < chars.length) {
    const c = chars[i];
    const n = chars[i + 1];
    if (quote) {
      if (c === "\\") i += 2;
      else {
        if (c === quote) quote = null;
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = out.indexOf("*/", i + 2);
      const stop = end === -1 ? chars.length : end + 2;
      for (let j = i; j < stop; j++) if (chars[j] !== "\n") chars[j] = " ";
      i = stop;
      continue;
    }
    if (c === "/" && n === "/" && chars[i - 1] !== ":" && kind === "jsx") {
      while (i < chars.length && chars[i] !== "\n") chars[i++] = " ";
      continue;
    }
    i++;
  }
  return chars.join("");
}
var LineIndex = class {
  starts = [0];
  text;
  constructor(text) {
    this.text = text;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  position(offset) {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = lo + hi + 1 >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo] + 1 };
  }
  lineText(line) {
    const start = this.starts[line - 1] ?? 0;
    const end = this.starts[line] ?? this.text.length + 1;
    return this.text.slice(start, end - 1);
  }
  get lineCount() {
    return this.starts.length;
  }
};
function expandBraces(glob, out = []) {
  if (out.length > 64) return out;
  let depth = 0;
  let open = -1;
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "{") {
      if (depth++ === 0) open = i;
    } else if (glob[i] === "}" && depth > 0 && --depth === 0) {
      const parts = [];
      let d = 0;
      let from = open + 1;
      for (let j = open + 1; j < i; j++) {
        if (glob[j] === "{") d++;
        else if (glob[j] === "}") d--;
        else if (glob[j] === "," && d === 0) {
          parts.push(glob.slice(from, j));
          from = j + 1;
        }
      }
      parts.push(glob.slice(from, i));
      for (const p of parts) expandBraces(glob.slice(0, open) + p + glob.slice(i + 1), out);
      return out;
    }
  }
  out.push(glob);
  return out;
}
function tokenize(glob) {
  const toks = [];
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      while (glob[i + 1] === "*") i++;
      if (glob[i + 1] === "/") {
        i++;
        toks.push({ t: "dirs" });
      } else toks.push({ t: "globstar" });
    } else if (c === "*") toks.push({ t: "star" });
    else if (c === "?") toks.push({ t: "any" });
    else toks.push({ t: "lit", c });
  }
  return toks;
}
function matchTokens(toks, path) {
  const n = path.length;
  const seen = new Uint8Array((toks.length + 1) * (n + 1));
  const stack = [[0, 0]];
  while (stack.length) {
    const [ti, pi] = stack.pop();
    const key = ti * (n + 1) + pi;
    if (seen[key]) continue;
    seen[key] = 1;
    if (ti === toks.length) {
      if (pi === n) return true;
      continue;
    }
    const tok = toks[ti];
    const ch = path[pi];
    switch (tok.t) {
      case "lit":
        if (ch === tok.c) stack.push([ti + 1, pi + 1]);
        break;
      case "any":
        if (ch !== void 0 && ch !== "/") stack.push([ti + 1, pi + 1]);
        break;
      case "star":
        stack.push([ti + 1, pi]);
        if (ch !== void 0 && ch !== "/") stack.push([ti, pi + 1]);
        break;
      case "globstar":
        stack.push([ti + 1, pi]);
        if (ch !== void 0) stack.push([ti, pi + 1]);
        break;
      case "dirs":
        stack.push([ti + 1, pi]);
        for (let j = pi; j < n; j++) if (path[j] === "/") stack.push([ti + 1, j + 1]);
        break;
    }
  }
  return false;
}
function globMatcher(glob) {
  if (glob.length > 1e3) return () => false;
  const alts = expandBraces(glob).slice(0, 64).map(tokenize);
  return (path) => path.length <= 4096 && alts.some((t) => matchTokens(t, path));
}
function makeIgnore(globs) {
  const res = globs.map(globMatcher);
  return (path) => {
    const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
    return res.some((m) => m(p) || m(`/${p}`));
  };
}

// ../engine/src/check.ts
var ENGINE_VERSION = "0.10.5";
var WEIGHT = { error: 4, warning: 1.5, info: 0.25 };
function computeScore(counts, lines) {
  const penalty = counts.error * WEIGHT.error + counts.warning * WEIGHT.warning + counts.info * WEIGHT.info;
  if (penalty === 0) return 100;
  const perK = penalty / Math.max(1, lines / 1e3);
  return Math.max(0, Math.min(99, Math.round(100 / (1 + perK / 25))));
}
function check(files, configInput, opts = {}) {
  const t0 = Date.now();
  const config = "replaces" in configInput ? configInput : resolveConfig(configInput);
  const ignored = makeIgnore(config.ignore);
  const violations = [];
  let filesScanned = 0;
  let linesScanned = 0;
  for (const file of files) {
    const path = file.path.replace(/\\/g, "/").replace(/^\.\//, "");
    const kind = fileKind(path);
    if (!SCANNABLE.has(kind) || ignored(path)) continue;
    const only = opts.onlyLines?.get(path);
    if (opts.onlyLines && (!only || only.size === 0)) continue;
    filesScanned++;
    const idx = new LineIndex(file.content);
    linesScanned += only ? only.size : file.content.split("\n").filter((l) => l.trim()).length;
    const code = stripComments(file.content, kind);
    const framework = fileFramework(path, kind, code, config.framework);
    const seen = /* @__PURE__ */ new Set();
    for (const rule of RULES) {
      const setting = config.rules[rule.id];
      if (setting === "off" || !rule.kinds.includes(kind)) continue;
      for (const f of rule.check({ path, kind, code, config, framework })) {
        const { line, column } = idx.position(f.offset);
        if (only && !only.has(line)) continue;
        const key = `${rule.id}:${line}:${column}`;
        if (seen.has(key)) continue;
        seen.add(key);
        violations.push({
          ruleId: rule.id,
          severity: setting ?? f.severity ?? rule.defaultSeverity,
          file: path,
          line,
          column,
          message: f.message,
          suggestion: f.suggestion,
          snippet: opts.snippets === false ? void 0 : idx.lineText(line).trim().slice(0, 160)
        });
      }
    }
  }
  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
  const counts = { error: 0, warning: 0, info: 0 };
  const perRule = /* @__PURE__ */ new Map();
  for (const v of violations) {
    counts[v.severity]++;
    perRule.set(v.ruleId, (perRule.get(v.ruleId) ?? 0) + 1);
  }
  return {
    engineVersion: ENGINE_VERSION,
    tokenVersion: config.tokenVersion,
    score: computeScore(counts, linesScanned),
    counts,
    filesScanned,
    linesScanned,
    violations,
    byRule: [...perRule].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count),
    durationMs: Date.now() - t0
  };
}

// ../engine/src/report.ts
var RENDERED_ONLY = { "text-contrast": "Low text contrast", "font-size-scale": "Off-scale font size", "page-rendered": "Blank page" };
var title = (id) => RULES.find((r) => r.id === id)?.title ?? RENDERED_ONLY[id] ?? id;
var esc = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
var escProp = (s) => esc(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
function formatGithubAnnotations(report, max = 50) {
  const level = { error: "error", warning: "warning", info: "notice" };
  return report.violations.slice(0, max).map(
    (v) => `::${level[v.severity]} file=${escProp(v.file)},line=${v.line},col=${v.column},title=${escProp(`Brandrail: ${title(v.ruleId)}`)}::${esc(
      v.suggestion ? `${v.message}. ${v.suggestion}` : v.message
    )}`
  ).join("\n");
}
var COMMENT_MARKER = "<!-- brandrail-report -->";
function formatMarkdown(report, opts = {}) {
  const { threshold, maxRows = 30 } = opts;
  const pass = threshold === void 0 || report.score >= threshold;
  const badge = report.violations.length === 0 ? "\u{1F7E2}" : pass ? "\u{1F7E1}" : "\u{1F534}";
  const out = [COMMENT_MARKER];
  out.push(`## ${badge} Brand score: **${report.score}**/100${threshold !== void 0 ? ` (threshold ${threshold})` : ""}`);
  out.push("");
  out.push(
    `**${report.counts.error}** errors \xB7 **${report.counts.warning}** warnings \xB7 **${report.counts.info}** info \u2014 ${report.filesScanned} files scanned${report.tokenVersion ? ` against Brand Kit v${report.tokenVersion}` : ""}`
  );
  if (report.violations.length === 0) {
    out.push("", "Everything uses approved tokens and components. \u2728");
  } else {
    if (report.byRule.length) {
      out.push("", "| Rule | Count |", "| --- | ---: |");
      for (const r of report.byRule) out.push(`| ${title(r.ruleId)} \`${r.ruleId}\` | ${r.count} |`);
    }
    out.push("", "<details><summary>Violations</summary>", "", "| | Location | Issue | Fix |", "| --- | --- | --- | --- |");
    const icon = { error: "\u{1F534}", warning: "\u{1F7E1}", info: "\u{1F535}" };
    for (const v of report.violations.slice(0, maxRows)) {
      const loc = v.line === 0 ? `${v.file} ${v.snippet ?? ""}`.trim() : `${v.file}:${v.line}`;
      const url = opts.fileUrl?.(v);
      const cell = (s) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      out.push(`| ${icon[v.severity]} | ${url ? `[\`${loc}\`](${url})` : `\`${loc}\``} | ${cell(v.message)} | ${cell(v.suggestion ?? "")} |`);
    }
    if (report.violations.length > maxRows) out.push("", `\u2026and ${report.violations.length - maxRows} more.`);
    out.push("", "</details>");
  }
  out.push("", `<sub>Brandrail engine ${report.engineVersion}${opts.dashboardUrl ? ` \xB7 [Open in Brandrail](${opts.dashboardUrl})` : ""}</sub>`);
  return out.join("\n");
}

// ../engine/src/migrate-status.ts
var MIGRATION_RULES = new Set(RULES.map((r) => r.id).filter((id) => id !== "img-alt"));
var LABEL_TO_ID = new Map(Object.entries(LIBRARY_LABEL).map(([id, label]) => [label, id]));

// ../engine/src/templates.ts
var data = (name) => ({ $data: name });
var L = (as, ...children) => ({ kind: "layout", as, children });
var T = (as, text) => ({ kind: "text", as, text });
var C = (component, part, purpose, props = {}, extra = {}) => ({
  kind: "c",
  component,
  part,
  purpose,
  // Cards sit under the page's h1, so their titles are h2.
  props: component === "Card" && props.title && props.headingLevel === void 0 ? { ...props, headingLevel: 2 } : props,
  ...extra
});
var OWNERS = [
  { label: "Alex Chen", value: "alex" },
  { label: "Priya Nair", value: "priya" },
  { label: "Sam Taylor", value: "sam" }
];
var confirmDelete = (what, lost) => C("Modal", "confirm-delete", "Confirms the destructive action", { title: `Delete ${what}?`, description: lost, primaryLabel: "Delete", danger: true, size: "small" }, {
  bind: { open: "confirmOpen" },
  on: { onClose: { set: "confirmOpen", to: false }, onPrimary: { set: "confirmOpen", to: false } }
});
var PAGE_TEMPLATES = [
  {
    id: "list",
    name: "List page",
    description: "A table of records with a create button, filters and search. The index page of any section (projects, orders, users).",
    aliases: ["index", "table page", "records", "collection", "admin list", "crud", "overview list", "search results"],
    rules: [
      'The page title says what the records are; the create button names the thing ("New project", not "Add").',
      "Filters sit above the table and apply immediately; don't add an Apply button.",
      "Clicking a row opens its detail page. Long tables paginate on the server (manualSort and onSort).",
      "Confirm deletes with a Modal and report the result with a Toast offering Undo."
    ],
    data: {
      owners: OWNERS,
      statusTabs: [
        { label: "All", value: "all" },
        { label: "Active", value: "active" },
        { label: "Archived", value: "archived" }
      ],
      columns: [
        { key: "name", label: "Project", sortable: true },
        { key: "owner", label: "Owner", sortable: true },
        { key: "status", label: "Status" },
        { key: "tasks", label: "Open tasks", align: "right", sortable: true }
      ],
      rows: [
        { id: "p1", name: "Website redesign", owner: "Alex Chen", status: "Active", tasks: 12 },
        { id: "p2", name: "Mobile app", owner: "Priya Nair", status: "Active", tasks: 7 },
        { id: "p3", name: "Q3 report", owner: "Sam Taylor", status: "Archived", tasks: 0 }
      ]
    },
    state: { status: "all" },
    tree: L(
      "page",
      L("header", L("stack", T("h1", "Projects"), T("muted", "Every project in your workspace.")), C("Button", "create", "The page's one primary action", { label: "New project", type: "cta" })),
      L(
        "row",
        C("Tabs", "status-filter", "Filters the table by status", { label: "Status", tabs: data("statusTabs"), variant: "pills", size: "small" }, { bind: { selected: "status" }, on: { onChange: { store: "status" } } }),
        C("Combobox", "owner-filter", "Filters by owner; searchable for long lists", { label: "Owner", placeholder: "Anyone", options: data("owners"), size: "small" })
      ),
      C("Table", "results", "The records; sortable, with an empty state", { caption: "Projects", captionHidden: true, rowKey: "id", columns: data("columns"), rows: data("rows"), emptyMessage: "No projects match these filters." })
    )
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
      "Each tab is one section; keep the most used first."
    ],
    data: {
      trail: [
        { label: "Projects", href: "/projects" },
        { label: "Website redesign", isCurrent: true }
      ],
      tabs: [
        { label: "Overview", value: "overview" },
        { label: "Tasks", value: "tasks", count: 12 },
        { label: "Files", value: "files" }
      ],
      moreActions: [
        { label: "Duplicate", value: "duplicate" },
        { label: "Archive", value: "archive" },
        { label: "Delete", value: "delete", danger: true, divider: true }
      ]
    },
    state: { tab: "overview", confirmOpen: false },
    tree: L(
      "page",
      C("Breadcrumb", "trail", "Where this record sits", { items: data("trail"), size: "small" }),
      L(
        "header",
        L("stack", L("row", T("h1", "Website redesign"), C("Badge", "status", "The record's status", { label: "Active", tone: "success", dot: true })), T("muted", "Owned by Alex Chen \xB7 due 30 Nov")),
        L(
          "row",
          C("Button", "edit", "Opens the edit form", { label: "Edit", type: "ghost" }),
          C("Menu", "more", "Less frequent actions", { label: "More", items: data("moreActions"), align: "end" }, { on: { onSelect: { set: "confirmOpen", to: true, when: "delete" } } })
        )
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
              C("Card", "budget", "A group of facts", { title: "Budget", description: "$48,000 \xB7 62% used" }),
              C("Card", "team", "A group of facts", { title: "Team", description: "Alex Chen, Priya Nair and 3 others" })
            )
          ]
        }
      ),
      confirmDelete("this project", "Its tasks and files are deleted too. This can't be undone.")
    )
  },
  {
    id: "form",
    name: "Form page",
    description: "Create or edit a record: grouped fields, validation messages, Cancel and Save, and a confirmation Toast.",
    aliases: ["create page", "edit page", "new record", "input form", "wizard step", "submission"],
    rules: [
      "Group related fields in Cards with a title; one column of fields reads fastest.",
      "Validate on submit and on blur, never while typing. Show the error under the field (state error and caption) and say how to fix it.",
      'The primary button names the result ("Create project"); Cancel is a ghost button to its left.',
      "After saving, show a success Toast and go back to the list or detail page."
    ],
    data: {
      trail: [
        { label: "Projects", href: "/projects" },
        { label: "New project", isCurrent: true }
      ],
      owners: OWNERS
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
              C("DatePicker", "due", "A date", { placeholder: "Due date" })
            )
          ]
        }),
        C("Card", "notifications", "Groups the settings", { title: "Notifications" }, {
          children: [
            L(
              "stack",
              C("Toggle", "notify", "An instant on/off setting", { label: "Email me when tasks change" }),
              C("Checkbox", "public", "A yes/no choice saved with the form", { label: "Visible to everyone in the workspace" })
            )
          ]
        }),
        L(
          "actions",
          C("Button", "cancel", "Leaves without saving", { label: "Cancel", type: "ghost" }),
          C("Button", "save", "Saves the form", { label: "Create project", type: "cta" }, { on: { onClick: { set: "saved", to: true } } })
        )
      ),
      C("Toast", "saved", "Confirms the save", { title: "Project created", type: "success" }, { bind: { open: "saved" }, on: { onClose: { set: "saved", to: false } } })
    )
  },
  {
    id: "settings",
    name: "Settings page",
    description: "Settings in tabbed sections, each a Card, with a danger zone that confirms before deleting.",
    aliases: ["preferences", "account settings", "configuration", "admin settings", "profile settings"],
    rules: [
      "Toggles apply immediately; text fields save with a button in their Card.",
      "Put destructive settings last, in their own Card, with a danger button and a confirmation Modal.",
      "Tabs hold sections of five or fewer Cards; more sections means another tab."
    ],
    data: {
      sections: [
        { label: "General", value: "general" },
        { label: "Notifications", value: "notifications" },
        { label: "Billing", value: "billing" }
      ],
      timezones: [
        { label: "Perth (AWST)", value: "Australia/Perth" },
        { label: "Sydney (AEDT)", value: "Australia/Sydney" },
        { label: "London (GMT)", value: "Europe/London" }
      ]
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
                    L("actions", C("Button", "save", "Saves this Card", { label: "Save changes", type: "cta" }))
                  )
                ]
              }),
              C("Card", "alerts", "Instant settings", { title: "Alerts" }, {
                children: [
                  L(
                    "stack",
                    C("Toggle", "weekly", "An instant on/off setting", { label: "Weekly summary email", checked: true }),
                    C("Toggle", "mentions", "An instant on/off setting", { label: "Email me when I'm mentioned" })
                  )
                ]
              }),
              C("Card", "danger-zone", "Destructive settings, last", { title: "Danger zone", description: "Deleting the workspace removes every project for everyone." }, {
                children: [L("actions", C("Button", "delete", "Starts the destructive action", { label: "Delete workspace", type: "danger" }, { on: { onClick: { set: "confirmOpen", to: true } } }))]
              })
            )
          ]
        }
      ),
      confirmDelete("the workspace", "Every project, task and file is deleted for all members. This can't be undone.")
    )
  },
  {
    id: "dashboard",
    name: "Dashboard",
    description: "Key numbers in Cards, a time range, and a table of recent activity.",
    aliases: ["home", "overview", "analytics", "metrics", "kpi", "stats", "report"],
    rules: [
      "Four key numbers at most, each with what it measures and how it changed.",
      'Use Badge tone for trends (success up, danger down) and say the period ("this week").',
      "The table shows the latest items only and links to the full list page."
    ],
    data: {
      ranges: [
        { label: "7 days", value: "7d" },
        { label: "30 days", value: "30d" },
        { label: "90 days", value: "90d" }
      ],
      columns: [
        { key: "item", label: "Project" },
        { key: "event", label: "What happened" },
        { key: "when", label: "When", align: "right" }
      ],
      rows: [
        { id: "a1", item: "Website redesign", event: "12 tasks completed", when: "Today" },
        { id: "a2", item: "Mobile app", event: "New release 2.4", when: "Yesterday" },
        { id: "a3", item: "Q3 report", event: "Archived", when: "3 Nov" }
      ]
    },
    state: { range: "7d" },
    tree: L(
      "page",
      L(
        "header",
        L("stack", T("h1", "Overview"), T("muted", "How your workspace is doing.")),
        C("Tabs", "range", "The period every number uses", { label: "Period", tabs: data("ranges"), variant: "pills", size: "small" }, { bind: { selected: "range" }, on: { onChange: { store: "range" } } })
      ),
      L(
        "grid",
        C("Card", "active", "A key number", { title: "Active projects" }, { children: [T("stat", "24"), C("Badge", "active-trend", "How it changed", { label: "+3 this week", tone: "success" })] }),
        C("Card", "done", "A key number", { title: "Tasks completed" }, { children: [T("stat", "186"), C("Badge", "done-trend", "How it changed", { label: "+12%", tone: "success" })] }),
        C("Card", "overdue", "A key number", { title: "Overdue tasks" }, { children: [T("stat", "9"), C("Badge", "overdue-trend", "How it changed", { label: "+4 this week", tone: "danger" })] })
      ),
      C("Table", "recent", "The latest activity", { caption: "Recent activity", rowKey: "id", columns: data("columns"), rows: data("rows"), emptyMessage: "Nothing has happened yet." })
    )
  },
  {
    id: "sign-in",
    name: "Sign-in page",
    description: "A centred sign-in form with email, password and an error message.",
    aliases: ["login", "log in", "auth", "authentication", "sign up", "register", "password"],
    rules: [
      `Only ask for what's needed. Label fields "Email" and "Password"; no placeholders as labels.`,
      "Show sign-in errors in a Notification above the form, without saying which field was wrong.",
      "The submit button stays enabled; disable it only while the request runs."
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
              C("Button", "submit", "Signs in", { label: "Sign in", type: "cta" })
            )
          ]
        }),
        T("muted", "No account? Ask your workspace owner for an invite.")
      )
    )
  }
];

// ../engine/src/platforms.ts
var RESERVED = new Set(
  "as break case catch class const continue default do else enum extends extension false final for fun func if import in interface is let new null object operator package private protocol public return static struct super switch this throw true try type typealias val var void when where while with yield".split(" ")
);

// ../cli/src/api.ts
var DEFAULT_API = "https://www.brandrail.com.au";
var LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
var warned = false;
function apiBase() {
  const raw = process.env.BRANDRAIL_API_URL?.trim();
  if (!raw) return DEFAULT_API;
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`BRANDRAIL_API_URL isn't a URL: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.test(u.hostname))) throw new Error("BRANDRAIL_API_URL must use https (http only for localhost).");
  if (u.username || u.password || u.search || u.hash) throw new Error("BRANDRAIL_API_URL can't include a username, password, query or #fragment.");
  const base = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  if (base !== DEFAULT_API && !warned) {
    warned = true;
    process.stderr.write(`brandrail: using ${base} instead of ${DEFAULT_API} (BRANDRAIL_API_URL)
`);
  }
  return base;
}
async function call(path, init) {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${init.key}`, ...init.headers ?? {} }
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
  }
  if (!res.ok) {
    const msg = body?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(`Brandrail API ${path}: ${msg}`);
  }
  return body;
}
async function fetchBrandKit(key, version) {
  const res = await call(`/api/v1/brand-kit${version ? `?version=${encodeURIComponent(version)}` : ""}`, { method: "GET", key });
  const c = res?.config ?? {};
  const config = {
    ...typeof c.org === "string" ? { org: c.org } : {},
    ...typeof c.tokenVersion === "string" ? { tokenVersion: c.tokenVersion } : {},
    tokens: c.tokens && typeof c.tokens === "object" ? c.tokens : {},
    ...Array.isArray(c.components) ? { components: c.components } : {}
  };
  return { org: String(res?.org ?? ""), config, latestVersion: typeof res?.latestVersion === "string" ? res.latestVersion : void 0 };
}
function uploadReport(key, payload) {
  const report = payload.uploadSnippets ? payload.report : { ...payload.report, violations: payload.report.violations.map(({ snippet: _snippet, ...v }) => v) };
  return call("/api/v1/scans", { method: "POST", key, body: JSON.stringify({ ...payload, report }) });
}

// ../cli/src/files.ts
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
var MAX_FILE_BYTES = 512 * 1024;
function collectFiles(root, paths, ignoreGlobs) {
  const ignored = makeIgnore(ignoreGlobs);
  const out = [];
  const rel = (p) => relative(root, p).split(sep).join("/");
  const visit = (abs, named = false) => {
    const r = rel(abs);
    let st;
    try {
      st = named ? statSync(abs) : lstatSync(abs);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      const name = abs.split(sep).pop() ?? "";
      if (r && (ignored(`${r}/`) || ignored(`${r}/x`) || name.startsWith(".") && name !== "." && name !== ".github")) return;
      for (const entry of readdirSync(abs)) visit(join(abs, entry));
      return;
    }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return;
    if (fileKind(r) === "other" || ignored(r)) return;
    out.push({ path: r, content: readFileSync(abs, "utf8") });
  };
  for (const p of paths.length ? paths : ["."]) visit(resolve(root, p), true);
  return out;
}
function readConfig(path) {
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.tokens) {
    throw new Error(`${path} has no "tokens". Run \`brandrail init\` to create one.`);
  }
  return parsed;
}

// ../cli/src/git.ts
function parseChangedLines(diff) {
  const out = /* @__PURE__ */ new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      file = p === "/dev/null" ? null : p.replace(/^b\//, "");
      if (file && !out.has(file)) out.set(file, /* @__PURE__ */ new Set());
      continue;
    }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === void 0 ? 1 : Number(h[2]);
      const set = out.get(file);
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return out;
}

// src/index.ts
var env = (k) => (process.env[k] ?? "").trim();
var bool = (k, d) => env(k) ? env(k).toLowerCase() === "true" : d;
function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}
function event() {
  const p = env("GITHUB_EVENT_PATH");
  try {
    return p && existsSync2(p) ? JSON.parse(readFileSync2(p, "utf8")) : {};
  } catch {
    return {};
  }
}
function prChangedLines(baseSha) {
  let diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", "HEAD^1", "HEAD"]);
  if (diff === null) {
    git(["fetch", "--no-tags", "--depth=2", "origin", env("GITHUB_SHA") || "HEAD"]);
    diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", "HEAD^1", "HEAD"]);
  }
  if (diff === null && baseSha) {
    git(["fetch", "--no-tags", "--depth=1", "origin", baseSha]);
    diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", baseSha, "HEAD"]);
  }
  return diff === null ? null : parseChangedLines(diff);
}
async function upsertComment(body, prNumber) {
  const token = env("BR_GITHUB_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const api = env("GITHUB_API_URL") || "https://api.github.com";
  if (!token || !repo) return;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const list = await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, { headers });
  if (!list.ok) throw new Error(`list comments: ${list.status}`);
  const ours = (c) => c.user?.type === "Bot" || ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association ?? "");
  const existing = (await list.json()).find(
    (c) => c.body?.includes(COMMENT_MARKER) && ours(c)
  );
  const res = existing ? await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) }) : await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`${existing ? "update" : "create"} comment: ${res.status} (does the job have pull-requests: write?)`);
}
function setOutput(name, value) {
  const f = env("GITHUB_OUTPUT");
  if (f) appendFileSync(f, `${name}=${value}
`);
}
async function run() {
  if (env("BR_API_URL")) process.env.BRANDRAIL_API_URL = env("BR_API_URL");
  const key = env("BR_API_KEY");
  const cwd = process.cwd();
  const configPath = resolve2(cwd, env("BR_CONFIG") || "brandrail.config.json");
  let config;
  if (existsSync2(configPath)) config = readConfig(configPath);
  else if (key) config = (await fetchBrandKit(key)).config;
  else throw new Error(`No ${env("BR_CONFIG") || "brandrail.config.json"} and no api-key. Run \`npx brandrail init\` and commit the file, or set api-key.`);
  const resolved = resolveConfig(config);
  const files = collectFiles(cwd, [], resolved.ignore);
  const ev = event();
  const pr = ev.pull_request;
  const onlyLines = pr && bool("BR_CHANGED_ONLY", true) ? prChangedLines(pr.base.sha) ?? void 0 : void 0;
  if (pr && bool("BR_CHANGED_ONLY", true) && !onlyLines) console.log("::warning::Brandrail couldn't read the PR diff; checking all files.");
  const report = check(files, resolved, { onlyLines });
  const threshold = env("BR_FAIL_BELOW") ? Number(env("BR_FAIL_BELOW")) : void 0;
  console.log(formatGithubAnnotations(report));
  console.log(`Brand score ${report.score}/100 \xB7 ${report.counts.error} errors \xB7 ${report.counts.warning} warnings \xB7 ${report.counts.info} info \xB7 ${report.filesScanned} files`);
  setOutput("score", report.score);
  setOutput("errors", report.counts.error);
  const repo = env("GITHUB_REPOSITORY");
  const server = env("GITHUB_SERVER_URL") || "https://github.com";
  const sha = pr?.head.sha ?? env("GITHUB_SHA");
  let dashboardUrl;
  if (key) {
    try {
      const res = await uploadReport(key, {
        source: "ci",
        target: { kind: "repo", name: repo.split("/").pop() || repo, location: repo },
        ref: pr ? `#${pr.number}` : env("GITHUB_REF_NAME") || sha?.slice(0, 7),
        title: pr?.title ?? `Push to ${env("GITHUB_REF_NAME") || "branch"}`,
        threshold,
        report,
        uploadSnippets: bool("BR_UPLOAD_SNIPPETS", false)
      });
      dashboardUrl = res.url;
    } catch (e) {
      console.log(`::warning::Brandrail upload failed: ${e.message}`);
    }
  }
  const md = formatMarkdown(report, {
    threshold,
    dashboardUrl,
    fileUrl: (v) => repo && sha ? `${server}/${repo}/blob/${sha}/${v.file}#L${v.line}` : void 0
  });
  const summary = env("GITHUB_STEP_SUMMARY");
  if (summary) appendFileSync(summary, `${md}
`);
  if (pr && bool("BR_COMMENT", true)) {
    try {
      await upsertComment(md, pr.number);
    } catch (e) {
      console.log(`::warning::Brandrail couldn't comment on the PR: ${e.message}`);
    }
  }
  if (threshold !== void 0 && report.score < threshold) {
    console.log(`::error::Brand score ${report.score} is below the threshold of ${threshold}.`);
    return 1;
  }
  return 0;
}
run().then(
  (code) => process.exit(code),
  (err) => {
    console.log(`::error::Brandrail: ${err.message}`);
    process.exit(2);
  }
);
