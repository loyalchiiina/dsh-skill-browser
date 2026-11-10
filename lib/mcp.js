// dsh-skill-browser - MCP 管理子模块（宿主端，v2.0.0）
//
// 只读优先：枚举运行时 loader 里每一个 @deepseek-ai/dsh-mcp-client 条目，
// 给出真实状态（Cordis FiberState）、已注册工具清单、自动功能概括、
// 调用统计（监听官方 tools/result 事件，落盘 jsonl）。
//
// 启停（P1）：**不改写整份 YAML**（那会丢光 344KB 中文注释）。只在用户
// profile 的 cordis.patch.yml 末尾维护一个带 BEGIN/END 标记的「受管覆盖块」，
// 纯文本追加/替换，幂等；DSH 的 user patch layer 本身支持 HMR 热重载，
// 因此改完即热应用，重启后同样保留。
//
// 重连（P1）：直接走 Cordis Fiber 的内存重启（entry.fiber.update(config,true)），
// 不触碰任何文件。
//
// 导出（P0）：把运行时配置反解为标准 mcpServers JSON（Claude Desktop / Cursor 同构）。

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, copyFileSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { askModel } from "./groups.js";

var MCP_PKG = "@deepseek-ai/dsh-mcp-client";

// Cordis FiberState 常量镜像（与 @deepseek-ai/cordis 的 const enum 对应）
var FIBER_STATE = { 0: "pending", 1: "loading", 2: "active", 3: "failed", 4: "disposed", 5: "unloading" };

var MARK_BEGIN = "# ==== dsh-skill-browser:mcp-managed BEGIN (auto-generated, DO NOT EDIT) ====";
var MARK_END = "# ==== dsh-skill-browser:mcp-managed END ====";

var SENSITIVE_RE = /(token|key|secret|password|passwd|pwd|credential|auth|api[-_]?key)/i;

export function dataDir() { return join(homedir(), ".dsh", "data", "dsh-skill-browser"); }
export function mcpStatsFile() { return join(dataDir(), "mcp-calls.jsonl"); }
function backupDir() { return join(homedir(), ".dsh", "backups"); }

function maskValue(v) {
  var s = String(v == null ? "" : v);
  if (!s) return "";
  if (s.length <= 6) return "••••";
  return s.slice(0, 2) + "••••" + s.slice(-2);
}

// ─────────────────────────── 枚举 ───────────────────────────

function fiberPhase(entry) {
  try {
    var f = entry.fiber;
    if (!f) return { num: null, name: "idle" };
    var n = typeof f.state === "number" ? f.state : null;
    return { num: n, name: n === null ? "unknown" : (FIBER_STATE[n] || "unknown") };
  } catch (e) { return { num: null, name: "unknown" }; }
}

function safeToolSchemas(ctx) {
  // tools 是可选服务：直接 ctx.tools 未 inject 会抛「cannot get property without inject」，
  // 故统一走 ctx.get("tools")（与 groups.js 的 ctx.get("llm") 同一契约）。
  var tools = null;
  try { if (typeof ctx.get === "function") tools = ctx.get("tools") || null; } catch (e) { tools = null; }
  if (!tools) { try { if (ctx.tools) tools = ctx.tools; } catch (e) { tools = null; } }
  if (!tools) return [];
  // 性能：优先 definitions()（只读引用，不做 parameters 深拷贝），
  // schemas() 会对每个工具 projectToolSchema 深拷贝参数字典，工具多时开销大。
  try {
    if (typeof tools.definitions === "function") {
      var d = tools.definitions();
      if (Array.isArray(d)) return d;
    }
  } catch (e) { /* ignore */ }
  try {
    if (typeof tools.schemas === "function") {
      var s = tools.schemas();
      if (Array.isArray(s)) return s;
    }
  } catch (e) { /* ignore */ }
  return [];
}

function pickServerTools(allTools, serverName) {
  var prefix = "mcp__" + serverName + "__";
  var out = [];
  for (var i = 0; i < allTools.length; i++) {
    var t = allTools[i];
    if (!t || typeof t.name !== "string") continue;
    var hit = t.name.indexOf(prefix) === 0;
    if (!hit) {
      // 兜底：hash 或字符替换后仍按第二段识别
      var parts = t.name.split("__");
      if (parts.length >= 3 && parts[0] === "mcp" && parts[1] === serverName) hit = true;
    }
    if (!hit) continue;
    out.push({ name: t.name, rawName: t.name.slice(prefix.length) || t.name, description: (t.description || "").slice(0, 300) });
  }
  return out;
}

// 版本推断：MCP 协议 serverInfo.version 对第三方插件不可见（client 实例在
// mcp-client 内部闭包里，不对外暴露），只能从启动配置里推断：command /
// args / url 中形如 x.y.z 的版本串，取最后一个（路径越靠后越像版本目录，
// 例：...\toolchain\0.8.8\windows-mcp\...\windows-mcp.exe → 0.8.8）。
export function guessVersion(cfg) {
  try {
    var hay = [cfg.command || "", Array.isArray(cfg.args) ? cfg.args.join(" ") : "", cfg.url || ""].join(" ");
    var m = hay.match(/(\d+\.\d+\.\d+)/g);
    return m && m.length ? m[m.length - 1] : "";
  } catch (e) { return ""; }
}

// 自动功能概括：从工具名与描述提炼。
function summarizeTools(tools) {
  if (!tools.length) return "未连接或尚未注册工具";
  var kinds = {
    query: /(get|list|read|query|fetch|search|detect|status|info|inspect|show|find|describe|check|watch|stat)/i,
    exec: /(run|execute|launch|start|eval|invoke|call|submit|apply|solve|iterate|compile|build)/i,
    write: /(set|write|update|patch|edit|create|add|insert|put|upload|save|modify|enable|disable|toggle)/i,
    delete: /(delete|remove|drop|clear|reset|kill|close|cancel|stop|abort)/i,
    export: /(export|download|dump|snapshot|serialize|backup)/i,
    file: /(file|path|dir|folder|disk|fs|upload|download)/i,
    session: /(session|connect|disconnect|reconnect|auth|login)/i
  };
  var buckets = { query: 0, exec: 0, write: 0, delete: 0, export: 0, file: 0, session: 0 };
  tools.forEach(function (t) {
    var s = t.rawName + " " + (t.description || "");
    Object.keys(kinds).forEach(function (k) { if (kinds[k].test(s)) buckets[k]++; });
  });
  var labels = { query: "查询", exec: "执行", write: "写入/配置", delete: "删除/停止", export: "导出", file: "文件", session: "会话/连接" };
  var picked = Object.keys(buckets)
    .filter(function (k) { return buckets[k] > 0; })
    .sort(function (a, b) { return buckets[b] - buckets[a]; })
    .slice(0, 3)
    .map(function (k) { return labels[k]; });
  var head = tools.length + " 个工具";
  if (!picked.length) return head;
  return head + "，主要提供" + picked.join(" / ") + "能力";
}

