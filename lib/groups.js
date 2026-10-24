// dsh-skill-browser - v1.9.0 user-defined view groups (分组).
//
// A "group" is a PURELY VISUAL bucket: it never moves, copies, renames or
// deletes any skill file. Skills keep living where they are on disk; a group
// only records "these skill dirs belong together in the panel".
//
// Storage: ~/.dsh/data/dsh-skill-browser/groups.json
//   {
//     "version": 2,
//     "groups": [ { id, name, emoji, color, cover, createdAt, ai, parent } ],
//     "assign": { "<skill-dir>": "<group-id>" }
//   }
//
// `cover` holds a raw <svg>…</svg> string produced by the AI cover generator
// (or "" when unset). The client turns it into a data: URI background.
//
// v1.9.3 — two-level (总-分) groups. `parent` is "" for a top-level DOMAIN and
// the domain's id for a SUB-GROUP. Depth is capped at 2: a group whose parent
// is itself a sub-group is promoted back to top level on load. A skill may be
// assigned either to a sub-group or directly to a domain (meaning "this domain,
// no finer sub-class"), so nothing is ever forced into a fake "其他" bin.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { categoriesMeta } from "./scan.js";
// NOTE: @deepseek-ai/dsh-llm is an OPTIONAL peer. It is imported lazily inside
// askModel() so a host without the package still loads this plugin (the AI
// buttons then report "llm service unavailable" instead of breaking everything).
var _llmMod = null;
// llm is an OPTIONAL capability: read it through ctx.get() so the plugin still
// loads on a host/profile that has no llm service (official rule: reserve
// ctx.<name> for declared injections, use ctx.get() for optional services).
function getLlm(ctx) {
  if (!ctx) return null;
  try {
    if (typeof ctx.get === "function") return ctx.get("llm") || null;
  } catch (e) { /* service absent */ }
  return ctx.llm || null;
}
async function loadLlm() {
  if (_llmMod) return _llmMod;
  // Test seam: lets the offline smoke test drive the AI paths without a live
  // model. Unset in normal runs, so production always resolves the real module.
  if (globalThis.__DSB_TEST_LLM__) { _llmMod = globalThis.__DSB_TEST_LLM__; return _llmMod; }
  try { _llmMod = await import("@deepseek-ai/dsh-llm"); }
  catch (e) { throw new Error("宿主未提供 llm 服务（@deepseek-ai/dsh-llm 不可用）：" + String((e && e.message) || e)); }
  return _llmMod;
}

var STORE_FILE = join(homedir(), ".dsh", "data", "dsh-skill-browser", "groups.json");
// Two levels (domain -> sub-group) means a 109-skill library can legitimately
// need 10 domains x 5 sub-groups, so the cap has to be generous.
var MAX_GROUPS = 160;
var MAX_NAME = 24;

// ── store i/o ───────────────────────────────────────────────────────────
function emptyStore() {
  return { version: 2, groups: [], assign: {} };
}

export function loadStore() {
  try {
    if (!existsSync(STORE_FILE)) return emptyStore();
    // Tolerate a BOM (the file may be hand-edited in Notepad).
    var parsed = JSON.parse(String(readFileSync(STORE_FILE, "utf8")).replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object") return emptyStore();
    var groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    var assign = parsed.assign && typeof parsed.assign === "object" ? parsed.assign : {};
    var clean = [];
    var byId = {};
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g || typeof g.id !== "string" || !g.id) continue;
      var item = {
        id: g.id,
        name: String(g.name || "").slice(0, MAX_NAME) || "未命名分组",
        emoji: String(g.emoji || "📁"),
        color: String(g.color || ""),
        cover: typeof g.cover === "string" ? g.cover : "",
        ai: !!g.ai,
        parent: typeof g.parent === "string" ? g.parent : "",
        createdAt: Number(g.createdAt) || 0
      };
      clean.push(item);
      byId[item.id] = item;
    }
    // Depth is capped at 2: a sub-group whose parent is itself a sub-group (or
    // a missing id) is promoted to a top-level domain instead of being dropped -
    // losing a user's grouping is worse than flattening it.
    for (var p = 0; p < clean.length; p++) {
      if (!clean[p].parent) continue;
      var par = byId[clean[p].parent];
      if (!par || par.id === clean[p].id) { clean[p].parent = ""; continue; }
      if (par.parent) clean[p].parent = "";
    }
    var assignClean = {};
    for (var k in assign) {
      if (!Object.prototype.hasOwnProperty.call(assign, k)) continue;
      if (typeof assign[k] === "string" && assign[k]) assignClean[k] = assign[k];
    }
    return { version: 2, groups: clean, assign: assignClean };
  } catch (e) {
    // A corrupt or half-written store must NEVER be silently downgraded to an
    // empty one - the next save would then overwrite the user real groups.
    var err = new Error("groups.json 读取失败（文件可能损坏）：" + String((e && e.message) || e));
    err.code = "STORE_CORRUPT";
    throw err;
  }
}

export function saveStore(store) {
  try {
    mkdirSync(dirname(STORE_FILE), { recursive: true });
    // Rolling backup: a bad write can never lose the user groups.
    try {
      if (existsSync(STORE_FILE)) {
        var prev = readFileSync(STORE_FILE, "utf8");
        if (prev && prev.trim()) writeFileSync(STORE_FILE + ".bak", prev, "utf8");
      }
    } catch (eBak) { /* best-effort */ }
    writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
    return true;
  } catch (e) { return false; }
}

