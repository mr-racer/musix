# Surface: Quiz («Игра»)

v1 source: `QuizSection` (l. 20870). Golden: `design/golden/*/quiz-*`.

**Anatomy:**
- the mode picker (track snippet, producer, blind year);
- the round card with snippet playback;
- the answers;
- the score and streak.

**Behaviour.** Snippets play through the player core in a **no-listen** mode: the quiz
writes no listens and no signals (invariants I-1 / I-2).
