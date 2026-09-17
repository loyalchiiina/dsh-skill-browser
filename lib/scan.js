// dsh-skill-browser - skill directory scanning & categorization (host side).
// Pure functions, no DSH service dependencies, so it can be unit-tested
// standalone with `node test/run.js`.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CAT_RULES, SUB_RULES, CATS } from "./zh.js";

// Parse a flat YAML frontmatter (name/description/...) into a plain object.
// Handles folded scalars (`description: >` followed by indented lines) and
// strips surrounding quotes. Not a full YAML parser - frontmatter here is flat.
// Tolerates a UTF-8 BOM before the opening `---` (some editors write one).
export function parseFrontmatter(text) {
  var out = {};
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  var m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  var lastKey = null;
  var lines = m[1].split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^\s*#/.test(line)) continue;
    var kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) {
      lastKey = kv[1];
      var v = kv[2].trim();
      if (/^[>|][+-]?$/.test(v)) v = "";
      v = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1").trim();
      out[lastKey] = v;
    } else if (lastKey && /^\s+\S/.test(line)) {
      out[lastKey] = (out[lastKey] ? out[lastKey] + " " : "") + line.trim();
    }
  }
  return out;
}

// Categorize a skill directory name: { id, sub }.
export function categorize(dirName) {
  var cat = "other";
  for (var i = 0; i < CAT_RULES.length; i++) {
    if (CAT_RULES[i].re.test(dirName)) { cat = CAT_RULES[i].id; break; }
  }
  var sub = "";
  var rules = SUB_RULES[cat];
  if (rules) {
    for (var j = 0; j < rules.length; j++) {
      if (rules[j].re.test(dirName)) { sub = rules[j].id; break; }
    }
  }
  return { id: cat, sub: sub };
}

// Scan one skill root directory. Returns an array of skill summaries,
// sorted by directory name. Skips non-directories, `_`-prefixed and
// `.`-prefixed entries, and directories without a SKILL.md.
export function scanSkills(root, zhDict) {
  var out = [];
  if (!root || !existsSync(root)) return out;
  var entries = readdirSync(root, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.isDirectory()) continue;
    if (e.name.charAt(0) === "_" || e.name.charAt(0) === ".") continue;
    var skillFile = join(root, e.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    var fm = {};
    try { fm = parseFrontmatter(readFileSync(skillFile, "utf8")); } catch (err) { fm = {}; }
    var cat = categorize(e.name);
    out.push({
      dir: e.name,
      name: fm.name || e.name,
      desc: String(fm.description || "").trim(),
      zh: (zhDict && zhDict[e.name]) || "",
      cat: cat.id,
      sub: cat.sub,
      mtime: safeMtime(skillFile)
    });
  }
  out.sort(function (a, b) { return a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0; });
  return out;
}

function safeMtime(p) {
  try { return statSync(p).mtimeMs; } catch (e) { return 0; }
}

// Category metadata shipped to the client (ids/labels/icons/sub-chips).
export function categoriesMeta() {
  return CATS;
}

// Read the full SKILL.md body for the detail view. `dir` is validated
// against the safe-name charset to prevent path traversal.
export function readSkillBody(root, dir) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(dir) || dir.indexOf("..") >= 0) return null;
  var p = join(root, dir, "SKILL.md");
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// ── 技能生效/失效台账 ──────────────────────────────
// 台账发现（共享版，不限定死路径）：
//   1) 约定路径优先：<root>/skill-master/references/技能生效-失效台账.md
//   2) 全库按文件名关键词搜索（失效台账/失败台账/生效-失效…，深度≤3）
// 统计表结构：## 二、… ## 三、之间的 markdown 表格（排名|技能名|调用次数|生效|未生效|失败率|最近日期|强化状态）
// 失败明细：### 技能名：xxx（未生效 N 次） + 时间倒序条目
var LEDGER_REL = ["skill-master", "references", "技能生效-失效台账.md"];
var LEDGER_KEYWORDS = ["失效台账", "失败台账", "生效-失效台账", "生效失效台账", "生效-失效"];

