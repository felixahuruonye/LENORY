import { AsyncLocalStorage } from "node:async_hooks";
export type ChatLane = "ultra" | "fast" | "vision";
/** The signed-in student's lane for this request. Every AI call inside the request follows it. */
export interface LaneCtx { lane: ChatLane; userId: string; bypass?: boolean }
export const laneContext = new AsyncLocalStorage<LaneCtx>();
export const currentLane = () => laneContext.getStore()?.lane;
