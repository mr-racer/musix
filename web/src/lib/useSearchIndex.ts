import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../api/auth";
import { loadSearchIndex, searchIndexRevision, subscribeSearchIndex, type Index } from "./searchIndex";

/** An open search follows mirror changes; a closed field does not read the mirror. */
export function useSearchIndex(enabled: boolean): Index | null {
  const revision = useSyncExternalStore(subscribeSearchIndex, searchIndexRevision);
  const account = useAuth((s) => s.accountId);
  const [snapshot, setSnapshot] = useState<{ revision: number; account: string | null; value: Index } | null>(null);
  useEffect(() => {
    if (!enabled || !account) return;
    let gone = false;
    void loadSearchIndex().then((value) => {
      if (!gone) setSnapshot({ revision, account, value });
    }).catch(() => { if (!gone) setSnapshot(null); });
    return () => { gone = true; };
  }, [enabled, revision, account]);
  return snapshot?.revision === revision && snapshot.account === account ? snapshot.value : null;
}
