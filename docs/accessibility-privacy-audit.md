# Accessibility, privacy, and UX audit

## Implemented checks and controls

- Native buttons, links, form labels, fieldsets, headings, and landmarks provide
  keyboard and screen-reader semantics. Focus-visible outlines cover links,
  buttons, inputs, textareas, selects, and disclosure summaries.
- Malayalam copy can wrap inside controls and scales with browser text zoom.
  Controls use touch-sized targets, and reduced-motion preferences suppress
  nonessential transitions and animation.
- Pitch feedback includes text, cents, scores, and voiced confidence; color is
  not the only signal. Canvas graphs have text alternatives or labels.
- Status, microphone errors, readiness, save state, loops, and deletion errors
  use polite or assertive live regions where state changes without navigation.
- Session screens disclose 24-hour retention and browser-only microphone
  handling. Deletion is visible, requires explicit confirmation, calls the
  private authenticated endpoint, and removes the browser token on success.
- API media is session-authorized or short-lived HMAC playback. Browser and API
  referrer/no-store/CSP policies reduce accidental URL leakage.
- Playwright runs axe against the Malayalam landing page and mocked practice
  flow, failing on serious or critical violations.

## Remaining limitations

Automated axe checks do not replace VoiceOver, TalkBack, NVDA, keyboard-only,
high-contrast, 200%/400% zoom, or Malayalam font rendering checks on physical
devices. The continuously updating canvas is summarized, not exposed as every
individual pitch point. Native audio controls vary by browser and should be
included in manual testing. A nonce-based production CSP would be stronger
than the framework-compatible inline script/style policy.
