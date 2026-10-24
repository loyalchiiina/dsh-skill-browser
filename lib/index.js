// dsh-skill-browser - host half.
// Serves a JSON API for the client panel: skill library scanning (root is
// user-configurable per machine - see detectRoot), category tree, Chinese
// one-liners, full SKILL.md bodies, and the skill-failure ledger engine.
// Pure host service; visual work lives in lib/client.js.
// v1.7.0/1.7.1/1.7.2/1.7.3 rebuild (2026-09-12):
//   - POST /toggle {dir, disable?} -> setSkillDisabled on one skill.
//   - POST /toggle-batch {dirs:[...]} | {category}, disable? -> batch toggling.
//   - GET /skills now carries `ui` (lib/zh.js UI_TEXT) and per-skill `disabled`.
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

// ── v1.9.4 热加载：子模块走「带版本查询串的动态 import」 ───────────────
// 首次加载 RELOAD_V 为空串（等价静态 import）；/reload 用 ?v=<ts> 重新导入本
// 模块时，RELOAD_V 跟着变成 ?v=<ts>，五个子模块也一并换新，而不是命中 ESM
// 缓存里的旧代码。解构出来的仍是原来的裸标识符，下游调用点一个都不用改。
var RELOAD_V = new URL(import.meta.url).search || "";
var scanMod = await import("./scan.js" + RELOAD_V);
var lwMod = await import("./ledger-writer.js" + RELOAD_V);
var lsMod = await import("./ledger-stats.js" + RELOAD_V);
var zhMod = await import("./zh.js" + RELOAD_V);
var grMod = await import("./groups.js" + RELOAD_V);
var kwMod = await import("./keyword-groups.js" + RELOAD_V);

var scanSkills = scanMod.scanSkills, categoriesMeta = scanMod.categoriesMeta,
  readSkillBody = scanMod.readSkillBody, parseLedgerTable = scanMod.parseLedgerTable,
  parseLedgerDetail = scanMod.parseLedgerDetail, findLedgerFile = scanMod.findLedgerFile,
  readLedgerAtPath = scanMod.readLedgerAtPath, ledgerDefaultPath = scanMod.ledgerDefaultPath,
  setSkillDisabled = scanMod.setSkillDisabled;
var createLedgerState = lwMod.createLedgerState, setLedgerRoot = lwMod.setLedgerRoot,
  setLedgerPath = lwMod.setLedgerPath, recordSkillResult = lwMod.recordSkillResult,
  reportFailure = lwMod.reportFailure, flushNow = lwMod.flushNow,
  initializeLedger = lwMod.initializeLedger, ledgerFilePath = lwMod.ledgerFilePath,
  autoLogFilePath = lwMod.autoLogFilePath, readAutoLog = lwMod.readAutoLog,
  autoLogStat = lwMod.autoLogStat, readAutoLogTail = lwMod.readAutoLogTail;
var buildStats = lsMod.buildStats;
var ZH = zhMod.ZH, UI_TEXT = zhMod.UI_TEXT;
var listGroups = grMod.listGroups, createGroup = grMod.createGroup,
  renameGroup = grMod.renameGroup, deleteGroup = grMod.deleteGroup,
  moveGroup = grMod.moveGroup, assignSkill = grMod.assignSkill,
  assignSkills = grMod.assignSkills, aiClassify = grMod.aiClassify,
  applyPlan = grMod.applyPlan, aiCover = grMod.aiCover, storePath = grMod.storePath,
  describeModelRoute = grMod.describeModelRoute;
var keywordClassify = kwMod.keywordClassify;

var PREFIX = "/dsh-skill-browser";
export var VERSION = "1.9.9";
var CACHE_TTL_MS = 30 * 1000;
var DIAG_FILE = join(homedir(), ".dsh", "data", "dsh-skill-browser", "diag.log");
var CONFIG_FILE = join(homedir(), ".dsh", "data", "dsh-skill-browser", "config.json");
// v1.7.2: hard cap on one batch call (skill libraries are ~hundreds, this is
// only an abuse guard - the panel never sends more than the full library).
var BATCH_MAX = 2000;

export var name = "dsh-skill-browser";
// v1.9.0: "llm" is required for the two AI features (auto-classify into
// groups / one-click group cover art). Without it those endpoints return a
// clear "宿主未提供 llm 服务" error instead of silently doing nothing.
// llm is an OPTIONAL capability: NOT declared here, so the panel still loads
// on a host/profile without it. groups.js reads it through ctx.get("llm").
export var inject = ["webServer"];

function isLoopback(req) {
  var a = (req.socket && req.socket.remoteAddress) || "";
  var n = a.toLowerCase();
  if (n === "::1") return true;
  if (n.startsWith("::ffff:")) return n.slice(7).startsWith("127.");
  return n.startsWith("127.");
}

// ── 运行时配置（设置页保存的覆盖项，存 ~/.dsh/data 下，无 BOM） ──
function loadRuntimeConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    var parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) { return {}; }
}

