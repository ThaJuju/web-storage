"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

interface Usage {
  usedBytes: number;
  quotaBytes: number;
}

interface UsageValue extends Usage {
  loading: boolean;
  refresh: () => Promise<void>;
}

const UsageContext = createContext<UsageValue | null>(null);

export function UsageProvider({ children }: { children: React.ReactNode }) {
  const [usage, setUsage] = useState<Usage>({ usedBytes: 0, quotaBytes: 0 });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setUsage({
        usedBytes: Number(data.usedBytes),
        quotaBytes: Number(data.quotaBytes),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <UsageContext.Provider value={{ ...usage, loading, refresh }}>
      {children}
    </UsageContext.Provider>
  );
}

export function useUsage(): UsageValue {
  const ctx = useContext(UsageContext);
  if (!ctx) throw new Error("useUsage doit etre utilise dans UsageProvider");
  return ctx;
}
