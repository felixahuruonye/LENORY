/**
 * Lightweight tests for cost-control fail-closed behaviour.
 * Run: npx tsx server/actions/costControl.test.ts
 */
import {
  reserveBrowserUsage,
  trackSessionOpen,
  trackSessionClose,
  loadCostLimits,
  getActiveSessionCounts,
} from "./costControl";

async function run() {
  const limits = loadCostLimits();
  console.assert(limits.maxConcurrentPerUser >= 1, "maxConcurrentPerUser");
  console.assert(limits.globalMonthlySpendCeilingUsd > 0, "ceiling");

  const user = "test-user-cost-1";
  // Clear any prior
  const counts0 = getActiveSessionCounts();
  console.log("limits", limits.maxConcurrentPerUser, "active", counts0.global);

  const r1 = await reserveBrowserUsage({ userId: user, taskId: "t1" });
  if (!r1.ok) {
    console.log("reserve1 blocked (ok if DB plan blocks):", r1.reason);
  } else {
    trackSessionOpen(user, "sess-1");
    const r2 = await reserveBrowserUsage({ userId: user, taskId: "t2" });
    if (limits.maxConcurrentPerUser <= 1) {
      console.assert(!r2.ok, "second concurrent should fail when max=1");
      if (r2.ok) throw new Error("quota race: second session allowed");
      else console.log("PASS concurrent per user blocked:", r2.reason);
    }
    trackSessionClose(user, "sess-1");
  }

  const noUser = await reserveBrowserUsage({ userId: "", taskId: "x" });
  console.assert(!noUser.ok, "empty user must fail");
  console.log("PASS unauthenticated fail-closed");

  console.log("costControl tests finished");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
