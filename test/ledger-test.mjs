// Ledger engine test for dsh-skill-browser (standalone, temp dirs, no DSH).
// Usage: node test/ledger-test.mjs
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLedgerState, setLedgerRoot, recordSkillResult, reportFailure,
  flushNow, ledgerFilePath, autoLogFilePath, readAutoLog
} from "../lib/ledger-writer.js";

var pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log("  ok - " + label); }
  else { fail++; console.log("  FAIL - " + label); }
}

function makeState(root) {
  var logs = [];
  return createLedgerState({ root: root, logger: { info: function (m) { logs.push(m); }, warn: function (m) { logs.push(m); } } });
}

function fakeExec(skillName, callId) {
  return { name: "skill", arguments: { name: skillName }, callId: callId || "call-" + Math.random().toString(36).slice(2) };
}

var dir = mkdtempSync(join(tmpdir(), "dsb-ledger-test-"));
console.log("== temp root: " + dir);

// ── case 1: 无台账 → 自动创建骨架并登记 ──
console.log("== case 1: skeleton create + auto record");
var s1 = makeState(dir);
var entry = recordSkillResult(s1, fakeExec("some-skill", "c1"), { isError: true, content: [{ type: "text", text: 'skill "some-skill" is unknown or no longer available' }] });
ok(entry && entry.ok === false, "failure entry recorded (ok=false)");
recordSkillResult(s1, fakeExec("good-skill", "c2"), { isError: false });
flushNow(s1);
var md1 = readFileSync(ledgerFilePath(dir), "utf8");
ok(md1.indexOf("技能生效-失效台账") >= 0, "ledger md created");
ok(md1.indexOf("dsh-skill-browser:auto-ledger:v1 BEGIN") >= 0 && md1.indexOf("dsh-skill-browser:auto-ledger:v1 END") >= 0, "auto section markers present");
ok(md1.indexOf("❌ 未生效 `some-skill`") >= 0, "failure entry in md");
ok(md1.indexOf("✅ 生效 `good-skill`") >= 0, "success entry in md");
ok(md1.indexOf("unknown or no longer available") >= 0, "error text in md");
ok(existsSync(autoLogFilePath(dir)), "jsonl auto log exists");
ok(readAutoLog(dir).length === 2, "jsonl has 2 records");
ok(readAutoLog(dir, "good-skill").length === 1, "jsonl filter by skill works");

// ── case 2: 幂等（再 flush / 再登记，标记不重复） ──
console.log("== case 2: idempotent merge");
recordSkillResult(s1, fakeExec("some-skill", "c3"), { isError: true, content: [{ type: "text", text: "unknown again" }] });
flushNow(s1);
var md2 = readFileSync(ledgerFilePath(dir), "utf8");
ok(md2.split("dsh-skill-browser:auto-ledger:v1 BEGIN").length === 2, "BEGIN marker appears exactly once");
ok(md2.split("dsh-skill-browser:auto-ledger:v1 END").length === 2, "END marker appears exactly once");
ok(md2.indexOf("unknown again") >= 0, "new entry appended into same section");

// ── case 3: 已有人工台账 → 接管时备份 + 人工内容不动 ──
console.log("== case 3: takeover of manual ledger");
var dir2 = mkdtempSync(join(tmpdir(), "dsb-ledger-test-"));
mkdirSync(join(dir2, "skill-master", "references"), { recursive: true });
var manual = [
  "# 技能生效-失效台账（2026-08-25 建）",
  "",
  "## 二、统计表（按失败次数降序，定期重排）",
  "",
  "| 排名 | 技能名 | 调用次数(估) | 生效✅ | 未生效❌ | 失败率(估) | 最近未生效日期 | 强化状态 |",
  "|---|---|---|---|---|---|---|---|",
  "| 1 | fluent-run-failure-troubleshooting | 多 | — | **4** | 高 | 2026-08-19 | 已强化（先读控制台全文铁律） |",
  "| 2 | fluent-workflow-change | 多 | — | **3** | 中高 | 2026-08-23 | 已强化（逐项核对清单） |",
  "",
  "## 三、失败明细",
  "",
  "### 技能名：fluent-run-failure-troubleshooting（未生效 4 次）",
  "",
  "- 2026-08-19 第一次：旧记录",
  "",
  "## 四、其他"
].join("\n");
writeFileSync(ledgerFilePath(dir2), manual, "utf8");
var s2 = makeState(dir2);
recordSkillResult(s2, fakeExec("fluent-workflow-change", "c10"), { isError: true, content: [{ type: "text", text: "simulated failure" }] });
recordSkillResult(s2, fakeExec("brand-new-skill", "c11"), { isError: true, content: [{ type: "text", text: "unknown skill" }] });
flushNow(s2);
var md3 = readFileSync(ledgerFilePath(dir2), "utf8");
ok(md3.indexOf("（2026-08-25 建）") >= 0, "manual header untouched");
ok(md3.indexOf("**4** | 高 | 2026-08-19 | 已强化") >= 0, "manual table row untouched");
ok(md3.indexOf("- 2026-08-19 第一次：旧记录") >= 0, "manual detail untouched");
ok(md3.indexOf("## 四、其他") >= 0, "manual tail untouched");
ok(md3.indexOf("simulated failure") >= 0 && md3.indexOf("brand-new-skill") >= 0, "auto entries appended");
var hasBak = false;
try { hasBak = existsSync(join(dir2, "skill-master", "references", readdir(join(dir2, "skill-master", "references")).find(function (f) { return f.indexOf(".bak-dsh-skill-browser-") >= 0; }) || "")); } catch (e) {}
ok(hasBak, "first-takeover backup file created");

