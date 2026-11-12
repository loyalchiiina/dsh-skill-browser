// dsh-skill-browser - MCP 市场子模块（宿主端，v2.0.6）
//
// 数据源：官方 MCP Registry（https://registry.modelcontextprotocol.io/v0/servers）
//   - 分页拉取，limit 上限 100（超出会 422），最多 30 页（契约：拉全量直到 nextCursor 为 null 或 30 页）
//   - 返回原始 servers[] 数组（每项是外层 {server:{...}} 对象），原样返回不作加工
//   - Registry 没有 category / tags / price 字段 → 分类与「免费」标注全部自算
//
// 磁盘缓存：~/.dsh/data/dsh-skill-browser/market.json，有效期 24 小时，
//   缓存里直接存「算好的最终 market 返回体」，避免每次都重拉重算分类。
//   网络失败且有旧缓存 → 用旧缓存并标 stale:true + warn；两者皆无 → 只回精选 + stale:true + warn。
//
// 零 npm 依赖：只用 Node 内置模块 + 全局 fetch（Node 18+，宿主 Node 均满足）。
//   所有注释与面向用户文案一律中文（简体），代码标识符英文。

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "url";
import { homedir, tmpdir } from "node:os";
// 子模块版本传播：宿主热重载时 index.js 以 ?v=<ts> 重新导入本文件，
// import.meta.url 上带同一 query，必须原样传给子模块，否则会命中 ESM registry
// 里启动时缓存的旧实例（旧 mcp.js 没有 dataDir 导出 → 链接期 SyntaxError → 热重载静默失败）。
var RELOAD_V = new URL(import.meta.url).search || "";
var mcpMod = await import("./mcp.js" + RELOAD_V);
var dataDir = mcpMod.dataDir;

// ─────────────────────────── 常量 ───────────────────────────

var REGISTRY_BASE = "https://registry.modelcontextprotocol.io/v0/servers";
var PAGE_LIMIT = 100;
var MAX_PAGES = 30;
var FETCH_TIMEOUT_MS = 20000;
var CACHE_TTL_MS = 24 * 3600 * 1000;

// 通用性铁律：不写死开发者本机路径。
// node 用当前宿主进程可执行文件；npx-cli 从 node 同目录推导；
// uvx 按 uv 官方默认安装位置（%USERPROFILE%\.local\bin）与 LOCALAPPDATA 探测，最后退化为 PATH 上的 uvx。
var DEFAULT_NODE_EXE = process.execPath || "";
var DEFAULT_NPX_CLI = "";
var DEFAULT_UVX = (function () {
  var home = process.env.USERPROFILE || process.env.HOME || "";
  return home ? join(home, ".local", "bin", "uvx.exe") : "";
})();

// ─────────────────────────── 19 大类定义（契约严格指定 id/label/icon） ───────────────────────────
// 每条挂一组分类关键词（中英都覆盖）；打分 = 命中词长，长词优先，
// 避免「web / 其他」这类宽词把别的类吃掉。

