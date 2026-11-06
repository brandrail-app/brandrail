/** Colour parsing and perceptual distance (CIE76 ΔE in Lab), no dependencies. */

export type RGB = { r: number; g: number; b: number; a: number };
export type Lab = { l: number; a: number; b: number };

const clamp = (n: number, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, n));

export function parseHex(hex: string): RGB | null {
  let h = hex.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Parses #hex, rgb()/rgba() and hsl()/hsla() in comma or space syntax. */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith("#")) return parseHex(s);
  const m = s.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/);
  if (!m) return null;
  const parts = m[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, max: number) => (p.endsWith("%") ? (parseFloat(p) / 100) * max : parseFloat(p));
  const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
  if (m[1]!.startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 255));
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r: clamp(r!), g: clamp(g!), b: clamp(b!), a: alpha };
  }
  const [h, sat, l] = [parseFloat(parts[0]!), parseFloat(parts[1]!), parseFloat(parts[2]!)];
  if ([h, sat, l].some((v) => Number.isNaN(v))) return null;
  const [r, g, b] = hslToRgb(h, sat, l);
  return { r: clamp(r), g: clamp(g), b: clamp(b), a: alpha };
}

export function toHex({ r, g, b }: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbToLab({ r, g, b }: RGB): Lab {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

export function deltaE(a: Lab, b: Lab): number {
  return Math.sqrt((a.l - b.l) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

/** WCAG 2 contrast ratio between two colours. */
export function contrastRatio(a: RGB, b: RGB): number {
  const lum = ({ r, g, b: bl }: RGB) => {
    const c = [r, g, bl].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}
