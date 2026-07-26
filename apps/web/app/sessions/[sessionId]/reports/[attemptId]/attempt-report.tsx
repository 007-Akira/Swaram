import Link from "next/link";

export interface AttemptReportData {
  readonly overall_score: number | null;
  readonly component_scores: Record<string, number | null>;
  readonly evidence_confidence: number;
  readonly feedback: Array<{
    code: string;
    kind: "strength" | "correction" | "insufficient";
    message: string;
  }>;
  readonly phrases: Array<{
    line_id: string;
    text: string;
    start_ms: number;
    score: number | null;
    metrics: Record<
      string,
      {
        confidence: number;
        coverage: number;
      }
    >;
    feedback: Array<{ code: string; message: string }>;
  }>;
}

export interface AttemptReportRecord {
  readonly id: string;
  readonly created_at: string;
  readonly data: AttemptReportData;
}

interface Props {
  readonly sessionId: string;
  readonly attempt: AttemptReportRecord;
  readonly history: readonly AttemptReportRecord[];
}

const COMPONENT_LABELS: Record<string, string> = {
  pitch: "ശ്രുതി",
  timing: "സമയം",
  contour: "സ്വരചലനം",
  stability: "സ്ഥിരത",
  completion: "പൂർത്തീകരണം",
};

export function AttemptReport({ sessionId, attempt, history }: Props) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <h1 className="text-3xl font-semibold">പരിശീലന റിപ്പോർട്ട്</h1>
      <p className="mt-4 text-5xl font-bold">
        {attempt.data.overall_score === null
          ? "—"
          : Math.round(attempt.data.overall_score)}
      </p>
      <p>
        തെളിവിന്റെ ആത്മവിശ്വാസം:{" "}
        {Math.round(attempt.data.evidence_confidence * 100)}%
      </p>
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(attempt.data.component_scores).map(([key, score]) => (
          <div className="rounded-lg bg-slate-900 p-3" key={key}>
            <p>{COMPONENT_LABELS[key] ?? key}</p>
            <p className="text-2xl">
              {score === null ? "—" : Math.round(score)}
            </p>
          </div>
        ))}
      </section>
      <section className="mt-6">
        <h2 className="text-2xl font-semibold">പ്രധാന നിർദ്ദേശങ്ങൾ</h2>
        {attempt.data.feedback.length ? (
          <ul className="mt-3 space-y-2">
            {attempt.data.feedback.map((item) => (
              <li className="rounded-lg bg-slate-900 p-3" key={item.code}>
                {item.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>വിശ്വസനീയമായ നിർദ്ദേശത്തിന് കൂടുതൽ സ്വര ഡാറ്റ ആവശ്യമാണ്.</p>
        )}
      </section>
      <section className="mt-6">
        <h2 className="text-2xl font-semibold">വരി അടിസ്ഥാനത്തിലുള്ള ഫലം</h2>
        <ol className="mt-3 space-y-3">
          {attempt.data.phrases.map((phrase) => {
            const pitch = phrase.metrics.pitch;
            return (
              <li
                className="rounded-lg border border-slate-700 p-4"
                key={phrase.line_id}
              >
                <p className="text-lg">{phrase.text}</p>
                <p>
                  സ്കോർ:{" "}
                  {phrase.score === null ? "—" : Math.round(phrase.score)}
                </p>
                <p className="text-sm text-slate-300">
                  കവറേജ് {Math.round((pitch?.coverage ?? 0) * 100)}% ·
                  ആത്മവിശ്വാസം {Math.round((pitch?.confidence ?? 0) * 100)}%
                </p>
                {phrase.feedback.map((item) => (
                  <p className="mt-1 text-sm" key={item.code}>
                    {item.message}
                  </p>
                ))}
                <Link
                  className="mt-3 inline-block"
                  href={`/sessions/${sessionId}/practice?seek=${phrase.start_ms}`}
                >
                  ഈ വരി വീണ്ടും പരിശീലിക്കുക
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="mt-6">
        <h2 className="text-2xl font-semibold">മുൻ ശ്രമങ്ങൾ</h2>
        <ul>
          {history
            .filter(({ id }) => id !== attempt.id)
            .slice(0, 5)
            .map((item) => (
              <li key={item.id}>
                <Link href={`/sessions/${sessionId}/reports/${item.id}`}>
                  {new Date(item.created_at).toLocaleString()} —{" "}
                  {item.data.overall_score === null
                    ? "—"
                    : Math.round(item.data.overall_score)}
                </Link>
              </li>
            ))}
        </ul>
      </section>
    </main>
  );
}
