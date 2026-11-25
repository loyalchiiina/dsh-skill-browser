# Changelog

## 2.2.49 (2026-11-25) — 会话栏列出已注入 MCP 的彩色胶囊（悬停看详情）

> **追加修复（同版本）**：MCP 页总开关（全部 MCP N 项）点击后不自动刷新、滑块停在旧状态的 bug。
> 根因：技能页 `toggleSkill` 采用乐观更新（请求前翻本地 `disabled` 并立即重绘），而 `doMcpBatch` 原来要等宿主 `/mcp/servers` 回包才刷新，宿主缓存未更新时滑块就不动。
> 修法：`doMcpBatch` 请求前按 `need` 乐观写 `M.data.servers[].disabled = !enable` 并立即 `paintMcp()`（16ms 防抖）；请求级失败/网络异常逐项回滚到点击前状态；成功后 `loadMcp(true)` 仍以宿主真值覆盖。
> 验证：抽取真实函数体 + 依赖桩实测——点击瞬间 disabled 全翻、`paintMcp` 立即调用 1 次、服务器 300ms 不回包仍保持新状态；失败路径还原到点击前。对照图 `docs/measure/slider-fix-before-after.png`（本轮工作区 `slider-before-after.png` 的交付副本）。
> 生效方式：客户端 bundle（`lib/client.js`），Junction private 包未接入 HMR → **必须彻底退出 DSH 再启动**（Ctrl+R / Ctrl+Shift+R 均不重新读盘）。
>
> **追加修复 2（同版本）**：MCP 页工具条按钮选中态固定蓝、与技能页/市场页紫粉皮肤不一致。
> 根因：`.dsb-tab-on` / `.dsb-chip-on` / `.dsb-home-*.on` 都走 `var(--dsb-onbrand-bg1/bg2)` 皮肤变量，唯独 `.dsb-mcp-btn` / `.dsb-mcp-btn.primary` 没进 `skinPanelCss()` 注入层，基础 CSS 的硬编码 `#5b6cff→#2fa8ff` 一直生效。
> 修法：`skinPanelCss()` 内补 `.dsb-mcp-btn`（普通态接 `var(--chipBg)/var(--ptx)/var(--pbd)`）与 `.dsb-mcp-btn.primary`（渐变接 `var(--dsb-onbrand-bg1/bg2)` + 同款 box-shadow），与技能/市场页同口径。
> 对照图 `docs/measure/skin-unify-before-after.png`。
>
> **追加修复 3（同版本）**：悬浮球导航设置页两处——①「作者插件」清单只有 13 项，缺 产物联动 / 团队编排 / 侧栏播放器 / 视频墙 4 项（均与「插件版本」tab 同源作者包），补全为 17 项；包 `dsh-piliaurora-wall` 中文名原误写「极光壁纸」，按 npm 实际描述（PiliAurora 视频墙，B站视频并行开窗）改为「视频墙」。4 项下载量取 npm API 近 30 天真实值（4905/2404/1778/430）。②「插件版本」tab 三列无表头，用户分不清箭头左右哪个是本机——补同结构列头「插件 / 本地已装 / npm 最新 / 状态 / 操作」，本地列 title=读本机 package.json，npm 列 title=registry 最新版。对照图 `docs/measure/verheader-authorlist-before-after.png`。
> **追加修复 4（同版本）**：「作者插件」tab 与「插件版本」tab 两份清单顺序/内容不一致（新增项插在不同位置、插件版本页缺技能守卫）——统一为 17 项严格同序同名，插件版本页补「技能守卫」。机器断言脚本核验 PASS（两页包名序列逐项相等）。对照图 `docs/measure/list-order-before-after.png`。
> **追加修复 5（同版本）**：选中态字体/背景的静态兜底也统一到皮肤变量——基础 CSS 里 `.dsb-chip-on` / `.dsb-mcp-btn.primary` / `.dsb-sortbtn-on` 三处原硬编码 `linear-gradient(135deg,#5b6cff,#2fa8ff)` + `color:#fff`，改为 `var(--dsb-onbrand-bg1/bg2)` + `var(--dsb-onbrand,#fff)`，与皮肤注入层同口径，即使 applySkinNow 注入延迟也不退回固定蓝白字。Playwright 实测赛博机能皮肤下三页选中态 computed color 全为 `rgb(18,21,28)`（近黑）、背景同为青粉渐变，未选中态保持原色。
> ⚠️ 用户反馈"没变"的机器根因：client.js mtime=10:50，官方版 DeepSeek Harness 进程启动=10:42（早 8 分钟）——客户端未加载新 bundle，非代码问题，需彻底退出 DSH 再启动。
> **追加修复 6（同版本）**：选中态字色统一为深色（选中/未选中要有区分）——「树状/平铺」选中后和未选中一样看不清。根因：`.dsb-gbar .dsb-gadd-on`（树状/平铺）CSS 写死 `color:#fff!important`，而皮肤引擎 `semanticVarsCss()` 对赛博机能亮渐变算出 `#12151c` 深字给「网格/全部128项/卡片」，导致同是选中态一组深字一组白字。修法：把写死的 `#fff` 改为 `var(--dsb-onbrand,#fff)`，与三页同口径；赛博机能下选中态统一深字 `#12151c`（青粉渐变对比度 5.27≥4.6），未选中保持浅字。注意：中途曾误判为「统一白字」并改过引擎，已回退，最终口径=按对比度自动选（亮渐变深字/深渐变白字）+ 树状平铺跟随同一变量。Playwright 实测选中态 computed color 全 `rgb(18,21,28)`、未选中 `rgb(201,231,245)`。对照图 `docs/measure/deep-font-before-after.png`。

用户要求：注入的时候在会话栏显示被注入的 MCP 名称，用彩色胶囊，鼠标悬停显示 MCP 内容。

### 实现
`paintMcpNow()` 里按 `M.sessionOn[id] === true` 收集已注入列表，逐个渲染胶囊：

```js
var _palette = ['#5b6cff','#34d399','#fbbf24','#f472b6','#38bdf8','#a78bfa','#fb923c','#4ade80'];
// 每个胶囊：文字=serverName，颜色从调色板轮转，边框/底色用同色 45% / 14% alpha
// title = 名称 · transport · 工具数 + 用途摘要 + 是否仅本对话放行 + 操作提示
```

胶囊样式（新增 `.dsb-sess-pills` / `.dsb-sess-pill`）：
- 内联弹性、间距 5px、圆角 20px、10.5px 半粗体、`cursor:help`
- 单个胶囊 `max-width:130px` + 省略号，胶囊组 `overflow:hidden`，防止长名字把会话栏撑爆
- 右侧提示文字随状态切换：有注入 → 「悬停胶囊看详情」；无注入 → 原「在卡片底部点…切换」

### 悬停内容（title，多行用 &#10;）
```
ansys-fluent-mcp · stdio · 18 个工具
控制 Fluent：设置查询与修改、网格质量、截图、仿真报告
（进程未加载，仅本对话放行）        // 仅当 disabled
点击卡片底部「注入 / 不注入」可单独开关
```

对照图：`docs/measure/sess-before-after.png`。

---

## 2.2.48
 (2026-11-25) — 卡片按钮行按列数均匀分布

用户反馈：中间三个按钮拥挤，要求按列数均匀分布。

### 根因
`.dsb-mcp-acts` 是 `justify-content:flex-start` + `.danger{margin-left:auto}`：
前 5 个控件挤在左边（gap 只有 5px），靠 auto margin 把卸载顶到最右（最后一段 gap 22.3px）。
5 列时更糟：flex 换行成 4+2，第一行右侧还留 28.2px 空白，第二行 导出 与 卸载 之间裂开 97.2px。

### 改法（两档，按卡片实际内容宽切换）
```css
/* 宽卡片（3 列，content 277px）：一行 6 控件等距铺满 */
.dsb-mcp-acts{justify-content:space-between; gap:6px}
.dsb-mcp-btn.danger{margin-left:0}

/* 窄卡片（≤230px，即 4~5 列）：3×2 网格，每格等宽 */
@container (max-width:230px){
  .dsb-mcp-acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:4px;row-gap:4px}
  .dsb-mcp-acts>.dsb-mcp-btn{width:100%;padding:3px 0}
  .dsb-mcp-acts>.dsb-mcp-valve-btn{width:100%;justify-content:center}
}
```

