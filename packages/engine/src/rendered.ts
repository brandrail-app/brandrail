/**
 * Live-URL checks: rules that run on what a browser actually rendered (computed styles),
 * not on source code. Used by the hosted URL scanner and `brandrail scan <url>`.
 *
 * `collectRenderedNodes` runs inside the page (Playwright `page.evaluate`), so it must stay
 * self-contained: no imports, no closures over module scope.
 */
import { contrastRatio, deltaE, parseColor, rgbToLab, toHex, type RGB } from "./color.ts";
import { computeScore, ENGINE_VERSION } from "./check.ts";
import { isGenericFont, normalizeFontFamily, resolveConfig, type ResolvedConfig } from "./config.ts";
import { RULES } from "./rules.ts";
import type { BrandrailConfig, Report, Severity, Violation } from "./types.ts";

export interface RenderedNode {
  /** Short CSS path, e.g. "main > div.card > button.btn" */
  selector: string;
  tag: string;
  /** Has its own visible text */
  text?: string;
  color: string;
  backgroundColor: string;
  /** Colour of a visible border, if any */
  borderColor?: string;
  /** Nearest opaque background behind the element, or null when it sits on an image/gradient */
  effectiveBackground: string | null;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Largest corner radius in px */
  radius: number;
  /** Smaller of width/height, to recognise pills and circles */
  minSide: number;
  padding: number[];
  gap: number[];
}

export interface RenderedPage {
  url: string;
  title?: string;
  nodes: RenderedNode[];
  /** Same-origin links found on the page, for crawling */
  links?: string[];
}

/** Runs in the browser. Returns visible elements with the computed styles the rules need. */
export function collectRenderedNodes(maxNodes = 3000): { title: string; nodes: RenderedNode[]; links: string[] } {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "HEAD", "META", "LINK", "BR", "WBR", "SOURCE", "TRACK"]);
  const px = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
  };
  const alphaOf = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean);
    return parts[3] !== undefined ? parseFloat(parts[3]) : 1;
  };
  const cssEsc = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, "\\$&"));
  const part = (el: Element) => {
    if (el.id && el.id.length < 40) return `${el.tagName.toLowerCase()}#${cssEsc(el.id)}`;
    const cls = Array.from(el.classList)
      .filter((c) => c.length < 30)
      .slice(0, 2)
      .map((c) => `.${cssEsc(c)}`)
      .join("");
    return el.tagName.toLowerCase() + cls;
  };
  const selectorOf = (el: Element) => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 3) {
      parts.unshift(part(cur));
      if (cur.id) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  };
  const bgCache = new Map<Element, string | null>();
  const effectiveBg = (el: Element | null): string | null => {
    if (!el) return "rgb(255, 255, 255)";
    if (bgCache.has(el)) return bgCache.get(el)!;
    const cs = getComputedStyle(el);
    let out: string | null;
    if (cs.backgroundImage && cs.backgroundImage !== "none") out = null;
    else if (alphaOf(cs.backgroundColor) >= 0.95) out = cs.backgroundColor;
    else out = effectiveBg(el.parentElement);
    bgCache.set(el, out);
    return out;
  };

  const nodes: RenderedNode[] = [];
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (const el of Array.from(all)) {
    if (nodes.length >= maxNodes) break;
    if (SKIP.has(el.tagName) || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const text = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const borderW = Math.max(px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth));
    const borderSide = px(cs.borderTopWidth) > 0 ? cs.borderTopColor : px(cs.borderBottomWidth) > 0 ? cs.borderBottomColor : px(cs.borderLeftWidth) > 0 ? cs.borderLeftColor : cs.borderRightColor;
    nodes.push({
      selector: selectorOf(el),
      tag: el.tagName.toLowerCase(),
      text: text ? text.slice(0, 60) : undefined,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      borderColor: borderW > 0 && cs.borderTopStyle !== "none" ? borderSide : undefined,
      effectiveBackground: effectiveBg(el),
      fontFamily: cs.fontFamily,
      fontSize: px(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      radius: Math.max(px(cs.borderTopLeftRadius), px(cs.borderTopRightRadius), px(cs.borderBottomLeftRadius), px(cs.borderBottomRightRadius)),
      minSide: Math.round(Math.min(r.width, r.height)),
      padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
      gap: cs.display.includes("flex") || cs.display.includes("grid") ? [px(cs.rowGap), px(cs.columnGap)] : [],
    });
  }
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((h) => {
      try {
        const u = new URL(h);
        return u.origin === location.origin && !/\.(pdf|zip|png|jpe?g|svg|gif|webp|mp4)$/i.test(u.pathname);
      } catch {
        return false;
      }
    });
  return { title: document.title, nodes, links: Array.from(new Set(links.map((h) => h.split("#")[0]!))).slice(0, 50) };
}

/* ───────────────────────── rules ───────────────────────── */

