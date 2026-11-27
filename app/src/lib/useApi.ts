import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

/** Load data from the engine with loading / error / reload state. Pass null to skip. */
export function useApi<T>(path: string | null, role?: "visitor" | "member") {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const d = await api<T>(path, { role });
      if (n === seq.current) setData(d);
    } catch (e) {
      if (n === seq.current) setError(e as Error);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path, role]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}
