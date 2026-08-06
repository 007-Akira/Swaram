import { SessionProcessing } from "./session-processing";

export default async function ProcessingPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionProcessing sessionId={sessionId} />;
}
