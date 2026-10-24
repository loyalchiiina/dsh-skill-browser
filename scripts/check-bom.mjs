#!/usr/bin/env node
// 防 BOM 回归：扫描仓库内所有文本文件，发现 UTF-8 BOM 立即报错退出。
// 背景：v1.9.2 改造时 package.json / lib/index.js 被写入 BOM，导致宿主 JSON.parse 失败、
// 市场判定「该包不可用」、整包不激活、悬浮球消失。此脚本作为发布前硬门禁。
// 用法：node scripts/check-bom.mjs [--fix]

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const FIX = process.argv.includes("--fix");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(ROOT, []).filter((p) =>
  /\.(json|js|mjs|cjs|ts|yml|yaml|md|txt|ps1|html|css|svg)$/i.test(p)
);

const bad = [];
for (const p of files) {
  const b = fs.readFileSync(p);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    bad.push(p);
    if (FIX) {
      fs.writeFileSync(p, b.subarray(3));
      console.log("FIXED  " + path.relative(ROOT, p));
    }
  }
}

if (bad.length === 0) {
  console.log("OK: " + files.length + " 个文本文件，0 个带 UTF-8 BOM");
  process.exit(0);
}

if (!FIX) {
  console.error("FAIL: 发现 " + bad.length + " 个带 UTF-8 BOM 的文件（会导致宿主 JSON.parse 失败、插件被判不可用）：");
  for (const p of bad) console.error("  " + path.relative(ROOT, p));
  console.error("修复：node scripts/check-bom.mjs --fix");
  process.exit(1);
}
console.log("已修复 " + bad.length + " 个文件");
