"use client";

import { useEffect, useRef } from "react";

import {
  createPitchViewport,
  renderPitchContours,
  type ContourPoint,
  xToTime,
} from "./pitch-renderer";

interface Props {
  readonly getReference: () => readonly ContourPoint[];
  readonly getLive: () => readonly ContourPoint[];
  readonly getCurrentTimeMs: () => number;
  readonly toleranceCents?: number;
  readonly showNoteLanes?: boolean;
  readonly onSelectRegion?: (startMs: number, endMs: number) => void;
}

export function PitchCanvas({
  getReference,
  getLive,
  getCurrentTimeMs,
  toleranceCents,
  showNoteLanes,
  onSelectRegion,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectionStartX = useRef<number | null>(null);

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
      onPointerDown={(event) => {
        selectionStartX.current = event.nativeEvent.offsetX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        const startX = selectionStartX.current;
        selectionStartX.current = null;
        if (startX === null || !onSelectRegion) return;
        const viewport = createPitchViewport(
          getCurrentTimeMs(),
          event.currentTarget.clientWidth,
          event.currentTarget.clientHeight,
        );
        const first = xToTime(startX, viewport);
        const second = xToTime(event.nativeEvent.offsetX, viewport);
        if (Math.abs(second - first) >= 250) {
          onSelectRegion(Math.min(first, second), Math.max(first, second));
        }
      }}
      ref={canvasRef}
      role="img"
    />
  );
}
