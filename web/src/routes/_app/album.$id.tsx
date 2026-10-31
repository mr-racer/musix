import { createFileRoute, useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { albumQuery } from "../../api/queries";
import { AlbumGatefold } from "../../ui/Gatefold";

export const Route = createFileRoute("/_app/album/$id")({
  // Start on link intent, but let the book show its loading/error state immediately.
  loader: ({ context, params }) => { void context.queryClient.prefetchQuery(albumQuery(params.id)); },
  component: Album,
});

/** Deep links, new tabs and the player use the same book as an album card. */
function Album() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const prepareClose = useCallback(() => {
    // Use the closing animation to load only the known fallback destination.
    if (!canGoBack) void router.preloadRoute({ to: "/library" }).catch(() => undefined);
  }, [canGoBack, router]);
  const close = useCallback(() => {
    if (canGoBack) router.history.back();
    else void nav({ to: "/library", replace: true });
  }, [canGoBack, nav, router]);
  const change = useCallback((next: string) => nav({ to: "/album/$id", params: { id: next }, replace: true, resetScroll: false }), [nav]);
  return <AlbumGatefold id={id} cover={null} from={null} onClose={close} onCloseStart={prepareClose} onAlbumChange={change} />;
}
