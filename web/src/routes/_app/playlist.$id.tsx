import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/playlist/$id")({
  component: () => <div>playlist</div>,
});
