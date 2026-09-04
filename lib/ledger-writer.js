// dsh-skill-browser - 技能生效/失效台账自动登记引擎（host 端）。
//
// 数据源与策略：
// 1. 自动登记（确定性）：监听官方 `tools/result` 事件，过滤 skill 工具调用；
//    result.isError=true → 未生效❌；成功 → 调用次数+1（生效✅）。
//    插件绝不解析对话内容猜关键词，只信官方工具结果事件。
// 2. 手动上报（语义层）：对话 AI 发现用户纠错/技能未达预期时，
//    POST /ledger/report { skill, note, kind } 上报登记。
// 3. 台账文件支持动态路径：state.ledgerPath 可指向库内任意被搜索命中的
//    台账文件；未设置时用约定路径 <root>/skill-master/references/技能生效-失效台账.md。
//    有则更新（人工内容不动，插件行用 HTML 注释标记识别）；无则创建默认模板
//    （对齐现行台账格式、零隐私内容、内置登记口令说明）。
// 4. 插件首次接管现有台账时先备份原文件（.bak-dsh-skill-browser-<ts>，一次性）。
// 5. 全量机器可读记录：<root>/skill-master/references/技能失效-自动登记.jsonl。
//
// 台账 md 内插件维护区块用标记包围，幂等追加：
//   <!-- dsh-skill-browser:auto-ledger:v1 BEGIN --> ... <!-- dsh-skill-browser:auto-ledger:v1 END -->

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";

var LEDGER_REL = ["skill-master", "references", "技能生效-失效台账.md"];
var LOG_REL = ["skill-master", "references", "技能失效-自动登记.jsonl"];
var MARK_BEGIN = "<!-- dsh-skill-browser:auto-ledger:v1 BEGIN -->";
var MARK_END = "<!-- dsh-skill-browser:auto-ledger:v1 END -->";
var BAK_PREFIX = ".bak-dsh-skill-browser-";
var FLUSH_BATCH = 5;      // 队列达到 5 条立即写盘
var FLUSH_DELAY_MS = 60 * 1000; // 否则 60s 批量写盘
var QUEUE_HARD_CAP = 1000;      // 防写盘长期失败导致队列无限膨胀

export function ledgerFilePath(root) {
  if (root && root.__ledgerPath) return root.__ledgerPath; // 动态路径（不推荐用法，保留兼容）
  return LEDGER_REL.reduce(function (acc, seg) { return join(acc, seg); }, root);
}

// 台账实际路径：优先 state.ledgerPath（搜索命中/已创建），否则约定路径
export function ledgerEffectivePath(state) {
  if (state && state.ledgerPath) return state.ledgerPath;
  var base = (state && state.root) || "";
  return LEDGER_REL.reduce(function (acc, seg) { return join(acc, seg); }, base);
}

export function autoLogFilePath(root) {
  return LOG_REL.reduce(function (acc, seg) { return join(acc, seg); }, root);
}

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

function todayStr(d) {
  var dt = d || new Date();
  return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
}

function nowStamp() {
  var dt = new Date();
  return todayStr(dt) + " " + pad2(dt.getHours()) + ":" + pad2(dt.getMinutes()) + ":" + pad2(dt.getSeconds());
}

function ensureDir(p) {
  try { mkdirSync(dirname(p), { recursive: true }); } catch (e) {}
}

// ── 状态 ────────────────────────────────────────────────
export function createLedgerState(opts) {
  return {
    root: (opts && opts.root) || "",
    ledgerPath: (opts && opts.ledgerPath) || "",  // 动态台账路径（搜索命中后设置）
    logger: (opts && opts.logger) || { info: function () {}, warn: function () {} },
    queue: [],
    flushTimer: null,
    backupDone: false
  };
}

export function setLedgerRoot(state, root) {
  var changed = state.root !== (root || "");
  state.root = root || "";
  // 换根后路径与备份状态作废：新根需重新搜索台账、重新判断首次接管
  if (changed) { state.ledgerPath = ""; state.backupDone = false; }
}

// 设置台账实际路径（搜索命中已有台账时调用）
export function setLedgerPath(state, p) {
  if (state.ledgerPath !== (p || "")) {
    state.ledgerPath = p || "";
    state.backupDone = false; // 新文件需重新判断是否首接管备份
  }
}

// ── 初始化检查（用户设计：设置好技能库路径后第一件事） ──
// 幂等：有台账/有 skill-master 技能 → 不动；没有 → 各自创建。
// 新技能库由此获得完整的治理体系：skill-master 技能（面板可见，技能数+1）
// + 失效登记台账 + 空的自动流水。
export function initializeLedger(state) {
  if (!state || !state.root) return;
  ensureLedgerReady(state);
  ensureSkillMasterSkill(state);
}