### 实测（量相邻控件间隙）

| 列数 | 改前 | 改后 |
|---|---|---|
| 3 列 | `5 / 5 / 5 / 5 / 22.3`（不均） | `8.5 / 8.5 / 8.5 / 8.5 / 8.5`（全等） |
| 5 列 | 4+2 断行，右留 28.2px；第二行裂 97.2px | 3+2 网格，两行 `4 / 4`，左右都填满 |

对照图：`docs/measure/acts-before-after.png`（3 列 / 5 列 × 改前改后，四格）。

---

## 2.2.47
 (2026-11-25) — 总开关移到工具条最左、删「刷新」、按钮行不换行

### ① 滑块挪到顶部，替代原来的统计文字
原来工具条第一行是 `共 10 个 MCP · 已连接 1 个 · 工具 1 个`，总开关吊在整行末尾。
现在顺序反过来：**滑块在最左**（`全部 MCP 10 项`），统计信息挂到滑块的 `title` 上（悬停可见，含已加载数）。

### ② 删除工具条里的「刷新」按钮
面板右上角本来就有刷新图标，重复。注意：加载失败时那个「重试」按钮仍保留（它也是 refresh 动作），
handler 的 `refresh` 分支不动。

### ③ 这一行不再折行
```css
.dsb-mcp-top{flex-wrap:nowrap; overflow-x:auto; gap:6px; scrollbar-width:none}
.dsb-mcp-top>.dsb-mcp-btn{flex:0 0 auto}
.dsb-mcp-top>.dsb-switch{flex:0 0 auto}
```
940px 面板实测：整行 37px 高、横向滚动量 0 —— 全部 11 个控件一行放得下；
面板被压窄时（720px）改为横向滚动而不是折行，滚动条隐藏不影响观感。

---

## 2.2.46
 (2026-11-25) — 总开关外观与技能页逐像素一致（取消半开态）

### 实测对比（同一页、同一缩放、4x 截图）

| 属性 | 技能页 `全部技能 127 项` | MCP `全部 MCP 10 项` |
|---|---|---|
| 轨道 | 34×18 | 34×18 |
| 轨道底色 | rgb(39,174,96) | rgb(39,174,96) |
| 圆点 | 14px @ left 18px | 14px @ left 18px |
| 文字 | 11px rgb(159,224,181) | 11px rgb(159,224,181) |

→ `IDENTICAL_STYLE: true`

### 为什么之前「长得不一样」
2.2.45 已经把结构/类名换成技能页那套，但 MCP 有「部分启用」态（1/10），走的是 `.dsb-sw-half`：
琥珀色文字 + 轨道左灰右绿渐变。技能页当时是 127/127 全开，走 `.dsb-sw-on`：绿轨道 + 绿字。
同一套规则、不同状态 → 看起来像两个控件。

本轮把总开关收敛成**两态**（和用户给的参照图一致）：
- 有任意 MCP 在加载 → `dsb-sw-on`：绿轨道、圆点在右、绿字
- 全部关闭 → 无状态类：灰轨道、圆点在左、灰字

「已加载几个」不再用颜色表达，改放 title（`1 / 10 个 MCP 已加载进 DSH…`），标签只显示总数，
文字格式与技能页对齐：`全部 MCP 10 项` / `全部技能 127 项`。

---

## 2.2.45
 (2026-11-25) — 总开关滑块改用技能页同一套；滚动条挪到面板右缘

### ① 总开关滑块：不再自造样式，直接复刻技能页的聚合滑块
技能页的滑块由 `aggSwitchHtml()` 生成，结构是**轨道在前、标签在后**，类名 `dsb-switch dsb-sw-agg`。
上一版我自己写了一版（`总开关 [轨道] 状态文字`，还加了 `.dsb-mcp-master` 自定义样式），长得不一样。
现在完全复刻：

```html
<label class="dsb-switch dsb-sw-agg dsb-sw-half" data-mcp-act="enableAll">
  <span class="dsb-sw-track"><span class="dsb-sw-thumb"></span></span>
  <span class="dsb-sw-label">总开关 3 / 10</span>
</label>
```

自定义 `.dsb-mcp-master` 样式已全部删除，尺寸/配色/半开渐变全部继承既有规则。

### ② 滚动条挪到面板最右边（和技能列表一致）
技能页的 16px padding 长在滚动容器 `.dsb-cards` 上，所以滚动条正好落在面板边缘；
MCP 原来把 16px 长在外层 `.dsb-mcp` 上，滚动条被挤进里面 16px —— 这就是「没挪」的原因。

```css
/* 之前 */ .dsb-mcp{padding:0 16px 14px}   .dsb-mcp-grid{padding:6px 0 0}
/* 现在 */ .dsb-mcp{padding:0}              .dsb-mcp-grid{padding:6px 16px 14px}
```
16px 改为由 `.dsb-mcp-top`（工具条）、`.dsb-sess-bar`（会话栏）、`.dsb-mcp-grid`（卡片区）、
`.dsb-mcp-tree`（树状）、`.dsb-mcp-exportwrap`（导出框）、`.dsb-mcp-residue`（残留面板）各自携带。

### 实测
- 网格右缘 941px = 面板右缘 942px → **滚动条贴面板边缘**（之前差 16px）
- 卡片左边距 17px / 右边距 17px
- 花括号 429/429 平衡

---

## 2.2.44
 (2026-11-25) — 总开关改成滑块，删掉「只留可用的」

### ① 两个总开关按钮 → 一个开关滑块
原工具条上有两个按钮：`⏻ 总开关关闭 (N)` / `⚡ 总开关开启 (N)`，语义上是同一个开关的两个动作，
现在合并成一个滑块（复用面板既有 `.dsb-switch` 骨架）：

| 状态 | 轨道 | 圆点 | 文字 |
|---|---|---|---|
| 全部关闭 | 灰 #555 | left 2px | 关闭 |
| 部分开启 | 灰→绿渐变（`.dsb-sw-half`） | left 10px（居中） | 部分 N/总数（琥珀色） |
| 全部开启 | 绿 #27ae60 | left 18px | 开启 N（绿色） |

点击行为沿用原动作：未全开 → `enableAll`（全部加载进 DSH）；已全开 → `disableAll`。
`role="switch" aria-checked` 与 title 提示（含「不影响各对话的注入阀门」）都保留。

实测三种状态圆点偏移：2px / 10px / 18px，与轨道 34×18 匹配。

### ② 删除「◎ 只留可用的」
按钮、点击分支一并移除；`doMcpEnableOnlyActive()` 函数保留（无入口调用），便于将来做批量策略时复用。

---

## 2.2.43
 (2026-11-25) — MCP 网格完全对齐「技能列表」口径

用户要求：照技能浏览列表的做法居中/左右对齐。于是把两个页签的度量都量出来对齐。

### 实测对照（面板 940px，均 5 列）

| 项目 | 技能列表 `.dsb-cards` | MCP 修复前 | MCP 修复后 |
|---|---|---|---|
| 水平 padding | 16px | 16px（在父层） | 16px |
| 列间距 gap | 8px | 10px | **8px** |
| 卡片左距 | 17px | 17px | 17px |
| 卡片右距 | 17px | **27px**（多了滚动条槽） | **17px** |

上一版用 `scrollbar-gutter:stable both-edges` 把右边距顶到 27px，虽然对称但和技能列表不一致。
技能列表的解法是：**padding 留在滚动容器外层**，滚动条只压缩内容宽度、不侵占 padding，
所以有没有滚动条，卡片到面板的左右间距都是 16px（+1px 边框）。本轮改成同一套。

### 具体改动
```css
/* 之前 */ .dsb-mcp-grid{ gap:10px; padding:4px 0 8px; scrollbar-gutter:stable both-edges }
/* 现在 */ .dsb-mcp-grid{ gap:8px;  padding:6px 0 0;   }
```
水平 16px 仍由 `.dsb-mcp` 提供（上一版已补 `box-sizing:border-box`，不再溢出）。

### 验收（3/4/5 列）
- 左右边距 **17 / 17**，与技能列表实测值完全相同
- 3 列：6 控件单行；4 列：单行；5 列：稳定两行，卸载贴末行右
- 同一行卡片等高、卸载 y 差 0；花括号 427/427

