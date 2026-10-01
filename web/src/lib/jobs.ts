import { useEffect, useState } from "react";
import { subscribe } from "../api/realtime";

/** A server job's progress, pushed over the WebSocket (`job.progress` / `job.done`) — the
 *  v1 2–3 s polling loops are gone. */
export function useJob(jobId: string | null): { done: number; total: number; finished: boolean } | null {
  const [s, setS] = useState<{ done: number; total: number; finished: boolean } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    setS({ done: 0, total: 0, finished: false });
    return subscribe((e) => {
      if ((e.type === "job.progress" || e.type === "job.done") && e.job === jobId)
        setS({ done: e.done ?? 0, total: e.total ?? 0, finished: e.type === "job.done" });
    });
  }, [jobId]);
  return s;
}
