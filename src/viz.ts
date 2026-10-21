import {
  applyMatrix,
  eigenvector,
  type EigenParams,
  type SymMatrix2,
  type Vec2,
} from "./math";

export type PointMode = "scatter" | "grid";

export interface Particle {
  /** Source point on / near the unit circle (or grid). */
  src: Vec2;
  /** Trail of recent mapped positions (world space). */
  trail: Vec2[];
  hue: number;
  life: number;
}

export interface StageColors {
  bg: string;
  grid: string;
  unit: string;
  ellipse: string;
  ellipseGlow: string;
  axis1: string;
  axis1Glow: string;
  axis2: string;
  axis2Glow: string;
  particle: string;
  hyperbolic: string;
}

export const COLORS: StageColors = {
  bg: "#060a10",
  grid: "rgba(140, 175, 200, 0.07)",
  unit: "rgba(180, 205, 225, 0.28)",
  ellipse: "rgba(110, 230, 210, 0.92)",
  ellipseGlow: "rgba(62, 207, 190, 0.22)",
  axis1: "#5eead4",
  axis1Glow: "rgba(94, 234, 212, 0.35)",
  axis2: "#fb923c",
  axis2Glow: "rgba(251, 146, 60, 0.32)",
  particle: "#e8f4f1",
  hyperbolic: "rgba(255, 120, 140, 0.55)",
};

const TRAIL_LEN = 10;
const CIRCLE_SAMPLES = 128;

export function resizeCanvas(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): { width: number; height: number; dpr: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(cssWidth));
  const height = Math.max(1, Math.floor(cssHeight));
  const bw = Math.floor(width * dpr);
  const bh = Math.floor(height * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  // Keep layout CSS-driven (width/height: 100%) — do not write inline size.
  return { width, height, dpr };
}

function worldScale(width: number, height: number): number {
  return Math.min(width, height) * 0.32;
}

function toScreen(
  v: Vec2,
  width: number,
  height: number,
  scale: number,
): Vec2 {
  return {
    x: width * 0.5 + v.x * scale,
    y: height * 0.5 - v.y * scale,
  };
}

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export function createParticles(
  mode: PointMode,
  count: number,
  seed = 1,
): Particle[] {
  const rand = seededRandom(seed);
  const particles: Particle[] = [];

  if (mode === "grid") {
    const n = Math.max(3, Math.round(Math.sqrt(count)));
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
        const v = n === 1 ? 0 : (j / (n - 1)) * 2 - 1;
        particles.push({
          src: { x: u * 1.05, y: v * 1.05 },
          trail: [],
          hue: (i * 17 + j * 29) % 360,
          life: rand(),
        });
      }
    }
    return particles;
  }

  for (let i = 0; i < count; i += 1) {
    const angle = rand() * Math.PI * 2;
    const radius = 0.55 + rand() * 0.55;
    particles.push({
      src: {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      },
      trail: [],
      hue: (angle * 180) / Math.PI,
      life: rand(),
    });
  }
  return particles;
}

export function reseedBurst(
  particles: Particle[],
  mode: PointMode,
  seed: number,
): void {
  const next = createParticles(mode, particles.length, seed);
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const n = next[i] ?? next[0];
    if (!p || !n) continue;
    p.src = n.src;
    p.trail = [];
    p.hue = n.hue;
    p.life = 0;
  }
}

function pushTrail(trail: Vec2[], point: Vec2, max: number): void {
  trail.push({ x: point.x, y: point.y });
  while (trail.length > max) trail.shift();
}

