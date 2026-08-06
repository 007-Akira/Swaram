export type SessionUnavailableVariant =
  | "expired"
  | "deleted"
  | "not_found"
  | "missing_token"
  | "invalid_token"
  | "access_denied"
  | "files_unavailable"
  | "unknown";

const key = (sessionId: string, name: string) => `swaram:${sessionId}:${name}`;

export function sessionToken(sessionId: string): string | null {
  return window.sessionStorage.getItem(key(sessionId, "token"));
}

export function rememberSession(
  sessionId: string,
  values: {
    token: string;
    expiresAt: string;
    songName: string;
    jobId?: string;
  },
) {
  window.sessionStorage.setItem(key(sessionId, "token"), values.token);
  window.sessionStorage.setItem(key(sessionId, "expires-at"), values.expiresAt);
  window.sessionStorage.setItem(key(sessionId, "song-name"), values.songName);
  if (values.jobId) {
    window.sessionStorage.setItem(key(sessionId, "job-id"), values.jobId);
  }
}

export function sessionMetadata(sessionId: string) {
  return {
    token: sessionToken(sessionId),
    expiresAt: window.sessionStorage.getItem(key(sessionId, "expires-at")),
    songName: window.sessionStorage.getItem(key(sessionId, "song-name")),
    jobId: window.sessionStorage.getItem(key(sessionId, "job-id")),
    deleted:
      window.sessionStorage.getItem(key(sessionId, "deleted")) === "true",
  };
}

export function markSessionDeleted(sessionId: string) {
  clearSessionAccess(sessionId);
  window.sessionStorage.setItem(key(sessionId, "deleted"), "true");
}

export function clearSessionAccess(sessionId: string) {
  for (const name of ["token", "expires-at", "song-name", "job-id"]) {
    window.sessionStorage.removeItem(key(sessionId, name));
  }
}

export function unavailableVariant(
  sessionId: string,
  response?: Pick<Response, "status">,
): SessionUnavailableVariant {
  const metadata = sessionMetadata(sessionId);
  if (metadata.deleted) return "deleted";
  if (!metadata.token) return "missing_token";
  if (metadata.expiresAt && Date.parse(metadata.expiresAt) <= Date.now()) {
    return "expired";
  }
  if (response?.status === 401) return "invalid_token";
  if (response?.status === 403) return "access_denied";
  if (response?.status === 404) return "not_found";
  return "unknown";
}