export var MARKET_CATS = [
  { id: "filesystem", label: "文件系统", icon: "📁",
    keywords: ["filesystem", "file system", "file manager", "directory", "folder", "文件系统", "文件系统访问", "文件", "目录", "文件夹"] },
  { id: "database", label: "数据库", icon: "🗄️",
    keywords: ["postgres", "postgresql", "mysql", "sqlite", "duckdb", "mongodb", "redis", "surreal", "kafka", "trino", "clickhouse", "timescale", "database", "sql", "数据仓库", "数据库", "数据存储", "查询语言", "graphql 数据"] },
  { id: "devtools", label: "开发工具", icon: "🛠️",
    keywords: ["developer tools", "completion", "compiler", "linter", "debugger", "code completion", "autocomplete", "ide", "sdk", "api client", "doxygen", "gitignore", "开发工具", "代码补全", "编译", "调试", "接口调试"] },
  { id: "web", label: "网页与搜索", icon: "🌐",
    keywords: ["web search", "search engine", "crawler", "scraper", "crawl", "scrape", "fetch", "rss", "url", "http request", "web scraping", "网页搜索", "搜索引擎", "抓取", "爬取", "网页"] },
  { id: "browser", label: "浏览器自动化", icon: "🎭",
    keywords: ["browser", "chrome", "chromium", "playwright", "puppeteer", "selenium", "webdriver", "browser automation", "浏览器自动化", "浏览器", "无头浏览器"] },
  { id: "git", label: "代码仓库", icon: "🔗",
    keywords: ["github", "gitlab", "bitbucket", "git repository", "pull request", "commit", "gitee", "代码仓库", "版本控制", "仓库", "git"] },
  { id: "docs", label: "文档与办公", icon: "📄",
    keywords: ["document", "pdf", "word", "excel", "spreadsheet", "notion", "confluence", "office", "workspace", "presentation", "docs", "文档", "办公", "表格", "演示文稿", "电子表格", "pdf 处理"] },
  { id: "cloud", label: "云服务与部署", icon: "☁️",
    keywords: ["kubernetes", "aws", "azure", "google cloud", "gcp", "docker", "terraform", "deploy", "cloudflare", "serverless", "lambda", "s3", "云服务", "云计算", "部署", "容器", "Kubernetes"] },
  { id: "comms", label: "通信与邮件", icon: "💬",
    keywords: ["send email", "smtp", "slack", "discord", "telegram", "whatsapp", "wechat", "message", "imap", "outlook", "gsuite", "通信", "邮件", "发送邮件", "短信", "聊天", "消息"] },
  { id: "media", label: "图像与多媒体", icon: "🎨",
    keywords: ["image", "video", "audio", "music", "ffmpeg", "screenshot", "photo", "media", "图像", "图片", "视频", "音频", "音乐", "截图", "多媒体"] },
  { id: "memory", label: "知识与记忆", icon: "🧠",
    keywords: ["memory", "knowledge", "knowledge base", "knowledge graph", "semantic", "vector", "embeddings", "rag", "知识库", "知识图谱", "记忆", "向量", "语义", "知识管理"] },
  { id: "automation", label: "任务与自动化", icon: "⚙️",
    keywords: ["automation", "workflow", "scheduler", "cron", "task", "orchestration", "zapier", "n8n", "自动化", "工作流", "定时任务", "任务编排", "schedule"] },
  { id: "ai", label: "AI 与智能体", icon: "🤖",
    keywords: ["artificial intelligence", "large language", "llm", "openai", "anthropic", "claude", "gpt", "agent", "inference", "model serving", "人工智能", "大模型", "智能体", "对话", "推理", "llm"] },
  { id: "finance", label: "金融与交易", icon: "💰",
    keywords: ["finance", "payment", "bank", "invoice", "crypto", "bitcoin", "stock", "trading", "stripe", "paypal", "金融", "支付", "银行", "发票", "股票", "交易", "加密货币"] },
  { id: "geo", label: "地理与地图", icon: "🗺️",
    keywords: ["geography", "geospatial", "map", "gps", "location", "gis", "coordinates", "地理", "地图", "定位", "坐标", "空间数据"] },
  { id: "education", label: "教育与学习", icon: "🎓",
    keywords: ["education", "learning", "teaching", "course", "lesson", "quiz", "flashcard", "education", "教育", "学习", "课程", "教学", "辅导", "卡片"] },
  { id: "ops", label: "运维与监控", icon: "📙",
    keywords: ["monitoring", "observability", "metrics", "logging", "alert", "prometheus", "grafana", "uptime", "运维", "监控", "日志", "告警", "指标", "可观测性"] },
  { id: "security", label: "安全与身份", icon: "🔐",
    keywords: ["security", "authentication", "authorization", "vault", "password", "token", "identity", "oauth", "安全", "身份", "认证", "授权", "密码", "密钥", "access control"] },
  { id: "other", label: "其他", icon: "📦",
    keywords: [] }
];

// ─────────────────────────── Windows 运行时探测 ───────────────────────────
// dsh-mcp-client 的 stdio 用 spawn 不经 shell → npx(.cmd) 在 Windows 会失败，
// 必须用 node.exe + npx-cli.js。此处运行时探测候选路径，探测不到退回裸命令并在 warn 里说明。

var _npxCache = null;
var _uvxCache = null;

