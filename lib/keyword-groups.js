// ── v1.9.7: 关键词快速分组（零 token、毫秒级）────────────────────────
// 用户反馈 AI 分组「太满」而且慢。本模块用**技能目录名的关键词正则**直接切
// 「大类 → 子类」两级方案，不调用任何模型：
//   · 零 token、零网络，110+ 技能 < 5ms 出方案
//   · 结果完全确定，同样的技能库永远得到同样的分组
//   · 规则写死可审计，随时能按用户口味加一行
//   · 每个子类硬上限 8 项，避免"一屏塞满"
//
// 规则表 RULES 是**有序**的：从上往下第一条命中即生效（first-match-wins）。
// 所以「具体」的规则必须排在「笼统」的规则之前。
//
// 输出结构与 groups.js 的 aiClassify() 完全一致，前端复用同一个方案弹层：
//   { ok, plan:{ domains:[ { name, emoji, subs:[ { name, emoji, skills:[dir] } ] } ] },
//     stats:{ skills, domains, subs, covered }, mode:"keyword", unmatched:[] }

var MAX_SUB = 8;

var DOMAINS = [
  { key: "fluent", name: "Fluent/CFD 仿真", emoji: "🌀" },
  { key: "dsh", name: "DSH 工具链", emoji: "🛠️" },
  { key: "skill", name: "技能库治理", emoji: "🧠" },
  { key: "agent", name: "多智能体与长任务", emoji: "🤝" },
  { key: "gateway", name: "网关与反代", emoji: "🌐" },
  { key: "install", name: "软件安装与下载", emoji: "💾" },
  { key: "system", name: "系统与文件", emoji: "🖥️" },
  { key: "dev", name: "开发与发布", emoji: "⌨️" },
  { key: "doc", name: "文档与邮件", emoji: "📄" },
  { key: "image", name: "图片与视觉", emoji: "🖼️" },
  { key: "life", name: "网盘与生活", emoji: "🎨" }
];

