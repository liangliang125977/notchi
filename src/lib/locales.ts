export type Locale = "en" | "zh";

export interface Strings {
  // App header
  app: {
    title: string;
    subtitle: string;
  };
  // Nav tabs
  nav: {
    overview: string;
    sessions: string;
    pet: string;
    settings: string;
  };
  // Notification banner
  notif: {
    denied: string;
    openSettings: string;
    dismiss: string;
  };
  // Overview panel
  overview: {
    today: string;
    week: string;
    month: string;
    tokens: string;
    sessions: string;
    topModel: string;
    cacheRead: string;
    cacheWrite: string;
    hourly: string;
    daily7: string;
    daily30: string;
    byTool: string;
    byModel: string;
    byProject: string;
    recentSessions: string;
    last: (n: number) => string;
    noDataToday: string;
    noDataWeek: string;
    noDataMonth: string;
    failedToLoad: (err: string) => string;
    loading: string;
    colTime: string;
    colProject: string;
    colTokens: string;
    colModel: string;
    cacheEfficiency: string;
    cacheSaved: string;
    cacheReads: string;
    cacheVsYesterday: (delta: number) => string;
    cacheLabel: (pct: string) => string;
  };
  // Sessions panel
  sessions: {
    filterPlaceholder: string;
    showing: (filtered: number, total: number, period: string) => string;
    last30days: string;
    noMatch: string;
    loadingsessions: string;
    failedToLoad: (err: string) => string;
    colTime: string;
    colProject: string;
    colModel: string;
    colTokens: string;
    colSource: string;
    detailSessionId: string;
    detailProject: string;
    detailStarted: string;
  };
  // Settings panel
  settings: {
    dataFolder: string;
    dataFolderHint: string;
    apply: string;
    applying: string;
    dataFolderUpdated: string;
    claudeNotFound: string;
    dataSources: string;
    dataSourcesHint: string;
    noSourcesYet: string;
    eventsCount: (n: number) => string;
    ingested: (time: string) => string;
    idle: string;
    quietHours: string;
    quietHoursHint: string;
    from: string;
    to: string;
    save: string;
    quietHoursSaved: string;
    dangerZone: string;
    dangerZoneHint: string;
    clearAll: string;
    clearConfirm: string;
    cancel: string;
    yesClear: string;
    clearing: string;
    cleared: string;
    about: string;
    version: string;
    privacy: string;
    privacyValue: string;
    spec: string;
    language: string;
    languageHint: string;
  };
  // Pet panel
  pet: {
    fallbackBanner: string;
    petSize: string;
    petSizeHint: string;
    large: string;
    small: string;
    petCharacter: string;
    petCharacterHint: string;
    notchLayout: string;
    notchLayoutHint: string;
    targetDisplay: string;
    targetDisplayHint: string;
    mainDisplay: string;
    main: string;
    notch: string;
    noDisplays: string;
  };
  // L2 capsule
  l2: {
    noActivityToday: string;
  };
  // Period labels (shared)
  period: {
    today: string;
    week: string;
    month: string;
    all: string;
  };
}

