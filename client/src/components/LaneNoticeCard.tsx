import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { useAiStatus, fmtCountdown } from "@/hooks/useAiStatus";

/** Live AI pop-up: shows when the student's CURRENT mode is resting, with the live countdown. Clears by itself. */
export default function LaneNoticeCard() {
  const [loc] = useLocation();
  const ai = useAiStatus();
  if (!loc.startsWith("/live-ai") || !ai.profile) return null;
  const lane = ai.laneOf(ai.profile.lane);
  if (!lane || lane.available) return null;
  const name = lane.label.replace("LENORY ", "");
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] w-[92%] max-w-md rounded-2xl border border-destructive/40 bg-background/95 backdrop-blur p-4 shadow-xl" role="alert" data-testid="lane-notice-card">
      <div className="flex gap-3">
        <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
        <div className="text-sm">
          <p>LENORY {name} could not answer just now (This mode is currently unavailable). Please try again after your limit is over or pick another model.</p>
          {lane.resetsAt && <p className="mt-1.5 font-mono tabular-nums font-medium">Back in {fmtCountdown(lane.left)}</p>}
        </div>
      </div>
    </div>
  );
}
