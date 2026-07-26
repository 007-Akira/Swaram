# Browser pitch detection

`@swaram/audio-core` provides a dependency-light YIN detector for individual
microphone frames. It returns frequency, confidence, and voiced state without
assigning arbitrary notes to silence or broadband noise.

At 48 kHz, a 4,096-sample frame spans about 85 ms and supports reliable
detection near 80 Hz. Smaller frames reduce algorithmic latency but cannot
represent low fundamentals; larger frames improve low-note resolution at the
cost of latency and CPU work. The AudioWorklet integration should accumulate
overlapping frames and timestamp them against one monotonic practice clock.

`LivePitchProcessor` converts raw YIN observations into display-ready events.
It applies a configurable vocal range, RMS/noise gate, confidence gate, a
three-frame median, and isolated octave-spike rejection. Unvoiced frames clear
the smoothing history so rests and consonants do not drag the next note.
Octave-sized changes are accepted after a confirming frame; other gradual
slides and vibrato are not clamped. Optional debug output includes raw and
smoothed F0 plus RMS.

The AudioWorklet timestamps each transferred PCM window from its processed
sample count and the audio sample rate. The browser controller preserves that
audio-clock timestamp on each stable frame; it does not use `Date.now()` or
timer callbacks for pitch timing.

## Shared practice clock

`PracticeClock` is the only song-time boundary for lyric highlighting,
reference-contour lookup, graph rendering, and scoring. It reads the playback
element's actual `currentTime`, so browser handling of pause, seek, loop, and
playback-rate changes remains authoritative. It never reconstructs playback
position from `Date.now()` or `setInterval`.

The clock normalizes loop boundaries, applies the session latency offset once,
and returns a branded corrected timestamp. Timeline consumers share a
deterministic binary-search helper that accepts this corrected timestamp.

Frame comparison returns signed and absolute cents error. Positive signed cents
means the singer is sharp; negative means flat. Valid voiced frames are grouped
as excellent (≤25 cents), good (≤50), close (≤80), or off-pitch (>80). Missing,
unvoiced, low-confidence, and non-positive-frequency frames are never scored.