export const RENDERED_RULES = [
  { id: "no-hardcoded-color", title: "Off-palette colour", description: "Text, background and border colours on the page must come from the Brand Kit.", defaultSeverity: "error" as Severity },
  { id: "text-contrast", title: "Low text contrast", description: "Text must meet WCAG AA contrast (4.5:1, or 3:1 for large text) against its background.", defaultSeverity: "error" as Severity },
  { id: "font-family", title: "Off-brand font", description: "Rendered text must use the Brand Kit's font families.", defaultSeverity: "warning" as Severity },
  { id: "font-size-scale", title: "Off-scale font size", description: "Font sizes must come from the Brand Kit type scale.", defaultSeverity: "warning" as Severity },
  { id: "spacing-scale", title: "Off-scale spacing", description: "Padding and gaps must use the spacing scale.", defaultSeverity: "warning" as Severity },
  { id: "page-rendered", title: "Blank page", description: "The page must render content; a blank or crashed page can't be checked.", defaultSeverity: "error" as Severity },
  { id: "radius-scale", title: "Off-scale radius", description: "Corner radius must use the radius scale.", defaultSeverity: "warning" as Severity },
];

type Group = { ruleId: string; severity: Severity; message: (n: number) => string; suggestion?: string; selectors: string[]; count: number; sample?: string };

const near = (scale: number[], v: number, tol = 0.5) => scale.some((s) => Math.abs(s - v) <= tol);
const neighbours = (scale: number[], v: number) => {
  const lo = [...scale].reverse().find((x) => x <= v);
  const hi = scale.find((x) => x >= v);
  return [...new Set([lo, hi].filter((x): x is number => x !== undefined))].map((x) => `${x}px`).join(" or ");
};

function closestToken(config: ResolvedConfig, rgb: RGB) {
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
  return { token: best, distance: bestD };
}

function colorLabel(rgb: RGB) {
  const hex = toHex(rgb);
  return rgb.a < 1 ? `${hex} at ${Math.round(rgb.a * 100)}%` : hex;
}

export interface RenderedCheckOptions {
  /** Max example selectors kept per finding (default 3) */
  examples?: number;
}

