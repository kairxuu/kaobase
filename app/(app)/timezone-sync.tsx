"use client";

import { useEffect } from "react";
import { syncTimezoneAction } from "./actions";

// Enregistre le fuseau du navigateur au premier chargement, sauf s'il a été choisi à la main (ticket #1).
export function TimezoneSync({ current, manual }: { current: string; manual: boolean }) {
  useEffect(() => {
    if (manual) return;
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && detected !== current) void syncTimezoneAction(detected);
  }, [current, manual]);
  return null;
}
