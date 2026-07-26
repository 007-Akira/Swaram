# Quantitative evaluation

Swaram's evaluation inputs fall into two sets:

1. generated tones, glides, silence, and noise that are safe to automate;
2. an internal, authorized Malayalam vocal collection that is never committed,
   uploaded to CI, or redistributed.

Run the reproducible synthetic F0 harness with:

```bash
.venv/bin/swaram-evaluate --output /tmp/swaram-evaluation.json
```

It measures median/mean absolute cents error, voiced/unvoiced accuracy,
octave-error rate, usable pYIN contour coverage, and pYIN processing time by
audio duration. The JSON includes the runtime platform and explicitly lists
unmeasured items. Generated fixtures are created in an isolated temporary
directory and deleted before exit.

For the internal Malayalam collection, maintain a local manifest outside this
repository containing random fixture IDs, authorization basis, device/source,
manually checked voiced intervals, expected F0 points, and permitted retention.
Do not store names, lyrics, song titles, or media paths in committed results.
Report aggregate cents error, voicing accuracy, octave errors, Demucs/pYIN
coverage, and runtime only when the complete authorized set has been run.

Browser measurements require physical-device runs rather than simulated claims:

- measure microphone-to-pitch-display latency with a loopback or externally
  recorded tone onset;
- record graph FPS using browser performance tooling during a full practice
  session;
- compare the monotonic practice clock with an external reference at the start
  and end of five minutes;
- record browser, OS, device, audio interface, sample rate, and buffer settings.

The automated Playwright smoke suite proves browser flow and permission error
handling, not physical latency or long-duration synchronization. Never convert
unit-test timing into a hardware performance claim.

## Recorded baseline — 2026-07-26

One run was recorded on Linux 7.0.0-28, Python 3.14.4, and a 13th Gen Intel
Core i5-1335U (10 cores, 12 logical CPUs). The generated six-second
tone/glide/silence fixture produced:

- median absolute F0 error: 0.000 cents;
- mean absolute F0 error: 1.621 cents;
- voiced/unvoiced accuracy: 98.45%;
- octave-error rate: 0.00%;
- usable pYIN contour coverage across expected voiced frames: 100.00%.

For generated 440 Hz tones, pYIN took 1.5775 s for 5 s (0.3155× real time),
4.6720 s for 15 s (0.3115×), and 9.3403 s for 30 s (0.3113×). These are a
single non-isolated development-machine run, not service-level guarantees.

No values are yet recorded for manually checked Malayalam vocals, HTDemucs
coverage on authorized songs, physical microphone latency, graph FPS under a
full device session, or five-minute physical synchronization drift.
