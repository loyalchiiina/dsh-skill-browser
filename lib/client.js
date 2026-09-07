window.__ModuleLoader__.load({
  id: "dsh-skill-browser",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;

    // v1.5.5（2026-09-06）：版本号对齐修复——host 端 index.js 的 VERSION
    //   常量此前停在 1.5.1 未随 package.json 同步，现统一为 1.5.5。
    // v1.5.4（2026-09-05 用户要求）：技能列表每页末尾追加的
    //   「💡 悬浮球显隐设置」提示卡一并移除——每页末尾不再出现任何
    //   非技能卡片，列表只展示技能本身。
    // v1.5.3（2026-09-05 用户要求）：
    //   ① DSH 设置页「悬浮球导航」新增「🎯 一键恢复悬浮球默认位置」按钮，
    //      防止悬浮球被拖出屏幕外卡住；点击立即回右下角默认位。
    //   ② 推荐插件位收敛为仅面板 ⚙ 设置展开区（技能库位置下方）一处；
    //      技能列表每页末尾与 DSH 设置页不再显示推荐广告（用户反馈心烦）。
    // v1.2.1 — 纯 DOM 实现，移除 React/slots 依赖（__ModuleLoader__ 环境
    // 下 require("react") 不可用，导致整个 client 模块加载失败）。
    // 设置页开关用 DOM 注入实现（你之前看到"位置对了"就靠这个）。

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
      detail: null
    };

    var BALL_ID = "dsh-skill-browser-ball";
    var PANEL_ID = "dsh-skill-browser-panel";
    var GHOST_KEY = "dsh-skill-browser-ghost";
    var BALL_POS_KEY = "dsh-skill-browser-ball-pos";
    var BALL_VIS_KEY = "dsh-skill-browser-ball-visible";
    var FONT_BALL_VIS_KEY = "dsh-font-ball-visible";

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
      '.dsb-lst-ok{color:#9aa1b5}';

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
          '<div style="padding-top:4px;border-top:1px dashed rgba(255,255,255,.08);margin-top:4px"></div>' +
          '<div class="dsb-set-rec">' +
            '<span>🖼️ 照片显示器 — 聊天图片灯箱（放大/下载/浏览）</span>' +
            '<a href="https://github.com/loyalchiiina/dsh-chat-image-lightbox" target="_blank" rel="noopener">⭐ Star</a>' +
          '</div>' +
          '<div class="dsb-set-rec">' +
            '<span>🔤 字体插件 — 区域自定义字体/颜色/字号</span>' +
            '<a href="https://github.com/loyalchiiina/dsh-font-enhancer" target="_blank" rel="noopener">⭐ Star</a>' +
          '</div>' +
        '</div>' +
        '<input id="dsb-q" class="dsb-q" type="text" placeholder="🔍 搜索技能名 / 中文简介 / 描述…" />' +
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
        paintChips(); paintSubs(); paintCards();
      });
      $("dsb-subs").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-sub]");
        if (!el) return;
        S.sub = el.getAttribute("data-sub");
        paintSubs(); paintCards();
      });
      $("dsb-cards").addEventListener("click", function (ev) {
        var ext = ev.target.closest("[data-ext-url]");
        if (ext) {
          try { window.open(ext.getAttribute("data-ext-url"), "_blank", "noopener"); } catch (e2) {}
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
      var q = $("dsb-q"), chips = $("dsb-chips"), subs = $("dsb-subs"), cards = $("dsb-cards"), lg = $("dsb-ledger");
      if (q) q.style.display = isLedger ? "none" : "";
      if (chips) chips.style.display = isLedger ? "none" : "";
      if (subs) subs.style.display = isLedger ? "none" : "";
      if (cards) cards.style.display = isLedger ? "none" : "";
      if (lg) lg.style.display = isLedger ? "block" : "none";
      var t1 = $("dsb-tab-skills"), t2 = $("dsb-tab-ledger");
      if (t1) t1.classList.toggle("dsb-tab-on", !isLedger);
      if (t2) t2.classList.toggle("dsb-tab-on", isLedger);
      paintHeader();
      if (isLedger) paintLedger();
      else { paintChips(); paintSubs(); paintCards(); }
      paintDetail();
    }

    function paintHeader() {
      var sub = $("dsb-subtitle");
      if (!sub) return;
      if (S.loading && !S.data) { sub.textContent = "扫描技能目录中…"; return; }
      if (S.error) { sub.innerHTML = '<span style="color:#ff8f8f">' + esc(S.error) + '</span>'; return; }
      if (!S.data) return;
      sub.textContent = "共 " + S.data.total + " 个技能 · " + (S.data.root || "?") +
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
      if (!list.length) { box.innerHTML = '<div class="dsb-empty">没有匹配的技能</div>'; return; }
      var html = "";
      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var tag = s.sub ? esc(subLabel(s.cat, s.sub)) : esc(catLabel(s.cat));
        var brief = s.zh || (s.desc ? String(s.desc).slice(0, 90) + (s.desc.length > 90 ? "…" : "") : "（无描述）");
        html += '<div class="dsb-card" data-dir="' + esc(s.dir) + '" title="点击查看 SKILL.md 全文">' +
          '<div class="dsb-card-name">' + esc(s.dir) + "</div>" +
          '<div class="dsb-card-zh">' + esc(brief) + "</div>" +
          '<div class="dsb-card-tag">' + tag + "</div>" +
          "</div>";
      }
      // v1.5.3（用户要求）：技能列表每页末尾不再追加推荐插件广告卡，
      // 推荐位只保留在面板 ⚙ 设置展开区（技能库位置下方）一处。
      // v1.5.4（用户要求）：「💡 悬浮球显隐设置」提示卡也一并移除，
      // 每页末尾不再追加任何非技能卡片，列表只展示技能本身。
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
      '#' + BALL_ID + '{position:fixed;right:74px;bottom:18px;width:46px;height:46px;border-radius:50%;' +
      'background:linear-gradient(135deg,#6a5cff,#2fb7ff);color:#fff;font-size:22px;display:flex;align-items:center;justify-content:center;' +
      'cursor:grab;z-index:2147481000;box-shadow:0 4px 16px rgba(40,80,255,.35);user-select:none;touch-action:none;transition:transform .15s ease}',
      '#' + BALL_ID + ':hover{transform:scale(1.08)}',
      '#' + BALL_ID + '.dsb-ghost{width:12px!important;height:12px!important;font-size:0!important;right:10px!important;bottom:10px!important;opacity:.3}',
      '#' + BALL_ID + '.dsb-ghost:hover{opacity:.8}',
      /* 字体球统一样式：与技能球同尺寸，暖色渐变，🔤 图标（纯 CSS，幂等，不动 font-enhancer） */
      '#dsh-fe-root #dsh-fe-toggle{width:46px!important;height:46px!important;' +
      'line-height:46px!important;font-size:0!important;color:transparent!important;' +
      'display:flex!important;align-items:center!important;justify-content:center!important;' +
      'background:linear-gradient(135deg,#ff8c42,#ffd27a)!important;' +
      'box-shadow:0 4px 16px rgba(255,140,66,.35)!important}',
      '#dsh-fe-root #dsh-fe-toggle::after{content:"🔤";font-size:20px;color:#fff;display:block;line-height:1}',
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

    // v1.5.3 一键恢复默认位置：清位置记忆与收起/隐藏状态，球立即回右下角默认位。
    // 供 DSH 设置页「悬浮球导航」分区按钮调用（球可能被拖出屏幕外卡住，无法点回）。
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
      try { console.log("[dsh-skill-browser] reset: skill ball + font ball -> default positions (paired bottom-right)"); } catch (e) {}
    }

    function buildBall() {
      if ($(BALL_ID)) return;
      var style = document.createElement("style");
      style.id = "dsb-ball-style";
      style.textContent = CSS;
      document.head.appendChild(style);

      var ball = document.createElement("div");
      ball.id = BALL_ID;
      ball.title = "技能浏览器（点击开关面板，可拖动，Alt+点击 收起成小圆点）";
      ball.textContent = "🧩";

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
      function mkToggle(id, label, onChange) {
        return React.createElement("label", { key: id, style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", cursor: "pointer" } },
          React.createElement("input", { type: "checkbox", id: id, onChange: onChange }),
          React.createElement("span", null, label));
      }
      rows.push(React.createElement("div", { key: "head", style: { fontWeight: "600", marginBottom: "4px" } }, "悬浮球导航"));
      rows.push(mkToggle("dsb-set-ball", "技能浏览器悬浮球（🧩）", function (e) {
        writeStore(BALL_VIS_KEY, e.target.checked);
        applyBallVisibility();
        if (!e.target.checked && S.open) closePanel();
      }));
      rows.push(mkToggle("dsb-set-font", "字体插件悬浮球（🔤）", function (e) {
        writeStore(FONT_BALL_VIS_KEY, e.target.checked);
        applyFontBallVisibility();
      }));
      rows.push(React.createElement("div", { key: "hint", style: { fontSize: "12px", color: "#8b93a8" } },
        "悬浮球可拖动；清单面板始终居中；本分区就在 DSH 设置中，随时可改悬浮球显隐"));
      // ── 一键恢复默认位置（v1.5.3 用户要求）：悬浮球被拖出屏幕外卡住时，
      // 点此按钮立即回到默认右下角 (right:26px bottom:118px) 46px 常规大小，
      // 并顺带恢复显示、解除收起小圆点状态。无需重启。──
      rows.push(React.createElement("button", { key: "reset-pos",
        onClick: function () { try { resetBallToDefault(); } catch (e) {} },
        style: { alignSelf: "flex-start", fontSize: "13px", cursor: "pointer",
          background: "rgba(255,210,122,.12)", border: "1px solid rgba(255,210,122,.35)",
          borderRadius: "6px", padding: "6px 12px", color: "#ffd27a" }
      }, isFontEnhancerInstalled() ? "🎯 一键恢复悬浮球默认位置（右下角，双球）" : "🎯 一键恢复悬浮球默认位置（右下角）"));
      // ── 推荐插件（v1.5.6：字体分区让位后，推荐位回归本分区）──
      rows.push(React.createElement("div", { key: "rec-head", style: { fontWeight: "600", marginTop: "12px", marginBottom: "4px", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: "10px" } }, "推荐插件"));
      rows.push(React.createElement("div", { key: "rec-lightbox", style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", padding: "3px 0" } },
        React.createElement("span", null, "🖼️ 照片显示器 — 聊天图片灯箱（放大/下载/浏览）"),
        React.createElement("a", { href: "https://github.com/loyalchiiina/dsh-chat-image-lightbox", target: "_blank", rel: "noopener", style: { textDecoration: "none", fontSize: "12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "6px", padding: "2px 8px", color: "#ffd27a", cursor: "pointer", whiteSpace: "nowrap" } }, "⭐ Star")));
      rows.push(React.createElement("div", { key: "rec-font", style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", padding: "3px 0" } },
        React.createElement("span", null, "🔤 字体插件 — 区域自定义字体/颜色/字号"),
        React.createElement("a", { href: "https://github.com/loyalchiiina/dsh-font-enhancer", target: "_blank", rel: "noopener", style: { textDecoration: "none", fontSize: "12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: "6px", padding: "2px 8px", color: "#ffd27a", cursor: "pointer", whiteSpace: "nowrap" } }, "⭐ Star")));
      return React.createElement("div", { "data-dsb-slot": "1", style: { display: "flex", flexDirection: "column", gap: "8px", padding: "8px 0" } }, rows);
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
      try { console.log("[dsh-skill-browser] client mounted (v1.4.1 slot-only)"); } catch (e3) {}
    };

    return module.exports;
  }
});