---

## 2.2.42
 (2026-11-25) — 卡片左右边距不对称（右侧贴边/被裁）

用户反馈：卡片距面板两侧应一致，实际左边宽、右边贴边甚至被裁。

### 根因（playwright 实测）
`.dsb-mcp` 同时有 `width:100%` 与左右各 16px 的 `padding`，但**没有 `box-sizing:border-box`**：
实际宽度 = 面板宽 + 32px → 右侧被面板的 `overflow:hidden` 裁掉。

实测（面板 942px，20 张卡片）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| `.dsb-mcp` 右溢出 | -31px | 0 |
| 卡片左距面板 | 23px | 27px |
| 卡片右距面板 | **-9px**（戳出面板） | 27px |

### 修复
1. `.dsb-mcp` 加 `box-sizing:border-box`（保留 width:100% 兜底）
2. `.dsb-mcp-grid` 加 `scrollbar-gutter:stable both-edges` —— 真实 Electron 里滚动条占 11px，
   只占右侧会让左右间距再次不等；both-edges 两侧对称预留，有无滚动条都一致
3. 网格左右 padding 由 6px 收到 0（避免叠加后内缩过多），最终两侧各 27px

### 验收（3/4/5 列 × 覆盖式/经典滚动条 两种模式）
- 左右边距 27 / 27，完全对称（两种滚动条模式都一致）
- 3 列、4 列：6 个控件单行；5 列：稳定两行，卸载贴末行右
- 同一行卡片等高、卸载 y 坐标差 0
- 花括号 427/427 平衡

---

## 2.2.41
 (2026-11-25) — 不再靠猜：用 playwright 实测把三条反馈全部量到像素

前几轮都在读代码猜原因，这次把面板的 `PANEL_CSS` 原样抽出来灌进独立页面，用真实 Edge 渲染 + 量盒子。
面板真实宽度是 `min(940px,94vw)`（不是窗口宽），卡片内容框实测：3 列 277px / 4 列 199px / 5 列 152px。

### 实测暴露的真问题
| 版本 | 3 列 | 4 列 | 5 列 |
|---|---|---|---|
| 2.2.40（nowrap + overflow:hidden） | 正常 | 按钮压到 20px | **溢出卡片 5.4px，文字被切** |
| 2.2.41 | 一行 6 控件 | 一行 6 控件 | 稳定两行、卸载贴末行右 |

另外发现两个隐藏变量：
1. `@container` 块少写一个 `}`，把后面所有基样式吞进容器查询 —— 3 列时滑块直接消失（已修，花括号 427/427 平衡）
2. 「注入」22px / 「不注入」33px 标签宽度不同 → 同一行卡片换行点不一致 → 卸载有的折行有的不折。
   已给标签 `min-width:33px` 定宽，彻底消除该变量。

### 最终实现
```css
.dsb-mcp-acts{flex-wrap:wrap; margin-top:auto}          /* 贴底 + 允许换行，不用 overflow:hidden */
.dsb-mcp-acts .dsb-mcp-btn.danger{margin-left:auto}     /* 卸载永远贴右 */
.dsb-mcp-card{container-type:inline-size}
@container (max-width:300px){ ...按钮 10.5px/padding 3px 5px }
@container (max-width:230px){ ...按钮 10px/padding 3px 2px, gap 3, 隐藏滑块文字 }
```
滑块骨架与位移仍写在同一个自包含块里，颜色改用皮肤变量 `var(--dsb-soft,#555)` / `var(--ptx,#fff)` / `var(--stD,#27ae60)`，换肤时跟着走。

### 实测结论（3 列 / 4 列 / 5 列全部通过）
- 滑块圆点：开启 `left:18px`、关闭 `left:2px`（三种列数一致）
- 溢出：0（无横向滚动、无文字被切）
- 卸载：右距卡片边 13px、下距卡底 12px —— 每一行每张卡片完全相同（dangerTopSpread = 0）
- 同一行卡片等高（hSpread = 0）

---

## 2.2.40
 (2026-11-25) — 对照历史版本回改：我确实删多了

用户质疑「以前是好的，你是不是删多了」——对照 12 个历史备份逐版核查后**属实**。

### ① 找到被删掉的关键一行
`.dsb-mcp-acts` 在第一代就有 `margin-top:auto`：

| 版本 | margin-top:auto |
|---|---|
| 2.0.6 ~ 2.0.7（含 replica-skill / clean-row-css） | 有，按钮行贴卡片底 |
| 当前 2.2.3x | **丢失** |

后果：按钮行跟着内容走，简介长短不同 → 卡片高矮不齐 → 「卸载」不在一条线、整体观感像被踩过。
v2.0.4 的注释白纸黑字写着「与技能卡 .dsb-card-foot 同口径（margin-top:auto + padding-top:8px + space-between）」，
后来某次改写只保留了 padding-top，margin-top:auto 被吃掉。**已恢复**。

### ② 同时回退我前几轮自作主张加的东西
- `.dsb-mcp-card` 的 `height:100%`：原版没有，反而可能在 CSS Grid 下撑出单元 → 已删
- `.dsb-mcp-grid`：回到原版 `repeat(auto-fill,minmax(300px,1fr))` + `gap:10px`，
  只补回 `overflow-x:hidden` 与两侧 6px 内边距，防止卡片边框贴到滚动条

### ③ 保留的修复（这几条是本轮反馈的真问题）
- 阀门滑块：骨架 + 位移写进同一个自包含规则块（`.on` 与 `[data-sess-on="1"]` 双命中）
- 按钮行 `flex-wrap:nowrap` + 卸载 `margin-left:auto` 贴右
- `.dsb-mcp-grid` 补进 `scrollbar-width:thin` 清单，不再用 17px 系统滚动条压住右列

---

## 2.2.39
 (2026-11-25) — 滑块自包含 + 按钮不折行 + 卡片边界

用户三点反馈（附图 1226×619，5 列卡片）：滑块还是不生效、卡片边界被裁减、卸载按钮不在一条线。

### ① 滑块：骨架和位移写进同一个规则块
2.2.32 的段被整块替换掉、2.2.37 只补回 `left`、2.2.38 补的骨架又和位移隔了几百行。
本轮把 `.dsb-mcp-valve-btn` 专用滑块整体迁到「滑动开关」块之后，每条都带 `!important`，
轨道 34×18 胶囊 + 圆点 14×14 绝对定位 + `left` 2px ⇄ 18px 过渡，点击与重绘双路径都能命中。

### ② 按钮：卸载统一贴右、永不折行
原来 `.dsb-mcp-acts` 是 `flex-wrap:wrap; justify-content:flex-start`。5 列时卡片很窄，
滑块+标签占掉一半宽度后「详情/导出/卸载」被挤到第二行；每张卡片简介长短不同 → 换行位置不同 →
卸载一会儿在上一行、一会儿在下一行，视觉上就是「不在一条线」。

修复：`flex-wrap:nowrap`、滑块 `flex:0 0 auto`、普通按钮 `flex:0 1 auto`（可压缩）、
卸载 `flex:0 0 auto; margin-left:auto`（贴右），并给卡片加 `height:100%`（grid 同行等高）+ 简介限 2 行。

### ③ 卡片边界被裁
`.dsb-mcp-grid` 原先漏在滚动条美化清单外，用的是系统默认滚动条（约 17px），右列卡片的边框
和「卸载」按钮被压在滚动条底下。现已把 `.dsb-mcp-grid` 加进 `scrollbar-width:thin` 清单。

### ④ 已知局限
每行 5 列且面板很窄（单卡 < 约 200px）时，中文按钮会收缩内边距；极端窄屏建议切「每行 3 / 4」。

---

## 2.2.38
 (2026-11-25) — 滑块圆点位移真正生效（补齐骨架 CSS）

### ① 上轮 2.2.37 为什么还是不动
2.2.37 补的是 `left:18px` **位移**规则，但阀门是 `<button class="dsb-mcp-valve-btn">`，
它不匹配 `.dsb-switch` 前缀的骨架规则，所以 `.dsb-sw-track` / `.dsb-sw-thumb` 在这里**根本没有骨架**：