export function ledgerDefaultPath(root) {
  return LEDGER_REL.reduce(function (acc, seg) { return join(acc, seg); }, root);
}

function walkForLedger(dir, depth, out) {
  if (depth > 3 || out.length > 50) return;
  var entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (e.name.charAt(0) === "_" || e.name.charAt(0) === ".") continue;
    var full = join(dir, e.name);
    if (e.isDirectory()) {
      walkForLedger(full, depth + 1, out);
    } else if (/\.md$/i.test(e.name)) {
      for (var k = 0; k < LEDGER_KEYWORDS.length; k++) {
        if (e.name.indexOf(LEDGER_KEYWORDS[k]) >= 0) { out.push(full); break; }
      }
    }
  }
}

// 搜索技能库中的台账文件：约定路径优先；否则按文件名关键词全库搜索，
// 多命中取目录最浅、字典序第一（确定性）。找不到返回 null。
export function findLedgerFile(root) {
  if (!root || !existsSync(root)) return null;
  var def = ledgerDefaultPath(root);
  if (existsSync(def)) return def;
  var hits = [];
  walkForLedger(root, 0, hits);
  if (!hits.length) return null;
  hits.sort(function (a, b) {
    var da = a.slice(root.length).split(/[\\/]/).length;
    var db = b.slice(root.length).split(/[\\/]/).length;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return hits[0];
}

export function readLedgerAtPath(p) {
  if (!p || !existsSync(p)) return null;
  try { return readFileSync(p, "utf8"); } catch (e) { return null; }
}

function splitMdRow(line) {
  var parts = line.split("|");
  // 去掉首尾空段并 trim
  var out = [];
  for (var i = 1; i < parts.length - 1; i++) out.push(parts[i].trim());
  return out;
}

function parseFailCount(s) {
  var m = /\*\*(\d+)\*\*|^(\d+)$/.exec(String(s || "").trim());
  return m ? parseInt(m[1] || m[2], 10) : 0;
}

// 解析统计表 → [{ rank, skill, calls, fails, rate, lastDate, status }]
export function parseLedgerTable(text) {
  var rows = [];
  var lines = String(text || "").split(/\r?\n/);
  var inTable = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^##\s*二、/.test(line)) { inTable = true; continue; }
    if (/^##\s*三、/.test(line)) { inTable = false; break; }
    if (!inTable || !/^\|/.test(line)) continue;
    var c = splitMdRow(line);
    if (c.length < 8) continue;
    if (/技能名|排名/.test(c[1]) || /^[: -]+$/.test(c[1])) continue; // 表头/分隔行
    rows.push({
      rank: c[0],
      skill: c[1],
      calls: c[2],
      ok: c[3],
      fails: parseFailCount(c[4]),
      rate: c[5],
      lastDate: c[6],
      status: c[7]
    });
  }
  return rows;
}

// 提取某技能的失败明细段落（### 技能名：xxx ... 到下一个 ### / ## 为止）
export function parseLedgerDetail(text, skill) {
  var lines = String(text || "").split(/\r?\n/);
  var out = [];
  var capture = false;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (/^###\s*技能名：/.test(line)) {
      if (capture) break; // 已捕获目标段落，遇到下一条目即止
      capture = line.indexOf(skill) >= 0;
      if (capture) out.push(line);
      continue;
    }
    if (capture) {
      if (/^##\s/.test(line)) break;
      out.push(line);
    }
  }
  return capture ? out.join("\n") : "";
}

// 读取台账文件；不存在返回 null
export function readLedgerFile(root) {
  var p = LEDGER_REL.reduce(function (acc, seg) { return join(acc, seg); }, root);
  if (!existsSync(p)) return null;
  try { return readFileSync(p, "utf8"); } catch (e) { return null; }
}
