import { useEffect, useState } from "react";

/** The current time, re-read every `intervalMs` - lets a component's render
 * react to time passing (e.g. a tracked character going stale) even when no
 * other prop/state change would otherwise trigger a re-render. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
