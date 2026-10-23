import { createFileRoute, redirect } from "@tanstack/react-router";

/** The old search screen with its modes is gone (design/code/roadmap.md, stage 5): the assistant
 *  page is the one AI surface. Old links and bookmarks land there, the question carried over. */
export const Route = createFileRoute("/_app/search")({
  beforeLoad: ({ search }) => {
    const q = (search as { q?: unknown }).q;
    throw redirect({ to: "/assistant", search: typeof q === "string" && q.trim() ? { q } : {}, replace: true });
  },
});
