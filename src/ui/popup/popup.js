(function initPopup() {
  const FlowLingo = globalThis.FlowLingo;
  if (!FlowLingo) return;

  const elGlobalEnabled = document.getElementById("globalEnabled");
  const elSiteEnabled = document.getElementById("siteEnabled");
  const elDomainLabel = document.getElementById("domainLabel");
  const elDifficultyLabel = document.getElementById("difficultyLabel");
  const elIntensity = document.getElementById("intensity");
  const elGateHint = document.getElementById("gateHint");
  const elStats = document.getElementById("stats");
  const elStatus = document.getElementById("status");
  const elSiteRow = document.getElementById("siteRow");
  const elSiteDivider = document.getElementById("siteDivider");

  let currentDomain = "";
  let currentSettings = null;
  let currentPolicy = null;

  function setStatus(text) {
    elStatus.textContent = text || "";
  }

  async function send(type, payload) {
    return await chrome.runtime.sendMessage({ type, ...payload });
  }

  async function reportPageEvent(type) {
    if (!currentDomain) return;
    const event = {
      type,
      targetType: "page",
      domain: currentDomain,
      ts: Date.now(),
    };
    await send(FlowLingo.MessageType.REPORT_EVENT, { event }).catch(() => {});
  }

  async function getActiveDomain() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const url = tabs?.[0]?.url || "";
      return FlowLingo.getHostnameFromUrl(url);
    } catch {
      return "";
    }
  }

  function renderStats(stats) {
    const items = [
      ["totalTranslations", "累计翻译"],
      ["todayTranslations", "今日翻译"],
    ];
    elStats.innerHTML = "";
    for (const [key, label] of items) {
      const value = stats?.[key] ?? 0;
      const div = document.createElement("div");
      div.className = "stat";
      div.innerHTML = `<span class="stat-label">${label}</span><span class="stat-value">${value}</span>`;
      elStats.appendChild(div);
    }
  }

  // 检查当前域名是否在排除列表中
  function isDomainExcluded(domain, excludedSites) {
    if (!domain || !Array.isArray(excludedSites)) return false;
    const lowerDomain = domain.toLowerCase();
    return excludedSites.some((pattern) =>
      lowerDomain.includes(pattern.toLowerCase()),
    );
  }

  async function load() {
    setStatus("");

    currentDomain = await getActiveDomain();
    elDomainLabel.textContent = currentDomain || "（不可用）";
    elSiteEnabled.disabled = !currentDomain;

    const settingsRes = await send(
      FlowLingo.MessageType.GET_GLOBAL_SETTINGS,
      {},
    );
    if (settingsRes?.ok) currentSettings = settingsRes.data;

    elGlobalEnabled.checked = Boolean(currentSettings?.llm?.enabled);
    elIntensity.value = String(
      currentSettings?.learning?.intensity ?? "medium",
    );
    elDifficultyLabel.textContent = currentSettings?.learning?.tested
      ? currentSettings?.learning?.difficultyLevel || "-"
      : "未测试";

    // 根据 siteMode 控制当前站点行的显示
    const siteMode = currentSettings?.siteMode || "all";
    const showSiteRow = siteMode === "all" && currentDomain;
    if (elSiteRow) elSiteRow.style.display = showSiteRow ? "flex" : "none";
    if (elSiteDivider)
      elSiteDivider.style.display = showSiteRow ? "block" : "none";

    // 根据 excludedSites 判断当前站点是否启用
    if (currentDomain && siteMode === "all") {
      const excludedSites = currentSettings?.excludedSites || [];
      elSiteEnabled.checked = !isDomainExcluded(currentDomain, excludedSites);
    }

    if (currentDomain) {
      const policyRes = await send(FlowLingo.MessageType.GET_PAGE_POLICY, {
        domain: currentDomain,
      });
      if (policyRes?.ok) currentPolicy = policyRes.data;
    }

    if (currentPolicy?.learning) {
      elIntensity.value = String(currentPolicy.learning.intensity || "medium");
      elDifficultyLabel.textContent = currentPolicy.learning.tested
        ? currentPolicy.learning.difficultyLevel || "-"
        : "未测试";
    }

    if (elGateHint) {
      if (currentPolicy?.blockedReason === "need_test") {
        elGateHint.textContent = "未完成英语水平测试，替换已停用...";
      } else if (currentPolicy?.blockedReason === "need_llm_config") {
        elGateHint.textContent = "未配置 AI 节点，替换已停用...";
      } else if (currentPolicy?.blockedReason === "disabled") {
        elGateHint.textContent = "当前站点或全局已关闭。";
      } else if (currentPolicy?.blockedReason === "site_blocked") {
        elGateHint.textContent = "当前站点已被排除。";
      } else {
        elGateHint.textContent = "";
      }
    }

    const dayTs = FlowLingo.dayStartTs(Date.now());
    const statsRes = await send(FlowLingo.MessageType.GET_LEARNING_STATS, {
      dayTs,
    });
    if (statsRes?.ok) renderStats(statsRes.data);
  }

  elGlobalEnabled.addEventListener("change", async () => {
    const enabled = elGlobalEnabled.checked;
    const res = await send(FlowLingo.MessageType.SET_GLOBAL_SETTINGS, {
      patch: { llm: { enabled } },
    });
    if (!res?.ok) return setStatus("更新失败");
    currentSettings = res.data;
    await reportPageEvent(enabled ? "resume" : "pause");
    setStatus(enabled ? "AI已开启" : "AI已关闭");
  });

  elSiteEnabled.addEventListener("change", async () => {
    if (!currentDomain) return;
    const enabled = elSiteEnabled.checked;

    // 获取当前排除列表
    const excludedSites = [...(currentSettings?.excludedSites || [])];
    const lowerDomain = currentDomain.toLowerCase();

    if (enabled) {
      // 启用：从排除列表中移除当前站点
      const filtered = excludedSites.filter(
        (s) =>
          !lowerDomain.includes(s.toLowerCase()) &&
          !s.toLowerCase().includes(lowerDomain),
      );
      // 精确匹配移除
      const newExcluded = excludedSites.filter(
        (s) => s.toLowerCase() !== lowerDomain,
      );
      const res = await send(FlowLingo.MessageType.SET_GLOBAL_SETTINGS, {
        patch: { excludedSites: newExcluded },
      });
      if (!res?.ok) return setStatus("更新失败");
      currentSettings = res.data;
    } else {
      // 禁用：添加当前站点到排除列表
      if (!excludedSites.some((s) => s.toLowerCase() === lowerDomain)) {
        excludedSites.push(lowerDomain);
      }
      const res = await send(FlowLingo.MessageType.SET_GLOBAL_SETTINGS, {
        patch: { excludedSites },
      });
      if (!res?.ok) return setStatus("更新失败");
      currentSettings = res.data;
    }

    await reportPageEvent(enabled ? "resume" : "pause");
    setStatus(enabled ? "本站点已启用" : "本站点已排除");
  });

  elIntensity.addEventListener("change", async () => {
    const intensity = String(elIntensity.value || "medium");
    const res = await send(FlowLingo.MessageType.SET_GLOBAL_SETTINGS, {
      patch: { learning: { intensity } },
    });
    if (!res?.ok) return setStatus("更新失败");
    currentSettings = res.data;
    setStatus("已更新强度");
  });

  load();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "POLICY_UPDATED") {
      load();
    }
  });
})();
