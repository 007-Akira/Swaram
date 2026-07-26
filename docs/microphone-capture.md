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
