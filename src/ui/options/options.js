(function initOptions() {
  const FlowLingo = globalThis.FlowLingo;
  if (!FlowLingo) return;

  const elStatus = document.getElementById("status");
  const elGlobalEnabled = document.getElementById("globalEnabled");
  const elCefrStatus = document.getElementById("cefrStatus");
  const elStartVocabTest = document.getElementById("startVocabTest");
  const elVocabTestModal = document.getElementById("vocabTestModal");
  const elVocabTestClose = document.getElementById("vocabTestClose");
  const elVocabTestProgress = document.getElementById("vocabTestProgress");
  const elVocabTestWord = document.getElementById("vocabTestWord");
  const elVocabTestKnown = document.getElementById("vocabTestKnown");
  const elVocabTestUnknown = document.getElementById("vocabTestUnknown");
  const elVocabTestHint = document.getElementById("vocabTestHint");

  const elVocabTestLevel = document.getElementById("vocabTestLevel");
  const elVocabTestProgressBar = document.getElementById(
    "vocabTestProgressBar"
  );

  const elVoiceEnabled = document.getElementById("voiceEnabled");
  const elVoiceProvider = document.getElementById("voiceProvider");
  const elVoiceLang = document.getElementById("voiceLang");
  const elVoiceRate = document.getElementById("voiceRate");
  const elVoiceAutoOnHover = document.getElementById("voiceAutoOnHover");

  const elLlmEnabled = document.getElementById("llmEnabled");
  const elLlmStrategy = document.getElementById("llmStrategy");
  const elLlmTimeoutMs = document.getElementById("llmTimeoutMs");

  const elRateLimitEnabled = document.getElementById("rateLimitEnabled");
  const elRateLimitOptions = document.getElementById("rateLimitOptions");
  const elGlobalRateLimit = document.getElementById("globalRateLimit");

  const elApiNodesList = document.getElementById("apiNodesList");
  const elApiNodesEmpty = document.getElementById("apiNodesEmpty");
  const elAddNodeBtn = document.getElementById("addNodeBtn");

  const elNodeModalOverlay = document.getElementById("nodeModalOverlay");
  const elNodeModalTitle = document.getElementById("nodeModalTitle");
  const elNodeModalClose = document.getElementById("nodeModalClose");
  const elNodeNameInput = document.getElementById("nodeNameInput");
  const elNodeEndpointInput = document.getElementById("nodeEndpointInput");
  const elNodeApiKeyInput = document.getElementById("nodeApiKeyInput");
  const elNodeModelInput = document.getElementById("nodeModelInput");
  const elNodeRateLimitInput = document.getElementById("nodeRateLimitInput");
  const elToggleNodeApiKey = document.getElementById("toggleNodeApiKey");
  const elTestNodeBtn = document.getElementById("testNodeBtn");
  const elNodeTestResult = document.getElementById("nodeTestResult");
  const elCancelNodeBtn = document.getElementById("cancelNodeBtn");
  const elSaveNodeBtn = document.getElementById("saveNodeBtn");
  const elPresetBtns = document.querySelectorAll(".preset-btn");

  // 站点规则相关 DOM 元素
  const elSiteModeRadios = document.querySelectorAll('input[name="siteMode"]');
  const elExcludedSitesGroup = document.getElementById("excludedSitesGroup");
  const elAllowedSitesGroup = document.getElementById("allowedSitesGroup");
  const elExcludedSitesInput = document.getElementById("excludedSitesInput");
  const elAllowedSitesInput = document.getElementById("allowedSitesInput");

  const elTabTitle = document.getElementById("tab-title");
  const elTabDescription = document.getElementById("tab-description");
  const elNavItems = document.querySelectorAll(".nav-item");
  const elTabContents = document.querySelectorAll(".tab-content");

  const elKnownWordsList = document.getElementById("knownWordsList");
  const elKnownWordsEmpty = document.getElementById("knownWordsEmpty");
  const elKnownWordsSearch = document.getElementById("knownWordsSearch");
  const elKnownWordsCount = document.getElementById("knownWordsCount");
  const elKnownWordsRefresh = document.getElementById("knownWordsRefresh");

  let currentSettings = null;
  let saveTimer = null;
  let editingNodeId = null;

  const VOCAB_LEVELS = ["A1", "A2", "B1", "B2", "C1"];
  const WORDS_PER_LEVEL = 10;
  const PASS_RATE = 0.7;
  const C2_RATE = 0.85;

  const VOCAB_TEST_WORDS_FALLBACK = {
    A1: ["book", "family", "water", "school", "happy", "friend"],
    A2: ["travel", "holiday", "exercise", "meeting", "message", "airport"],
    B1: ["improve", "support", "decide", "culture", "continue", "describe"],
    B2: [
      "evidence",
      "analysis",
      "influence",
      "consider",
      "resource",
      "benefit",
    ],
    C1: [
      "substantial",
      "inevitable",
      "controversy",
      "distinguish",
      "sophisticated",
    ],
  };

  let vocabTestState = null;

  const tabMeta = {
    general: {
      title: "配置中心",
      description: "核心运行参数导出，本地优先，可撤回，可降级",
    },
    learning: {
      title: "学习偏好",
      description: "先完成英语水平测试，再调节难度与替换强度",
    },
    behavior: {
      title: "行为设置",
      description: "控制交互反馈、发音辅助及自动化行为",
    },
    sites: {
      title: "站点规则",
      description: "控制插件在哪些网站上运行",
    },
    vocabulary: {
      title: "词汇管理",
      description: "已认识词汇列表；后续出现将以纯英文展示",
    },
  };

  function setStatus(text) {
    elStatus.textContent = text || "";
    if (text) {
      setTimeout(() => {
        if (elStatus.textContent === text) elStatus.textContent = "";
      }, 3000);
    }
  }

  async function send(type, payload) {
    return await chrome.runtime.sendMessage({ type, ...payload });
  }

  const API_PRESETS = {
    openai: {
      name: "OpenAI",
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
    },
    deepseek: {
      name: "DeepSeek",
      endpoint: "https://api.deepseek.com/v1/chat/completions",
      model: "deepseek-chat",
    },
    moonshot: {
      name: "Moonshot",
      endpoint: "https://api.moonshot.cn/v1/chat/completions",
      model: "moonshot-v1-8k",
    },
    groq: {
      name: "Groq",
      endpoint: "https://api.groq.com/openai/v1/chat/completions",
      model: "llama-3.1-8b-instant",
    },
    modelscope: {
      name: "魔搭",
      endpoint: "https://api-inference.modelscope.cn/v1/chat/completions",
      model: "deepseek-ai/DeepSeek-V2.5",
    },
    ollama: {
      name: "Ollama",
      endpoint: "http://localhost:11434/v1/chat/completions",
      model: "qwen2.5:7b",
    },
  };

  function normalizeWordList(text) {
    return String(text || "")
      .split(/\r?\n/g)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 3 && /^[a-z][a-z-']+$/.test(w));
  }

  function selectRandomWords(list, count) {
    const arr = Array.isArray(list) ? list.slice() : [];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr.slice(0, Math.max(0, Math.min(count, arr.length)));
  }

  // --- Multi-node Management ---

  function renderNodesList() {
    const nodes = currentSettings?.llm?.endpoints || [];
    if (nodes.length === 0) {
      elApiNodesList.style.display = "none";
      elApiNodesEmpty.style.display = "flex";
      return;
    }
    elApiNodesList.style.display = "grid";
    elApiNodesEmpty.style.display = "none";

    // 按优先级排序（如果有）
    const sortedNodes = [...nodes].sort(
      (a, b) => (a.priority ?? 0) - (b.priority ?? 0)
    );

    elApiNodesList.innerHTML = sortedNodes
      .map((node, index) => {
        const isEnabled = node.enabled !== false;
        const hasRateLimit = node.rateLimit > 0;
        const rateLimitEnabled = currentSettings?.llm?.rateLimitEnabled;

        // 构建速率限制信息显示
        let rateInfoHtml = "";
        if (rateLimitEnabled && hasRateLimit) {
          rateInfoHtml = `<div class="api-node-rate-info"><span class="rate-custom">${node.rateLimit} RPM (自定义)</span></div>`;
        } else if (rateLimitEnabled) {
          const globalLimit = currentSettings?.llm?.globalRateLimit || 60;
          rateInfoHtml = `<div class="api-node-rate-info"><span class="rate-global">${globalLimit} RPM (全局)</span></div>`;
        }

        return `
        <div class="api-node-card${
          !isEnabled ? " disabled" : ""
        }" data-node-id="${node.id}" data-index="${index}" draggable="true">
          <div class="api-node-drag-handle" title="拖拽调整优先级">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path fill="currentColor" d="M9,3H11V5H9V3M13,3H15V5H13V3M9,7H11V9H9V7M13,7H15V9H13V7M9,11H11V13H9V11M13,11H15V13H13V11M9,15H11V17H9V15M13,15H15V17H13V15M9,19H11V21H9V19M13,19H15V21H13V19Z"/>
            </svg>
          </div>
          <div class="api-node-status ${
            node.lastStatus || "unknown"
          }" id="status-${node.id}" title="${
          node.lastStatus === "healthy"
            ? "连接正常"
            : node.lastStatus === "error"
            ? "连接失败"
            : "未测试"
        }"></div>
          <div class="api-node-info">
            <div class="api-node-name">
              ${escapeHtml(node.name || "未命名节点")}
              ${
                !isEnabled
                  ? '<span class="status-badge disabled">已禁用</span>'
                  : ""
              }
            </div>
            <div class="api-node-endpoint">${escapeHtml(
              maskEndpoint(node.baseUrl || "")
            )} · ${escapeHtml(node.model || "默认模型")}</div>
            ${rateInfoHtml}
          </div>
          <div class="api-node-actions">
            <div class="toggle-container api-node-toggle">
                <input type="checkbox" ${
                  isEnabled ? "checked" : ""
                } data-action="toggle" data-node-id="${node.id}">
                <span class="toggle-slider"></span>
            </div>
            <button class="api-node-btn" data-action="test" data-node-id="${
              node.id
            }" title="测试连接">
              <svg viewBox="0 0 24 24" width="16" height="16" class="test-icon">
                <path fill="currentColor" d="M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22A10,10 0 0,1 2,12A10,10 0 0,1 12,2M11,16.5L18,9.5L16.59,8.09L11,13.67L7.91,10.59L6.5,12L11,16.5Z"/>
              </svg>
              <svg viewBox="0 0 24 24" width="16" height="16" class="loading-icon" style="display:none;">
                <path fill="currentColor" d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
              </svg>
            </button>
            <button class="api-node-btn" data-action="edit" data-node-id="${
              node.id
            }" title="编辑">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z"/>
              </svg>
            </button>
            <button class="api-node-btn danger" data-action="delete" data-node-id="${
              node.id
            }" title="删除">
              <svg viewBox="0 0 24 24" width="16" height="16">
                <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
      })
      .join("");

    // Bind drag events
    bindDragEvents();
  }

  // 脱敏端点显示
  function maskEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      return url.host;
    } catch {
      return endpoint;
    }
  }

  // 绑定拖拽事件
  function bindDragEvents() {
    const cards = elApiNodesList.querySelectorAll(".api-node-card");
    let draggedCard = null;

    cards.forEach((card) => {
      card.addEventListener("dragstart", (e) => {
        draggedCard = card;
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.dataset.index);
      });

      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
        cards.forEach((c) => c.classList.remove("drag-over"));

        // 保存新的优先级顺序
        const nodeIds = Array.from(
          elApiNodesList.querySelectorAll(".api-node-card")
        ).map((c) => c.dataset.nodeId);

        const endpoints = currentSettings.llm.endpoints;
        const nodeMap = new Map(endpoints.map((n) => [n.id, n]));

        const reordered = nodeIds
          .map((id, index) => {
            const node = nodeMap.get(id);
            if (node) {
              node.priority = index;
              return node;
            }
            return null;
          })
          .filter(Boolean);

        currentSettings.llm.endpoints = reordered;
        scheduleSave();
      });

      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (draggedCard && draggedCard !== card) {
          card.classList.add("drag-over");
        }
      });

      card.addEventListener("dragleave", () => {
        card.classList.remove("drag-over");
      });

      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("drag-over");

        if (draggedCard && draggedCard !== card) {
          const list = elApiNodesList;
          const cardsArr = Array.from(list.querySelectorAll(".api-node-card"));
          const draggedIndex = cardsArr.indexOf(draggedCard);
          const dropIndex = cardsArr.indexOf(card);

          if (draggedIndex < dropIndex) {
            card.after(draggedCard);
          } else {
            card.before(draggedCard);
          }
        }
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text || "";
    return div.innerHTML;
  }

  function openNodeModal(nodeId = null) {
    editingNodeId = nodeId;
    if (nodeId) {
      elNodeModalTitle.textContent = "编辑节点";
      const node = currentSettings.llm.endpoints.find((n) => n.id === nodeId);
      if (node) {
        elNodeNameInput.value = node.name || "";
        elNodeEndpointInput.value = node.baseUrl || "";
        elNodeApiKeyInput.value = node.apiKey || "";
        elNodeModelInput.value = node.model || "";
        elNodeRateLimitInput.value = node.rateLimit > 0 ? node.rateLimit : "";
      }
    } else {
      elNodeModalTitle.textContent = "添加节点";
      elNodeNameInput.value = "";
      elNodeEndpointInput.value = "https://api.openai.com/v1/chat/completions";
      elNodeApiKeyInput.value = "";
      elNodeModelInput.value = "";
      elNodeRateLimitInput.value = "";
    }
    elNodeTestResult.textContent = "";
    elNodeModalOverlay.style.display = "flex";
  }

  function closeNodeModal() {
    elNodeModalOverlay.style.display = "none";
    editingNodeId = null;
  }

  function saveNode() {
    const name = elNodeNameInput.value.trim();
    const baseUrl = elNodeEndpointInput.value.trim();
    const apiKey = elNodeApiKeyInput.value.trim();
    const model = elNodeModelInput.value.trim();
    const rateLimitValue = elNodeRateLimitInput.value.trim();
    // 0 或留空表示使用全局设置（存为 null）
    const rateLimit =
      rateLimitValue && parseInt(rateLimitValue) > 0
        ? parseInt(rateLimitValue)
        : null;

    if (!name || !baseUrl) {
      if (!name) elNodeNameInput.classList.add("error");
      if (!baseUrl) elNodeEndpointInput.classList.add("error");

      setTimeout(() => {
        elNodeNameInput.classList.remove("error");
        elNodeEndpointInput.classList.remove("error");
      }, 2000);

      elNodeTestResult.textContent = "名称和端点不能为空";
      elNodeTestResult.className = "test-result error show";
      return;
    }

    if (!currentSettings.llm.endpoints) currentSettings.llm.endpoints = [];

    if (editingNodeId) {
      const idx = currentSettings.llm.endpoints.findIndex(
        (n) => n.id === editingNodeId
      );
      if (idx !== -1) {
        currentSettings.llm.endpoints[idx] = {
          ...currentSettings.llm.endpoints[idx],
          name,
          baseUrl,
          apiKey,
          model,
          rateLimit,
          lastStatus: currentSettings.llm.endpoints[idx].lastStatus,
        };
      }
    } else {
      const newNode = {
        id:
          "node_" +
          Date.now().toString(36) +
          "_" +
          Math.random().toString(36).slice(2, 9),
        name,
        baseUrl,
        apiKey,
        model,
        rateLimit,
        enabled: true,
        priority: currentSettings.llm.endpoints.length,
      };
      currentSettings.llm.endpoints.push(newNode);
    }

    closeNodeModal();
    renderNodesList();
    scheduleSave();
  }

  async function testNode(nodeId, btn = null) {
    let endpoint, apiKey, model;

    if (nodeId === "modal") {
      endpoint = elNodeEndpointInput.value.trim();
      apiKey = elNodeApiKeyInput.value.trim();
      model = elNodeModelInput.value.trim() || "gpt-4o-mini";
    } else {
      const node = currentSettings.llm.endpoints.find((n) => n.id === nodeId);
      if (!node) return;
      endpoint = node.baseUrl;
      apiKey = node.apiKey;
      model = node.model || "gpt-4o-mini";
    }

    // 显示加载状态
    if (btn) {
      btn.disabled = true;
      btn.classList.add("testing");
      const testIcon = btn.querySelector(".test-icon");
      const loadingIcon = btn.querySelector(".loading-icon");
      if (testIcon) testIcon.style.display = "none";
      if (loadingIcon) loadingIcon.style.display = "block";
    }

    const resultEl = nodeId === "modal" ? elNodeTestResult : null;
    if (resultEl) {
      resultEl.textContent = "正在建立连接...";
      resultEl.className = "test-result show";
    }

    const statusEl = document.getElementById(`status-${nodeId}`);
    if (statusEl) {
      statusEl.className = "api-node-status testing";
      statusEl.title = "测试中...";
    }

    // Modal 内按钮特殊处理
    const modalBtn = nodeId === "modal" ? elTestNodeBtn : null;
    if (modalBtn) {
      modalBtn.disabled = true;
      modalBtn.classList.add("testing");
      const btnText = modalBtn.querySelector("span");
      if (btnText) btnText.textContent = "正在测试...";
    }

    const res = await send(FlowLingo.MessageType.TEST_LLM_ENDPOINT, {
      baseUrl: endpoint,
      apiKey: apiKey,
      model: model,
      timeoutMs: parseInt(elLlmTimeoutMs.value, 10),
    });

    // 恢复按钮状态
    if (btn) {
      btn.disabled = false;
      btn.classList.remove("testing");
      const testIcon = btn.querySelector(".test-icon");
      const loadingIcon = btn.querySelector(".loading-icon");
      if (testIcon) testIcon.style.display = "block";
      if (loadingIcon) loadingIcon.style.display = "none";
    }

    if (modalBtn) {
      modalBtn.disabled = false;
      modalBtn.classList.remove("testing");
      const btnText = modalBtn.querySelector("span");
      if (btnText) btnText.textContent = "测试连接";
    }

    const success = res?.ok;
    const errorDetail = res?.error?.detail || res?.error?.message || "";
    const message = success ? "✓ 连接成功" : `✗ 连接失败: ${errorDetail}`;
    const statusClass = success ? "healthy" : "error";

    // 更新内存状态并同步到主列表及保存
    const updateNodeStatus = (nId, status) => {
      const node = currentSettings.llm.endpoints.find((n) => n.id === nId);
      if (node) {
        node.lastStatus = status;
        // 如果是 modal 测试且找到了对应节点，同时也更新它在列表里的状态点
      }

      // 同时也更新它在列表里的状态点
      const listStatusEl = document.getElementById(`status-${nId}`);
      if (listStatusEl) {
        listStatusEl.className = `api-node-status ${status}`;
        listStatusEl.title = status === "healthy" ? "连接正常" : "连接失败";
      }
    };

    if (nodeId === "modal") {
      if (editingNodeId) {
        updateNodeStatus(editingNodeId, statusClass);
      }
    } else {
      updateNodeStatus(nodeId, statusClass);
    }

    // 只要进行了测试，就安排一次保存
    scheduleSave();

    if (resultEl) {
      resultEl.textContent = message;
      resultEl.className = success
        ? "test-result success show"
        : "test-result error show";
    }

    if (statusEl) {
      statusEl.className = success
        ? "api-node-status healthy"
        : "api-node-status error";
      statusEl.title = success ? "正常" : res?.error?.message || "连接失败";
    }
  }

  function deleteNode(nodeId) {
    if (!confirm("确定要删除这个节点吗？")) return;
    currentSettings.llm.endpoints = currentSettings.llm.endpoints.filter(
      (n) => n.id !== nodeId
    );
    renderNodesList();
    scheduleSave();
  }

  function toggleNode(nodeId, enabled) {
    const node = currentSettings.llm.endpoints.find((n) => n.id === nodeId);
    if (node) {
      node.enabled = enabled;
      renderNodesList();
      scheduleSave();
    }
  }

  async function loadWordList(level) {
    const safeLevel = VOCAB_LEVELS.includes(level) ? level : "A1";
    try {
      const url = chrome.runtime.getURL(
        `src/assets/cefr_wordlist/${safeLevel}.txt`
      );
      const resp = await fetch(url);
      if (!resp.ok) return VOCAB_TEST_WORDS_FALLBACK[safeLevel] || [];
      const text = await resp.text();
      const list = normalizeWordList(text);
      return list.length > 0
        ? list
        : VOCAB_TEST_WORDS_FALLBACK[safeLevel] || [];
    } catch {
      return VOCAB_TEST_WORDS_FALLBACK[safeLevel] || [];
    }
  }

  function updateVocabTestUi() {
    if (!vocabTestState || !vocabTestState.currentQuestion) return;

    const { word, level } = vocabTestState.currentQuestion;
    const currentCount = vocabTestState.history.length + 1;
    const totalCount = vocabTestState.totalQuestions;

    // 更新进度条
    if (elVocabTestProgressBar) {
      const progress = ((currentCount - 1) / totalCount) * 100;
      elVocabTestProgressBar.style.width = `${progress}%`;
    }

    // 更新进度文字
    if (elVocabTestProgress) {
      elVocabTestProgress.textContent = `${currentCount} / ${totalCount}`;
    }

    // 更新等级标签 (显示当前题目难度，或者隐藏，显示难度可能泄露信息？计划里没说隐藏，暂时显示)
    if (elVocabTestLevel) {
      elVocabTestLevel.textContent = level;
    }

    // 更新单词
    if (elVocabTestWord) {
      // 移除并重新添加动画类以触发 wordScale 动画
      elVocabTestWord.style.animation = "none";
      elVocabTestWord.offsetHeight; // trigger reflow
      elVocabTestWord.style.animation = "";
      elVocabTestWord.textContent = word;
    }

    if (elVocabTestHint) {
      elVocabTestHint.textContent =
        "判断标准：如果你能大致理解/会用这个英文单词，点「认识」；否则点「不认识」。";
    }
  }

  function abortVocabTest() {
    vocabTestState = null;
    if (elVocabTestModal) elVocabTestModal.style.display = "none";
    if (elStartVocabTest) elStartVocabTest.disabled = false;
  }

  function computeCefrLevelFromTest(history) {
    if (!history || history.length === 0) return "A1";

    // 取最后 15 题（或者全部，如果不足 15 题）
    const subset = history.slice(Math.max(0, history.length - 15));

    // 计算难度均值 (A1=1, A2=2, ..., C1=5)
    let sum = 0;
    for (const item of subset) {
      const idx = VOCAB_LEVELS.indexOf(item.level);
      if (idx !== -1) sum += idx + 1;
    }

    const avg = sum / subset.length;

    // 映射回等级
    const rounded = Math.round(avg);
    const finalIdx = Math.max(1, Math.min(VOCAB_LEVELS.length, rounded)) - 1;

    return VOCAB_LEVELS[finalIdx];
  }

  async function finishVocabTest() {
    if (!vocabTestState) return;

    // 填满进度条
    if (elVocabTestProgressBar) elVocabTestProgressBar.style.width = "100%";

    const level = computeCefrLevelFromTest(vocabTestState.history);

    // 更新设置
    if (!currentSettings.learning) currentSettings.learning = {};
    currentSettings.learning.tested = true;
    currentSettings.learning.difficultyLevel = level;
    currentSettings.learning.testedAt = Date.now();

    // 保存设置
    scheduleSave();

    // 更新 UI
    if (elCefrStatus) {
      const timeText = new Date().toLocaleString();
      elCefrStatus.textContent = `已测试：${level}（${timeText}）`;
    }
    if (elStartVocabTest) {
      elStartVocabTest.textContent = "重新测试";
      elStartVocabTest.disabled = false;
    }

    // 关闭模态框并显示结果
    if (elVocabTestModal) elVocabTestModal.style.display = "none";
    setStatus(`测试完成！您的英语水平：${level}`);
    vocabTestState = null;
  }

  function getNextQuestion() {
    if (vocabTestState.history.length >= vocabTestState.totalQuestions) {
      finishVocabTest();
      return;
    }

    const level = vocabTestState.nextLevel;
    const pool = vocabTestState.pools[level];

    let word = null;
    if (pool && pool.length > 0) {
      word = pool.pop(); // 随机洗牌后直接取
    } else {
      // 兜底：如果该等级题库空了（不太可能），随机取一个 fallback 或者保持原等级
      word = "something";
    }

    vocabTestState.currentQuestion = { word, level };
    updateVocabTestUi();
  }

  function answerVocabTest(isKnown) {
    if (!vocabTestState || !vocabTestState.currentQuestion) return;

    const { word, level } = vocabTestState.currentQuestion;

    // 记录历史
    vocabTestState.history.push({ word, level, isKnown });

    // 自适应逻辑：调整下一题难度
    const currentIdx = VOCAB_LEVELS.indexOf(level);
    let nextIdx = currentIdx;

    if (isKnown) {
      // 认识 -> 增加难度 (上限 C1)
      nextIdx = Math.min(nextIdx + 1, VOCAB_LEVELS.length - 1);
    } else {
      // 不认识 -> 降低难度 (下限 A1)
      nextIdx = Math.max(nextIdx - 1, 0);
    }

    vocabTestState.nextLevel = VOCAB_LEVELS[nextIdx];
    getNextQuestion();
  }

  async function startVocabTest() {
    if (elStartVocabTest) elStartVocabTest.disabled = true;
    setStatus("正在加载测试词表...");

    // 并行加载所有词表
    const lists = await Promise.all(VOCAB_LEVELS.map((l) => loadWordList(l)));
    const pools = {};

    // 初始化并洗牌词库
    VOCAB_LEVELS.forEach((l, i) => {
      const list = lists[i] || [];
      // 使用现有的 selectRandomWords 进行全量洗牌 (传入长度为 list.length)
      pools[l] = selectRandomWords(list, list.length);
    });

    // 检查词库是否为空
    const totalWords = Object.values(pools).reduce(
      (acc, arr) => acc + arr.length,
      0
    );
    if (totalWords === 0) {
      setStatus("测试词表加载失败");
      if (elStartVocabTest) elStartVocabTest.disabled = false;
      return;
    }

    // 初始化状态
    vocabTestState = {
      history: [], // 答题记录
      pools: pools, // 剩余词库
      nextLevel: "B1", // 初始难度从中间开始
      currentQuestion: null,
      totalQuestions: 25, // 总题数减少为 25
    };

    if (elVocabTestModal) elVocabTestModal.style.display = "flex";
    getNextQuestion();
    setStatus("");
  }

  function fillForm(settings) {
    if (elGlobalEnabled) elGlobalEnabled.checked = Boolean(settings.enabled);

    const presentation = settings.presentation || "en_cn";
    const intensity = settings.learning?.intensity || "medium";

    document.querySelectorAll('input[name="presentation"]').forEach((radio) => {
      radio.checked = radio.value === presentation;
    });

    document.querySelectorAll('input[name="intensity"]').forEach((radio) => {
      radio.checked = radio.value === intensity;
    });

    const tested = Boolean(settings.learning?.tested);
    const level = String(settings.learning?.difficultyLevel || "").trim();

    if (elCefrStatus) {
      if (tested && level) {
        const ts = settings.learning?.testedAt || 0;
        const timeText = ts ? new Date(ts).toLocaleString() : "";
        elCefrStatus.textContent = timeText
          ? `已测试：${level}（${timeText}）`
          : `已测试：${level}`;
      } else elCefrStatus.textContent = "未测试";
    }
    if (elStartVocabTest)
      elStartVocabTest.textContent = tested ? "重新测试" : "开始测试";

    elVoiceEnabled.checked = Boolean(settings.voice?.enabled);
    elVoiceProvider.value = settings.voice?.provider || "system";
    elVoiceLang.value = settings.voice?.lang || "en-US";
    elVoiceRate.value = String(settings.voice?.rate ?? 1.0);
    elVoiceAutoOnHover.checked = Boolean(settings.voice?.autoOnHover);

    elLlmEnabled.checked = Boolean(settings.llm?.enabled);
    elLlmStrategy.value = settings.llm?.strategy || "round_robin";
    elLlmTimeoutMs.value = String(settings.llm?.timeoutMs ?? 5000);

    elRateLimitEnabled.checked = Boolean(settings.llm?.rateLimitEnabled);
    elRateLimitOptions.style.display = settings.llm?.rateLimitEnabled
      ? "grid"
      : "none";
    elGlobalRateLimit.value = settings.llm?.globalRateLimit || 60;

    // 站点规则
    const siteMode = settings.siteMode || "all";
    elSiteModeRadios.forEach((radio) => {
      radio.checked = radio.value === siteMode;
    });
    updateSiteListVisibility(siteMode);
    if (elExcludedSitesInput) {
      elExcludedSitesInput.value = (settings.excludedSites || []).join("\n");
    }
    if (elAllowedSitesInput) {
      elAllowedSitesInput.value = (settings.allowedSites || []).join("\n");
    }

    renderNodesList();
  }

  function updateSiteListVisibility(mode) {
    if (elExcludedSitesGroup) {
      elExcludedSitesGroup.style.display = mode === "all" ? "block" : "none";
    }
    if (elAllowedSitesGroup) {
      elAllowedSitesGroup.style.display =
        mode === "whitelist" ? "block" : "none";
    }
  }

  function readFormAsPatch() {
    const selectedPresentation = document.querySelector(
      'input[name="presentation"]:checked'
    );
    const selectedIntensity = document.querySelector(
      'input[name="intensity"]:checked'
    );

    return {
      enabled: elGlobalEnabled ? elGlobalEnabled.checked : true,
      presentation: selectedPresentation ? selectedPresentation.value : "en_cn",
      learning: {
        ...(currentSettings?.learning || {}),
        intensity: selectedIntensity ? selectedIntensity.value : "medium",
      },
      voice: {
        enabled: elVoiceEnabled.checked,
        provider: elVoiceProvider.value,
        lang: elVoiceLang.value,
        rate: parseFloat(elVoiceRate.value),
        autoOnHover: elVoiceAutoOnHover.checked,
      },
      llm: {
        enabled: elLlmEnabled.checked,
        strategy: elLlmStrategy.value,
        timeoutMs: parseInt(elLlmTimeoutMs.value, 10),
        rateLimitEnabled: elRateLimitEnabled.checked,
        globalRateLimit: parseInt(elGlobalRateLimit.value, 10) || 60,
        endpoints: currentSettings?.llm?.endpoints || [],
      },
      siteMode:
        document.querySelector('input[name="siteMode"]:checked')?.value ||
        "all",
      excludedSites: elExcludedSitesInput
        ? parseSiteList(elExcludedSitesInput.value)
        : [],
      allowedSites: elAllowedSitesInput
        ? parseSiteList(elAllowedSitesInput.value)
        : [],
    };
  }

  function parseSiteList(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }

  function scheduleSave() {
    if (saveTimer) globalThis.clearTimeout(saveTimer);
    saveTimer = globalThis.setTimeout(save, 400);
  }

  async function save() {
    saveTimer = null;
    if (!currentSettings) return;

    setStatus("正在保存...");
    const patch = readFormAsPatch();
    const res = await send(FlowLingo.MessageType.SET_GLOBAL_SETTINGS, {
      patch,
    });
    if (!res?.ok) return setStatus("保存失败");

    currentSettings = res.data;
    setStatus("配置已同步");
  }

  async function load() {
    setStatus("");
    const res = await send(FlowLingo.MessageType.GET_GLOBAL_SETTINGS, {});
    if (!res?.ok) return setStatus("加载失败");
    currentSettings = res.data;
    fillForm(currentSettings);
  }

  // --- Vocabulary Management ---

  let knownWordsCache = [];

  function normalizeSearchQuery(q) {
    return String(q || "")
      .trim()
      .toLowerCase();
  }

  function isWordMatched(item, q) {
    if (!q) return true;
    const en = String(item?.en || "").toLowerCase();
    const cn = String(item?.cn || "");
    const wordId = String(item?.wordId || "").toLowerCase();
    return en.includes(q) || cn.includes(q) || wordId.includes(q);
  }

  function renderKnownWords() {
    if (!elKnownWordsList || !elKnownWordsEmpty || !elKnownWordsCount) return;

    const q = normalizeSearchQuery(elKnownWordsSearch?.value);
    const total = Array.isArray(knownWordsCache) ? knownWordsCache.length : 0;
    const filtered = Array.isArray(knownWordsCache)
      ? knownWordsCache.filter((w) => isWordMatched(w, q))
      : [];

    elKnownWordsCount.textContent = q
      ? `${filtered.length} / ${total}`
      : `${total}`;

    if (total === 0) {
      elKnownWordsEmpty.style.display = "flex";
      elKnownWordsList.innerHTML = "";
      return;
    }

    elKnownWordsEmpty.style.display = "none";

    if (filtered.length === 0) {
      elKnownWordsList.innerHTML =
        '<div class="hint" style="padding: 12px 2px">未找到匹配词汇</div>';
      return;
    }

    elKnownWordsList.innerHTML = filtered
      .map((w) => {
        const en = w.en ? escapeHtml(w.en) : "（未记录）";
        const cn = w.cn ? escapeHtml(w.cn) : "（未记录）";
        const wordId = escapeHtml(w.wordId || "-");
        const knownCount = Number.isFinite(w.knownCount) ? w.knownCount : 0;
        return `
          <div class="known-word-item">
            <div class="known-word-main">
              <div class="known-word-en">${en}</div>
              <div class="known-word-cn">${cn}</div>
              <div class="known-word-id">${wordId}</div>
            </div>
            <div class="known-word-meta">
              <div class="known-word-pill">认识 × ${knownCount}</div>
              <button class="btn-icon danger known-word-delete" data-word-id="${wordId}" title="删除">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    // 绑定删除按钮事件
    elKnownWordsList.querySelectorAll(".known-word-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const wordId = btn.dataset.wordId;
        if (!wordId) return;
        if (
          !confirm(
            `确定要删除词汇「${wordId}」吗？删除后该词汇将重新出现翻译。`
          )
        )
          return;

        btn.disabled = true;
        const res = await send(FlowLingo.MessageType.DELETE_KNOWN_WORD, {
          wordId,
        });
        if (res?.ok) {
          // 从缓存中移除并重新渲染
          knownWordsCache = knownWordsCache.filter((w) => w.wordId !== wordId);
          renderKnownWords();
          setStatus("词汇已删除");
        } else {
          setStatus("删除失败");
          btn.disabled = false;
        }
      });
    });
  }

  async function loadKnownWords() {
    if (!elKnownWordsList) return;
    const res = await send(FlowLingo.MessageType.LIST_KNOWN_WORDS, {});
    if (!res?.ok) return setStatus("词汇加载失败");
    knownWordsCache = Array.isArray(res.data?.items) ? res.data.items : [];
    renderKnownWords();
  }

  // --- Event Listeners ---

  function switchTab(tabId) {
    elNavItems.forEach((i) =>
      i.classList.toggle("active", i.dataset.tab === tabId)
    );
    elTabContents.forEach((c) =>
      c.classList.toggle("active", c.id === `tab-${tabId}`)
    );
    const meta = tabMeta[tabId];
    if (meta) {
      elTabTitle.textContent = meta.title;
      elTabDescription.textContent = meta.description;
    }
    window.location.hash = tabId;

    if (tabId === "vocabulary") {
      loadKnownWords().catch(() => {});
    }
  }

  // --- Event Listeners ---

  elNavItems.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  document.addEventListener("input", (e) => {
    if (e.target.closest(".modal-content")) return;
    if (e.target === elRateLimitEnabled)
      elRateLimitOptions.style.display = elRateLimitEnabled.checked
        ? "grid"
        : "none";
    scheduleSave();
  });

  document.addEventListener("change", (e) => {
    // 站点模式切换时更新显示
    if (e.target.name === "siteMode") {
      updateSiteListVisibility(e.target.value);
    }
    scheduleSave();
  });

  elAddNodeBtn.addEventListener("click", () => openNodeModal());
  elNodeModalClose.addEventListener("click", closeNodeModal);
  elCancelNodeBtn.addEventListener("click", closeNodeModal);
  elSaveNodeBtn.addEventListener("click", saveNode);
  elToggleNodeApiKey.addEventListener("click", () => {
    elNodeApiKeyInput.type =
      elNodeApiKeyInput.type === "password" ? "text" : "password";
  });
  elTestNodeBtn.addEventListener("click", () =>
    testNode("modal", elTestNodeBtn)
  );

  elPresetBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = API_PRESETS[btn.dataset.preset];
      if (preset) {
        elNodeNameInput.value = preset.name;
        elNodeEndpointInput.value = preset.endpoint;
        elNodeModelInput.value = preset.model;
      }
    });
  });

  elApiNodesList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const nodeId = btn.dataset.nodeId;
    if (action === "edit") openNodeModal(nodeId);
    else if (action === "delete") deleteNode(nodeId);
    else if (action === "test") testNode(nodeId, btn);
    else if (action === "toggle") toggleNode(nodeId, btn.checked);
  });

  if (elStartVocabTest)
    elStartVocabTest.addEventListener("click", startVocabTest);
  if (elVocabTestKnown)
    elVocabTestKnown.addEventListener("click", () => answerVocabTest(true));
  if (elVocabTestUnknown)
    elVocabTestUnknown.addEventListener("click", () => answerVocabTest(false));
  if (elVocabTestClose)
    elVocabTestClose.addEventListener("click", abortVocabTest);

  if (elKnownWordsRefresh)
    elKnownWordsRefresh.addEventListener("click", () =>
      loadKnownWords().catch(() => {})
    );
  if (elKnownWordsSearch)
    elKnownWordsSearch.addEventListener("input", () => renderKnownWords());

  // --- Initial state recovery (Sync) ---
  const initialHash = window.location.hash.replace("#", "");
  switchTab(tabMeta[initialHash] ? initialHash : "general");

  load();

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "POLICY_UPDATED") {
      load();
    }
  });
})();
