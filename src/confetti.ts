// A one-shot confetti burst from both sides of the screen on its own canvas.
// The canvas removes itself once every particle has fallen off screen.

const COUNT = 150;
const MAX_MS = 9000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  round: boolean;
  spin: number;
  angle: number;
  flutter: number;
  phase: number;
}

const canvases = new Set<HTMLCanvasElement>();

export function burstConfetti(colors: string[]): void {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx || !colors.length) return;
  canvas.className = 'confetti';
  document.body.append(canvas);
  canvases.add(canvas);

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Speeds are relative to the screen so phones and desktops look alike.
  // Drag stops the sideways travel somewhere between a third of the way and
  // the far side; gravity peaks the arc in the top half.
  const gravity = height * 1.6; // px/s²
  const fallSpeed = height * 0.22; // drifting terminal velocity, px/s

  const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => {
    const fromLeft = i % 2 === 0;
    return {
      x: fromLeft ? -8 : width + 8,
      y: height * (0.55 + Math.random() * 0.2),
      vx: width * (0.4 + Math.random() * 0.9) * (fromLeft ? 1 : -1),
      vy: -height * (0.8 + Math.random() * 0.7),
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[Math.floor(Math.random() * colors.length)],
      round: Math.random() < 0.3,
      spin: (Math.random() - 0.5) * 12,
      angle: Math.random() * Math.PI * 2,
      flutter: 4 + Math.random() * 6,
      phase: Math.random() * Math.PI * 2,
    };
  });

  const start = performance.now();
  let last = start;
  const frame = (now: number) => {
    if (!canvases.has(canvas)) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    const age = (now - start) / 1000;
    last = now;
    ctx.clearRect(0, 0, width, height);

    let onScreen = 0;
    for (const p of particles) {
      p.vx *= 1 - 1.4 * dt; // air drag
      p.vy = Math.min(p.vy + gravity * dt, fallSpeed);
      p.x += (p.vx + Math.sin(age * 3 + p.phase) * 40) * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      if (p.y > height + 20) continue;
      onScreen++;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.scale(1, Math.cos(age * p.flutter + p.phase)); // paper turning over
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }

    if (onScreen && now - start < MAX_MS) requestAnimationFrame(frame);
    else removeCanvas(canvas);
  };
  requestAnimationFrame(frame);
}

function removeCanvas(canvas: HTMLCanvasElement): void {
  canvases.delete(canvas);
  canvas.remove();
}

export function clearConfetti(): void {
  canvases.forEach(removeCanvas);
}