/** Runs the rendered-page rules over one or more pages and returns a normal Report (file = page path). */
export function checkRendered(pages: RenderedPage[], configInput: BrandrailConfig | ResolvedConfig, opts: RenderedCheckOptions = {}): Report {
  const t0 = Date.now();
  const config = "replaces" in configInput ? configInput : resolveConfig(configInput);
  const examples = opts.examples ?? 3;
  const fontSizes = config.fontSizes;
  const violations: Violation[] = [];
  let nodesChecked = 0;
  const spacing = config.spacing;
  const radii = config.radii.filter((r) => r < 999);

  for (const page of pages) {
    const groups = new Map<string, Group>();
    const add = (key: string, g: Omit<Group, "selectors" | "count">, selector: string) => {
      const sev = config.rules[g.ruleId];
      if (sev === "off") return;
      const cur = groups.get(key) ?? { ...g, severity: (sev as Severity | undefined) ?? g.severity, selectors: [], count: 0 };
      cur.count++;
      if (cur.selectors.length < examples && !cur.selectors.includes(selector)) cur.selectors.push(selector);
      groups.set(key, cur);
    };

    const colorCheck = (raw: string | undefined, where: "text" | "background" | "border", selector: string) => {
      if (!raw || !config.colors.length) return;
      const rgb = parseColor(raw);
      if (!rgb || rgb.a < 0.05) return;
      const { token, distance } = closestToken(config, rgb);
      if (distance <= config.colorTolerance) return;
      const label = colorLabel(rgb);
      add(
        `color:${label}`,
        {
          ruleId: "no-hardcoded-color",
          severity: "error",
          message: (n) => `${label} isn't in the Brand Kit (${where} on ${n} element${n === 1 ? "" : "s"})`,
          suggestion: token ? `Closest token is ${token.path} (${token.hex}, ΔE ${distance.toFixed(1)}): use var(${token.cssVar})` : undefined,
        },
        selector,
      );
    };

    for (const n of page.nodes) {
      nodesChecked++;
      if (n.text) colorCheck(n.color, "text", n.selector);
      colorCheck(n.backgroundColor, "background", n.selector);
      colorCheck(n.borderColor, "border", n.selector);

      if (n.text) {
        // contrast
        const fg = parseColor(n.color);
        const bg = n.effectiveBackground ? parseColor(n.effectiveBackground) : null;
        if (fg && bg && fg.a > 0.05) {
          const blended: RGB = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
          const ratio = contrastRatio(blended, bg);
          const large = n.fontSize >= 24 || (n.fontSize >= 18.66 && n.fontWeight >= 700);
          const min = large ? 3 : 4.5;
          if (ratio < min) {
            const pair = `${colorLabel(fg)} on ${toHex(bg)}`;
            add(
              `contrast:${pair}:${large}`,
              {
                ruleId: "text-contrast",
                severity: "error",
                message: (c) => `${pair} is ${ratio.toFixed(2)}:1, below ${min}:1${large ? " for large text" : ""} (${c} element${c === 1 ? "" : "s"})`,
                suggestion: "Use the Brand Kit's text colours on its background colours, e.g. fg.default on canvas.default",
                sample: n.text,
              },
              n.selector,
            );
          }
        }

        // font family
        if (config.fonts.length) {
          const fam = normalizeFontFamily(n.fontFamily);
          if (fam && !isGenericFont(fam) && !config.fonts.includes(fam) && !/^(pre|code|kbd|samp)$/.test(n.tag)) {
            add(
              `font:${fam}`,
              {
                ruleId: "font-family",
                severity: "warning",
                message: (c) => `Font “${n.fontFamily.split(",")[0]!.replace(/["']/g, "").trim()}” isn't a Brand Kit font (${c} element${c === 1 ? "" : "s"})`,
                suggestion: `Use ${config.fontVars.map((v) => `var(${v})`).join(" or ")}`,
              },
              n.selector,
            );
          }
        }

        // font size
        if (fontSizes.length >= 3 && !near(fontSizes, n.fontSize)) {
          add(
            `size:${n.fontSize}`,
            {
              ruleId: "font-size-scale",
              severity: "warning",
              message: (c) => `Font size ${n.fontSize}px is off the type scale (${c} element${c === 1 ? "" : "s"})`,
              suggestion: `Use ${neighbours(fontSizes, n.fontSize)}`,
            },
            n.selector,
          );
        }
      }

      // spacing: padding and flex/grid gaps (margins are skipped: auto-centering produces arbitrary px)
      for (const v of [...new Set([...n.padding, ...n.gap])]) {
        if (v <= 2 || near(spacing, v)) continue;
        add(
          `space:${v}`,
          { ruleId: "spacing-scale", severity: "warning", message: (c) => `Spacing ${v}px is off the scale (${c} element${c === 1 ? "" : "s"})`, suggestion: `Use ${neighbours(spacing, v)}` },
          n.selector,
        );
      }

      // radius: ignore 0, fully-rounded and pills/circles
      if (n.radius > 0 && n.radius < 999 && n.radius < n.minSide / 2 - 0.5 && radii.length && !near(radii, n.radius)) {
        add(
          `radius:${n.radius}`,
          { ruleId: "radius-scale", severity: "warning", message: (c) => `Corner radius ${n.radius}px is off the scale (${c} element${c === 1 ? "" : "s"})`, suggestion: `Use ${neighbours(radii, n.radius)}` },
          n.selector,
        );
      }
    }

    const path = pagePath(page.url);
    if (page.nodes.length < 5) {
      // A blank page (crash, auth wall, client error) must not pass as "on-brand".
      violations.push({
        ruleId: "page-rendered",
        severity: "error",
        file: path,
        line: 0,
        column: 0,
        message: `The page rendered ${page.nodes.length} visible element${page.nodes.length === 1 ? "" : "s"}, so there was nothing to check`,
        suggestion: "Open it in a browser: it may have crashed, need a login (use --storage-state), or need longer to load (--wait).",
      });
    }
    for (const g of groups.values()) {
      violations.push({
        ruleId: g.ruleId,
        severity: g.severity,
        file: path,
        line: 0,
        column: 0,
        message: g.message(g.count),
        suggestion: g.suggestion,
        snippet: g.selectors.join(", ") + (g.sample ? `  “${g.sample}”` : ""),
      });
    }
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  violations.sort((a, b) => a.file.localeCompare(b.file) || order[a.severity] - order[b.severity] || countOf(b) - countOf(a));
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  const perRule = new Map<string, number>();
  for (const v of violations) {
    counts[v.severity]++;
    perRule.set(v.ruleId, (perRule.get(v.ruleId) ?? 0) + 1);
  }
  return {
    engineVersion: ENGINE_VERSION,
    tokenVersion: config.tokenVersion,
    // Findings are grouped per distinct value, so each one weighs more than a single code line.
    score: computeScore(counts, Math.max(2000, nodesChecked * 3)),
    counts,
    filesScanned: pages.length,
    linesScanned: nodesChecked,
    violations,
    byRule: [...perRule].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count),
    durationMs: Date.now() - t0,
  };
}

const countOf = (v: Violation) => Number(v.message.match(/\((?:\w+ on )?(\d+) element/)?.[1] ?? 0);

export function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}


/* ───────────────────────── URL safety (shared by hosted scanner and CLI) ───────────────────────── */

/** True for loopback, private, link-local, CGNAT and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  const p = v.split(".").map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/** Display title for any rule id, code or rendered. */
export function ruleTitle(id: string): string {
  return RULES.find((r) => r.id === id)?.title ?? RENDERED_RULES.find((r) => r.id === id)?.title ?? id;
}
