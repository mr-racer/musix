import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useAuth } from "../../api/auth";

/** The owner's admin: its own chunk (members never download it: the route, and so its
 *  code, is refused before load). The server refuses every admin endpoint regardless. */
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: () => {
    if (useAuth.getState().role !== "owner") throw redirect({ to: "/" });
  },
  component: () => <Outlet />,
});
