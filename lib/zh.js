// dsh-skill-browser - category metadata for the skill library panel.
// 简介数据源：每个技能各自 SKILL.md frontmatter 的 description（插件不内置
// 任何技能名清单/字典——既避免泄漏作者技能库构成，也保证所有人看到的都是
// 自己技能库的准确描述）。
// 分类规则为「目录名前缀」的通用模式匹配，不含任何具体技能名枚举。
// v1.7.1/1.7.2 rebuild (2026-09-12)：新增 UI_TEXT —— 通过 /skills 顶层 ui
// 字段下发，客户端 T()/TF() 优先取用；键名与 client.js 内置 UI_FALLBACK
// 完全一致（老宿主/老版本走客户端兜底）。

export var ZH = {};

// 一级分类（界面标签，按 CAT_RULES 命中顺序展示）。
export var CATS = [
  {
    id: "fluent", label: "Fluent/CFD 仿真", icon: "🌀",
    subs: [
      { id: "router", label: "入口/路由/知识库" },
      { id: "rules", label: "铁律/纪律" },
      { id: "workflow", label: "总流程" },
      { id: "mesh", label: "网格划分" },
      { id: "geometry", label: "模型处理/几何" },
      { id: "solver", label: "求解处理" },
      { id: "monitor", label: "监控/进程" },
      { id: "fault", label: "故障/诊断" },
      { id: "files", label: "文件整理" },
      { id: "post", label: "后处理" },
      { id: "data", label: "数据/通用" }
    ]
  },
  { id: "dsh", label: "DSH 工具链", icon: "🛠️" },
  { id: "agent", label: "多端协同", icon: "🤖" },
  { id: "excel", label: "Excel/表格", icon: "📊" },
  { id: "doc", label: "文档处理", icon: "📄" },
  { id: "image", label: "图片/视觉", icon: "🖼️" },
  { id: "media", label: "语音/媒体", icon: "🎬" },
  { id: "data", label: "数据/可视化", icon: "📈" },
  { id: "dev", label: "开发/技能治理", icon: "🧑‍💻" },
  { id: "design", label: "设计/UX", icon: "🎨" },
  { id: "research", label: "搜索/研究/写作", icon: "🔍" },
  { id: "system", label: "系统/Windows", icon: "🖥️" },
  { id: "output", label: "输出/执行治理", icon: "📏" },
  { id: "fun", label: "生活/娱乐", icon: "🎈" },
  { id: "other", label: "其他", icon: "📦" }
];

// 二级分类规则（仅对命中所属一级分类的目录名再匹配，顺序即优先级）。
// 全部为「功能词前缀」模式，不含具体技能名。
export var SUB_RULES = {
  fluent: [
    { id: "router", re: /^fluent-(control-laws|quick-reference|cfd|doc-query)/ },
    { id: "mesh", re: /^fluent-meshing-|^geometry-/ },
    { id: "geometry", re: /^geometry-|^spaceclaim-|^model-/ },
    { id: "workflow", re: /^fluent-(muti-|workflow-|case-workflow-)/ },
    { id: "files", re: /^fluent-(file-|case-|junk-|mesh-packaging|backup)/ },
    { id: "solver", re: /^fluent-(setfile-|initialization|discretization-|precompute-|monitor-report|mrf-|aeration-|pbm-calculation|pbm-export|session-connect|gui-open|run-continuity|torque-)/ },
    { id: "post", re: /^fluent-(contour-|xyplot-|line-surface-|postprocess-|liquid-surface-|shear-|data-postprocess-|animation-)|^pbm-data-/ },
    { id: "monitor", re: /^fluent-(operation-monitor|run-health-check|midrun-save|detached-|process-|iter-monitor-)/ },
    { id: "fault", re: /^fluent-(run-failure-|divergence-|path-check|path-index-|prev-run-)/ },
    { id: "data", re: /^torque-|^impeller-|^pbm-/ },
    { id: "rules", re: /^fluent-/ }
  ],
  dsh: [
    { id: "cfg", re: /^dsh-(desktop-|rollback|backup|quick-reference)/ },
    { id: "dev", re: /^dsh-(plugin-|skill-)/ },
    { id: "remote", re: /^dsh-(mobile-|message-|web-|push)/ },
    { id: "board", re: /^dsh-taskboard-/ }
  ]
};

