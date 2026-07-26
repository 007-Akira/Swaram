# Practice interface

The private practice route loads session metadata, analysis, lyrics, and
short-lived playback URLs with the session access token. Each playback URL is
scoped to one session and asset, HMAC-signed with a five-minute maximum
lifetime, and supports byte ranges. The UI provides no download links and never
exposes the separated vocal stem.

The Canvas graph renders a moving ten-second window at the device pixel ratio.
Its animation loop reads the shared practice clock directly and does not drive
React renders. Reference and live contours preserve explicit unvoiced gaps.

Original and instrumental modes reuse one media element and preserve aligned
song time when switching. The reduced-reference-vocal option remains disabled
until a safe pre-mixed asset exists. Accompaniment volume affects the selected
playback asset.

Loops can come from the current lyric, manual in/out points, or a horizontal
graph selection. Boundary decisions use media time, and count-in deadlines use
monotonic browser time. Every restart clears live comparison history. Supported
initial speeds are 0.5×, 0.75×, 0.9×, and 1×. Swaram requests
`preservesPitch`; actual time-stretch quality and support vary by browser and
device.
