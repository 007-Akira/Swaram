# Browser pitch detection

`@swaram/audio-core` provides a dependency-light YIN detector for individual
microphone frames. It returns frequency, confidence, and voiced state without
assigning arbitrary notes to silence or broadband noise.

At 48 kHz, a 4,096-sample frame spans about 85 ms and supports reliable
detection near 80 Hz. Smaller frames reduce algorithmic latency but cannot
represent low fundamentals; larger frames improve low-note resolution at the
cost of latency and CPU work. The AudioWorklet integration should accumulate
overlapping frames and timestamp them against one monotonic practice clock.
