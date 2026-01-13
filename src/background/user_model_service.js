(function initUserModelService(global) {
  const FlowLingo = global.FlowLingo;

  function nowTs() {
    return Date.now();
  }

  function ensureState(wordId) {
    return {
      wordId,
      mastery: 0.5,
      exposureCount: 0,
      hoverCount: 0,
      pronounceCount: 0,
      knownCount: 0,
      unknownCount: 0,
      lastSeenAt: undefined,
      lastFeedbackAt: undefined,
    };
  }

  async function applyEventToWordState(event, tuning) {
    const wordId = event?.targetId;
    if (!wordId) return;

    const base =
      (await FlowLingo.db.getUserWordState(wordId)) || ensureState(wordId);
    const updated = { ...base };
    const ts = Number.isFinite(event.ts) ? event.ts : nowTs();
    updated.lastSeenAt = ts;

    const metaEn =
      typeof event.meta?.en === "string" ? event.meta.en.trim() : "";
    const metaCn =
      typeof event.meta?.cn === "string" ? event.meta.cn.trim() : "";
    if (metaEn) updated.en = metaEn;
    if (metaCn) updated.cn = metaCn;

    const masteryTuning =
      tuning?.mastery || FlowLingo.defaultGlobalSettings().tuning.mastery;
    const hoverPenalty = Number.isFinite(masteryTuning.hoverPenalty)
      ? masteryTuning.hoverPenalty
      : 0.01;
    const knownReward = Number.isFinite(masteryTuning.knownReward)
      ? masteryTuning.knownReward
      : 0.08;
    const unknownPenalty = Number.isFinite(masteryTuning.unknownPenalty)
      ? masteryTuning.unknownPenalty
      : 0.12;

    switch (event.type) {
      case "hover": {
        updated.hoverCount += 1;
        updated.lastFeedbackAt = ts;
        updated.mastery = FlowLingo.clamp01(updated.mastery - hoverPenalty);
        break;
      }
      case "pronounce": {
        updated.pronounceCount += 1;
        updated.lastFeedbackAt = ts;
        break;
      }
      case "known": {
        updated.knownCount += 1;
        updated.lastFeedbackAt = ts;
        updated.mastery = FlowLingo.clamp01(updated.mastery + knownReward);
        break;
      }
      case "unknown": {
        updated.unknownCount += 1;
        updated.lastFeedbackAt = ts;
        // 用户明确反馈“不认识/忘记”：应取消“已认识”标记，避免后续继续被当作已掌握词
        updated.knownCount = 0;
        // 避免从高掌握度仅小幅下降导致“看起来还是很熟”，这里做一次上限收敛
        const baseMastery = Math.min(updated.mastery, 0.4);
        updated.mastery = FlowLingo.clamp01(baseMastery - unknownPenalty);
        break;
      }
      default:
        break;
    }

    await FlowLingo.db.putUserWordState(updated);
  }

  FlowLingo.userModel = Object.freeze({ applyEventToWordState });
})(globalThis);
