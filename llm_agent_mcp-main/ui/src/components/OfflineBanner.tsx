"use client";

import { useSyncExternalStore } from "react";
import { WifiOff } from "lucide-react";

const subscribeOnlineStatus = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

const getOnlineStatus = () =>
  typeof navigator === "undefined" ? true : navigator.onLine;

export const OfflineBanner: React.FC = () => {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineStatus,
    () => true,
  );

  if (isOnline) return null;

  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 max-w-[480px] w-full px-4">
      <div className="flex items-center gap-2 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 rounded-lg px-4 py-3 shadow-lg text-xs font-medium">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>Та интернетэд холбогдоогүй байна. Зарим боломжууд ажиллахгүй байж болно.</span>
      </div>
    </div>
  );
};