- 没有 `width/height`（轨道塌成 inline 尺寸，圆点撑开）
- 圆点不是 `position:absolute`，`left` 对静态定位元素在 inline 布局里不产生位移

结果：点击后轨道背景变绿（颜色规则生效），圆点却始终贴在左边 —— 与用户反馈完全一致。

### ② 修复
在 v2.2.37 的规则块前面按 `.dsb-switch` 同一套数值补全骨架：

```css
#dsh-skill-browser-panel .dsb-mcp-valve-btn .dsb-sw-track{position:relative;display:inline-block;
  width:34px;height:18px;border-radius:999px;background:#555;transition:background .2s;flex:none}
#dsh-skill-browser-panel .dsb-mcp-valve-btn .dsb-sw-thumb{position:absolute;top:2px;left:2px;
  width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.4);transition:left .2s}
```

位移与开启态配色沿用 2.2.37 的双选择器（`.on` + `[data-sess-on="1"]`），并把轨道绿统一成技能滑块的 `#27ae60`，
开启态标签 `#9fe0b5`，关闭态 `#555`，与面板内其它滑块观感一致。

### ③ 副作用检查
- 仅作用于 `.dsb-mcp-valve-btn` 后代，不影响 `.dsb-switch` 自带滑块（同数值，无样式冲突）
- `.on` 与 `[data-sess-on="1"]` 在渲染与点击路径都会同步写入，二者任一命中即位移

---


## 2.2.37 (2026-11-25) — 滑块圆点真正位移（双选择器 + !important）

### ① 问题
用户反馈：开启时滑块的**圆点没有移动**，只有文字变色。
「开启的滑块式移动」——要的是圆点从左滑到右。

### ② 原因
v2.2.32 写的位移规则是：

```css
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-thumb { left:18px }
```

它依赖 `.on` 类名。类名切换存在竞态：
- 渲染时由 `_sOn` 决定是否带 `on`（静态正确）
- 点击时由 JS 手动 `classList.add("on")`（动态）
- `paintMcp()` 重绘会重建 DOM，中间的时序可能丢失该类

更稳的锚点是**渲染时就写死的 `data-sess-on` 属性**。

### ③ 修复（双保险 + 提高优先级）
```css
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-thumb,
#dsh-skill-browser-panel .dsb-mcp-valve-btn[data-sess-on="1"] .dsb-sw-thumb { left:18px !important }

#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-track,
#dsh-skill-browser-panel .dsb-mcp-valve-btn[data-sess-on="1"] .dsb-sw-track { background:#2ecc71 !important }
```

- **属性选择器** `[data-sess-on="1"]`：渲染时字符串写死，不依赖运行时类操作
- **类名选择器** `.on`：点击即时反馈用
- **`!important`**：压过基础 `.dsb-sw-thumb{left:2px}`

### ④ 几何核对
| 项 | 值 |
|---|---|
| 轨道宽 × 高 | 34px × 18px |
| 圆点宽 × 高 | 14px × 14px |
| 关闭位置 | `left:2px`（左内边距） |
| 开启位置 | `left:18px`（34 - 14 - 2 = 18，正好贴右）|

滑动距离 16px，`transition:left .2s` 驱动动画。

### ⑤ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.36 (2026-11-25) — 照抄技能卡片的列数实现（不再自创公式）

### ① 用户对比两张图后的真问题
技能浏览的卡片（每行 3/4/5/6）排布正常，MCP 卡片不正常。
逐行对比源码后找到差别：

| 项 | 技能卡片 `paintCards` L5222 | MCP（修前） |
|---|---|---|
| 列数落地方式 | **内联 style 一行赋值** | CSS 选择器 + `--dsb-cols` 变量 |
| 公式 | `repeat(N, minmax(0,1fr))` | `repeat(auto-fit, minmax(calc((100% - 16px)/3),1fr))` |
| `!important` | 不用 | 用了 |
| calc 除法 | **没有** | **有**（v2.2.35 已因 var 作除数失效） |

```js
// 技能（原版，一直正常工作）
box.style.gridTemplateColumns = S.cardCols ? ("repeat(" + S.cardCols + ",minmax(0,1fr))") : "";
```

### ② 修复：直接照抄这一行
```js
h += '<div class="dsb-mcp-grid"' +
  (M.cols ? ' style="grid-template-columns:repeat(' + M.cols + ',minmax(0,1fr))"' : '') + '>';
```
- 删除 v2.2.35 那三条 `--dsb-cols` 穷举 CSS 规则（不再需要）
- 不用 `!important`、不用 CSS 变量、不做 calc 除法
- 基础 CSS 与 `.dsb-cards` 完全一致：
  `repeat(auto-fill, minmax(280px,1fr))` + `gap:8px` + `padding:6px 0 8px`

### ③ 为什么之前会「粘连 / 溢出」
自创公式连踩两坑：
1. v2.2.34：`calc(... / var(--dsb-cols))` —— 除数是变量，整条 calc **静默失效**
2. v2.2.35：改穷举字面量，但列宽用百分比 + `auto-fit`，
   与 `repeat(N)` 语义不同，容器宽度变化时表现不一致

而原版的 `repeat(N, minmax(0,1fr))` 简单直接：
硬 N 列等分，`minmax(0,…)` 允许内容收缩不溢出。**原版方案本来就是对的。**

### ④ 复盘（方法论级）
用户说「参考技能浏览的列表布局」时，我以为是「视觉对齐」，
于是重写了公式。实际他要的是「**照抄能工作的实现**」。
正确做法：**先读参照对象的源码，逐行照搬，而不是重新推导一遍公式。**
重新推导 = 重复踩别人已经踩完的坑。

### ⑤ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.35 (2026-11-25) — 修「卡片粘连无间隙」+ 对齐技能列表布局

### ① 根因（CSS calc 的硬规则）
v2.2.34 写成：

```css
minmax(calc((100% - (var(--dsb-cols) - 1) * 10px) / var(--dsb-cols)), 1fr)
```

**问题**：CSS `calc()` 的**除数必须是数字字面量**。
`var(--dsb-cols)` 展开后是字符串 `"3"`，不能作为除数参与运算 →
**整条 calc 失效** → `minmax()` 退化为无效值 → 列宽不成立 →
卡片按内容收缩并紧贴，gap 也失去意义。

### ② 修复：三档穷举（3/4/5 只三档，穷举最稳）
```css
[style*="--dsb-cols:3"] { grid-template-columns: repeat(auto-fit, minmax(calc((100% - 16px) / 3), 1fr)) !important; gap:8px }
[style*="--dsb-cols:4"] { grid-template-columns: repeat(auto-fit, minmax(calc((100% - 24px) / 4), 1fr)) !important; gap:8px }
[style*="--dsb-cols:5"] { grid-template-columns: repeat(auto-fit, minmax(calc((100% - 32px) / 5), 1fr)) !important; gap:8px }
```
三条规则里的除数都是**字面量**（3/4/5），calc 正常求值。

### ③ 布局对齐技能列表（用户要求「参考技能浏览的列表布局」）
逐项对齐 `.dsb-cards`：

| 属性 | 技能 `.dsb-cards` | MCP（修前） | MCP（修后） |
|---|---|---|---|
| 列宽基准 | `minmax(280px,1fr)` | `minmax(300px,1fr)` | **`minmax(280px,1fr)`** |
| gap | `8px` | `10px` | **`8px`** |
| padding | `6px 16px 14px` | 无（靠父级） | **`6px 0 8px`**（左右已由父级提供） |
| 溢出 | 无 | 无保护 | **`overflow-x:hidden` + `box-sizing:border-box`** |

### ④ 数学核对（容器 900px）
| 每行 | 每列宽 | 总占宽 |
|---|---|---|
| 3 | 294.7px | 3×294.7 + 16 = 900px ✓ |
| 4 | 219.0px | 4×219.0 + 24 = 900px ✓ |
| 5 | 173.6px | 5×173.6 + 32 = 900px ✓ |

均精确铺满，无溢出、无粘连。

### ⑤ 复盘
`calc()` 除数是 `var()` 是 CSS 的硬限制，不是浏览器差异。
我在 v2.2.34 设计这条公式时没意识到，导致整条规则静默失效——
表现是「卡片粘连」而不是「报错」，所以从现象反推很难定位。
**教训：凡 calc 里带除法的 CSS 变量方案，必须落地成具体字面量或穷举档位。**

