import { AsyncLocalStorage } from "node:async_hooks";
export type ChatLane = "ultra" | "fast" | "vision";
/** The signed-in student's lane for this request. Every AI call inside the request follows it. */
export interface LaneCtx { lane: ChatLane; userId: string; bypass?: boolean }
export const laneContext = new AsyncLocalStorage<LaneCtx>();
export const currentLane = () => laneContext.getStore()?.lane;

export const LANE_LABEL: Record<ChatLane, string> = { ultra: "Ultra", fast: "Fast", vision: "Vision" };
/** The one sentence shown when the student's CURRENT mode cannot answer. It always names that mode. */
export const laneUnavailableMessage = (lane: ChatLane) =>
  `LENORY ${LANE_LABEL[lane]} could not answer just now (This mode is currently unavailable). Please try again after your limit is over or pick another model.`;
