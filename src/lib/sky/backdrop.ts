/**
 * The painted night behind the constellation: gradient, soft clouds, scattered stars and a sleeping village
 * on the hill (ported from docs/design/night-sky-mock.html). Seeded, so a resize repaints the same sky.
 */
export function paintBackdrop(c: CanvasRenderingContext2D, W: number, H: number): void {
  let s = 1371;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;

  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#0a0f1c");
  sky.addColorStop(0.55, "#0b1121");
  sky.addColorStop(1, "#060910");
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);

  const blob = (x: number, y: number, r: number, rgb: string, a: number) => {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${rgb},${a})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 46; i++) blob(rnd() * W * 0.55, rnd() * H * 0.5, 80 + rnd() * 260, "86,104,140", 0.025 + rnd() * 0.035);
  for (let i = 0; i < 26; i++) blob(W * (0.45 + rnd() * 0.3), H * (0.1 + rnd() * 0.5), 100 + rnd() * 240, "70,86,122", 0.015 + rnd() * 0.025);
  for (let i = 0; i < 40; i++) blob(W * (0.62 + rnd() * 0.42), H * (0.62 + rnd() * 0.45), 70 + rnd() * 200, "74,88,120", 0.03 + rnd() * 0.04);
  for (let i = 0; i < 30; i++) blob(W * (0.65 + rnd() * 0.4), H * (0.7 + rnd() * 0.35), 60 + rnd() * 160, "3,5,10", 0.35 + rnd() * 0.3);

  for (let i = 0; i < Math.round((W * H) / 2600); i++) {
    const x = rnd() * W;
    const y = rnd() * H * 0.9;
    const r = rnd() < 0.92 ? 0.3 + rnd() * 0.6 : 0.8 + rnd() * 0.8;
    c.globalAlpha = 0.15 + rnd() * 0.55;
    c.fillStyle = rnd() < 0.5 ? "#f6e2b0" : "#dfe6f6";
    if (r > 0.9) {
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 6;
    }
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
  }
  c.globalAlpha = 1;

  // The village on the hill, bottom left.
  const LW = Math.min(W * 0.36, 560);
  const base = H - (W >= 1000 ? 70 : 0);
  const S = Math.max(0.9, Math.min(1.3, W / 1150));
  const ridge = (x: number, amp: number, off: number, freq: number) => base - off - Math.sin(x * freq + 1.3) * amp - Math.sin(x * freq * 2.7 + 0.4) * amp * 0.35;
  const farRidge = (x: number) => ridge(x, 22 * S, 190 * S, 0.009 / S) + Math.pow(x / (LW * 1.1), 3) * 230 * S;
  const glow = c.createRadialGradient(LW * 0.35, base - 150, 0, LW * 0.35, base - 150, LW * 0.8);
  glow.addColorStop(0, "rgba(120,110,95,0.10)");
  glow.addColorStop(1, "rgba(120,110,95,0)");
  c.fillStyle = glow;
  c.fillRect(0, base - 420, LW * 1.4, 420);
  const hill = (amp: number, off: number, freq: number, color: string, extent: number) => {
    c.beginPath();
    c.moveTo(0, base);
    for (let x = 0; x <= extent; x += 6) c.lineTo(x, ridge(x, amp, off, freq) + Math.pow(x / extent, 3) * (off + 40));
    c.lineTo(extent, base);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  hill(30 * S, 250 * S, 0.006 / S, "#0c1322", LW * 1.25);
  hill(22 * S, 190 * S, 0.009 / S, "#080d18", LW * 1.1);

  const conifer = (x: number, y: number, h: number, color: string) => {
    c.fillStyle = color;
    for (let k = 0; k < 4; k++) {
      const ty = y - h * (k * 0.22);
      const w = h * (0.34 - k * 0.06);
      c.beginPath();
      c.moveTo(x - w, ty);
      c.lineTo(x, ty - h * 0.42);
      c.lineTo(x + w, ty);
      c.closePath();
      c.fill();
    }
    c.fillRect(x - 1.5, y - 2, 3, 6);
  };
  const leafy = (x: number, y: number, h: number, color: string) => {
    c.fillStyle = color;
    for (let k = 0; k < 6; k++) {
      c.beginPath();
      c.arc(x + (rnd() - 0.5) * h * 0.5, y - h * 0.55 - rnd() * h * 0.35, h * (0.18 + rnd() * 0.14), 0, Math.PI * 2);
      c.fill();
    }
    c.fillRect(x - 1.5, y - h * 0.4, 3, h * 0.4);
  };
  for (let x = 4; x < LW * 1.05; x += 7 + rnd() * 9) {
    const h = (18 + rnd() * 30) * S * (1 - x / (LW * 1.6));
    (rnd() < 0.55 ? conifer : leafy)(x, farRidge(x) + 4, h, "#070b15");
  }

  const lit = (x: number, y: number, w: number, h: number) => {
    c.save();
    c.shadowColor = "rgba(255,190,100,0.9)";
    c.shadowBlur = 10;
    c.fillStyle = "#f3c068";
    c.beginPath();
    c.moveTo(x, y + h);
    c.lineTo(x, y + w / 2);
    c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    c.lineTo(x + w, y + h);
    c.closePath();
    c.fill();
    c.restore();
  };
  // The church: nave, tower, spire; warm lit windows.
  const cx0 = LW * 0.38;
  const cy0 = farRidge(cx0) + 2;
  c.save();
  c.translate(cx0, cy0);
  c.scale(S, S);
  c.translate(-cx0, -cy0);
  c.fillStyle = "#05080f";
  c.fillRect(cx0, cy0 - 34, 74, 36);
  c.beginPath();
  c.moveTo(cx0 - 3, cy0 - 34);
  c.lineTo(cx0 + 37, cy0 - 56);
  c.lineTo(cx0 + 77, cy0 - 34);
  c.closePath();
  c.fill();
  c.fillRect(cx0 - 22, cy0 - 78, 24, 80);
  c.beginPath();
  c.moveTo(cx0 - 25, cy0 - 78);
  c.lineTo(cx0 - 10, cy0 - 142);
  c.lineTo(cx0 + 5, cy0 - 78);
  c.closePath();
  c.fill();
  c.fillRect(cx0 - 10.6, cy0 - 156, 1.2, 14);
  c.fillRect(cx0 - 14, cy0 - 151, 8, 1.2);
  lit(cx0 + 12, cy0 - 26, 5, 11);
  lit(cx0 + 30, cy0 - 26, 5, 11);
  lit(cx0 + 48, cy0 - 26, 5, 11);
  lit(cx0 - 13, cy0 - 64, 5, 10);
  c.restore();

  for (const [fx, w0, h0] of [[0.6, 30, 18], [0.7, 24, 15], [0.82, 26, 16], [0.16, 26, 16]] as const) {
    const w = w0 * S;
    const h = h0 * S;
    const x = LW * fx;
    const y = farRidge(x) + 3;
    c.fillStyle = "#05080f";
    c.fillRect(x, y - h, w, h + 2);
    c.beginPath();
    c.moveTo(x - 3, y - h);
    c.lineTo(x + w / 2, y - h - 11);
    c.lineTo(x + w + 3, y - h);
    c.closePath();
    c.fill();
    if (rnd() < 0.8) {
      c.save();
      c.shadowColor = "rgba(255,190,100,0.9)";
      c.shadowBlur = 8;
      c.fillStyle = "#f0b860";
      c.fillRect(x + w * 0.3, y - h * 0.6, 3.5, 4);
      c.restore();
    }
  }
  for (let x = -10; x < LW * 0.9; x += 16 + rnd() * 22) {
    const tall = x < LW * 0.2;
    const h = (tall ? 110 + rnd() * 120 : (34 + rnd() * 40) * (1 - x / LW)) * S;
    (tall || rnd() < 0.6 ? conifer : leafy)(x, base - 30 - rnd() * 30, h, "#03060c");
  }
  c.fillStyle = "#03060b";
  c.beginPath();
  c.moveTo(0, base);
  for (let x = 0; x <= LW * 1.2; x += 8) c.lineTo(x, base - 46 + Math.sin(x * 0.013) * 10 + Math.pow(x / (LW * 1.2), 2) * 46);
  c.lineTo(LW * 1.2, base);
  c.closePath();
  c.fill();

  const v = c.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  c.fillStyle = v;
  c.fillRect(0, 0, W, H);
}
