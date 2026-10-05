# Principles

1. **Open space.** Content lies on the background, the way v1's home and player do. No
   panels around columns and no cards around text. Group with spacing and alignment.
   A plate is allowed in two cases only: a small interactive chip (a sample) and one compact
   block that must read as a unit (the facts). See `surfaces.md`.
2. **The cover lights the screen.** A cover-lit surface takes its backdrop and its accent
   pair from the cover (the server palette). The brand violet is for the brand and the
   navigation, not for the player.
3. **One hero per screen.** In the player it is the cover with the title. Everything else
   is quieter. A thing used now and then does not sit on screen all the time: the assistant
   and the queue open on demand.
4. **Don't overload.** Reading text is clamped and opens on click. A long list goes into a
   window or a sheet. If a block unbalances the screen, it is too big.
5. **The signature moves stay.** Click the cover to pause, the cover flip to lyrics, the
   vinyl track change, the tilt, огонёк and вода on the cover, the nav island's glass.
   None of them is dropped silently; a replacement needs the owner's yes.
6. **Efficient by construction.** A screen at rest costs almost nothing, also on a desktop.
   See `motion-and-performance.md`.
7. **The phone is one screen.** No scrolling in the player. New functionality goes into
   sheets, not under the fold.
8. **A link looks like a link.** Whatever navigates is underlined.
9. **Glass is rare.** Two places. See `surfaces.md`.
10. **Everything is physical.** The owner's rule (2026-10-05): «надо везде такую физичность
    добавлять». A control or a surface behaves like a thing with weight, never like a state
    that is switched. What he named as right, and what every new element is measured against:
    - the question mark by the title **hops** under the pointer;
    - the chevron of an artist or album link **slides** forward on hover;
    - on pause the cover **blurs and grows a little** under the glass icon;
    - a button **gives** under a press and springs back; a switched-on icon **bounces**.

    What follows from it:
    - **Nothing appears or vanishes at once.** A menu, a window, a chip, a mark: each comes
      from somewhere and goes back there. A menu grows out of its button and returns into it.
    - **A thing answers the pointer before the click** (a shift, a hop, a glow of its own
      colour), and answers the press with a give.
    - **A state is shown by the thing itself changing**, not by a label beside it.
    - **What moves between places travels.** A cover that starts playing flies from its row
      into the stage; a cover added to a playlist shrinks, flies into that playlist's
      thumbnail and is taken in. The place it lands on reacts.
    - **Springs, not ramps**, for whatever arrives; a short ease-in for whatever leaves.
    - A plain element with no entry, no exit and no answer to the pointer (the first «В
      плейлист» menu) is unfinished work, not a neutral default.

    Bounded by rule 6: one-shot moves on `transform` and `opacity`, nothing looping at rest.
    The catalogue of moves and their timings is `motion-and-performance.md`.
