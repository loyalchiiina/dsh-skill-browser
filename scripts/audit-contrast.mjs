// 全皮肤对比度总审计（唯一权威口径）
//
// 用法：node scripts/audit-contrast.mjs [--verbose]
// 退出码：0 = 全部达标；1 = 有不达标项（明细打印到 stdout）
//
// 口径说明：
//   - 皮肤目录（128 款）来自 lib/client.js 内联的 window.__DSH_BALL_SKINS。
//   - 语义变量来自真实调用链：applySkinNow() 把 skinBallCss() + skinPanelCss()
//     写进 <style id="dsb-skin-style">，本脚本切皮肤后直接从该 style 的
//     textContent 里解析 --dsb-* 实际值 —— 不复制一份「期望值」，
//     避免审计与生产实现各算一套、出现假绿。
//   - 背景一律取「实际叠层后的颜色」：
//       panel   = pbgA || bgA
//       card    = chipBg over panel   （卡片/排行行真实底色）
//       surface = --dsb-surface       （吸顶表头不透明底色，实算值）
//       gtile1/2= shade over tile1/2  （分组大类行是线性渐变，两个端点分别校验）
//       obg1/2  = --dsb-onbrand-bg1/2 （品牌渐变两个端点，只测中点会漏浅端）
//   - 渐变底必须按最差端点判定，这是 v1.9.10 修的 bug：
//     中点达标但浅端只有 3.7–4.4:1，实际渲染出来白字就是看不清。
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT = join(HERE, "..", "lib", "client.js");
const VERBOSE = process.argv.includes("--verbose");

// ---------- 最小 DOM stub：只为让 client.js 的 factory 跑完并产出 style ----------
const registry = {};
function mkEl(tag) {
  const el = {
    tagName: tag, __ev: {}, style: {}, dataset: {}, children: [], options: { length: 0 },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, v) { v ? this._s.add(c) : this._s.delete(c); }, contains(c) { return this._s.has(c); }
    },
    _html: "", textContent: "", id: "", className: "", title: "",
    getAttribute(k) { return this[k] == null ? null : this[k]; },
    setAttribute(k, v) { if (k === "id") { this.id = v; registry[v] = this; } this[k] = v; },
    removeAttribute(k) { delete this[k]; }, hasAttribute(k) { return this[k] != null; },
    appendChild(c) { this.children.push(c); if (c && c.id) registry[c.id] = c; return c; },
    insertBefore(c) { this.children.push(c); if (c && c.id) registry[c.id] = c; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { }, addEventListener(t, f) { (this.__ev[t] = this.__ev[t] || []).push(f); }, removeEventListener() { },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() { }, blur() { }, click() { },
    getBoundingClientRect() { return { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30 }; },
    contains() { return false; }
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) {
      this._html = String(v);
      const re = /id="([A-Za-z0-9_-]+)"/g; let m;
      while ((m = re.exec(this._html))) if (!registry[m[1]]) registry[m[1]] = mkEl("div");
    }
  });
  return el;
}

