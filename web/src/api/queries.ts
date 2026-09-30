import { queryOptions } from "@tanstack/react-query";
import { api, ok } from "./client";

export const instanceQuery = queryOptions({
  queryKey: ["instance"],
  queryFn: () => ok(api.GET("/api/v2/instance")),
  staleTime: 60_000,
});
