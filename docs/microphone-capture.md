# Browser microphone capture

Microphone capture requires a secure browser context and an explicit user
action. The web capture controller reports permission/lifecycle transitions
separately from high-rate audio frames, so React does not rerender for every
sample.

Automatic gain control is always disabled. Echo cancellation and noise
suppression default to disabled and can be explicitly enabled by a caller. The
AudioWorklet accumulates 4,096-sample frames with a 1,024-sample hop and
transfers each frame buffer without cloning. Stopping capture disconnects all
nodes, stops every media track, clears the message callback, and closes the
audio context.

## Practice audio-session ownership

The production practice path uses `AudioSessionController` as the single owner
of the playback element, `AudioContext`, microphone stream, media source nodes,
and pitch worklet. Its explicit lifecycle is:

`idle → requesting_permission → calibrating → ready → playing ⇄ paused → stopped`

Failures enter `error`; retry starts a fresh permission request after releasing
all resources. React subscribes only to the low-frequency derived session
state. Raw worklet frames use a separate callback and must not be copied into a
React store. Route cleanup calls `dispose()`. Hiding the page stops playback,
closes the context, disconnects nodes, and stops every microphone track.

## Headphone and leakage calibration

Before practice, the controller generates a short 500–2,000 Hz chirp, plays it
through the owned output path, and compares it with microphone frames using RMS
and normalized cross-correlation. Correlation uses a reduced-rate analysis copy
to keep calibration bounded on mobile devices.

This estimates playback leakage; it does not detect whether headphones are
physically connected. High correlation blocks continuation by default.
Moderate leakage produces a warning, and silence is reported as inconclusive.
An explicit UI checkbox can override a high-leakage result for testing only.

## Latency estimate

The audio session stores one latency offset in milliseconds. It starts with the
browser's `AudioContext.baseLatency` and `outputLatency` where available. A
measured chirp return can provide a round-trip estimate; the comparison offset
uses half that value when it exceeds the browser estimate. A guided test phrase
may nudge the result by at most 250 ms per adjustment.

These properties vary by browser, operating system, and output device, and some
browsers report neither. The corrected-time API returns a branded record and
rejects already-corrected input, preventing subtraction of the offset twice.
