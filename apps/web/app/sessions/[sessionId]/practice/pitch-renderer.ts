export interface ContourPoint {
  readonly timeMs: number;
  readonly midi: number | null;
  readonly voiced: boolean;
}

export interface PitchViewport {
  readonly startMs: number;
  readonly endMs: number;
  readonly minimumMidi: number;
  readonly maximumMidi: number;
  readonly width: number;
  readonly height: number;
}

export function createPitchViewport(
  currentTimeMs: number,
  width: number,
  height: number,
  windowDurationMs = 10_000,
  minimumMidi = 45,
  maximumMidi = 84,
): PitchViewport {
  const lookBehind = windowDurationMs * 0.35;
  return {
    startMs: Math.max(0, currentTimeMs - lookBehind),
    endMs: Math.max(
      windowDurationMs,
      currentTimeMs - lookBehind + windowDurationMs,
    ),
    minimumMidi,
    maximumMidi,
    width,
    height,
  };
}

export function timeToX(timeMs: number, viewport: PitchViewport): number {
  return (
    ((timeMs - viewport.startMs) / (viewport.endMs - viewport.startMs)) *
    viewport.width
  );
}

export function xToTime(x: number, viewport: PitchViewport): number {
  return (
    viewport.startMs +
    (x / Math.max(1, viewport.width)) * (viewport.endMs - viewport.startMs)
  );
}

export function midiToY(midi: number, viewport: PitchViewport): number {
  return (
    viewport.height -
    ((midi - viewport.minimumMidi) /
      (viewport.maximumMidi - viewport.minimumMidi)) *
      viewport.height
  );
}

function lowerBound(points: readonly ContourPoint[], timeMs: number): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((points[middle]?.timeMs ?? Number.POSITIVE_INFINITY) < timeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function selectContourWindow(
  points: readonly ContourPoint[],
  startMs: number,
  endMs: number,
): readonly ContourPoint[] {
  if (points.length === 0 || endMs < startMs) return [];
  const start = Math.max(0, lowerBound(points, startMs) - 1);
  const end = Math.min(points.length, lowerBound(points, endMs) + 1);
  return points.slice(start, end);
}

export interface RenderPitchOptions {
  readonly currentTimeMs: number;
  readonly toleranceCents?: number;
  readonly showNoteLanes?: boolean;
}

export function renderPitchContours(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  reference: readonly ContourPoint[],
  live: readonly ContourPoint[],
  options: RenderPitchOptions,
): void {
  const viewport = createPitchViewport(options.currentTimeMs, width, height);
  const visibleReference = selectContourWindow(
    reference,
    viewport.startMs,
    viewport.endMs,
  );
  const visibleLive = selectContourWindow(
    live,
    viewport.startMs,
    viewport.endMs,
  );
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#071b16";
  context.fillRect(0, 0, width, height);

  if (options.showNoteLanes) {
    context.strokeStyle = "rgba(148, 163, 184, 0.12)";
    context.lineWidth = 1;
    for (
      let note = Math.ceil(viewport.minimumMidi);
      note <= viewport.maximumMidi;
      note += 1
    ) {
      const y = midiToY(note, viewport);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  }

  const draw = (
    points: readonly ContourPoint[],
    color: string,
    lineWidth: number,
  ) => {
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.beginPath();
    let drawing = false;
    for (const point of points) {
      if (!point.voiced || point.midi === null) {
        drawing = false;
        continue;
      }
      const x = timeToX(point.timeMs, viewport);
      const y = midiToY(point.midi, viewport);
      if (drawing) context.lineTo(x, y);
      else context.moveTo(x, y);
      drawing = true;
    }
    context.stroke();
  };

  const toleranceMidi = (options.toleranceCents ?? 50) / 100;
  context.strokeStyle = "rgba(110, 231, 183, 0.2)";
  context.lineWidth = Math.max(
    2,
    Math.abs(
      midiToY(viewport.minimumMidi + toleranceMidi, viewport) -
        midiToY(viewport.minimumMidi - toleranceMidi, viewport),
    ),
  );
  draw(visibleReference, "rgba(110, 231, 183, 0.25)", context.lineWidth);
  draw(visibleReference, "#6ee7b7", 2);
  draw(visibleLive, "#fb923c", 2.5);

  const playheadX = timeToX(options.currentTimeMs, viewport);
  context.beginPath();
  context.moveTo(playheadX, 0);
  context.lineTo(playheadX, height);
  context.strokeStyle = "#f8fafc";
  context.lineWidth = 1;
  context.stroke();
}
