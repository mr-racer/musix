import { createFileRoute, redirect } from "@tanstack/react-router";

/** Adding music lives in the library now (design/reference/settings, 2026-10-14): the old
 *  address opens «Добавить» there. */
export const Route = createFileRoute("/_app/upload")({
  beforeLoad: () => {
    throw redirect({ to: "/library", search: { add: "files" }, replace: true });
  },
});
