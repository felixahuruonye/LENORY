/**
 * Cost-control + fail-closed tests (no network).
 * Run: npx tsx server/actions/costControl.test.ts
 */
import {
  reserveBrowserUsage,
  trackSessionOpen,
  trackSessionClose,
  releaseReservation,
  abandonSessionSlot,
  loadCostLimits,
  getActiveSessionCounts,
  settleBrowserUsage,
} from "./costControl";

function assert(cond: any, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS:", msg);
}

async function run() {
  const limits = loadCostLimits();
  assert(limits.maxConcurrentPerUser >= 1, "maxConcurrentPerUser configured");
  assert(limits.estimatedUsdPerHour > 0, "estimate rate is positive accounting value only");
  assert(limits.globalMonthlySpendCeilingUsd > 0, "global ceiling configured");

  const noUser = await reserveBrowserUsage({ userId: "" });
  assert(!noUser.ok, "empty userId fails closed");

  const user = `test-user-${Date.now()}`;
  const r1 = await reserveBrowserUsage({ userId: user, taskId: "t1" });
  if (!r1.ok) {
    console.log("NOTE: reserve blocked (DB/plan):", r1.reason);
  } else {
    assert(!!r1.reservation.reservationId, "reservation id issued");
    assert(r1.reservation.estimatedCostUsd >= 0, "estimated cost is non-negative accounting field");

    trackSessionOpen(user, "sess-1");
    const counts = getActiveSessionCounts();
    assert(counts.global >= 1, "global concurrent tracked");

    if (limits.maxConcurrentPerUser <= 1) {
      const r2 = await reserveBrowserUsage({ userId: user, taskId: "t2" });
      assert(!r2.ok, "second concurrent session blocked when max=1");
    }

    abandonSessionSlot(user, "sess-1", r1.reservation.reservationId);
    const after = getActiveSessionCounts();
    assert(!after.byUser[user] || after.byUser[user] === 0, "user concurrent cleared after abandon");

    const r3 = await reserveBrowserUsage({ userId: user, taskId: "t3" });
    if (r3.ok) {
      trackSessionOpen(user, "sess-3");
      await settleBrowserUsage({
        userId: user,
        taskId: "t3",
        sessionId: "sess-3",
        provider: "browserbase",
        durationSec: 30,
        reservationId: r3.reservation.reservationId,
      });
      releaseReservation(r3.reservation.reservationId);
      assert(true, "settle + release reservation path");
    } else {
      console.log("NOTE: re-reserve blocked:", r3.reason);
    }
  }

  releaseReservation(undefined);
  releaseReservation("nonexistent");
  assert(true, "releaseReservation tolerates missing ids");

  console.log("\nAll costControl tests finished.");
  console.log("Reminder: estimated_cost_usd is NOT Browserbase invoice amount.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