function ensureSkillMasterSkill(state) {
  var dir = join(state.root, "skill-master");
  var f = join(dir, "SKILL.md");
  if (existsSync(f)) return; // 已有（如完整版技能治理大师）绝不覆盖
  try {
    ensureDir(f);
    writeFileSync(f, skillMasterMd(), "utf8");
    state.logger.info("dsh-skill-browser: skill-master scaffold created at " + f);
  } catch (e) {
    safeWarn(state, "skill-master scaffold failed: " + (e && e.message));
  }
}

function skillMasterMd() {
  return [
    "---",
    "name: skill-master",
    "description: 技能库治理与失效台账总控（dsh-skill-browser 插件自动初始化）。技能生效统计、失败自动登记、强化优先级。触发词：技能治理、失效台账、技能统计、技能失败登记。",
    "---",
    "",
    "# skill-master — 技能库治理（dsh-skill-browser 自动化版）",
    "",
    "> 本技能由 dsh-skill-browser 插件在检查技能库时自动创建。",
    "> 插件承担了本技能的自动化部分：登记、统计、台账维护；人工可继续补充。",
    "",
    "## 一、台账位置",
    "",
    "`skill-master/references/技能生效-失效台账.md`（本技能 references 目录下）",
    "",
    "## 二、登记机制（自动）",
    "",
    "- 每次 AI 通过 skill 工具调用技能：成功 → 生效✅；加载失败（技能名不存在/读取报错）→ 未生效❌。",
    "  实现方式：dsh-skill-browser 插件监听 DSH 官方 `tools/result` 事件（不解析对话、不猜关键词）。",
    "- 对话中发现用户纠错/技能未达预期 → AI 调用 `POST /dsh-skill-browser/ledger/report {skill, note, kind}` 手动登记。",
    "- 全量机器可读流水：`skill-master/references/技能失效-自动登记.jsonl`。",
    "",
    "## 三、人工维护（可选）",
    "",
    "- 台账的统计表/失败明细区可人工补充；插件增量只写在 `<!-- dsh-skill-browser:auto-ledger:v1 -->` 标记区块内，**人工内容永不改动**。",
    "- 失败次数最多的技能优先强化：改该技能 SKILL.md 补铁律/触发词，然后在台账标「已强化」。",
    "",
    "## 四、查看入口",
    "",
    "- DSH 界面 🧩 悬浮球 → 「📋 失效台账」Tab：等级徽章 + 强化状态 + 自动登记流水 + 失败明细。",
    ""
  ].join("\n");
}

// ── 事件入口 1：tools/result（自动登记） ─────────────────
// exec: { name:'skill', arguments:{ name:<skillName> }, callId }
// result: { isError, error?, content?: [{type:'text',text}] }
export function recordSkillResult(state, exec, result) {
  try {
    if (!state) return null;
    if (!exec || exec.name !== "skill") return null;
    var skillName = exec.arguments && typeof exec.arguments.name === "string" ? exec.arguments.name : "";
    if (!skillName) return null;
    var isError = !!(result && result.isError);
    var entry = {
      ts: new Date().toISOString(),
      skill: skillName,
      ok: !isError,
      kind: "auto-tool-result",
      callId: exec.callId || "",
      error: isError ? extractErrorText(result) : ""
    };
    // root 未就绪时只入队不写盘（flushNow 会保留队列，root 就绪后落盘）
    if (state.root) appendJsonl(state, entry);
    enqueue(state, entry);
    return entry;
  } catch (e) {
    safeWarn(state, "recordSkillResult failed: " + (e && e.message));
    return null;
  }
}

// ── 事件入口 2：语义层手动上报 ──────────────────────────
export function reportFailure(state, payload) {
  try {
    if (!state) return { ok: false, error: "ledger not ready" };
    var skill = String((payload && payload.skill) || "").trim();
    if (!skill) return { ok: false, error: "missing skill" };
    if (!state.root) {
      // root 未就绪：读一遍运行时配置还没用的场景不做复杂兜底，直接提示
      return { ok: false, error: "ledger not ready (no skill root detected yet)" };
    }
    var kind = String((payload && payload.kind) || "manual-report");
    var note = String((payload && (payload.note || payload.reason)) || "").trim();
    var entry = {
      ts: new Date().toISOString(),
      skill: skill,
      ok: false,
      kind: kind,
      note: note.slice(0, 500)
    };
    appendJsonl(state, entry);
    enqueue(state, entry);
    flushNow(state); // 手动上报低频，立即落盘
    return { ok: true, entry: entry };
  } catch (e) {
    safeWarn(state, "reportFailure failed: " + (e && e.message));
    return { ok: false, error: String(e && e.message || e) };
  }
}