export function probeNodeNpx() {
  if (_npxCache) return _npxCache;
  var node = "";
  var npx = "";
  var nodeCandidates = [DEFAULT_NODE_EXE, process.execPath];
  for (var i = 0; i < nodeCandidates.length; i++) {
    var nc = nodeCandidates[i];
    if (nc && existsSync(nc)) { node = nc; break; }
  }
  if (!node && process.execPath) node = process.execPath;
  var dir = node ? dirname(node) : "";
  var npxCandidates = [];
  if (dir) npxCandidates.push(join(dir, "node_modules", "npm", "bin", "npx-cli.js"));
  // 兼容 nodejs 目录安装（npx-cli 往往就在 npm 包同目录下的 bin）
  npxCandidates.push(DEFAULT_NPX_CLI);
  for (var j = 0; j < npxCandidates.length; j++) {
    var ncj = npxCandidates[j];
    try { if (ncj && existsSync(ncj)) { npx = ncj; break; } } catch (e) { }
  }
  var warn = "";
  if (!node) { node = "node"; warn = "未探测到 node.exe，将用裸 node 命令"; }
  if (!npx) {
    npx = "";
    warn = (warn ? warn + "；" : "") + "未探测到 npx-cli.js，npm 包安装可能失败（Windows 下不能直接用 npx）";
  }
  _npxCache = { command: node, npx: npx, warn: warn };
  return _npxCache;
}

export function probeUvx() {
  if (_uvxCache) return _uvxCache;
  var candidates = [DEFAULT_UVX];
  try {
    var lap = process.env.LOCALAPPDATA;
    if (lap) candidates.push(join(lap, "Programs", "uv", "uvx.exe"));
  } catch (e) { }
  var cmd = "";
  var warn = "";
  for (var i = 0; i < candidates.length; i++) {
    try { if (candidates[i] && existsSync(candidates[i])) { cmd = candidates[i]; break; } } catch (e) { }
  }
  if (!cmd) { cmd = "uvx"; warn = "未探测到 uvx.exe，pypi 包安装可能失败"; }
  _uvxCache = { command: cmd, warn: warn };
  return _uvxCache;
}

// ─────────────────────────── 工具函数 ───────────────────────────

function slugify(name) {
  var s = String(name || "").toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "x";
}

function normalizeServerName(name) {
  var s = String(name || "");
  return /^[a-zA-Z0-9_-]{1,32}$/.test(s) ? s : null;
}

