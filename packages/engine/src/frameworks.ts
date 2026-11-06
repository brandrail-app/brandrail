import type { ComponentEntry, EventSpec, Framework, FrameworkUsage, PropSpec } from "./types.ts";

export const FRAMEWORKS: Framework[] = ["react", "angular", "vue", "svelte", "solid", "web-components", "html"];

export const FRAMEWORK_LABEL: Record<Framework, string> = {
  react: "React",
  angular: "Angular",
  vue: "Vue",
  svelte: "Svelte",
  solid: "Solid",
  "web-components": "Web Components",
  html: "Plain HTML",
};

/** Code fence language for examples. */
const LANG: Record<Framework, string> = { react: "tsx", angular: "html", vue: "vue", svelte: "svelte", solid: "tsx", "web-components": "html", html: "html" };

export const isFramework = (x: unknown): x is Framework => typeof x === "string" && (FRAMEWORKS as string[]).includes(x);

export interface ResolvedUsage {
  /** The framework asked for. */
  framework: Framework;
  /** Set when the component has no version for that framework and its web component is used instead. */
  via?: "web-components";
  /** The import to write, when there is one. */
  importLine?: string;
  /** How it's written in markup, e.g. "Button", "acme-button". */
  tag: string;
  setup?: string;
  example?: string;
  /** Code fence language for the example. */
  lang: string;
  /** Props / inputs it accepts: the React props, or the framework's own list when the registry has one. */
  props?: PropSpec[];
  /** Events it emits in this framework. */
  events?: EventSpec[];
  /** True when it's a custom element (its events carry the value in event.detail). */
  customElement?: boolean;
}

const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/\./g, "-").toLowerCase();

/** The custom-element prefix, e.g. "acme-" for "acme-date-picker". */
const prefixOf = (tag: string) => (tag.includes("-") ? `${tag.split("-")[0]}-` : tag);

function webComponentSetup(target: Framework, u: FrameworkUsage, tag: string): string | undefined {
  const load = u.importPath ? `Load it once with \`import "${u.importPath}";\` at the app entry.` : "";
  switch (target) {
    case "angular":
      return `Web component: add \`CUSTOM_ELEMENTS_SCHEMA\` to the \`schemas\` of every NgModule or standalone component whose template uses it (with module federation, each remote's modules too). ${load} Importing it again in another bundle is harmless.`.trim();
    case "vue":
      return `Web component: set \`compilerOptions.isCustomElement = (tag) => tag.startsWith("${prefixOf(tag)}")\` in the Vue config. ${load}`.trim();
    case "svelte":
      return `Web component: ${load || "load it once at the app entry."} In SvelteKit, import it in the root +layout.svelte inside onMount (custom elements need the browser). Svelte sets properties on custom elements, so lists and objects pass directly.`.trim();
    case "solid":
      return `Web component: ${load || "load it once at the app entry."} For TypeScript, add the ${prefixOf(tag)}* tags to JSX.IntrinsicElements once (declare module "solid-js" { namespace JSX { interface IntrinsicElements { … } } }); page templates include the file.`.trim();
    case "html":
      return u.importPath ? `Web component: load \`${u.importPath}\` once (a bundler import or \`<script type="module">\`).` : undefined;
    default:
      return u.setup ?? (load || undefined);
  }
}

/**
 * How to use a component in a framework, or null when the registry has no version of it for that framework.
 * The component's top-level fields are its React usage; a web component works in Angular, Vue and plain HTML too.
 */
export function resolveUsage(c: ComponentEntry, framework: Framework): ResolvedUsage | null {
  if (framework === "react") {
    return {
      framework,
      importLine: `import { ${c.name} } from "${c.importPath}";`,
      tag: c.name,
      example: c.example,
      lang: LANG.react,
      props: c.props,
    };
  }
  const own = c.frameworks?.[framework];
  if (own) return fromUsage(c, framework, framework, own);
  const wc = c.frameworks?.["web-components"];
  if (wc) {
    const r = fromUsage(c, framework, "web-components", wc);
    return { ...r, via: "web-components", setup: webComponentSetup(framework, wc, r.tag), importLine: framework === "html" ? undefined : r.importLine };
  }
  return null;
}