### ⑥ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.34 (2026-11-25) — 修「每行 N」列数溢出的边界问题

### ① 现象
用户选「每行 5」，实际排成 4 列，且最右侧卡片出界、底部出现横向滚动条。

### ② 数学根因
v2.2.31 的写法是**硬 N 列 + 220px 下限**：

```css
repeat(var(--dsb-cols), minmax(max(220px, calc(...)), 1fr))
```

| 每行 | 每列最小值 | N 列总需宽 | 面板可用宽 | 结果 |
|---|---|---|---|---|
| 5 | 220px | 5×220 + 4×10 = **1140px** | 约 900px | **溢出 240px** |

`repeat(N, …)` 是**硬列数**，不会因为容器不够而减少列数；`minmax` 下限 220px
又把每列死死撑住 → 总宽顶爆容器 → 出界 + 横向滚动。

### ③ 修复：列宽改为纯百分比
```css
grid-template-columns: repeat(auto-fit,
  minmax(calc((100% - (var(--dsb-cols) - 1) * 10px) / var(--dsb-cols)), 1fr)) !important;
overflow-x: hidden;
box-sizing: border-box;
```

核心变化：
- **列宽 = 可用宽度 / N**（百分比，无固定 px 下限）→ N 列正好铺满
- **`auto-fit`** 替代 `repeat(N)` → 容器不够时自动减列，不溢出
- **`overflow-x: hidden`** 双保险

### ④ 数学验证（W=900px, gap=10px）
| 每行 | 目标列宽 | auto-fit 实排 |
|---|---|---|
| 3 | 293.3px | 3 列 |
| 4 | 217.5px | 4 列 |
| 5 | 172.0px | 5 列 |

三档均精确铺满，无溢出。

### ⑤ 取舍说明
去掉了「每列最小 220px」这个保护。代价是选 5 列时单卡可能窄到 172px（文字会换行更多）。
如果你更看重「卡片不能太窄」，那就必须接受「窄屏时少于 N 列」——
这两个诉求互斥，不能同时成立。当前选择是**保证不溢出**。

### ⑥ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.33 (2026-11-25) — 修卡片按钮被裁掉（回退 overflow:hidden）

### ① 现象
用户反馈「按钮都没了」。卡片里重连/断开/详情/导出/卸载 整行消失。

### ② 根因
v2.2.32 为解决「卡片溢出边界」，给 `.dsb-mcp-card` 加了 `overflow:hidden`。
但卡片高度是**自适应**的（不是固定高），内容一旦超出 grid 行高，
底部内容直接被裁掉 —— 恰好是 `.dsb-mcp-acts` 那一行按钮。
叠加 `.dsb-mcp-acts { margin-top: auto }`，按钮会被推到裁切区之外。

### ③ 修复
- 去掉 `overflow:hidden` 与 `height:100%`（卡片高度自适应，不裁剪）
- 保留宽度约束：`box-sizing:border-box` + `min-width:0`
- `.dsb-mcp-acts` 去掉 `margin-top:auto`（不需要推到底部）
- 补 `.dsb-mcp-summary` / `.dsb-mcp-calls` 的 `overflow-wrap:anywhere; min-width:0`
  （长中文说明不撑宽卡片）

**思路调整**：卡片边界由 **grid 的 `minmax(220px, …)` 下限**保证，
而不是靠 `overflow:hidden` 兜底。后者会牺牲内容可见性。

### ④ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.32 (2026-11-25) — 修卡片溢出边界 / 补回滑块位移 / 按钮不再误灰

### ① 卡片内容溢出边界
用户反馈「卡分裂都出去边界了」。
对比技能卡片 `.dsb-card` 后发现关键缺失：

| 属性 | 技能卡片 | MCP 卡片（修前） |
|---|---|---|
| `box-sizing` | `border-box` | **无**（content-box → padding 撑出容器） |
| `height` | `100%` | **无** |
| `min-width` | — | **无**（长内容不收缩） |
| `overflow` | — | **无** |

修复：`.dsb-mcp-card` 补 `height:100%; box-sizing:border-box; min-width:0; overflow:hidden`。
同时 `.dsb-mcp-acts` 由 `justify-content:space-between` 改为 `flex-start` + `min-width:0`，
避免按钮被挤到卡片外。

### ② 注入滑块仍然不动
**根因**：v2.2.31 替换 CSS 块时，把 v2.2.30 加的滑动规则**整块替换掉了**。
grep 确认 `.dsb-mcp-valve-btn.on .dsb-sw-track/.dsb-sw-thumb` 两条都不存在。

修复（补回，且这次写在独立位置，不会再被块替换误伤）：
```css
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-track { background:#2ecc71 }
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-thumb { left:18px }
```

### ③ 断开后「重连」变灰不可点
重连按钮的 `disabled` 绑定的是 `s.disabled`（配置里的停用状态）。
断开的语义是「只关连接、不改配置」，但按钮仍被该条件拖灰，导致断开后无从恢复。

修复：**重连与断开按钮都不再绑定 `disabled`**（卡片视图 + 树状视图同步），
只保留 `title` 说明。二者都是「恢复/断开连接」动作，任何时候都应可点。

### ④ 复盘（连续两轮同类失误）
v2.2.31 的 CSS 块整块替换（用 splice 覆盖一段）把相邻的滑动规则一起删掉了。
**教训：整块替换 CSS 后必须 grep 回验「上一轮新增的每条规则是否还在」**，
而不是只验证新写入的内容。本次已把新规则放在独立语句位置，降低再被误伤的概率。

### ⑤ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.30 (2026-11-25) — 修复注入滑块「点了不动」

### ① 根因（两个叠加）
**原因一：滑块位移规则挂错了父类**
原有滑动效果由这两条驱动：

```css
#dsh-skill-browser-panel .dsb-switch.dsb-sw-on .dsb-sw-track { background:#27ae60 }
#dsh-skill-browser-panel .dsb-switch.dsb-sw-on .dsb-sw-thumb { left:18px }
```

它们只认 `.dsb-switch` 父类。v2.2.29 把阀门从 `<label class="dsb-switch dsb-mcp-valve">`
改成 `<button class="dsb-mcp-valve-btn">` 后，**不再匹配这两条选择器**，
所以点击后虽然加了 `.on` 类，轨道不变色、滑块也不位移 —— 视觉上「没动」。

**原因二：没有点击瞬间的即时反馈**
原来只依赖 `paintMcp()` 重绘（16ms 节流）加一次网络往返，
在宿主热重载慢时会有一段「点了没反应」的空窗。

### ② 修复
**补滑块规则**（不依赖 `.dsb-switch` 父类）：
```css
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-track { background:rgba(91,108,255,.85) }
#dsh-skill-browser-panel .dsb-mcp-valve-btn.on .dsb-sw-thumb { left:18px }
```

**加点击即时 DOM 反馈**（不等重绘、不等网络）：
```js
if (_next) sSess.classList.add("on"); else sSess.classList.remove("on");
sSess.setAttribute("data-sess-on", _next ? "1" : "0");
var _lbl = sSess.querySelector(".dsb-sw-label");
if (_lbl) _lbl.textContent = _next ? "注入" : "不注入";
```
随后 `toggleSessionMcp()` 的乐观更新 + 300/800ms 两次拉取会把真实状态校准回来（失败则回滚）。

### ③ 清理
删除替换过程中产生的一处重复 `if (sSess) {}` 分支（会重复触发 toggle）。

### ④ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.29 (2026-11-25) — 注入滑块可点 + 新增「断开连接」

### ① 注入滑块点击无效的修复
原阀门用的是 `<label>`，内无 `<input>`：
- `change` 事件永远不触发（`handleMcpChange` 只认 `[data-mcp-toggle]`）
- `<label>` 在某些情况下会把 click 转发多次，导致状态闪回

**改法**：
- 元素 `<label class="dsb-switch dsb-mcp-valve">` → `<button type="button" class="dsb-mcp-valve-btn">`
- 走 `handleMcpClick` 的 `[data-sess-mcp]` 分支（已在 v2.2.18 提到最前）
- 新增 `.dsb-mcp-valve-btn` 样式（复用原开关视觉，5 条规则）