export function storePath() { return STORE_FILE; }

// Group ids are generated, never user-supplied, so the charset is ours.
function newId() {
  return "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function sanitizeName(name) {
  return String(name == null ? "" : name).replace(/[\r\n\t]/g, " ").trim().slice(0, MAX_NAME);
}

// Keep only assignments that still point at an existing group.
function pruneAssign(store, validDirs) {
  var ids = {};
  for (var i = 0; i < store.groups.length; i++) ids[store.groups[i].id] = true;
  var out = {};
  for (var d in store.assign) {
    if (!Object.prototype.hasOwnProperty.call(store.assign, d)) continue;
    var gid = store.assign[d];
    if (!ids[gid]) continue;
    if (validDirs && validDirs.indexOf(d) < 0) continue;
    out[d] = gid;
  }
  return out;
}

// ── CRUD ────────────────────────────────────────────────────────────────
export function listGroups(validDirs) {
  var store = loadStore();
  var assign = pruneAssign(store, validDirs || null);
  // Only persist the pruned map when the caller actually supplied a live skill
  // list. With validDirs === null a temporarily unreadable skill root must not
  // permanently delete the user's group assignments.
  if (validDirs && Object.keys(assign).length !== Object.keys(store.assign).length) {
    store.assign = assign;
    saveStore(store);
  }
  var members = {};
  for (var i = 0; i < store.groups.length; i++) members[store.groups[i].id] = [];
  for (var d in assign) {
    if (!Object.prototype.hasOwnProperty.call(assign, d)) continue;
    if (members[assign[d]]) members[assign[d]].push(d);
  }
  var out = [];
  for (var j = 0; j < store.groups.length; j++) {
    var g = store.groups[j];
    out.push({
      id: g.id, name: g.name, emoji: g.emoji, color: g.color,
      cover: g.cover, ai: g.ai, parent: g.parent || "", createdAt: g.createdAt,
      members: members[g.id] || []
    });
  }
  // childCount / total are what the client shows on a domain tile: `total`
  // includes every skill in the domain's sub-groups so "Fluent 81" stays true
  // even when the domain itself holds no direct members.
  for (var a = 0; a < out.length; a++) {
    var kids = [];
    for (var b = 0; b < out.length; b++) if (out[b].parent === out[a].id) kids.push(out[b].id);
    out[a].children = kids;
    var total = out[a].members.length;
    for (var c = 0; c < kids.length; c++) {
      for (var e = 0; e < out.length; e++) if (out[e].id === kids[c]) total += out[e].members.length;
    }
    out[a].total = total;
  }
  return { ok: true, storePath: STORE_FILE, groups: out, assign: assign };
}

export function createGroup(name, emoji, color, parent) {
  var store = loadStore();
  if (store.groups.length >= MAX_GROUPS) {
    return { ok: false, error: "分组数量已达上限 " + MAX_GROUPS };
  }
  var nm = sanitizeName(name);
  if (!nm) return { ok: false, error: "分组名称不能为空" };
  var par = String(parent || "");
  if (par) {
    var host = null;
    for (var h = 0; h < store.groups.length; h++) if (store.groups[h].id === par) host = store.groups[h];
    if (!host) return { ok: false, error: "上级分组不存在：" + par };
    if (host.parent) return { ok: false, error: "只支持两级分组：不能在大类下再建子类（" + host.name + " 已是子类）" };
  }
  // Same-name check is scoped to the parent so "安装" can exist under both
  // DSH and 软件安装.
  for (var i = 0; i < store.groups.length; i++) {
    if (store.groups[i].name === nm && (store.groups[i].parent || "") === par) {
      return { ok: false, error: "同级下已存在同名分组：" + nm };
    }
  }
  var g = {
    id: newId(), name: nm,
    emoji: String(emoji || "📁").slice(0, 8),
    color: String(color || ""),
    cover: "", ai: false, parent: par, createdAt: Date.now()
  };
  store.groups.push(g);
  var saved = saveStore(store);
  return { ok: saved, group: g, storePath: STORE_FILE, error: saved ? "" : "写入失败" };
}

export function renameGroup(id, name, emoji, color) {
  var store = loadStore();
  for (var i = 0; i < store.groups.length; i++) {
    if (store.groups[i].id !== id) continue;
    if (name != null) {
      var nm = sanitizeName(name);
      if (!nm) return { ok: false, error: "分组名称不能为空" };
      store.groups[i].name = nm;
    }
    if (emoji != null) store.groups[i].emoji = String(emoji).slice(0, 8) || "📁";
    if (color != null) store.groups[i].color = String(color);
    var saved = saveStore(store);
    return { ok: saved, group: store.groups[i], error: saved ? "" : "写入失败" };
  }
  return { ok: false, error: "分组不存在：" + id };
}

