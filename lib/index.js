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
import { scanSkills, categoriesMeta, readSkillBody, parseLedgerTable, parseLedgerDetail, findLedgerFile, readLedgerAtPath, ledgerDefaultPath, setSkillDisabled } from "./scan.js";
import {
  createLedgerState, setLedgerRoot, setLedgerPath, recordSkillResult, reportFailure,
  flushNow, initializeLedger, ledgerFilePath, autoLogFilePath, readAutoLog
} from "./ledger-writer.js";
import { ZH, UI_TEXT } from "./zh.js";

var PREFIX = "/dsh-skill-browser";
var VERSION = "1.7.4";
var CACHE_TTL_MS = 30 * 1000;
var DIAG_FILE = join(homedir(), ".dsh", "data", "dsh-skill-browser", "diag.log");
var CONFIG_FILE = join(homedir(), ".dsh", "data", "dsh-skill-browser", "config.json");
// v1.7.2: hard cap on one batch call (skill libraries are ~hundreds, this is
// only an abuse guard - the panel never sends more than the full library).
var BATCH_MAX = 2000;

export var name = "dsh-skill-browser";
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

export function apply(ctx, config) {
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
  try {
    ctx.on("tools/result", function (exec, result) {
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
    var allAuto = readAutoLog(root);
    var autoTotal = allAuto.length, autoFailTotal = 0;
    for (var a = 0; a < allAuto.length; a++) { if (!allAuto[a].ok) autoFailTotal++; }
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
      autoRecent: allAuto.slice(-30).reverse()
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

  ctx.effect(function () {
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
        sendJson(res, 200, { ok: true, plugin: "dsh-skill-browser", version: VERSION, root: root, source: detected.source });
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
        var autoEntries = readAutoLog(root, skill);
        sendJson(res, 200, { ok: true, skill: skill, detail: detail, autoEntries: autoEntries });
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

      sendJson(res, 404, { ok: false, error: "unknown path" });
    };

    var dispose = ctx.webServer.register({ kind: "prefix", path: PREFIX, handler: handler });
    return function () { try { dispose(); } catch (e) {} };
  }, "dsh-skill-browser: api routes");
}