function fromUsage(c: ComponentEntry, framework: Framework, kind: Framework, u: FrameworkUsage): ResolvedUsage {
  const path = u.importPath?.trim();
  let tag = u.tag?.trim();
  let importLine: string | undefined;
  let setup = u.setup?.trim() || undefined;
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
      if (path && !setup) setup = /\.css(\?|$)/.test(path) ? `Include \`<link rel="stylesheet" href="${path}">\` once.` : /\.m?js(\?|$)/.test(path) ? `Include \`<script type="module" src="${path}"></script>\` once.` : undefined;
      break;
  }
  return {
    framework,
    importLine,
    tag: tag!,
    setup,
    example: u.example?.trim() || undefined,
    lang: LANG[kind],
    props: u.props?.length ? u.props : undefined,
    events: u.events?.length ? u.events : undefined,
    customElement: kind === "web-components" || (kind === "html" && tag!.includes("-")),
  };
}

/** Props that hold the component's current value, in the order to prefer for a two-way example. */
const VALUE_PROPS = ["value", "checked", "selected", "selected-date", "selectedDate"];

/**
 * How to pass values in and get them back out in this framework: binding syntax plus a one-line example.
 * Custom elements carry values in `event.detail`; Angular types `$event` on them as a plain Event, hence `$any`.
 */
export function bindingHowTo(u: ResolvedUsage): string[] {
  const ev = u.events?.[0];
  if (!ev) return [];
  const camel = (n: string) => n.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  const vp = u.props?.find((p) => VALUE_PROPS.includes(p.name))?.name;
  // Bindings set the element's property, which is camelCase (selectedDate); only static attributes are kebab-case.
  const valueProp = vp ? camel(vp) : undefined;
  const dashed = (u.props ?? []).find((p) => p.name.includes("-"))?.name;
  const caseNote = dashed ? ` Static attributes are kebab-case (\`${dashed}="…"\`); bindings use the camelCase property (\`${u.framework === "vue" ? ":" : "["}${camel(dashed)}${u.framework === "vue" ? "" : "]"}="expr"\`), never \`${u.framework === "vue" ? ":" : "["}${dashed}${u.framework === "vue" ? "" : "]"}\`.` : "";
  const attrs = (u.props ?? []).filter((p) => p.required).map((p) => `${p.name}="…"`).join(" ");
  const open = (extra: string) => `<${u.tag}${attrs ? ` ${attrs}` : ""}${extra}></${u.tag}>`;
  const ce = u.customElement || u.via === "web-components";
  switch (u.framework) {
    case "angular":
      if (!ce) return [`Outputs: bind with (${ev.name})="on${pascal(ev.name)}($event)".`];
      return [
        `Inputs: \`[prop]="expr"\` (objects and arrays work too). Events: \`(${ev.name})\` with the value in \`$any($event).detail\` (Angular types \`$event\` on custom elements as a plain Event, so \`$event.detail\` doesn't compile).${caseNote}`,
        `Example: \`${open(`${valueProp ? ` [${valueProp}]="model"` : ""} (${ev.name})="model = $any($event).detail"`)}\``,
      ];
    case "vue":
      return [
        ce
          ? `Props: \`:prop="expr"\`. Events: \`@${ev.name}\` with the value in \`$event.detail\`.${caseNote} Example: \`${open(`${valueProp ? ` :${valueProp}="model"` : ""} @${ev.name}="model = $event.detail"`)}\``
          : `Events: \`@${ev.name}="handler"\`.`,
      ];
    case "svelte":
      if (!ce) return [`Events: \`on${ev.name}={handler}\` (Svelte 5) or \`on:${ev.name}\` (Svelte 4).`];
      return [
        `Props: \`prop={expr}\` (Svelte sets the element's property, so lists and objects work). Events: \`on${ev.name}={(e) => …}\` with the value in \`e.detail\` (Svelte 5; \`on:${ev.name}\` in Svelte 4).`,
        `Example: \`${open(`${valueProp ? ` ${valueProp}={value}` : ""} on${ev.name}={(e) => (value = e.detail)}`)}\``,
      ];
    case "solid":
      if (!ce) return [`Events: \`on${pascal(ev.name)}={handler}\`.`];
      return [
        `Props: static strings as attributes; lists, objects and signals with \`prop:name={value()}\` (Solid sets attributes otherwise). Events: \`on:${ev.name}={(e) => …}\` with the value in \`e.detail\`.`,
        `Example: \`${open(`${valueProp ? ` prop:${valueProp}={value()}` : ""} on:${ev.name}={(e) => setValue(e.detail)}`)}\``,
      ];
    case "react":
      return [];
    default:
      return [`Events: \`el.addEventListener("${ev.name}", (e) => e.detail)\`. Set lists and objects as properties (\`el.items = […]\`) or as JSON attributes.`];
  }
}