**参考技能滑块的状态收敛做法**（用户点名要求）：
切换成功后不只用一次 `loadSessionMcp()`，而是补两次延迟拉取：

```js
loadSessionMcp();
setTimeout(function () { loadSessionMcp(); }, 300);
setTimeout(function () { loadSessionMcp(); }, 800);
```

原因：宿主写配置 → DSH 补丁层热重载 → 运行时状态变化有延迟，
单次拉取会读到旧值把滑块弹回。失败时也补拉一次校准。

### ② 新增「断开」按钮（每个 MCP 卡片）
用户要求：每个 MCP 加一个断开连接按钮。

**与「停用」的语义区分**：

| 操作 | 行为 | 配置 |
|---|---|---|
| **停用**（原开关，已上移为总开关） | 写 `disabled: true`，DSH 重载后不再加载 | 改 |
| **断开**（新增） | 只关当前连接（子进程退出） | **不改**，下次启动仍会连上 |

- 宿主端：`disconnectMcp(ctx, id)` —— 对该 loader entry 的 `fiber` 调 `dispose()`；
  无 `dispose` 时回退到 `update()` 重建（旧连接先关）
- 路由：`POST /dsh-skill-browser/mcp/disconnect` body `{ id }`
- 客户端：`doMcpDisconnect(id)` —— toast 提示 + 600ms/1600ms 两次延迟拉状态
- 按钮位置：「重连」之后，文案「断开」，`title` 说明不改配置

### ③ 核验
- `lib/client.js` / `lib/index.js` / `lib/mcp.js` 语法破坏检查：全部 exitCode=0
- 阀门链路：`data-sess-mcp` → `handleMcpClick`（L2534）→ `toggleSessionMcp` → `POST /session-mcp/toggle`
- 断开链路：`data-mcp-disconnect`（L2053）→ `handleMcpClick`（L2608）→ `doMcpDisconnect`（L2768）→ `POST /mcp/disconnect`

### ④ 生效方式
宿主端（新路由 + 新导出）与客户端均有改动：**彻底退出 DSH 客户端再启动**。

## 2.2.28 (2026-11-25) — 修复卡片互相嵌套（真正的单列根因）

### ① 关键线索（用户截图）
卡片是**嵌套**的：ansys-cfx-mcp 出现在 ansys-agent-bridge 卡片内部，
ansys-fluent 又嵌在 cfx 里面 —— 这不是宽度问题，是 **HTML 标签未闭合**。

### ② 根因
2.2.24 清理「重复阀门块」时，把 `mcpCardHtml()` **卡片自身的 `</div>` 一并误删**
（函数内 div 9 开 8 闭，差 1）。浏览器按 HTML 解析规则，
下一张卡片整体嵌进上一张未闭合的 `.dsb-mcp-card` 内，
10 张卡片层层嵌套 → 外层 grid 的每个嵌套层级都变成一个新列位 → 视觉上只剩 1 条。

### ③ 修复
`mcpCardHtml()` 结尾补回卡片自身闭合：

```js
if (M.detailId === s.id) h += mcpDetailHtml(s, st);
h += "</div>";   // acts 行闭合（原有）
h += "</div>";   // 卡片自身闭合（本轮补回）
return h;
```

### ④ 验证
- `mcpCardHtml`：div 9 开 / 9 闭 → ✅ 配平
- `mcpTreeHtml`：div 17 开 / 17 闭 → ✅ 配平
- `node --check` 三文件全部 exitCode=0

### ⑤ 反思（方法论级教训）
本轮反复修宽度（width:100%、minmax 下限、flex-grow）全都无效，
因为**真正的问题在 DOM 结构层**：标签不闭合时，任何 CSS 都救不了。
正确顺序应是：**先验 DOM 配平，再查 CSS**。若一开始做 div 开闭统计，
一眼就能看到差 1，不会耗掉四轮。

### ⑥ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.27 (2026-11-25) — 修复 MCP 卡片塌缩为单列（宽度链断裂）

### ① 现象
MCP 卡片列表塌缩成左侧一条窄带，右侧大片空白；技能列表（技能浏览 Tab）正常。
与 GitHub 远程 `77ed813`(2.2.14) 对比后确认：**原版无此问题，塌缩是本轮改动引入的**。

### ② 根因（宽度约束链断裂）
原版 `.dsb-mcp` 与 `.dsb-mcp-grid` 都**不写 width**，依赖父级纵向 flex 的
`align-items: stretch` 继承满宽。这个隐式传递在以下三点被打破：

| 位置 | 问题 |
|---|---|
| `.dsb-sess-bar-hint` | 写了 `flex: 1 1 auto`。父容器宽度未定时，flex-grow 反向把父级压成**内容宽度** |
| `.dsb-sess-bar` | 纵向 flex 子项但无 `width:100%`，其宽度由内部 flex-grow 反推 |
| `.dsb-mcp` / `.dsb-mcp-grid` / `.dsb-mcp-tree` | 同样依赖隐式 stretch，缺乏显式兜底 |

一旦容器宽度被压到 < 300px，`repeat(auto-fill, minmax(300px,1fr))` 只能排 1 列 → 卡片成窄条。

### ③ 修复（显式声明宽度，断开对内容的依赖）
```css
.dsb-mcp       { width: 100%; }
.dsb-mcp-grid  { width: 100%; }
.dsb-mcp-tree  { width: 100%; }
.dsb-sess-bar  { width: 100%; box-sizing: border-box; }
.dsb-sess-bar-hint { margin-left: auto; }   /* 去掉 flex:1 1 auto */
```
`margin-left: auto` 替代 `flex-grow` 做右推：不参与宽度分配，不会反向撑宽父级。

### ④ 排查确认
全plugin范围搜索 `flex: 1 1 auto`，仅剩 `.dsb-gsp` / `.dsb-grsp`（技能视图内，
不在 MCP 视图链路上），无同类风险。

### ⑤ 与原版的差异说明
本轮所有改动已通过 `git diff` 存为本地补丁 `skill-browser-local-changes.patch`（70 KB，留在开发机，不随包发布），可随时回退或逐段审查。

### ⑥ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.25 (2026-11-25) — 修复卡片被压成 40px 一条的布局 bug

### ① 现象
用户截图：MCP 卡片列表塌缩成左侧约 40px 宽的一条，卡片内文字竖排成一字一行，
右侧大片空白。页面本身没有报错，只是布局崩了。

### ② 根因
`paintMcpNow()` 里给网格写的是：

```js
grid-template-columns: repeat(M.cols, minmax(0, 1fr))
```

`minmax(0, 1fr)` 的**下限是 0**，没有任何最小宽度保护。
当父容器可用宽度不足（面板宽度计算 / 侧边栏占位 / 窗口变窄 任一情况），
4 列就被平均压到每列几十像素，卡片内容随之竖排塌缩。

### ③ 修复
改为按可用宽度自适应列数，并给每列一个真实下限：

```js
grid-template-columns: repeat(auto-fill, minmax(220px, 1fr))
```

- 容器够宽：按 220px 起排，装得下就多列（等价于原来「每行 N」的意图）
- 容器变窄：**自动减少列数**，而不是压缩列宽
- 卡片最小宽度 220px，永远不会被压成一条

原有的「每行 3/4/5」按钮仍保留（写入 `--dsb-want-cols` 供后续按需使用），
但不再作为硬性列数——避免再次出现「硬撑 N 列导致塌缩」。

### ④ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.24 (2026-11-25) — 三层语义收敛：总开关（加载） × 卡片阀门（注入） × 卡片亮灯

### ① 设计（用户 2026-11-25 明确）
把两个维度彻底分开，避免混在一起：

| 控件 | 语义 | 位置 |
|---|---|---|
| **总开关** | 全部 MCP 是否**加载进 DSH**（进程层，写 `disabled`） | 顶部按钮「⏻ 总开关关闭 / ⚡ 总开关开启」 |
| **卡片阀门** | **本对话**是否允许注入该 MCP（`restrict` 遮 loader） | 每张卡片底部动作区第一个控件 |
| **卡片亮灯** | 每个对话亮灯不同，一眼看出本对话能用哪些 | 卡片整体 `.dsb-card-inj` |