function saveRuntimeConfig(cfg) {
  try {
    mkdirSync(dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
    return true;
  } catch (e) { return false; }
}

// Skill root resolution (shared-plugin safe: ZERO machine-specific paths):
//   1. runtime config override (settings page "技能库位置" / folder picker)
//   2. env DSH_SKILLS_DIR
//   3. cordis config.skillsDir
//   4. official default user root ~/.dsh/skills
// No hit at all → root stays empty and the panel asks the user to pick a
// folder in settings. Every machine teaches the plugin its own location.
function countSkills(dir) {
  try {
    var entries = readdirSync(dir, { withFileTypes: true });
    var n = 0;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e.isDirectory()) continue;
      if (e.name.charAt(0) === "_" || e.name.charAt(0) === ".") continue;
      if (existsSync(join(dir, e.name, "SKILL.md"))) n++;
    }
    return n;
  } catch (e) { return 0; }
}

function detectRoot(config, runtime) {
  var candidates = [];
  function push(p, source) {
    if (!p || typeof p !== "string") return;
    candidates.push({ path: p, source: source, missing: !existsSync(p), count: 0 });
  }
  var rc = runtime || {};
  push(rc.skillsDir, "settings-override");
  push(process.env.DSH_SKILLS_DIR, "env");
  push(config && typeof config.skillsDir === "string" ? config.skillsDir : "", "config");
  push(join(homedir(), ".dsh", "skills"), "auto-detect");
  for (var i = 0; i < candidates.length; i++) {
    if (!candidates[i].missing) candidates[i].count = countSkills(candidates[i].path);
  }
  if (!candidates.length) return { root: "", source: "none", candidates: [] };
  // explicit sources: user intent wins as long as the path exists
  for (var j = 0; j < candidates.length; j++) {
    var c = candidates[j];
    if (c.source !== "auto-detect" && !c.missing) return { root: c.path, source: c.source, candidates: candidates };
  }
  // auto-detect: only the official default root; prefer non-empty over empty
  var best = null;
  for (var k = 0; k < candidates.length; k++) {
    var a = candidates[k];
    if (a.missing) continue;
    if (!best || a.count > best.count) best = a;
  }
  if (!best) return { root: "", source: "none", candidates: candidates };
  return { root: best.path, source: best.count > 0 ? "auto-detect" : "auto-detect(empty)", candidates: candidates };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(obj));
}

// ── 系统目录选择框（Windows FolderBrowserDialog，宿主端直弹） ──
// Electron renderer 的 File API 拿不到可靠真实路径（Electron 32+ 移除
// File.path，webUtils 依赖 preload 暴露，webkitdirectory 实测失败），改由
// 宿主端 spawn powershell -STA -File pick-dir.ps1 弹 WinForms 对话框。
// ⚠ ps1 必须落盘执行：-Command 内联会在嵌套 shell 层被吞 $ 变量。
// 返回 Promise<string|null>；用户取消/超时为 null。
import { fileURLToPath } from "node:url";

