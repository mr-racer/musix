import { useEffect, useState } from "react";
import { subscribe } from "../api/realtime";

/** A server job's progress, pushed over the WebSocket (`job.progress` / `job.done`) — the
 *  v1 2–3 s polling loops are gone. */
type Job = { done: number; total: number; finished: boolean; failed: boolean };

export function useJob(jobId: string | null): Job | null {
  const [s, setS] = useState<Job | null>(null);
  useEffect(() => {
    if (!jobId) return;
    setS({ done: 0, total: 0, finished: false, failed: false });
    return subscribe((e) => {
      if ((e.type === "job.progress" || e.type === "job.done") && e.job === jobId)
        setS((p) => ({
          done: e.done ?? p?.done ?? 0,
          total: e.total ?? p?.total ?? 0,
          finished: e.type === "job.done",
          failed: e.state === "error", // the job itself broke (a track's failure is not this)
        }));
    });
  }, [jobId]);
  return s;
}
