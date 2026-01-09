(function initMaintenance(global) {
  const FlowLingo = global.FlowLingo;

  const KEEP_EVENT_DAYS = 14;
  const CLEANUP_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

  function nowTs() {
    return Date.now();
  }

  async function maybeCleanupEvents() {
    const now = nowTs();
    const last = await FlowLingo.db.getSetting("eventsCleanupAt");
    if (Number.isFinite(last) && now - last < CLEANUP_MIN_INTERVAL_MS) {
      return FlowLingo.ok({ skipped: true });
    }

    const cutoff = now - KEEP_EVENT_DAYS * 24 * 60 * 60 * 1000;
    const deleted = await FlowLingo.db.deleteEventsBeforeTs({ beforeTs: cutoff });
    await FlowLingo.db.setSetting("eventsCleanupAt", now);
    return FlowLingo.ok({ deleted, cutoff });
  }

  FlowLingo.maintenance = Object.freeze({ maybeCleanupEvents });
})(globalThis);