function findOwnerFile(node) {
  var cur = node;
  for (var i = 0; i < 30 && cur; i++) {
    try {
      if (typeof cur.filename === "string" && cur.filename) return cur.filename;
    } catch (e) { /* ignore */ }
    var next = null;
    try {
      if (cur.ctx && cur.ctx.fiber && cur.ctx.fiber.entry) next = cur.ctx.fiber.entry.parent;
    } catch (e) { next = null; }
    if (!next || next === cur) break;
    cur = next;
  }
  return null;
}

// 兜底：在各 profile 的 cordis.patch.yml 里找含该 entry id 的文件
function fallbackPatchFile(entryId) {
  try {
    var roots = [];
    if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, "profiles"));
    else roots.push(join(homedir(), ".dsh", "profiles"));
    for (var r = 0; r < roots.length; r++) {
      var base = roots[r];
      if (!existsSync(base)) continue;
      var names = readdirSync(base);
      for (var i = 0; i < names.length; i++) {
        var f = join(base, names[i], "cordis.patch.yml");
        if (!existsSync(f)) continue;
        try {
          var txt = readFileSync(f, "utf8");
          if (txt.indexOf(MCP_PKG) >= 0 && (!entryId || txt.indexOf(entryId) >= 0)) return f;
        } catch (e) { /* ignore */ }
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// 校验某个文件是否确实承载了该条目（root include 的 filename 理论上就是
// profile 的 cordis.patch.yml，但不同启动路径下可能是 cordis.yml，故必须核实）。
function safeContains(file, needle) {
  try {
    if (!file || !existsSync(file)) return false;
    return readFileSync(file, "utf8").indexOf(String(needle)) >= 0;
  } catch (e) { return false; }
}

function resolveEntryFile(entry, id) {
  var f = findOwnerFile(entry && entry.parent);
  if (f && safeContains(f, id)) return f;
  return fallbackPatchFile(id);
}

var _mcpListCache = { ts: 0, data: null };
export function collectMcp(ctx, force) {
  var _now = Date.now();
  if (!force && _mcpListCache.data && (_now - _mcpListCache.ts) < 1500) return _mcpListCache.data;
  var allTools = safeToolSchemas(ctx);
  var servers = [];
  var seen = {};
  var entries = [];
  try {
    for (var row of ctx.loader.entries()) entries.push(row);
  } catch (e) { /* loader 不可用 */ }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var opt = entry && entry.options ? entry.options : null;
    if (!opt || opt.group) continue;
    if (opt.name !== MCP_PKG) continue;
    var cfg = opt.config || {};
    var id = String(opt.id || "");
    if (seen[id]) continue;
    seen[id] = true;

    var serverName = typeof cfg.serverName === "string" && cfg.serverName ? cfg.serverName : id;
    var transport = cfg.transport || (cfg.url ? "streamable-http" : "stdio");
    var disabled = false;
    try { disabled = !!entry.disabled; } catch (e) { disabled = !!opt.disabled; }
    var phase = fiberPhase(entry);
    if (disabled) phase = { num: phase.num, name: "disabled" };

    var tools = pickServerTools(allTools, serverName);

    // env：只回键名 + 打码值（UI 展示用），真实值只在导出接口里给
    var envKeys = [];
    var envMasked = {};
    if (cfg.env && typeof cfg.env === "object") {
      Object.keys(cfg.env).forEach(function (k) {
        envKeys.push(k);
        envMasked[k] = SENSITIVE_RE.test(k) ? maskValue(cfg.env[k]) : String(cfg.env[k] == null ? "" : cfg.env[k]);
      });
    }
    var headersMasked = {};
    if (cfg.headers && typeof cfg.headers === "object") {
      Object.keys(cfg.headers).forEach(function (k) { headersMasked[k] = SENSITIVE_RE.test(k) ? maskValue(cfg.headers[k]) : String(cfg.headers[k]); });
    }

    var patchFile = resolveEntryFile(entry, id);

    servers.push({
      id: id,
      serverName: serverName,
      transport: transport,
      version: guessVersion(cfg),
      command: cfg.command || "",
      args: Array.isArray(cfg.args) ? cfg.args : [],
      cwd: cfg.cwd || "",
      url: cfg.url || "",
      envKeys: envKeys,
      env: envMasked,
      headers: headersMasked,
      disabled: disabled,
      phase: phase.name,
      phaseNum: phase.num,
      toolCount: tools.length,
      tools: tools,
      summary: summarizeTools(tools),
      patchFile: patchFile || "",
      failOnStartupError: cfg.failOnStartupError,
      toolCallTimeoutMs: cfg.toolCallTimeoutMs
    });
  }

  servers.sort(function (a, b) { return String(a.serverName).localeCompare(String(b.serverName)); });
  // 诊断日志（低频：每次面板刷新一次）：一眼看清枚举到的服务器与其工具数。
  try {
    if (ctx && ctx.logger && typeof ctx.logger.info === "function") {
      var toolTotal = servers.reduce(function (a, s) { return a + (s.toolCount || 0); }, 0);
      var detail = servers.map(function (s) { return s.serverName + ":" + s.phase + ":" + s.toolCount; }).join(", ");
      ctx.logger.info("dsh-skill-browser: mcp collect total=" + servers.length + " tools=" + toolTotal + (detail ? " [" + detail + "]" : ""));
    }
  } catch (e0) { /* 日志失败不影响返回 */ }
  var _result = {
    ok: true,
    ts: Date.now(),
    total: servers.length,
    active: servers.filter(function (s) { return s.phase === "active"; }).length,
    servers: servers
  };
  _mcpListCache = { ts: _now, data: _result };
  return _result;
}

// ── 本机 MCP 快速扫描（只读）：找出「已配置」与「本机已安装包」的所有 MCP ──
// 目的：给 MCP 界面的 AI「自动获取 / 修复」提供真实数据源，绝不靠记忆猜。
export function scanLocalMcp(ctx) {
  var conf = collectMcp(ctx, true);
  var servers = (conf && conf.servers) || [];
  var configuredNames = {};
  var configuredHints = {};
  servers.forEach(function (s) {
    configuredNames[String(s.serverName)] = true;
    var txt = [s.command].concat(s.args || []).join(" ");
    var m = txt.match(/(@?[a-z0-9._\-\/]*mcp[a-z0-9._\-]*)/i);
    if (m) configuredHints[m[1].toLowerCase()] = true;
  });

  var home = homedir();
  var roots = [];
  try {
    var profsDir = join(home, ".dsh", "profiles");
    if (existsSync(profsDir)) readdirSync(profsDir).forEach(function (p) { roots.push(join(profsDir, p, "node_modules")); });
  } catch (e) { }
  try {
    var lp = join(home, ".dsh", "local-plugins");
    if (existsSync(lp)) readdirSync(lp).forEach(function (p) { roots.push(join(lp, p, "node_modules")); });
  } catch (e2) { }
  roots.push(join(home, "AppData", "Roaming", "npm", "node_modules"));

  var seen = {}, installed = [];
  function addPkg(dir, name, scope) {
    if (seen["d::" + dir]) return; seen["d::" + dir] = true;
    var pj = join(dir, "package.json");
    if (!existsSync(pj)) return;
    var j = {};
    try { j = JSON.parse(readFileSync(pj, "utf8")); } catch (e) { return; }
    var pname = j.name || name;
    if (seen["p::" + pname]) return; seen["p::" + pname] = true;
    var bin = "";
    if (typeof j.bin === "string") bin = j.bin;
    else if (j.bin && typeof j.bin === "object") { var ks = Object.keys(j.bin); if (ks.length) bin = j.bin[ks[0]]; }
    installed.push({
      name: pname,
      version: j.version || "",
      description: String(j.description || "").replace(/\s+/g, " ").slice(0, 180),
      scope: scope,
      dir: dir,
      bin: bin,
      configured: !!configuredHints[pname.toLowerCase()] || !!configuredNames[pname]
    });
  }
  function scanDir(nmDir, scope) {
    if (!existsSync(nmDir)) return;
    var names = [];
    try { names = readdirSync(nmDir); } catch (e) { return; }
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      if (!nm || nm.charAt(0) === ".") continue;
      if (nm.charAt(0) === "@") {
        try {
          var subs = readdirSync(join(nmDir, nm));
          for (var s = 0; s < subs.length; s++) {
            if (/mcp/i.test(subs[s])) addPkg(join(nmDir, nm, subs[s]), nm + "/" + subs[s], scope);
          }
        } catch (e2) { }
        continue;
      }
      if (/mcp/i.test(nm)) addPkg(join(nmDir, nm), nm, scope);
    }
  }
  roots.forEach(function (r) { scanDir(r, r.indexOf("local-plugins") >= 0 ? "local-plugins" : "node_modules"); });

  installed.sort(function (a, b) {
    if (a.configured !== b.configured) return a.configured ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  var notConf = installed.filter(function (x) { return !x.configured; });
  return {
    ok: true,
    ts: Date.now(),
    configured: servers.map(function (s) {
      return { serverName: s.serverName, transport: s.transport, command: s.command, version: s.version,
        disabled: s.disabled, phase: s.phase, toolCount: s.toolCount };
    }),
    installedTotal: installed.length,
    installedNotConfigured: notConf.length,
    installed: installed
  };
}

// ── AI 修复：诊断异常 MCP（规则 + AI 增强建议），并应用修复动作 ──
export async function mcpAiDiagnose(ctx) {
  var conf = collectMcp(ctx, true);
  var servers = conf.servers || [];
  var stats = getMcpStats();
  var stBy = {};
  (stats.servers || []).forEach(function (s) { stBy[s.server] = s; });
  var issues = [];
  servers.forEach(function (sv) {
    var st = stBy[sv.serverName] || null;
    var fail = st ? (st.fail || 0) : 0;
    var phase = sv.phase || "";
    var symptoms = [];
    if (sv.disabled) symptoms.push("已停用");
    if (phase === "failed" || phase === "error") symptoms.push("启动失败");
    if (fail > 0) symptoms.push("调用失败 " + fail + " 次");
    if (!symptoms.length) return;
    var lastErr = "";
    if (st && st.tools) { for (var i = 0; i < st.tools.length; i++) { if (st.tools[i].lastErr) { lastErr = st.tools[i].lastErr; break; } } }
    issues.push({ id: sv.id, serverName: sv.serverName, phase: phase, disabled: !!sv.disabled,
      fail: fail, lastErr: lastErr, symptoms: symptoms.join("、"), action: "", reason: "", source: "rule" });
  });
  if (!issues.length) return { ok: true, issues: [], note: "没有发现异常的 MCP" };
  // 规则默认动作
  issues.forEach(function (x) {
    if (x.disabled) x.action = "enable";
    else if (x.phase === "failed" || x.phase === "error") x.action = "reconnect";
    else if (x.fail > 0) x.action = "reconnect";
    else x.action = "keep";
    x.reason = "（规则）" + x.symptoms;
  });
  // AI 增强（失败则保留规则默认）
  try {
    var sys = "你是 DSH 的 MCP 运维助手。根据每个 MCP 服务器的状态判断最合适的修复动作。" +
      "可选动作：reconnect(重连) / enable(启用) / disable(暂时停用) / clean(清理残留) / keep(不动)。" +
      '只输出 JSON：{"items":[{"serverName":"...","action":"reconnect","reason":"一句话中文原因"}]}，不要解释。';
    var u = "MCP 服务器状态：\n" + issues.map(function (x, i) {
      return (i + 1) + ") " + x.serverName + " | 状态:" + x.phase + " | 停用:" + (x.disabled ? "是" : "否") +
        " | 调用失败:" + x.fail + "次 | 最近错误:" + (x.lastErr || "无");
    }).join("\n") + "\n请为每个给出 action 和 reason。";
    var res = await askModel(ctx, null, sys, u, "skill-browser-mcp-fix", 1200, { reasoningEffort: "low", timeoutMs: 60000 });
    var obj = null;
    try { var t = String(res.text || ""); var a = t.indexOf("{"); var b = t.lastIndexOf("}"); if (a >= 0 && b > a) obj = JSON.parse(t.slice(a, b + 1)); } catch (e0) { }
    if (obj && Array.isArray(obj.items)) {
      var map = {}; obj.items.forEach(function (it) { if (it && it.serverName) map[String(it.serverName)] = it; });
      issues.forEach(function (x) {
        var it = map[x.serverName];
        if (it && it.action && /^(reconnect|enable|disable|clean|keep)$/.test(it.action)) {
          x.action = it.action; x.reason = "（AI）" + (it.reason || ""); x.source = "ai";
        }
      });
    }
  } catch (e) { /* 保留规则默认 */ }
  return { ok: true, issues: issues, note: "" };
}

export async function mcpAiFixApply(ctx, actions) {
  var results = [];
  var conf = collectMcp(ctx, true);
  var byName = {};
  (conf.servers || []).forEach(function (s) { byName[s.serverName] = s; });
  for (var i = 0; i < (actions || []).length; i++) {
    var a = actions[i] || {};
    var name = String(a.serverName || ""), act = String(a.action || "");
    var r = { serverName: name, action: act, ok: false, error: "" };
    try {
      var sv = byName[name];
      if (!sv) { r.error = "未找到该 MCP"; results.push(r); continue; }
      if (act === "reconnect") { var rr = await reconnectMcp(ctx, sv.id); r.ok = !!(rr && rr.ok !== false); r.error = (rr && rr.error) || ""; }
      else if (act === "enable") { var e1 = setMcpEnabled(ctx, sv.id, true); r.ok = !!(e1 && e1.ok !== false); r.error = (e1 && e1.error) || ""; }
      else if (act === "disable") { var e2 = setMcpEnabled(ctx, sv.id, false); r.ok = !!(e2 && e2.ok !== false); r.error = (e2 && e2.error) || ""; }
      else if (act === "clean") { var c1 = cleanMcpResidue(ctx); r.ok = !!(c1 && c1.ok !== false); r.error = (c1 && c1.error) || ""; }
      else { r.ok = true; r.error = "已跳过"; }
    } catch (e) { r.error = String((e && e.message) || e); }
    results.push(r);
  }
  return { ok: true, results: results };
}

// ─────────────────────── 启停（受管覆盖块） ───────────────────────

function stripManagedBlock(text) {
  var b = text.indexOf(MARK_BEGIN);
  if (b < 0) return text;
  var e = text.indexOf(MARK_END, b);
  if (e < 0) return text; // 标记损坏：宁可不改
  e += MARK_END.length;
  while (e < text.length && (text[e] === "\r" || text[e] === "\n")) e++;
  return text.slice(0, b) + text.slice(e);
}

function parseManagedBlock(text) {
  var b = text.indexOf(MARK_BEGIN);
  if (b < 0) return [];
  var e = text.indexOf(MARK_END, b);
  if (e < 0) return [];
  var body = text.slice(b + MARK_BEGIN.length, e);
  var lines = body.split(/\r?\n/);
  var ids = [];
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\s*-\s*id:\s*(.+?)\s*$/);
    if (m) ids.push(m[1].replace(/^['"]|['"]$/g, ""));
  }
  return ids;
}

function backupFile(file) {
  try {
    mkdirSync(backupDir(), { recursive: true });
    var name = basename(file) + ".mcp-" + new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, join(backupDir(), name));
    // 只保留最近 20 份
    var all = readdirSync(backupDir()).filter(function (n) { return n.indexOf(basename(file) + ".mcp-") === 0; }).sort();
    while (all.length > 20) {
      try { unlinkSync(join(backupDir(), all.shift())); } catch (e) { }
    }
  } catch (e) { /* 备份失败不阻断，但下面会记录 */ }
}

function writeManagedBlock(file, disabledIds) {
  var text = readFileSync(file, "utf8");
  var eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  var stripped = stripManagedBlock(text);
  var out = stripped;
  if (disabledIds && disabledIds.length) {
    var block = [MARK_BEGIN];
    disabledIds.slice().sort().forEach(function (id) {
      block.push("- id: " + id);
      block.push("  disabled: true");
    });
    block.push(MARK_END);
    if (out.length && !/[\r\n]$/.test(out)) out += eol;
    out += block.join(eol) + eol;
  }
  if (out === text) return { changed: false, text: text };
  backupFile(file);
  writeFileSync(file, out, "utf8");
  return { changed: true, text: out };
}

export function setMcpEnabled(ctx, id, enabled) {
  var data = collectMcp(ctx, true);
  var target = null;
  for (var i = 0; i < data.servers.length; i++) if (data.servers[i].id === id) target = data.servers[i];
  if (!target) return { ok: false, error: "找不到 MCP 条目: " + id };
  var file = target.patchFile;
  if (!file || !existsSync(file) || !safeContains(file, id)) file = fallbackPatchFile(id);
  if (!file || !existsSync(file)) return { ok: false, error: "无法定位该 MCP 所在的 patch 文件（可能来自内置层，无法用文件覆盖）" };

  var raw = readFileSync(file, "utf8");
  var ids = parseManagedBlock(raw);
  var set = {};
  ids.forEach(function (x) { set[x] = true; });
  if (enabled) delete set[id]; else set[id] = true;
  var nextIds = Object.keys(set);

  var res = writeManagedBlock(file, nextIds);
  return {
    ok: true,
    changed: res.changed,
    file: file,
    disabledIds: nextIds,
    note: res.changed
      ? "配置已写入，DSH 用户补丁层会热重载（若 1~2 秒内状态未变，请彻底重启 DSH）"
      : "配置无变化"
  };
}

// ─────────────────────────── 卸载（删除条目块） ───────────────────────────
// v2.0.3：把一条 MCP 从 profile 补丁文件里真正删掉（不是禁用）。
// 文本级、缩进感知，因为真实文件里条目有两种形态：
//   ① 直接挂在顶级：`- id: xxx` 缩进 0
//   ② 挂在 `- insert:` 里：`    - id: xxx` 缩进 4
// 删除范围 = 从 `- id:` 行起，吞掉所有缩进更深的内容行（serverName / transport /
// command / args / env ...），到下一个缩进 <= 该行的非空行为止。
// 三种必须一并处理的连带物：
//   · 条目正上方若有一组专属注释（注释里出现了该 id），一起删，否则留下孤零零的中文注释块
//   · 父级 `- insert:` 删完若只剩空壳（没有兄弟条目、也没有非注释内容）→ 连父级行删掉，
//     否则 YAML 里变成 `insert: null`，loader 会报错
//   · 受管覆盖块（MARK_BEGIN/END）里若残留同 id 的 disabled 覆盖 → 一并清掉，避免死引用告警
function removeEntryBlock(text, id) {
  var eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  var lines = text.split(/\r?\n/);
  var want = String(id);

  // 1) 精确定位 `- id: <want>`（支持单/双引号、行尾注释）
  var idx = -1, indent = 0;
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^([ \t]*)-[ \t]*id:[ \t]*(?:"([^"]*)"|'([^']*)'|([^#\s]+))[ \t]*(?:#.*)?$/);
    if (!m) continue;
    var got = (m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4])) || "";
    if (got === want) { idx = i; indent = m[1].length; break; }
  }
  if (idx < 0) return { removed: false, text: text, reason: "没有 `- id: " + want + "` 行" };

  // 2) 块尾：第一个缩进 <= indent 的非空行；尾部空行不算块内
  var end = idx + 1;
  while (end < lines.length) {
    var ln = lines[end];
    if (!ln.trim()) { end++; continue; }
    if (/^[ \t]*/.exec(ln)[0].length <= indent) break;
    end++;
  }
  while (end > idx + 1 && !lines[end - 1].trim()) end--;
  var removedLines = end - idx;

  // 3) 认领专属注释：向上跳过空行收集连续 `#` 行，只有注释里出现该 id（或去掉
  //    mcp- 前缀的主体，例如注释写 ansys-fluent）才认为这段注释属于该条目，
  //    否则保留（通用注释块 / 别的条目的说明）。
  var key = want.replace(/^mcp-/, "");
  function claimComment(a, b) {
    var hasComment = false, hit = false;
    for (var z = a; z < b; z++) {
      if (!lines[z].trim()) continue;
      if (/^[ \t]*#/.test(lines[z])) hasComment = true;
      if (lines[z].indexOf(want) >= 0 || (key && key !== want && lines[z].indexOf(key) >= 0)) hit = true;
    }
    return hasComment && hit;
  }
  var c = idx - 1;
  while (c >= 0) {
    var t = lines[c];
    if (!t.trim()) { c--; continue; }
    if (/^[ \t]*#/.test(t)) { c--; continue; }
    break;
  }
  var from = idx;
  var candStart = c + 1;
  if (claimComment(candStart, idx)) {
    from = candStart;
    while (from < idx && !lines[from].trim()) from++;
  }

  // 4) 父级空壳：`- insert:` 下若没有兄弟条目、也没有非注释内容，连父级行一起
  //    删（否则 YAML 留下 `insert: null`，loader 会报错）；此时再把 insert 上方
  //    的专属注释也认领进来，避免留下孤零零的中文说明。
  var p = from - 1;
  while (p >= 0 && !lines[p].trim()) p--;
  var parentDropped = false;
  if (p >= 0) {
    var pm = lines[p].match(/^([ \t]*)(?:-[ \t]*)?(insert|plugins|entries|items):[ \t]*(?:#.*)?$/);
    if (pm && pm[1].length < indent) {
      var pInd = pm[1].length;
      var hasItem = false, hasContent = false;
      var q = p + 1;
      while (q < lines.length) {
        var l2 = lines[q];
        if (!l2.trim()) { q++; continue; }
        if (q >= from && q < end) { q++; continue; }   // 正在删的这段不算「还有内容」
        if (/^[ \t]*/.exec(l2)[0].length <= pInd) break;
        if (/^[ \t]*-[ \t]*id:/.test(l2)) { hasItem = true; break; }
        if (!/^[ \t]*#/.test(l2)) hasContent = true;
        q++;
      }
      if (!hasItem && !hasContent) {
        parentDropped = true;
        var c2 = p - 1;
        while (c2 >= 0) {
          var t2 = lines[c2];
          if (!t2.trim()) { c2--; continue; }
          if (/^[ \t]*#/.test(t2)) { c2--; continue; }
          break;
        }
        var cand2 = c2 + 1;
        // insert: 是自动生成式容器，紧贴在它上面的连续注释几乎必然是它的说明；
        // 但限制 25 行，避免把文件头部的大段说明/许可注释一起吃掉。
        if (cand2 < p && (p - cand2) <= 25) {
          from = cand2;
          while (from < p && !lines[from].trim()) from++;
        }
        // 父级行自身必须落在删除区间内：insert: 上方没有专属注释时 from 仍指向
        // 条目行，只删条目会留下 `- insert:` 空壳（YAML 里就是 insert: null）。
        if (from > p) from = p;
      }
    }
  }
  // 父级行本身落在 [from, end) 内（from <= p < idx < end），一并删除
  var rest = lines.slice(0, from).concat(lines.slice(end));

  // 5) 收口：压缩连续空行、去掉尾部空行、保证单尾换行
  var out = [];
  for (var k = 0; k < rest.length; k++) {
    if (!rest[k].trim() && out.length && !out[out.length - 1].trim()) continue;
    out.push(rest[k]);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return { removed: true, text: out.join(eol) + eol, lines: removedLines, parentDropped: parentDropped };
}

// 受管覆盖块里去掉一个 id（保持即使变成空块也整体移除）
function dropManagedId(text, id) {
  var ids = parseManagedBlock(text);
  if (ids.indexOf(id) < 0) return text;
  var kept = ids.filter(function (x) { return x !== id; });
  var eol = text.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
  var stripped = stripManagedBlock(text);
  if (!kept.length) return /[\r\n]$/.test(stripped) || !stripped.length ? stripped : stripped + eol;
  var block = [MARK_BEGIN];
  kept.slice().sort().forEach(function (x) { block.push("- id: " + x); block.push("  disabled: true"); });
  block.push(MARK_END);
  var base = /[\r\n]$/.test(stripped) || !stripped.length ? stripped : stripped + eol;
  return base + block.join(eol) + eol;
}

// 卸载：从承载文件里删条目块（含专属注释、空壳 insert、受管覆盖），写盘前先备份
export function uninstallMcp(ctx, id) {
  var data = collectMcp(ctx, true);
  var target = null;
  for (var i = 0; i < data.servers.length; i++) if (data.servers[i].id === id) target = data.servers[i];
  if (!target) return { ok: false, error: "找不到 MCP 条目: " + id };

  var file = target.patchFile;
  if (!file || !existsSync(file) || !safeContains(file, id)) file = fallbackPatchFile(id);
  if (!file || !existsSync(file)) {
    return {
      ok: false,
      error: "该条目不在任何 profile 补丁文件里（可能来自内置层或 npm 包自带配置），无法卸载；可以先「停用」"
    };
  }

  var raw = readFileSync(file, "utf8");
  var del = removeEntryBlock(raw, id);
  if (!del.removed) {
    return { ok: false, error: "在 " + basename(file) + " 里没有定位到 id 为 " + id + " 的条目行（" + (del.reason || "") + "）" };
  }
  var out = dropManagedId(del.text, id);
  backupFile(file);
  writeFileSync(file, out, "utf8");

  return {
    ok: true,
    file: file,
    removedLines: del.lines,
    parentDropped: !!del.parentDropped,
    serverName: target.serverName,
    note: "已从 " + basename(file) + " 删除该条目"
      + (del.parentDropped ? "（并清掉了空的 insert: 容器）" : "")
      + "，DSH 用户补丁层会热重载；同时已备份到 ~/.dsh/backups/"
  };
}

// 重连：纯内存重启该条目，不动文件
export async function reconnectMcp(ctx, id) {
  var entry = null;
  try {
    for (var row of ctx.loader.entries()) {
      if (row && row.options && String(row.options.id) === id && row.options.name === MCP_PKG) { entry = row; break; }
    }
  } catch (e) { return { ok: false, error: "loader 不可用: " + (e && e.message) }; }
  if (!entry) return { ok: false, error: "找不到运行中的 MCP 条目: " + id };
  if (entry.disabled) return { ok: false, error: "该 MCP 已停用，请先启用再重连" };
  try {
    var fiber = entry.fiber;
    if (fiber && typeof fiber.update === "function") {
      await fiber.update(entry.options.config, true);
      return { ok: true, note: "已触发该条目的内存重启" };
    }
    return { ok: false, error: "该条目当前没有可重启的 fiber（可能尚未加载）" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// ─────────────────────── 调用统计（jsonl） ───────────────────────

var STATS_MAX_BYTES = 3 * 1024 * 1024;

// v2.0.4 性能：内存缓冲 + 批量 flush（原来是每条工具结果都同步 appendFileSync
// + statSync，高频 MCP 调用会阻塞宿主事件循环，导致界面一卡一卡）。
var _mcpQueue = [];
var _mcpFlushTimer = null;
var MCP_FLUSH_BATCH = 20;
var MCP_FLUSH_DELAY_MS = 3000;

function flushMcpStats() {
  if (_mcpFlushTimer) { try { clearTimeout(_mcpFlushTimer); } catch (e) { } _mcpFlushTimer = null; }
  if (!_mcpQueue.length) return;
  var batch = _mcpQueue;
  _mcpQueue = [];
  try {
    mkdirSync(dataDir(), { recursive: true });
    appendFileSync(mcpStatsFile(), batch.map(function (r) { return JSON.stringify(r); }).join("\n") + "\n", "utf8");
    try {
      var st = statSync(mcpStatsFile());
      if (st.size > STATS_MAX_BYTES) compactStats();
    } catch (e2) { /* ignore */ }
  } catch (e) {
    // 写盘失败：回塞（限量，绝不无限膨胀）
    _mcpQueue = batch.concat(_mcpQueue).slice(-500);
  }
}

export function recordMcpCall(server, tool, ok, err, durMs) {
  try {
    var rec = { ts: Date.now(), server: server, tool: tool, ok: !!ok, dur: durMs || 0 };
    if (!ok && err) rec.err = String(err).slice(0, 200);
    _mcpQueue.push(rec);
    if (_mcpQueue.length > 2000) _mcpQueue.splice(0, _mcpQueue.length - 2000);
    if (_mcpQueue.length >= MCP_FLUSH_BATCH) {
      flushMcpStats();
    } else if (!_mcpFlushTimer) {
      _mcpFlushTimer = setTimeout(function () { _mcpFlushTimer = null; flushMcpStats(); }, MCP_FLUSH_DELAY_MS);
    }
  } catch (e) { /* 统计失败绝不影响工具调用 */ }
}
export { flushMcpStats };

function readStatsLines() {
  var file = mcpStatsFile();
  if (!existsSync(file)) return [];
  var out = [];
  try {
    var txt = readFileSync(file, "utf8");
    var lines = txt.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      try { out.push(JSON.parse(s)); } catch (e) { /* 跳过坏行 */ }
    }
  } catch (e) { /* ignore */ }
  return out;
}

function compactStats() {
  try {
    var rows = readStatsLines();
    var keep = rows.slice(-3000);
    writeFileSync(mcpStatsFile(), keep.map(function (r) { return JSON.stringify(r); }).join("\n") + "\n", "utf8");
  } catch (e) { /* ignore */ }
}

export function getMcpStats(opts) {
  opts = opts || {};
  flushMcpStats(); // 先落盘缓冲，保证读到最新
  var since = opts.since ? Number(opts.since) : 0;
  var rows = readStatsLines();
  var byServer = {};
  var total = { calls: 0, ok: 0, fail: 0 };
  var now = Date.now();
  var series = {}; // 最近 24h 按小时
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || typeof r.ts !== "number") continue;
    if (since && r.ts < since) continue;
    var key = r.server || "(unknown)";
    var b = byServer[key] || (byServer[key] = { server: key, calls: 0, ok: 0, fail: 0, lastTs: 0, tools: {} });
    b.calls++; total.calls++;
    if (r.ok) { b.ok++; total.ok++; } else { b.fail++; total.fail++; }
    if (r.ts > b.lastTs) b.lastTs = r.ts;
    var tk = r.tool || "(unknown)";
    var tob = b.tools[tk] || (b.tools[tk] = { tool: tk, calls: 0, ok: 0, fail: 0, lastTs: 0, lastErr: "", durSum: 0 });
    tob.calls++;
    if (r.ok) tob.ok++; else { tob.fail++; if (r.err) tob.lastErr = String(r.err).slice(0, 160); }
    if (r.ts > tob.lastTs) tob.lastTs = r.ts;
    tob.durSum += (r.dur || 0);
    if (now - r.ts < 24 * 3600 * 1000) {
      var h = new Date(r.ts).getHours();
      series[h] = (series[h] || 0) + 1;
    }
  }
  var servers = Object.keys(byServer).map(function (k) {
    var b = byServer[k];
    var toolArr = Object.keys(b.tools).map(function (t) {
      var x = b.tools[t];
      return { tool: x.tool, calls: x.calls, ok: x.ok, fail: x.fail, lastTs: x.lastTs, lastErr: x.lastErr, avgDur: x.calls ? Math.round(x.durSum / x.calls) : 0 };
    }).sort(function (a, c) { return c.calls - a.calls; });
    var top = toolArr.slice(0, 10).map(function (x) { return { tool: x.tool, calls: x.calls }; });
    return { server: b.server, calls: b.calls, ok: b.ok, fail: b.fail, lastTs: b.lastTs, topTools: top, tools: toolArr };
  }).sort(function (a, b) { return b.calls - a.calls; });
  var hourly = [];
  for (var hh = 0; hh < 24; hh++) hourly.push(series[hh] || 0);
  return { ok: true, ts: now, total: total, servers: servers, hourly: hourly, file: mcpStatsFile() };
}

export function clearMcpStats() {
  try {
    _mcpQueue = [];
    if (_mcpFlushTimer) { try { clearTimeout(_mcpFlushTimer); } catch (e) { } _mcpFlushTimer = null; }
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(mcpStatsFile(), "", "utf8");
    return { ok: true, note: "调用统计已清空" };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ─────────────────────── 导出 ───────────────────────

export function exportMcp(ctx, opts) {
  opts = opts || {};
  var mask = !!opts.mask;
  var data = collectMcp(ctx, true);
  // collectMcp 的 env/headers 是打码值（UI 展示用）；导出需要原始值，
  // 这里直接回读 loader 里每个条目的 config。
  var rawById = {};
  try {
    for (var row of ctx.loader.entries()) {
      if (row && row.options && row.options.name === MCP_PKG) rawById[String(row.options.id)] = row.options.config || {};
    }
  } catch (e) { /* ignore */ }
  var mcpServers = {};
  data.servers.forEach(function (s) {
    var cfg = rawById[s.id] || {};
    var env = (cfg.env && typeof cfg.env === "object") ? cfg.env : null;
    var headers = (cfg.headers && typeof cfg.headers === "object") ? cfg.headers : null;
    var o = {};
    if (s.transport === "stdio") {
      o.command = s.command;
      if (s.args && s.args.length) o.args = s.args.slice();
      if (s.cwd) o.cwd = s.cwd;
    } else {
      o.url = s.url;
    }
    if (env) {
      o.env = {};
      Object.keys(env).forEach(function (k) {
        o.env[k] = mask && SENSITIVE_RE.test(k) ? maskValue(String(env[k])) : String(env[k]);
      });
    }
    if (headers) {
      o.headers = {};
      Object.keys(headers).forEach(function (k) {
        o.headers[k] = mask && SENSITIVE_RE.test(k) ? maskValue(String(headers[k])) : String(headers[k]);
      });
    }
    mcpServers[s.serverName] = o;
  });
  return { ok: true, mcpServers: mcpServers };
}

// ─────────────────── v2.0.5 MCP 残留检测与清理 ───────────────────
// 场景：某 MCP 的包被卸载后，profile 的 cordis.patch.yml 里仍留着指向它的
// 配置块（第三方包自写的 `# >>> pkg: ... >>>` 机器块，或本插件的受管覆盖块）。
// 这些块会让 HMR 每次报 `patch: entry "X" not found`。这里提供检测 + 清理：
// 只删「整块内所有 id 都已不在运行树、且对应包已不在 node_modules」的块，
// 避免误删仍然有效的配置。
function _normId(id) { return String(id || "").replace(/^include:/, ""); }

function _profilePatchFiles() {
  var files = [];
  try {
    var roots = [];
    if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, "profiles"));
    else roots.push(join(homedir(), ".dsh", "profiles"));
    var seen = {};
    roots.forEach(function (base) {
      if (!existsSync(base)) return;
      readdirSync(base).forEach(function (name) {
        var f = join(base, name, "cordis.patch.yml");
        if (!existsSync(f) || seen[f]) return;
        seen[f] = true;
        try { if (readFileSync(f, "utf8").indexOf(MCP_PKG) >= 0) files.push(f); } catch (e) { }
      });
    });
  } catch (e) { }
  return files;
}

function _liveIds(ctx) {
  var live = {};
  try {
    for (var row of ctx.loader.entries()) if (row && row.options && row.options.id) live[_normId(row.options.id)] = true;
  } catch (e) { }
  return live;
}

function _pkgInstalled(name) {
  if (!name) return false;
  try {
    var roots = [];
    if (process.env.DSH_HOME) roots.push(join(process.env.DSH_HOME, "profiles"));
    else roots.push(join(homedir(), ".dsh", "profiles"));
    for (var r = 0; r < roots.length; r++) {
      var base = roots[r];
      if (!existsSync(base)) continue;
      var names = readdirSync(base);
      for (var i = 0; i < names.length; i++) if (existsSync(join(base, names[i], "node_modules", name))) return true;
    }
    if (existsSync(join(process.env.DSH_HOME || join(homedir(), ".dsh"), "local-plugins", name))) return true;
  } catch (e) { }
  return false;
}

function _lineIds(lines, start, end) {
  var ids = [];
  for (var i = start; i <= end; i++) {
    var m = /^\s*-\s*id:\s*([^\s#]+)/.exec(lines[i] || "");
    if (m) ids.push(m[1].replace(/^['"]|['"]$/g, ""));
  }
  return ids;
}

function _scanResidueFile(file, live) {
  var out = [];
  var txt;
  try { txt = readFileSync(file, "utf8"); } catch (e) { return out; }
  var lines = txt.split(/\r?\n/);
  var allGoneOf = function (ids) { return ids.length > 0 && ids.every(function (id) { return !live[_normId(id)]; }); };
  // 1) 本插件受管块
  var i = 0;
  while (i < lines.length) {
    if (lines[i].indexOf(MARK_BEGIN) >= 0) {
      var e = -1;
      for (var j = i + 1; j < lines.length; j++) if (lines[j].indexOf(MARK_END) >= 0) { e = j; break; }
      if (e < 0) break;
      var ids = _lineIds(lines, i, e);
      if (allGoneOf(ids)) out.push({ file: file, kind: "managed", start: i, end: e, ids: ids, reason: "本插件的受管覆盖块指向的条目已不存在" });
      i = e + 1; continue;
    }
    i++;
  }
  // 2) 第三方机器块  # >>> name: ... >>>  ...  # <<< name <<<
  var stack = [];
  for (var k = 0; k < lines.length; k++) {
    var mb = /^#\s*>>>\s*([^:>]+?)\s*:/.exec(lines[k]);
    if (mb) { stack.push({ name: mb[1].trim(), start: k }); continue; }
    var me = /^#\s*<<<\s*(.+?)\s*<<</.exec(lines[k]);
    if (me && stack.length) {
      var blk = stack.pop();
      var ids2 = _lineIds(lines, blk.start, k);
      if (allGoneOf(ids2) && !_pkgInstalled(blk.name)) {
        out.push({ file: file, kind: "pkg", start: blk.start, end: k, ids: ids2, pkg: blk.name, reason: "包 " + blk.name + " 已不在 node_modules，配置块指向的条目不存在" });
      }
    }
  }
  return out;
}

export function detectMcpResidue(ctx) {
  var live = _liveIds(ctx);
  var residue = [];
  _profilePatchFiles().forEach(function (f) { residue = residue.concat(_scanResidueFile(f, live)); });
  return { ok: true, count: residue.length, residue: residue };
}

export function cleanMcpResidue(ctx) {
  var det = detectMcpResidue(ctx);
  if (!det.count) return { ok: true, cleaned: 0, note: "没有检测到残留，配置是干净的" };
  var byFile = {};
  det.residue.forEach(function (r) { (byFile[r.file] = byFile[r.file] || []).push(r); });
  var cleaned = 0, details = [];
  Object.keys(byFile).forEach(function (file) {
    try {
      var txt = readFileSync(file, "utf8");
      var eol = txt.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
      var lines = txt.split(/\r?\n/);
      backupFile(file);
      var ranges = byFile[file].slice().sort(function (a, b) { return b.start - a.start; });
      ranges.forEach(function (r) {
        lines.splice(r.start, r.end - r.start + 1);
        cleaned++;
        details.push({ kind: r.kind, ids: r.ids, pkg: r.pkg || "" });
      });
      writeFileSync(file, lines.join(eol), "utf8");
      _mcpListCache = { ts: 0, data: null }; // 配置变了，失效列表缓存
    } catch (e) { details.push({ file: file, error: String((e && e.message) || e) }); }
  });
  return { ok: true, cleaned: cleaned, details: details };
}

// ── MCP 市场安装：新增一条 MCP（写入 profile 补丁文件的 insert 块）──
// spec = { name, transport:'stdio'|'streamable-http', command, args[], env{}, cwd, url, headers{},
//          toolCallTimeoutMs, failOnStartupError }
function _yamlValue(v) {
  // YAML 安全引号：非「保守安全裸标量」的值一律单引号包裹（内部单引号转义为 ''）。
  // 保守安全 = 字母/数字/下划线开头 + 字母数字下划线点斜杠短横线，或纯数字。
  // 这样 @deepseek-ai/dsh-mcp-client、含空格的路径、以 - 开头的参数等都会被安全引用，
  // 避免裸写 @ 开头 / - 开头等导致解析失败。
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  var s = String(v);
  if (s === "") return "''";
  var safe = /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(s) || /^[+-]?\d+(\.\d+)?$/.test(s);
  if (!safe) return "'" + s.replace(/'/g, "''") + "'";
  return s;
}

// 找最后一个顶格 `- insert:` 块（不越过 MARK_BEGIN），返回 {start, end}
// 可指定 preferPackage：若传入则优先返回「块内含该包名」的最后一个 insert 块。
function _findLastInsertBlock(lines, markBeginLine, preferPackage) {
  var tops = [];
  for (var i = 0; i < lines.length; i++) {
    if (lines[i] === "" || lines[i][0] === " " || lines[i][0] === "\t") continue; // 缩进行不是顶格 insert
    if (/^- insert:/.test(lines[i])) tops.push(i);
  }
  if (!tops.length) return null;
  // 计算每个 insert 块的结束行（下一行顶格非缩进行，或 MARK_BEGIN，或 EOF）
  var bounds = tops.map(function (start) {
    var end = lines.length;
    for (var j = start + 1; j < lines.length; j++) {
      if (lines[j] === "" || lines[j][0] === " " || lines[j][0] === "\t") continue;
      if (markBeginLine >= 0 && j >= markBeginLine) { end = markBeginLine; break; }
      end = j; break;
    }
    return { start: start, end: end };
  });
  // 过滤：start 必须在 MARK_BEGIN 之前
  var usable = bounds.filter(function (b) { return markBeginLine < 0 || b.start < markBeginLine; });
  if (!usable.length) return null;
  if (preferPackage) {
    for (var p = usable.length - 1; p >= 0; p--) {
      var chunk = lines.slice(usable[p].start, usable[p].end).join("\n");
      if (chunk.indexOf(preferPackage) >= 0) return usable[p];
    }
  }
  return usable[usable.length - 1];
}

function _buildInsertLines(spec, id, eol) {
  var L = [];
  var pad = "    "; // 条目行缩进 4
  var pad6 = "      "; // 字段缩进 6
  L.push(pad + "- id: " + id);
  L.push(pad6 + "name: " + _yamlValue(MCP_PKG));
  L.push(pad6 + "config:");
  var c8 = "        ";
  L.push(c8 + "serverName: " + _yamlValue(spec.name));
  L.push(c8 + "transport: " + _yamlValue(spec.transport));
  if (spec.transport === "stdio") {
    if (spec.command) L.push(c8 + "command: " + _yamlValue(spec.command));
    if (Array.isArray(spec.args) && spec.args.length) {
      L.push(c8 + "args:");
      spec.args.forEach(function (a) { L.push(c8 + "  - " + _yamlValue(a)); });
    }
    if (spec.cwd) L.push(c8 + "cwd: " + _yamlValue(spec.cwd));
  } else {
    if (spec.url) L.push(c8 + "url: " + _yamlValue(spec.url));
  }
  if (spec.env && typeof spec.env === "object") {
    var envKeys = Object.keys(spec.env);
    if (envKeys.length) {
      L.push(c8 + "env:");
      envKeys.forEach(function (k) { L.push(c8 + "  " + _yamlValue(k) + ": " + _yamlValue(spec.env[k])); });
    }
  }
  if (spec.headers && typeof spec.headers === "object") {
    var hKeys = Object.keys(spec.headers);
    if (hKeys.length) {
      L.push(c8 + "headers:");
      hKeys.forEach(function (k) { L.push(c8 + "  " + _yamlValue(k) + ": " + _yamlValue(spec.headers[k])); });
    }
  }
  L.push(c8 + "failOnStartupError: " + (spec.failOnStartupError === true ? "true" : "false"));
  var tmo = typeof spec.toolCallTimeoutMs === "number" && spec.toolCallTimeoutMs > 0 ? spec.toolCallTimeoutMs : 60000;
  L.push(c8 + "toolCallTimeoutMs: " + tmo);
  return L;
}

// 确认新内容里是否已存在该 id 的条目（文本级查重，用于热重载未生效时兜底）
function _textHasEntryId(text, id) {
  var re = new RegExp("(?:^|\\n)[ \\t]*" + "- id: " + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:\\n|$)", "m");
  return re.test(text);
}

export function installMcp(ctx, spec) {
  try {
    spec = spec || {};
    var name = String(spec.name || "").trim();
    var transport = String(spec.transport || "").trim();

    // ① 字段校验
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) {
      return { ok: false, error: "serverName 只能是 1~32 位字母数字下划线短横线" };
    }
    if (transport !== "stdio" && transport !== "streamable-http") {
      return { ok: false, error: "transport 只能是 stdio 或 streamable-http" };
    }
    if (transport === "stdio" && !spec.command) {
      return { ok: false, error: "stdio 传输必须提供 command" };
    }
    if (transport === "streamable-http" && !spec.url) {
      return { ok: false, error: "streamable-http 传输必须提供 url" };
    }

    var id = "mcp-" + name;

    // ② 查重（registry/当前已配置）
    var data = collectMcp(ctx, true);
    var exists = null;
    for (var i = 0; i < data.servers.length; i++) {
      if (String(data.servers[i].serverName).toLowerCase() === name.toLowerCase()) { exists = data.servers[i]; break; }
    }
    if (exists) {
      return { ok: false, error: "已存在同名 MCP（serverName: " + name + "），请先卸载或在配置里改名" };
    }

    // ③ 定位 patch 文件
    var file = null;
    for (var j = 0; j < data.servers.length; j++) {
      if (data.servers[j].patchFile && existsSync(data.servers[j].patchFile)) { file = data.servers[j].patchFile; break; }
    }
    if (!file) file = fallbackPatchFile("mcp-" + name);
    if (!file) {
      var fallback = join(homedir(), ".dsh", "profiles", "desktop", "cordis.patch.yml");
      if (existsSync(fallback)) file = fallback;
    }
    if (!file || !existsSync(file)) {
      return { ok: false, error: "无法定位可写的 profile 补丁文件（cordis.patch.yml）" };
    }

    // ⑧ 文本级查重：热重载未生效时 collectMcp 可能看不到，直接查文件文本
    var raw = readFileSync(file, "utf8");
    if (_textHasEntryId(raw, id)) {
      return { ok: false, error: "已存在同名 MCP（serverName: " + name + "），请先卸载或在配置里改名" };
    }

    // ④ 生成条目文本
    var eol = raw.indexOf("\r\n") >= 0 ? "\r\n" : "\n";
    var lines = raw.split(/\r?\n/);

    // ⑤ 找最后一个顶格 insert 块（避开受管块）
    var markBeginLine = -1;
    for (var m = 0; m < lines.length; m++) {
      if (lines[m].indexOf(MARK_BEGIN) >= 0) { markBeginLine = m; break; }
    }
    var blk = _findLastInsertBlock(lines, markBeginLine, MCP_PKG);
    var insertLines = _buildInsertLines(spec, id, eol);
    var out;

    if (blk) {
      // 追加到该块已有条目之后（保持 4 空格缩进）
      var head = lines.slice(0, blk.end).join(eol);
      out = head + eol + insertLines.join(eol) + (blk.end < lines.length ? eol + lines.slice(blk.end).join(eol) : "");
    } else {
      // 无 insert 块：在 MARK_BEGIN 之前（或文件末尾）新建一个 insert 块
      var anchor = markBeginLine >= 0 ? markBeginLine : lines.length;
      var prefix = lines.slice(0, anchor).join(eol);
      out = prefix + (prefix.length ? eol : "") + "# ---- MCP 市场安装 ----" + eol + "- insert:" + eol +
        insertLines.join(eol) + (anchor < lines.length ? eol + lines.slice(anchor).join(eol) : "");
    }

    // ⑥ 写盘（先备份）
    backupFile(file);
    writeFileSync(file, out, "utf8");
    _mcpListCache = { ts: 0, data: null }; // 配置变了，失效列表缓存

    // ⑦ 返回
    return {
      ok: true,
      file: file,
      id: id,
      serverName: name,
      note: "配置已写入，DSH 补丁层会热重载（1~2 秒后可在 MCP 页看到）"
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

export var MCP_META = { pkg: MCP_PKG, markBegin: MARK_BEGIN, markEnd: MARK_END };
