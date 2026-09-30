/** The listening session id (Android `SettingsRepository.sessionId`): rotates after 30 min
 *  of silence. Not a secret: a per-browser counter the recommender groups listens by. */
const KEY = "musix.session";
const IDLE_MS = 30 * 60 * 1000;
let mem: { id: string; at: number } | null = null;

export function sessionId(now = Date.now()): string {
  let s = mem;
  if (!s) {
    try {
      s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    } catch {
      s = null;
    }
  }
  if (!s || now - s.at > IDLE_MS) s = { id: crypto.randomUUID(), at: now };
  s.at = now;
  mem = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
  return s.id;
}