const sandbox = {
  console: { log() { }, warn() { }, error() { } }, // 屏蔽 client.js 的 mounted 日志
  JSON, Math, Date, String, Number, Object, Array, RegExp, parseInt, parseFloat, isNaN, Boolean,
  setTimeout: (f) => { try { f(); } catch (e) { } }, clearTimeout() { },
  setInterval: () => 0, clearInterval() { },
  fetch: () => Promise.reject(new Error("audit: no network")),
  // 必须可读写：SKIN.setSkin(id) 靠 localStorage 记住选择，写不进去就会一直用 01 号皮肤，
  // 导致 128 款皮肤全按深色算 → 20 款浅色皮肤集体假报不达标（踩过）。
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  CustomEvent: function (n, o) { this.type = n; this.detail = o && o.detail; },
  document: {
    head: mkEl("head"), body: mkEl("body"), documentElement: mkEl("html"),
    createElement: mkEl,
    getElementById: (i) => registry[i] || null,
    querySelector: (s) => (s && s.startsWith("#") ? registry[s.slice(1)] || null : null),
    querySelectorAll: () => [], addEventListener() { }, removeEventListener() { }
  },
  location: { reload() { }, href: "http://127.0.0.1/" },
  navigator: { userAgent: "node" }
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
sandbox.dispatchEvent = function () { };
vm.createContext(sandbox);

const mod = { id: "dsh-skill-browser", exports: {} };
sandbox.__ModuleLoader__ = { load(o) { mod.exports = o.factory((n) => require(n)); } };
vm.runInContext(fs.readFileSync(CLIENT, "utf8"), sandbox);
mod.exports.apply({
  slots: { register() { }, inject() { }, slot() { } },
  locale: { register() { }, t: (k) => k },
  settings: { register() { } },
  effect(f) { return f && f(); },
  logger: { info() { }, warn() { }, error() { } },
  get: () => null, on() { }
});

const SKIN = sandbox.window.__DSH_BALL_SKINS;
if (!SKIN) { console.error("FATAL: window.__DSH_BALL_SKINS 未挂载，皮肤目录没加载成功"); process.exit(2); }
const ids = Object.keys(SKIN.BY_ID);

// ---------- 颜色工具（与 lib/client.js 的 skinRgb/skinCr 同口径，但独立实现以交叉校验） ----------
function rgb(c) {
  if (c == null) return null;
  const s = String(c).trim(); let m;
  if ((m = /^#([0-9a-f]{3})$/i.exec(s))) return [parseInt(m[1][0] + m[1][0], 16), parseInt(m[1][1] + m[1][1], 16), parseInt(m[1][2] + m[1][2], 16), 1];
  if ((m = /^#([0-9a-f]{6})$/i.exec(s))) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
  // 100 款派生皮肤的颜色是 hsl()/hsla() 字符串，不解析 hsl 会全部落空 → 假绿/假红。
  if ((m = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:[,\s/]+([\d.]+))?/i.exec(s))) {
    const h = ((parseFloat(m[1]) % 360) + 360) % 360, sat = parseFloat(m[2]) / 100, l = parseFloat(m[3]) / 100;
    const a = m[4] == null ? 1 : parseFloat(m[4]);
    const cc = (1 - Math.abs(2 * l - 1)) * sat, x = cc * (1 - Math.abs(((h / 60) % 2) - 1)), mm = l - cc / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = cc; g = x; } else if (h < 120) { r = x; g = cc; } else if (h < 180) { g = cc; b = x; }
    else if (h < 240) { g = x; b = cc; } else if (h < 300) { r = x; b = cc; } else { r = cc; b = x; }
    return [Math.round((r + mm) * 255), Math.round((g + mm) * 255), Math.round((b + mm) * 255), a];
  }
  if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i.exec(s))) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]];
  return null;
}
const lum = (r) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r[0]) + 0.7152 * f(r[1]) + 0.0722 * f(r[2]);
};
const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
const over = (fg, bg) => { const a = fg[3]; return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]; };

function varsOf(id) {
  SKIN.setSkin(id); // 触发 __dshBallSkinHooks → applySkinNow() 重算 style
  const css = (registry["dsb-skin-style"] || {}).textContent || "";
  const out = {}; let m;
  const re = /--dsb-([a-z0-9-]+):([^;}]+)/g;
  while ((m = re.exec(css))) out["--dsb-" + m[1]] = m[2].trim();
  return out;
}

