// dsh-skill-browser — 调用台账统计聚合（纯函数，无外部依赖）
//
// 数据源：技能失效-自动登记.jsonl（每行一条 skill 工具调用结果）
//   {"ts":"2026-09-03T19:18:04.963Z","skill":"geometry-backup","ok":true,
//    "kind":"auto-tool-result","callId":"call_x","error":""}
//
// 本模块只做「聚合」：按起止日期过滤 → 按 日/周/月/年 分桶 → 按技能排行。
// 不读文件、不碰网络，方便单测。

var MAX_BUCKETS = 400;

function pad2(n) { return n < 10 ? "0" + n : String(n); }

// 取 ISO 时间串的本地日期部分 YYYY-MM-DD（ts 是 UTC，用 Date 转本地）
export function dayKeyOf(ts) {
  var d = new Date(String(ts || ""));
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

// 周一为一周起点
export function weekStartOf(dayKey) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return "";
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var dow = d.getDay();            // 0=周日
  var back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function addDays(dayKey, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dayKey || ""));
  if (!m) return "";
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function monthKeyOf(dayKey) { return String(dayKey || "").slice(0, 7); }
function yearKeyOf(dayKey) { return String(dayKey || "").slice(0, 4); }

// 桶 key + 展示标签
function bucketOf(dayKey, gran) {
  if (gran === "year") { var y = yearKeyOf(dayKey); return { key: y, label: y }; }
  if (gran === "month") { var mo = monthKeyOf(dayKey); return { key: mo, label: mo }; }
  if (gran === "week") {
    var ws = weekStartOf(dayKey);
    return { key: ws, label: ws.slice(5) + "~" + addDays(ws, 6).slice(5) };
  }
  return { key: dayKey, label: dayKey.slice(5) };
}

// 下一个桶（用于补空洞）
function nextBucketKey(key, gran) {
  if (gran === "year") return String(Number(key) + 1);
  if (gran === "month") {
    var m = /^(\d{4})-(\d{2})$/.exec(key); if (!m) return "";
    var y = Number(m[1]), mo = Number(m[2]);
    mo++; if (mo > 12) { mo = 1; y++; }
    return y + "-" + pad2(mo);
  }
  return addDays(key, gran === "week" ? 7 : 1);
}

export function normalizeGran(v) {
  var g = String(v || "").toLowerCase();
  if (g === "year" || g === "month" || g === "week" || g === "day") return g;
  return "day";
}

// 记录规整：只保留需要的字段，非法 ts 丢弃
export function normalizeRecords(raw) {
  var out = [];
  var list = Object.prototype.toString.call(raw) === "[object Array]" ? raw : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i] || {};
    var day = dayKeyOf(r.ts);
    if (!day) continue;
    var skill = String(r.skill == null ? "" : r.skill).trim();
    if (!skill) continue;
    out.push({
      ts: String(r.ts),
      day: day,
      skill: skill,
      ok: r.ok === false ? false : true,
      kind: String(r.kind == null ? "" : r.kind)
    });
  }
  out.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
  return out;
}

// 主聚合入口
// opts: { from, to, gran, top, sort }
export function buildStats(rawRecords, opts) {
  var o = opts || {};
  var gran = normalizeGran(o.gran);
  var records = normalizeRecords(rawRecords);

  // 全量时间边界（不受筛选影响，用于前端提示「数据可用区间」）
  var dataFirst = records.length ? records[0].day : "";
  var dataLast = records.length ? records[records.length - 1].day : "";

  var from = String(o.from || "").trim();
  var to = String(o.to || "").trim();
  if (from && to && from > to) { var t = from; from = to; to = t; }

  var picked = [];
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    if (from && r.day < from) continue;
    if (to && r.day > to) continue;
    picked.push(r);
  }

  // ---- 总计 ----
  var okCount = 0, failCount = 0;
  var skillAgg = Object.create(null);
  var daySet = Object.create(null);
  for (var j = 0; j < picked.length; j++) {
    var x = picked[j];
    if (x.ok) okCount++; else failCount++;
    daySet[x.day] = 1;
    var a = skillAgg[x.skill];
    if (!a) { a = skillAgg[x.skill] = { skill: x.skill, calls: 0, ok: 0, fail: 0, last: "", first: "" }; }
    a.calls++;
    if (x.ok) a.ok++; else a.fail++;
    if (!a.first) a.first = x.ts;
    a.last = x.ts;
  }
  var calls = picked.length;
  var activeDays = Object.keys(daySet).length;

  var totals = {
    calls: calls,
    ok: okCount,
    fail: failCount,
    rate: calls ? Math.round((okCount / calls) * 1000) / 10 : 0,
    skills: Object.keys(skillAgg).length,
    days: activeDays,
    avgPerDay: activeDays ? Math.round((calls / activeDays) * 10) / 10 : 0
  };

  // ---- 分桶（补空洞）----
  var buckets = [];
  if (picked.length) {
    var map = Object.create(null);
    var order = [];
    for (var k = 0; k < picked.length; k++) {
      var b = bucketOf(picked[k].day, gran);
      if (!b.key) continue;
      var cur = map[b.key];
      if (!cur) { cur = map[b.key] = { key: b.key, label: b.label, calls: 0, ok: 0, fail: 0 }; order.push(b.key); }
      cur.calls++;
      if (picked[k].ok) cur.ok++; else cur.fail++;
    }
    order.sort();
    // 补空洞：从首个桶走到末个桶
    var firstKey = order[0], lastKey = order[order.length - 1];
    var walk = firstKey, guard = 0;
    while (walk && walk <= lastKey && guard < MAX_BUCKETS) {
      if (map[walk]) buckets.push(map[walk]);
      else buckets.push({ key: walk, label: bucketOf(gran === "day" ? walk : (gran === "year" ? walk + "-01-01" : (gran === "month" ? walk + "-01" : walk)), gran).label, calls: 0, ok: 0, fail: 0 });
      walk = nextBucketKey(walk, gran);
      guard++;
    }
  }

  // ---- 排行 ----
  var ranks = [];
  for (var sk in skillAgg) if (Object.prototype.hasOwnProperty.call(skillAgg, sk)) ranks.push(skillAgg[sk]);
  var sort = String(o.sort || "calls");
  var cmp = {
    calls: function (a, b) { return b.calls - a.calls || b.fail - a.fail || (a.skill < b.skill ? -1 : 1); },
    fails: function (a, b) { return b.fail - a.fail || b.calls - a.calls || (a.skill < b.skill ? -1 : 1); },
    rate: function (a, b) { return (a.ok / a.calls) - (b.ok / b.calls) || b.calls - a.calls; },
    last: function (a, b) { return a.last < b.last ? 1 : a.last > b.last ? -1 : 0; },
    name: function (a, b) { return a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0; }
  }[sort] || null;
  ranks.sort(cmp || function (a, b) { return b.calls - a.calls; });
  for (var q = 0; q < ranks.length; q++) {
    ranks[q].rank = q + 1;
    ranks[q].rate = ranks[q].calls ? Math.round((ranks[q].ok / ranks[q].calls) * 1000) / 10 : 0;
  }
  var top = Number(o.top);
  if (!(top > 0)) top = 0;
  if (top && ranks.length > top) ranks = ranks.slice(0, top);

  return {
    ok: true,
    gran: gran,
    from: from,
    to: to,
    sort: sort,
    dataFirst: dataFirst,
    dataLast: dataLast,
    totals: totals,
    buckets: buckets,
    ranks: ranks,
    rankTotal: Object.keys(skillAgg).length
  };
}
