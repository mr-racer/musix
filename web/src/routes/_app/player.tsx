import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/player")({
  component: () => <div>player</div>,
});