function truncate(s, n) {
  var t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

// YAML 安全引号：值含 : # { } 或首尾空格或为空时用单引号包裹，并把内部单引号转义为 ''
function yamlStr(v) {
  var s = String(v == null ? "" : v);
  if (s === "") return "''";
  var needs = /[:#{}\[\],&*!|>'"%@`]/.test(s) || /^\s|\s$/.test(s) || s !== String(s).trim();
  if (/^[0-9]+$/.test(s) || /^(true|false|null|yes|no|on|off)$/i.test(s)) needs = true; // 数字/布尔仍需引号防止被当标量
  if (needs) {
    return "'" + s.replace(/'/g, "''") + "'";
  }
  return s;
}

// ─────────────────────────── 分类 ───────────────────────────

export function classify(text) {
  var joined = String(text || "").toLowerCase();
  var bestIdx = MARKET_CATS.length - 1; // 默认 other
  var bestScore = 0;
  for (var i = 0; i < MARKET_CATS.length - 1; i++) {
    var cat = MARKET_CATS[i];
    var score = 0;
    for (var k = 0; k < cat.keywords.length; k++) {
      var kw = cat.keywords[k];
      if (!kw) continue;
      if (joined.indexOf(kw) >= 0) score += kw.length;
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  var c = MARKET_CATS[bestIdx];
  return { category: c.id, categoryLabel: c.label, categoryIcon: c.icon };
}

// ─────────────────────────── 拉取官方 Registry（分页直到 nextCursor 为 null 或 30 页） ───────────────────────────

function httpFetchJson(url) {
  return new Promise(function (resolve, reject) {
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, FETCH_TIMEOUT_MS);
    function cleanup() { if (timer) { clearTimeout(timer); timer = null; } }
    fetch(url, { signal: ac.signal })
      .then(function (res) {
        cleanup();
        if (!res.ok) { reject(new Error("HTTP " + res.status)); return null; }
        return res.json();
      })
      .then(function (js) {
        if (js != null) resolve(js);
      }, function (e) {
        cleanup();
        reject(e);
      });
  });
}

// 返回原始 servers[] 数组（每项是外层 {server:{...}} 对象），原样返回
export async function fetchRegistry(opts) {
  opts = opts || {};
  var maxPages = opts.maxPages || MAX_PAGES;
  var cursor = null;
  var out = [];
  var base = opts.base || REGISTRY_BASE;
  for (var p = 0; p < maxPages; p++) {
    var url = base + "?limit=" + PAGE_LIMIT + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    var js = await httpFetchJson(url);
    var list = (js && js.servers) || [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    var meta = (js && js.metadata) || {};
    var next = meta.nextCursor;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return out;
}

// ─────────────────────────── registry → 市场条目 ───────────────────────────

function registryToEntry(raw) {
  var s = (raw && raw.server) ? raw.server : raw;
  if (!s) return null;
  // serverName 取值优先级：① 首个包里合法的 npm/pypi 包名 identifier（如 @modelcontextprotocol/server-memory）
  // ② 原始 server.name 若合规；③ 否则转成安全的 kebab slug。
  // 注：registry 顶层 server.name 往往是 `ac.inference.sh/mcp` 这类服务 slug，
  // 绝大多数不含 ^[a-zA-Z0-9_-]{1,32}$，故不可直接当 serverName，需回退到包名/slug。
  var pkgs = (s.packages || []).filter(function (p) { return p; });
  var remotes = (s.remotes || []).filter(function (r) { return r; });
  var ident = pkgs.length && pkgs[0].identifier ? String(pkgs[0].identifier) : "";
  var name = null;
  if (ident && /^[a-zA-Z0-9_-]{1,32}$/.test(ident)) name = ident;
  else if (normalizeServerName(s.name)) name = s.name;
  else if (ident && /^@?[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ident)) {
    // npm 包名含 @ 作用域/斜杠时转 slug（@scope/pkg -> scope-pkg）
    var slug = ident.replace(/^@/, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    if (slug && slug.length <= 32 && /^[a-zA-Z0-9_-]{1,32}$/.test(slug)) name = slug;
  }
  if (!name) {
    // 兜底：把 server.name 洗净成 slug
    var rawSlug = slugify(String(s.name || s.title || ident || ""));
    if (rawSlug.length > 32) rawSlug = rawSlug.slice(0, 32).replace(/-+$/, "");
    if (rawSlug && /^[a-zA-Z0-9_-]{1,32}$/.test(rawSlug)) name = rawSlug;
    else return null;
  }
  var title = String(s.title || s.name || name);
  var description = truncate(s.description || s.title || "", 300);
  var cls = classify(title + " " + s.description + " " + name);
  var homepage = "";
  var repository = "";
  try { if (s.websiteUrl) homepage = String(s.websiteUrl); } catch (e) { }
  try { if (s.repository && s.repository.url) repository = String(s.repository.url); } catch (e) { }
  if (!homepage && repository) homepage = repository;
  var icon = "";
  try { if (s.icons && s.icons.length && s.icons[0] && s.icons[0].src) icon = String(s.icons[0].src); } catch (e) { }
  var version = String(s.version || "");

  var install = { kind: "remote", pkg: "", command: "", args: [], url: "", runtimeHint: "", env: {}, warn: "" };
  var free = false, installable = false, needsKey = false, envRequired = [];

  if (pkgs.length) {
    var p0 = pkgs[0];
    var rt = p0.registryType || "";
    ident = String(p0.identifier || "");
    install.runtimeHint = p0.runtimeHint || "";
    if (rt === "npm") {
      install.kind = "npm";
      install.pkg = ident;
      var np = probeNodeNpx();
      install.command = np.command;
      install.args = [];
      if (np.npx) install.args.push(np.npx);
      install.args.push("-y");
      if (ident) install.args.push(ident);
      if (np.warn) install.warn = np.warn;
      free = true; installable = true;
    } else if (rt === "pypi") {
      install.kind = "pypi";
      install.pkg = ident;
      var uv = probeUvx();
      install.command = uv.command;
      install.args = [];
      if (ident) install.args.push(ident);
      if (uv.warn) install.warn = uv.warn;
      free = true; installable = true;
    } else { // oci / mcpb：本机无法直接安装
      install.kind = rt;
      install.pkg = ident;
      free = false; installable = false;
    }
    // 收集所有包必填环境变量
    var seen = {};
    for (var i = 0; i < pkgs.length; i++) {
      var p = pkgs[i];
      if (!p.environmentVariables) continue;
      for (var j = 0; j < p.environmentVariables.length; j++) {
        var ev = p.environmentVariables[j];
        if (!ev || !ev.name || seen[ev.name]) continue;
        seen[ev.name] = true;
        if (ev.isRequired) {
          needsKey = true;
          envRequired.push(ev.name);
        }
      }
    }
  } else if (remotes.length) {
    install.kind = "remote";
    install.url = String(remotes[0].url || "");
    free = false; installable = false; needsKey = true;
  }
  // 既无 packages 也无 remotes → 保持 free/installable=false

  return {
    id: "mcp-market-" + slugify(name),
    name: name,
    title: title,
    description: description,
    category: cls.category,
    categoryLabel: cls.categoryLabel,
    categoryIcon: cls.categoryIcon,
    subCategory: "registry",
    subCategoryLabel: "官方注册表",
    homepage: homepage,
    repository: repository,
    icon: icon,
    version: version,
    free: free,
    installable: installable,
    needsKey: needsKey,
    envRequired: envRequired,
    install: install,
    source: "registry"
  };
}

// ─────────────────────────── 精选目录 → 市场条目 ───────────────────────────

function curatedToEntry(item) {
  var name = normalizeServerName(item.name);
  if (!name) return null;
  var pkg = String(item.package || "");
  var install = { kind: "remote", pkg: pkg, command: "", args: [], url: "", runtimeHint: "", env: {}, warn: "" };
  if (item.registryType === "npm" && pkg) {
    install.kind = "npm";
    var np = probeNodeNpx();
    install.command = np.command;
    install.args = [];
    if (np.npx) install.args.push(np.npx);
    install.args.push("-y");
    install.args.push(pkg);
    if (np.warn) install.warn = np.warn;
  } else if (item.registryType === "pypi" && pkg) {
    install.kind = "pypi";
    var uv = probeUvx();
    install.command = uv.command;
    install.args = [pkg];
    if (uv.warn) install.warn = uv.warn;
  } else {
    install.url = item.homepage || item.repository || "";
  }
  return {
    id: "mcp-market-" + slugify(name),
    name: name,
    title: String(item.title || name),
    description: truncate(item.descriptionZh || "", 300),
    category: item.category,
    categoryLabel: item.categoryLabel,
    categoryIcon: item.categoryIcon,
    subCategory: item.subCategory || "official",
    subCategoryLabel: item.subCategoryLabel || "官方出品",
    homepage: item.homepage || item.repository || "",
    repository: item.repository || "",
    // v2.0.7: 精选条目可以自带 icon（真实 logo URL）；留空则由前端按其 GitHub 属主头像回退，
    // 这样每条 MCP 显示的都是它自己的图标，而不是统一的分类 emoji。
    icon: String(item.icon || ""),
    version: "",
    free: true,
    installable: true,
    needsKey: !!item.needsKey,
    envRequired: (item.envRequired || []).slice(),
    install: install,
    source: "curated"
  };
}

// ─────────────────────────── 缓存读写 ───────────────────────────

function marketFile() { return join(dataDir(), "market.json"); }

function readMarketCache() {
  var f = marketFile();
  try {
    if (!existsSync(f)) return null;
    var st = statSync(f);
    if (Date.now() - st.mtime.getTime() > CACHE_TTL_MS) return { stale: true };
    var js = JSON.parse(readFileSync(f, "utf8"));
    if (js && js.ok && js.servers) return { data: js };
    return null;
  } catch (e) { return null; }
}

function writeMarketCache(result) {
  var f = marketFile();
  try {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(result), "utf8");
    return true;
  } catch (e) { return false; }
}

// ─────────────────────────── 组装市场 ───────────────────────────

function marketCuratedPath() {
  // 用 fileURLToPath 而非 URL.pathname：Windows 下 pathname 会带前导 /C:/...，
  // 被 join 拼成 \C:\... 导致 existsSync false，精选目录永远读不到。
  return join(dirname(fileURLToPath(import.meta.url)), "market-curated.json");
}

function loadCurated() {
  try {
    var curPath = marketCuratedPath();
    var raw = readFileSync(curPath, "utf8");
    var js = JSON.parse(raw);
    return (js && js.items) || [];
  } catch (e) { return []; }
}

function buildCategories(servers) {
  var count = {};
  for (var i = 0; i < servers.length; i++) {
    var c = servers[i].category;
    if (c && count[c] != null) count[c] = count[c] + 1; else if (c) count[c] = 1;
  }
  var out = [];
  for (var k = 0; k < MARKET_CATS.length; k++) {
    var cat = MARKET_CATS[k];
    var n = count[cat.id] || 0;
    if (n > 0) out.push({ id: cat.id, label: cat.label, icon: cat.icon, count: n });
  }
  return out;
}

export async function buildMarket(ctx, opts) {
  opts = opts || {};
  var refresh = !!opts.refresh;
  var curatedRaw = loadCurated();

  // 精选始终组装（优先，永不缓存覆盖）
  var curatedSrv = [];
  var curatedByName = {};
  for (var c = 0; c < curatedRaw.length; c++) {
    var ce = curatedToEntry(curatedRaw[c]);
    if (!ce) continue;
    curatedSrv.push(ce);
    curatedByName[ce.name.toLowerCase()] = true;
  }

  // 缓存复用（非 refresh 且 24h 内）
  if (!refresh) {
    var hit = readMarketCache();
    if (hit && hit.data) {
      // 合并精选（缓存的精选条目丢弃，用全新精选）
      var cachedBy = {};
      for (var i = 0; i < (hit.data.servers || []).length; i++) {
        var srv = hit.data.servers[i];
        if (!srv || srv.source === "curated") continue;
        cachedBy[srv.name.toLowerCase()] = srv;
      }
      var merged = curatedSrv.slice();
      var have = {};
      for (var m = 0; m < merged.length; m++) have[merged[m].name.toLowerCase()] = true;
      for (var nm in cachedBy) {
        if (!have[nm]) { merged.push(cachedBy[nm]); have[nm] = true; }
      }
      return {
        ok: true,
        ts: hit.data.ts || Date.now(),
        cached: true,
        stale: false,
        warn: hit.data.warn || "",
        total: merged.length,
        hiddenByCurated: 0,
        categories: buildCategories(merged),
        servers: merged
      };
    }
  }

  // 拉 registry
  var registryRaw = [];
  var warn = "";
  var fetchFailed = false;
  try {
    registryRaw = await fetchRegistry({});
  } catch (e) {
    fetchFailed = true;
    warn = "官方 Registry 拉取失败：" + String((e && e.message) || e);
  }

  // 网络失败：有旧缓存 → 旧缓存 + stale；无缓存 → 只精选 + stale
  if (fetchFailed) {
    if (!refresh) {
      var hit2 = readMarketCache();
      if (hit2 && hit2.data) {
        hit2.data.cached = true;
        hit2.data.stale = true;
        hit2.data.warn = warn;
        return hit2.data;
      }
    }
    var ct = buildCategories(curatedSrv);
    return {
      ok: true, ts: Date.now(), cached: false, stale: true, warn: warn,
      total: curatedSrv.length, hiddenByCurated: 0, categories: ct, servers: curatedSrv
    };
  }

  // 正常组装：精选优先，registry 按 name（小写）去重（保留首个出现的条目，
  // registry 顺序即最新/首个），与 cached 路径 recoveredBy[name] 口径一致。
  // total = 去重后 merged 总数（精选 29 条 + 去重后 registry）。
  var merged = curatedSrv.slice();
  var haveName = {};
  for (var i0 = 0; i0 < merged.length; i0++) haveName[merged[i0].name.toLowerCase()] = true;
  var hiddenByCurated = 0;   // 被精选覆盖（同名存在于 curated）的 registry 条目数
  var registrySeen = {};     // registry 内部同名去重（同一 server 各版本）
  for (var r = 0; r < registryRaw.length; r++) {
    var e2 = registryToEntry(registryRaw[r]);
    if (!e2) continue;
    var key = e2.name.toLowerCase();
    if (registrySeen[key]) continue;          // registry 内部版本重复：丢弃
    registrySeen[key] = true;
    if (haveName[key]) { hiddenByCurated++; continue; }  // 被精选同名校覆盖
    merged.push(e2);
    haveName[key] = true;
  }

  var result = {
    ok: true,
    ts: Date.now(),
    cached: false,
    stale: false,
    warn: warn,
    total: merged.length,
    hiddenByCurated: hiddenByCurated,
    categories: buildCategories(merged),
    servers: merged
  };

  writeMarketCache(result);
  return result;
}

// ─────────────────────────── 兼容导出（供 installMcp / 前端诊断使用） ───────────────────────────

export var MARKET_META = {
  base: REGISTRY_BASE,
  limit: PAGE_LIMIT,
  maxPages: MAX_PAGES,
  cacheFile: marketFile
};