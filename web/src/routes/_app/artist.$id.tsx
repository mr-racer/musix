import { createFileRoute } from "@tanstack/react-router";
import { artistQuery } from "../../api/queries";
import { ArtistPage, bioQuery } from "../../artist/ArtistPage";

/** The artist page «Кадр» (src/artist, design/reference/artist). The page and the bio load together. */
export const Route = createFileRoute("/_app/artist/$id")({
  loader: ({ context, params }) => Promise.all([
    context.queryClient.ensureQueryData(artistQuery(params.id)),
    context.queryClient.ensureQueryData(bioQuery(params.id)).catch(() => null),
  ]),
  component: Artist,
});

function Artist() {
  const { id } = Route.useParams();
  return <ArtistPage key={id} id={id} />;
}
