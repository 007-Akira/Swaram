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