function pickDirViaPowerShell() {
  return new Promise(function (resolve) {
    var script = join(dirname(fileURLToPath(import.meta.url)), "pick-dir.ps1");
    var child;
    try {
      // ⚠ 不设 windowsHide:true（SW_HIDE 链）；控制台窗口用 -WindowStyle Hidden
      // 隐藏（只藏控制台，不影响 WinForms 对话框）。弹框期间控制台不闪现。
      child = spawn("powershell.exe", ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", script], {
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (e) {
      resolve(null);
      return;
    }
    var out = "";
    var settled = false;
    function finish(path) {
      if (settled) return;
      settled = true;
      resolve(path);
    }
    child.stdout.on("data", function (d) { out += d; });
    child.on("close", function () {
      var p = out.trim();
      finish(p === "" ? null : p);
    });
    child.on("error", function () { finish(null); });
    // 保险丝：10 分钟无操作视为放弃（用户可能一直不关对话框）
    setTimeout(function () {
      if (!settled) { try { child.kill(); } catch (e) {} finish(null); }
    }, 10 * 60 * 1000);
  });
}

// ── v1.9.4 热加载：当前生效的 API 实例（挂在 globalThis 上） ──────────
// 必须跨模块实例共享：热重载会造出新的模块实例，如果 LIVE 是模块级变量，
// 新实例的 handler 会读到自己那份空 LIVE，第二次重载就断链。
var LIVE = globalThis.__DSB_LIVE__ || (globalThis.__DSB_LIVE__ = { api: null, gen: 0 });

/** 用 ?v=<ts> 重新导入自身模块，换掉正在服务的 handler（host 半热重载）。 */
async function selfReload(ctx, config) {
  var base = new URL(import.meta.url);
  base.search = "";
  var fresh = await import(base.href + "?v=" + Date.now());
  if (!fresh || typeof fresh.createApi !== "function") throw new Error("重新导入的模块没有 createApi()");
  var api = fresh.createApi(ctx, config);
  var old = LIVE.api;
  LIVE.api = api;
  LIVE.gen += 1;
  if (old && typeof old.dispose === "function") { try { old.dispose(); } catch (e) {} }
  // client 半：让 client-modules 重新从磁盘读 client.js，浏览器刷新即新界面
  try {
    var cm = typeof ctx.get === "function" ? ctx.get("clientModules") : null;
    if (cm && typeof cm.rebuilt === "function") cm.rebuilt("dsh-skill-browser");
  } catch (e) { /* client 半刷新失败不影响 host 半 */ }
  return { version: fresh.VERSION || VERSION, gen: LIVE.gen };
}

export function apply(ctx, config) {
  ctx.effect(function () {
    var api = createApi(ctx, config);
    LIVE.api = api;
    var dispose = ctx.webServer.register({
      kind: "prefix",
      path: PREFIX,
      handler: function (req, res) {
        var cur = LIVE.api;
        if (!cur) { res.writeHead(503); res.end(); return; }
        return cur.handler(req, res);
      }
    });
    return function () {
      try { dispose(); } catch (e) {}
      // 释放「当前生效」的那一份（热重载后已换新，不能只放最初那个实例）
      try { if (LIVE.api && LIVE.api.dispose) LIVE.api.dispose(); } catch (e) {}
      try { if (api.dispose) api.dispose(); } catch (e) {}
    };
  }, "dsh-skill-browser: api routes");
}

/** 构造一套完整 API（配置/根/台账/监听/全部路由）。热重载靠它换新。 */
export function createApi(ctx, config) {
  var runtime = loadRuntimeConfig();
  var detected = detectRoot(config, runtime);
  var root = detected.root;
  var cache = { ts: 0, payload: null };
  var cacheLedger = { ts: 0, payload: null };
  ctx.logger.info("dsh-skill-browser: host mounted, skill root = " + (root || "(not found)") + " (source: " + detected.source + ")");

  // ── 失效台账：搜索已有 + 初始化 + 自动登记 ──────────────────
  // 台账发现：先全库搜索（失效台账/失败台账等关键词文件，约定路径优先）；
  // 搜到 → 直接用它（人工内容不动，首接管备份一次）；没搜到 → 在约定路径
  // 创建默认台账（对齐现行格式、零隐私、内置登记口令）+ skill-master 骨架。
  var ledger = createLedgerState({ root: root, logger: ctx.logger });
  var ledgerFile = null; // 解析到的台账实际路径（缓存）
  function resolveLedger(force) {
    if (!root) return null;
    if (!force && ledgerFile) return ledgerFile;
    var found = findLedgerFile(root);
    if (found) {
      setLedgerPath(ledger, found);
      ledgerFile = found;
      ctx.logger.info("dsh-skill-browser: ledger found at " + found);
      return ledgerFile;
    }
    // 未搜索到：初始化（创建默认台账 + skill-master 骨架），台账落在约定路径
    initializeLedger(ledger);
    ledgerFile = ledgerDefaultPath(root);
    setLedgerPath(ledger, ledgerFile);
    ctx.logger.info("dsh-skill-browser: no ledger found, default created at " + ledgerFile);
    return ledgerFile;
  }
  if (root) resolveLedger(false);
  var offTools = null;
  try {
    offTools = ctx.on("tools/result", function (exec, result) {
      try {
        if (runtime.ledgerEnabled === false) return;
        recordSkillResult(ledger, exec, result);
      } catch (e) { /* 监听器绝不影响工具调用本身 */ }
    });
    ctx.logger.info("dsh-skill-browser: ledger auto-recorder armed (tools/result)");
  } catch (e) {
    ctx.logger.warn("dsh-skill-browser: tools/result listener failed: " + (e && e.message));
  }

  function buildPayload() {
    var skills = scanSkills(root, ZH);
    // Per-category counts, emitted in CATS order so the client renders a
    // stable chip sequence; categories with zero skills are dropped.
    var meta = categoriesMeta();
    var counts = {};
    for (var i = 0; i < skills.length; i++) {
      counts[skills[i].cat] = (counts[skills[i].cat] || 0) + 1;
    }
    var categories = [];
    for (var j = 0; j < meta.length; j++) {
      var c = meta[j];
      if (!counts[c.id]) continue;
      categories.push({ id: c.id, label: c.label, icon: c.icon, subs: c.subs || [] });
    }
    return {
      ok: true,
      root: root,
      total: skills.length,
      generatedAt: new Date().toISOString(),
      categories: categories,
      skills: skills,
      // v1.7.1/1.7.2: 面板 UI 文案（客户端 T()/TF() 优先取用，缺失时走
      // client.js 内置 UI_FALLBACK 兜底）。
      ui: UI_TEXT
    };
  }

  function getPayload(force) {
    var now = Date.now();
    if (!force && cache.payload && now - cache.ts < CACHE_TTL_MS) return cache.payload;
    if (!root) {
      var re = detectRoot(config, runtime);
      root = re.root;
      setLedgerRoot(ledger, root);
      ledgerFile = null; // 换根重搜台账
    }
    if (root) resolveLedger(force); // 首扫/强刷时：搜索台账，无则创建（幂等）
    cache.payload = buildPayload();
    cache.ts = now;
    return cache.payload;
  }

  // 查询串取值（query 是去掉前导 ? 的串）
function qp(query, key) {
  var re = new RegExp("(^|&)" + key + "=([^&]*)");
  var m = re.exec(String(query || ""));
  if (!m) return "";
  try { return decodeURIComponent(m[2]); } catch (e) { return m[2]; }
}

// 调用台账统计（带 30s 缓存，键含全部参数）
var cacheStats = { key: "", ts: 0, payload: null };
function getLedgerStats(opts) {
  var o = opts || {};
  var now = Date.now();
  // v1.9.6 性能：把 jsonl 的 size+mtime 拼进缓存键 —— 文件没变就直接命中，
  // 不再因为"切粒度/改排序"而重读整个 jsonl（原实现只按参数缓存，跨参数必重读）。
  var probe = { exists: false, size: 0, mtimeMs: 0 };
  try { probe = autoLogStat(root); } catch (e0) {}
  var key = [o.from || "", o.to || "", o.gran || "", o.sort || "", o.top || "",
    probe.exists ? probe.size : -1, probe.exists ? Math.round(probe.mtimeMs) : -1].join("|");
  if (cacheStats.payload && cacheStats.key === key && now - cacheStats.ts < CACHE_TTL_MS) {
    return cacheStats.payload;
  }
  // 同一份 jsonl 只解析一次：文件未变时，不同参数复用同一次解析结果
  var records;
  if (cacheStats.records && cacheStats.recSize === probe.size && cacheStats.recMtime === Math.round(probe.mtimeMs)) {
    records = cacheStats.records;
  } else {
    try { records = readAutoLog(root); } catch (e) { records = []; }
    cacheStats.records = records;
    cacheStats.recSize = probe.size;
    cacheStats.recMtime = Math.round(probe.mtimeMs);
  }
  var out = buildStats(records, {
    from: o.from, to: o.to, gran: o.gran, sort: o.sort, top: o.top
  });
  out.autoLogPath = root ? autoLogFilePath(root) : null;
  cacheStats.key = key; cacheStats.ts = now; cacheStats.payload = out;
  return out;
}
function getLedgerPayload(force) {
    var now = Date.now();
    if (!force && cacheLedger.payload && now - cacheLedger.ts < CACHE_TTL_MS) return cacheLedger.payload;
    if (!ledgerFile && root) resolveLedger(force);
    var text = ledgerFile ? readLedgerAtPath(ledgerFile) : null;
    var entries = text == null ? [] : parseLedgerTable(text);
    var totalFail = 0, failCount = 0;
    for (var z = 0; z < entries.length; z++) {
      if (entries[z].fails > 0) { failCount++; totalFail += entries[z].fails; }
    }
    // v1.9.6 性能：统计总数用轻量计数（不保留整表），最近 30 条只从文件尾部读
    var autoTotal = 0, autoFailTotal = 0;
    try {
      var allAuto = readAutoLog(root);
      autoTotal = allAuto.length;
      for (var a = 0; a < allAuto.length; a++) { if (!allAuto[a].ok) autoFailTotal++; }
      allAuto = null;
    } catch (e) {}
    var autoRecent = [];
    try { autoRecent = readAutoLogTail(root, 30).slice().reverse(); } catch (e) {}
    cacheLedger.payload = {
      ok: true,
      ledgerPath: ledgerFile || (root ? ledgerDefaultPath(root) : null),
      ledgerFound: !!ledgerFile,
      autoLogPath: root ? autoLogFilePath(root) : null,
      totalFailSkills: failCount,
      totalFails: totalFail,
      entries: entries,
      autoTotal: autoTotal,
      autoFailTotal: autoFailTotal,
      autoRecent: autoRecent
    };
    cacheLedger.ts = now;
    return cacheLedger.payload;
  }

  // ── v1.7.2 启用/停用 ──────────────────────────────────────
  // POST /toggle {dir, disable?(缺省=true)} → 单技能启停，成功后使 /skills
  // 缓存失效。响应：{ok:true, dir, changed, backup, disabled} / {ok:false, dir, error}。
  function handleToggle(req, res) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      var dir = "", wantOff = true;
      try {
        var body = JSON.parse(Buffer.concat(chunks).toString("utf8")) || {};
        dir = String(body.dir || "");
        wantOff = body.disable === undefined ? true : !!body.disable;
        var r = setSkillDisabled(root, dir, wantOff);
        if (r.ok) {
          cache.payload = null; // 下次 /skills 重扫，拿到最新 disabled
          ctx.logger.info("dsh-skill-browser: toggle " + dir + " -> " + (wantOff ? "disabled" : "enabled") +
            " (changed=" + r.changed + ", backup=" + (r.backup || "none") + ")");
          sendJson(res, 200, { ok: true, dir: dir, changed: r.changed, backup: r.backup, disabled: r.disabled });
        } else {
          ctx.logger.warn("dsh-skill-browser: toggle " + dir + " failed: " + r.error);
          sendJson(res, 200, { ok: false, dir: dir, error: r.error });
        }
      } catch (e) {
        sendJson(res, 200, { ok: false, dir: dir, error: String(e && e.message || e) });
      }
    });
  }

  // POST /toggle-batch {dirs:[...]} 或 {category:"<cat-id>"}，可选 disable
  // （缺省=true）→ 循环单技能启停，部分失败不影响其余。
  // 响应：{ok:true, total, okCount, failCount, anyChanged, results:[{dir, ok, changed, error|null}]}。
  function handleToggleBatch(req, res) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try {
        var body = JSON.parse(Buffer.concat(chunks).toString("utf8")) || {};
        var wantOff = body.disable === undefined ? true : !!body.disable;
        var dirs = [];
        if (Object.prototype.toString.call(body.dirs) === "[object Array]") {
          for (var i = 0; i < body.dirs.length && dirs.length < BATCH_MAX; i++) {
            var d = String(body.dirs[i] || "");
            if (d && dirs.indexOf(d) < 0) dirs.push(d);
          }
        } else if (typeof body.category === "string" && body.category) {
          // 分类批量：现扫一遍技能库取该分类全部目录（不走缓存，避免脏数据）
          var skills = scanSkills(root, ZH);
          for (var j = 0; j < skills.length; j++) {
            if (skills[j].cat === body.category) dirs.push(skills[j].dir);
          }
        } else {
          sendJson(res, 200, { ok: false, error: "need dirs:[...] or category:<cat-id>" });
          return;
        }
        var results = [], okCount = 0, failCount = 0, anyChanged = false;
        for (var k = 0; k < dirs.length; k++) {
          var r = setSkillDisabled(root, dirs[k], wantOff);
          if (r.ok) {
            okCount++;
            if (r.changed) anyChanged = true;
            results.push({ dir: dirs[k], ok: true, changed: r.changed, error: null });
          } else {
            failCount++;
            results.push({ dir: dirs[k], ok: false, changed: false, error: r.error });
          }
        }
        if (anyChanged) cache.payload = null;
        ctx.logger.info("dsh-skill-browser: toggle-batch " +
          (body.category ? "category=" + body.category : "dirs=" + dirs.length) +
          " -> " + (wantOff ? "disabled" : "enabled") +
          " (ok=" + okCount + ", fail=" + failCount + ", changed=" + anyChanged + ")");
        sendJson(res, 200, {
          ok: true,
          total: dirs.length,
          okCount: okCount,
          failCount: failCount,
          anyChanged: anyChanged,
          results: results
        });
      } catch (e) {
        sendJson(res, 200, { ok: false, error: String(e && e.message || e) });
      }
    });
  }

  // ── v1.9.0 视图分组（groups）──────────────────────────────
  // 分组只是"视图层归档"：写入 ~/.dsh/data/dsh-skill-browser/groups.json，
  // 技能目录本身既不移动也不改名，绝不触碰任何 SKILL.md。
  function readBody(req, done) {
    var chunks = [];
    req.on("data", function (c) { chunks.push(c); });
    req.on("end", function () {
      try { done(JSON.parse(Buffer.concat(chunks).toString("utf8")) || {}); }
      catch (e) { done({}); }
    });
  }

  function handleGroupsList(res) {
    var validDirs = [];
    try {
      var sk = scanSkills(root, ZH);
      for (var i = 0; i < sk.length; i++) validDirs.push(sk[i].dir);
    } catch (e) { /* root 不可用时不清空，只返回已有分组 */ }
    var out = listGroups(validDirs.length ? validDirs : null);
    out.storePath = storePath();
    sendJson(res, 200, out);
  }

  // POST /groups {action, ...}
  //   create   {name, emoji?, color?, parent?}   parent 为空 = 大类
  //   rename   {id, name?, emoji?, color?}
  //   move     {id, parent}          两级结构里调整归属（""=升为大类）
  //   delete   {id}                  删大类会连带删掉它的子类
  //   assign   {dir, gid}            gid 为空字符串 = 移出分组
  //   assign-batch {dirs:[...], gid}
  //   ai-classify {mode?}            AI 出「大类→子类」两级方案，**不落盘**
  //   ai-apply {plan, mode?}         用户确认后落盘（replace 覆盖旧 AI 组 / merge 只追加）
  //   ai-cover {id}                   AI 一键生成该分组封面图
  // Skill dirs must be plain single-segment names AND actually exist in the
  // current library. A group assignment is view-only, so an unknown dir is
  // always a client bug - reject it instead of polluting groups.json.
  var SAFE_SKILL_DIR_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  function knownSkillDirs() {
    var out = {};
    try {
      var list = scanSkills(root, ZH) || [];
      for (var i = 0; i < list.length; i++) out[list[i].dir] = true;
    } catch (e) { /* an unreadable root yields an empty set -> all dirs rejected */ }
    return out;
  }
  function validateDirs(dirs) {
    var known = knownSkillDirs();
    var good = [], bad = [];
    for (var i = 0; i < dirs.length; i++) {
      var d = String(dirs[i] || "");
      if (!d || !SAFE_SKILL_DIR_RE.test(d) || d === "." || d === "..") { bad.push(d); continue; }
      if (!known[d]) { bad.push(d); continue; }
      good.push(d);
    }
    return { good: good, bad: bad };
  }

  function handleGroupsPost(req, res) {
    readBody(req, function (body) {
      var action = String(body.action || "");
      try {
        if (action === "create") {
          var cg = createGroup(body.name, body.emoji, body.color, body.parent);
          sendJson(res, cg.ok ? 200 : 400, cg);
          return;
        }
        if (action === "rename") {
          var rg = renameGroup(String(body.id || ""), body.name, body.emoji, body.color);
          sendJson(res, rg.ok ? 200 : 400, rg);
          return;
        }
        if (action === "move") {
          var mg = moveGroup(String(body.id || ""), body.parent);
          sendJson(res, mg.ok ? 200 : 400, mg);
          return;
        }
        if (action === "delete") {
          var dg = deleteGroup(String(body.id || ""));
          sendJson(res, dg.ok ? 200 : 400, dg);
          return;
        }
        if (action === "assign") {
          var one = validateDirs([body.dir]);
          if (!one.good.length) { sendJson(res, 400, { ok: false, error: "无效的技能目录名：" + String(body.dir || "") }); return; }
          var as = assignSkill(one.good[0], body.gid);
          sendJson(res, as.ok ? 200 : 400, as);
          return;
        }
        // Kept for bulk moves from the client (not wired to a button yet).
        if (action === "assign-batch") {
          var dirs = Object.prototype.toString.call(body.dirs) === "[object Array]" ? body.dirs : [];
          var v = validateDirs(dirs.slice(0, BATCH_MAX));
          if (!v.good.length) { sendJson(res, 400, { ok: false, error: "没有有效的技能目录名" }); return; }
          var bulk = assignSkills(v.good, body.gid);
          bulk.rejected = v.bad;
          sendJson(res, 200, bulk);
          return;
        }
        // v1.9.9 模型发现探针：告诉面板「AI 分组会用哪个模型」，
        // 让别人装完插件零配置就知道能不能用、用的是哪个。
        // 不触发任何模型调用，只解析路由。
        if (action === "model-info") {
          describeModelRoute(ctx, runtime).then(function (r) {
            sendJson(res, 200, r);
          }).catch(function (e) {
            sendJson(res, 200, { ok: false, provider: "", model: "", source: "", error: String((e && e.message) || e) });
          });
          return;
        }
        // v1.9.7 关键词快速分组：零 token、毫秒级、完全确定。
        // 与 ai-classify 一样只出方案不落盘，用户确认后仍走 ai-apply。
        if (action === "kw-classify") {
          var kwSkills = scanSkills(root, ZH);
          if (!kwSkills.length) { sendJson(res, 400, { ok: false, error: "技能库为空或未找到技能" }); return; }
          try {
            sendJson(res, 200, keywordClassify(kwSkills));
          } catch (e) {
            ctx.logger.warn("dsh-skill-browser: kw-classify failed: " + (e && e.message));
            sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
          }
          return;
        }
        if (action === "ai-classify") {
          var skills = scanSkills(root, ZH);
          if (!skills.length) { sendJson(res, 400, { ok: false, error: "技能库为空或未找到技能" }); return; }
          // Build a PLAN only - nothing is written until the user confirms via
          // ai-apply. Replacing existing groups must be an explicit choice.
          aiClassify(ctx, runtime, skills, { mode: body.mode }).then(function (r) {
            sendJson(res, r && r.ok ? 200 : 500, r);
          }).catch(function (e) {
            ctx.logger.warn("dsh-skill-browser: ai-classify failed: " + (e && e.message));
            sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
          });
          return;
        }
        if (action === "ai-apply") {
          var plan = body.plan;
          if (!plan || typeof plan !== "object") { sendJson(res, 400, { ok: false, error: "缺少分组方案 plan" }); return; }
          var skillsForPlan = scanSkills(root, ZH);
          if (!skillsForPlan.length) { sendJson(res, 400, { ok: false, error: "技能库为空或未找到技能" }); return; }
          var applied = applyPlan(plan, skillsForPlan, body.mode);
          sendJson(res, applied.ok ? 200 : 400, applied);
          return;
        }
        if (action === "ai-cover") {
          var gid = String(body.id || "");
          var listed = listGroups(null);
          var g = null;
          for (var i = 0; i < listed.groups.length; i++) {
            if (listed.groups[i].id === gid) { g = listed.groups[i]; break; }
          }
          if (!g) { sendJson(res, 404, { ok: false, error: "分组不存在：" + gid }); return; }
          var sample = [];
          for (var j = 0; j < g.members.length && sample.length < 12; j++) {
            var d = g.members[j];
            sample.push(ZH[d] ? d + "（" + ZH[d] + "）" : d);
          }
          aiCover(ctx, runtime, g, sample).then(function (r) {
            sendJson(res, r && r.ok ? 200 : 500, r);
          }).catch(function (e) {
            ctx.logger.warn("dsh-skill-browser: ai-cover failed: " + (e && e.message));
            sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
          });
          return;
        }
        sendJson(res, 400, { ok: false, error: "unknown action: " + action });
      } catch (e) {
        ctx.logger.warn("dsh-skill-browser: groups action failed: " + (e && e.message));
        sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
      }
    });
  }

  var handler = function (req, res) {
      if (!isLoopback(req)) { res.writeHead(403); res.end(); return; }
      var url = req.url || "/";
      var path = url.slice(0, url.indexOf("?") >= 0 ? url.indexOf("?") : url.length);
      var query = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?") + 1) : "";

      // ── v1.6.0 液态玻璃球静态资源（LerSent001/orb MIT）：/dsh-skill-browser/orb/<name>.html ──
      if (path.indexOf(PREFIX + "/orb/") === 0 && req.method === "GET") {
        var orbName = path.slice((PREFIX + "/orb/").length);
        if (!/^orb-[a-zA-Z]+\.html$/.test(orbName)) { sendJson(res, 404, { error: "not found" }); return; }
        var orbPath = join(dirname(fileURLToPath(import.meta.url)), "orb", orbName);
        try {
          var orbData = readFileSync(orbPath);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
          res.end(orbData);
        } catch (e) { sendJson(res, 404, { error: "orb not found" }); }
        return;
      }
      if (path === PREFIX + "/health") {
        sendJson(res, 200, { ok: true, plugin: "dsh-skill-browser", version: VERSION, gen: LIVE.gen, root: root, source: detected.source });
        return;
      }

      // ── 运行时配置（设置页：技能库位置 / 自动台账开关） ──
      if (path === PREFIX + "/config" && req.method === "POST") {
        var cfgChunks = [];
        req.on("data", function (c) { cfgChunks.push(c); });
        req.on("end", function () {
          try {
            var body = JSON.parse(Buffer.concat(cfgChunks).toString("utf8")) || {};
            var next = loadRuntimeConfig();
            if (typeof body.skillsDir === "string") {
              var trimmed = body.skillsDir.trim();
              if (trimmed) next.skillsDir = trimmed; else delete next.skillsDir;
            }
            if (typeof body.ledgerEnabled === "boolean") next.ledgerEnabled = body.ledgerEnabled;
            var saved = saveRuntimeConfig(next);
            var re2 = detectRoot(config, next);
            root = re2.root;
            detected = re2;
            runtime = next;
            setLedgerRoot(ledger, root);
            cache.payload = null; cacheLedger.payload = null;
            ctx.logger.info("dsh-skill-browser: config updated -> root=" + (root || "(not found)") + " (source: " + re2.source + ")");
            sendJson(res, 200, { ok: saved, root: root, source: re2.source, runtime: next });
          } catch (e) {
            sendJson(res, 200, { ok: false, error: String(e && e.message || e) });
          }
        });
        return;
      }

      if (path === PREFIX + "/config") {
        if (!ledgerFile && root) resolveLedger(false);
        sendJson(res, 200, {
          ok: true,
          root: root,
          source: detected.source,
          runtime: runtime,
          ledgerEnabled: runtime.ledgerEnabled !== false,
          ledgerPath: ledgerFile || (root ? ledgerDefaultPath(root) : null),
          ledgerExists: ledgerFile ? existsSync(ledgerFile) : false,
          autoLogPath: root ? autoLogFilePath(root) : null
        });
        return;
      }

      if (path === PREFIX + "/skills") {
        var force = /(^|&)refresh=1(&|$)/.test(query);
        try {
          sendJson(res, 200, getPayload(force));
        } catch (e) {
          ctx.logger.warn("dsh-skill-browser: scan failed " + (e && e.message));
          sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
        }
        return;
      }

      if (path === PREFIX + "/skill") {
        var m = /(^|&)dir=([^&]*)/.exec(query);
        var dir = m ? decodeURIComponent(m[2]) : "";
        var body = dir ? readSkillBody(root, dir) : null;
        if (body == null) {
          sendJson(res, 404, { ok: false, error: "skill not found: " + dir });
          return;
        }
        sendJson(res, 200, { ok: true, dir: dir, content: body });
        return;
      }

      // ── v1.7.2 单技能启用/停用 ──
      if (path === PREFIX + "/toggle" && req.method === "POST") {
        handleToggle(req, res);
        return;
      }

      // ── v1.7.0 分类批量 / v1.7.2 全局批量启用停用 ──
      if (path === PREFIX + "/toggle-batch" && req.method === "POST") {
        handleToggleBatch(req, res);
        return;
      }

      if (path === PREFIX + "/groups" && req.method === "POST") {
        handleGroupsPost(req, res);
        return;
      }
      if (path === PREFIX + "/groups") {
        try { handleGroupsList(res); }
        catch (e) { sendJson(res, 500, { ok: false, error: String((e && e.message) || e) }); }
        return;
      }

      // 调用台账统计：GET /ledger/stats?from=&to=&gran=day|week|month|year&sort=&top=
      // 服务端聚合，只回聚合结果（不把上千条原始流水塞给前端）
      if (path === PREFIX + "/ledger/stats") {
        try {
          var stats = getLedgerStats({
            from: qp(query, "from"),
            to: qp(query, "to"),
            gran: qp(query, "gran"),
            sort: qp(query, "sort"),
            top: qp(query, "top")
          });
          sendJson(res, 200, stats);
        } catch (e) {
          ctx.logger.warn("dsh-skill-browser: ledger stats failed " + (e && e.message));
          sendJson(res, 500, { ok: false, error: String((e && e.message) || e) });
        }
        return;
      }
      if (path === PREFIX + "/ledger") {
        try {
          sendJson(res, 200, getLedgerPayload(/(^|&)refresh=1(&|$)/.test(query)));
        } catch (e) {
          ctx.logger.warn("dsh-skill-browser: ledger read failed " + (e && e.message));
          sendJson(res, 500, { ok: false, error: String(e && e.message || e) });
        }
        return;
      }

      // 语义层手动上报：{ skill, note, kind }
      if (path === PREFIX + "/ledger/report" && req.method === "POST") {
        var rpChunks = [];
        req.on("data", function (c) { rpChunks.push(c); });
        req.on("end", function () {
          try {
            var body = JSON.parse(Buffer.concat(rpChunks).toString("utf8")) || {};
            var out = reportFailure(ledger, body);
            sendJson(res, 200, out);
          } catch (e) {
            sendJson(res, 200, { ok: false, error: String(e && e.message || e) });
          }
        });
        return;
      }

      if (path === PREFIX + "/ledger/flush" && req.method === "POST") {
        flushNow(ledger);
        sendJson(res, 200, { ok: true, pending: ledger.queue.length });
        return;
      }

      if (path === PREFIX + "/ledger-detail") {
        var m2 = /(^|&)skill=([^&]*)/.exec(query);
        var skill = m2 ? decodeURIComponent(m2[2]) : "";
        if (!skill) { sendJson(res, 400, { ok: false, error: "missing skill" }); return; }
        if (!ledgerFile && root) resolveLedger(false);
        var text2 = ledgerFile ? readLedgerAtPath(ledgerFile) : null;
        var detail = text2 == null ? "" : (parseLedgerDetail(text2, skill) || "");
        // v1.9.6 性能：详情页默认只回最近 200 条（含总数），避免单技能上千条记录一次性塞给前端
        var m3 = /(^|&)limit=([^&]*)/.exec(query);
        var lim = m3 ? parseInt(decodeURIComponent(m3[2]), 10) : 200;
        if (!(lim > 0)) lim = 200;
        var allEntries = readAutoLog(root, skill);
        var autoEntries = allEntries.length > lim ? allEntries.slice(allEntries.length - lim) : allEntries;
        sendJson(res, 200, {
          ok: true, skill: skill, detail: detail,
          autoEntries: autoEntries, autoTotal: allEntries.length, autoLimit: lim
        });
        return;
      }

      // 系统目录选择框：POST /pick-dir → 宿主弹 Windows FolderBrowserDialog
      if (path === PREFIX + "/pick-dir" && req.method === "POST") {
        pickDirViaPowerShell().then(function (p) {
          if (p) {
            ctx.logger.info("dsh-skill-browser: pick-dir -> " + p);
            sendJson(res, 200, { ok: true, path: p });
          } else {
            sendJson(res, 200, { ok: true, path: null }); // 用户取消或失败
          }
        });
        return;
      }

      if (path === PREFIX + "/diag") {
        // 客户端诊断日志：POST 诊断信息，写入文件供后续排查
        if (req.method === "POST") {
          var chunks = [];
          req.on("data", function (c) { chunks.push(c); });
          req.on("end", function () {
            try {
              var body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              mkdirSync(dirname(DIAG_FILE), { recursive: true });
              appendFileSync(DIAG_FILE, JSON.stringify({ ts: new Date().toISOString(), diag: body }) + "\n", "utf8");
              sendJson(res, 200, { ok: true });
            } catch (e) {
              sendJson(res, 200, { ok: true, error: String(e) });
            }
          });
        } else {
          // GET 返回所有诊断记录
          try {
            if (existsSync(DIAG_FILE)) {
              var text = readFileSync(DIAG_FILE, "utf8");
              sendJson(res, 200, { ok: true, lines: text.split("\n").filter(Boolean).slice(-20).map(function(l){ try { return JSON.parse(l); } catch(e) { return l; } }) });
            } else {
              sendJson(res, 200, { ok: true, lines: [] });
            }
          } catch (e) {
            sendJson(res, 200, { ok: true, lines: [], error: String(e) });
          }
        }
        return;
      }

      // ── v1.9.4 热加载：POST /reload ──────────────────────────
      // 必须先回包再重载：重载会 dispose 当前实例，回包前做会断连接。
      if (path === PREFIX + "/reload" && req.method === "POST") {
        sendJson(res, 200, { ok: true, version: VERSION, gen: LIVE.gen, reloading: true });
        setTimeout(function () {
          selfReload(ctx, config).then(function (r) {
            ctx.logger.info("dsh-skill-browser: hot-reloaded (host half) -> " + r.version + " gen " + r.gen);
          }).catch(function (e) {
            ctx.logger.warn("dsh-skill-browser: hot reload failed: " + (e && e.message ? e.message : e));
          });
        }, 120);
        return;
      }

      // ── v1.9.4 热加载探针：GET /rev（gen 变了 = 宿主半已换新）──
      if (path === PREFIX + "/rev") {
        sendJson(res, 200, { ok: true, version: VERSION, gen: LIVE.gen, ts: Date.now() });
        return;
      }

      sendJson(res, 404, { ok: false, error: "unknown path" });
    };

    return {
      handler: handler,
      dispose: function () { try { if (offTools) offTools(); } catch (e) {} }
    };
  }
