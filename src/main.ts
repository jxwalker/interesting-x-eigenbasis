import "./styles.css";
import {
  DEFAULT_LAMBDA1,
  DEFAULT_LAMBDA2,
  DEFAULT_THETA,
  LAMBDA_MAX,
  LAMBDA_MIN,
  PRESETS,
  THETA_MAX_DEG,
  THETA_MIN_DEG,
  degToRad,
  formatMatrixEntry,
  lerpMatrix,
  radToDeg,
  shapeLabel,
  symmetricFromEigen,
  type EigenParams,
} from "./math";
import {
  createParticles,
  paintStage,
  reseedBurst,
  stepParticles,
  type PointMode,
} from "./viz";

const SCATTER_COUNT = 96;
const GRID_COUNT = 81;
const INTRO_MS = 1400;
const PULSE_DECAY = 2.8;
const SPIN_RAD_PER_SEC = 0.55;

interface AppState {
  lambda1: number;
  lambda2: number;
  theta: number;
  /** 0→1 intro morph from identity to A. */
  morph: number;
  mode: PointMode;
  spinning: boolean;
  pulse: number;
  flash: number;
  seed: number;
}

function mustEl<T extends HTMLElement>(
  root: HTMLElement,
  selector: string,
  ctor: new () => T,
): T {
  const el = root.querySelector(selector);
  if (!(el instanceof ctor)) {
    throw new Error(`Missing or wrong element: ${selector}`);
  }
  return el;
}

function isRecordMode(): boolean {
  return new URLSearchParams(window.location.search).has("record");
}

function setTextIfChanged(el: HTMLElement, next: string): void {
  if (el.textContent !== next) el.textContent = next;
}

function formatLam(n: number): string {
  return n.toFixed(2);
}

function formatDeg(rad: number): string {
  return `${radToDeg(rad).toFixed(0)}°`;
}

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

function particleCount(mode: PointMode): number {
  return mode === "grid" ? GRID_COUNT : SCATTER_COUNT;
}

