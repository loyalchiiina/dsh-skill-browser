// dsh-skill-browser - category metadata for the skill library panel.
// 简介数据源：每个技能各自 SKILL.md frontmatter 的 description（插件不内置
// 任何技能名清单/字典——既避免泄漏作者技能库构成，也保证所有人看到的都是
// 自己技能库的准确描述）。
// 分类规则为「目录名前缀」的通用模式匹配，不含任何具体技能名枚举。

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
