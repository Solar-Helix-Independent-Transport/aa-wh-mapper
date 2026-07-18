import { useEffect, useRef, useState } from "react";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_QUERY_LENGTH } from "../constants";

/** Debounced type-ahead search with out-of-order-response protection - the
 * common shape behind every "search as you type" picker (AddSystemDialog,
 * ConnectSignatureDialog, ShareDialog's per-scope search). A query shorter
 * than SEARCH_MIN_QUERY_LENGTH just clears results without calling `search`
 * at all.
 *
 * `search` may legitimately change identity between renders (e.g.
 * ShareDialog swapping which endpoint it searches per scope) - the request-
 * sequence guard below means whichever search actually started last always
 * wins, regardless of how many changed in between or which resolves first,
 * so callers don't need to memoize it themselves.
 */
export function useSearch<T>(
  search: (query: string) => Promise<T[]>,
  onError: (message: string) => void,
) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const searchRef = useRef(search);
  const onErrorRef = useRef(onError);
  const requestIdRef = useRef(0);

  useEffect(() => {
    searchRef.current = search;
    onErrorRef.current = onError;
  }, [search, onError]);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < SEARCH_MIN_QUERY_LENGTH) {
      // Nothing to fetch - invalidate any request still in flight so a late
      // response can't repopulate `results` behind the below-threshold
      // guard's back. Below-threshold display is handled by the derived
      // `results` clamp below rather than clearing state here, since
      // synchronously calling setState from an effect body (as opposed to
      // an async callback) triggers a same-commit cascading re-render.
      requestIdRef.current += 1;
      return;
    }

    const requestId = ++requestIdRef.current;
    const timeout = setTimeout(() => {
      searchRef
        .current(trimmedQuery)
        .then((found) => {
          // A newer keystroke (or scope change) has since started another
          // search - drop this now-stale response instead of letting it
          // clobber fresher results that may have already arrived.
          if (requestId === requestIdRef.current) {
            setResults(found);
          }
        })
        .catch((err) => {
          if (requestId === requestIdRef.current) {
            onErrorRef.current(String(err));
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [trimmedQuery]);

  const reset = () => {
    requestIdRef.current += 1;
    setQuery("");
    setResults([]);
  };

  return {
    query,
    setQuery,
    results: trimmedQuery.length < SEARCH_MIN_QUERY_LENGTH ? [] : results,
    reset,
  };
}