export function deleteGroup(id) {
  var store = loadStore();
  // Deleting a domain takes its sub-groups with it - a sub-group floating
  // without its domain would be unreachable in the two-level UI.
  var doomed = {};
  doomed[id] = true;
  var grew = true;
  while (grew) {
    grew = false;
    for (var w = 0; w < store.groups.length; w++) {
      var gp = store.groups[w];
      if (doomed[gp.id]) continue;
      if (gp.parent && doomed[gp.parent]) { doomed[gp.id] = true; grew = true; }
    }
  }
  var kept = [];
  var found = false;
  for (var i = 0; i < store.groups.length; i++) {
    if (doomed[store.groups[i].id]) { found = true; continue; }
    kept.push(store.groups[i]);
  }
  if (!found) return { ok: false, error: "分组不存在：" + id };
  store.groups = kept;
  for (var d in store.assign) {
    if (!Object.prototype.hasOwnProperty.call(store.assign, d)) continue;
    if (doomed[store.assign[d]]) delete store.assign[d];
  }
  var saved = saveStore(store);
  return { ok: saved, removed: Object.keys(doomed).length, error: saved ? "" : "写入失败" };
}

// Re-parent a group: parent === "" promotes it to a top-level domain, any other
// id makes it a sub-group of that domain. Moving a domain that owns sub-groups
// is refused - that would create a third level.
export function moveGroup(id, parent) {
  var store = loadStore();
  var par = String(parent || "");
  var target = null;
  for (var i = 0; i < store.groups.length; i++) if (store.groups[i].id === id) target = store.groups[i];
  if (!target) return { ok: false, error: "分组不存在：" + id };
  if (par === id) return { ok: false, error: "不能把分组挂到自己下面" };
  if (par) {
    var host = null;
    for (var j = 0; j < store.groups.length; j++) if (store.groups[j].id === par) host = store.groups[j];
    if (!host) return { ok: false, error: "上级分组不存在：" + par };
    if (host.parent) return { ok: false, error: "只支持两级分组：目标已是大类下的子类" };
    for (var k = 0; k < store.groups.length; k++) {
      if (store.groups[k].parent === id) return { ok: false, error: "该分组下已有子类，不能再降为子类" };
    }
  }
  target.parent = par;
  var saved = saveStore(store);
  return { ok: saved, group: target, error: saved ? "" : "写入失败" };
}

// Move a skill into a group (gid === "" or null removes it from any group).
// NOTE: this touches NOTHING on disk except groups.json — the skill directory
// itself is never moved.
export function assignSkill(dir, gid) {
  var store = loadStore();
  var d = String(dir || "");
  if (!d) return { ok: false, error: "缺少技能目录名" };
  if (gid === undefined || gid === null) return { ok: false, error: "缺少目标分组 id（传空字符串表示移出分组）" };
  if (!gid) {
    delete store.assign[d];
  } else {
    var exists = false;
    for (var i = 0; i < store.groups.length; i++) {
      if (store.groups[i].id === gid) { exists = true; break; }
    }
    if (!exists) return { ok: false, error: "分组不存在：" + gid };
    store.assign[d] = gid;
  }
  var saved = saveStore(store);
  return { ok: saved, dir: d, gid: gid || "", error: saved ? "" : "写入失败" };
}

// Bulk assign: {dirs:[...], gid} or {dirs:[...], gid:""} to clear.
export function assignSkills(dirs, gid) {
  var store = loadStore();
  if (gid) {
    var exists = false;
    for (var i = 0; i < store.groups.length; i++) {
      if (store.groups[i].id === gid) { exists = true; break; }
    }
    if (!exists) return { ok: false, error: "分组不存在：" + gid };
  }
  var n = 0;
  for (var j = 0; j < dirs.length; j++) {
    var d = String(dirs[j] || "");
    if (!d) continue;
    if (gid) store.assign[d] = gid; else delete store.assign[d];
    n++;
  }
  var saved = saveStore(store);
  return { ok: saved, count: n, gid: gid || "", error: saved ? "" : "写入失败" };
}

export function setGroupCover(id, svg) {
  var store = loadStore();
  for (var i = 0; i < store.groups.length; i++) {
    if (store.groups[i].id !== id) continue;
    store.groups[i].cover = typeof svg === "string" ? svg : "";
    var saved = saveStore(store);
    return { ok: saved, group: store.groups[i], error: saved ? "" : "写入失败" };
  }
  return { ok: false, error: "分组不存在：" + id };
}

// ── LLM plumbing (same contract as dsh-qq-digest: ctx.llm.stream) ────────
//
// Model discovery is deliberately FOUR-STAGE so that a fresh install needs
// ZERO configuration: the user installs the plugin, clicks 🤖, and it uses the
// very model they are chatting with.
//
//   1. plugin config   —— cfg.provider + cfg.model (explicit override, optional)
//   2. agentDefaultModel —— the "default model" in DSH settings, which is what
//      the chat itself uses. This is the zero-config path for ~everyone.
//   3. ctx.agent / agents —— the live agent's own selection (per-session model
//      switches, e.g. user picked a model just for this conversation).
//   4. llm.listProviders() + listModels() —— last resort: ask the host which
//      providers/models actually exist right now and take the first one. This
//      keeps working even when no default was ever saved.
//
// Every stage is guarded; a missing service just falls through to the next.

