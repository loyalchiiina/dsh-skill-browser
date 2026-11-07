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

function dataDir() { return join(homedir(), ".dsh", "data", "dsh-skill-browser"); }
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

export var MCP_META = { pkg: MCP_PKG, markBegin: MARK_BEGIN, markEnd: MARK_END };