// 从 JSONL 读取自动记录（可选按技能过滤，最新在尾部）
export function readAutoLog(root, skillFilter) {
  var p = autoLogFilePath(root);
  if (!existsSync(p)) return [];
  var out = [];
  try {
    var text = readFileSync(p, "utf8");
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      try {
        var obj = JSON.parse(line);
        if (skillFilter && obj.skill !== skillFilter) continue;
        out.push(obj);
      } catch (e) { /* 跳过坏行 */ }
    }
  } catch (e) {}
  return out;
}

// ── 内部：队列与写盘 ────────────────────────────────────
function enqueue(state, entry) {
  state.queue.push(entry);
  if (state.queue.length > QUEUE_HARD_CAP) {
    var drop = state.queue.length - QUEUE_HARD_CAP;
    state.queue.splice(0, drop);
    safeWarn(state, "queue overflow, dropped " + drop + " oldest entries");
  }
  if (state.queue.length >= FLUSH_BATCH) { flushNow(state); return; }
  if (!state.flushTimer) {
    state.flushTimer = setTimeout(function () {
      state.flushTimer = null;
      flushNow(state);
    }, FLUSH_DELAY_MS);
    try { if (state.flushTimer && typeof state.flushTimer.unref === "function") state.flushTimer.unref(); } catch (e) {}
  }
}

export function flushNow(state) {
  try {
    if (state.flushTimer) { clearTimeout(state.flushTimer); state.flushTimer = null; }
    if (!state.queue.length || !state.root) return;
    var batch = state.queue.splice(0, state.queue.length);
    try {
      ensureLedgerReady(state);
      var file = ledgerEffectivePath(state);
      var text = existsSync(file) ? readFileSync(file, "utf8") : "";
      var delta = buildAutoSection(batch);
      var merged = mergeAutoSection(text, delta);
      ensureDir(file);
      writeFileSync(file, merged, "utf8");
      state.logger.info("dsh-skill-browser: ledger updated (+" + batch.length + " records)");
    } catch (e) {
      // 写盘失败：条目放回队头，下次事件再试
      state.queue = batch.concat(state.queue);
      safeWarn(state, "ledger write failed, " + batch.length + " entries requeued: " + (e && e.message));
    }
  } catch (e) {
    safeWarn(state, "flushNow failed: " + (e && e.message));
  }
}

// 首次接管备份 + 默认台账创建（路径 = state.ledgerPath 或约定路径）
function ensureLedgerReady(state) {
  var file = ledgerEffectivePath(state);
  ensureDir(file);
  if (!existsSync(file)) {
    writeFileSync(file, defaultLedgerMd(), "utf8");
    state.logger.info("dsh-skill-browser: default ledger created at " + file);
    state.backupDone = true;
    return;
  }
  if (state.backupDone) return;
  // 一次性备份已存在的台账（查同目录是否已有本插件备份）
  try {
    var dir = dirname(file);
    var existing = readdirSync(dir);
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].indexOf(BAK_PREFIX) >= 0 && existing[i].indexOf("台账") >= 0) {
        state.backupDone = true;
        return;
      }
    }
    var bak = join(dir, BAK_PREFIX + timestampForFile() + "-" + (file.split(/[\\/]/).pop() || "ledger.md"));
    copyFileSync(file, bak);
    state.backupDone = true;
    state.logger.info("dsh-skill-browser: ledger backed up to " + bak);
  } catch (e) {
    safeWarn(state, "ledger backup failed: " + (e && e.message));
    state.backupDone = true; // 备份失败不阻塞登记
  }
}

function timestampForFile() {
  var dt = new Date();
  return dt.getFullYear() + pad2(dt.getMonth() + 1) + pad2(dt.getDate()) + "-" + pad2(dt.getHours()) + pad2(dt.getMinutes()) + pad2(dt.getSeconds());
}

