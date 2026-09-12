window.__ModuleLoader__.load({
  id: "dsh-skill-browser",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    // v1.5.5（2026-09-06）：版本号对齐修复——host 端 index.js 的 VERSION
    //   常量此前停在 1.5.1 未随 package.json 同步，现统一为 1.5.5。
    // v1.7.0（2026-09-11）：三功能升级——
    //   ① 技能卡片显示 SKILL.md 最新修改时间（yyyy-MM-dd HH:mm）；
    //   ② 排序切换：按名称（默认）↔ 按修改时间降序（总清单与每个分类内）；
    //   ③ 技能启用/停用：单技能开关 + 分类级全启用/全停用，走宿主
    //      POST /toggle 与 /toggle-batch（frontmatter disable-model-invocation
    //      行级改写，SKILL.md 先自动备份），停用卡片灰显 + 徽章。
    // v1.7.1（2026-09-11）：操作反馈 UI 升级（用户实测反馈：开关无视觉状态、
    //   操作无反馈，误点"全停用"80 个技能事后才发现）——
    //   ① 单技能开关换成滑动开关（胶囊轨道 34×18，开启=滑块右移+绿色#27ae60，
    //      停用=滑块左移+灰色#555，transition .2s；状态按 skill.disabled 渲染，
    //      点击乐观更新，API 失败回滚）；
    //   ② 面板内右上角 toast 轻提示（2 秒自动消失，成功绿/失败红）：单开关
    //      "已停用/已启用 <技能名>"、批量"已停用/启用 N 项"、部分失败
    //      "成功 X 项，失败 Y 项"；批量进行中按钮显示"处理中…"防重入；
    //   ③ 排序升级四态循环：名称↑ → 名称↓ → 时间↓（最新在前）→ 时间↑（最旧在前），
    //      单按钮显示当前态（SORT_ORDER 为唯一权威，legacy name/mtime 自动迁移）。
    // v1.7.2（2026-09-11）：三级滑块开关体系（样式统一胶囊滑块，聚合态半开样式）——
    //   ① 全局总开关（排序按钮旁，标签"全部技能"）：状态=全部技能聚合
    //      （全启用→右绿 / 全停用→左灰 / 混合→居中半开 .dsb-sw-half + title"部分停用"）；
    //      点击弹面板内确认菜单（非 window.confirm）："全部启用 (N 项)" /
    //      "全部停用 (N 项)" + 取消，停用项带醒目危险提示；确认后
    //      POST /toggle-batch body={dirs:[全量目录]}（不走 category，最稳）。
    //   ② 分类级滑块（替换 v1.7.0 排序栏内"全启用/全停用"两个按钮）：小一号
    //      胶囊滑块 + 小字"停用 x/y"，聚合逻辑同全局；确认后
    //      POST /toggle-batch body={category:"<cat-id>"}。
    //   ③ 联动：任一层 toggle 成功后重算全局滑块 + 分类滑块 + 卡片
    //      （卡片走 patchCardsDisabled 局部更新类名/徽章，不整列表 innerHTML
    //      重建，避免闪烁）；聚合态唯一数据源 = S.data.skills 的 disabled 字段。

    var S = {
      mounted: false,
      open: false,
      panelBuilt: false,
      view: "skills",  // "skills" | "ledger"
      data: null,
      ledger: null,
      ledgerDetail: null,
      loading: false,
      error: "",
      cat: "all",
      sub: "",
      q: "",
      detail: null,
      sortMode: "name-asc",   // v1.7.1 四态："name-asc" | "name-desc" | "mtime-desc" | "mtime-asc"
      toggling: false,        // v1.7.0: toggle 请求进行中（防重复点击）
      toastTimer: null,       // v1.7.1: toast 自动消失定时器句柄
      batchMenuScope: null    // v1.7.2: 批量确认菜单当前作用域（"global" 或分类 id）
    };

    // v1.7.1 排序四态循环的唯一权威定义（点击按钮沿数组循环）。
    // asc=升序（旧/前→新/后，字符串 localeCompare、时间小→大），
    // desc=降序（新在前/名称 Z→A）。
    var SORT_ORDER = ["name-asc", "name-desc", "mtime-desc", "mtime-asc"];
    function nextSortMode(m) {
      var i = SORT_ORDER.indexOf(m);
      if (i < 0) i = 0;
      return SORT_ORDER[(i + 1) % SORT_ORDER.length];
    }
    // v1.7.0 老会话只存过 "name"/"mtime" 两态，读到旧值自动迁移到等价新态
    function normalizeSortMode(m) {
      if (m === "name") return "name-asc";
      if (m === "mtime") return "mtime-desc";
      return (SORT_ORDER.indexOf(m) >= 0) ? m : "name-asc";
    }

    // v1.7.1 文案兜底：优先用宿主 /skills 下发的 ui 常量（lib/zh.js UI_TEXT），
    // 老宿主无该字段时用这里的同文兜底。
    var UI_FALLBACK = {
      sortByName: "按名称",
      sortByMtime: "按修改时间",
      sortToggleTitle: "切换排序方式（名称 ↔ 修改时间降序）",
      mtimeLabel: "修改于",
      disabledBadge: "已停用",
      cardDisabledTitle: "已停用（模型技能目录中已摘除）· 点击卡片查看全文",
      toggleEnableTip: "启用后技能恢复进模型技能目录",
      toggleDisableTip: "停用后技能从模型技能目录摘除（SKILL.md 会先自动备份）",
      batchEnable: "全启用",
      batchDisable: "全停用",
      batchBtnTitle: "对该分类下全部技能执行启用/停用",
      batchConfirmDisable: "确定停用该分类下全部技能？（每个 SKILL.md 都会先自动备份，可再次全启用恢复）",
      batchConfirmEnable: "确定启用该分类下全部技能？",
      toggling: "执行中…",
      toggleFailPrefix: "失败",
      toggleDoneSuffix: "完成",
      toggleEnable: "启用",
      toggleDisable: "停用",
      disabledCountSuffix: "项已停用",
      // ── v1.7.1 新增：排序四态 / 滑动开关 / toast ──
      sortNameAsc: "名称↑",
      sortNameDesc: "名称↓",
      sortMtimeDesc: "时间↓",
      sortMtimeAsc: "时间↑",
      sortCycleTitle: "排序（点击循环）：名称↑ → 名称↓ → 时间↓（最新在前）→ 时间↑（最旧在前）",
      switchOnText: "开",
      switchOffText: "关",
      toastDisabled: "已停用 {name}",
      toastEnabled: "已启用 {name}",
      toastBatchDisabled: "已停用 {n} 项",
      toastBatchEnabled: "已启用 {n} 项",
      toastBatchPartial: "成功 {x} 项，失败 {y} 项",
      toastToggleFail: "操作失败：{err}",
      processingText: "处理中…",
      // ── v1.7.2 新增：三级滑块开关（全局总开关 / 分类聚合滑块 / 确认菜单）──
      aggAllLabel: "全部技能",
      aggMixedTitle: "部分停用（已停用 {x}/{y}）· 点击选择批量启停",
      aggAllOnTitle: "全部启用 · 点击选择批量启停",
      aggAllOffTitle: "全部停用 · 点击选择批量启停",
      aggEnableN: "全部启用 ({n} 项)",
      aggDisableN: "全部停用 ({n} 项)",
      aggDangerText: "将停用全部 {n} 项技能，新会话将不可用这些技能",
      aggMenuTitleGlobal: "全局批量启停 — 作用于技能库全部技能",
      aggMenuTitleCat: "分类批量启停 — 仅作用于当前分类",
      aggMenuStat: "{scope} · 共 {n} 项 · 已停用 {x} 项",
      aggCatStat: "停用 {x}/{y}",
      aggCancelText: "取消"
    };
    function T(key) {
      var ui = (S.data && S.data.ui) || null;
      return (ui && typeof ui[key] === "string" && ui[key]) || UI_FALLBACK[key] || key;
    }
    // v1.7.1 简易占位替换（字符串模板 {name}/{n}/{x}/{y}/{err}），纯 JS 实现
    function TF(key, vars) {
      var t = T(key) || "";
      vars = vars || {};
      for (var k in vars) {
        if (Object.prototype.hasOwnProperty.call(vars, k)) {
          t = String(t).split("{" + k + "}").join(String(vars[k]));
        }
      }
      return t;
    }

    var BALL_ID = "dsh-skill-browser-ball";
    var PANEL_ID = "dsh-skill-browser-panel";
    var GHOST_KEY = "dsh-skill-browser-ghost";
    var BALL_POS_KEY = "dsh-skill-browser-ball-pos";
    var BALL_VIS_KEY = "dsh-skill-browser-ball-visible";
    var FONT_BALL_VIS_KEY = "dsh-font-ball-visible";
    var TODO_BALL_VIS_KEY = "dsh-tfb-ball-visible";

    // ---- helpers ----
    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function $(id) { return document.getElementById(id); }
    function apiBase() { return "/dsh-skill-browser"; }
    function mountEl() { return document.documentElement || document.body; }

    function catMeta(id) {
      if (!S.data) return null;
      var cs = S.data.categories || [];
      for (var i = 0; i < cs.length; i++) if (cs[i].id === id) return cs[i];
      return null;
    }
    function catLabel(id) {
      if (id === "all") return "全部";
      var m = catMeta(id);
      return m ? (m.icon + " " + m.label) : id;
    }
    function subLabel(catId, subId) {
      var m = catMeta(catId);
      if (!m || !m.subs) return "";
      for (var i = 0; i < m.subs.length; i++) if (m.subs[i].id === subId) return m.subs[i].label;
      return subId;
    }

    function filtered() {
      if (!S.data) return [];
      var q = S.q.trim().toLowerCase();
      var out = [];
      var sk = S.data.skills || [];
      for (var i = 0; i < sk.length; i++) {
        var s = sk[i];
        if (S.cat !== "all" && s.cat !== S.cat) continue;
        if (S.sub && s.sub !== S.sub) continue;
        if (q) {
          var hay = (s.dir + " " + s.name + " " + (s.zh || "") + " " + (s.desc || "")).toLowerCase();
          if (hay.indexOf(q) < 0) continue;
        }
        out.push(s);
      }
      return out;
    }

    function readStore(key, def) {
      try { var v = localStorage.getItem(key); return v == null ? def : v === "1"; } catch (e) { return def; }
    }
    function writeStore(key, val) {
      try { localStorage.setItem(key, val ? "1" : "0"); } catch (e) {}
    }
    function isGhost() {
      try { return localStorage.getItem(GHOST_KEY) === "1"; } catch (e) { return false; }
    }

    // ---- data ----
    function load(refresh) {
      S.loading = true; S.error = ""; paint();
      fetch(apiBase() + "/skills" + (refresh ? "?refresh=1" : ""))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "bad response");
          S.data = d;
          closeBatchMenu();   // v1.7.2: 数据重扫后确认菜单里的 N 已过期，直接关闭
          if (S.cat !== "all" && !catMeta(S.cat)) { S.cat = "all"; S.sub = ""; }
          S.loading = false; paint();
        })
        .catch(function (e) {
          S.loading = false;
          S.error = "加载失败：" + (e && e.message ? e.message : e);
          paint();
        });
    }

    function loadLedger() {
      if (S.ledger) return;
      S.loading = true; S.error = ""; paint();
      fetch(apiBase() + "/ledger")
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) throw new Error((d && d.error) || "bad response");
          S.ledger = d;
          S.loading = false; paint();
        })
        .catch(function (e) {
          S.loading = false;
          S.error = "台账加载失败：" + (e && e.message ? e.message : e);
          paint();
        });
    }

    function loadLedgerRefresh() {
      S.ledger = null;
      loadLedger();
    }

    // ---- 运行时配置（技能库位置 / 自动台账开关）----
    // 目录选择：POST /pick-dir，由宿主端 spawn powershell -STA 弹 Windows
    // FolderBrowserDialog（系统原生对话框）。不依赖 Electron renderer 的
    // File API：Electron 32+ 已移除 File.path，webUtils 又依赖 preload 暴露，
    // webkitdirectory 方案实测拿不到可靠真实路径（两次尝试均失败）。
    function browseForDirectory() {
      var st = $("dsb-set-status");
      if (st) st.textContent = "正在打开系统目录选择框…（请在弹出的窗口中选择；若被遮挡请看任务栏）";
      fetch(apiBase() + "/pick-dir", { method: "POST" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.path) {
            var inp = $("dsb-set-root");
            if (inp) inp.value = d.path;
            saveConfig({ skillsDir: d.path }); // 选完即保存
          } else if (d && d.ok) {
            if (st) st.textContent = "已取消选择；可手动在输入框粘贴绝对路径后点「保存」";
          } else {
            if (st) st.textContent = "选择失败：" + ((d && d.error) || "未知错误") + "；可手动在输入框粘贴绝对路径";
          }
        })
        .catch(function (e) {
          if (st) st.textContent = "选择失败：" + (e && e.message ? e.message : e) + "；可手动在输入框粘贴绝对路径";
        });
    }
    function loadConfig(cb) {
      fetch(apiBase() + "/config")
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok && cb) cb(d); })
        .catch(function () {});
    }
    function saveConfig(patch) {
      var el = $("dsb-set-status");
      fetch(apiBase() + "/config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch || {})
      })
        .then(function (r) { return r.json().catch(function () { throw new Error("HTTP " + r.status); }); })
        .then(function (d) {
          if (d && d.ok) {
            S.data = null; S.ledger = null;   // 根路径可能变了，强制重扫
            if (S.open) { load(true); if (S.view === "ledger") loadLedgerRefresh(); }
            paintConfigStatus(d);
          } else {
            if (el) el.textContent = "保存失败：" + ((d && d.error) || "未知错误") + "（宿主版本可能过旧，需重启 DSH）";
          }
        })
        .catch(function (e) {
          if (el) el.textContent = "保存失败：" + (e && e.message ? e.message : e) + "（宿主版本可能过旧，需重启 DSH）";
        });
    }
    function paintConfigStatus(cfg) {
      var el = $("dsb-set-status"), inp = $("dsb-set-root"), lcb = $("dsb-set-ledger");
      if (!el) return;
      var srcMap = { "settings-override": "设置页指定", "env": "环境变量", "config": "插件配置", "auto-detect": "自动识别", "none": "未找到" };
      el.textContent = "当前技能库：" + (cfg.root || "未找到") + "（" + (srcMap[cfg.source] || cfg.source) + "）· 台账：" +
        (cfg.ledgerExists ? "已存在" : (cfg.ledgerPath ? "将自动创建" : "—"));
      if (inp && document.activeElement !== inp) inp.value = (cfg.runtime && cfg.runtime.skillsDir) || "";
      if (lcb) lcb.checked = cfg.ledgerEnabled !== false;
    }

    function openDetail(dir) {
      var box = $("dsb-detail-body"); if (box) box.textContent = "加载中…";
      S.detail = { dir: dir, content: "" };
      paint();
      fetch(apiBase() + "/skill?dir=" + encodeURIComponent(dir))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!S.detail || S.detail.dir !== dir) return;
          S.detail.content = (d && d.ok) ? d.content : ("读取失败：" + ((d && d.error) || ""));
          var box2 = $("dsb-detail-body");
          if (box2) box2.textContent = S.detail.content;
        })
        .catch(function (e) {
          var box3 = $("dsb-detail-body");
          if (box3) box3.textContent = "读取失败：" + (e && e.message ? e.message : e);
        });
    }

    function openLedgerDetail(skill) {
      var box = $("dsb-detail-body"); if (box) box.textContent = "加载中…";
      S.ledgerDetail = { skill: skill, detail: "" };
      paint();
      fetch(apiBase() + "/ledger-detail?skill=" + encodeURIComponent(skill))
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!S.ledgerDetail || S.ledgerDetail.skill !== skill) return;
          var parts = [];
          if (d && d.ok) {
            if (d.detail) parts.push("【人工台账失败明细】\n" + d.detail);
            if (d.autoEntries && d.autoEntries.length) {
              var lines = ["【自动登记记录】共 " + d.autoEntries.length + " 条（最新在前）"];
              var list = d.autoEntries.slice().reverse();
              for (var i = 0; i < list.length; i++) {
                var x = list[i];
                lines.push("- " + String(x.ts || "").replace("T", " ").slice(0, 19) + " " + (x.ok ? "✅ 生效" : "❌ 未生效") + "（" + (x.kind || "auto") + "）" + (x.note || x.error ? " — " + (x.note || x.error) : ""));
              }
              parts.push(lines.join("\n"));
            }
            if (!parts.length) parts.push("（无失败明细记录）");
          } else {
            parts.push("读取失败：" + ((d && d.error) || ""));
          }
          S.ledgerDetail.detail = parts.join("\n\n");
          var box2 = $("dsb-detail-body");
          if (box2) box2.textContent = S.ledgerDetail.detail;
        })
        .catch(function (e) {
          var box3 = $("dsb-detail-body");
          if (box3) box3.textContent = "读取失败：" + (e && e.message ? e.message : e);
        });
    }

    // ---- 字体插件球：纯 CSS 永久统一样式与显隐 ----
    // 不再轮询检查：用全局 CSS 规则 + body 属性驱动，font-enhancer 重建按钮
    // 多少次样式都自动生效（CSS 幂等）。不动 font-enhancer 一行代码。
    function applyFontBallVisibility() {
      // 属性设在 html 上（CSS 规则驱动）
      var el = document.documentElement || document.body;
      el.setAttribute("data-dsb-font-hidden", readStore(FONT_BALL_VIS_KEY, true) ? "0" : "1");
      // 内联样式兜底（font-enhancer 的 display:block !important 若因时机问题未覆盖）
      var t = document.getElementById("dsh-fe-toggle");
      if (t) t.style.setProperty("display", readStore(FONT_BALL_VIS_KEY, true) ? "" : "none", "important");
      // Todo 悬浮球（dsh-todo-float-ball）显隐：同字体球模式——共享其
      // localStorage 键（dsh-tfb-ball-visible），属性+内联双兜底，
      // 不动 todo 插件一行代码（CSS 幂等，重建后仍生效）。
      var tfb = document.getElementById("dsh-tfb-root");
      if (tfb) tfb.style.setProperty("display", readStore(TODO_BALL_VIS_KEY, true) ? "" : "none", "important");
    }
    function applyBallVisibility() {
      var el = document.documentElement || document.body;
      el.setAttribute("data-dsb-ball-hidden", readStore(BALL_VIS_KEY, true) ? "0" : "1");
    }

    // ---- panel ----
    var PANEL_CSS =
      '#dsh-skill-browser-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:min(940px,94vw);height:min(660px,88vh);display:flex;flex-direction:column;' +
      'background:rgba(24,26,34,.97);color:#e8eaf2;border:1px solid rgba(255,255,255,.1);border-radius:14px;' +
      'box-shadow:0 12px 48px rgba(0,0,0,.5);z-index:2147481100;overflow:hidden;font-family:inherit}' +
      '#dsb-built{display:flex;flex-direction:column;min-height:0;flex:1}' +
      '.dsb-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px 6px}' +
      '.dsb-title{font-size:16px;font-weight:600}' +
      '.dsb-headbtns{display:flex;gap:6px}' +
      '.dsb-btn{background:rgba(255,255,255,.08);color:#dfe3ee;border:1px solid rgba(255,255,255,.12);border-radius:8px;' +
      'padding:4px 10px;font-size:12px;cursor:pointer}' +
      '.dsb-btn:hover{background:rgba(255,255,255,.16)}' +
      '.dsb-subtitle{padding:0 16px 6px;font-size:11px;color:#9aa1b5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.dsb-settings{display:none;padding:6px 16px;gap:6px;flex-direction:column;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:4px}' +
      '.dsb-set-row{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;padding:2px 0}' +
      '.dsb-set-row input{accent-color:#5b6cff}' +
      '.dsb-set-hint{font-size:11px;color:#9aa1b5}' +
      '.dsb-set-rec{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12.5px;padding:3px 0}' +
      '.dsb-set-rec a{text-decoration:none;font-size:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:2px 8px;color:#ffd27a;cursor:pointer;white-space:nowrap}' +
      '.dsb-set-rec a:hover{background:rgba(255,210,122,.15);border-color:rgba(255,210,122,.4)}' +
      // v1.7.4 设置面板金边推广卡（广告卡自技能清单迁入）：稍窄适配面板宽度
      '.dsb-set-promo{border:1px solid rgba(255,210,122,.35);border-radius:8px;padding:6px 10px;margin-top:6px;background:rgba(255,210,122,.05);cursor:pointer;transition:background .15s}' +
      '.dsb-set-promo:hover{background:rgba(255,210,122,.12)}' +
      '.dsb-set-promo .p-name{font-size:12.5px;font-weight:600;color:#ffd27a}' +
      '.dsb-set-promo .p-desc{font-size:11.5px;color:#c6cbdb;line-height:1.5;margin-top:2px;white-space:normal}' +
      '.dsb-set-promo .p-tag{font-size:10.5px;color:#9aa1b5;margin-top:2px}' +
      '.dsb-q{margin:4px 16px 8px;padding:7px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.14);' +
      'background:rgba(255,255,255,.06);color:#eef;font-size:13px;outline:none}' +
      '.dsb-q:focus{border-color:#5b8cff}' +
      '.dsb-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 6px}' +
      '.dsb-chip,.dsb-schip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#cdd3e3;' +
      'border-radius:999px;padding:3px 10px;font-size:12px;cursor:pointer;white-space:nowrap}' +
      '.dsb-chip:hover,.dsb-schip:hover{background:rgba(255,255,255,.14)}' +
      '.dsb-chip-on{background:linear-gradient(135deg,#5b6cff,#2fa8ff);color:#fff;border-color:transparent}' +
      '.dsb-n{opacity:.75;font-size:11px;margin-left:2px}' +
      '.dsb-subs{display:none;flex-wrap:wrap;gap:6px;padding:0 16px 6px;border-top:1px dashed rgba(255,255,255,.08);padding-top:8px;margin:0 0 2px}' +
      '.dsb-cards{flex:1;min-height:0;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));' +
      'gap:8px;padding:6px 16px 14px;align-content:start}' +
      '.dsb-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:10px;' +
      'padding:10px 12px;cursor:pointer;transition:background .12s}' +
      '.dsb-card:hover{background:rgba(120,140,255,.14);border-color:rgba(120,140,255,.4)}' +
      '.dsb-card-name{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:#8fc7ff;word-break:break-all}' +
      '.dsb-card-zh{font-size:12.5px;color:#dfe3ee;margin-top:5px;line-height:1.5;' +
      'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
      '.dsb-card-tag{font-size:10.5px;color:#8b93a8;margin-top:6px}' +
      '.dsb-empty{grid-column:1/-1;text-align:center;color:#9aa1b5;padding:40px 0;font-size:13px;line-height:1.7}' +
      '.dsb-detail{position:absolute;inset:0;background:rgba(24,26,34,.99);flex-direction:column;z-index:2}' +
      '.dsb-detail-body{flex:1;min-height:0;overflow:auto;margin:0;padding:6px 16px 16px;' +
      'font-family:ui-monospace,Consolas,monospace;font-size:12px;line-height:1.65;color:#cfd6e8;white-space:pre-wrap;word-break:break-word}' +
      '.dsb-tabs{display:flex;gap:4px;margin:0 8px}' +
      '.dsb-tab{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#cdd3e3;' +
      'border-radius:8px;padding:4px 12px;font-size:12px;cursor:pointer}' +
      '.dsb-tab:hover{background:rgba(255,255,255,.14)}' +
      '.dsb-tab-on{background:linear-gradient(135deg,#5b6cff,#2fa8ff);color:#fff;border-color:transparent}' +
      '.dsb-ledger{flex:1;min-height:0;display:flex;flex-direction:column;padding:0 16px 14px}' +
      '.dsb-ledger-sum{display:flex;gap:10px;padding:4px 0 10px}' +
      '.dsb-lsum-card{flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:10px;' +
      'padding:10px;text-align:center}' +
      '.dsb-lsum-card b{display:block;font-size:22px;color:#8fc7ff}' +
      '.dsb-lsum-card span{font-size:11px;color:#9aa1b5}' +
      '.dsb-lsum-fail b{color:#ff9d9d}' +
      '.dsb-ledger-table{flex:1;min-height:0;overflow-y:auto}' +
      '.dsb-ltable{display:flex;flex-direction:column;gap:4px}' +
      '.dsb-lrow{display:grid;grid-template-columns:34px 1fr 44px 44px 92px 1.2fr;gap:6px;align-items:center;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:7px 10px;' +
      'font-size:12px;cursor:pointer;transition:background .12s}' +
      '.dsb-lrow:hover{background:rgba(120,140,255,.14)}' +
      '.dsb-lhead{background:transparent;border-color:transparent;cursor:default;font-size:11px;color:#8b93a8}' +
      '.dsb-lc-skill{font-family:ui-monospace,Consolas,monospace;color:#8fc7ff;word-break:break-all}' +
      '.dsb-lc-fail{color:#ff9d9d;font-weight:700;text-align:center}' +
      '.dsb-lc-rate{text-align:center}' +
      '.dsb-lv-high{color:#ff7d7d;font-weight:700}' +
      '.dsb-lv-mid{color:#ffb35c;font-weight:700}' +
      '.dsb-lv-low{color:#ffd27a}' +
      '.dsb-lst-done{color:#6fd48a}' +
      '.dsb-lst-warn{color:#ffb35c}' +
      '.dsb-lst-ok{color:#9aa1b5}' +
      /* ── v1.7.0：排序切换 / 批量启停 / 单技能开关 / 停用视觉 ── */
      '.dsb-sortbar{display:flex;align-items:center;gap:8px;padding:0 16px 6px}' +
      '.dsb-sortbtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cdd3e3;' +
      'border-radius:999px;padding:3px 12px;font-size:12px;cursor:pointer;white-space:nowrap}' +
      '.dsb-sortbtn:hover{background:rgba(255,255,255,.14)}' +
      '.dsb-sortbtn-on{background:linear-gradient(135deg,#5b6cff,#2fa8ff);color:#fff;border-color:transparent}' +
      '.dsb-batchbtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cdd3e3;' +
      'border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap;margin-left:6px}' +
      '.dsb-batchbtn:hover{background:rgba(255,255,255,.14)}' +
      '.dsb-batchbtn-warn{color:#ffb3b3;border-color:rgba(255,120,120,.35)}' +
      '.dsb-batchbtn-warn:hover{background:rgba(255,120,120,.15)}' +
      '.dsb-batchbtn[disabled],.dsb-tgl[disabled]{opacity:.5;cursor:default}' +
      '.dsb-batch-status{font-size:11px;color:#9aa1b5}' +
      '.dsb-batch-fail{color:#ff9d9d}' +
      '.dsb-card-off{opacity:.45;filter:grayscale(.7)}' +
      '.dsb-card-off:hover{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.08)}' +
      '.dsb-badge-off{display:inline-block;font-size:10px;color:#ffd27a;background:rgba(255,210,122,.12);' +
      'border:1px solid rgba(255,210,122,.35);border-radius:6px;padding:0 6px;margin-left:6px;vertical-align:1px}' +
      '.dsb-card-mtime{font-size:10.5px;color:#8b93a8;margin-top:3px}' +
      '.dsb-tgl{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#cdd3e3;' +
      'border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap}' +
      '.dsb-tgl:hover{background:rgba(255,255,255,.16)}' +
      '.dsb-tgl-on{color:#9fe0b5;border-color:rgba(120,220,150,.35)}' +
      /* ── v1.7.1：滑动开关（胶囊轨道 34×18 + 圆形滑块，乐观更新）──
         结构：<label class="dsb-switch" data-tgl=dir data-to=0|1>
                 <span class="dsb-sw-track"><span class="dsb-sw-thumb"></span></span>
                 <span class="dsb-sw-label">开/关</span></label>
         开启态：.dsb-sw-on 轨道绿 #27ae60、滑块右移；停用态：轨道灰 #555、滑块左移。 */
      '#dsh-skill-browser-panel .dsb-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none}' +
      '#dsh-skill-browser-panel .dsb-switch[disabled]{opacity:.5;cursor:default}' +
      '#dsh-skill-browser-panel .dsb-sw-track{position:relative;display:inline-block;width:34px;height:18px;' +
      'border-radius:999px;background:#555;transition:background .2s;flex:none}' +
      '#dsh-skill-browser-panel .dsb-sw-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;' +
      'border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:left .2s}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-on .dsb-sw-track{background:#27ae60}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-on .dsb-sw-thumb{left:18px}' +
      '#dsh-skill-browser-panel .dsb-sw-label{font-size:11px;color:#9aa1b5;white-space:nowrap}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-on .dsb-sw-label{color:#9fe0b5}' +
      /* ── v1.7.1：面板内右上角 toast 轻提示（2s 自动消失，成功绿/失败红）── */
      '#dsh-skill-browser-panel .dsb-toast{position:absolute;top:54px;right:16px;z-index:50;max-width:60%;' +
      'padding:8px 14px;border-radius:9px;font-size:12.5px;line-height:1.5;white-space:nowrap;overflow:hidden;' +
      'text-overflow:ellipsis;box-shadow:0 6px 22px rgba(0,0,0,.45);opacity:0;transform:translateY(-6px);' +
      'transition:opacity .2s,transform .2s;pointer-events:none}' +
      '#dsh-skill-browser-panel .dsb-toast.dsb-toast-show{opacity:1;transform:translateY(0)}' +
      '#dsh-skill-browser-panel .dsb-toast-ok{background:rgba(39,174,96,.95);color:#fff;border:1px solid rgba(255,255,255,.25)}' +
      '#dsh-skill-browser-panel .dsb-toast-err{background:rgba(192,57,43,.95);color:#fff;border:1px solid rgba(255,255,255,.25)}' +
      /* ── v1.7.2：三级滑块开关（聚合态半开 / 小号分类滑块 / 面板内确认菜单）──
         半开态 .dsb-sw-half：轨道左半灰右半绿 + 滑块居中，标签暖黄；
         全启用=右绿（复用 .dsb-sw-on），全停用=左灰（无附加类）。 */
      '#dsh-skill-browser-panel .dsb-sw-half .dsb-sw-track{background:linear-gradient(90deg,#555 0%,#555 50%,#27ae60 50%,#27ae60 100%)}' +
      '#dsh-skill-browser-panel .dsb-sw-half .dsb-sw-thumb{left:10px}' +
      '#dsh-skill-browser-panel .dsb-sw-half .dsb-sw-label{color:#ffd27a}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-agg[aria-disabled]{opacity:.5;cursor:default}' +
      '#dsh-skill-browser-panel .dsb-sw-sep{width:1px;height:16px;background:rgba(255,255,255,.14);margin:0 2px;flex:none}' +
      /* 分类级小一号胶囊滑块（轨道 26×14，滑块 10px） */
      '#dsh-skill-browser-panel .dsb-sw-sm .dsb-sw-track{width:26px;height:14px}' +
      '#dsh-skill-browser-panel .dsb-sw-sm .dsb-sw-thumb{width:10px;height:10px;top:2px;left:2px}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-sm.dsb-sw-on .dsb-sw-thumb{left:14px}' +
      '#dsh-skill-browser-panel .dsb-switch.dsb-sw-sm.dsb-sw-half .dsb-sw-thumb{left:8px}' +
      /* 面板内批量确认菜单（透明遮罩点击关闭 + 菜单浮层，非 window.confirm） */
      '#dsh-skill-browser-panel .dsb-bmenu-mask{position:absolute;inset:0;z-index:58;background:transparent}' +
      '#dsh-skill-browser-panel .dsb-bmenu{position:absolute;z-index:59;min-width:230px;max-width:78%;' +
      'background:#232633;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:6px;' +
      'box-shadow:0 10px 32px rgba(0,0,0,.55);display:none;flex-direction:column;gap:4px}' +
      '#dsh-skill-browser-panel .dsb-bmenu-title{font-size:11px;color:#9aa1b5;padding:2px 6px 4px;line-height:1.5}' +
      '#dsh-skill-browser-panel .dsb-bmenu-item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;' +
      'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#dfe3ee;border-radius:8px;' +
      'padding:6px 10px;font-size:12.5px;cursor:pointer;text-align:left;width:100%}' +
      '#dsh-skill-browser-panel .dsb-bmenu-item:hover{background:rgba(120,140,255,.18)}' +
      '#dsh-skill-browser-panel .dsb-bmenu-sub{font-size:10.5px;color:#9aa1b5;font-weight:400;line-height:1.5;white-space:normal}' +
      '#dsh-skill-browser-panel .dsb-bmenu-danger{color:#ffb3b3;border-color:rgba(255,120,120,.4)}' +
      '#dsh-skill-browser-panel .dsb-bmenu-danger:hover{background:rgba(255,120,120,.16)}' +
      '#dsh-skill-browser-panel .dsb-bmenu-danger .dsb-bmenu-sub{color:#ff9d9d}' +
      '#dsh-skill-browser-panel .dsb-bmenu-cancel{background:transparent;border:none;color:#9aa1b5;font-size:12px;cursor:pointer;padding:4px 6px;text-align:center}' +
      '#dsh-skill-browser-panel .dsb-bmenu-cancel:hover{color:#dfe3ee}';

    function buildPanel() {
      if (S.panelBuilt) return;
      var style = document.createElement("style");
      style.id = "dsb-panel-style";
      style.textContent = PANEL_CSS;
      document.head.appendChild(style);

      var panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.innerHTML =
        '<div class="dsb-head">' +
          '<div class="dsb-title">🧩 技能浏览器</div>' +
          '<div class="dsb-tabs">' +
            '<button id="dsb-tab-skills" class="dsb-tab" data-view="skills">技能浏览</button>' +
            '<button id="dsb-tab-ledger" class="dsb-tab" data-view="ledger">📋 失效台账</button>' +
          '</div>' +
          '<div class="dsb-headbtns">' +
            '<button id="dsb-setting" class="dsb-btn" title="开关设置">⚙</button>' +
            '<button id="dsb-refresh" class="dsb-btn" title="重新扫描技能目录">↻ 刷新</button>' +
            '<button id="dsb-close" class="dsb-btn" title="关闭">×</button>' +
          '</div>' +
        '</div>' +
        '<div id="dsb-subtitle" class="dsb-subtitle"></div>' +
        '<div id="dsb-settings" class="dsb-settings" style="display:none">' +
          '<label class="dsb-set-row"><input type="checkbox" id="dsb-set-ball" /> 技能浏览器悬浮球（🧩）</label>' +
          '<label class="dsb-set-row"><input type="checkbox" id="dsb-set-font" /> 字体插件悬浮球（🔤）</label>' +
          '<div class="dsb-set-row" style="flex-wrap:wrap">' +
            '<span style="min-width:70px">技能库位置</span>' +
            '<input id="dsb-set-root" type="text" placeholder="留空=自动识别（~/.dsh/skills 等）" style="flex:1;min-width:220px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:6px;color:#eef;font-size:12px;padding:4px 8px;outline:none" />' +
            '<button id="dsb-set-root-browse" class="dsb-btn" title="打开系统文件夹选择框">📁 选择</button>' +
            '<button id="dsb-set-root-save" class="dsb-btn">保存</button>' +
          '</div>' +
          '<label class="dsb-set-row"><input type="checkbox" id="dsb-set-ledger" /> 失效台账自动登记（记录每次技能工具调用结果）</label>' +
          '<span id="dsb-set-status" class="dsb-set-hint">当前技能库：识别中…</span>' +
          '<span class="dsb-set-hint">💡 悬浮球显隐也可在 <b>DSH 设置页 → 「悬浮球导航」分区</b> 中控制；悬浮球可拖动；清单面板始终居中</span>' +
          // ── v1.7.4 广告区（用户指定落位：设置面板 hint 之后）──
          // hint 文案与原"💡悬浮球显隐设置"说明卡内容重复，二选一保留 hint。
          // 3 张金边推广卡（.dsb-set-promo，rgba(255,210,122,.35)），前两张
          // data-ext-url 点击直达 GitHub（委托见 buildPanel dsb-settings 绑定）。
          // 不带 data-dir/data-tgl：不参与排序/计数/开关逻辑。
          '<div class="dsb-set-promo" data-ext-url="https://github.com/loyalchiiina/dsh-chat-image-lightbox" title="点击打开 GitHub 仓库">' +
            '<div class="p-name">🖼️ 推荐 · 照片显示器</div>' +
            '<div class="p-desc">聊天图片灯箱：多图自动网格、全屏放大、高清下载——本插件悬浮球导航的好搭档</div>' +
            '<div class="p-tag">dsh-chat-image-lightbox · 点击访问 ⭐ Star</div>' +
          '</div>' +
          '<div class="dsb-set-promo" data-ext-url="https://github.com/loyalchiiina/dsh-font-enhancer" title="点击打开 GitHub 仓库">' +
            '<div class="p-name">🔤 推荐 · 字体插件</div>' +
            '<div class="p-desc">界面分区自定义字体/颜色/字号，自带字体球与一键装字体——和技能球并排两个悬浮球</div>' +
            '<div class="p-tag">dsh-font-enhancer · 点击访问 ⭐ Star</div>' +
          '</div>' +
          '<div class="dsb-set-promo" data-ext-url="https://github.com/loyalchiiina/dsh-todo-float-ball" title="点击打开 GitHub 仓库">' +
            '<div class="p-name">📋 推荐 · Todo 悬浮球</div>' +
            '<div class="p-desc">任务进度悬浮球：AI 的任务清单常驻屏幕，实时显示进行中步骤——多步长任务不错过进度（v0.9.0 已上 npm）</div>' +
            '<div class="p-tag">dsh-todo-float-ball · 点击访问 ⭐ Star</div>' +
          '</div>' +
        '</div>' +
        '<input id="dsb-q" class="dsb-q" type="text" placeholder="🔍 搜索技能名 / 中文简介 / 描述…" />' +
        '<div id="dsb-sortbar" class="dsb-sortbar" style="display:none"></div>' +
        '<div id="dsb-chips" class="dsb-chips"></div>' +
        '<div id="dsb-subs" class="dsb-subs"></div>' +
        '<div id="dsb-cards" class="dsb-cards"></div>' +
        '<div id="dsb-ledger" class="dsb-ledger" style="display:none">' +
          '<div id="dsb-ledger-sum" class="dsb-ledger-sum"></div>' +
          '<div id="dsb-ledger-table" class="dsb-ledger-table"></div>' +
        '</div>' +
        '<div id="dsb-detail" class="dsb-detail" style="display:none">' +
          '<div class="dsb-head">' +
            '<div id="dsb-detail-title" class="dsb-title" style="font-size:14px"></div>' +
            '<div class="dsb-headbtns">' +
              '<button id="dsb-copy" class="dsb-btn" title="复制全文">复制</button>' +
              '<button id="dsb-back" class="dsb-btn">← 返回</button>' +
            '</div>' +
          '</div>' +
          '<pre id="dsb-detail-body" class="dsb-detail-body"></pre>' +
        '</div>';
      mountEl().appendChild(panel);

      // v1.7.1 toast 轻提示容器：绝对定位在面板右上角（CSS .dsb-toast），初始隐藏
      var toastHost = document.createElement("div");
      toastHost.id = "dsb-toast";
      toastHost.className = "dsb-toast";
      panel.appendChild(toastHost);

      // v1.7.2 三级滑块的批量确认菜单（面板内浮层，替代 window.confirm）：
      // 透明遮罩（点击任意处关闭）+ 菜单浮层（锚定在所点滑块下方，越界自动翻上来）
      var bmenuMask = document.createElement("div");
      bmenuMask.id = "dsb-bmenu-mask";
      bmenuMask.className = "dsb-bmenu-mask";
      bmenuMask.style.display = "none";
      panel.appendChild(bmenuMask);
      var bmenu = document.createElement("div");
      bmenu.id = "dsb-bmenu";
      bmenu.className = "dsb-bmenu";
      bmenu.style.display = "none";
      panel.appendChild(bmenu);
      bmenu.addEventListener("click", function (ev) {
        var it = ev.target.closest("[data-bmenu-act]");
        if (!it) return;
        var act = it.getAttribute("data-bmenu-act");
        var scope = S.batchMenuScope;
        closeBatchMenu();
        if (!scope || act === "cancel") return;
        if (act === "enable") batchToggle(scope, false);
        else if (act === "disable") batchToggle(scope, true);
      });
      bmenuMask.addEventListener("click", function () { closeBatchMenu(); });

      $("dsb-close").addEventListener("click", function () { closePanel(); });
      $("dsb-refresh").addEventListener("click", function () { if (S.view === "ledger") loadLedgerRefresh(); else load(true); });
      $("dsb-setting").addEventListener("click", function () {
        var box = $("dsb-settings");
        if (!box) return;
        var show = box.style.display !== "block";
        box.style.display = show ? "block" : "none";
        if (show) { syncSettingsUI(); loadConfig(paintConfigStatus); }
      });
      var ballCb = $("dsb-set-ball"), fontCb = $("dsb-set-font");
      if (ballCb) ballCb.addEventListener("change", function () {
        writeStore(BALL_VIS_KEY, ballCb.checked);
        applyBallVisibility();
        if (!ballCb.checked && S.open) closePanel();
      });
      if (fontCb) fontCb.addEventListener("change", function () {
        writeStore(FONT_BALL_VIS_KEY, fontCb.checked);
        applyFontBallVisibility();
      });
      var ledgerCb = $("dsb-set-ledger");
      if (ledgerCb) ledgerCb.addEventListener("change", function () {
        saveConfig({ ledgerEnabled: ledgerCb.checked });
      });
      var rootSave = $("dsb-set-root-save");
      if (rootSave) rootSave.addEventListener("click", function () {
        var inp = $("dsb-set-root");
        if (inp) saveConfig({ skillsDir: inp.value });
      });
      var rootBrowse = $("dsb-set-root-browse");
      if (rootBrowse) rootBrowse.addEventListener("click", function () { browseForDirectory(); });
      $("dsb-q").addEventListener("input", function () { S.q = this.value; S.sub = ""; paintChips(); paintSubs(); paintCards(); });
      $("dsb-back").addEventListener("click", function () { S.detail = null; S.ledgerDetail = null; paint(); });
      $("dsb-tab-skills").addEventListener("click", function () { S.view = "skills"; S.detail = null; S.ledgerDetail = null; paint(); });
      $("dsb-tab-ledger").addEventListener("click", function () { S.view = "ledger"; S.detail = null; if (!S.ledger) loadLedger(); else paint(); });
      $("dsb-ledger-table").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-lskill]");
        if (!el) return;
        openLedgerDetail(el.getAttribute("data-lskill"));
      });
      $("dsb-chips").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-cat]");
        if (!el) return;
        S.cat = el.getAttribute("data-cat");
        S.sub = "";
        paintChips(); paintSubs(); paintCards(); paintSortbar();
      });
      $("dsb-subs").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-sub]");
        if (!el) return;
        S.sub = el.getAttribute("data-sub");
        paintSubs(); paintCards();
      });
      // v1.7.0 排序切换 + v1.7.1 四态循环 + 分类级批量启停（事件委托到排序栏容器）
      $("dsb-sortbar").addEventListener("click", function (ev) {
        var sb = ev.target.closest("[data-sort]");
        if (sb) {
          // v1.7.1 四态循环：点击沿 SORT_ORDER 前进一步（名称↑→名称↓→时间↓→时间↑）
          S.sortMode = nextSortMode(sb.getAttribute("data-sort") || S.sortMode);
          paintSortbar(); paintCards();
          return;
        }
        // v1.7.2 聚合滑块（全局 data-bagg="global" / 分类 data-bagg="<cat-id>"）：
        // 点击弹出面板内确认菜单（openBatchMenu），不再走 window.confirm
        var agg = ev.target.closest("[data-bagg]");
        if (agg) {
          openBatchMenu(agg, agg.getAttribute("data-bagg") || "global");
          return;
        }
      });
      // v1.7.4 设置面板推广卡（data-ext-url）点击直达 GitHub：
      // 广告卡迁入 #dsb-settings 后，原 #dsb-cards 委托覆盖不到，此处补一条同款委托。
      $("dsb-settings").addEventListener("click", function (ev) {
        var ext = ev.target.closest("[data-ext-url]");
        if (ext) {
          try { window.open(ext.getAttribute("data-ext-url"), "_blank", "noopener"); } catch (e2) {}
        }
      });
      $("dsb-cards").addEventListener("click", function (ev) {
        var ext = ev.target.closest("[data-ext-url]");
        if (ext) {
          try { window.open(ext.getAttribute("data-ext-url"), "_blank", "noopener"); } catch (e2) {}
          return;
        }
        // v1.7.0 单技能启用/停用开关：点开关不打开详情（closest 先命中 tgl 按钮）
        var tgl = ev.target.closest("[data-tgl]");
        if (tgl) {
          if (S.toggling) return;
          var d1 = tgl.getAttribute("data-tgl");
          var toDisabled = tgl.getAttribute("data-to") === "1";
          toggleSkill(d1, toDisabled);
          return;
        }
        var el = ev.target.closest("[data-dir]");
        if (!el) return;
        openDetail(el.getAttribute("data-dir"));
      });

      S.panelBuilt = true;
    }

    function closePanel() {
      S.open = false;
      S.detail = null;
      S.batchMenuScope = null;   // v1.7.2: 面板随 DOM 一起销毁，同步清确认菜单状态
      var p = $(PANEL_ID);
      if (p && p.parentNode) p.parentNode.removeChild(p);
      var st = $("dsb-panel-style");
      if (st && st.parentNode) st.parentNode.removeChild(st);
      S.panelBuilt = false;
    }

    function openPanel() {
      buildPanel();
      S.open = true;
      paint();
      if (!S.data && !S.loading) load(false);
    }

    function paint() {
      var panel = $(PANEL_ID);
      if (!panel || !S.panelBuilt) return;
      panel.style.display = S.open ? "flex" : "none";
      if (!S.open) return;
      var isLedger = S.view === "ledger";
      var q = $("dsb-q"), chips = $("dsb-chips"), subs = $("dsb-subs"), cards = $("dsb-cards"), lg = $("dsb-ledger"), sortbar = $("dsb-sortbar");
      if (q) q.style.display = isLedger ? "none" : "";
      if (chips) chips.style.display = isLedger ? "none" : "";
      if (subs) subs.style.display = isLedger ? "none" : "";
      if (cards) cards.style.display = isLedger ? "none" : "";
      if (sortbar) sortbar.style.display = isLedger ? "none" : "";
      if (lg) lg.style.display = isLedger ? "block" : "none";
      var t1 = $("dsb-tab-skills"), t2 = $("dsb-tab-ledger");
      if (t1) t1.classList.toggle("dsb-tab-on", !isLedger);
      if (t2) t2.classList.toggle("dsb-tab-on", isLedger);
      paintHeader();
      if (isLedger) paintLedger();
      else { paintSortbar(); paintChips(); paintSubs(); paintCards(); }
      paintDetail();
    }

    function paintHeader() {
      var sub = $("dsb-subtitle");
      if (!sub) return;
      if (S.loading && !S.data) { sub.textContent = "扫描技能目录中…"; return; }
      if (S.error) { sub.innerHTML = '<span style="color:#ff8f8f">' + esc(S.error) + '</span>'; return; }
      if (!S.data) return;
      var offCount = 0;
      var sk = S.data.skills || [];
      for (var i = 0; i < sk.length; i++) { if (sk[i].disabled) offCount++; }
      sub.textContent = "共 " + S.data.total + " 个技能" +
        (offCount ? "（" + offCount + " 已停用）" : "") +
        " · " + (S.data.root || "?") +
        " · 生成于 " + String(S.data.generatedAt || "").replace("T", " ").slice(0, 16);
    }

    function paintChips() {
      var box = $("dsb-chips"); if (!box) return;
      if (!S.data) { box.innerHTML = ""; return; }
      var cs = S.data.categories || [];
      var counts = {};
      var sk = S.data.skills || [];
      for (var i = 0; i < sk.length; i++) counts[sk[i].cat] = (counts[sk[i].cat] || 0) + 1;
      var html = chip("all", "🧩 全部", S.data.total, S.cat === "all");
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        html += chip(c.id, (c.icon || "") + " " + esc(c.label), counts[c.id] || 0, S.cat === c.id);
      }
      box.innerHTML = html;
    }
    function chip(id, label, count, active) {
      return '<button class="dsb-chip' + (active ? " dsb-chip-on" : "") + '" data-cat="' + esc(id) + '">' +
        esc(label) + ' <span class="dsb-n">' + count + "</span></button>";
    }

    function paintSubs() {
      var box = $("dsb-subs"); if (!box) return;
      var m = catMeta(S.cat);
      if (!m || !m.subs || !m.subs.length || S.cat === "all") { box.innerHTML = ""; box.style.display = "none"; return; }
      box.style.display = "flex";
      var counts = {};
      var sk = S.data.skills || [];
      var q = S.q.trim().toLowerCase();
      for (var i = 0; i < sk.length; i++) {
        var s = sk[i];
        if (s.cat !== S.cat) continue;
        if (q && (s.dir + " " + s.name + " " + (s.zh || "") + " " + (s.desc || "")).toLowerCase().indexOf(q) < 0) continue;
        counts[s.sub || "_"] = (counts[s.sub || "_"] || 0) + 1;
      }
      var total = 0, k;
      for (k in counts) total += counts[k];
      var html = '<button class="dsb-schip' + (S.sub === "" ? " dsb-chip-on" : "") + '" data-sub="">全部 ' + total + "</button>";
      for (var j = 0; j < m.subs.length; j++) {
        var sb = m.subs[j];
        var n = counts[sb.id] || 0;
        if (!n) continue;
        html += '<button class="dsb-schip' + (S.sub === sb.id ? " dsb-chip-on" : "") + '" data-sub="' + esc(sb.id) + '">' +
          esc(sb.label) + " " + n + "</button>";
      }
      box.innerHTML = html;
    }

    // ── v1.7.2 三级滑块：聚合态计算与渲染 ──
    // aggCount：统计（可选按分类过滤）技能总数与已停用数——唯一数据源是
    // S.data.skills 的 disabled 字段（内存数据，不额外请求）。
    function aggCount(list, catFilter) {
      var total = 0, off = 0;
      for (var i = 0; i < list.length; i++) {
        if (catFilter && list[i].cat !== catFilter) continue;
        total++;
        if (list[i].disabled) off++;
      }
      return { total: total, off: off };
    }
    // aggState："on"=全部启用（右绿）| "off"=全部停用（左灰）| "half"=混合（居中半开）
    function aggState(a) {
      if (!a.total) return "off";
      if (!a.off) return "on";
      if (a.off >= a.total) return "off";
      return "half";
    }
    // aggSwitchHtml：胶囊滑块 HTML（样式复用 .dsb-switch；state=on 加 dsb-sw-on、
    // half 加 dsb-sw-half；label 可空——分类滑块不带文字标签，旁边小字显示 停用 x/y）
    function aggSwitchHtml(state, attrs, title, label, small) {
      var cls = "dsb-switch dsb-sw-agg" + (small ? " dsb-sw-sm" : "") +
        (state === "on" ? " dsb-sw-on" : "") + (state === "half" ? " dsb-sw-half" : "");
      return '<label class="' + cls + '" ' + attrs + ' title="' + esc(title || "") + '"' +
        (S.toggling ? ' aria-disabled="true"' : "") + ">" +
        '<span class="dsb-sw-track"><span class="dsb-sw-thumb"></span></span>' +
        (label ? '<span class="dsb-sw-label">' + esc(label) + "</span>" : "") +
        "</label>";
    }
    // ── v1.7.0 排序栏 + v1.7.1 四态循环按钮 + v1.7.2 三级滑块聚合开关 ──
    // 排序单按钮显示当前排序态（点击循环）；排序按钮右侧=全局总开关（"全部技能"）；
    // 选中具体分类时再追加分类级小滑块 + 小字"停用 x/y"。
    function sortLabel(m) {
      if (m === "name-asc") return T("sortNameAsc");
      if (m === "name-desc") return T("sortNameDesc");
      if (m === "mtime-asc") return T("sortMtimeAsc");
      if (m === "mtime-desc") return T("sortMtimeDesc");
      return T("sortNameAsc");
    }
    function paintSortbar() {
      var box = $("dsb-sortbar"); if (!box) return;
      var m = normalizeSortMode(S.sortMode);
      S.sortMode = m;
      var btns =
        '<button class="dsb-sortbtn dsb-sortbtn-on" data-sort="' + m + '" title="' + esc(T("sortCycleTitle")) + '">' +
        esc(sortLabel(m)) + '</button>';
      // v1.7.2 全局总开关（最重要）：标签"全部技能"，状态=所有技能聚合
      // （全启用→右绿 / 全停用→左灰 / 混合→居中半开+title"部分停用"）；
      // 点击任意态弹面板内确认菜单 openBatchMenu
      var sk = (S.data && S.data.skills) || [];
      var ga = aggCount(sk, null);
      var gs = aggState(ga);
      var gTitle = gs === "half" ? TF("aggMixedTitle", { x: ga.off, y: ga.total })
        : (gs === "on" ? T("aggAllOnTitle") : T("aggAllOffTitle"));
      var html = btns + aggSwitchHtml(gs, 'data-bagg="global"', gTitle, T("aggAllLabel"), false);
      // v1.7.2 分类级滑块：替换 v1.7.0 的"全启用/全停用"两个按钮——小一号胶囊
      // 滑块 + 旁边小字"停用 x/y"（该分类已停用数/总数），聚合逻辑同全局
      if (S.cat !== "all") {
        var ca = aggCount(sk, S.cat);
        var cs = aggState(ca);
        var cTitle = catLabel(S.cat) + " · " + (cs === "half" ? TF("aggMixedTitle", { x: ca.off, y: ca.total })
          : (cs === "on" ? T("aggAllOnTitle") : T("aggAllOffTitle")));
        html += '<span class="dsb-sw-sep"></span>' +
          aggSwitchHtml(cs, 'data-bagg="' + esc(S.cat) + '"', cTitle, "", true) +
          '<span class="dsb-batch-status">' + esc(TF("aggCatStat", { x: ca.off, y: ca.total })) + '</span>';
      }
      // v1.7.1 保留：批量进行中显示"处理中…"（滑块同时 aria-disabled 防重入）
      if (S.toggling) html += '<span class="dsb-batch-status">' + esc(T("processingText")) + '</span>';
      box.innerHTML = html;
    }

    // v1.7.1：统一排序（总清单与分类内共用），四态口径——
    //   name-asc：名称升序（A→Z，localeCompare）；name-desc：名称降序（Z→A）
    //   mtime-desc：修改时间新→旧（最新在前）；mtime-asc：旧→新（最旧在前）
    // 同名/同时间的次序键用 dir 兜底，保证排序稳定可复现
    function sortList(list) {
      var m = normalizeSortMode(S.sortMode);
      var out = list.slice();
      if (m === "name-desc" || m === "name-asc") {
        out.sort(function (a, b) {
          var c = String(a.dir || "").localeCompare(String(b.dir || ""));
          return m === "name-asc" ? c : -c;
        });
      } else {
        out.sort(function (a, b) {
          var d = (Number(b.mtime) || 0) - (Number(a.mtime) || 0);
          if (!d) d = String(a.dir || "").localeCompare(String(b.dir || ""));
          return m === "mtime-desc" ? d : -d;
        });
      }
      return out;
    }

    // v1.7.0：毫秒时间戳 → yyyy-MM-dd HH:mm（本地时区；非法/0 返回空）
    function fmtTime(ms) {
      var n = Number(ms);
      if (!isFinite(n) || n <= 0) return "";
      var d = new Date(n);
      if (isNaN(d.getTime())) return "";
      function p2(x) { return (x < 10 ? "0" : "") + x; }
      return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
    }

    // v1.7.1：面板内 toast 轻提示（右上角浮层，2 秒自动消失）。
    // kind="ok" 绿 / "err" 红；新提示覆盖旧提示并重置 2 秒计时；
    // 面板未构建/已关闭时元素不存在，静默跳过。
    function showToast(kind, text) {
      var el = $("dsb-toast");
      if (!el) return;
      el.className = "dsb-toast " + (kind === "err" ? "dsb-toast-err" : "dsb-toast-ok");
      el.textContent = text;
      el.classList.add("dsb-toast-show");
      if (S.toastTimer) { try { clearTimeout(S.toastTimer); } catch (e0) {} S.toastTimer = null; }
      S.toastTimer = setTimeout(function () {
        el.classList.remove("dsb-toast-show");
        S.toastTimer = null;
      }, 2000);
    }

    // v1.7.1：单技能启用/停用（乐观更新）→ 点击瞬间先翻转滑块/灰显/徽章，
    // 再 POST /toggle；API 返回失败则回滚到请求前状态 + 红 toast。
    // 解决用户实测"点停用看不到任何变化"的问题：点击即有视觉反馈。
    function toggleSkill(dir, disable) {
      if (S.toggling) return;
      S.toggling = true;
      var sk = (S.data && S.data.skills) || [];
      var prev = null;
      for (var i = 0; i < sk.length; i++) {
        if (sk[i].dir === dir) { prev = !!sk[i].disabled; sk[i].disabled = !!disable; break; }
      }
      paintSortbar(); paintCards();   // 乐观重绘：滑块位置/颜色、卡片灰显、徽章立即变化
      fetch(apiBase() + "/toggle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dir: dir, disable: disable })
      })
        .then(function (r) { return r.json().catch(function () { throw new Error("HTTP " + r.status); }); })
        .then(function (d) {
          S.toggling = false;
          if (d && d.ok) {
            ctxLogger("toggle " + dir + " -> " + (disable ? "disabled" : "enabled") + (d.backup ? " (backup ok)" : ""));
            showToast("ok", disable ? TF("toastDisabled", { name: dir }) : TF("toastEnabled", { name: dir }));
          } else {
            rollbackToggle(dir, prev, (d && d.error) || "unknown");
          }
          paintSortbar(); paintCards(); paintHeader();   // v1.7.2: paintHeader 同步副标题"已停用"计数
        })
        .catch(function (e) {
          S.toggling = false;
          rollbackToggle(dir, prev, (e && e.message ? e.message : e));
          paintSortbar(); paintCards(); paintHeader();
        });
    }
    // v1.7.1：toggle 失败回滚到请求前状态 + 红 toast（prevState 为请求前的 disabled 值）
    function rollbackToggle(dir, prevState, err) {
      var sk2 = (S.data && S.data.skills) || [];
      for (var i = 0; i < sk2.length; i++) {
        if (sk2[i].dir === dir) {
          if (prevState != null) sk2[i].disabled = prevState;
          break;
        }
      }
      showToast("err", TF("toastToggleFail", { err: err }));
      try { console.warn("[dsh-skill-browser] toggle " + dir + " failed: " + err); } catch (e) {}
    }

    // v1.7.0：分类级全启用/全停用 → POST /toggle-batch
    // v1.7.1：进行中显示"处理中…"（防重入）；完成后 toast 汇报"已停用/已启用 N 项"
    //   （N=成功数），部分失败改报"成功 X 项，失败 Y 项"。
    // v1.7.2：升级为三级滑块统一批量执行入口 batchToggle(scope, disable)——
    //   scope="global" → body={dirs:[全量技能目录]}（不用 category，直接传全量最稳）；
    //   scope=<cat-id> → body={category:"<cat-id>"}；
    //   确认交互已上移到面板内确认菜单（openBatchMenu，替代 window.confirm），
    //   本函数只负责执行与三层联动刷新：①按 results 回写内存 disabled 字段；
    //   ②patchCardsDisabled 局部刷新受影响卡片（不整列 innerHTML 重建，防闪烁）；
    //   ③paintSortbar 重算全局+分类聚合滑块与"停用 x/y"小字；④paintHeader 刷副标题。
    function batchToggle(scope, disable) {
      if (S.toggling) return;
      var isGlobal = scope === "global";
      var sk = (S.data && S.data.skills) || [];
      var dirs = [];
      for (var i = 0; i < sk.length; i++) {
        if (isGlobal || sk[i].cat === scope) dirs.push(sk[i].dir);
      }
      if (!dirs.length) return;
      S.toggling = true;
      paintSortbar();   // 聚合滑块进入"处理中…"半透明态（aria-disabled 防重入）
      var body = isGlobal ? { dirs: dirs, disable: disable } : { category: scope, disable: disable };
      fetch(apiBase() + "/toggle-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json().catch(function () { throw new Error("HTTP " + r.status); }); })
        .then(function (d) {
          S.toggling = false;
          if (d && d.ok) {
            var byDir = {};
            var changed = {};
            var res = d.results || [];
            for (var i2 = 0; i2 < res.length; i2++) {
              byDir[res[i2].dir] = res[i2];
              if (res[i2].ok) changed[res[i2].dir] = !!disable;
            }
            for (var j = 0; j < sk.length; j++) {
              var r2 = byDir[sk[j].dir];
              if (r2 && r2.ok) sk[j].disabled = !!disable;
            }
            patchCardsDisabled(changed);   // ③卡片局部更新
            paintHeader();                 // ④副标题"已停用"计数
            var okN = d.okCount || 0, fails = d.failCount || 0;
            if (fails) {
              showToast(fails >= okN ? "err" : "ok", TF("toastBatchPartial", { x: okN, y: fails }));
            } else {
              showToast("ok", TF(disable ? "toastBatchDisabled" : "toastBatchEnabled", { n: okN }));
            }
            ctxLogger("batch " + (isGlobal ? "global" : scope) + ": ok=" + okN + " fail=" + fails);
          } else {
            showToast("err", TF("toastToggleFail", { err: (d && d.error) || "unknown" }));
            try { console.warn("[dsh-skill-browser] batch failed: " + ((d && d.error) || "unknown")); } catch (e) {}
          }
          paintSortbar();   // ①②聚合滑块 + "停用 x/y" 小字重算刷新
        })
        .catch(function (e) {
          S.toggling = false;
          showToast("err", TF("toastToggleFail", { err: (e && e.message ? e.message : e) }));
          paintSortbar();
          try { console.warn("[dsh-skill-browser] batch error: " + (e && e.message ? e.message : e)); } catch (e2) {}
        });
    }

    // v1.7.2：打开批量确认菜单（面板内浮层，锚定在所点聚合滑块下方，越界上翻）。
    // scope："global" 或分类 id；N=当前作用域内技能总数；
    // 全局停用选项带醒目危险提示"将停用全部 N 项技能，新会话将不可用这些技能"。
    function openBatchMenu(anchor, scope) {
      if (S.toggling) return;
      var menu = $("dsb-bmenu"), mask = $("dsb-bmenu-mask"), panel = $(PANEL_ID);
      if (!menu || !mask || !panel || !anchor) return;
      var isGlobal = scope === "global";
      var a = aggCount((S.data && S.data.skills) || [], isGlobal ? null : scope);
      var n = a.total;
      var scopeName = isGlobal ? T("aggAllLabel") : catLabel(scope);
      var enSub = isGlobal ? "" : T("batchConfirmEnable");
      var disSub = isGlobal ? TF("aggDangerText", { n: n }) : T("batchConfirmDisable");
      menu.innerHTML =
        '<div class="dsb-bmenu-title">' + esc(isGlobal ? T("aggMenuTitleGlobal") : T("aggMenuTitleCat")) + '<br/>' +
        esc(TF("aggMenuStat", { scope: scopeName, n: n, x: a.off })) + '</div>' +
        '<button class="dsb-bmenu-item" data-bmenu-act="enable"><span>' + esc(TF("aggEnableN", { n: n })) + '</span>' +
        (enSub ? '<span class="dsb-bmenu-sub">' + esc(enSub) + '</span>' : "") + '</button>' +
        '<button class="dsb-bmenu-item dsb-bmenu-danger" data-bmenu-act="disable"><span>' + esc(TF("aggDisableN", { n: n })) + '</span>' +
        '<span class="dsb-bmenu-sub">⚠ ' + esc(disSub) + '</span></button>' +
        '<button class="dsb-bmenu-cancel" data-bmenu-act="cancel">' + esc(T("aggCancelText")) + '</button>';
      mask.style.display = "block";
      menu.style.display = "flex";
      S.batchMenuScope = scope;
      // 锚定：滑块下方 6px；右缘/下缘越界时向左/向上收进面板
      var ar = anchor.getBoundingClientRect();
      var pr = panel.getBoundingClientRect();
      var left = ar.left - pr.left;
      var top = ar.bottom - pr.top + 6;
      var mw = menu.offsetWidth, mh = menu.offsetHeight;
      var pw = panel.clientWidth, ph = panel.clientHeight;
      if (left + mw > pw - 8) left = Math.max(8, pw - mw - 8);
      if (top + mh > ph - 8) top = Math.max(8, ar.top - pr.top - mh - 6);
      menu.style.left = left + "px";
      menu.style.top = top + "px";
    }
    function closeBatchMenu() {
      S.batchMenuScope = null;
      var menu = $("dsb-bmenu"), mask = $("dsb-bmenu-mask");
      if (menu) menu.style.display = "none";
      if (mask) mask.style.display = "none";
    }

    // v1.7.2：批量启停成功后的卡片局部更新——只改受影响卡片的类名/开关/徽章/
    // title，不重建 #dsb-cards 的 innerHTML（避免全列表闪烁）。DOM 里找不到的
    // 目录（被搜索/分类过滤掉的卡片）直接跳过，下次全量 paintCards 自然对齐。
    function patchCardsDisabled(map) {
      var box = $("dsb-cards"); if (!box) return;
      var cards = box.querySelectorAll('.dsb-card[data-dir]');
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i];
        var dir = card.getAttribute("data-dir");
        if (!Object.prototype.hasOwnProperty.call(map, dir)) continue;
        var off = !!map[dir];
        card.classList.toggle("dsb-card-off", off);
        card.title = off ? T("cardDisabledTitle") : "点击查看 SKILL.md 全文";
        var sw = card.querySelector(".dsb-switch");
        if (sw) {
          sw.classList.toggle("dsb-sw-on", !off);
          sw.setAttribute("data-to", off ? "0" : "1");
          sw.title = off ? T("toggleEnableTip") : T("toggleDisableTip");
          var lbl = sw.querySelector(".dsb-sw-label");
          if (lbl) lbl.textContent = off ? T("switchOffText") : T("switchOnText");
        }
        var nameEl = card.querySelector(".dsb-card-name");
        if (nameEl) {
          var badge = nameEl.querySelector(".dsb-badge-off");
          if (off && !badge) {
            var b = document.createElement("span");
            b.className = "dsb-badge-off";
            b.textContent = T("disabledBadge");
            nameEl.appendChild(b);
          } else if (!off && badge && badge.parentNode) {
            badge.parentNode.removeChild(badge);
          }
        }
      }
    }
    function ctxLogger(msg) {
      try { console.log("[dsh-skill-browser] " + msg); } catch (e) {}
    }
    function paintCards() {
      var box = $("dsb-cards"); if (!box) return;
      if (S.error && !S.data) {
        box.innerHTML = '<div class="dsb-empty">' + esc(S.error) + '<br/><br/><button class="dsb-btn" id="dsb-retry">重试</button></div>';
        var r = $("dsb-retry");
        if (r) r.addEventListener("click", function () { load(true); });
        return;
      }
      if (!S.data) { box.innerHTML = '<div class="dsb-empty">加载中…</div>'; return; }
      var list = filtered();
      // v1.7.1 四态排序：名称↑（默认）/名称↓/时间↓（最新在前）/时间↑（最旧在前）
      list = sortList(list);
      if (!list.length) { box.innerHTML = '<div class="dsb-empty">没有匹配的技能</div>'; return; }
      var html = "";
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var tag = s.sub ? esc(subLabel(s.cat, s.sub)) : esc(catLabel(s.cat));
        var brief = s.zh || (s.desc ? String(s.desc).slice(0, 90) + (s.desc.length > 90 ? "…" : "") : "（无描述）");
        var off = !!s.disabled;
        var mt = fmtTime(s.mtime);
        // v1.7.1 滑动开关：.dsb-sw-on=开启（绿轨+滑块右），无=停用（灰轨+滑块左）。
        // 状态唯一来源是 s.disabled；title 提示点击后的动作方向（off→点击启用）。
        html += '<div class="dsb-card' + (off ? " dsb-card-off" : "") + '" data-dir="' + esc(s.dir) + '" title="' + esc(off ? T("cardDisabledTitle") : "点击查看 SKILL.md 全文") + '">' +
          '<div class="dsb-card-name">' + esc(s.dir) + (off ? '<span class="dsb-badge-off">' + esc(T("disabledBadge")) + '</span>' : "") + "</div>" +
          '<div class="dsb-card-zh">' + esc(brief) + "</div>" +
          '<div class="dsb-card-tag">' + tag + "</div>" +
          (mt ? '<div class="dsb-card-mtime">' + esc(T("mtimeLabel")) + " " + esc(mt) + "</div>" : "") +
          '<div style="margin-top:6px">' +
            '<label class="dsb-switch' + (off ? "" : " dsb-sw-on") + '" data-tgl="' + esc(s.dir) + '" data-to="' + (off ? "0" : "1") +
              '" title="' + esc(off ? T("toggleEnableTip") : T("toggleDisableTip")) + '"' + (S.toggling ? ' aria-disabled="true"' : "") + '>' +
              '<span class="dsb-sw-track"><span class="dsb-sw-thumb"></span></span>' +
              '<span class="dsb-sw-label">' + esc(off ? T("switchOffText") : T("switchOnText")) + "</span>" +
            "</label>" +
          "</div>" +
          "</div>";
      }
      // ── v1.7.3/v1.7.4 用户指令：广告卡从技能清单彻底移除 ──
      // 技能列表/分类末尾恢复为纯技能卡列表（原 v1.7.2 追加在列表尾部的
      // 3 张推荐卡——🖼️照片显示器/🔤字体插件/💡悬浮球说明——已整体迁往
      // 设置面板 #dsb-settings 广告区，见 buildPanel 内注释）。
      box.innerHTML = html;
    }

    function ledgerLevel(fails) {
      if (fails >= 4) return { cls: "dsb-lv-high", label: "高" };
      if (fails >= 2) return { cls: "dsb-lv-mid", label: "中" };
      return { cls: "dsb-lv-low", label: "低" };
    }

    function paintLedger() {
      var sum = $("dsb-ledger-sum"), tbl = $("dsb-ledger-table");
      if (!sum || !tbl) return;
      if (S.loading && !S.ledger) { sum.innerHTML = '<div class="dsb-empty">台账加载中…</div>'; tbl.innerHTML = ""; return; }
      if (S.error && !S.ledger) { sum.innerHTML = '<div class="dsb-empty">' + esc(S.error) + '</div>'; tbl.innerHTML = ""; return; }
      if (!S.ledger) return;
      var l = S.ledger;
      var totalSkills = (S.data && S.data.total) || 0;
      var autoRecent = l.autoRecent || [];
      var autoFails = autoRecent.filter(function (x) { return !x.ok; }).length;
      var autoTotal = l.autoTotal || 0;
      var autoFailTotal = l.autoFailTotal || 0;
      sum.innerHTML =
        '<div class="dsb-lsum-card"><b>' + totalSkills + '</b><span>技能总数</span></div>' +
        '<div class="dsb-lsum-card dsb-lsum-fail"><b>' + l.totalFailSkills + '</b><span>人工·失败技能</span></div>' +
        '<div class="dsb-lsum-card dsb-lsum-fail"><b>' + l.totalFails + '</b><span>人工·累计失败</span></div>' +
        '<div class="dsb-lsum-card"><b>' + autoTotal + '</b><span>自动·调用总数</span></div>' +
        (autoFailTotal ? '<div class="dsb-lsum-card dsb-lsum-fail"><b>' + autoFailTotal + '</b><span>自动·失败</span></div>' : '');
      var rows = (l.entries || []).filter(function (e) { return e.fails > 0; });
      var html = '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin:2px 0 6px">' +
        '<span>👤 人工台账</span>' +
        '<span style="font-weight:400;font-size:11px;color:#9aa1b5">技能生效-失效台账.md 统计表（人工维护 + 历史登记）</span>' +
        '</div>' +
        '<div class="dsb-ltable">' +
        '<div class="dsb-lrow dsb-lhead"><span class="dsb-lc-rank">#</span><span class="dsb-lc-skill">技能名</span><span class="dsb-lc-fail">失败</span><span class="dsb-lc-rate">等级</span><span class="dsb-lc-date">最近失败</span><span class="dsb-lc-status">强化状态</span></div>';
      if (!rows.length) {
        html += '<div class="dsb-lrow"><span class="dsb-lc-skill" style="opacity:.7;line-height:1.8">暂无人工登记。<br/>💡 技能触发失败时，在对话里说「<b>触发失败，登记</b>」或「<b>登记失败：技能名 原因</b>」，AI 会自动写入台账；<br/>插件也会自动记录每次技能调用（见下方 🤖 自动登记）。</span></div>';
      }
      for (var i = 0; i < rows.length; i++) {
        var e = rows[i];
        var lv = ledgerLevel(e.fails);
        var status = e.status || "";
        var statusCls = /待强化|⚠/.test(status) ? "dsb-lst-warn" : /已强化/.test(status) ? "dsb-lst-done" : "dsb-lst-ok";
        html += '<div class="dsb-lrow" data-lskill="' + esc(e.skill) + '" title="点击查看失败明细">' +
          '<span class="dsb-lc-rank">' + esc(e.rank || "—") + '</span>' +
          '<span class="dsb-lc-skill">' + esc(e.skill) + '</span>' +
          '<span class="dsb-lc-fail">' + e.fails + '</span>' +
          '<span class="dsb-lc-rate"><span class="' + lv.cls + '">' + lv.label + '</span></span>' +
          '<span class="dsb-lc-date">' + esc(e.lastDate || "—") + '</span>' +
          '<span class="dsb-lc-status ' + statusCls + '">' + esc(status) + '</span>' +
          '</div>';
      }
      html += '</div>';
      // 自动登记流水（与人工台账分开的独立区块，最新在上）
      var auto = l.autoRecent || [];
      html += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;margin:14px 0 6px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)">' +
        '<span>🤖 自动登记</span>' +
        '<span style="font-weight:400;font-size:11px;color:#9aa1b5">dsh-skill-browser 插件监听 skill 工具调用结果自动记录 · 近 ' + auto.length + ' 条，最新在前</span>' +
        '</div>';
      if (!auto.length) {
        html += '<div class="dsb-empty" style="padding:14px 0">暂无自动记录 — 插件会记录每次技能工具调用结果（成功✅ / 失败❌）</div>';
      } else {
        html += '<div class="dsb-ltable">';
        for (var a = 0; a < auto.length; a++) {
          var x = auto[a];
          var mark = x.ok ? "✅" : "❌";
          var cls = x.ok ? "dsb-lst-done" : "dsb-lst-warn";
          var note = x.note || x.error || "";
          html += '<div class="dsb-lrow" style="font-size:11.5px' + (x.ok ? ';opacity:.62' : '') + '"' + (x.ok ? '' : ' data-lskill="' + esc(x.skill) + '" title="点击查看失败详情"') + '>' +
            '<span class="dsb-lc-date" style="width:110px;flex:none">' + esc(String(x.ts || "").replace("T", " ").slice(5, 16)) + '</span>' +
            '<span class="' + cls + '" style="width:22px;flex:none;text-align:center">' + mark + '</span>' +
            '<span class="dsb-lc-skill" style="flex:1">' + esc(x.skill) + '</span>' +
            '<span style="width:64px;flex:none;color:#8b93a8;font-size:10.5px">' + esc(x.kind === "manual-report" ? "人工上报" : "工具结果") + '</span>' +
            '<span style="flex:2;color:#9aa1b5;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.kind || "") + (note ? " — " + esc(note.slice(0, 80)) : "") + '</span>' +
            '</div>';
        }
        html += '</div>';
      }
      tbl.innerHTML = html;
    }

    function paintDetail() {
      var d = $("dsb-detail"); if (!d) return;
      var isLedgerDetail = S.view === "ledger" && S.ledgerDetail;
      if (S.detail || isLedgerDetail) {
        d.style.display = "flex";
        var t = $("dsb-detail-title");
        if (t) {
          if (isLedgerDetail) t.textContent = "📋 " + S.ledgerDetail.skill + " — 失败明细";
          else t.textContent = "📄 " + S.detail.dir + " / SKILL.md";
        }
        var b = $("dsb-detail-body");
        if (b && !b.textContent) b.textContent = "加载中…";
      } else {
        d.style.display = "none";
      }
    }

    function syncSettingsUI() {
      var ballCb = $("dsb-set-ball"), fontCb = $("dsb-set-font");
      if (ballCb) ballCb.checked = readStore(BALL_VIS_KEY, true);
      if (fontCb) fontCb.checked = readStore(FONT_BALL_VIS_KEY, true);
    }

    // ---- 球体样式 + 字体球统一样式 + 显隐规则（纯 CSS，永久生效）----
    var CSS = [
      /* 技能球 */
      '#' + BALL_ID + '{position:fixed;right:74px;bottom:18px;width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 50% 60%, rgba(255,255,255,.98) 0%, rgba(214,232,247,.9) 9%, rgba(111,158,232,.7) 18%, rgba(165,46,255,.5) 32%, rgba(206,44,203,.35) 46%, rgba(10,14,30,.9) 66%, rgba(4,6,14,.99) 100%);box-shadow:0 0 22px rgba(111,158,232,.45),0 0 4px rgba(206,44,203,.3),0 4px 18px rgba(0,0,0,.55),inset 0 1px 3px rgba(255,255,255,.4),inset 0 -8px 16px rgba(206,44,203,.14),inset 0 0 14px rgba(80,120,255,.2);color:#ffffff;font-size:15px;font-weight:800;display:flex;align-items:center;justify-content:center;text-shadow:0 0 4px rgba(255,255,255,.95),0 0 10px rgba(160,200,255,.9),0 0 20px rgba(120,90,255,.7),0 2px 4px rgba(10,20,60,.8);filter:drop-shadow(0 0 6px rgba(180,210,255,.8));animation:dsbGlow 2.4s ease-in-out infinite;cursor:grab;z-index:2147481000;user-select:none;touch-action:none;animation:orbBreathe 3.2s ease-in-out infinite;}',
      '#' + BALL_ID + ':hover{transform:scale(1.08)}',
      '#' + BALL_ID + '::before{content:"";position:absolute;inset:1px;border-radius:50%;z-index:1;background:radial-gradient(ellipse 85% 26% at 50% 60%, rgba(255,255,255,1) 0%, rgba(235,245,255,.85) 18%, rgba(160,200,255,.5) 38%, rgba(190,120,255,.35) 55%, transparent 75%),radial-gradient(ellipse 70% 18% at 45% 42%, rgba(111,158,232,.55) 0%, transparent 70%),radial-gradient(ellipse 70% 18% at 55% 74%, rgba(206,44,203,.4) 0%, transparent 70%);filter:blur(1px);animation:bandFlow 4.5s ease-in-out infinite;}',
      '#' + BALL_ID + '::after{content:"";position:absolute;inset:-1px;border-radius:50%;z-index:1;background:conic-gradient(from 200deg, rgba(255,255,255,.55), rgba(140,180,255,.35), rgba(206,44,203,.4), rgba(255,255,255,.15), rgba(111,158,232,.4), rgba(255,255,255,.55));-webkit-mask:radial-gradient(circle, transparent 63%, #000 66%, #000 72%, transparent 76%);mask:radial-gradient(circle, transparent 63%, #000 66%, #000 72%, transparent 76%);animation:rimSpin 7s linear infinite;filter:blur(.5px);}',
      '@keyframes bandFlow{0%,100%{transform:translateY(-3px) scaleY(.94);opacity:.8}50%{transform:translateY(3px) scaleY(1.12);opacity:1}}',
      '@keyframes rimSpin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}',
      '@keyframes orbBreathe{0%,100%{transform:scale(.96);filter:brightness(.92)}50%{transform:scale(1.05);filter:brightness(1.12)}}',
      '@keyframes dsbGlow{0%,100%{text-shadow:0 0 4px rgba(255,255,255,.95),0 0 10px rgba(160,200,255,.9),0 0 20px rgba(120,90,255,.7)}50%{text-shadow:0 0 6px rgba(255,255,255,1),0 0 16px rgba(190,220,255,1),0 0 32px rgba(140,110,255,.9)}}',
      '#' + BALL_ID + ':hover{transform:scale(1.08)}',
      '#' + BALL_ID + ' .dsb-orb-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:17px;color:#9aa1b5;z-index:1}',
      '#' + BALL_ID + ':hover{transform:scale(1.08)}',
      '#' + BALL_ID + '.dsb-ghost{width:12px!important;height:12px!important;font-size:0!important;right:10px!important;bottom:10px!important;opacity:.3}',
      '#' + BALL_ID + '.dsb-ghost:hover{opacity:.8}',
      /* 字体球视觉：v1.5.9 起 font-enhancer 自带暖色极光玻璃样式，本插件不再代管其外观（避免覆盖）；显隐控制见下方 data-dsb-font-hidden 规则 */
      /* 显隐开关：取消勾选=彻底隐藏球（display:none），勾选=显示原版 46px 大球 */
      '[data-dsb-ball-hidden="1"] #' + BALL_ID + '{display:none!important}',
      '[data-dsb-font-hidden="1"] #dsh-fe-toggle{display:none!important}'
    ].join('\n');

    function restoreBallPos(ball) {
      try {
        var raw = localStorage.getItem(BALL_POS_KEY);
        if (!raw) return;
        var p = JSON.parse(raw);
        if (typeof p.left === "number" && typeof p.top === "number") {
          ball.style.left = p.left + "px";
          ball.style.top = p.top + "px";
          ball.style.right = "auto";
          ball.style.bottom = "auto";
        }
      } catch (e) {}
    }
    function saveBallPos(ball) {
      try {
        localStorage.setItem(BALL_POS_KEY, JSON.stringify({ left: ball.offsetLeft, top: ball.offsetTop }));
      } catch (e) {}
    }

    // v1.5.6 字体插件安装探测：dsh-fe-toggle 元素存在 = font-enhancer client 已运行。
    // 元素存在不依赖球显隐（隐藏是 CSS display，DOM 仍在）；卸载/禁用后元素消失。
    function isFontEnhancerInstalled() {
      try { return !!document.getElementById("dsh-fe-toggle"); } catch (e) { return false; }
    }
    // Todo 球安装探测（兼容）：dsh-todo-float-ball 未装时隐藏其开关，避免无效控件
    function isTodoBallInstalled() {
      try { return !!document.getElementById("dsh-tfb-root"); } catch (e) { return false; }
    }

    // v1.5.3 一键恢复默认位置：清位置记忆与收起/隐藏状态，球立即回右下角默认位。
    // 供 DSH 设置页「悬浮球导航」分区按钮调用（球可能被拖出屏幕外卡住，无法点回）。
    // v1.5.7 推荐位安装徽标：探测三个插件的 client 运行状态，注入「已安装/未安装」徽标。
    function recBadgeInstalled(id) {
      if (id === "font") return !!document.getElementById("dsh-fe-toggle");
      if (id === "todoball") return isTodoBallInstalled();
      if (id === "skillbrowser") return !!document.getElementById(BALL_ID);
      return false; // lightbox 用异步 fetch 判定，不走这里
    }
    function markRecBadge(recId, installed) {
      var row = document.querySelector('[data-rec-id="' + recId + '"]');
      if (!row || row.querySelector(".fe-rec-badge")) return;
      var badge = document.createElement("span");
      badge.className = "fe-rec-badge";
      badge.textContent = installed ? "已安装" : "未安装";
      badge.style.cssText = "flex-shrink:0;margin-left:8px;font-size:11px;padding:2px 8px;border-radius:6px;" +
        (installed ? "background:rgba(120,220,150,.15);border:1px solid rgba(120,220,150,.4);color:#9fe0b5"
                   : "background:rgba(255,120,120,.15);border:1px solid rgba(255,120,120,.35);color:#ffb3b3") +
        ";white-space:nowrap";
      var star = row.querySelector("a");
      if (star) row.insertBefore(badge, star); else row.appendChild(badge);
    }
    function applyRecBadges() {
      ["font", "skillbrowser", "lightbox"].forEach(function (id) {
        if (id === "lightbox") {
          try {
            fetch("/api/image-gallery/list").then(function (r) {
              markRecBadge("lightbox", r.ok);
            }).catch(function () { markRecBadge("lightbox", false); });
          } catch (e) { markRecBadge("lightbox", false); }
        } else {
          markRecBadge(id, recBadgeInstalled(id));
        }
      });
    }
    function resetBallToDefault() {
      try { localStorage.removeItem(BALL_POS_KEY); } catch (e) {}
      try { writeStore(BALL_VIS_KEY, true); } catch (e) {}
      try { writeStore(GHOST_KEY, false); } catch (e) {}
      var b = $(BALL_ID);
      if (b) {
        b.style.left = ""; b.style.top = "";
        b.style.right = "74px"; b.style.bottom = "18px";
        b.classList.remove("dsb-ghost");
      }
      try { applyBallVisibility(); } catch (e) {}
      // v1.5.6 双球联动（仅字体插件已安装时挂载）：🎯 复位时顺带把字体球归位
      // （右下角 right:18px bottom:18px）。跨插件组合：只清位置记忆 + DOM 归位。
      if (isFontEnhancerInstalled()) try {
        var FE_POS_KEY = "dsh-font-enhancer";
        var raw = localStorage.getItem(FE_POS_KEY);
        if (raw) {
          var data = JSON.parse(raw);
          data.bx = null; data.by = null;
          localStorage.setItem(FE_POS_KEY, JSON.stringify(data));
        }
      } catch (e) {}
      try {
        var feBall = document.getElementById("dsh-fe-toggle");
        if (feBall) {
          feBall.style.left = "auto"; feBall.style.top = "auto";
          feBall.style.right = "18px"; feBall.style.bottom = "18px";
        }
      } catch (e) {}
      // v0.7.2 三球联动：🎯 复位时顺带把 Todo 球归位（右下角 right:18px bottom:18px）。
      // 同字体球模式：只清位置记忆 + DOM 归位，不动 todo 插件内部实现。
      try { localStorage.removeItem("dsh-todo-float-ball-pos"); } catch (e) {}
      try {
        var tfbHost = document.getElementById("dsh-tfb-root");
        var tfb = tfbHost && tfbHost.shadowRoot ? tfbHost.shadowRoot.querySelector(".tfb-ball") : null;
        if (tfb) {
          tfb.style.left = "auto"; tfb.style.top = "auto";
          tfb.style.right = "18px"; tfb.style.bottom = "18px";
        }
      } catch (e) {}
      try { console.log("[dsh-skill-browser] reset: skill ball + font ball + todo ball -> default positions (paired bottom-right)"); } catch (e) {}
    }

    function buildBall() {
      if ($(BALL_ID)) return;
      var style = document.createElement("style");
      style.id = "dsb-ball-style";
      style.textContent = CSS;
      document.head.appendChild(style);

      var ball = document.createElement("div");
      ball.id = BALL_ID;
      ball.title = "技能插件（点击开关面板，可拖动，Alt+点击 收起成小圆点）";
      ball.textContent = "技";

      var drag = { active: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
      ball.addEventListener("pointerdown", function (e) {
        drag.active = true; drag.moved = false;
        drag.sx = e.clientX; drag.sy = e.clientY;
        var r = ball.getBoundingClientRect();
        drag.ox = r.left; drag.oy = r.top;
        ball.style.transition = "none";
        try { ball.setPointerCapture(e.pointerId); } catch (e2) {}
      });
      ball.addEventListener("pointermove", function (e) {
        if (!drag.active) return;
        var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
        ball.style.left = (drag.ox + dx) + "px";
        ball.style.top = (drag.oy + dy) + "px";
        ball.style.right = "auto";
        ball.style.bottom = "auto";
      });
      function endDrag() {
        if (!drag.active) return;
        drag.active = false;
        ball.style.transition = "";
        if (drag.moved) saveBallPos(ball);
      }
      ball.addEventListener("pointerup", endDrag);
      ball.addEventListener("pointercancel", endDrag);

      ball.addEventListener("click", function (ev) {
        if (drag.moved) { drag.moved = false; return; }
        if (ev.altKey) {
          var ghost = !isGhost();
          writeStore(GHOST_KEY, ghost);
          if (ghost) closePanel();
          paintGhost();
          return;
        }
        if (S.open) closePanel();
        else openPanel();
      });
      mountEl().appendChild(ball);
      restoreBallPos(ball);
      paintGhost();
      applyBallVisibility();
    }

    function paintGhost() {
      var b = $(BALL_ID);
      if (!b) return;
      if (isGhost()) b.classList.add("dsb-ghost");
      else b.classList.remove("dsb-ghost");
    }

    // ---- DSH 设置界面：settings.section 区块（纯函数组件）----
    // DIAG 版：组件被调用时上报 React 状态到宿主 /diag，用于定位内容为空原因。
    function diagReport(info) {
      try {
        fetch(apiBase() + "/diag", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(info)
        }).catch(function () {});
      } catch (e) {}
    }

    function SettingsSection(props) {
      // 组件渲染即上报：React 可用性 + props 键
      try {
        diagReport({
          view: "settings-section-render",
          reactType: typeof React,
          reactKeys: React ? Object.keys(React).slice(0, 12) : [],
          propsKeys: props ? Object.keys(props) : []
        });
      } catch (e) {}

      // 若 React 不可用则返回 null（内容空，但至少诊断日志能告诉我们原因）
      if (!React) return null;

      var rows = [];
      // 未安装的球：开关仍显示但置灰+标注，保证"单独装任何一个，分区界面一致"（生态规格）
      function mkToggle(id, label, onChange, installed) {
        var on = installed !== false;
        return React.createElement("label", { key: id, style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: on ? "pointer" : "not-allowed", opacity: on ? 1 : .5 } },
          React.createElement("input", { type: "checkbox", id: id, disabled: !on, onChange: onChange }),
          React.createElement("span", null, label + (on ? "" : "（未安装）")));
      }
      rows.push(React.createElement("div", { key: "head", style: { fontWeight: "600", marginBottom: "4px" } }, "悬浮球导航"));
      rows.push(mkToggle("dsb-set-ball", "技能浏览器悬浮球（🧩）", function (e) {
        writeStore(BALL_VIS_KEY, e.target.checked);
        applyBallVisibility();
        if (!e.target.checked && S.open) closePanel();
      }, true));
      rows.push(mkToggle("dsb-set-font", "字体插件悬浮球（🔤）", function (e) {
        writeStore(FONT_BALL_VIS_KEY, e.target.checked);
        applyFontBallVisibility();
      }, isFontEnhancerInstalled()));
      rows.push(mkToggle("dsb-set-todo", "Todo 悬浮球（📋）", function (e) {
        writeStore(TODO_BALL_VIS_KEY, e.target.checked);
        if (typeof applyTodoBallVisibility === "function") applyTodoBallVisibility();
        var el = document.getElementById("dsh-tfb-root");
        if (el) el.style.setProperty("display", e.target.checked ? "" : "none", "important");
      }, isTodoBallInstalled()));
      rows.push(React.createElement("div", { key: "hint", style: { fontSize: "12px", color: "#8b93a8" } },
        "悬浮球可拖动；清单面板始终居中；本分区就在 DSH 设置中，随时可改悬浮球显隐"));
      // ── 安装与更新须知（v1.5.7：24h 供应链政策 + 推荐清单说明）──
      rows.push(React.createElement("div", { key: "notice-block", style: { marginTop: "12px", padding: "10px 12px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: "10px", fontSize: "12px", color: "#9aa1b5", lineHeight: "1.7" } },
        React.createElement("div", { style: { fontWeight: "600", color: "#cfd4dc", marginBottom: "4px" } }, "📌 安装与更新须知"),
        React.createElement("div", null, "1. 本分区由「技能浏览器」提供；技能球 / 字体球 / Todo 球三个悬浮球的显隐都在这里控制（新装默认全部显示）。"),
        React.createElement("div", null, "2. 推荐插件列表实时显示「已安装 / 未安装」状态：绿色「已安装」= 可直接使用；红色「未安装」= 点击 ⭐ Star 前往仓库，或到插件市场搜索安装。"),
        React.createElement("div", { style: { color: "#e0b0b0" } }, "3. 【重要】安装或更新插件时，若报错含 minimumReleaseAge 或 ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION：这不是插件坏了，是 DSH 对刚发布 npm 包的 24 小时安全观察期（防止刚发布的投毒包）。"),
        React.createElement("div", { style: { color: "#e0b0b0" } }, "4. 遇到 24h 报错的处理：等一天再安装/更新即可自动通过，插件本体没有任何问题。插件作者连发多版时窗口期会顺延一天。"),
        React.createElement("div", null, "5. 悬浮球可拖动换位置；拖到屏幕外找不到时，点 🎯 按钮所有悬浮球一起回到右下角。Todo 球的皮肤在展开其面板后点 🎨 切换（星云/石墨/蓝宝石）。")
      ));
      // ── 一键恢复默认位置（v1.5.3 用户要求）：悬浮球被拖出屏幕外卡住时，
      // 点此按钮立即回到默认右下角 (right:26px bottom:118px) 46px 常规大小，
      // 并顺带恢复显示、解除收起小圆点状态。无需重启。──
      rows.push(React.createElement("button", { key: "reset-pos",
        onClick: function () { try { resetBallToDefault(); } catch (e) {} },
        style: { alignSelf: "flex-start", fontSize: "13px", cursor: "pointer",
          background: "rgba(255,210,122,.12)", border: "1px solid rgba(255,210,122,.35)",
          borderRadius: "6px", padding: "6px 12px", color: "#ffd27a" }
      }, "🎯 所有悬浮球回到右下角"));
      // ── 推荐插件（v1.5.7 统一三条清单：字体/技能/照片，探测式安装徽标）──
      rows.push(React.createElement("div", { key: "rec-head", style: { fontWeight: "600", marginTop: "12px", marginBottom: "4px", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: "10px" } }, "推荐插件"));
      function recRow(key, recId, icon, text, repo) {
        return React.createElement("div", { key: key, "data-rec-id": recId, style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", padding: "3px 0" } },
          React.createElement("span", null, icon + " " + text),
          React.createElement("a", { href: "https://github.com/" + repo, target: "_blank", rel: "noopener", style: { textDecoration: "none", fontSize: "12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "6px", padding: "2px 8px", color: "#ffd27a", cursor: "pointer", whiteSpace: "nowrap" } }, "⭐ Star"));
      }
      // ── 推荐插件（v1.5.7 统一清单：字体/技能/照片/Todo，探测式安装徽标）──
      // Todo 悬浮球皮肤切换（三皮肤）：事件委托到本分区容器——React 合成
      // 事件与 ref 均不可靠（slot 重渲染会重建 DOM），委托到容器上永不失效。
      // 点击写 localStorage + 直调 todo 插件的 __dshtfbApplyTheme 钩子。
      rows.push(recRow("rec-font", "font", "🔤", "字体插件 — 区域自定义字体/颜色/字号", "loyalchiiina/dsh-font-enhancer"));
      rows.push(recRow("rec-skillbrowser", "skillbrowser", "🧩", "技能浏览器 — 悬浮球面板浏览共享技能库 + 失效台账", "loyalchiiina/dsh-skill-browser"));
      rows.push(recRow("rec-lightbox", "lightbox", "🖼️", "照片显示器 — 聊天图片灯箱（放大/下载/浏览）", "loyalchiiina/dsh-chat-image-lightbox"));
      rows.push(recRow("rec-todoball", "todoball", "📋", "Todo 悬浮球 — todo_write 进度常驻监控 + 多会话固定 + 三皮肤（面板内 🎨 切换）", "loyalchiiina/dsh-todo-float-ball"));return React.createElement("div", { "data-dsb-slot": "1", style: { display: "flex", flexDirection: "column", gap: "8px", padding: "8px 0" } }, rows);
    }

    function registerSettings(ctx) {
      if (!ctx || !ctx.slots || !React) return false;
      // 直接调用（官方 dsh-im/archive-manager 均如此，不用 ctx.effect 包裹）
      try {
        ctx.slots.inject("settings.section", function () {
          return ctx.slots.register({
            name: "settings.section",
            id: "dsh-skill-browser",
            order: 22,
            label: function () { return "悬浮球导航"; },
            inject: function () { return {}; }
          }, SettingsSection);
        });
        return true;
      } catch (e) {
        try { console.warn("[dsh-skill-browser] settings registration failed", e); } catch (e2) {}
        return false;
      }
    }

    // React for the settings.section slot (dsh-im 同款，__ModuleLoader__ 提供 react)
    var React = null;
    try {
      var _react = require("react");
      React = (_react && _react.default) || _react;
    } catch (e) { React = null; }
    // 兜底：若 require 拿不到，从全局 window 上找（部分环境挂 window.React）
    if (!React) { try { React = window.React || null; } catch (e) {} }

    // ---- 旧状态迁移：v1.2.x 之前用户测试勾选可能在 localStorage 留下
    // "隐藏球"标记，导致球不显示且无法通过界面恢复。升级时强制重置一次。----
    function migrateOldState() {
      try {
        var ver = localStorage.getItem("dsh-skill-browser-cfg-ver");
        if (ver !== "4") {
          localStorage.setItem(BALL_VIS_KEY, "1");   // 球恢复显示
          localStorage.setItem(FONT_BALL_VIS_KEY, "1"); // 字体球恢复显示
          localStorage.removeItem(GHOST_KEY);
          // v3 复位（2026-09-05 用户要求"恢复原状"）：同时清除拖拽位置记忆与
          // 收起小圆点状态，让悬浮球回到默认右下角 (right:26px bottom:118px) 常规大小。
          localStorage.removeItem(BALL_POS_KEY);
          localStorage.setItem("dsh-skill-browser-cfg-ver", "4");
        }
      } catch (e) {}
    }

    // inject 必须导出为纯数组（同 archive-manager/dsh-im：cordis loader 读取
    // exports.inject 判定向 client ctx 注入哪些服务；函数形式曾被验证不生效）。
    // 目录选择走原生 <input type="file" webkitdirectory>，无需 remote seam。
    exports.inject = ["slots", "locale"];
    exports.apply = function (ctx) {
      // 设置分区每次 apply 都重新注册（DSH 热重载会释放 effect 导致分区消失，
      // 不设 mounted 守卫；重复注册由 slots 系统去重/替换）
      try { migrateOldState(); } catch (e) {}
      try { registerSettings(ctx); } catch (e) {}
      if (S.mounted) return;
      S.mounted = true;
      try { buildBall(); } catch (e) {
        try { console.warn("[dsh-skill-browser] mount failed", e); } catch (e2) {}
        return;
      }
      try {
        // 纯 CSS 显隐（html 属性驱动），无需轮询
        applyFontBallVisibility();
        applyBallVisibility();
      } catch (e) {}
      try { console.log("[dsh-skill-browser] client mounted (v1.7.2: 3-level aggregate switches + batch confirm menu)"); } catch (e3) {}
      setTimeout(applyRecBadges, 1200);
      setInterval(applyRecBadges, 5000);
    };

    return module.exports;
  }
});
