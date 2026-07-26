"use client";

import { useEffect, useRef } from "react";

import { renderPitchContours, type ContourPoint } from "./pitch-renderer";

interface Props {
  readonly getReference: () => readonly ContourPoint[];
  readonly getLive: () => readonly ContourPoint[];
  readonly getCurrentTimeMs: () => number;
  readonly toleranceCents?: number;
  readonly showNoteLanes?: boolean;
}

export function PitchCanvas({
  getReference,
  getLive,
  getCurrentTimeMs,
  toleranceCents,
  showNoteLanes,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let animationFrame = 0;
    const render = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const ratio = window.devicePixelRatio || 1;
      const pixelWidth = Math.max(1, Math.round(width * ratio));
      const pixelHeight = Math.max(1, Math.round(height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (context) {
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        renderPitchContours(context, width, height, getReference(), getLive(), {
          currentTimeMs: getCurrentTimeMs(),
          toleranceCents,
          showNoteLanes,
        });
      }
      animationFrame = requestAnimationFrame(render);
    };
    animationFrame = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrame);
  }, [getCurrentTimeMs, getLive, getReference, showNoteLanes, toleranceCents]);

  return (
    <canvas
      aria-label="റഫറൻസ്, തത്സമയ ശ്രുതി ഗ്രാഫ്"
      className="h-72 w-full rounded-xl"
      ref={canvasRef}
      role="img"
    />
  );
}
