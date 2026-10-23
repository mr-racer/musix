import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { mountAssistant } from "../../assistant/page";

type Search = { q?: string };

export const Route = createFileRoute("/_app/assistant")({
  validateSearch: (s: Record<string, unknown>): Search => ({ q: typeof s.q === "string" && s.q.trim() ? s.q : undefined }),
  component: AssistantView,
});

/** The assistant page («ИИ», assistant/page.ts): React only gives it a place and a way out to
 *  an artist. `?q=` (the home's «ИИ» search, a producer in the player's credits) asks at once;
 *  the question then leaves the address, so a reload does not ask it again. */
function AssistantView() {
  const host = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const { q } = Route.useSearch();
  const first = useRef(q);
  useEffect(() => {
    if (first.current) void nav({ to: "/assistant", search: {}, replace: true });
    return mountAssistant(host.current!, {
      openArtist: (id) => void nav({ to: "/artist/$id", params: { id } }),
      initial: first.current,
    });
  }, [nav]);
  return <div ref={host} />;
}