### ② 具体改动
- **原卡片内「加载开关」→ 改为「注入阀门」**
  - 文案由 `开/关` 改为 `注入/不注入`
  - 数据属性 `data-mcp-switch` → `data-sess-mcp`（走 `/session-mcp/toggle`）
  - 卡片视图（L2044）与树状视图（L2199）同步改
- **顶部批量按钮语义澄清**
  - `⏻ 全部关闭` → `⏻ 总开关关闭`，title 说明「不加载进 DSH，进程停止；不影响各对话的注入阀门设置」
  - `⚡ 全部开启` → `⚡ 总开关开启`，title 说明「加载进 DSH；是否注入各对话仍由卡片内的阀门决定」
- **卡片亮灯**
  ```
  .dsb-mcp-card.dsb-card-inj{border-color:rgba(91,108,255,.55);background:rgba(91,108,255,.08);box-shadow:0 0 0 1px rgba(91,108,255,.22)}
  .dsb-mcp-card.dsb-card-inj .dsb-mcp-name{color:#c3cbff}
  ```
- **移除上方独立控制区**
  10 个胶囊的开关矩阵整体删除，只留一行会话标识：
  `本对话 …481ae904 · 已注入 3 / 10 个 MCP · 在卡片底部点「本对话可注入」切换`
- **原 `data-mcp-switch` 处理分支保留**（加注释说明当前无元素命中），便于未来恢复卡片内加载开关。

### ③ 机制不变
`agent.ctx.tools.restrict({ deny: ['mcp__<server>__load_tools'] })`
→ `catalog(scope)` 返回空串 → 该 MCP 目录从该对话消失；进程不杀、其他对话不受影响。

### ④ 生效方式
宿主端（agent/created 监听 + 路由）与客户端（UI）均有改动：**彻底退出 DSH 客户端再启动**。

## 2.2.22 (2026-11-25) — 卡片隐藏启动命令 + 说明换为人话

### ① 隐藏启动命令路径
用户原话：「卡片中显示他们的文件路径好像没必要显示啊我也不看」。
卡片里那行 `C:\...\mcp-launch.exe 15 D:\Program ...` 属于实现细节，
对「要不要用这个 MCP」的决策零帮助，反而占据卡片首屏最显眼的位置。
改法：`.dsb-mcp-target` 仅在**该卡片「详情」展开时**渲染（`M.detailId === s.id`），
默认不显示，需要排错时点「详情」即可看到完整命令。

### ② 说明文字换为人话
卡片原先把 `s.summary`（作者用工具名关键词猜的「1 个工具，主要提供查询 / 写入/配置能力」）
直接显示，信息量很低。改为 `s.purpose || s.summary`，
即 2.2.17 引入的 `MCP_PURPOSE` 手写说明（如「控制 Fluent：启动会话、跑 journal…」），
两处渲染（卡片视图 + 树状视图）同步生效。

### ③ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.21 (2026-11-25) — 当前对话区压缩高度（修复「下方卡片看不见」）

### ① 问题
用户反馈：「太拥挤了，下面的卡片看不到」。
实测原因：`.dsb-mcp` 是纵向 flex 容器，`.dsb-mcp-grid`（卡片区）靠 `flex:1` 取剩余空间；
而新加的 `.dsb-sess` 没有高度约束，按内容撑开约 **456px**
（10 项两列 5 行 × 72px + 间距 + 头部），把卡片区压到不足 170px。

### ② 改法
- **单行卡片**：去掉第二行说明，改挂 `title` 属性（hover 可见），
  每项高度从约 72px 降到约 28px。
- **多列紧凑网格**：`minmax(320px,1fr)` → `minmax(190px,1fr)`，
  宽屏 5 列、网格 2 行。
- **高度封顶**：`.dsb-sess` 加 `max-height: 38%` + `flex: 0 0 auto`，
  `.dsb-sess-list` 加 `overflow-y: auto` + `min-height: 0`，
  超出时自身滚动，不再挤压卡片区。
- **间距收窄**：卡片 padding 10→6、网格 gap 8→6、外层 padding 12→10。

### ③ 效果
控制区高度 456px → 约 116px（封顶 38%），卡片区从不足 170px 回到 340px 以上。

### ④ 尺寸仍并入既有档位
圆角 11/8/6/4/999；字号 11/10.5/10；间距 10/8/6。

### ⑤ 生效方式
仅客户端：`Ctrl+Shift+R`。

## 2.2.20 (2026-11-25) — 当前对话区改为卡片式（对齐下方清单的视觉语言）

### ① 问题
用户原话：「下面的清单卡片看起来很利索，有什么一目了然的方式吗」。
上一版把 10 个 MCP 塞在同一个大框里，行与行只有空白间隔，缺少「块」的边界；
说明文字与名字同排，扫视时互相打架。

### ② 改法：每项做成独立小卡片（同 `dsb-mcp-card` 的视觉语言）
- `.dsb-sess-item`：`flex-direction: column`、`gap: 6px`、`padding: 10px 12px`、
  圆角 8、独立底色 `rgba(128,138,160,.06)` + 边框，hover/开启各有形态。
- **第一行两端对齐**：`名字`（`flex: 1 1 auto` + 省略号）+ `状态徽标`（`flex: 0 0 auto`）。
  名字左起、状态右止，扫视时视线落点固定。
- **第二行独占**：说明文字（`font-size: 10.5`、灰色），不与名字抢权重。
- 网格 `repeat(auto-fill, minmax(320px, 1fr))`：宽屏多列、窄屏单列。

### ③ 尺寸全部并入既有档位
圆角 11（外层）/8（卡片）/6（ID 徽标）/4（状态徽标）/999（圆点）；
字号 11（名字/头部）/10.5（说明/提示）/10（状态/ID）；
间距 12（padding）/8（网格与行距）/6（卡片内）。

### ④ 生效方式
仅客户端：`Ctrl+Shift+R` 硬刷新。

## 2.2.19 (2026-11-25) — 当前对话控制区视觉重做

### ① 修复点击无效（2.2.18 遗留的逻辑嵌套 bug）
`handleMcpClick` 原本先取 `[data-mcp-act]` 再在 `if (b)` 内取 `[data-sess-mcp]`；
而胶囊只带 `data-sess-mcp`，导致 `b === null` 整块跳过，表现为「点了没反应」。
已把胶囊判断提到最前，不再依赖 `b` 存在。

### ② 视觉重做（依据 dsh-plugin-ui-design 方法论）
- **圆角并入既有档位**：控制区 11（同 MCP 卡片）、胶囊 8、ID 徽标 6、加载数 4、圆点 999。
  原用 9 / 7 两个孤立值（该插件此前仅各出现 3~4 次，不成档）。
- **间距走偶数节奏**：控制区 padding 12、行间距 8、胶囊内 gap 6、头部 gap 8。
  原用 7 / 9 两个不在 1/2/4 节奏上的值。
- **两列自适应网格**：控制区从单列 10 行改为 `repeat(auto-fill, minmax(340px, 1fr))`，
  宽屏两列、窄屏一列，垂直占用减半（对应铁律「能一屏展示就不滚动」）。
- **说明文字右对齐**：胶囊 `flex: 0 0 auto` 固定，说明 `min-width: 0` + `overflow-wrap: anywhere`，
  长中文说明换行不撑破容器，行首对齐整齐。
- **层级弱化**：控制区背景改为 `--chipBg`（与卡片同级的最弱底色），
  边框透明度从 .28 降到 .22，让「控制区」与「详情卡片」区分层次。

### ③ 未改动
- 功能逻辑、宿主端路由、on-demand 机制、默认全关策略均不变。

### ④ 生效方式
仅客户端（lib/client.js）：`Ctrl+Shift+R` 硬刷新即可。

## 2.2.17 (2026-11-25) — 面板语义收敛：MCP 级开关 + 人话说明

### ① 决策依据（用户明确）
- 一个 MCP 内含数十个工具（workbench 50+、spaceclaim 29、playwright 25…），
  用户不可能逐个判断「我需要哪个工具」；用户只知道「我要用 Fluent / 浏览器」。
- 因此开关粒度定在 **MCP**，不做工具级勾选。
- on-demand 的目录开销（约 200 行 × 160 字符 ≈ 3.3 万字符）用户已明确「可以接受」，
  远小于 eager 的全量 schema（≈16.6 万字符）。故**继续使用 on-demand**。

