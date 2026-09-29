# Surface: Home

v1 source: `LandingScreen` (l. 3156), `ForYouHero` (l. 2258), `AiOrb` (l. 5330).
Golden: `design/golden/*/home-*`.

**Anatomy.**
- The For-You hero: the vibe phrase (`font.display`, Playfair Display) and the wave orb.
  A tap starts «Поток».
- The preset chips (v2 stream spec §4): two visually separate rows, familiarity and
  sound.
- **Вайбики:** short-term mood clusters, each with an AI name. A tap plays that вайбик's
  autoplay queue.
- Recent tracks.
- Playlists.

**States.**
- no library yet (onboarding call to action);
- AI off: the orb is idle and вайбики are unnamed;
- the stream is active: the orb animates and the hero shows now-playing.

**Measurements.** The mobile bottom tab bar:
- icons are 22 px, stroke 1.8 (2.1 when active);
- labels are 10 px, weight 600, 0.02 em tracking;
- padding is 8 / 2 / 7 px;
- background: `color.tabBarBg`; inactive items: `color.tabBarInactive`; the active item
  is `color.accent`.

**Removed in v2:** taste islands and the AI portrait (program §4.3).
