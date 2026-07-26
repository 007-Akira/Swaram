"use client";

import { useEffect, useRef } from "react";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import WaveSurfer from "wavesurfer.js";

import type { EditableLyricLine } from "../../../../lib/lyric-editor";
import {
  linesToMarkers,
  updateLineFromMarker,
} from "../../../../lib/waveform-markers";

interface Props {
  audioUrl: string;
  lines: EditableLyricLine[];
  onLinesChange: (lines: EditableLyricLine[]) => void;
  onSelectLine: (index: number) => void;
  onError: (message: string) => void;
}

export function LyricWaveform({
  audioUrl,
  lines,
  onLinesChange,
  onSelectLine,
  onError,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const waveSurfer = useRef<WaveSurfer | null>(null);
  const regions = useRef<RegionsPlugin | null>(null);
  const currentLines = useRef(lines);

  useEffect(() => {
    currentLines.current = lines;
  }, [lines]);

  useEffect(() => {
    if (!container.current) return;
    const regionPlugin = RegionsPlugin.create();
    const waveform = WaveSurfer.create({
      container: container.current,
      url: audioUrl,
      backend: "MediaElement",
      height: 96,
      waveColor: "#67a890",
      progressColor: "#34d399",
      cursorColor: "#f8fafc",
      minPxPerSec: 8,
      normalize: false,
      plugins: [regionPlugin],
    });
    waveSurfer.current = waveform;
    regions.current = regionPlugin;
    const unsubscribeClick = regionPlugin.on(
      "region-clicked",
      (region, event) => {
        event.stopPropagation();
        waveform.setTime(region.start);
        const marker = linesToMarkers(currentLines.current).find(
          (item) => item.lineId === region.id,
        );
        if (marker) onSelectLine(marker.lineIndex);
      },
    );
    const unsubscribeUpdate = regionPlugin.on("region-updated", (region) => {
      try {
        onLinesChange(
          updateLineFromMarker(currentLines.current, region.id, region.start),
        );
      } catch {
        onError("മാർക്കർ അടുത്ത വരിയെ കടക്കാനാവില്ല.");
      }
    });
    return () => {
      unsubscribeClick();
      unsubscribeUpdate();
      waveform.destroy();
      waveSurfer.current = null;
      regions.current = null;
    };
  }, [audioUrl, onError, onLinesChange, onSelectLine]);

  useEffect(() => {
    const plugin = regions.current;
    if (!plugin) return;
    plugin.clearRegions();
    for (const marker of linesToMarkers(lines)) {
      plugin.addRegion({
        id: marker.lineId,
        start: marker.startSeconds,
        end: marker.endSeconds,
        content: marker.label,
        color: "rgba(52, 211, 153, 0.18)",
        drag: true,
        resize: false,
      });
    }
  }, [lines]);

  return (
    <div>
      <p className="mb-2 text-sm text-slate-300">
        തരംഗരൂപം നാവിഗേഷനു മാത്രം; പിച്ച് ഗ്രാഫല്ല.
      </p>
      <div
        aria-label="ഗാന തരംഗരൂപവും വരി മാർക്കറുകളും"
        className="overflow-x-auto rounded-lg bg-[#06110d]"
        ref={container}
      />
    </div>
  );
}
