import { PracticeSession } from "./practice-session";

export default async function PracticePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <PracticeSession sessionId={sessionId} />;
}