### ② 面板改动
- 每个 MCP 独占一行：`● <名字> 开/关` + 一句人话功能说明。
  说明来自新增的 `MCP_PURPOSE`（10 个 MCP 手写），未列出的回退到关键词猜测。
- 去掉上一版的「注入 N / 仅目录」三态显示（用户反馈会造成「要我选工具」的误解），
  恢复单纯的 开 / 关 两态。
- 说明文案：「开启=本对话可用该 MCP 的全部工具 / 点一下只影响本对话」。

### ③ 新对话默认全关
- `agent/created` 时对未显式开启的 MCP 逐个施加 `restrict({deny:[loader]})`。
- MCP 服务启动有 15s 延迟，故采用重试：1.5s 一次、最多 12 次（约 18s），
  直到 `listLoaderTools()` 能列出 loader 为止。
- 用户开启的 MCP 记入 `_sessionAllowed`，后续重试不会误遮。

### ④ 移除
- 删除 `loadMcpTools()` 与相关探测：内核的 `offered` 为私有字段，
  `catalog()` 文本不对插件暴露，`load([])` 报错不含名单，
  因此**无法从外部枚举未加载的工具名**，该能力不可实现，留作死代码无益。

### ⑤ 保留的能力（上一版已有）
- 按对话逐项开关（`restrict` 遮 loader → catalog 空串 → 目录消失）
- 切换对话自动刷新（`sessions.list.subscribe`，仅在 MCP Tab 可见时）
- 面板关闭时卸掉监听

### ⑥ 生效方式
宿主端（agent/created 监听 + inject）与客户端（UI）均有改动：
**彻底退出 DSH 客户端再启动**。

## 2.2.16 (2026-11-24) — 按对话（per-session）逐项开关 MCP

### ① 需求
MCP 工具目录会注入每个对话的系统提示。用户需要在面板里**按对话**决定哪些 MCP 可见，
并看到该对话的开启状态；默认尽量少占上下文。

### ② 机制（官方端内置 dsh-mcp-client 0.2.3-alpha.2 实测源码，非推测）

    1) catalog(scope) 决定某 MCP 是否对某对话可见：
         if (offered.size === 0 || ctx.tools.get(this.name, scope) !== this.tool) return "";
       this.name = `mcp__<serverName>__load_tools`（该 MCP 的 loader 工具）

    2) loader 由 publish() 注册在【全局层】：
         publish(tools) { const unregister = this.ctx.tools.register(this.tool); ... }

    3) 因此对某个 agent 施加：
         agent.ctx.tools.restrict({ deny: ['mcp__<serverName>__load_tools'] })
       → 该对话看不到 loader → catalog 返回空串 → 该 MCP 目录从该系统提示消失。

  MCP 服务进程**不杀**、其他对话**不受影响**、切换**可逆**（restrict 返回 disposer）。

### ③ 宿主端新增
- `GET  /dsh-skill-browser/session-mcp?sessionId=xxx`
    返回该对话每个 MCP 的 `{id, serverName, enabled, loadedTools, live}`
- `POST /dsh-skill-browser/session-mcp/toggle`  body `{sessionId, serverId, enabled}`
- `GET  /dsh-skill-browser/session-mcp/servers`  本机全部 MCP 的 loader 工具名（排错用）
- 新增 `agent/disposed` 监听：会话销毁时释放其 restrict，避免泄漏。
- `inject` 补 `agents`（按 sessionId 取 live agent）。

### ④ 客户端新增
- MCP Tab 顶部新增「当前对话」区块：每个 MCP 一个胶囊按钮
    `● <serverName> 开/关  [已加载 N]`，点亮=该 MCP 对本对话可见。
- 当前对话 id 取法与主程序一致：`sessions.list.getSnapshot()` 里
  `retainedBy.mainView > 0` 的那一行（不取 URL、不取标题，避免 fork 同名误判）。
- 点击即时切换：乐观更新 → POST → 失败回滚并 toast。
- 非活跃对话给出「非活跃（需在该对话内操作）」提示。

### ⑤ 已知限制（内核明示，非本插件可绕过）
文档原文：「On-demand loading is outside tool restrictions」——**已加载的具体工具**
位于 agent 自己的 scope，`restrict` 无法过滤。因此「关闭」的准确语义是
「目录消失、模型不再得知该 MCP」；此前已加载的工具保留至该对话结束。

### ⑥ 生效方式
宿主端（lib/index.js 新路由 + inject 变更）与客户端（lib/client.js UI）均有改动：
**彻底退出 DSH 客户端再启动**；`Ctrl+Shift+R` 只能刷新客户端半边。

## 2.2.15 (2026-11-24) — MCP 批量启停：一键全关 / 全开 / 只留可用的

### ① 需求来源
MCP 工具定义会注入**每个对话**的上下文（注册在 `ctx.tools` 全局层，`scopeOf(ctx) ?? ctx.root`），
条目越多、工具越多，上下文占用越大。原先只能逐个点开关，10 个 MCP 要手点 10 次，且
「全部关闭」这种高频操作没有入口。

### ② 新增按钮（MCP Tab 工具栏右侧，分隔线之后）
- **⏻ 全部关闭 (N)** —— 一键停用全部 MCP，释放上下文。`N` = 当前启用中的数量，无启用项时按钮置灰。
- **⚡ 全部开启 (N)** —— 一键启用全部 MCP。`N` = 当前停用中的数量，无停用项时置灰。
- **◎ 只留可用的** —— 局部开启：只保留 `phase === "active"` 或 `toolCount > 0` 的条目，
  其余全部停用。用于「服务端路径已失效、连不上的那批」一次性清掉，避免反复重连刷日志。

### ③ 后端新路由
- `POST /mcp/enable-batch` / `POST /mcp/disable-batch`
  - body `{ all: true }` → 对全部 MCP 生效
  - body `{ ids: [...] }` → 只对列出的 id 生效（局部）
  - 响应 `{ ok, enable, total, okCount, failCount, results:[{id, ok, error}] }`
  - 全部成功 → 200；部分失败 → 207；整体异常 → 500
  - 实现：循环调用既有 `setMcpEnabled(ctx, id, want)`，不新增写入逻辑，风险与单点开关一致。

### ④ 客户端行为
- 变更前先过滤出**真正需要变更**的条目，已处于目标状态的跳过（避免无意义写文件 + 热重载）。
- 全部成功：toast「全部关闭成功（N 项）。若未生效请彻底重启 DSH。」
- 部分失败：toast 列出前 3 个失败项及原因（如「无法定位该 MCP 所在的 patch 文件」）。
- 完成后自动 `loadMcp(true)` 拉取最新运行时状态。

### ⑤ 生效方式
- 宿主改动（`lib/index.js` 新路由）+ 客户端改动（`lib/client.js` 按钮与逻辑）：
  **彻底退出 DSH 客户端再启动**（宿主无热重载；`Ctrl+Shift+R` 只刷新客户端，新路由不生效）。

### ⑥ 与「按对话开关」的关系
本版是**全局**批量开关，不区分会话。按对话隔离在机制上可行（`dsh-scope` 的
`createScope(ctx, agent)` + `scopeTarget(agent, agent)`，工具注册到 `agent.ctx` 即只对该对话可见），
但每个对话独立挂 MCP 意味着每个对话都要起一套服务端进程（本机 10 个 MCP，单个 ANSYS
服务端启动 15s 延迟 + 数秒握手），成本过高。更现实的路线是「服务端进程共享 + 工具清单按
对话过滤」，需要改 `mcp-client` 注册逻辑，未在本版实现。


## 2.2.14 (2026-11-18) — 治「重载后分组要缓冲一会」+「AI 分组 90s 还在转圈」

### ① 分组首帧缓存：重载后分组行与技能卡同时出现
- 用户实测：重载后技能卡秒显，但「分组」行要缓冲一会儿才显示整行（卡顿修复前的版本没有这个割裂感）。
- **根因**：2.2.10 的首帧缓存只缓存技能列表（`dsh-sb-skills-cache`），分组数据没缓存；且 `loadGroups` 挂在 `/skills` 成功之后、自身无重试 → 分组行要等「宿主就绪 + /skills 回包 + /groups 回包」第二次 paint 才出现。
- **改法**：