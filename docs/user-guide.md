# User guide

Swaram is Malayalam-only singing pitch-practice software. It does not provide,
search for, or bundle songs or lyrics. Use only audio and lyrics you are
authorized to process.

## Current flow

The browser creates a private 24-hour session, uploads one supported audio file
and UTF-8 Malayalam lyrics, and opens a private processing screen. That screen
polls the durable backend worker using its real job stage and percentage; it
does not estimate progress from elapsed time. Success opens lyric editing and
synchronization, followed by headphone calibration, practice, and reports.

Keep the returned session token private. It is stored only in browser
`sessionStorage` by the current route integration and is required for every
private operation. The server stores only its SHA-256 hash.

The development-only seeded redirect bypasses normal setup only when its
explicit development environment variables are configured. Production follows
create → upload → processing → lyrics, and private tokens never appear in URLs.

## Lyrics and practice

Review Malayalam text, stanza breaks, and imported timestamps. During manual
synchronization, play the song and press Space at each line start, then nudge
markers if needed. Save and resolve every readiness message before practice.

Wear headphones. Run the leakage calibration and do not bypass a high-leakage
warning except during controlled testing. Grant microphone permission only on
the HTTPS Swaram origin. Choose original or instrumental playback, adjust
latency, optionally loop a line, and practise at 0.5×, 0.75×, 0.9×, or 1×.

The graph and text feedback distinguish voiced evidence, timing, contour,
stability, completion, confidence, and coverage. Scores are coaching signals,
not an assessment of singing ability. Consonants, rests, low-confidence frames,
and short transitions are excluded where possible.

## Privacy and deletion

Uploads, lyrics, derivatives, and reports are private and expire after the
configured retention period (24 hours by default). Raw microphone audio stays
in the browser and is not recorded. Session screens expose an immediate delete
control; confirm it to remove private objects and database records. Confirmed
deletion stops the active session UI, clears its browser token, and opens a
terminal deletion screen. Signed playback URLs last no more than five minutes.

## Compatibility and limitations

Uploads support MP3, WAV, M4A/MP4 audio, and FLAC; lyrics support pasted text,
TXT, LRC, and SRT. The production target is current Chromium, Firefox, and
Safari releases with secure-context Web Audio, AudioWorklet, Canvas, media
playback, and microphone APIs. Browser/device behavior still requires physical
verification; native audio controls and pitch-preserving slowdown vary.

HTDemucs can leave vocal leakage or remove accompaniment detail. pYIN may lose
breathy, noisy, polyphonic, or very low/high notes and can make octave errors.
Live YIN depends on microphone quality, room noise, frame size, and latency
calibration. Rule-based scores are meaningful only when voiced coverage and
confidence are adequate.

Session routes use one safe recovery screen for missing or invalid access,
expiry, deletion, missing files, and temporary failures. The API deliberately
hides whether an inaccessible private session exists, so some server-side cases
share the same “unavailable” wording.

Before calibration, Swaram feature-detects secure context, microphone APIs,
Web Audio, AudioWorklet, decoding, and Canvas. It never requests microphone
permission on page load; the request follows the explicit “Allow microphone”
action. Permission denial and missing input devices provide recovery guidance.
