import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

/** A Dexie live query as React state: re-renders when the mirror rows it read change. */
export function useLive<T>(query: () => Promise<T>, deps: unknown[], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({ next: setValue, error: () => setValue(undefined) });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}
