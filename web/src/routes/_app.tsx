import { createFileRoute, redirect } from "@tanstack/react-router";
import { authReady } from "../api/auth";
import { Shell } from "../ui/Shell";

/** Everything behind sign-in. The guard waits for the first refresh (the cookie). */
export const Route = createFileRoute("/_app")({
  beforeLoad: async ({ location }) => {
    if ((await authReady()) !== "in") throw redirect({ to: "/login", search: { next: location.href } });
  },
  component: Shell,
});