export const en: Strings = {
  app: {
    title: "Notchi",
    subtitle: "Local-only AI coding companion · v0.1.0",
  },
  nav: {
    overview: "Overview",
    sessions: "Sessions",
    pet: "Pet",
    settings: "Settings",
  },
  notif: {
    denied:
      "⚠️ macOS notification permission denied. System notifications won't fire on task completion (bubbles still work).",
    openSettings: "Open System Settings",
    dismiss: "dismiss",
  },
  overview: {
    today: "Today",
    week: "Last 7 days",
    month: "This month",
    tokens: "Tokens",
    sessions: "Sessions",
    topModel: "Top model",
    cacheRead: "Cache read",
    cacheWrite: "Cache write",
    hourly: "Hourly distribution",
    daily7: "Daily distribution (7d)",
    daily30: "Daily distribution (30d)",
    byTool: "By tool",
    byModel: "By model",
    byProject: "By project",
    recentSessions: "Recent sessions",
    last: (n) => `Last ${n}`,
    noDataToday: "No data yet today.",
    noDataWeek: "No data this week.",
    noDataMonth: "No data this month.",
    failedToLoad: (err) => `Failed to load overview: ${err}`,
    loading: "Loading…",
    colTime: "Time",
    colProject: "Project",
    colTokens: "Tokens",
    colModel: "Model",
    cacheEfficiency: "Cache Efficiency",
    cacheSaved: "Saved",
    cacheReads: "Cache reads",
    cacheVsYesterday: (d) =>
      `${d > 0 ? "↑" : d < 0 ? "↓" : ""} ${Math.abs(d).toFixed(1)}% vs yesterday`,
    cacheLabel: (pct) => `cache ${pct}`,
  },
  sessions: {
    filterPlaceholder: "Filter project path…",
    showing: (filtered, total, period) =>
      `Showing ${filtered} of ${total} sessions (${period}).`,
    last30days: "last 30 days",
    noMatch: "No sessions match.",
    loadingsessions: "Loading sessions…",
    failedToLoad: (err) => `Failed to load sessions: ${err}`,
    colTime: "Time",
    colProject: "Project",
    colModel: "Model",
    colTokens: "Tokens",
    colSource: "Source",
    detailSessionId: "Session ID",
    detailProject: "Project",
    detailStarted: "Started",
  },
  settings: {
    dataFolder: "Data folder",
    dataFolderHint:
      "Notchi watches this directory recursively for *.jsonl writes.",
    apply: "Apply",
    applying: "Saving…",
    dataFolderUpdated: "Data folder updated.",
    claudeNotFound:
      "Claude Code not auto-detected. Paste the absolute path to your ~/.claude/projects folder above.",
    dataSources: "Data sources",
    dataSourcesHint:
      "AI tools Notchi has detected on this Mac. Each runs its own watcher and dedupes against the same SQLite cache.",
    noSourcesYet:
      "No data sources detected yet. Notchi auto-discovers Claude Code (~/.claude/projects) and Codex CLI (~/.codex/sessions) on launch.",
    eventsCount: (n) => `${n.toLocaleString()} events`,
    ingested: (time) => `ingested ${time}`,
    idle: "idle",
    quietHours: "Quiet hours",
    quietHoursHint:
      "Bubbles are suppressed during this window. macOS notifications are unaffected — adjust those independently in System Settings → Notifications.",
    from: "From",
    to: "To",
    save: "Save",
    quietHoursSaved: "Quiet hours saved.",
    dangerZone: "Danger zone",
    dangerZoneHint:
      "Wipes the local events table. Notchi will rebuild from existing jsonl files automatically.",
    clearAll: "Clear all data…",
    clearConfirm: "This will permanently delete the local SQLite cache.",
    cancel: "Cancel",
    yesClear: "Yes, clear everything",
    clearing: "Clearing…",
    cleared: "All data cleared.",
    about: "About",
    version: "Version",
    privacy: "Privacy",
    privacyValue: "Nothing leaves this Mac. No telemetry, no uploads, ever.",
    spec: "Spec",
    language: "Language",
    languageHint: "Switch the UI language. Takes effect immediately.",
  },
  pet: {
    fallbackBanner:
      "Live2D failed to load — currently rendering the static PNG fallback. Restart Notchi or check the console for details.",
    petSize: "Pet size",
    petSizeHint: "Large (240 px) or Small (120 px). Takes effect immediately.",
    large: "Large",
    small: "Small",
    petCharacter: "Pet character",
    petCharacterHint:
      "Switch takes effect immediately. All models are from Live2D official free assets.",
    notchLayout: "Notch layout",
    notchLayoutHint:
      "Apply on next launch. Auto-detect handles most Macs correctly.",
    targetDisplay: "Target display",
    targetDisplayHint:
      "Pick which screen Notchi docks onto. Defaults to the current main display.",
    mainDisplay: "Main (follow active display)",
    main: "main",
    notch: "notch",
    noDisplays: "No additional displays detected.",
  },
  l2: {
    noActivityToday: "No activity yet today",
  },
  period: {
    today: "Today",
    week: "Week",
    month: "Month",
    all: "All",
  },
};