// ── case 4: 手动上报（语义层） ──
console.log("== case 4: manual report");
var rep = reportFailure(s2, { skill: "fluent-run-failure-troubleshooting", note: "用户纠错：没按技能步骤来", kind: "manual-report" });
ok(rep && rep.ok === true, "manual report accepted");
var md4 = readFileSync(ledgerFilePath(dir2), "utf8");
ok(md4.indexOf("没按技能步骤来") >= 0, "manual note in ledger md");
var filtered = readAutoLog(dir2, "fluent-run-failure-troubleshooting");
ok(filtered.length === 1 && filtered[0].kind === "manual-report", "manual record in jsonl (1 entry for this skill)");

// ── case 5: 写盘失败不丢数据（root 为空时队列保留） ──
console.log("== case 5: queue retention without root");
var s3 = makeState("");
recordSkillResult(s3, fakeExec("early-skill", "c20"), { isError: true, content: [{ type: "text", text: "x" }] });
ok(s3.queue.length === 1, "entry queued while root missing");
setLedgerRoot(s3, dir);
flushNow(s3);
var md5 = readFileSync(ledgerFilePath(dir), "utf8");
ok(md5.indexOf("early-skill") >= 0, "queued entry flushed after root ready");

// ── case 6: 初始化检查（用户设计）：空库 → skill-master 技能 + 台账自动创建 ──
console.log("== case 6: initializeLedger on empty library");
var { scanSkills } = await import("../lib/scan.js");
var { initializeLedger } = await import("../lib/ledger-writer.js");
var dir3 = mkdtempSync(join(tmpdir(), "dsb-ledger-test-"));
var s4 = makeState(dir3);
var before = scanSkills(dir3, {});
ok(before.length === 0, "empty library has 0 skills before init");
initializeLedger(s4);
var skillMd = join(dir3, "skill-master", "SKILL.md");
ok(existsSync(skillMd), "skill-master SKILL.md created");
var after = scanSkills(dir3, {});
ok(after.length === 1 && after[0].dir === "skill-master", "panel now shows exactly 1 skill (skill-master)");
ok(existsSync(ledgerFilePath(dir3)), "ledger md created");
ok(!existsSync(autoLogFilePath(dir3)), "jsonl not created until first record (lazy)");
initializeLedger(s4);
initializeLedger(s4);
ok(scanSkills(dir3, {}).length === 1, "re-init idempotent (still 1 skill)");
var s5 = makeState(dir);
setLedgerRoot(s5, dir3);
ok(s5.backupDone === false, "root switch resets backup flag");

// ── case 7: 已有完整版 skill-master（如本机 205 库）→ 绝不覆盖 ──
console.log("== case 7: existing skill-master untouched");
var dir4 = mkdtempSync(join(tmpdir(), "dsb-ledger-test-"));
mkdirSync(join(dir4, "skill-master"), { recursive: true });
writeFileSync(join(dir4, "skill-master", "SKILL.md"), "---\nname: skill-master\ndescription: 完整版人工技能\n---\n\n# 完整版", "utf8");
var s6 = makeState(dir4);
initializeLedger(s6);
var content = readFileSync(join(dir4, "skill-master", "SKILL.md"), "utf8");
ok(content.indexOf("完整版人工技能") >= 0, "existing skill-master SKILL.md NOT overwritten");
ok(content.indexOf("自动化版") < 0, "scaffold content not injected");
ok(existsSync(ledgerFilePath(dir4)), "ledger still ensured alongside existing skill-master");

// ── case 8: 台账搜索制（共享版核心）──
console.log("== case 8: ledger search-first discovery");
var { findLedgerFile, readLedgerAtPath, ledgerDefaultPath } = await import("../lib/scan.js");
var dir5 = mkdtempSync(join(tmpdir(), "dsb-ledger-test-"));
ok(findLedgerFile(dir5) === null, "empty library: no ledger found");
// 8a. 非约定位置、关键词命名的台账 → 搜索命中
mkdirSync(join(dir5, "my-governance", "notes"), { recursive: true });
var customLedger = join(dir5, "my-governance", "notes", "我的失败台账.md");
writeFileSync(customLedger, "## 三、失败明细\n\n### 技能名：xxx（未生效 1 次）\n", "utf8");
var found1 = findLedgerFile(dir5);
ok(found1 === customLedger, "keyword-named ledger in non-default location found by search: " + (found1 || "NULL"));
ok(readLedgerAtPath(found1).indexOf("失败台账") >= 0 || readLedgerAtPath(found1).indexOf("xxx") >= 0, "found ledger readable");
// 8b. 约定路径存在时优先于搜索命中
mkdirSync(join(dir5, "skill-master", "references"), { recursive: true });
writeFileSync(ledgerDefaultPath(dir5), "约定路径台账", "utf8");
ok(findLedgerFile(dir5) === ledgerDefaultPath(dir5), "default path wins over search hits");
// 8c. 换根后 setLedgerRoot 清空 ledgerPath
var s7 = makeState(dir5);
setLedgerRoot(s7, dir5);
s7.ledgerPath = customLedger;
setLedgerRoot(s7, dir5 + "-x");
ok(s7.ledgerPath === "", "root switch clears dynamic ledger path (re-search on new root)");

// cleanup
try { rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true }); rmSync(dir3, { recursive: true, force: true }); rmSync(dir4, { recursive: true, force: true }); rmSync(dir5, { recursive: true, force: true }); } catch (e) {}

import { readdirSync as readdir } from "node:fs";
console.log("\n== RESULT: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