// 一级分类规则（子分类之前的初筛），同样为纯前缀/通用词模式。
// 单词型技能名用 (-|$) 兼容「连字符前缀」与「完整单词」两种目录名。
export var CAT_RULES = [
  { id: "fluent", re: /^(fluent|ansys|cfd|mesh|geometry|spaceclaim|stirrer|impeller|pbm|torque)(-|$)/ },
  { id: "dsh", re: /^dsh(-|$)/ },
  { id: "agent", re: /^(acp|subagent)(-|$)/ },
  { id: "excel", re: /^(excel|xlsx)(-|$)/ },
  { id: "doc", re: /^(docx|pdf|pptx|markdown|mermaid|patent)(-|$)/ },
  { id: "image", re: /^(image|picture|photo|wallpaper|canvas|drawing|diagram)(-|$)/ },
  { id: "media", re: /^(voice|tts|video|audio|music|film|movie|media|subtitle)(-|$)/ },
  { id: "data", re: /^(analyze|explore-data|create-viz|build-dashboard|data-visualization|statistical|validate-data|sql|write-query)(-|$)/ },
  { id: "dev", re: /^(github|git|playwright|remotion|develop|frontend|code-explanation|skill|create-plan|export)(-|$)/ },
  { id: "design", re: /^(design|ux|accessibility|style)(-|$)/ },
  { id: "research", re: /^(web-search|trending|technology-news|research|article|content-planner|user-research|imap|smtp|youdaonote)(-|$)/ },
  { id: "system", re: /^(windows|printer|desktop|delete|recycle|cleanup|archive|download|browser|computer|file-path|powershell|local-tools|baidu)(-|$)/ },
  { id: "output", re: /^(concise|caveman|token|new-topic|todo|goal|task-parallel|j-space|conversation-context|chinese-response)(-|$)/ },
  { id: "fun", re: /^(weather|hatch|pet)(-|$)/ }
];

// ── v1.7.1/1.7.2 面板 UI 文案（/skills 顶层 ui 下发）────────────────
// 键名与 client.js UI_FALLBACK 完全一致；占位符 {name}/{n}/{x}/{y}/{err}
// 由客户端 TF() 替换，服务端原样下发模板。
export var UI_TEXT = {
  // v1.7.0 排序/徽章/批量确认（老键保留）
  sortByName: "按名称",
  sortByMtime: "按修改时间",
  sortToggleTitle: "切换排序方式（名称 ↔ 修改时间降序）",
  mtimeLabel: "修改于",
  disabledBadge: "已停用",
  cardDisabledTitle: "已停用（模型技能目录中已摘除）· 点击卡片查看全文",
  toggleEnableTip: "启用后技能恢复进模型技能目录",
  toggleDisableTip: "停用后技能从模型技能目录摘除（SKILL.md 会先自动备份）",
  batchEnable: "全启用",
  batchDisable: "全停用",
  batchBtnTitle: "对该分类下全部技能执行启用/停用",
  batchConfirmDisable: "确定停用该分类下全部技能？（每个 SKILL.md 都会先自动备份，可再次全启用恢复）",
  batchConfirmEnable: "确定启用该分类下全部技能？",
  toggling: "执行中…",
  toggleFailPrefix: "失败",
  toggleDoneSuffix: "完成",
  toggleEnable: "启用",
  toggleDisable: "停用",
  disabledCountSuffix: "项已停用",
  // ── v1.7.1 排序四态 / 滑动开关 / toast ──
  sortNameAsc: "名称↑",
  sortNameDesc: "名称↓",
  sortMtimeDesc: "时间↓",
  sortMtimeAsc: "时间↑",
  sortCycleTitle: "排序（点击循环）：名称↑ → 名称↓ → 时间↓（最新在前）→ 时间↑（最旧在前）",
  switchOnText: "开",
  switchOffText: "关",
  toastDisabled: "已停用 {name}",
  toastEnabled: "已启用 {name}",
  toastBatchDisabled: "已停用 {n} 项",
  toastBatchEnabled: "已启用 {n} 项",
  toastBatchPartial: "成功 {x} 项，失败 {y} 项",
  toastToggleFail: "操作失败：{err}",
  processingText: "处理中…",
  // ── v1.7.2 三级滑块开关（全局总开关 / 分类聚合滑块 / 确认菜单）──
  aggAllLabel: "全部技能",
  aggMixedTitle: "部分停用（已停用 {x}/{y}）· 点击选择批量启停",
  aggAllOnTitle: "全部启用 · 点击选择批量启停",
  aggAllOffTitle: "全部停用 · 点击选择批量启停",
  aggEnableN: "全部启用 ({n} 项)",
  aggDisableN: "全部停用 ({n} 项)",
  aggDangerText: "将停用全部 {n} 项技能，新会话将不可用这些技能",
  aggMenuTitleGlobal: "全局批量启停 — 作用于技能库全部技能",
  aggMenuTitleCat: "分类批量启停 — 仅作用于当前分类",
  aggMenuStat: "{scope} · 共 {n} 项 · 已停用 {x} 项",
  aggCatStat: "停用 {x}/{y}",
  aggCancelText: "取消"
};
