import { create } from "zustand";
import { api, ok } from "../api/client";
import { subscribe } from "../api/realtime";

/** The chat about the playing track (v1 `AIChatDrawer`): `POST /track-chat/turns`, progress
 *  frames over the socket (`answer_delta` carries the answer so far, any other frame is a
 *  caption), then the result of `GET /assistant/turns/{id}`. One conversation per track. */
export type ChatMessage = { mine: boolean; text: string };
interface ChatState {
  trackId: string | null;
  messages: ChatMessage[];
  stage: string | null; // a caption while the answer is being made; null when idle
  stream: string | null; // the answer so far
}
export const useTrackChat = create<ChatState>(() => ({ trackId: null, messages: [], stage: null, stream: null }));

/** v1 `TRACK_CHAT_SUGGESTED_PROMPTS`: the chip shows the label and asks the full question. */
export const PROMPTS: { label: string; text: string }[] = [
  { label: "О чём песня?", text: "О чём эта песня на самом деле? Расскажи простыми словами, как будто объясняешь другу." },
  { label: "История", text: "Расскажи историю создания этой песни и насколько популярной она была, когда вышла." },
  { label: "Сильные строчки", text: "Разбери пару самых сильных строчек: есть ли в них отсылки или скрытый смысл?" },
  { label: "Семплы", text: "Какие песни семплировались в этом треке? Расскажи, откуда взяты семплы." },
];

export function clearChat(): void {
  if (useTrackChat.getState().stage === null) useTrackChat.setState({ messages: [], stream: null });
}

export async function ask(trackId: string, message: string): Promise<void> {
  const st = useTrackChat.getState();
  if (st.stage !== null) return;
  const prior = st.trackId === trackId ? st.messages : [];
  const history = prior.slice(-6).map((m) => ({ role: m.mine ? ("user" as const) : ("assistant" as const), content: m.text }));
  useTrackChat.setState({ trackId, messages: [...prior, { mine: true, text: message }], stage: "Думаю…", stream: null });
  let text: string | null = null;
  try {
    const turn = await ok(api.POST("/api/v2/track-chat/turns", { body: { trackId, mode: "song", message, history, lang: "ru" } }));
    text = await answer(turn.turnId);
  } catch {
    text = null;
  }
  useTrackChat.setState((s) => (s.trackId === trackId
    ? { stage: null, stream: null, messages: [...s.messages, { mine: false, text: text ?? "Не получилось ответить" }] }
    : { stage: null, stream: null }));
}

/** The turn's answer once it is done. The socket is the fast path; a poll every 3 s covers
 *  a dropped socket. */
function answer(turnId: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const read = () => ok(api.GET("/api/v2/assistant/turns/{turn_id}", { params: { path: { turn_id: turnId } } }));
    const finish = async () => {
      if (settled) return;
      settled = true;
      off();
      clearInterval(poll);
      clearTimeout(limit);
      try {
        const r = (await read()).result as Record<string, unknown> | null;
        resolve(typeof r?.message === "string" ? r.message : typeof r?.answer === "string" ? r.answer : null);
      } catch {
        resolve(null);
      }
    };
    const off = subscribe((e) => {
      if ((e.type !== "assistant.stage" && e.type !== "assistant.done") || e.turnId !== turnId) return;
      if (e.type === "assistant.done") void finish();
      else if (e.frame.stage === "answer_delta") useTrackChat.setState({ stream: e.frame.text || null });
      else if (e.frame.human) useTrackChat.setState({ stage: e.frame.human });
    });
    const poll = setInterval(() => {
      void read().then((t) => { if (t.status === "done" || t.status === "error") void finish(); }).catch(() => undefined);
    }, 3000);
    const limit = setTimeout(() => void finish(), 180_000);
  });
}
