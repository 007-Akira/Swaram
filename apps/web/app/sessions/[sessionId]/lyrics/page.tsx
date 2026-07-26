import { LyricsEditor } from "./lyrics-editor";

export default async function LyricsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <LyricsEditor sessionId={sessionId} />;
}
