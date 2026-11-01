import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type LaneId = "ultra" | "fast" | "vision" | "search";
export interface Lane { lane: LaneId; label: string; available: boolean; resetsAt: string | null; resetsInSeconds: number; reason: string | null }
interface Profile { lane: LaneId; allowed: LaneId[]; plan: string; isAdmin: boolean }
interface Status { profile?: Profile; lanes: Lane[]; webSearch: { exhausted: boolean; resetsAt: string | null }; serverTime: string }

/** Live provider-limit state for every LENORY model + web search. Same for every chat, every device. */
export function useAiStatus() {
  const { data } = useQuery<Status>({
    queryKey: ["/api/ai/status"],
    queryFn: async () => (await apiRequest("GET", "/api/ai/status")).json(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  // use server clock offset so a wrong phone clock can't show a wrong countdown
  const skew = data ? new Date(data.serverTime).getTime() - Date.now() : 0;
  const secondsLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - (now + skew)) / 1000)) : 0);
  const lanes = (data?.lanes || []).map((l) => {
    const left = secondsLeft(l.resetsAt);
    // a lane whose timer reached 0 is treated as back; the next poll confirms it
    return { ...l, available: l.available || (l.resetsAt !== null && left === 0), left };
  });
  const web = data?.webSearch;
  const webLeft = secondsLeft(web?.resetsAt || null);
  return { profile: data?.profile, lanes, webExhausted: !!web?.exhausted && webLeft > 0, webLeft, laneOf: (id: string) => lanes.find((l) => l.lane === id.replace(/^lenory-/, "")) };
}

export const fmtCountdown = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = String(m).padStart(2, "0"), ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
