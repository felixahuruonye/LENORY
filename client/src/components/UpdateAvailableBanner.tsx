// client/src/components/UpdateAvailableBanner.tsx
//
// Previously a new deploy force-reloaded the page the instant the browser
// noticed it, with no regard for whether the person was mid-typing or
// mid-send — silently destroying in-progress work. This banner is the
// replacement: it just tells them an update is ready and lets THEM decide
// when it's safe to refresh (e.g. not while they're in the middle of
// writing something).
import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

declare global {
  interface Window {
    __lenoryWaitingWorker?: ServiceWorker;
    __lenoryUpdateConfirmed?: boolean;
  }
}

export default function UpdateAvailableBanner() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handler = () => setAvailable(true);
    window.addEventListener("lenory:sw-update-available", handler);
    // In case the event already fired before this component mounted.
    if (window.__lenoryWaitingWorker) setAvailable(true);
    return () => window.removeEventListener("lenory:sw-update-available", handler);
  }, []);

  if (!available || dismissed) return null;

  const applyUpdate = () => {
    if (window.__lenoryWaitingWorker) {
      window.__lenoryUpdateConfirmed = true;
      window.__lenoryWaitingWorker.postMessage({ type: "SKIP_WAITING" });
      // controllerchange (registered in index.html) does the actual
      // reload once the new worker takes over — only because
      // __lenoryUpdateConfirmed is now true.
    } else {
      // Fallback: no waiting worker reference somehow — a plain reload
      // still picks up the new deploy on next load either way.
      window.location.reload();
    }
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-primary text-primary-foreground rounded-full pl-4 pr-2 py-2 shadow-xl animate-in fade-in slide-in-from-bottom-4" data-testid="banner-update-available">
      <span className="text-sm font-medium">A new version of LENORY is ready</span>
      <button
        onClick={applyUpdate}
        className="flex items-center gap-1.5 text-sm font-semibold bg-primary-foreground/20 hover:bg-primary-foreground/30 rounded-full px-3 py-1 transition-colors"
        data-testid="button-apply-update"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh
      </button>
      <button onClick={() => setDismissed(true)} className="p-1 hover:opacity-70" data-testid="button-dismiss-update" title="Remind me later">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