const pascal = (s: string) => s.replace(/(^|[-_:])(\w)/g, (_, __, c: string) => c.toUpperCase());

/** Which frameworks a component can be used in (web components count for Angular, Vue and HTML). */
export function availableFrameworks(c: ComponentEntry): Framework[] {
  return FRAMEWORKS.filter((f) => resolveUsage(c, f) !== null);
}

/** `<Button>` for JSX/Vue names, `<acme-button>` for selectors and custom elements. */
export const markup = (u: ResolvedUsage) => `<${u.tag}>`;

export interface PackageJsonLike {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * The project's UI framework from its package.json. Angular and Vue win over React (a few Angular apps carry React
 * for one widget, rarely the reverse). Svelte, Lit and Stencil projects use web components; no package.json is plain HTML.
 */
export function detectFramework(pkg: PackageJsonLike | null | undefined): Framework {
  if (!pkg) return "html";
  const deps = { ...pkg.peerDependencies, ...pkg.devDependencies, ...pkg.dependencies };
  const has = (name: string) => name in deps;
  if (has("@angular/core")) return "angular";
  if (has("vue") || has("nuxt")) return "vue";
  if (has("solid-js") || has("@solidjs/start")) return "solid";
  if (has("svelte") || has("@sveltejs/kit")) return "svelte";
  if (has("react") || has("next") || has("preact")) return "react";
  if (has("lit") || has("@stencil/core")) return "web-components";
  return "html";
}

/** Checks a frameworks object from user input or the database. Returns an error message, or null. */
export function validateFrameworks(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return "frameworks must be an object.";
  for (const [k, v] of Object.entries(value)) {
    if (!isFramework(k) || k === "react") return `Unknown framework "${k}". Use angular, vue, svelte, solid, web-components or html (React is the main import).`;
    if (!v || typeof v !== "object" || Array.isArray(v)) return `${k} must be an object.`;
    for (const [field, x] of Object.entries(v)) {
      if (field === "props") {
        if (!Array.isArray(x) || x.length > 100) return `${k}.props must be a list (at most 100).`;
        for (const p of x as unknown[]) {
          const ok = p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" && /^[A-Za-z_$][\w$.-]{0,59}$/.test((p as { name: string }).name);
          if (!ok) return `${k}.props has an invalid entry; each needs a name like "variant".`;
          const extra = Object.keys(p as object).find((f) => !["name", "required", "type", "description"].includes(f));
          if (extra) return `${k}.props: "${extra}" isn't a known field.`;
        }
        continue;
      }
      if (field === "events") {
        if (!Array.isArray(x) || x.length > 50) return `${k}.events must be a list (at most 50).`;
        for (const e of x as unknown[]) {
          const ok = e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string" && /^[A-Za-z][\w:.-]{0,59}$/.test((e as { name: string }).name);
          if (!ok) return `${k}.events has an invalid entry; each needs a name like "br-change".`;
          const d = (e as { detail?: unknown }).detail;
          if (d !== undefined && (typeof d !== "string" || d.length > 200)) return `${k}.events: detail must be short text.`;
          const extra = Object.keys(e as object).find((f) => !["name", "detail"].includes(f));
          if (extra) return `${k}.events: "${extra}" isn't a known field.`;
        }
        continue;
      }
      if (!["importPath", "importName", "tag", "setup", "example"].includes(field)) return `${k}.${field} isn't a known field.`;
      if (typeof x !== "string") return `${k}.${field} must be text.`;
      if (x.length > (field === "example" ? 2000 : 300)) return `${k}.${field} is too long.`;
    }
    const u = v as FrameworkUsage;
    if (u.tag && !/^[A-Za-z][A-Za-z0-9.-]*$/.test(u.tag)) return `${k}.tag "${u.tag}" isn't a valid tag name.`;
    if (k === "web-components" && u.tag && !/^[a-z][a-z0-9]*-[a-z0-9-]*$/.test(u.tag)) return `A custom element tag needs a dash, e.g. acme-button (got "${u.tag}").`;
    if (u.importName && !/^[A-Za-z_$][\w$]*(\s*,\s*[A-Za-z_$][\w$]*)*$/.test(u.importName)) return `${k}.importName "${u.importName}" isn't a valid name.`;
  }
  return null;
}