/** Stage 2: the default model selected in DSH settings (same one chat uses). */
function routeFromDefaultModel(ctx) {
  try {
    var svc = typeof ctx.get === "function" ? ctx.get("agentDefaultModel") : ctx.agentDefaultModel;
    if (!svc) return null;
    var sel = typeof svc.currentSelection === "function" ? svc.currentSelection() : null;
    if (sel && sel.provider && sel.model) {
      return {
        provider: String(sel.provider),
        model: String(sel.model),
        source: "dsh-default",
        reasoningEffort: sel.reasoningEffort ? String(sel.reasoningEffort) : ""
      };
    }
  } catch (e) { /* fall through */ }
  return null;
}

/** Stage 3: the live agent's own selection (per-session model switch). */
function routeFromAgent(ctx) {
  try {
    var ag = ctx.agent || (typeof ctx.get === "function" ? ctx.get("agent") : null);
    if (!ag) return null;
    // dsh-agent installs a mutable selection; shapes seen in the wild:
    //   ag.selection.current = {provider, model, reasoningEffort}
    //   ag.model = {provider, model}
    var cands = [
      ag.selection && ag.selection.current,
      ag.selection,
      ag.model,
      ag.modelSelection && ag.modelSelection.current
    ];
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i];
      if (c && c.provider && c.model) {
        return {
          provider: String(c.provider),
          model: String(c.model),
          source: "agent-session",
          reasoningEffort: c.reasoningEffort ? String(c.reasoningEffort) : ""
        };
      }
    }
  } catch (e) { /* fall through */ }
  return null;
}

/** Stage 4: ask the host which providers/models are actually registered. */
async function routeFromLlmCatalog(ctx) {
  var llm = getLlm(ctx);
  if (!llm || typeof llm.listProviders !== "function") return null;
  var provs = [];
  try { provs = llm.listProviders() || []; } catch (e) { return null; }
  for (var i = 0; i < provs.length; i++) {
    var pid = provs[i] && (provs[i].id || provs[i].provider);
    if (!pid) continue;
    var models = [];
    try {
      if (typeof llm.listModels === "function") models = (await llm.listModels(String(pid))) || [];
    } catch (e) { models = []; }
    if (!models.length) continue;
    var mid = models[0] && (models[0].id || models[0].model);
    if (!mid) continue;
    return { provider: String(pid), model: String(mid), source: "llm-catalog", reasoningEffort: "" };
  }
  return null;
}

/**
 * Resolve which provider/model the AI features should use. Async because the
 * last-resort stage queries the host catalog. Throws only when every stage
 * failed, with an error that says what was tried.
 */
export async function resolveModelRoute(ctx, cfg) {
  var c = cfg || {};
  // Stage 1: explicit plugin config wins.
  if (c.provider && c.model) {
    var route = { provider: String(c.provider), model: String(c.model), source: "config", reasoningEffort: "" };
    if (c.reasoningEffort) route.reasoningEffort = String(c.reasoningEffort);
    return route;
  }
  var tried = [];
  var r2 = routeFromDefaultModel(ctx);
  if (r2) return r2;
  tried.push("agentDefaultModel");
  var r3 = routeFromAgent(ctx);
  if (r3) return r3;
  tried.push("agent.session");
  var r4 = await routeFromLlmCatalog(ctx);
  if (r4) return r4;
  tried.push("llm.listProviders");
  var err = new Error(
    "找不到可用模型（已尝试：" + tried.join(" / ") + "）。" +
    "请到 DSH 设置 → 模型 里选择一个默认模型后重试；或在插件配置里填 llm.provider + llm.model。"
  );
  err.code = "NO_MODEL_ROUTE";
  throw err;
}

/**
 * Non-throwing probe used by the panel to show WHICH model AI features will
 * use, so users are never left guessing. Never triggers a model call.
 */
export async function describeModelRoute(ctx, cfg) {
  try {
    var r = await resolveModelRoute(ctx, cfg);
    // A route alone is not enough: without the host's llm service AI features
    // still cannot run, so report that up front instead of failing later.
    var llmSvc = getLlm(ctx);
    if (!llmSvc) {
      return { ok: false, provider: r.provider, model: r.model, source: r.source,
        error: "宿主未提供 llm 服务，AI 分组不可用（关键词分组不受影响）" };
    }
    return { ok: true, provider: r.provider, model: r.model, source: r.source, error: "" };
  } catch (e) {
    return { ok: false, provider: "", model: "", source: "", error: String((e && e.message) || e) };
  }
}