export function stepParticles(
  particles: Particle[],
  matrix: SymMatrix2,
  dt: number,
  pulse: number,
): void {
  for (const p of particles) {
    p.life += dt;
    // Soft radial breathe so the map never looks frozen.
    const breathe = 1 + 0.04 * Math.sin(p.life * 2.4 + p.hue);
    const pulseBoost = 1 + pulse * 0.55;
    const src: Vec2 = {
      x: p.src.x * breathe * pulseBoost,
      y: p.src.y * breathe * pulseBoost,
    };
    const mapped = applyMatrix(matrix, src);
    pushTrail(p.trail, mapped, TRAIL_LEN);
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  color: string,
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const step = scale * 0.5;
  const cx = width * 0.5;
  const cy = height * 0.5;
  ctx.beginPath();
  for (let x = cx % step; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = cy % step; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  // Axes
  ctx.strokeStyle = "rgba(180, 210, 230, 0.18)";
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(width, cy);
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, height);
  ctx.stroke();
  ctx.restore();
}

function drawCircle(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  radius: number,
  color: string,
  dashed: boolean,
): void {
  const c = toScreen({ x: 0, y: 0 }, width, height, scale);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  if (dashed) ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(c.x, c.y, radius * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawMappedCircle(
  ctx: CanvasRenderingContext2D,
  matrix: SymMatrix2,
  width: number,
  height: number,
  scale: number,
  stroke: string,
  glow: string,
  saddle: boolean,
): void {
  const pts: Vec2[] = [];
  for (let i = 0; i <= CIRCLE_SAMPLES; i += 1) {
    const t = (i / CIRCLE_SAMPLES) * Math.PI * 2;
    const src = { x: Math.cos(t), y: Math.sin(t) };
    pts.push(applyMatrix(matrix, src));
  }

  ctx.save();
  // Glow pass
  ctx.shadowColor = saddle ? "rgba(255, 100, 130, 0.55)" : glow;
  ctx.shadowBlur = saddle ? 28 : 22;
  ctx.strokeStyle = saddle ? "rgba(255, 140, 160, 0.95)" : stroke;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    if (!p) continue;
    const s = toScreen(p, width, height, scale);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  ctx.closePath();
  ctx.stroke();

  // Fill soft interior
  ctx.shadowBlur = 0;
  ctx.fillStyle = saddle
    ? "rgba(255, 90, 120, 0.07)"
    : "rgba(62, 207, 190, 0.06)";
  ctx.fill();
  ctx.restore();
}

function drawEigenAxis(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  scale: number,
  theta: number,
  which: 1 | 2,
  lambda: number,
  color: string,
  glow: string,
  label: string,
): void {
  const dir = eigenvector(theta, which);
  const len = Math.max(0.15, Math.abs(lambda)) * 1.15;
  const tip: Vec2 = { x: dir.x * len * Math.sign(lambda || 1), y: dir.y * len * Math.sign(lambda || 1) };
  // When lambda is negative, tip goes opposite — draw both directions for clarity.
  const a = toScreen(
    { x: -dir.x * Math.abs(len), y: -dir.y * Math.abs(len) },
    width,
    height,
    scale,
  );
  const b = toScreen(
    { x: dir.x * Math.abs(len), y: dir.y * Math.abs(len) },
    width,
    height,
    scale,
  );
  const tipScreen = toScreen(tip, width, height, scale);

  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Arrowhead along eigenvector direction (λ sign flips the tip)
  const ax = tipScreen.x;
  const ay = tipScreen.y;
  const sign = Math.sign(lambda) || 1;
  const ux = dir.x * sign;
  const uy = -dir.y * sign;
  const ah = 9;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax - ux * ah - uy * ah * 0.55, ay - uy * ah + ux * ah * 0.55);
  ctx.lineTo(ax - ux * ah + uy * ah * 0.55, ay - uy * ah - ux * ah * 0.55);
  ctx.closePath();
  ctx.fill();

  const lx = tipScreen.x + ux * 16;
  const ly = tipScreen.y + uy * 16;
  ctx.shadowBlur = 0;
  ctx.font = "600 12px 'IBM Plex Mono', ui-monospace, monospace";
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`${label} = ${lambda.toFixed(2)}`, lx, ly);
  ctx.restore();
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  particles: Particle[],
  width: number,
  height: number,
  scale: number,
  saddle: boolean,
): void {
  ctx.save();
  for (const p of particles) {
    if (p.trail.length === 0) continue;
    const last = p.trail[p.trail.length - 1];
    if (!last) continue;

    // Trail
    if (p.trail.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < p.trail.length; i += 1) {
        const t = p.trail[i];
        if (!t) continue;
        const s = toScreen(t, width, height, scale);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      const alpha = saddle ? 0.35 : 0.28;
      ctx.strokeStyle = saddle
        ? `rgba(255, 150, 170, ${alpha})`
        : `hsla(${180 + (p.hue % 40)}, 70%, 70%, ${alpha})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    const s = toScreen(last, width, height, scale);
    const r = 2.2 + (saddle ? 0.6 : 0);
    ctx.fillStyle = saddle
      ? "rgba(255, 180, 190, 0.95)"
      : `hsla(${170 + (p.hue % 50)}, 75%, 75%, 0.95)`;
    ctx.shadowColor = saddle
      ? "rgba(255, 100, 130, 0.7)"
      : "rgba(94, 234, 212, 0.55)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

function drawHyperbolaHints(
  ctx: CanvasRenderingContext2D,
  params: EigenParams,
  width: number,
  height: number,
  scale: number,
): void {
  // Asymptote-style dashed lines along eigenvectors when saddle — visual cue.
  const q1 = eigenvector(params.theta, 1);
  const q2 = eigenvector(params.theta, 2);
  ctx.save();
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = "rgba(255, 120, 140, 0.35)";
  ctx.lineWidth = 1.2;
  for (const d of [q1, q2]) {
    const a = toScreen({ x: -d.x * 2.4, y: -d.y * 2.4 }, width, height, scale);
    const b = toScreen({ x: d.x * 2.4, y: d.y * 2.4 }, width, height, scale);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

export interface PaintArgs {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  matrix: SymMatrix2;
  params: EigenParams;
  particles: Particle[];
  flash: number;
  colors?: StageColors;
}

export function paintStage(args: PaintArgs): void {
  const {
    canvas,
    cssWidth,
    cssHeight,
    matrix,
    params,
    particles,
    flash,
    colors = COLORS,
  } = args;

  const { width, height, dpr } = resizeCanvas(canvas, cssWidth, cssHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  // Soft vignette / atmosphere
  const g = ctx.createRadialGradient(
    width * 0.5,
    height * 0.45,
    20,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.65,
  );
  g.addColorStop(0, "rgba(30, 60, 80, 0.18)");
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  const scale = worldScale(width, height);
  const saddle = params.lambda1 * params.lambda2 < 0;

  drawGrid(ctx, width, height, scale, colors.grid);
  drawCircle(ctx, width, height, scale, 1, colors.unit, true);

  if (saddle) {
    drawHyperbolaHints(ctx, params, width, height, scale);
  }

  drawMappedCircle(
    ctx,
    matrix,
    width,
    height,
    scale,
    colors.ellipse,
    colors.ellipseGlow,
    saddle,
  );

  drawEigenAxis(
    ctx,
    width,
    height,
    scale,
    params.theta,
    1,
    params.lambda1,
    colors.axis1,
    colors.axis1Glow,
    "λ₁",
  );
  drawEigenAxis(
    ctx,
    width,
    height,
    scale,
    params.theta,
    2,
    params.lambda2,
    colors.axis2,
    colors.axis2Glow,
    "λ₂",
  );

  drawParticles(ctx, particles, width, height, scale, saddle);

  if (flash > 0.01) {
    ctx.fillStyle = `rgba(180, 240, 255, ${flash * 0.18})`;
    ctx.fillRect(0, 0, width, height);
  }
}
