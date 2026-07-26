# Offline audio processing

The dedicated worker invokes FFprobe and FFmpeg with argument arrays and
`shell=False`. Uploaded names never become output names. Each job uses an
isolated `swaram-audio-*` temporary directory containing deterministic
`source.input`, `normalized_playback.wav`, and `analysis_mono.wav` paths.

FFprobe verifies the actual audio stream, duration, channels, codec, and sample
rate before decode. Configured input-size, duration, command-time, and
single-thread limits bound work. Playback normalization produces stereo
44.1 kHz 16-bit PCM; pitch analysis receives a separate mono 22.05 kHz 16-bit
PCM file. Temporary workspaces remove all files on both success and exception.

Worker failures use stable codes such as `audio_probe_failed`,
`audio_decode_failed`, `audio_too_long`, and `audio_tool_timeout`. Captured
stderr is bounded and remains server-side.
