import { ReportLoader } from "./report-loader";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ sessionId: string; attemptId: string }>;
}) {
  const { sessionId, attemptId } = await params;
  return <ReportLoader attemptId={attemptId} sessionId={sessionId} />;
}
