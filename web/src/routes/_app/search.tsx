import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/search")({
  component: () => <div>search</div>,
});