export const zh: Strings = {
  app: {
    title: "Notchi",
    subtitle: "本地 AI 编程伴侣 · v0.1.0",
  },
  nav: {
    overview: "概览",
    sessions: "会话",
    pet: "宠物",
    settings: "设置",
  },
  notif: {
    denied:
      "⚠️ macOS 通知权限被拒。任务完成时不会发送系统通知（气泡仍工作）。",
    openSettings: "打开系统设置",
    dismiss: "关闭",
  },
  overview: {
    today: "今天",
    week: "近 7 天",
    month: "本月",
    tokens: "Token 用量",
    sessions: "会话数",
    topModel: "主力模型",
    cacheRead: "缓存读取",
    cacheWrite: "缓存写入",
    hourly: "每小时分布",
    daily7: "每日分布（7 天）",
    daily30: "每日分布（30 天）",
    byTool: "按工具",
    byModel: "按模型",
    byProject: "按项目",
    recentSessions: "最近会话",
    last: (n) => `最近 ${n} 条`,
    noDataToday: "今天暂无数据。",
    noDataWeek: "本周暂无数据。",
    noDataMonth: "本月暂无数据。",
    failedToLoad: (err) => `概览加载失败：${err}`,
    loading: "加载中…",
    colTime: "时间",
    colProject: "项目",
    colTokens: "Token",
    colModel: "模型",
    cacheEfficiency: "缓存效率",
    cacheSaved: "节省",
    cacheReads: "缓存读取量",
    cacheVsYesterday: (d) =>
      `${d > 0 ? "↑" : d < 0 ? "↓" : ""} ${Math.abs(d).toFixed(1)}% vs 昨天`,
    cacheLabel: (pct) => `缓存 ${pct}`,
  },
  sessions: {
    filterPlaceholder: "筛选项目路径…",
    showing: (filtered, total, period) =>
      `显示 ${filtered} / ${total} 条会话（${period}）。`,
    last30days: "近 30 天",
    noMatch: "没有匹配的会话。",
    loadingsessions: "加载会话中…",
    failedToLoad: (err) => `会话加载失败：${err}`,
    colTime: "时间",
    colProject: "项目",
    colModel: "模型",
    colTokens: "Token",
    colSource: "来源",
    detailSessionId: "会话 ID",
    detailProject: "项目",
    detailStarted: "开始时间",
  },
  settings: {
    dataFolder: "数据目录",
    dataFolderHint: "Notchi 会递归监听此目录下的 *.jsonl 文件写入。",
    apply: "应用",
    applying: "保存中…",
    dataFolderUpdated: "数据目录已更新。",
    claudeNotFound:
      "未自动检测到 Claude Code。请在上方粘贴 ~/.claude/projects 目录的绝对路径。",
    dataSources: "数据来源",
    dataSourcesHint:
      "Notchi 在本机检测到的 AI 工具。每个来源独立运行监听器，并在同一 SQLite 缓存中去重。",
    noSourcesYet:
      "暂未检测到数据来源。Notchi 启动时会自动发现 Claude Code（~/.claude/projects）和 Codex CLI（~/.codex/sessions）。",
    eventsCount: (n) => `${n.toLocaleString()} 条事件`,
    ingested: (time) => `已采集 ${time}`,
    idle: "空闲",
    quietHours: "免打扰时段",
    quietHoursHint:
      "此时段内气泡将被抑制。macOS 通知不受影响——请在系统设置 → 通知中单独调整。",
    from: "从",
    to: "到",
    save: "保存",
    quietHoursSaved: "免打扰时段已保存。",
    dangerZone: "危险操作",
    dangerZoneHint: "清空本地事件表。Notchi 会自动从现有 jsonl 文件重建。",
    clearAll: "清除所有数据…",
    clearConfirm: "此操作将永久删除本地 SQLite 缓存。",
    cancel: "取消",
    yesClear: "确认清除",
    clearing: "清除中…",
    cleared: "所有数据已清除。",
    about: "关于",
    version: "版本",
    privacy: "隐私",
    privacyValue: "数据不离开本机，无遥测，无上传。",
    spec: "规范文档",
    language: "语言",
    languageHint: "切换界面语言，立即生效。",
  },
  pet: {
    fallbackBanner:
      "Live2D 加载失败——当前显示静态 PNG 降级图。重启 Notchi 或查看控制台以了解详情。",
    petSize: "宠物尺寸",
    petSizeHint: "大（240 px）或小（120 px），立即生效。",
    large: "大",
    small: "小",
    petCharacter: "宠物角色",
    petCharacterHint: "切换立即生效。所有模型均来自 Live2D 官方免费素材。",
    notchLayout: "刘海模式",
    notchLayoutHint: "下次启动时生效。自动检测适用于大多数 Mac。",
    targetDisplay: "目标显示器",
    targetDisplayHint: "选择 Notchi 停靠的屏幕，默认跟随主显示器。",
    mainDisplay: "主显示器（跟随当前主屏）",
    main: "主屏",
    notch: "刘海",
    noDisplays: "未检测到其他显示器。",
  },
  l2: {
    noActivityToday: "今日暂无活动",
  },
  period: {
    today: "今天",
    week: "本周",
    month: "本月",
    all: "全部",
  },
};

export const locales: Record<Locale, Strings> = { en, zh };
