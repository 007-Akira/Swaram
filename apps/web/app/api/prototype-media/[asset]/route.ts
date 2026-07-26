import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

const ASSETS = {
  analysis: {
    path: ["analysis", "test_audio.analysis-v1.json"],
    contentType: "application/json; charset=utf-8",
  },
  audio: {
    path: ["reference", "test_audio.prototype.wav"],
    contentType: "audio/wav",
  },
  lyrics: {
    path: ["lyrics", "test_audio.prototype.lrc"],
    contentType: "text/plain; charset=utf-8",
  },
} as const;

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ asset: string }> },
): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { asset } = await context.params;
  const selected = ASSETS[asset as keyof typeof ASSETS];
  if (!selected) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const root =
    process.env.PRIVATE_PROTOTYPE_MEDIA_ROOT ??
    path.resolve(process.cwd(), "..", "..", "private-media");
  try {
    const data = await readFile(
      path.resolve(process.cwd(), root, ...selected.path),
    );
    return new Response(new Uint8Array(data), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": selected.contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "prototype_media_unavailable" },
      { status: 404 },
    );
  }
}
