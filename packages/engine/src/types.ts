export type Severity = "error" | "warning" | "info";
export type RuleSetting = Severity | "off";

/** W3C Design Tokens (DTCG) document: nested groups with { $type, $value } leaves. */
export type DtcgToken = { $type?: string; $value: unknown; $description?: string };
export type DtcgDoc = { [key: string]: DtcgToken | DtcgDoc | unknown };

export interface ComponentEntry {
  /** Component name as imported, e.g. "Button". */
  name: string;
  /** Package or path it is imported from, e.g. "@acme/ui". */
  importPath: string;
  /** Raw HTML elements this component replaces, e.g. ["button"]. Inferred from the name when omitted. */
  replaces?: string[];
  /** What it's for, in a sentence. Used by find_component. */
  description?: string;
  /** Other names people use for it, e.g. ["modal", "popup"] for Dialog. */
  aliases?: string[];
  /** Do / don't rules shown to AI tools, e.g. "One primary Button per view". */
  usageRules?: string[];
  /** A short usage example (JSX). */
  example?: string;
  status?: "draft" | "beta" | "stable" | "deprecated";
  /** With status "deprecated": what to use instead and when it goes. The Checker warns on every use. */
  deprecation?: { replacement?: string; removeAfter?: string; reason?: string };
  /** The props it accepts. When set, AI tools are told to use only these and the Checker flags any other prop. */
  props?: PropSpec[];
  /** Also accepts the native attributes of this HTML element (e.g. "input", "div"). */
  htmlAttributes?: string;
  /**
   * How to use it outside React. The top-level importPath / name / example are the React usage;
   * each entry here describes the same component in another framework.
   */
  frameworks?: Partial<Record<Exclude<Framework, "react">, FrameworkUsage>>;
}

export type Framework = "react" | "angular" | "vue" | "svelte" | "solid" | "web-components" | "html";

export interface FrameworkUsage {
  /** Package, module or file it comes from, e.g. "@acme/ui-angular", or a stylesheet URL for plain HTML. */
  importPath?: string;
  /** What to import, e.g. "ButtonModule" (Angular) or "AcmeButton" (Vue). Not used for web components and HTML. */
  importName?: string;
  /** How it's written in markup: "acme-button" (Angular selector, custom element), "AcmeButton" (Vue). */
  tag?: string;
  /** One-line setup note, e.g. "Add CUSTOM_ELEMENTS_SCHEMA to the component's schemas". */
  setup?: string;
  /** A short usage example in that framework. */
  example?: string;
  /** Inputs / props / attributes it accepts here. When set, AI tools are told to use only these and the Checker flags any other. */
  props?: PropSpec[];
  /** Events (Angular outputs, Vue emits, DOM events of a custom element), e.g. { name: "br-change", detail: "the new value (string)" }. */
  events?: EventSpec[];
}

export interface EventSpec {
  name: string;
  /** What the event carries: `event.detail` for a custom element, `$event` for an Angular output. */
  detail?: string;
}

export interface PropSpec {
  name: string;
  /** TypeScript type, with enum members spelled out, e.g. "Size (Size.SMALL | Size.MEDIUM | Size.LARGE)". */
  type?: string;
  required?: boolean;
  description?: string;
}

/** brandrail.config.json */
export interface BrandrailConfig {
  $schema?: string;
  org?: string;
  tokenVersion?: string;
  /** Pins the project to this published Brand Kit version: the CLI and MCP fetch it, and the GitHub App doesn't update the repo. */
  brandKitVersion?: string;
  tokens: DtcgDoc;
  components?: ComponentEntry[];
  rules?: Partial<Record<string, RuleSetting>>;
  /** Globs (relative to the scan root) to skip, added to the defaults. */
  ignore?: string[];
  /** Packages that must not be imported, e.g. other UI libraries. */
  forbiddenImports?: string[];
  /** Where `brandrail init` writes the Brand Kit as CSS variables. Default src/brandrail.tokens.css (or brandrail.tokens.css without src/). */
  tokensCss?: string;
  /** ΔE distance under which a colour counts as "the same" as a token. Default 2.5. */
  colorTolerance?: number;
  /** The project's UI framework, so rule files and AI tools show each component the way this project uses it. Detected by `brandrail init`. */
  framework?: Framework;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface Violation {
  ruleId: string;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  message: string;
  suggestion?: string;
  snippet?: string;
}

export interface Report {
  engineVersion: string;
  tokenVersion?: string;
  score: number;
  counts: Record<Severity, number>;
  filesScanned: number;
  linesScanned: number;
  violations: Violation[];
  byRule: Array<{ ruleId: string; count: number }>;
  durationMs: number;
}
