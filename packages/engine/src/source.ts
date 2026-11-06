import type { Framework } from "./types.ts";

/** "template" is a server-side or logic-less template: Mustache/Handlebars, PHP (incl. Blade), Twig, Nunjucks, Liquid. */
export type FileKind = "jsx" | "vue" | "svelte" | "html" | "template" | "css" | "other";

export const TEMPLATE_EXTENSIONS = ["mustache", "hbs", "handlebars", "php", "phtml", "twig", "njk", "liquid"];

export function fileKind(path: string): FileKind {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (TEMPLATE_EXTENSIONS.includes(ext)) return "template";
  if (["tsx", "jsx", "ts", "js", "mjs", "cjs", "mdx"].includes(ext)) return "jsx";
  if (ext === "vue") return "vue";
  if (ext === "svelte") return "svelte";
  if (["html", "htm", "astro"].includes(ext)) return "html";
  if (["css", "scss", "sass", "less", "pcss"].includes(ext)) return "css";
  return "other";
}

export const SCANNABLE = new Set<FileKind>(["jsx", "vue", "svelte", "html", "template", "css"]);

/** An Angular component class: @Component({ selector, template }). */
const ANGULAR_COMPONENT = /@Component\s*\(\s*\{/;
/** Angular template syntax in an .html file: bindings, events, structural directives, control flow. */
const ANGULAR_TEMPLATE = /\s(?:\[[\w.()-]+\]|\([\w.]+\)|\*ng[A-Z]\w*)\s*=|@(?:if|for|switch)\s*\(/;

/**
 * Which framework's components apply in this file, so findings suggest the right form
 * (an Angular selector, a Vue component, a web component tag) instead of a React import.
 */
export function fileFramework(path: string, kind: FileKind, code: string, project?: Framework): Framework {
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

const blank = (s: string) => s.replace(/[^\n]/g, " ");

/**
 * Replaces comments with spaces (keeping offsets and newlines) so rules don't fire on commented-out code.
 * JS-style comments are only stripped outside string literals.
 */
export function stripComments(code: string, kind: FileKind): string {
  let out = code;
  if (kind === "html" || kind === "vue" || kind === "svelte" || kind === "template") {
    out = out.replace(/<!--[\s\S]*?-->/g, blank);
  }
  if (kind === "template") {
    // Template comments: Handlebars {{!-- --}} / {{! }}, Twig and Nunjucks {# #}, Liquid {% comment %}, Blade {{-- --}};
    // PHP comments only inside <?php … ?>. Template text isn't JavaScript, so the JS scanner below doesn't run.
    out = out
      .replace(/\{\{!--[\s\S]*?--\}\}|\{\{![\s\S]*?\}\}|\{\{--[\s\S]*?--\}\}|\{#[\s\S]*?#\}|\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, blank)
      .replace(/<\?(?:php|=)?[\s\S]*?(?:\?>|$)/g, (block) => block.replace(/\/\*[\s\S]*?\*\/|(?<![:"'])\/\/[^\n]*?(?=\?>|\n|$)|(?<=\s)#[^\n]*?(?=\?>|\n|$)/g, blank));
    return out;
  }
  if (kind === "css") {
    return out.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)));
  }
  // JS-ish scanner for jsx / vue / svelte / html <script>
  const chars = out.split("");
  let i = 0;
  let quote: string | null = null;
  while (i < chars.length) {
    const c = chars[i]!;
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

export class LineIndex {
  private starts: number[] = [0];
  private text: string;
  constructor(text: string) {
    this.text = text;
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
  }
  position(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - this.starts[lo]! + 1 };
  }
  lineText(line: number): string {
    const start = this.starts[line - 1] ?? 0;
    const end = this.starts[line] ?? this.text.length + 1;
    return this.text.slice(start, end - 1);
  }
  get lineCount() {
    return this.starts.length;
  }
}

/** Minimal glob matcher: supports **, *, ? and {a,b}. Paths use forward slashes. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        re += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&")).join("|")})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function makeIgnore(globs: string[]) {
  const res = globs.map(globToRegExp);
  return (path: string) => {
    const p = path.replace(/\\/g, "/").replace(/^\.\//, "");
    return res.some((r) => r.test(p) || r.test(`/${p}`));
  };
}
