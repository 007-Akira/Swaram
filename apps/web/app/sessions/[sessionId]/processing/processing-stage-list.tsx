import type { ProcessingStatus } from "../../../../lib/use-session-processing-status";

export const PROCESSING_STAGES = [
  { keys: ["queued", "claimed"], label: "Validating upload" },
  { keys: ["normalizing"], label: "Converting audio" },
  {
    keys: [
      "stem_separation_preparing",
      "stem_separation_running",
      "stem_separation_complete",
    ],
    label: "Separating vocals",
  },
  { keys: ["extracting_contour"], label: "Extracting reference pitch" },
  { keys: ["analyzing_timing"], label: "Analysing lyric timing" },
  {
    keys: ["storing_results", "complete"],
    label: "Preparing the private workspace",
  },
] as const;

export function stageIndex(stage: string) {
  const index = PROCESSING_STAGES.findIndex(({ keys }) =>
    (keys as readonly string[]).includes(stage),
  );
  return index < 0 ? 0 : index;
}

export function processingStageLabel(stage: string) {
  return PROCESSING_STAGES[stageIndex(stage)]!.label;
}

export function ProcessingStageList({ status }: { status: ProcessingStatus }) {
  const active = stageIndex(status.progress_stage);
  return (
    <ol className="mt-8 space-y-3" aria-label="Audio processing stages">
      {PROCESSING_STAGES.map((stage, index) => {
        const state =
          status.state === "failed" && index === active
            ? "failed"
            : status.state === "succeeded" || index < active
              ? "complete"
              : index === active
                ? "active"
                : "pending";
        return (
          <li
            className="flex items-center gap-4 border-b border-[#e3beb8] py-3"
            key={stage.label}
          >
            <span
              aria-hidden="true"
              className={`grid size-7 place-items-center rounded-full border text-sm font-bold ${
                state === "complete"
                  ? "border-[#775a19] bg-[#fed488] text-[#261900]"
                  : state === "active"
                    ? "border-[#8b0000] bg-[#8b0000] text-white"
                    : state === "failed"
                      ? "border-[#ba1a1a] bg-[#ffdad6] text-[#93000a]"
                      : "border-[#e3beb8] text-[#8e706b]"
              }`}
            >
              {state === "complete"
                ? "✓"
                : state === "failed"
                  ? "!"
                  : index + 1}
            </span>
            <span
              className={state === "pending" ? "text-[#8e706b]" : "font-medium"}
            >
              {stage.label}
            </span>
            <span className="ml-auto text-xs font-bold uppercase tracking-wider text-[#785a1a]">
              {state}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