var RULES = [
  // ── Fluent / CFD（16 条，按用途切细，每子类 ≤8）────────────────
  { dom: "fluent", sub: "SpaceClaim 几何操作", emoji: "📐", re: /^spaceclaim-/ },
  { dom: "fluent", sub: "几何参数与模型", emoji: "📏",
    re: /^(geometry-|fluent-debug-tank|fluent-domain-count|fluent-update-regions|ansys-local-workflows)/ },
  { dom: "fluent", sub: "画网格", emoji: "🕸️", re: /^fluent-mesh/ },
  { dom: "fluent", sub: "求解设置与初始化", emoji: "⚙️",
    re: /^(fluent-setfile-|fluent-initialization|fluent-discretization-|fluent-precompute-|fluent-run-continuity|fluent-session-connect|fluent-gui-open)/ },
  { dom: "fluent", sub: "物理模型与扭矩", emoji: "🌀",
    re: /^(fluent-mrf-|fluent-aeration-|fluent-pbm-|fluent-torque-|impeller-circulation|torque-power-)/ },
  { dom: "fluent", sub: "后处理·云图与矢量", emoji: "🌈",
    re: /^(fluent-contour-|fluent-line-surface-|fluent-liquid-surface-|fluent-shear-|fluent-animation-)/ },
  { dom: "fluent", sub: "后处理·xyplot 曲线", emoji: "📈", re: /^fluent-xyplot-/ },
  { dom: "fluent", sub: "后处理·整理与对比", emoji: "📊",
    re: /^(fluent-postprocess-|fluent-data-postprocess-|pbm-data-)/ },
  { dom: "fluent", sub: "运行监控与进程", emoji: "📡",
    re: /^(fluent-operation-monitor|fluent-run-health-check|fluent-midrun-save|fluent-detached-|fluent-process-|fluent-iter-monitor|fluent-monitor-report)/ },
  { dom: "fluent", sub: "故障排查", emoji: "🔍",
    re: /^(fluent-run-failure-|fluent-divergence-|fluent-path-check|fluent-path-index-repair|fluent-prev-run-vdisplay)/ },
  { dom: "fluent", sub: "主线与铁律", emoji: "🧭",
    re: /^(fluent-universal-mainline|fluent-control-laws|fluent-quick-reference|fluent-cfd$)/ },
  { dom: "fluent", sub: "查证与经验", emoji: "📚",
    re: /^(fluent-doc-query|fluent-experience|fluent-first-reference|fluent-growth-loop|fluent-experiment-first)/ },
  { dom: "fluent", sub: "步骤与产物规范", emoji: "📝",
    re: /^(fluent-artifact-path|fluent-case-save-discipline|fluent-step-plan|fluent-simulation-template|fluent-subagent-parallel)/ },
  { dom: "fluent", sub: "多工况流程", emoji: "🔁",
    re: /^(fluent-muti-|fluent-workflow-change|fluent-case-workflow-)/ },
  { dom: "fluent", sub: "文件与备份", emoji: "🗂️",
    re: /^(fluent-case-|fluent-file-|fluent-junk-cleanup)/ },
  { dom: "fluent", sub: "主线与铁律", emoji: "🧭", re: /^fluent-/ },

  // ── DSH 工具链 ──────────────────────────────────────────────────
  { dom: "dsh", sub: "全局配置", emoji: "⚙️", re: /^dsh-config$/ },
  { dom: "dsh", sub: "启动与恢复", emoji: "🚑", re: /^dsh-recovery$/ },
  { dom: "dsh", sub: "插件发布与同步", emoji: "🚀", re: /^dsh-plugin-publish-/ },
  { dom: "dsh", sub: "插件版本巡检", emoji: "📦", re: /^dsh-plugin-update-/ },
  { dom: "dsh", sub: "插件开发", emoji: "🧩", re: /^dsh-plugin-/ },
  { dom: "dsh", sub: "插件发现与安装", emoji: "🔌", re: /^(find-plugins|dsh-market)/ },
  { dom: "dsh", sub: "全局配置", emoji: "⚙️", re: /^dsh-/ },

  // ── 技能库治理 ──────────────────────────────────────────────────
  { dom: "skill", sub: "技能库治理", emoji: "🧠", re: /^skill-/ },

  // ── 多智能体与长任务 ────────────────────────────────────────────
  { dom: "agent", sub: "团队与预设", emoji: "🤝", re: /^(agent-team-|agent-preset-)/ },
  { dom: "agent", sub: "长任务与并行", emoji: "🎯", re: /^(goal-auto-continuation|task-parallel-)/ },

  // ── 网关与反代 ──────────────────────────────────────────────────
  { dom: "gateway", sub: "接入与额度", emoji: "🌐",
    re: /^(reverse-proxy-|agent2api-|lobsterai-)/ },

  // ── 软件安装与下载 ──────────────────────────────────────────────
  { dom: "install", sub: "软件安装配置", emoji: "💾", re: /^software-install-/ },
  { dom: "install", sub: "镜像与下载", emoji: "⬇️", re: /^download-mirror-/ },

  // ── 系统与文件 ──────────────────────────────────────────────────
  { dom: "system", sub: "删除与文件卫生", emoji: "🧹", re: /^(delete-to-recyclebin-|desktop-file-hygiene-)/ },
  { dom: "system", sub: "Windows 排障", emoji: "🖥️", re: /^(windows-toolkit|diagnose-windows)/ },

  // ── 开发与发布 ──────────────────────────────────────────────────
  { dom: "dev", sub: "GitHub 发布", emoji: "🚀", re: /^github-publish/ },
  { dom: "dev", sub: "浏览器自动化", emoji: "🎭", re: /^playwright/ },
  { dom: "dev", sub: "前端与设计", emoji: "🎨", re: /^(frontend-design|design$)/ },

  // ── 文档与邮件 ──────────────────────────────────────────────────
  { dom: "doc", sub: "文档处理", emoji: "📄", re: /^(document-toolkit|office)/ },
  { dom: "doc", sub: "批量邮件", emoji: "✉️", re: /^mail-bulk-/ },

  // ── 图片与视觉 ──────────────────────────────────────────────────
  { dom: "image", sub: "电子印章", emoji: "🔖", re: /^image-electronic-seal/ },
  { dom: "image", sub: "壁纸与相册", emoji: "🖼️", re: /^(wallpaper-|image-gallery)/ },
  { dom: "image", sub: "本地出图", emoji: "🎨", re: /^qwen21-/ },

  // ── 网盘与生活 ──────────────────────────────────────────────────
  { dom: "life", sub: "网盘", emoji: "☁️", re: /^(quarkclouddrive|baidu)/ },
  { dom: "life", sub: "生活杂项", emoji: "🎈", re: /^(misc-lowfreq-|maoxt-|weather)/ }
];

