import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/album/$id")({
  component: () => <div>album</div>,
});
