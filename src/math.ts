/** 2×2 real symmetric eigenbasis math: A = Q Λ Qᵀ */

export interface Vec2 {
  x: number;
  y: number;
}

export interface SymMatrix2 {
  a: number;
  b: number;
  c: number;
}

export interface EigenParams {
  lambda1: number;
  lambda2: number;
  /** Eigenvector angle in radians (Q is a rotation). */
  theta: number;
}

export const LAMBDA_MIN = -2.5;
export const LAMBDA_MAX = 2.5;
export const THETA_MIN_DEG = 0;
export const THETA_MAX_DEG = 180;

export const DEFAULT_LAMBDA1 = 2.0;
export const DEFAULT_LAMBDA2 = 0.55;
export const DEFAULT_THETA = (28 * Math.PI) / 180;

/** Build A = Q Λ Qᵀ for a 2×2 rotation Q and diagonal Λ. */
export function symmetricFromEigen(params: EigenParams): SymMatrix2 {
  const cos = Math.cos(params.theta);
  const sin = Math.sin(params.theta);
  const { lambda1: l1, lambda2: l2 } = params;
  const a = l1 * cos * cos + l2 * sin * sin;
  const b = (l1 - l2) * cos * sin;
  const c = l1 * sin * sin + l2 * cos * cos;
  return { a, b, c };
}

export function applyMatrix(m: SymMatrix2, v: Vec2): Vec2 {
  return {
    x: m.a * v.x + m.b * v.y,
    y: m.b * v.x + m.c * v.y,
  };
}

/** Interpolate between identity and A: (1−t)I + t A */
export function lerpMatrix(m: SymMatrix2, t: number): SymMatrix2 {
  const s = 1 - t;
  return {
    a: s + t * m.a,
    b: t * m.b,
    c: s + t * m.c,
  };
}

export function eigenvector(theta: number, which: 1 | 2): Vec2 {
  if (which === 1) {
    return { x: Math.cos(theta), y: Math.sin(theta) };
  }
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}

export function formatMatrixEntry(n: number): string {
  const v = Math.abs(n) < 0.005 ? 0 : n;
  const body = v.toFixed(2);
  if (v > 0) return ` ${body}`;
  if (v < 0) return body;
  return ` ${body}`;
}

export function shapeLabel(l1: number, l2: number): string {
  const eps = 0.04;
  if (Math.abs(l1) < eps && Math.abs(l2) < eps) return "collapsed · zero map";
  if (Math.abs(l1 - l2) < eps) {
    if (Math.abs(l1 - 1) < eps) return "identity · unit circle";
    return "scaled circle · λ₁ = λ₂";
  }
  if (l1 * l2 < 0) return "saddle · opposite signs";
  if (Math.abs(l1) < eps || Math.abs(l2) < eps) return "squash · singular";
  return "ellipse · same-sign stretch";
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  lambda1: number;
  lambda2: number;
  thetaDeg: number;
}

export const PRESETS: readonly Preset[] = [
  {
    id: "stretch",
    label: "Stretch",
    hint: "classic ellipse",
    lambda1: 2.15,
    lambda2: 0.55,
    thetaDeg: 28,
  },
  {
    id: "circle",
    label: "Circle",
    hint: "λ₁ = λ₂",
    lambda1: 1.35,
    lambda2: 1.35,
    thetaDeg: 0,
  },
  {
    id: "saddle",
    label: "Saddle",
    hint: "flip one axis",
    lambda1: 1.85,
    lambda2: -1.35,
    thetaDeg: 42,
  },
];
