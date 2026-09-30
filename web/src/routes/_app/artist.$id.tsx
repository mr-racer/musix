import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/artist/$id")({
  component: () => <div>artist</div>,
});
