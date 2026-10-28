import { useEffect, useRef } from "react";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface Props {
  state: OrbState;
  size: number;
  /** Incremented by voice/stream events so the orb pulses with real activity. */
  pulseRef?: React.MutableRefObject<number>;
  onClick?: () => void;
  label?: string;
}

const PALETTE: Record<OrbState, { a: [number, number, number]; b: [number, number, number] }> = {
  idle: { a: [62, 232, 255], b: [47, 123, 255] },
  listening: { a: [90, 255, 220], b: [40, 190, 255] },
  thinking: { a: [150, 140, 255], b: [70, 110, 255] },
  speaking: { a: [80, 220, 255], b: [30, 140, 255] },
};

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const mix = (x: [number, number, number], y: [number, number, number], t: number): [number, number, number] => [
  x[0] + (y[0] - x[0]) * t,
  x[1] + (y[1] - x[1]) * t,
  x[2] + (y[2] - x[2]) * t,
];

export function Orb({ state, size, pulseRef, onClick, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const reduceMotion = reducedMotion;
    let raf = 0;
    let energy = 0.1;
    let lastPulse = pulseRef?.current ?? 0;
    let colorA = PALETTE[stateRef.current].a;
    let colorB = PALETTE[stateRef.current].b;
    const particles = Array.from({ length: 28 }, (_, i) => ({
      angle: (i / 28) * Math.PI * 2,
      radius: 1.05 + Math.random() * 0.5,
      speed: 0.1 + Math.random() * 0.25,
      size: 0.6 + Math.random() * 1.4,
    }));
    const start = performance.now();

    const frame = (now: number) => {
      const t = (now - start) / 1000;
      const s = stateRef.current;
      const c = size / 2;
      const R = size * 0.27;

      // Energy follows state, plus real pulses from speech/stream events.
      const base = s === "idle" ? 0.08 : s === "thinking" ? 0.3 : s === "listening" ? 0.35 : 0.4;
      const pulses = (pulseRef?.current ?? 0) - lastPulse;
      lastPulse = pulseRef?.current ?? 0;
      energy += (base - energy) * 0.06 + Math.min(pulses, 3) * 0.12;
      energy = Math.min(energy, 1);

      colorA = mix(colorA, PALETTE[s].a, 0.05);
      colorB = mix(colorB, PALETTE[s].b, 0.05);

      ctx.clearRect(0, 0, size, size);

      // Outer glow
      const glow = ctx.createRadialGradient(c, c, R * 0.4, c, c, R * 1.85);
      glow.addColorStop(0, rgba(colorA, 0.28 + energy * 0.25));
      glow.addColorStop(0.5, rgba(colorB, 0.1 + energy * 0.1));
      glow.addColorStop(1, rgba(colorB, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // Tick ring
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(-t * 0.05);
      ctx.strokeStyle = rgba(colorA, 0.35);
      ctx.lineWidth = 1;
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const long = i % 6 === 0;
        const r1 = R * 1.52;
        const r2 = R * (long ? 1.6 : 1.56);
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
        ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();

      // Segmented HUD ring
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(t * (s === "thinking" ? 0.9 : 0.18));
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(colorA, 0.55);
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.36, a0, a0 + Math.PI / 6 + Math.sin(t + i) * 0.08);
        ctx.stroke();
      }
      ctx.restore();

      // Thin inner ring
      ctx.beginPath();
      ctx.arc(c, c, R * 1.2, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(colorA, 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();

      // Thinking sweep
      if (s === "thinking") {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(t * 3.2);
        const sweep = ctx.createLinearGradient(-R, 0, R, 0);
        sweep.addColorStop(0, rgba(colorA, 0));
        sweep.addColorStop(1, rgba(colorA, 0.95));
        ctx.strokeStyle = sweep;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, R * 1.27, 0, Math.PI * 0.6);
        ctx.stroke();
        ctx.restore();
      }

      // Listening ripples
      if (s === "listening") {
        for (let k = 0; k < 3; k++) {
          const p = (t * 0.7 + k / 3) % 1;
          ctx.beginPath();
          ctx.arc(c, c, R * (1 + p * 0.75), 0, Math.PI * 2);
          ctx.strokeStyle = rgba(colorA, 0.45 * (1 - p));
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Particles
      for (const p of particles) {
        p.angle += p.speed * 0.01 * (1 + energy * 2);
        const r = R * (p.radius + Math.sin(t * 0.8 + p.angle * 3) * 0.04);
        ctx.beginPath();
        ctx.arc(c + Math.cos(p.angle) * r, c + Math.sin(p.angle) * r, p.size, 0, Math.PI * 2);
        ctx.fillStyle = rgba(colorA, 0.35 + energy * 0.4);
        ctx.fill();
      }

      // Waveform ring
      const amp = R * (0.02 + energy * 0.16);
      ctx.save();
      ctx.shadowColor = rgba(colorA, 0.9);
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (let i = 0; i <= 160; i++) {
        const a = (i / 160) * Math.PI * 2;
        const n =
          Math.sin(a * 3 + t * 2.1) * 0.5 + Math.sin(a * 5 - t * 3.3) * 0.3 + Math.sin(a * 9 + t * 4.7) * 0.2 * energy;
        const r = R + n * amp;
        const x = c + Math.cos(a) * r;
        const y = c + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = rgba(colorA, 0.95);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      // Core sphere
      const breathe = 1 + Math.sin(t * 1.6) * 0.02 + energy * 0.06;
      const core = ctx.createRadialGradient(c - R * 0.2, c - R * 0.25, R * 0.05, c, c, R * 0.9 * breathe);
      core.addColorStop(0, "rgba(235,252,255,0.95)");
      core.addColorStop(0.25, rgba(colorA, 0.85));
      core.addColorStop(0.7, rgba(colorB, 0.45));
      core.addColorStop(1, rgba(colorB, 0.02));
      ctx.beginPath();
      ctx.arc(c, c, R * 0.9 * breathe, 0, Math.PI * 2);
      ctx.fillStyle = core;
      ctx.fill();

      if (!reduceMotion) raf = requestAnimationFrame(frame);
    };

    const startLoop = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : startLoop());
    document.addEventListener("visibilitychange", onVisibility);
    startLoop();
    // With reduced motion, redraw on state changes only (via the effect deps below).
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [size, pulseRef, reducedMotion ? state : null]);

  const stateLabel = { idle: "standing by", listening: "listening", thinking: "thinking", speaking: "speaking" }[state];

  return (
    <button
      type="button"
      className={`orb orb-${state}`}
      style={{ width: size, height: size }}
      onClick={onClick}
      aria-label={label ?? `JARVIS is ${stateLabel}`}
      disabled={!onClick}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} aria-hidden="true" />
    </button>
  );
}