function mount(): void {
  const appRoot = document.getElementById("app");
  if (!(appRoot instanceof HTMLElement)) {
    throw new Error("Missing #app");
  }
  const root = appRoot;
  const recordMode = isRecordMode();

  const state: AppState = {
    lambda1: DEFAULT_LAMBDA1,
    lambda2: DEFAULT_LAMBDA2,
    theta: DEFAULT_THETA,
    morph: 0,
    mode: "scatter",
    spinning: false,
    pulse: 0,
    flash: 0,
    seed: 7,
  };

  let particles = createParticles("scatter", SCATTER_COUNT, state.seed);
  const introStarted = performance.now();

  const presetButtons = PRESETS.map((p) => {
    const active = p.id === "stretch" ? " active" : "";
    return `
      <button
        type="button"
        class="preset${active}"
        id="preset-${p.id}"
        data-preset="${p.id}"
        aria-pressed="${p.id === "stretch" ? "true" : "false"}"
      >
        <span class="preset-label">${p.label}</span>
        <span class="preset-hint">${p.hint}</span>
      </button>`;
  }).join("");

  root.innerHTML = `
    <div class="grain" aria-hidden="true"></div>
    <div class="aurora" aria-hidden="true"></div>

    <header class="hero">
      <p class="brand">Interesting X</p>
      <h1 class="title">Orthonormal eigenbasis</h1>
      <p class="lede">
        A real symmetric matrix always has A = QΛQᵀ — it stretches space by λᵢ
        along orthogonal eigenvectors qᵢ, mapping the unit circle to an ellipse.
      </p>
    </header>

    <p class="hint">
      <span class="hint-dot" aria-hidden="true"></span>
      <span>
        Drag λ and angle — watch the circle stretch into an ellipse along perpendicular axes.
      </span>
    </p>

    <section class="stage" aria-label="Eigenbasis visualization" id="stage">
      <canvas id="canvas" role="img" aria-label="Unit circle mapped by a symmetric matrix"></canvas>
      <div class="hud" aria-live="polite">
        <span class="hud-shape" id="hud-shape">ellipse · same-sign stretch</span>
        <span class="hud-matrix" id="hud-matrix">A = [[—, —],[—, —]]</span>
      </div>
    </section>

    <section class="controls" aria-label="Eigenbasis controls">
      <div class="presets" role="group" aria-label="Shape presets">
        ${presetButtons}
      </div>

      <div class="row">
        <div class="actions">
          <button type="button" class="btn warm" id="btn-pulse">Pulse</button>
          <button type="button" class="btn" id="btn-spin" aria-pressed="false">Spin θ</button>
          <label class="toggle">
            <input type="checkbox" id="toggle-grid" />
            <span>Grid points</span>
          </label>
        </div>

        <div class="sliders">
          <div class="field">
            <label for="param-lambda1">λ₁</label>
            <input
              id="param-lambda1"
              type="range"
              min="${LAMBDA_MIN}"
              max="${LAMBDA_MAX}"
              step="0.05"
              value="${state.lambda1}"
            />
            <div class="range-meta">
              <span>${LAMBDA_MIN}</span>
              <span class="val lam1" id="lambda1-val">${formatLam(state.lambda1)}</span>
              <span>${LAMBDA_MAX}</span>
            </div>
          </div>
          <div class="field">
            <label for="param-lambda2">λ₂</label>
            <input
              id="param-lambda2"
              type="range"
              min="${LAMBDA_MIN}"
              max="${LAMBDA_MAX}"
              step="0.05"
              value="${state.lambda2}"
            />
            <div class="range-meta">
              <span>${LAMBDA_MIN}</span>
              <span class="val lam2" id="lambda2-val">${formatLam(state.lambda2)}</span>
              <span>${LAMBDA_MAX}</span>
            </div>
          </div>
          <div class="field">
            <label for="param-theta">θ (eigenvector angle)</label>
            <input
              id="param-theta"
              type="range"
              min="${THETA_MIN_DEG}"
              max="${THETA_MAX_DEG}"
              step="1"
              value="${radToDeg(state.theta).toFixed(0)}"
            />
            <div class="range-meta">
              <span>0°</span>
              <span class="val" id="theta-val">${formatDeg(state.theta)}</span>
              <span>180°</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <p class="caption">
      A = QΛQᵀ with orthonormal Q (a rotation in 2D). Opposite-sign eigenvalues flip one
      axis — the saddle. Equal eigenvalues keep a scaled circle.
      Inspired by
      <a href="https://x.com/mathemetica/status/2106107952935338378" target="_blank" rel="noreferrer">@mathemetica</a>.
    </p>

    <footer class="foot">
      <span>apps/eigenbasis</span>
      <span aria-hidden="true">·</span>
      <span>canvas 2D · no network</span>
      ${recordMode ? '<span aria-hidden="true">·</span><span>record</span>' : ""}
    </footer>
  `;

  const stage = mustEl(root, "#stage", HTMLElement);
  const canvas = mustEl(root, "#canvas", HTMLCanvasElement);
  const btnPulse = mustEl(root, "#btn-pulse", HTMLButtonElement);
  const btnSpin = mustEl(root, "#btn-spin", HTMLButtonElement);
  const toggleGrid = mustEl(root, "#toggle-grid", HTMLInputElement);
  const paramL1 = mustEl(root, "#param-lambda1", HTMLInputElement);
  const paramL2 = mustEl(root, "#param-lambda2", HTMLInputElement);
  const paramTheta = mustEl(root, "#param-theta", HTMLInputElement);
  const l1Val = mustEl(root, "#lambda1-val", HTMLElement);
  const l2Val = mustEl(root, "#lambda2-val", HTMLElement);
  const thetaVal = mustEl(root, "#theta-val", HTMLElement);
  const hudShape = mustEl(root, "#hud-shape", HTMLElement);
  const hudMatrix = mustEl(root, "#hud-matrix", HTMLElement);

  let lastTs = performance.now();

  function params(): EigenParams {
    return {
      lambda1: state.lambda1,
      lambda2: state.lambda2,
      theta: state.theta,
    };
  }

  function syncSliders(): void {
    paramL1.value = String(state.lambda1);
    paramL2.value = String(state.lambda2);
    paramTheta.value = String(Math.round(radToDeg(state.theta)));
    setTextIfChanged(l1Val, formatLam(state.lambda1));
    setTextIfChanged(l2Val, formatLam(state.lambda2));
    setTextIfChanged(thetaVal, formatDeg(state.theta));
  }

  function syncPresets(activeId: string | null): void {
    for (const p of PRESETS) {
      const btn = root.querySelector(`#preset-${p.id}`);
      if (!(btn instanceof HTMLButtonElement)) continue;
      const on = p.id === activeId;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function matchPreset(): string | null {
    for (const p of PRESETS) {
      if (
        Math.abs(p.lambda1 - state.lambda1) < 0.03 &&
        Math.abs(p.lambda2 - state.lambda2) < 0.03 &&
        Math.abs(p.thetaDeg - radToDeg(state.theta)) < 1.5
      ) {
        return p.id;
      }
    }
    return null;
  }

  function updateReadout(matrixA: ReturnType<typeof symmetricFromEigen>): void {
    const shape = shapeLabel(state.lambda1, state.lambda2);
    setTextIfChanged(hudShape, shape);
    hudShape.dataset.kind =
      state.lambda1 * state.lambda2 < 0
        ? "saddle"
        : Math.abs(state.lambda1 - state.lambda2) < 0.04
          ? "circle"
          : "ellipse";

    const line = `A = [[${formatMatrixEntry(matrixA.a)},${formatMatrixEntry(matrixA.b)}],[${formatMatrixEntry(matrixA.b)},${formatMatrixEntry(matrixA.c)}]]`;
    setTextIfChanged(hudMatrix, line);
  }

  function paint(): void {
    const rect = stage.getBoundingClientRect();
    const target = symmetricFromEigen(params());
    const matrix = lerpMatrix(target, state.morph);
    // During intro, also lerp displayed eigenvalues for axis length
    const displayParams: EigenParams = {
      lambda1: 1 + (state.lambda1 - 1) * state.morph,
      lambda2: 1 + (state.lambda2 - 1) * state.morph,
      theta: state.theta,
    };
    updateReadout(target);
    paintStage({
      canvas,
      cssWidth: rect.width,
      cssHeight: rect.height,
      matrix,
      params: displayParams,
      particles,
      flash: state.flash,
    });
  }

  function applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id);
    if (!preset) return;
    state.lambda1 = preset.lambda1;
    state.lambda2 = preset.lambda2;
    state.theta = degToRad(preset.thetaDeg);
    state.morph = 1;
    state.flash = 0.65;
    syncSliders();
    syncPresets(id);
    // Burst so the change is unmistakable
    state.seed += 1;
    reseedBurst(particles, state.mode, state.seed);
    state.pulse = 1;
  }

  function setMode(mode: PointMode): void {
    state.mode = mode;
    particles = createParticles(mode, particleCount(mode), state.seed);
    toggleGrid.checked = mode === "grid";
  }

  function tick(ts: number): void {
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    // Intro morph
    const introT = Math.min(1, (ts - introStarted) / INTRO_MS);
    state.morph = easeOutCubic(introT);

    if (state.spinning) {
      state.theta += SPIN_RAD_PER_SEC * dt;
      // Keep slider in 0..180 visually
      let deg = radToDeg(state.theta) % 180;
      if (deg < 0) deg += 180;
      state.theta = degToRad(deg);
      syncSliders();
      syncPresets(null);
    }

    if (state.pulse > 0) {
      state.pulse = Math.max(0, state.pulse - dt * PULSE_DECAY);
    }
    if (state.flash > 0) {
      state.flash = Math.max(0, state.flash - dt * 2.2);
    }

    const target = symmetricFromEigen(params());
    const matrix = lerpMatrix(target, state.morph);
    stepParticles(particles, matrix, dt, state.pulse);

    paint();
    requestAnimationFrame(tick);
  }

  btnPulse.addEventListener("click", () => {
    state.seed += 11;
    reseedBurst(particles, state.mode, state.seed);
    state.pulse = 1;
    state.flash = 0.5;
  });

  btnSpin.addEventListener("click", () => {
    state.spinning = !state.spinning;
    btnSpin.setAttribute("aria-pressed", state.spinning ? "true" : "false");
    btnSpin.classList.toggle("active", state.spinning);
    btnSpin.textContent = state.spinning ? "Spinning…" : "Spin θ";
  });

  toggleGrid.addEventListener("change", () => {
    setMode(toggleGrid.checked ? "grid" : "scatter");
    state.pulse = 0.7;
    state.flash = 0.35;
  });

  paramL1.addEventListener("input", () => {
    state.lambda1 = Number(paramL1.value);
    setTextIfChanged(l1Val, formatLam(state.lambda1));
    syncPresets(matchPreset());
  });

  paramL2.addEventListener("input", () => {
    state.lambda2 = Number(paramL2.value);
    setTextIfChanged(l2Val, formatLam(state.lambda2));
    syncPresets(matchPreset());
  });

  paramTheta.addEventListener("input", () => {
    state.theta = degToRad(Number(paramTheta.value));
    setTextIfChanged(thetaVal, formatDeg(state.theta));
    syncPresets(matchPreset());
  });

  for (const p of PRESETS) {
    const btn = root.querySelector(`#preset-${p.id}`);
    if (!(btn instanceof HTMLButtonElement)) continue;
    btn.addEventListener("click", () => {
      applyPreset(p.id);
    });
  }

  window.addEventListener("resize", () => {
    paint();
  });

  syncSliders();
  syncPresets("stretch");
  requestAnimationFrame(tick);
}

mount();