// 检查表：[说明, 前景来源(变量名或皮肤原生 key), 背景 key, 最低对比度]
// 4.5 = WCAG AA 正常文字；3.0 = 大号文字 / 非文字图形（图标、趋势柱、迷你条）
const CHECKS = [
  ["正文 ptx / 面板", "ptx", "panel", 4.5],
  ["卡片名 dsb-brand / 卡片底", "--dsb-brand", "card", 4.5],
  ["排行名 dsb-brand / 行底", "--dsb-brand", "row", 4.5],
  ["指标大数字 brand-strong / 卡片底", "--dsb-brand-strong", "card", 3.0],
  ["次要小字 dsb-dim / 面板", "--dsb-dim", "panel", 4.5],
  ["次要小字 dsb-dim / 卡片底", "--dsb-dim", "card", 4.5],
  ["吸顶表头 dsb-dim / 不透明表头底", "--dsb-dim", "surface", 4.5],
  ["成功绿 dsb-ok / 卡片底", "--dsb-ok", "card", 3.0],
  ["失败红 dsb-fail / 卡片底", "--dsb-fail", "card", 3.0],
  ["警告黄 dsb-warn / 卡片底", "--dsb-warn", "card", 3.0],
  ["激活态文字 onbrand / 品牌渐变起点", "--dsb-onbrand", "obg1", 4.5],
  ["激活态文字 onbrand / 品牌渐变终点", "--dsb-onbrand", "obg2", 4.5],
  ["分组卡名 oncard / 分组卡底(渐变起点)", "--dsb-oncard", "gtile1", 4.5],
  ["分组卡名 oncard / 分组卡底(渐变终点)", "--dsb-oncard", "gtile2", 4.5],
  ["分组计数 oncard-dim / 分组卡底(起点)", "--dsb-oncard-dim", "gtile1", 3.0],
  ["分组计数 oncard-dim / 分组卡底(终点)", "--dsb-oncard-dim", "gtile2", 3.0],
  ["趋势柱 bar1 / 面板", "--dsb-bar1", "panel", 3.0],
  ["趋势柱 bar2 / 面板", "--dsb-bar2", "panel", 3.0]
];

const fails = [];
for (const id of ids) {
  const V = varsOf(id);
  const base = SKIN.BY_ID[id].vars;
  const panel = rgb(base.pbgA || base.bgA);
  const chip = rgb(base.chipBg);
  const card = chip ? over(chip, panel) : panel;
  const surface = rgb(V["--dsb-surface"]) || card;
  const gt1 = rgb(V["--dsb-tile1"]) || [58, 67, 112, 1];
  const gt2 = rgb(V["--dsb-tile2"]) || [35, 42, 69, 1];
  const gshade = rgb(V["--dsb-shade"]) || [8, 10, 18, 0.42];
  const BG = {
    panel, card, row: card, surface,
    gtile1: over(gshade, gt1), gtile2: over(gshade, gt2),
    obg1: rgb(V["--dsb-onbrand-bg1"]), obg2: rgb(V["--dsb-onbrand-bg2"])
  };

  for (const [name, key, bgKey, min] of CHECKS) {
    const fgStr = key.startsWith("--") ? V[key] : base[key];
    if (!fgStr) { fails.push({ id, name, why: "变量缺失 " + key }); continue; }
    const fg = rgb(fgStr), bg = BG[bgKey];
    if (!fg || !bg) { fails.push({ id, name, why: "无法解析 " + fgStr + " / " + bgKey }); continue; }
    const eff = fg[3] < 1 ? over(fg, bg) : fg;
    const v = cr(eff, bg);
    if (v < min) fails.push({ id, name, v: +v.toFixed(2), min, fg: fgStr, bgKey });
    else if (VERBOSE) console.log(`ok  ${id} ${SKIN.BY_ID[id].name}  ${name}  ${v.toFixed(2)}:1`);
  }
}

const light = ids.filter((i) => {
  const b = SKIN.BY_ID[i].vars;
  const p = rgb(b.pbgA || b.bgA);
  return p && lum(p) > 0.45;
}).length;

console.log(`皮肤: ${ids.length}（浅色 ${light}）  检查组: ${CHECKS.length}  总项: ${ids.length * CHECKS.length}`);
console.log(`不达标: ${fails.length}`);
if (fails.length) {
  const byName = {};
  for (const f of fails) (byName[f.name] = byName[f.name] || []).push(f);
  for (const n of Object.keys(byName)) {
    console.log(`\n[${n}] ${byName[n].length} 款`);
    for (const f of byName[n].slice(0, 8)) {
      console.log(`   ${f.id} ${SKIN.BY_ID[f.id].name}  ${f.v ?? f.why}${f.min ? " < " + f.min : ""}  (fg=${f.fg || "-"} bg=${f.bgKey || "-"})`);
    }
  }
  process.exit(1);
}
