"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Toast ephemere. Chaque nouveau message annule le minuteur du precedent :
 * un deuxieme toast reste affiche toute sa duree (au lieu d'etre efface par
 * le minuteur du premier).
 */
export function useToast(durationMs = 2500) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback(
    (msg: string) => {
      if (timer.current) clearTimeout(timer.current);
      setToast(msg);
      timer.current = setTimeout(() => setToast(null), durationMs);
    },
    [durationMs]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return { toast, showToast };
}
