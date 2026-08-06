# Session flow manual QA

## Processing and access states

- Create a session with each supported audio format and pasted/file lyrics.
- Confirm navigation is `/processing`, real worker stages advance, and success redirects once to `/lyrics`.
- Stop the worker and confirm queued processing remains honest; no time-derived progress should appear.
- Simulate a recoverable worker failure; retry it and confirm the same private job returns to queued.
- Close and reopen processing in the same browser session; confirm access is retained without a token in the URL.
- Remove the token and verify the shared missing-access screen on processing, lyrics, practice, and reports.
- Test expired, deleted, invalid-token, processing-failure, network-loss, and missing-file responses.

## Browser and device checks

- Test current desktop and mobile Chromium, Firefox, and Safari over HTTPS.
- Verify insecure non-local HTTP, absent microphone APIs, denied permission, no input device, missing AudioWorklet, and AudioContext failure.
- Confirm no permission prompt occurs until “Allow microphone” is selected.
- Retry after changing permission or connecting a microphone.
- Verify keyboard focus, announcements, Malayalam line height, and reduced-motion behavior.

## Deletion

- Delete during lyrics, calibration, active playback, paused practice, and processing.
- Confirm playback/microphone work stops, the token is cleared, and `/sessions/deleted` appears only after success or an already-absent response.
- Test timeout, offline, unauthorized, and server-failure responses; the terminal success screen must not appear.
- Confirm browser Back cannot reopen the deleted session and no restore action is offered.
