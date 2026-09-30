import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/admin/setup")({
  component: () => <div>admin setup</div>,
});