// 兜底：上面全没命中的技能，按 scan.js 的 cat 归入对应大类，子类名「未归类」。
var CAT_FALLBACK = {
  fluent: { dom: "fluent", sub: "主线与铁律", emoji: "🧭" },
  dsh: { dom: "dsh", sub: "全局配置", emoji: "⚙️" },
  dev: { dom: "dev", sub: "前端与设计", emoji: "🎨" },
  system: { dom: "system", sub: "Windows 排障", emoji: "🖥️" },
  image: { dom: "image", sub: "壁纸与相册", emoji: "🖼️" },
  output: { dom: "agent", sub: "长任务与并行", emoji: "🎯" }
};

function domMeta(key) {
  for (var i = 0; i < DOMAINS.length; i++) if (DOMAINS[i].key === key) return DOMAINS[i];
  return { key: "other", name: "其他技能", emoji: "📦" };
}

function matchRule(dir) {
  for (var i = 0; i < RULES.length; i++) if (RULES[i].re.test(dir)) return RULES[i];
  return null;
}

// 一个子类超过 MAX_SUB 时，拆成「名称 1」「名称 2」…，保证一屏不满。
function splitSub(name, emoji, dirs) {
  var out = [];
  if (dirs.length <= MAX_SUB) { out.push({ name: name, emoji: emoji, skills: dirs }); return out; }
  var part = 1;
  for (var i = 0; i < dirs.length; i += MAX_SUB) {
    out.push({
      name: name + " " + part,
      emoji: emoji,
      skills: dirs.slice(i, i + MAX_SUB)
    });
    part++;
  }
  return out;
}

// 纯函数：给一组 {dir, cat, ...} 技能，返回两级分组方案。
// 不读盘、不写盘、不联网 —— 调用方拿 plan 去走既有的 applyPlan()。
export function keywordClassify(skills) {
  var list = Array.isArray(skills) ? skills : [];
  var byDom = {};
  var unmatched = [];

  for (var i = 0; i < list.length; i++) {
    var s = list[i] || {};
    var dir = String(s.dir || "").trim();
    if (!dir) continue;
    var rule = matchRule(dir);
    if (!rule) {
      var fb = CAT_FALLBACK[String(s.cat || "")] || { dom: "life", sub: "未归类", emoji: "📦" };
      rule = { dom: fb.dom, sub: "未归类", emoji: "📦" };
      unmatched.push(dir);
    }
    if (!byDom[rule.dom]) byDom[rule.dom] = { subs: {}, order: [] };
    var d = byDom[rule.dom];
    if (!d.subs[rule.sub]) { d.subs[rule.sub] = { emoji: rule.emoji || "📁", dirs: [] }; d.order.push(rule.sub); }
    d.subs[rule.sub].dirs.push(dir);
  }

  var domains = [];
  for (var m = 0; m < DOMAINS.length; m++) {
    var key = DOMAINS[m].key;
    if (!byDom[key]) continue;
    var g = byDom[key];
    var subs = [];
    for (var t = 0; t < g.order.length; t++) {
      var sb = g.subs[g.order[t]];
      var parts = splitSub(g.order[t], sb.emoji, sb.dirs);
      for (var p = 0; p < parts.length; p++) subs.push(parts[p]);
    }
    if (subs.length) domains.push({ name: DOMAINS[m].name, emoji: DOMAINS[m].emoji, subs: subs });
  }

  var subCount = 0, covered = 0;
  for (var a = 0; a < domains.length; a++) {
    subCount += domains[a].subs.length;
    for (var b = 0; b < domains[a].subs.length; b++) covered += domains[a].subs[b].skills.length;
  }

  return {
    ok: true,
    plan: { domains: domains },
    stats: { skills: covered, domains: domains.length, subs: subCount, covered: covered },
    mode: "keyword",
    unmatched: unmatched
  };
}

export function keywordDomains() { return DOMAINS; }
export function keywordRules() { return RULES; }
export var KEYWORD_MAX_SUB = MAX_SUB;
