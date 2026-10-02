"use client";

import { useEffect, useRef } from "react";
import { paintBackdrop } from "@/lib/sky/backdrop";

/** The painted night, sized to its container and repainted (same seed, same sky) whenever that size changes. */
export function BackdropCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const paint = () => {
      const { clientWidth: W, clientHeight: H } = host;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintBackdrop(ctx, W, H);
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  return <canvas ref={ref} className="sky-backdrop" aria-hidden="true" />;
}