async function askModel(ctx, cfg, system, userText, purpose, maxTokens) {
  // resolveModelRoute is async: stage 4 may query the host's provider catalog.
  var route = await resolveModelRoute(ctx, cfg);
  var llm = await loadLlm();
  var messages = [
    llm.createUserMessage({ content: [{ type: "text", text: userText }], source: { kind: "dsh-skill-browser" } })
  ];
  var options = {
    provider: route.provider,
    model: route.model,
    messages: messages,
    system: system,
    maxTokens: maxTokens || 2400,
    purpose: purpose,
    signal: AbortSignal.timeout(120000)
  };
  if (route.reasoningEffort) options.reasoningEffort = route.reasoningEffort;
  try {
    var sid = ctx.agent && ctx.agent.session && ctx.agent.session.id;
    if (sid) options.sessionId = String(sid);
  } catch (e) { /* optional */ }
  // NEVER deep-freeze the whole options object: the host skips AbortSignal on
  // purpose, and freezing signal breaks the timeout/abort chain.
  for (var key in options) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) continue;
    if (key === "signal") continue;
    if (options[key] && typeof options[key] === "object") Object.freeze(options[key]);
  }
  Object.freeze(messages);

  var llmSvc = getLlm(ctx);
  if (!llmSvc) throw new Error("宿主未提供 llm 服务，AI 功能不可用");
  var assembler = new llm.BlockAssembler();
  for await (var chunk of llmSvc.stream(options)) assembler.push(chunk);
  var finish = assembler.finish;
  if (finish && finish.kind && finish.kind !== "stop") {
    // finish shape is { kind, failure } — NOT { error }.
    var f = finish.failure;
    var detail = f ? [f.code ? "[" + String(f.code) + "]" : "", String(f.message || f)].filter(Boolean).join(" ") : "(无 failure 详情)";
    var err = new Error("模型流异常结束（" + String(finish.kind) + "）: " + detail);
    err.code = f && f.code ? String(f.code) : "LLM_FINISH_" + String(finish.kind).toUpperCase();
    throw err;
  }
  var text = assembler.blocks().filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("").trim();
  if (!text) throw new Error("模型没有返回文本");
  return { text: text, route: route };
}