// 默认台账模板：对齐现行「技能生效-失效台账」格式（〇统计口径/一登记时机/
// 二统计表/三失败明细），零隐私内容，内置登记口令与自动登记说明。
// 表头列与解析器（parseLedgerTable 8 列）严格兼容。
function defaultLedgerMd() {
  return [
    "# 技能生效-失效台账",
    "",
    "> 本台账是「技能生效/未生效（失败执行）」的**唯一登记处**。目的：技能若未生效/执行失败/被用户纠错，必须**立即、主动**登记，失败次数最多的技能优先着重强化，最终降低失误率。",
    ">",
    "> **引用前铁律**：任何任务要调用某个技能前，先在本台账查该技能名——若有 ❌未生效记录（失败次数 > 0），**必须先细读本台账该技能的「失败明细」，再执行该技能**，不得带旧坑上手。",
    ">",
    "> 本台账由 dsh-skill-browser 插件参与维护：🤖 自动登记区由插件写入（人工内容永不改动）；人工登记区按以下习惯维护。",
    "",
    "## 一、登记时机（遇下述任一情况，立即登记）",
    "",
    "1. **用户对话纠错**：用户说“不对 / 错了 / 你没按技能来 / 这技能根本没生效 / 你漏了某步”——按用户原话记为一次未生效。",
    "2. **AI 主动发现**：技能被调用但未达到预期结果（报错、半途而废、产物缺失、与成功经验不符）——记为一次未生效。",
    "3. **技能触发成功但执行出错**——记为一次未生效（note 区别：触发失败 vs 执行失败）。",
    "4. **生效**：技能触发且达到预期、用户认可——记为一次生效（用于命中率统计）。",
    "",
    "## 二、登记口令（对话快捷方式）",
    "",
    "- 技能触发失败时，对 AI 说：**「触发失败，登记」**或**「登记失败：<技能名> <原因>」**。",
    "- AI 收到口令后调用 `POST /dsh-skill-browser/ledger/report { skill, note, kind: \"manual-report\" }`，即写入本台账。",
    "- 插件同时自动记录每次技能工具调用的结果（成功✅/加载失败❌），见下方 🤖 自动登记区。",
    "",
    "## 三、统计表（按失败次数降序，定期重排）",
    "",
    "> 失败次数最多者置顶，进入「着重强化队列」。强化动作 = 改进该技能 SKILL.md；完成后标记「已强化」并保留历史计数。",
    "",
    "| 排名 | 技能名 | 调用次数(估) | 生效✅ | 未生效❌ | 失败率(估) | 最近未生效日期 | 强化状态 |",
    "|---|---|---|---|---|---|---|---|",
    "",
    "## 四、失败明细",
    "",
    "### 格式约定（人工登记请遵循）",
    "",
    "- 每个技能一段：`### 技能名：xxx（未生效 N 次）`，段内时间倒序条目。",
    "",
    MARK_BEGIN,
    "",
    "### 自动登记（dsh-skill-browser）",
    "",
    MARK_END,
    ""
  ].join("\n");
}

// 一批条目 → markdown 增量行
function buildAutoSection(batch) {
  var lines = [];
  for (var i = 0; i < batch.length; i++) {
    var e = batch[i];
    var mark = e.ok ? "✅ 生效" : "❌ 未生效";
    var note = e.note || e.error || "";
    var line = "- " + nowStampOf(e.ts) + " " + mark + " `" + e.skill + "`（" + e.kind + "）";
    if (note) line += " — " + String(note).replace(/\r?\n/g, " ");
    lines.push(line);
  }
  return lines.join("\n");
}

function nowStampOf(iso) {
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return todayStr(d) + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  } catch (e) { return iso; }
}

// 把增量合并进 md 的插件区块（幂等）
function mergeAutoSection(text, deltaText) {
  if (text.indexOf(MARK_BEGIN) >= 0 && text.indexOf(MARK_END) >= 0) {
    var pre = text.slice(0, text.indexOf(MARK_BEGIN) + MARK_BEGIN.length);
    var mid = text.slice(text.indexOf(MARK_BEGIN) + MARK_BEGIN.length, text.indexOf(MARK_END));
    var post = text.slice(text.indexOf(MARK_END));
    return pre + mid.replace(/\s*$/, "\n\n") + deltaText + "\n\n" + post;
  }
  // 无区块（人工台账无标记）：追加新区块到末尾
  var sep = text.endsWith("\n") ? "\n" : "\n\n";
  return text + sep + MARK_BEGIN + "\n\n### 自动登记（dsh-skill-browser）\n\n" + deltaText + "\n\n" + MARK_END + "\n";
}

function extractErrorText(result) {
  try {
    if (!result) return "";
    if (result.error && typeof result.error === "string") return result.error.slice(0, 300);
    if (Array.isArray(result.content)) {
      var texts = [];
      for (var i = 0; i < result.content.length; i++) {
        var b = result.content[i];
        if (b && b.type === "text" && b.text) texts.push(String(b.text));
      }
      return texts.join(" | ").slice(0, 300);
    }
  } catch (e) {}
  return "";
}

function appendJsonl(state, entry) {
  try {
    if (!state.root) return;
    var p = autoLogFilePath(state.root);
    ensureDir(p);
    appendFileSync(p, JSON.stringify(entry) + "\n", "utf8");
  } catch (e) {
    safeWarn(state, "appendJsonl failed: " + (e && e.message));
  }
}

function safeWarn(state, msg) {
  try { state.logger.warn("dsh-skill-browser: " + msg); } catch (e) {}
}
