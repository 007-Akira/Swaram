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
      reason: original ? null : "ഒറിജിനൽ ഓഡിയോ ലഭ്യമല്ല.",
    },
    {
      mode: "instrumental",
      assetId: instrumental?.id ?? null,
      available: Boolean(instrumental),
      reason: instrumental ? null : "ഇൻസ്ട്രുമെന്റൽ തയ്യാറായിട്ടില്ല.",
    },
    {
      mode: "reduced_reference",
      assetId: null,
      available: false,
      reason: "സ്വകാര്യ വോക്കൽ മിക്സ് ഈ പതിപ്പിൽ ലഭ്യമല്ല.",
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