// Strip ```json fences the model likes to add, then take the outermost JSON
// object/array. Returns the parsed value or throws.
function extractJson(text) {
  var t = String(text || "").trim();
  var fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  var first = t.search(/[[{]/);
  if (first < 0) throw new Error("模型输出里没有 JSON");
  var openCh = t.charAt(first);
  var closeCh = openCh === "{" ? "}" : "]";
  var depth = 0, inStr = false, esc = false, end = -1;
  for (var i = first; i < t.length; i++) {
    var ch = t.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) throw new Error("模型输出的 JSON 不完整");
  return JSON.parse(t.slice(first, end + 1));
}

// ── AI: auto-classify skills into a two-level (domain -> sub) tree ───────
var CLASSIFY_SYSTEM =
  "你是技能库分类助手。把给定的技能清单整理成「大类 → 子类」两级中文目录树。只输出 JSON，不要解释。\n" +
  "硬性要求：\n" +
  "1) 每个技能必须归入且只归入一个子类，清单里的技能一个都不能漏。\n" +
  "2) 大类 = 领域（例：Fluent/CFD 仿真、DSH 工具链、软件安装、网关与反代、文档处理）；子类 = 该领域内的具体用途。\n" +
  "3) 大类里技能数超过 6 个时，必须拆成 2~6 个子类。示例：Fluent 拆成「前处理」「画网格」「求解与监测」「后处理」「故障排查」；DSH 拆成「启动失败」「插件冲突」「插件开发」「安装经验」；网关拆成「接入配置」「额度与凭据」「故障排查」。\n" +
  "4) 每个子类最多 10 个技能；子类名必须说明具体用途，不能只是重复大类名。\n" +
  "5) 禁止「通用」「其他」「杂项」「综合」「工具集」这类大杂烩名字。\n" +
  "6) 各领域拆分粒度保持一致：不要只细分技能多的领域，技能少的领域同样按用途拆。\n" +
  "7) 大类里技能数少于 4 个时，允许只有 1 个子类（子类名要写清具体用途）。\n" +
  "8) 大类数量按清单规模决定（经验值：技能数 / 12 向上取整，允许 ±2）。大类名不超过 10 个汉字，子类名不超过 12 个汉字。\n" +
  "9) 清单里的「现分类」只是领域边界提示，不要照搬，按实际用途重新归纳。";

// Build a classification PLAN without touching groups.json. The client shows it
// to the user first, then calls applyPlan() with mode replace|merge - "如果对 AI
// 分组满意就替换原来的组" must be an explicit user decision, never a side effect.
export async function aiClassify(ctx, cfg, skills, opts) {
  if (!getLlm(ctx)) throw new Error("宿主未提供 llm 服务，AI 功能不可用");
  var o = opts || {};
  var mode = o.mode === "merge" ? "merge" : "replace";
  var catLabelOf = {};
  var cats = categoriesMeta();
  for (var ci = 0; ci < cats.length; ci++) catLabelOf[cats[ci].id] = cats[ci].label;

  // merge mode: only classify skills that no group owns yet.
  var pool = skills;
  if (mode === "merge") {
    var store0 = loadStore();
    var owned = {};
    for (var od in store0.assign) {
      if (!Object.prototype.hasOwnProperty.call(store0.assign, od)) continue;
      owned[od] = true;
    }
    pool = [];
    for (var pz = 0; pz < skills.length; pz++) if (!owned[skills[pz].dir]) pool.push(skills[pz]);
    if (!pool.length) {
      return { ok: true, plan: { domains: [] }, stats: { skills: 0, domains: 0, subs: 0, covered: 0 }, model: null, note: "所有技能都已在分组里，没有需要追加的技能" };
    }
  }

  function buildList(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      var line = s.dir;
      var zh = String(s.zh || "").trim();
      var desc = String(s.desc || "").trim();
      if (zh) line += " | " + zh.slice(0, 60);
      else if (desc) line += " | " + desc.slice(0, 60);
      if (s.cat && s.cat !== "other") line += " | 现分类:" + (catLabelOf[s.cat] || s.cat);
      out.push(line);
    }
    return out;
  }

  async function classifyOnce(arr, already) {
    var list = buildList(arr);
    var want = Math.max(3, Math.min(16, Math.ceil(list.length / 12)));
    var userText =
      (already && already.length
        ? "【已完成的大类】" + already.join("、") + "\n这些大类已存在，请勿重复创建，也不要往里加技能。\n"
        : "") +
      "【任务】把下面 " + list.length + " 个技能整理成约 " + want + " 个大类（可 ±2），每个大类下面按用途分 1~6 个子类。\n" +
      "【输出格式】严格 JSON，形如：\n" +
      '{"domains":[{"name":"大类名","emoji":"一个emoji","subs":[{"name":"子类名","emoji":"一个emoji","skills":["技能目录名",...]}]}]}\n' +
      "【硬性要求】每个技能恰好出现一次、一个不漏；子类不超过 10 个技能；禁止「通用/其他/杂项/综合」类名字；各领域拆分粒度一致。\n" +
      "【技能清单】（每行：目录名 | 中文简介 | 现分类）\n" +
      list.join("\n");
    // A full 109-skill tree easily exceeds 4k tokens; truncation would parse-fail
    // and surface as "AI 分组坏了".
    var res = await askModel(ctx, cfg, CLASSIFY_SYSTEM, userText, "skill-browser-classify", 8000);
    var data = extractJson(res.text);
    var raw = data && Array.isArray(data.domains) ? data.domains : [];
    if (!raw.length && data && Array.isArray(data.groups)) raw = legacyToDomains(data.groups);
    return { raw: raw, route: res.route };
  }

  var validDir = {};
  for (var j = 0; j < pool.length; j++) validDir[pool[j].dir] = true;

  var plan = { domains: [] };
  var taken = {};
  var created = [];
  var routeUsed = null;

  function newDomain(rg) {
    var nm = sanitizeName(rg.name);
    if (!nm) return null;
    var d = {
      name: nm,
      emoji: String(rg.emoji || "📂").slice(0, 8) || "📂",
      subs: []
    };
    plan.domains.push(d);
    return d;
  }

  function addSub(d, rs) {
    var nm = sanitizeName(rs.name) || d.name;
    var s = { name: nm, emoji: String(rs.emoji || "📁").slice(0, 8) || "📁", skills: [] };
    var dirs = Array.isArray(rs.skills) ? rs.skills : [];
    for (var p = 0; p < dirs.length; p++) {
      var dd = String(dirs[p] || "").trim();
      if (!validDir[dd]) continue;
      if (taken[dd]) continue;              // first sub wins, no duplicates
      taken[dd] = true;
      s.skills.push(dd);
    }
    if (!s.skills.length) return 0;
    // Split an over-long sub so no bin ever exceeds 10 (the model ignores the cap
    // surprisingly often on big catalogues).
    var chunks = Math.ceil(s.skills.length / 10);
    for (var ch = 0; ch < chunks; ch++) {
      var slice = s.skills.slice(ch * 10, ch * 10 + 10);
      var nm2 = chunks > 1 ? sanitizeName(s.name + " " + (ch + 1)) : s.name;
      d.subs.push({ name: nm2, emoji: s.emoji, skills: slice });
    }
    return s.skills.length;
  }

  function absorb(rawDomains) {
    for (var n = 0; n < rawDomains.length; n++) {
      var rg = rawDomains[n] || {};
      var subs = Array.isArray(rg.subs) ? rg.subs : [];
      // Legacy/flat reply: a domain with a bare skills[] becomes a 1-sub domain.
      if (!subs.length && Array.isArray(rg.skills)) subs = [{ name: sanitizeName(rg.name) || "未细分", skills: rg.skills }];
      var d = newDomain(rg);
      if (!d) continue;
      var took = 0;
      for (var q = 0; q < subs.length; q++) took += addSub(d, subs[q] || {});
      if (!took) { plan.domains.pop(); continue; }   // drop empty domains
      created.push({ name: d.name, emoji: d.emoji, subs: d.subs.length, count: took });
    }
  }

  function leftoversOf() {
    var out = [];
    for (var r = 0; r < pool.length; r++) if (!taken[pool[r].dir]) out.push(pool[r]);
    return out;
  }

  // Pass 1: the whole (or unassigned) catalogue.
  var p1 = await classifyOnce(pool, []);
  routeUsed = p1.route;
  if (!p1.raw.length) throw new Error("模型没有给出任何分组");
  absorb(p1.raw);

  // Pass 2: the model always drops a tail (historically every non-Fluent skill).
  // Re-ask only about the leftovers so they get real semantic groups instead of
  // one "其他" bin.
  var left = leftoversOf();
  if (left.length && plan.domains.length) {
    var names = [];
    for (var cn = 0; cn < plan.domains.length; cn++) names.push(plan.domains[cn].name);
    try {
      var p2 = await classifyOnce(left, names);
      absorb(p2.raw);
    } catch (e) {
      if (ctx.logger && ctx.logger.warn) ctx.logger.warn("dsh-skill-browser: classify pass2 failed: " + String((e && e.message) || e));
    }
  }

  // Pass 3 (no model): anything still uncovered falls back to its own category
  // label as a domain, split into 10-skill subs so nothing is silently dropped.
  left = leftoversOf();
  if (left.length) {
    var byCat = {};
    var catOrder = [];
    for (var r2 = 0; r2 < left.length; r2++) {
      var cid = left[r2].cat || "other";
      if (!byCat[cid]) { byCat[cid] = []; catOrder.push(cid); }
      byCat[cid].push(left[r2].dir);
    }
    for (var t = 0; t < catOrder.length; t++) {
      var dl = byCat[catOrder[t]];
      var baseName = catLabelOf[catOrder[t]] || "其他技能";
      var d2 = newDomain({ name: baseName, emoji: "📦" });
      if (!d2) continue;
      var took2 = addSub(d2, { name: "未细分", emoji: "📦", skills: dl });
      if (!took2) { plan.domains.pop(); continue; }
      created.push({ name: d2.name, emoji: d2.emoji, subs: d2.subs.length, count: took2 });
    }
  }

  if (!created.length) throw new Error("模型返回的分组没有一个匹配到现有技能");

  var subCount = 0, covered = 0;
  for (var a = 0; a < plan.domains.length; a++) {
    subCount += plan.domains[a].subs.length;
    for (var b = 0; b < plan.domains[a].subs.length; b++) covered += plan.domains[a].subs[b].skills.length;
  }
  return {
    ok: true,
    plan: plan,
    mode: mode,
    stats: { skills: pool.length, domains: plan.domains.length, subs: subCount, covered: covered },
    model: routeUsed
  };
}

// Turn a flat [{"name","skills":[...]}] reply into the two-level shape.
function legacyToDomains(groups) {
  var out = [];
  for (var i = 0; i < groups.length; i++) {
    var g = groups[i] || {};
    out.push({
      name: g.name, emoji: g.emoji || "📂",
      subs: [{ name: g.name, emoji: g.emoji || "📁", skills: Array.isArray(g.skills) ? g.skills : [] }]
    });
  }
  return out;
}

// Persist a plan produced by aiClassify(). mode "replace" drops every AI group
// (and their assignments) and rebuilds from the plan, keeping the user's manual
// groups; mode "merge" keeps everything and only adds the plan's groups.
// NOTE: still touches NOTHING on disk except groups.json.
export function applyPlan(plan, skills, mode) {
  if (!plan || !Array.isArray(plan.domains) || !plan.domains.length) {
    return { ok: false, error: "分组方案为空" };
  }
  var validDir = {};
  for (var i = 0; i < (skills || []).length; i++) validDir[skills[i].dir] = true;

  var store = loadStore();
  var keep = [];
  var dropped = {};
  if (mode !== "merge") {
    for (var k = 0; k < store.groups.length; k++) {
      var g0 = store.groups[k];
      if (g0.ai) { dropped[g0.id] = true; continue; }   // rebuild AI groups only
      keep.push(g0);
    }
  } else {
    keep = store.groups.slice();
  }
  var nextAssign = {};
  for (var d in store.assign) {
    if (!Object.prototype.hasOwnProperty.call(store.assign, d)) continue;
    if (dropped[store.assign[d]]) continue;
    nextAssign[d] = store.assign[d];
  }

  var created = [];
  var added = 0;
  function room() { return keep.length < MAX_GROUPS - 2; }

  for (var n = 0; n < plan.domains.length && room(); n++) {
    var rd = plan.domains[n] || {};
    var dnm = sanitizeName(rd.name);
    if (!dnm) continue;
    var subs = Array.isArray(rd.subs) ? rd.subs : [];
    var domId = newId();
    var dom = {
      id: domId, name: dnm,
      emoji: String(rd.emoji || "📂").slice(0, 8) || "📂",
      color: "", cover: "", ai: true, parent: "", createdAt: Date.now()
    };
    keep.push(dom);
    var domTook = 0;
    var subCount = 0;
    for (var q = 0; q < subs.length && room(); q++) {
      var rs = subs[q] || {};
      var snm = sanitizeName(rs.name);
      if (!snm) continue;
      var dirs = Array.isArray(rs.skills) ? rs.skills : [];
      var usable = [];
      for (var p = 0; p < dirs.length; p++) {
        var dd = String(dirs[p] || "").trim();
        if (!validDir[dd] || nextAssign[dd]) continue;
        usable.push(dd);
      }
      if (!usable.length) continue;
      var sid = newId();
      keep.push({
        id: sid, name: snm,
        emoji: String(rs.emoji || "📁").slice(0, 8) || "📁",
        color: "", cover: "", ai: true, parent: domId, createdAt: Date.now()
      });
      for (var u = 0; u < usable.length; u++) nextAssign[usable[u]] = sid;
      domTook += usable.length;
      subCount++;
      added++;
    }
    if (!domTook) { keep.pop(); continue; }   // domain with no usable sub
    created.push({ id: domId, name: dnm, emoji: dom.emoji, subs: subCount, count: domTook });
  }

  // merge 模式下"所有技能都已有归属"是正常结果，不是错误 —— 只有 replace
  // 才可能因为"方案里的技能一个都不在库里"而失败。
  if (!created.length) {
    if (mode === "merge") {
      store.groups = keep;
      store.assign = nextAssign;
      var savedNoop = saveStore(store);
      return {
        ok: savedNoop, mode: "merge", domains: 0, subs: 0, groups: [],
        note: "所有技能都已在分组里，本次没有需要补的技能",
        error: savedNoop ? "" : "写入失败"
      };
    }
    return { ok: false, error: "方案里的技能都不在当前技能库中" };
  }

  store.groups = keep;
  store.assign = nextAssign;
  var saved = saveStore(store);
  return {
    ok: saved, mode: mode === "merge" ? "merge" : "replace",
    domains: created.length, subs: added, groups: created,
    error: saved ? "" : "写入失败"
  };
}

// ── AI: one-click group cover image (SVG) ───────────────────────────────
var COVER_SYSTEM =
  "你是图标设计师。为一个技能分组生成一张方形封面图，输出**纯 SVG 源码**，" +
  "不要 markdown 代码围栏，不要任何解释文字。要求：viewBox=\"0 0 200 200\"，" +
  "深色背景 + 渐变或几何图形 + 居中一个简洁符号，配色高级、扁平、无文字。";

// SVG whitelist for AI-generated group covers. Anything outside it is either
// stripped or rejected outright - a cover is untrusted model output.
var SVG_TAGS = {
  svg:1, g:1, defs:1, title:1, desc:1, symbol:1, use:0,
  path:1, rect:1, circle:1, ellipse:1, line:1, polyline:1, polygon:1,
  text:1, tspan:1,
  linearGradient:1, radialGradient:1, stop:1, pattern:1, clipPath:1, mask:1,
  filter:1, feGaussianBlur:1, feOffset:1, feBlend:1, feColorMatrix:1, feMerge:1, feMergeNode:1
};

function cleanSvg(text) {
  var t = String(text || "").trim();
  var fence = /```(?:svg|xml)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  var start = t.indexOf("<svg");
  if (start < 0) throw new Error("模型没有返回 SVG");
  var end = t.lastIndexOf("</svg>");
  if (end < 0) throw new Error("模型返回的 SVG 不完整");
  var svg = t.slice(start, end + 6);

  // 1) Drop whole dangerous subtrees first (paired form), then any self-closing
  //    or stray opening form of the same tags.
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  var dropTags = ["script", "iframe", "foreignObject", "style", "object", "embed", "audio", "video", "canvas", "image"];
  for (var i = 0; i < dropTags.length; i++) {
    var tg = dropTags[i];
    svg = svg.replace(new RegExp("<" + tg + "\\b[\\s\\S]*?</" + tg + "\\s*>", "gi"), "");
    svg = svg.replace(new RegExp("<" + tg + "\\b[^>]*/?>", "gi"), "");
  }
  // <set>/<animate> can retarget attributes (incl. xlink:href) at runtime.
  svg = svg.replace(/<(?:set|animate|animateTransform|animateMotion|handler)\b[^>]*\/?>/gi, "");

  // 2) Strip every event-handler attribute regardless of quoting style.
  svg = svg.replace(/\son[a-zA-Z-]+\s*=\s*"[^"]*"/g, "");
  svg = svg.replace(/\son[a-zA-Z-]+\s*=\s*'[^']*'/g, "");
  svg = svg.replace(/\son[a-zA-Z-]+\s*=\s*[^\s>]+/g, "");

  // 3) href / xlink:href may only be an in-document fragment.
  svg = svg.replace(/\s(?:xlink:href|href)\s*=\s*"(?!#)[^"]*"/gi, "");
  svg = svg.replace(/\s(?:xlink:href|href)\s*=\s*'(?!#)[^']*'/gi, "");
  svg = svg.replace(/\s(?:xlink:href|href)\s*=\s*(?!#)[^\s>]+/gi, "");

  // 4) No script URLs anywhere (also catches url(javascript:...) in attributes).
  if (/javascript\s*:|vbscript\s*:/i.test(svg)) throw new Error("SVG 含可执行脚本 URL，已拒绝");

  // 5) Whitelist every remaining element name; unknown tag => reject.
  var tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)/g;
  var m;
  while ((m = tagRe.exec(svg))) {
    var name = m[1];
    if (!Object.prototype.hasOwnProperty.call(SVG_TAGS, name)) {
      throw new Error("SVG 含非白名单元素 <" + name + ">，已拒绝");
    }
  }

  if (svg.length > 40000) throw new Error("SVG 过大（>40KB），已拒绝");
  return svg;
}

export async function aiCover(ctx, cfg, group, sampleSkills) {
  if (!getLlm(ctx)) throw new Error("宿主未提供 llm 服务，AI 功能不可用");
  var sample = (sampleSkills || []).slice(0, 12).join("、");
  var userText =
    "分组名称：" + group.name + "\n" +
    (sample ? "包含技能：" + sample + "\n" : "") +
    "请为这个分组生成一张 200x200 的 SVG 封面图。";
  var res = await askModel(ctx, cfg, COVER_SYSTEM, userText, "skill-browser-cover", 2000);
  var svg = cleanSvg(res.text);
  var saved = setGroupCover(group.id, svg);
  if (!saved.ok) throw new Error(saved.error || "封面保存失败");
  return { ok: true, id: group.id, cover: svg, model: res.route };
}
