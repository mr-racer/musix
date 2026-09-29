# Surface: Login and onboarding

v1 source: `LoginScreen` (l. 19929), `SetupWizard` (l. 22729), `GuideCarousel` (l. 20490),
`OBStageBar`. Golden: `design/golden/*/login-*`.

**Anatomy.**
- Login / register (with an invite code in sharing mode).
- The owner's first-run setup wizard, which in v2 lives on the web admin.
- The indexing progress stages (`OBStageBar`, the `.ob-*` classes: blobs, drift, glass,
  indeterminate shimmer).
- The guide carousel.

**States:** errors, invite required, indexing in progress / done.
