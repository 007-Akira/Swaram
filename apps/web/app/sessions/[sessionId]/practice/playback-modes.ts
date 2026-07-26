export type PlaybackMode = "original" | "instrumental" | "reduced_reference";

export interface PlaybackAsset {
  readonly id: string;
  readonly kind: string;
}

export interface PlaybackModeAvailability {
  readonly mode: PlaybackMode;
  readonly assetId: string | null;
  readonly available: boolean;
  readonly reason: string | null;
}

export function playbackModeAvailability(
  assets: readonly PlaybackAsset[],
): readonly PlaybackModeAvailability[] {
  const original = assets.find(({ kind }) => kind === "original_audio");
  const instrumental = assets.find(({ kind }) => kind === "instrumental");
  return [
    {
      mode: "original",
      assetId: original?.id ?? null,
      available: Boolean(original),
      reason: original ? null : "Original audio is unavailable.",
    },
    {
      mode: "instrumental",
      assetId: instrumental?.id ?? null,
      available: Boolean(instrumental),
      reason: instrumental ? null : "The instrumental track is not ready.",
    },
    {
      mode: "reduced_reference",
      assetId: null,
      available: false,
      reason: "A private reduced-vocal mix is unavailable in this version.",
    },
  ];
}

export function preferredPlaybackMode(
  availability: readonly PlaybackModeAvailability[],
): PlaybackMode | null {
  return (
    availability.find(
      ({ mode, available }) => mode === "instrumental" && available,
    )?.mode ??
    availability.find(({ mode, available }) => mode === "original" && available)
      ?.mode ??
    null
  );
}
