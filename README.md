# FlowLingo - AI 驱动的可理解英语接触

> **核心理念**：在你不破坏日常浏览体验的前提下，利用 AI 将网页内容改造为 **i+1 难度** 的英语接触点。通过“代码切换（Code-Switching）”技术，让你在自然冲浪中无感习得语言。

FlowLingo 是一个 Chrome/Edge 浏览器扩展，它充当你的“阅读无形调度器”。它根据你的**语言理解边界（Language Comprehension Boundary）**，利用大语言模型（LLM）动态地将网页内容转化为**可理解的输入（Comprehensible Input）**。

---

## ✨ 核心特性

- **🌊 智能代码切换 (AI Code-Switching)**：
  - **非静态替换**：通过 LLM 深度理解网页语境，识别最适合替换的词汇或短语，并确保替换后的英语在语法和语义上与原中文语境完美融合。
  - **句子重写**：支持将复杂的中文长句重写为对应等级（如 CEFR B1/B2）的纯正英语句子。
- **🧠 动态用户模型 (User Modeling)**：
  - **掌握度追踪**：系统会记录你对单词的悬停、发音、标记“认识/不认识”等行为。
  - **自适应难度**：根据你的实时掌握度（Mastery）自动调节替换密度和难度，始终保持在你的 i+1 区域。
- **🛡️ 压强可控与隐私保护**：
  - **多级强度**：支持“低、中、高”三种沉浸强度调节。
  - **隐私优先**：核心逻辑在本地运行，网页解析（Readability）在沙箱中完成，敏感数据不出本地。
- **🔒 灵活的 LLM 集成**：
  - **多提供商支持**：兼容所有 OpenAI 标准接口（如 DeepSeek, GPT-4o-mini 等）。
  - **智能调度**：内置失败重试、优先级切换（Priority）和轮询（Round Robin）调度策略。

## 🚀 快速开始

### 安装说明

本项目目前处于 MVP 阶段，支持通过“加载已解压的扩展程序”方式安装。

1.  **克隆仓库**：
    ```bash
    git clone https://github.com/your-repo/flowlingo.git
    ```
2.  **打开扩展管理**：在浏览器地址栏输入 `chrome://extensions`。
3.  **开启开发者模式**：打开右上角开关。
4.  **加载扩展**：点击“加载已解压的扩展程序”，选择本仓库的根目录。

### 配置与使用

1.  **初始配置**：点击插件图标进入“选项”页面，配置你的 **LLM API Key** 和 **Base URL**。
2.  **选择等级**：设置你的目标 CEFR 等级（如 A2 初级或 B2 中级）。
3.  **开启学习**：在任意中文资讯网页，系统会自动识别文章主体（Using Readability）并开始“注入”英语。
4.  **交互学习**：
    - **悬停**：查看 AI 提供的语境化解释及发音。
    - **标记**：点击浮层按钮调整单词掌握状态，模型将即时优化后续内容。

## 📂 技术架构

```text
src/
├── background/         # 核心逻辑层
│   ├── planner.js      # 转换策略中心（负责 i+1 逻辑、冲突检测、缓存调度）
│   ├── llm_service.js  # LLM 抽象层（处理 Prompt、API 调度、结果格式化）
│   ├── user_model_service.js # 学习者模型（掌握度计算、行为日志分析）
│   ├── db.js           # 本地持久化 (IndexedDB)
│   └── service_worker.js # 扩展生命周期管理
├── content/            # 表现层
│   ├── content_script.js # DOM 注入、Readability 提取、悬停交互
│   └── vendor/         # 第三方库（如 Readability.js）
├── ui/                 # 界面层 (Popup & Options)
└── shared/             # 通用配置与工具库
```

## 🛠️ 核心原理说明

- **i+1 理论实现**：`planner.js` 会结合 `user_model_service.js` 提供的词汇状态，筛选出用户“处于边缘”的词汇，通过 LLM 生成替换方案。
- **冲突检测**：系统确保替换后的短语之间有足够的字符间距（Gap Conflict），避免因过度替换导致的阅读疲劳。
- **上下文感知**：LLM 在生成替换词时会接收当前段落作为上下文，确保生成的英语完全契合原意。

## 致谢与参考

本项目在核心理念和实现策略上参考了以下优秀项目：

- **[VocabMeld](https://github.com/lzskyline/VocabMeld)**
- **[Sapling](https://github.com/zpano/Sapling)**
- **[ries.ai](https://ries.ai/zh/learn-english)**

## 📄 许可证

MIT License
