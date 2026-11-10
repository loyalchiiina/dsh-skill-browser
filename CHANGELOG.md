# Changelog

## 2.0.15 — 2026-11-10

### 变更
- **市场宣传图清单精简为 6 张并重排顺序**（`screenshots.json`，8 项 → 6 项）：
  - 顺序：`shot-11`（快速上手 + 皮肤选择器）→ `shot-06`（调用台账·统计）→ `shot-12`（**市场** Tab · MCP 市场）→ `shot-13`（**MCP 管理** Tab）→ `shot-05`（MCP 详情 + 信息面板）→ `shot-01`（技能浏览·网格）。
  - 依据上游与客户端实测：市场卡片**只取前 3 张**、详情页最多 **6 张**（客户端硬上限 `MAX_SCREENSHOTS = 6`），**第 7、8 位在 DSH 市场里永远不会显示** —— 8 项中有 2 项白占位置。`shot-09`、`shot-10` 两张弹窗图退出清单（**文件仍保留**，`README.md` 画廊 13 张不变）。

### 修复
- **三张旧图里露出的本机绝对路径与 Windows 用户名已打码**：`shot-09` / `shot-10` / `shot-11` 中的 `C:\Users\<用户名>\AppData\Roaming\npm\…`、`E:\fluent-mcp\.venv\Scripts\…`、`…\ansys-mcp\ansys\workbench\…` 等明文，已就地做马赛克覆盖（**只打码、不裁图、不改尺寸**：1210×859 / 1191×863 / 1265×885）。`shot-13` 底部露出的部署路径同批保留马赛克。
- 本版**无功能代码改动**：仅为带上「精简后的清单 + 打码后的图」重发 npm（npm 同一版本号不能重复发布，故版本号前进一版）。功能内容与 2.0.14 完全一致。

## 2.0.14 — 2026-11-10

### 变更
- **宣传图更新：补上「市场」与「MCP 管理」两张新界面图**。
  - 新增 `docs/images/shot-12.png`（**市场** Tab · MCP 市场：全部免费 · 显示 151 / 库 883 · 19 大类平铺分类带数量 · 列表视图 · 免费/需 Key/npm/需 env 标签 · 已装 ✓ 卸载 / 安装按钮 · 每条 MCP 用其自身真实图标）。
  - 新增 `docs/images/shot-13.png`（**MCP 管理** Tab：共 10 个 MCP · 已连接 8 个 · 191 个工具 · 树状/卡片切换 · 每行 3/4/5）。该图已对底部露出的本机部署路径做马赛克处理。
  - `screenshots.json` 由 6 项增至 **8 项**；`README.md` 效果图引用由 11 张增至 **13 张**。
  - 说明：原有 `shot-01` ~ `shot-11` 均保留（未删除）。它们摄于 v2.0.2 时期，Tab 栏只有四个、**没有「市场」**；如需与 2.0.14 界面完全对齐，可后续重拍覆盖同名文件，届时不必再改引用。
- 本版**无功能代码改动**：仅为带上新宣传图重发 npm（npm 同一版本号不能重复发布，故版本号前进一版）。功能内容与 2.0.13 完全一致。

## 2.0.13 — 2026-11-10

### 新增
- **所有「刷新」都有即时反馈**：之前点刷新没有任何提示，用户不知道刷没刷、刷了什么。现在四个 Tab 的刷新都会**先 toast「正在刷新 …」，完成后再 toast 结果**：
  - 右上角刷新钮：按当前 Tab 分别提示「正在刷新技能库 / 调用台账 / MCP 列表 / 市场目录」，完成后报「技能库已刷新：共 N 个技能」「调用台账已刷新：人工记录 N 条 · 自动调用 M 条」「MCP 已刷新：共 N 个 · 已连接 M 个」「市场目录已刷新：共 N 个 · 免费 M 个」。
  - 市场工具条的「⟳ 刷新」、MCP 工具条的「刷新」同款。
  - 失败时红 toast 报原因（如「刷新失败：…」）。
- 内部静默刷新（安装后自动重载、首载、切 Tab）**不弹提示**，只有用户主动点击才提示，避免噪音。

## 2.0.12 — 2026-11-10

### 修复
- **市场工具条切「网格/列表」时按钮跳动**：根因是「列 3/4/5/6」选择器只在网格模式渲染、列表模式消失，导致整行宽度变化、搜索框和按钮跟着重排。改为**网格/列表两种模式都固定渲染列选择器（同宽）**，列表模式下点「列 N」会**自动切回网格并应用该列数**；搜索框 `flex` 基准固定为 `180px`（`min/max-width` 不变），不再随存在与否拉伸。切换查看方式时整条工具条稳定不跳动。
- 顺带确认：列表模式下列选择器保留交互（点击生效）。

## 2.0.11 — 2026-11-10

### 修复
- **MCP Tab 卸载后切回市场仍显示「已装✓」（残留）**：市场「已装/未装」判定原依赖缓存的 `H.installed`（由 `refreshInstalledMap` 按 `serverName` 建），存在时序过期风险。现新增 `homeIsInstalled(name)` —— 判定时**实时遍历最新 `S.mcp.data.servers`**（按 `serverName` 匹配），只要运行时里已经没有该条，市场按钮立刻回到「安装」，不再信任可能过期的缓存；`S.mcp.data` 未就绪时才退回缓存键（尽力而为）。
- 连带保证：市场排」已装在前」的 `homeFiltered` 排序、卡片按钮（`homeActionHtml`）判定都改走 `homeIsInstalled`，与运行时完全一致。

## 2.0.10 — 2026-11-10

### 修复
- **市场安装 / 卸载后按钮不即时刷新**：`doHomeInstall` / `doHomeUninstall` 成功回调里增删 `H.installed` 后没有立即 `paintHome()`，只靠 `setTimeout(loadHome, 800)`，而 60s 缓存会提前 return —— 现在立即重绘，并用 `mcpPollUntil` 轮询到该条目在运行时真正出现/消失后再重建已装集合并重绘（消除 loadMcp 的 refreshInstalledMap 在热重载未完成时把刚加条目冲掉的竞态）。
- **MCP Tab 卸载后切回市场「已装」不同步**：`runMcpUninstall` 成功回调现在轮询到条目从运行时消失后 `refreshInstalledMap()` + `paintHome()`。
- **MCP Tab 启用后市场「已装」不自动刷新**：`doMcpToggle` 的轮询收敛回调里补上 `refreshInstalledMap()` + `paintHome()`（enable 的条目进 installed、disable 的移出）。
- **每次切进市场都先用最新 MCP 运行时重建已装集合**：`paint()` 的 `isHome` 分支在处理前先 `refreshInstalledMap()`，保证 MCP Tab 里任何增删启停在切回市场时立刻反映。

## 2.0.9 — 2026-11-10

### 修复
- **市场页永远没有滚动条（重启多少次都一样）**：根因是 `buildPanel()` 里 `#dsb-home-bar` / `#dsb-home-cats` / `#dsb-home-cards` 三个子容器**只写了 id、没有写 class**，而全部样式规则用的是**类选择器** `.dsb-home-bar` / `.dsb-home-cats` / `.dsb-home-cards`。于是 `flex:1` / `min-height:0` / `overflow-y:auto` 一条都没生效，卡片区高度不受约束、永不溢出、永不出现滚动条。已给三个容器补上对应 class，滚动链（`#dsh-skill-browser-panel` 定高 → `#dsb-built` flex:1 → `#dsb-home` flex:1/min-height:0 → `.dsb-home-cards` flex:1/min-height:0/overflow-y:auto）这才真正接通。
- **分类数量与列表条数对不上**：分类 chip 的数量改为**跟随当前「仅免费 / 全部」筛选实时重算**（用 `H.data` 在前端统计），保证「chip 上的数字 = 点进去实际看到的卡片数」；当前筛选下没有条目的分类直接隐藏，不再出现「chip 写着 N 却一张卡都没有」。
- **顶部统计口径含混（「共 882 个」vs「全部 151」）**：改为 `显示 151 / 库 882 · 免费 151 · 已装 10`，一眼能看出当前筛选显示多少、库内总量多少。

### 变更
- **「列 3/4/5/6」+「刷新」收进右侧组**：新增 `.dsb-home-rgroup{margin-left:auto;display:flex;flex-wrap:nowrap}`，两者固定在工具条同一行的最右端，不再折到第二行左侧。

## 2.0.8 — 2026-11-10

### 变更
- **市场分类 chip 标注该分类的 MCP 数量**：与技能页分类数量一致，每个分类名后用灰色小字显示 Registry 里该分类的真实条数（如「全部 882 / 文件系统 11 / 代码仓库 9」），数量来自后端 `buildCategories` 的 `count`。
- **市场页标题图标改为 ◈ 六边形**：从 🧩（拼图）改为空心六边形，更简洁高级，契合「生态 / 聚合」语义。
- **市场卡片名称放大加粗**：`.dsb-home-card .dsb-card-name` 字号 11px → 13.5px、`font-weight:700`，仅作用市场卡（技能页同名类不受影响）；版本徽章（`.dsb-ver` / `.dsb-ver-none`）保持 10.5px 常规字重以区分层级。

### 修复
- **列表模式「只显示 3 张、无滚动条」排查**：诊断确认磁盘代码（`paintHomeCards` 列表/网格共用 `homeFiltered()` 全量 forEach、无截断；`#dsb-home`/`.dsb-home-cards` flex 滚动链完好）并无缺陷，现象来自加载了旧 client bundle，需彻底重启 DSH 而非软刷新。

## 2.0.7 — 2026-11-10

### 修复
- **市场卡片与技能卡不统一**：市场卡原本用自成一派的 `.dsb-home-badge` / `.dsb-home-ver` / `.dsb-home-tags`，「列表」模式还是整行横排的 `.dsb-home-row`，与技能浏览的卡片观感差得很远。现改为**逐字复刻技能卡**：同一套 `.dsb-card` / `.dsb-card-name` / `.dsb-card-zh` / `.dsb-card-tag` / `.dsb-card-mtime` / `.dsb-card-foot` / `.dsb-card-gtag` / `.dsb-ver` / `.dsb-badge-off`，同样的字体、字号、圆角、hover 与行数截断；列数切到 1 时就是技能卡的竖排列表。
- **市场卡把图标 URL 当文本渲染**：`esc(s.icon || "")` 直接把 registry 的 `icons[].src` 当字符串打进 `.dsb-card-name`，界面上因此出现一长串 `https://…/favicon.svg` 字面文本。改为按图标类型渲染：URL → `<img>`，否则当 emoji。
- **市场按钮样式与技能卡不一致**：安装 / 卸载按钮原为自建 `.dsb-home-btn`，现统一复用技能卡的 `.dsb-movebtn`（同款边框、圆角、字号），仅「卸载」额外加红调。
- **`.dsb-card-zh` 被市场样式全局覆盖成 3 行**：该规则是全局选择器，会连带把技能卡描述行数从 2 行改成 3 行。已移除该覆盖，两处卡片统一 2 行截断。

### 新增
- **MCP 各用自己的真实图标**：新增 `homeIcoUrl()` / `homeIco()`，按优先级取图标 —— ① registry 自己登记的 `icons[].src`（官方 logo）② 其 GitHub 属主头像 `https://github.com/<owner>.png` ③ 其主页站点的 favicon（`icons.duckduckgo.com/ip3/<host>.ico`）④ 分类 emoji 兜底。`<img loading="lazy">` 懒加载，`onerror` 自动降级为分类 emoji，绝不再统一塞一个 🧩。
- **精选条目支持自带 `icon` 字段**：`market-curated.json` 的条目可填真实 logo URL，`curatedToEntry()` 会原样透传给前端（留空则由上面第 ②③ 级回退推断）。

## 2.0.6 — 2026-11-10

### 新增
- **「市场」Tab = MCP 市场（第 5 个 Tab，位置在快速上手之后）**：数据源两条 —— ① 官方 MCP Registry（`https://registry.modelcontextprotocol.io/v0/servers`，分页 `limit=100`，去重后约 600+ 个 server）；② 本地精选免费目录 `lib/market-curated.json`（29 条，npm 24 / pypi 5，全部包名已实盘验证存在），精选优先并去重。
- **19 大类分类 + 树状/平铺双视图**：文件系统 / 数据库 / 开发工具 / 网页与搜索 / 浏览器自动化 / 代码仓库 / 文档与办公 / 云服务与部署 / 通信与邮件 / 图像与多媒体 / 知识与记忆 / 任务与自动化 / AI 与智能体 / 金融与交易 / 地理与地图 / 教育与学习 / 运维与监控 / 安全与身份 / 其他。
- **卡片排布仿技能卡**：网格 / 列表双模式；列数 3~6 可选（`localStorage` 键 `dsb-home-cols`）；搜索框 300ms 节流；「仅免费 / 全部」范围筛选（默认仅免费）；已装条目标「已装 ✓」。
- **一键安装**：点「安装」→ 需要环境变量（needsKey / envRequired）时先弹层填 Key → 后端把条目写进当前 profile 的 `cordis.patch.yml` 的 `- insert:` 块（写前自动备份到 `~/.dsh/backups/`）→ DSH 补丁层热重载生效。Windows 下 npm 包用 `node.exe + npx-cli.js` 启动（stdio 走 spawn 不经 shell，直接写 `npx` 会失败），pypi 包用 `uvx`，可执行文件路径运行时探测。
- **一键卸载**：复用既有 `uninstallMcp`，缩进感知删除整条条目 + 清空壳 `- insert:` + 从受管块移除同名覆盖 + 写前备份。
- **市场数据磁盘缓存**：`~/.dsh/data/dsh-skill-browser/market.json`，24 小时有效；网络失败降级用旧缓存并标 `stale`，无缓存时只显示精选目录。
- **免费口径**：npm / pypi 本地可运行包 = 免费可装；只有远程 HTTP 的标「远程·需自备 Key」，不可直接安装。
- **滚动位置记忆覆盖「市场」Tab**：关闭面板再打开回到原处。

### 修复
- **宿主热重载静默失败（新路由持续 404）**：`lib/market.js` 静态 `import { dataDir } from "./mcp.js"` 而 `mcp.js` 未导出 `dataDir`，Node ESM 链接期抛 `SyntaxError`，补丁层热重载因此静默失败（`LIVE.gen` 不递增、新路由 404）。已给 `mcp.js` 的 `dataDir` 加 `export`，并让 `market.js` 改为带 `RELOAD_V` 版本查询串的动态 import，避免命中启动时缓存的旧 `mcp.js` 模块实例。
- **「市场」Tab 永久卡「加载中…」**：`paintHome()` 在数据未就绪时直接 `homeEl.innerHTML = ...` 整体覆写 `#dsb-home`，把 `#dsb-home-bar/cats/cards` 三个子容器销毁；数据到达后 `paintHomeBar/Cats/Cards` 全部因容器不存在静默早退、无法绘制。改为新增固定状态容器 `#dsb-home-state`：加载/错误/空态只写该容器、仅切换三个子容器的 `display`，**绝不整体覆写 `#dsb-home`**；并给三个 paint 函数的 `if(!el) return` 早退补一次性 `console.warn`，防止同类静默早退再次瞒过排查。

### 说明
- 精选目录 `lib/market-curated.json` 的包名逐条对 npm registry / pypi 探测验证；首版曾收录 17 个 npm 上已不存在的 `@modelcontextprotocol/server-*` 套件，已剔除或改用 Python 版（`mcp-server-fetch` / `mcp-server-git` / `mcp-server-sqlite` / `mcp-server-time`）。

## 2.0.5 — 2026-11-10

### 变更
- **卡片每行列数改为「起步—封顶」区间**：技能列表「每行」只保留 **3 / 4 / 5 / 6**，MCP 卡片只保留 **3 / 4 / 5**（用户要求 3 起步、技能 6 封顶、MCP 5 封顶）。原来的「自」（自适应 `auto-fill`）和 2 列已移除 —— 自适应在宽屏下会摊成十几列，卡片被压得只剩标题，2 列又太浪费横向空间。
- 两端默认值统一为 **3 列**（`S.cardCols` 与 `M.cols` 的默认值由 `0` 改为 `3`），旧 `localStorage` 里的 `"auto"` / `0` / `2` 会被初始化逻辑判为越界并归一到 3，不会渲染成空白列或半边空白。
- **写入端与读取端同口径**：点击列数按钮时不再用 `parseInt(...) || 0` 兜底，改为与初始化一致的白名单校验（技能 3~6、MCP 3~5），异常值直接落 3。这样即使 DOM 属性被外部改坏，也不会落库成 `0` 从而退回 `auto-fill` 自适应（宽屏下卡片被摊成十几列）。
- 引导页第 ③ 步里的「每行 N 列（自适应 / 2~6）」同步改为「（3~6）」，避免图文与实际不符。

## 2.0.4 — 2026-11-10

### 修复
- **点停用 / 重连后列表跳回最上方**：`paintMcpNow()` 用 `host.innerHTML` 整体重建，`.dsb-mcp-grid` / `.dsb-mcp-tree` 被销毁重建，滚动条随之归零；而启停后的收敛轮询会连着重绘十几次，用户看到的就是「一点开关就跳回顶部，还得重新往下滚」。现在重绘前记录滚动容器的 `scrollTop`、重绘后写回；轮询也只在「启停 / 阶段 / 工具数」这类可见状态真的变化时才重绘（`mcpDataSig` 快照比对），不再每 700ms 闪一次。
- **404 `unknown path` 直接甩给用户**：宿主端插件未重载时新加的路由注定 404。现在识别到该错误就翻译成「宿主端插件还是旧代码，请点 ⚡ 热重载或彻底重启 DSH 后重试」，启停 / 重连 / 卸载 / 清空统计四处统一走 `mcpFailToast`。
- **MCP 卡片按钮不齐（不管几列都该对齐）**：`.dsb-mcp-acts` 原来是 `margin-top:2px`，按钮紧跟在上方内容后面，卡片内容长短不同就导致同一行里按钮的纵向高度、横向起点各不相同。改成与技能卡 `.dsb-card-foot` 同一套口径 —— `margin-top:auto` 贴卡片底部（同一行卡片等高，所以纵向对齐）、`padding-top:8px`、`justify-content:space-between` 铺满整行（同行卡片宽度相同，所以逐列横向对齐），列数变化不影响对齐。
- **分组栏滚动位置不记忆**：`#dsb-groups` 是 `max-height:220px;overflow-y:auto` 的独立滚动容器，任何 `paint()` 都会重建它，此前既没保位也没纳入滚动记忆。现在重建前存 `scrollTop`、重建后写回，并单独用 `groups` 键存取（不再与技能卡列表共用 `skills` 键），滚动监听也改成每个容器各自节流。

### 新增
- **面板记住上次滚动位置**：关闭面板时把当前视图（技能 / 台账 / 快速上手 / MCP）的滚动位置写入 `localStorage`（键 `dsb-scroll-v1`），再次打开自动回到原处，不必每次从上往下翻。技能卡、台账、快速上手各用自己的滚动容器，MCP 取当前 grid / tree 容器，分组栏单独用 `groups` 键；异步内容还没渲染出高度时保留 pending，等下一次重绘或定时器再落位，不会把位置夹成 0。

## 2.0.3 — 2026-11-10

### 修复
- **停用 / 启用 MCP 后滑块不动（必须刷新页面才移动）**：原实现是「写盘 → 等 900ms → 单次 refetch」。但链路是「写盘 → DSH 用户补丁层热重载 → loader entry 状态变化」，MCP 子进程卸载普遍慢于 900ms，refetch 读回的还是旧状态，重绘后滑块弹回原位，之后不再有任何请求，只能手刷页面。
  现在改成三步：① **乐观更新**——点击后滑块立即跟随，不等网络往返；② **轮询收敛**——成功后每 700ms 重读一次运行时状态（上限 12 次 ≈ 8.4s），一旦 `disabled` 与目标一致立即停；③ **超时明示**——8.4s 仍未同步时弹提示「配置已写入，但热重载未完成，稍后点刷新或彻底重启 DSH」，不再静默弹回。失败自动回滚并恢复原状态。重连同样改为轮询到 `phase` 离开 `loading/pending`。

### 新增
- **MCP 卸载（卡片 / 树状按钮区「导出」右侧）**：二次确认后把该条 MCP 从 profile 补丁文件里**真正删掉**（不是禁用）。宿主侧 `uninstallMcp()` 做缩进感知的文本级删除：条目既可能顶级 `- id: xxx`，也可能挂在 `- insert:` 下（4 空格缩进），一律按「从 `- id:` 行起吞掉更深缩进的内容行」定位；有三种连带物一并处理——① 条目上方专属注释（注释里出现该 id / 去掉 `mcp-` 前缀的主体才认领，避免误删通用注释）；② 父级 `- insert:` 删完若只剩空壳（无兄弟条目、无其它内容）连父级行一起删，否则 YAML 留下 `insert: null` 会让 loader 报错；③ 受管覆盖块里残留的同 id `disabled` 覆盖一并清掉，不留死引用。写盘前自动备份到 `~/.dsh/backups/`，前端乐观移除条目，失败自动塞回列表。
  新增路由 `POST /dsh-skill-browser/mcp/uninstall`。内置层 / npm 包自带的条目无法用文件覆盖删除，弹层里会明确提示改用「停用」。

### 校验
- 在真实 `cordis.patch.yml`（5468 行 / 446 个 loader 条目`副本`上演练：删除 `mcp-ansys-fluent` 与 `mcp-ansys-workbench` → 各删 25 / 22 行，父级 `insert:` 与专属注释一并清掉，其余 4 个官方 MCP 条目与全部中文注释完好；js-yaml 解析通过（顶层 40 → 38 项，**无 `insert: null` 空壳**）；重复删除同一 id 幂等返回 `removed:false`；受管块 3 个 id → 2 个。

## 2.0.2 — 2026-11-08

### 文档 / 截图
- **README 功能描述重写**：一句话简介加入 MCP 管理 / AI 分组缓存与计时；「三个 Tab」→「四个 Tab」并补 MCP 行；新增「🔌 MCP 管理」章节（真实配置 / 状态 / 工具 / 统计 / 启停 / 重连 / 导出 / 本机扫描 / AI 修复）。
- **效果图全面替换**：删除旧 `docs/images/panel-browse.png`、`panel-ledger.png`，改为 11 张新截图 `docs/images/shot-01.png … shot-11.png`。
- **插件内「快速上手」7 步 → 8 步**：补 MCP 管理、全部展开/收起、每行 N 列、AI 分组缓存与计时、「清除缓存并重新生成」。
- **`locale/zh.json` / `locale/en.json` 描述补齐**：MCP 扫描、AI 修复、AI 分组结果缓存与计时浮窗。

## 2.0.1 — 2026-11-08

### 修复
- **npm 包体积修正**：`files` 白名单里的 `"lib"` 整目录会把 `lib/` 下 40 个 `client.js.bak-*` 历史备份一并打进包（包体积 3.7MB）。移除该条目，改为只收 `lib/**/*.js` / `lib/**/*.ps1` / `lib/orb/*.html`，包降到 ~806KB / 39 个文件。功能无变化。

## 2.0.0 — 2026-11-07

### 新增：MCP 管理（面板第 4 个 Tab，位于「调用台账」与「快速上手」之间）
- **读取正在使用的 MCP 配置**：枚举运行时 `ctx.loader` 里每一个 `@deepseek-ai/dsh-mcp-client` 条目，返回真实合并后的配置（serverName / transport / command / args / cwd / url / env 键名），不是读文件猜测。`GET /dsh-skill-browser/mcp/servers`，页面右上「刷新」按钮即时重读。
- **真实状态**：直接读 Cordis FiberState（pending / loading / active / failed），叠加 `disabled` 与已注册工具数，不再靠日志推断。
- **工具清单与自动功能概括**：按 `mcp__<serverName>__` 前缀从工具注册表取每个 MCP 的工具与描述；按工具名/描述里的动词关键词自动归类（查询 / 执行 / 写入配置 / 删除停止 / 导出 / 文件 / 会话），生成「N 个工具，主要提供…能力」的概括。
- **调用统计（落盘累计）**：监听官方 `tools/result` 事件，按 `mcp__<server>` 归类写入 `~/.dsh/data/dsh-skill-browser/mcp-calls.jsonl`（3MB 自动压实为最近 3000 条）。卡片显示累计/失败次数与最近调用时间，详情内显示工具调用排行与近 24 小时计数。提供「清空统计」。
- **启停 / 重连**：停用/启用会写入 profile `cordis.patch.yml` 末尾一个带 `BEGIN/END` 标记的**受管覆盖块**（纯文本追加，幂等）；**不改写整份 YAML、不丢失任何中文注释**（`loader.update` 走 `yaml.dump` 会重写整文件并抹掉 3449 行注释，已排除）。DSH 用户补丁层支持 HMR，改完热应用、重启同样保留。重连走 Cordis Fiber 的内存重启（`fiber.update(config,true)`），不碰文件。
- **导出**：反解为 Claude Desktop / Cursor 同构的 `mcpServers` JSON，一键复制；可选打码敏感环境变量。`GET /mcp/export?mask=0|1`。

### 实现要点
- 新增宿主子模块 `lib/mcp.js`（走 `RELOAD_V` 热加载，与 scan/groups 一致）；`lib/index.js` 增加 MCP 统计监听与 `/mcp/*` 七条路由；`lib/client.js` 增加第 4 个 Tab、卡片网格、状态胶囊、详情、导出弹层与事件委托。
- 统计与主数据**分开请求**（`Promise.all`），统计失败不清空服务器列表。
- 启停前自动备份 `cordis.patch.yml` 到 `~/.dsh/backups/`（保留最近 20 份）。

### 追加（同日）：AI 分组提速 / 缓存 / 计时 + MCP 扫描与 AI 修复
- **AI 分组提速**：补漏调用仅在遗漏 > 20 个技能时才执行；`reasoningEffort` 可压到 low（provider 不支持时自动去掉该参数并重试，实测 magpie 报 `UNSUPPORTED_REASONING_EFFORT` 已自愈）；超时放宽到 150s；模型流 abort 时自动重试一次。
- **结果缓存**：按「技能目录集 + mode」指纹缓存 24 小时，命中直接复用、秒回不调模型；设置面板与分组方案弹层均可一键清除缓存。
- **计时可视化**：分组进行中面板浮窗显示「已用 Xs ／ 预计约 40s」+ 进度条；完成后方案弹层显示累计用时；分组工具栏常驻「上次分组 X.Xs · 并行N批 / 串行」或「缓存 0.0s」，写入 localStorage，折叠 / 切走对话 / 重开面板均保留。
- **AI 分组只读铁律（代码级约束）**：模型输入只允许元数据白名单（目录名 + 中文名 / frontmatter description 前 60 字 + 现分类），**绝不读取 SKILL.md 正文**，**绝不修改 / 移动 / 重命名 / 删除任何技能文件**；含行长断言兜底，超长即拒绝。
- **并行分批**：技能数 ≥ 45 时最多 4 批并行分类，结果按同名大类归并去重；任一批失败自动回退串行单次（`PARALLEL_CLASSIFY` 单点开关可关）。
- **MCP「🔍 本机 MCP」**：扫描 DSH 已配置的 MCP + 各 profile / 本地插件 / 全局 npm 目录里所有含 mcp 的包，列出「已配置 / 已装未配置」清单（只读）。接口 `GET /mcp/local-scan`。
- **MCP「🛠 AI 修复」**：诊断异常 MCP（启动失败 / 调用失败 / 已停用），规则 + AI 给出修复动作（reconnect / enable / disable / clean），确认后执行；写配置前自动备份。接口 `GET /mcp/ai-diagnose`、`POST /mcp/ai-fix/apply`。
- **修复「新建分组 / 重命名 / 新建子类」点不动**：Electron 不支持 `window.prompt`（静默返回空），改为面板内输入弹层（回车确认 / Esc 取消）。
- **技能卡片开关对齐**：卡片等高 + 底部操作区 `margin-top:auto` 贴底，同一行内各卡开关滑块落在同一水平线。

### 已知边界（本轮未做）
- 「粘贴 JSON 一键导入」属 P2，暂未实现（导出已有，导入需写 insert 块，风险面更大，另行提交）。
- 未提供新增/编辑/删除 MCP 的表单（需精确改写 109KB 补丁文件，误操作可致 DSH 起不来，暂不提供）。
- 若某 MCP 来自内置层（不在用户 profile 补丁里），启停会返回「无法用文件覆盖」而不是冒险改内置层。

## 1.9.11 — 2026-10-29

### 面板 UI 精修 + 效果图替换 + README 重写
- **README 以真实功能重写（中文为主）**：三 Tab（技能浏览 / 调用台账 / 快速上手）、分组管理、调用台账看板、130 款皮肤、7 步快速上手、悬浮球导航分区。
- **效果图替换**：新增 `docs/images/panel-browse.png`（技能浏览）与 `docs/images/panel-ledger.png`（调用台账），删除旧图 `skill-browser-panel.png`。
- **悬浮球导航分区**（DSH 设置页）：显隐开关 / 皮肤下拉 / 回到右下角 / 作者插件 12 款；皮肤菜单改为 6 列；图标统一为黑白线性。
- `package.json` 版本 1.9.10 → 1.9.11，description 与 UI 对齐。

## 1.9.10 — 2026-10-25

### 修复
- **品牌渐变底文字对比度按「最差端点」判色**：原来用渐变中点算白字对比度，但 `linear-gradient` 实际铺满 g1..g2 整条 ramp，浅色皮肤（04 全息幻彩 / 051 / 113–127 等）的中点达标而浅端只有 3.7–4.4:1。现改为 `worst(ink, g1, g2) = min(cr(ink,g1), cr(ink,g2))`，两个端点都 ≥4.6:1 才用白字，否则翻成近黑或按 0.05 步长压深整条渐变。**128 皮肤 × 两端点 = 256 项全部 ≥4.5:1。**

### 文档（与实装功能对齐）
- **`locale/zh.json` / `locale/en.json` 的 `meta.description` 重写**：原描述只写到「一级/二级分类 + 启停 + 失效台账」，完全没提 v1.9.0 之后新增的自定义分组、树状/平铺、版本号徽章、调用台账看板、⚡ 热重载、全皮肤自适应配色 —— 与实装功能严重不符。现按真实功能重写。
- **`README.md`（主 README，英文为主）补全 v1.9.0–v1.9.9 全部功能**：新增「自定义分组」「树状 / 平铺双模式」「版本号徽章」「调用台账看板」「热重载」「性能」「全皮肤自适应配色」七节中文说明 + 对应 4 条英文 Highlights；API 表补 `/rev`、`/reload`、`/groups`（含 11 个 action）、`/ledger/stats`（含 `gran`/`sort` 参数），`/skills` 注明返回 `version` 字段。原来 API 表完全没有分组、统计、热重载这三组接口。
- **`README-zh.md` 数字口径修正**：AI 分组的大类数公式写的是「技能数 ÷ 8，6~18 组、单组上限 12 个」，而 `lib/groups.js` 实际是 `Math.max(3, Math.min(16, Math.ceil(list.length / 12)))`（技能数 ÷ 12、3~16 个）且 `addSub()` 按 10 个切片、`CLASSIFY_SYSTEM` 要求「每个子类最多 10 个技能」。三处已全部改成 10 / ÷12 / 3~16，第三遍兜底拆组的「超过 12 个」也改为「超过 10 个」。
- **`package.json` `description` 从「逐版本罗列」改为一份统一功能描述**：原来是把 v1.9.0→v1.9.10 每个版本的新增点串起来，越写越长、且和市场卡片/README 口径各不相同。现在 `package.json` description、`locale/zh.json` `meta.description`、`locale/en.json` `meta.description`、五语言 README 首段**全部指向同一份口径**（含「分组只改视图不动技能文件」「无版本显示暂未编版本号」两条容易被误解的点）。npm 市场的卡片描述取自 `package.json` description，插件管理器/设置页的描述取自 `locale/*.json` 的 `meta`，两边现在一字不差。
- **`README-es.md` / `README-pt.md` / `README-hi.md` 首段补齐**：原来这三份只有一个 8 行的空壳（只有标题 + 一句旧描述 + 一个跳转链接），连分组、版本号、台账看板、热重载、皮肤自适应都没提。现在各自有一段完整的本地语言功能描述，标题统一为 `Skill Browser`。

### 校验
- **`scripts/audit-contrast.mjs`（新写，随包发布，唯一权威口径）**：128 皮肤 × 18 组前景/背景组合 = **2304 项，0 项不达标**。与旧临时脚本的差别：
  - 语义变量直接从真实调用链取 —— 切皮肤后读 `<style id="dsb-skin-style">` 的 `textContent`，不另存一份「期望值」，杜绝审计与实现各算一套的假绿。
  - 背景一律取**实际叠层色**：`card = chipBg over panel`、`surface = --dsb-surface`（吸顶表头不透明底实算值）。
  - 渐变底按**两个端点分别校验**：品牌渐变 `--dsb-onbrand-bg1/2`、分组大类行 `--dsb-tile1/2`（叠 `--dsb-shade` 后）。只测中点会漏掉浅端。
  - 踩过的坑写进脚本注释：DOM stub 的 `localStorage` 必须可读写，否则 `SKIN.setSkin(id)` 记不住，128 款皮肤全按 01 号深色皮肤算 → 20 款浅色皮肤集体假报不达标（首轮就误报 200 项）。
- `audit_onbrand.mjs`：128 皮肤逐款取 `--dsb-onbrand-bg1/2` 与 `--dsb-onbrand`，两端点对比度 **0 项 < 4.5:1**。
- `doc_audit2.mjs` / `doc_audit3.mjs` / `route_audit.mjs`：README-zh 16 项功能词全覆盖；README.md 10 项新功能词 + 4 个新路由全在位；实装 17 条路由与文档逐一对应。
- `scripts/check-bom.mjs`：37 个文本文件 **0 BOM**。

> **口径统一**：此前各版本 CHANGELOG 出现过 `14 组 1792 项`、`17 组 2176 项` 两种数字，那是各阶段临时脚本的覆盖范围（未含吸顶表头底、未拆渐变端点）。自 v1.9.10 起以 `scripts/audit-contrast.mjs` 的 **18 组 2304 项**为准，README-zh / README.md / package.json 描述均已对齐该数字。

## 1.9.9 — 2026-10-25

### 新增
- **零配置 AI 模型自动发现（四段式）**：别人装完插件不用填任何配置，AI 分组/封面就能用。
  1. 插件配置里显式写了 `provider` + `model` → 直接用（`source: config`）
  2. 当前对话会话绑定的模型 → `source: agent-session`
  3. DSH 设置里的默认模型 `agentDefaultModel.currentSelection()` → `source: dsh-default`
  4. 兜底扫描宿主可用模型目录，取第一个 → `source: llm-catalog`
- **模型探针徽标**：分组工具条右侧常驻一个小徽标，一眼看出「AI 分组将使用：xxx（DSH 默认模型）」，点一下可重新探测。探测只读配置、**不触发任何模型调用**、不写 `groups.json`。宿主没提供 llm 服务或没选默认模型时，徽标直接变红并给出可操作提示，不用等真分组失败才发现。

### 修复
- **全皮肤小字可见性（第三次加固）**：
  - `.dsb-gn` 数字徽标原来写死近白色 `--dsb-oncard-dim`，但它同时出现在工具条（面板底）、激活渐变按钮、大类行（深底）三种背景上 → 浅色皮肤下白字白底看不见。改为 **继承父级文字色**，三种背景各自正确。
  - 基础 CSS 里所有 `var(--itm, …)` 文本色统一换成 `var(--dsb-dim, …)`（共 24 处）——皮肤自带的 `--itm` 在 28 款手调皮肤上对面板只有 3.0–4.0:1，达不到 10–11px 小字的 WCAG AA。
  - 品牌渐变底（激活 chip / tab / 排序按钮 / 快捷区间 / 新建分组 / 子类选中）新增**安全渐变对** `--dsb-onbrand-bg1/2`：按「白字 ≥4.6:1」反解，浅色皮肤的淡渐变自动压深；8 款原本 3.03–3.5:1 的皮肤全部达标。
  - `--dsb-ok` / `--dsb-fail` / `--dsb-warn` 作为 10–11px 文本时，按卡片底重新走一遍 4.8:1 阶梯（6 款浅色皮肤原本落在 4.35–4.50）。

### 校验
- 128 皮肤 × 17 组前景/背景组合 = **2176 项，0 项不达标**
- 语义色小字专项：1024 项，**0 项 < 4.5:1**
- 十一套回归全绿：DOM 78 / 热重载按钮 10 / 关键词 17 / 吸顶表头 24 / host 分组 36 / host 热重载 29 / 关键词 host 15 / 模型探针 11（均 0 FAIL）

## 1.9.8 — 2026-10-25

### 新增
- **分组栏树状 / 平铺双模式**：工具条新增「🌳 树状」「▦ 平铺」切换按钮，选择持久化到 `localStorage.dsh-skill-browser-gmode`。
  - **树状（默认）**：每个大类独占一整行，子类**常驻**缩进挂在该行下方，用 `├─` / `└─` 树枝连接符 + 竖引导线画出真正的层级，一眼看出「Fluent 下面有 画网格 / 后处理 / SpaceClaim 几何操作 …」。不用先点大类才看得见子类。
  - **平铺**：v1.9.3 原样（大类排成卡片，点开才显示子类栏），保留给习惯旧视图的用户。
- 分组栏顶部改为统一工具条 `dsb-gbar`：分组标题 · 全部 · 未分组 · 🌳树状 · ▦平铺 · ⚡关键词分组 · 🤖AI自动分组 · ＋新建。
- 大类行右侧显示「N 项 · N 子类」，鼠标悬停浮出 🎨封面 / ＋新建子类 / ✏️重命名 / 🗑删除 四个操作。

### 修复
- **「大类下面子类显示不清、零零散散挨着太乱」**：v1.9.3~v1.9.7 的子类行是 `flex-wrap` 横向小胶囊，和大类卡片视觉上分不开。现改为竖排逐行 + 树枝连接符，层级关系一眼可见。

### 变更
- 文案键新增 `groupModeTree` / `groupModeFlat` / `groupModeTreeTip` / `groupModeFlatTip`。
- 新增 CSS：`.dsb-gbar` / `.dsb-gsp` / `.dsb-gtree` / `.dsb-gitem` / `.dsb-grow`（大类整宽行）/ `.dsb-gico` / `.dsb-grname` / `.dsb-grmeta` / `.dsb-grops` / `.dsb-gsubrow` / `.dsb-gline` / `.dsb-gline-last` / `.dsb-gconn` / `.dsb-gsub` / `.dsb-gsub-on`；平铺模式类 `.dsb-gflat` / `.dsb-gcard` / `.dsb-gcard-dom` 全部保留。
- 分组栏容器 `max-height` 提到 `220px` 并可滚动，分组多时不再挤压技能列表。

## 1.9.7 — 2026-10-25

### 新增
- **关键词快速分组（⚡）**：分组栏新增「⚡ 关键词分组」按钮，纯本地正则规则直接产出「大类 → 子类」两级方案，**零 token、毫秒级（实测 111 个技能 1~2ms）、结果完全确定**，与 AI 分组共用同一个方案确认弹层和落盘路径（先出方案 → 选「替换」或「追加」才写入 `groups.json`）。
- 新模块 `lib/keyword-groups.js`：`keywordClassify(skills)` 返回 `{ok, plan:{domains}, stats, mode:"keyword", unmatched}`；另有 `keywordDomains()` / `keywordRules()` / `KEYWORD_MAX_SUB` 供自检与展示。
- 新接口 `POST /dsh-skill-browser/groups` 的 `action: "kw-classify"`（只出方案不落盘，与 `ai-classify` 同形）。

### 修复
- **AI 分组「太满」**：单子类技能数硬上限 `MAX_SUB = 8`，超过自动拆成「名称 1」「名称 2」…，保证一屏装得下。
- 关键词分组对模型未命中/漏掉的技能走 `unmatched` 兜底并归入「其他技能」，**实测 111/111 全覆盖、无重复归属**。

### 变更
- 文案键新增 `groupKw`（「⚡ 关键词分组」）、`groupKwTip`（「本地关键词规则直接分组：零 token、毫秒级、结果固定」）、`groupPlanTitleKw`（「关键词分组方案」）。
- `lib/client.js` 的 `kwClassifyFlow()` 与 `aiClassifyFlow()` 并列，共用 `openPlanMenu()` / `applyPlanFlow()`；`S.gplanMode` 区分 `"keyword"` / `"ai"` 只影响弹层标题。

## 1.9.6 — 2026-10-25

### 修复
- **详情页被吸顶表头穿透**：点技能看全文 / 点台账看失败明细时，排行榜的吸顶表头（`z-index:3`）会浮在详情层（`z-index:2`）之上，正文里横插一条「# 技能 / 版本 / 调用 …」的表格头，干扰阅读。详情层提到 `z-index:20`，彻底压住吸顶表头。

### 性能（不卡顿 / 少内存）
- **技能卡片分片渲染**：列表一次只渲染 60 张卡，滚动到底自动追加 60 张，也可点「加载更多（还有 N 条）」。切换分类/搜索/排序/分组时自动重置回 60。原来 130+ 技能是一次性拼几千个 DOM 节点。
- **原始流水分片渲染**：自动登记流水一次只渲染 120 行，点「加载更多」追加 120 行。原来 1000+ 行全量拼串。
- **重渲染保留滚动位置**：追加卡片时记住 `scrollTop`，不会跳回顶部。
- **jsonl 增量读取**：`lib/ledger-writer.js` 新增 `autoLogStat()`（只 stat 取 size+mtime）与 `readAutoLogTail(root, n, skill?)`（从文件尾部按行切齐读，不读全文）。`/ledger` 的「最近 30 条」改用尾部读，不再为 30 条记录读整个 986+ 行 jsonl。
- **统计缓存加 stat 探针**：`/ledger/stats` 的缓存键并入 jsonl 的 size+mtime —— 文件没变时切粒度/改排序都直接命中，且同一份 jsonl 只解析一次（原来换任何参数都要重读重解析全量）。
- **单技能明细分页**：`/ledger-detail` 默认只回最近 200 条（`&limit=` 可调），并额外返回 `autoTotal`；前端显示「共 N 条（仅显示最近 M 条）」。原来单技能上千条一次性塞给前端。

### 新增
- 文案键 `cardMore`（「加载更多（还有 {n} 条）」）、`detailHint`。

## 1.9.5 — 2026-10-25

### 修复

1. **调用台账排行榜吸顶表头透明，滚动时与行文字重叠** — 表头（`# 技能 / 版本 / 调用 / 成功 / 失败 / 成功率 / 最后调用`）原来 `background:transparent`，吸顶后下方滚动的行会从表头文字里穿过去，看着像字叠字。现改用新增语义变量 **`--dsb-surface`**（= 行/卡片真实渲染的不透明底色，即面板底色叠加 `--chipBg` 后的颜色），并：
   - `z-index` 2 → **3**
   - 加底部分隔线 `1px var(--dsb-line)` 与 `box-shadow:0 2px 6px rgba(0,0,0,.10)`，滚动时有明确边界
   - 深色/浅色皮肤都取各自的不透明底色（实测 28 月白纸墨 `#f1efeb`、08 极地冰川 `#dfebf4`、04 全息幻彩 `#e7e4fe`、10 机械核心 `#252422`、01 曜石极光 `#252a38`），表头文字对比度 5.54–11.45:1

## 1.9.4 — 2026-10-25

### 新增

1. **面板热重载按钮 ⚡** — 面板右上角新增热重载按钮。改完插件代码点一下，host 半当场换新、client 半刷新页面取最新 bundle，**不重启桌面端、不中断会话**。
   - host 半：`POST /dsh-skill-browser/reload` 用 `?v=<ts>` 重新 import 自身模块（5 个子模块一并换新，绕开 ESM 模块缓存），新的 API 实例接管请求，旧的经 `dispose()` 释放。
   - 生效句柄挂在 `globalThis.__DSB_LIVE__`（`{api, gen}`），跨模块实例共享；每次重载 `gen` 自增，监听器由旧实例的 dispose 摘掉，不会重复注册。
   - client 半：调 `ctx.get("clientModules").rebuilt(id)` 让 client-modules 重新从磁盘读 `client.js`，随后 `location.reload()` 取新界面。
2. **热重载探针 `GET /dsh-skill-browser/rev`** — 返回 `{version, gen}`。面板点完热重载后轮询该接口，确认宿主半真的换代（`gen` 变大）再刷新页面，避免刷到旧代码。

### 修复

1. **分组栏 / 台账看板滚动条不可见** — 面板内滚动容器原来用系统 overlay 滚动条，深色面板上几乎隐形。改为常驻 11px 品牌色滑块（轨道 `--dsb-soft`、滑块 `--dsb-brand`、`min-height:40px`、`scrollbar-width:thin`、`overscroll-behavior:contain`），覆盖技能列表 / 台账表格 / 详情正文 / 分组栏四个容器，浅色深色皮肤都看得见位置。
2. **悬浮球被面板盖住** — 球 `z-index` 原为 `2147481000`、面板 `2147481100`，面板一开就压住球。现球 `2147483600`、面板 `2147483000`，球恒在面板之上（与 dsh-todo-float-ball / dsh-font-enhancer / dsh-qq-digest 的层级一致）。
3. **分组栏过高挤占技能列表** — `.dsb-groups` 加 `max-height:96px;overflow-y:auto;overflow-x:hidden`。

## 1.9.3 — 2026-10-25

### 新增

1. **分组升级为「大类 → 子类」两级结构** — 原来的分组是平铺的一层，AI 分完只会得到一堆并列的组。现在支持逻辑上的总-分关系：一个大类（如「Fluent/CFD 仿真」）下可挂多个子类（前处理 / 画网格 / 求解与监测 / 后处理 / 故障排查），「DSH 工具链」下可挂（启动失败 / 插件冲突 / 插件开发 / 安装经验 / 网关配置）。层级上限两层，第三层会被拒绝。
2. **分组卡显示子类数与大类合计** — 大类卡右上角显示「N 子类」，数量是该大类自身成员 + 全部子类成员的合计；点大类看全部，点下面的子类只看那一个。
3. **二级子类筛选栏** — 选中某个大类后，分组栏下方出现一条「└ 子类」栏，含「整个大类」+ 每个子类（带计数），点哪个筛哪个。
4. **大类卡新增「＋」按钮** — 直接在某个大类下新建子类，不必先建组再挪。
5. **AI 分组改为「先出方案，确认后落盘」** — 原先是点一下直接写库，模型截断或分得不满意只能删了重来。现在 AI 只返回一份「大类 → 子类 → 技能」方案，在弹层里列清楚（共 N 个大类 / M 个子类 / 覆盖 K 个技能），由用户选：
   - **替换**：清掉旧的 AI 分组，按此方案重建（手工建的分组永远保留）
   - **追加**：保留现有分组，只补还没归类的技能
   不确认就不写盘。
6. **AI 分类提示词按「领域 → 用途」两级重写** — 明确要求大类是领域（Fluent/CFD 仿真、DSH 工具链、软件安装、网关与反代、文档处理…），子类是领域内的具体用途；每个技能恰好归一个子类、一个不漏；单子类 ≤10 个技能；禁止「通用/其他/杂项/综合/工具集」大杂烩筐；不再因为某领域技能多就只细分它。配套三遍覆盖：第一遍全量、第二遍只补模型漏掉的、第三遍按分类标签兜底，保证 100% 覆盖。
7. **AI 方案生成失败可读** — 模型流被 max-tokens 截断时不再只说「异常结束」，会带上 failure code/message。

### 修复

1. **滚动条看不见、不知道滚到哪** — 面板内所有滚动容器（技能列表、台账表格、详情正文、分组栏）原来用系统 overlay 滚动条，深色面板上几乎隐形。现在统一常驻 11px 滚动条：轨道半透明、滑块用品牌色（`--dsb-brand`）、最小高度 40px、hover 加深，并加 `scrollbar-width:thin` / `overscroll-behavior:contain`。
2. **悬浮球被面板盖住** — 本插件悬浮球 z-index 是 2147481000，面板是 2147481100，面板一开就压住球；而同类插件（dsh-todo-float-ball、dsh-font-enhancer、dsh-qq-digest）球都在 2147483600 以上。现在球提到 **2147483600**、面板提到 **2147483000**，球恒在面板之上。
3. **分组栏过高挤占列表** — 分组栏加 `max-height:96px` + 纵向滚动，分组多时不再把技能列表压扁。
4. **merge 模式误报失败** — 追加模式下如果所有技能都已有归属，原实现返回「方案里的技能都不在当前技能库中」错误。现在按正常结果处理，返回「所有技能都已在分组里，本次没有需要补的技能」。

## 1.9.2 — 2026-10-24

### 修复

1. **台账看板与分组栏对比度** — 1.9.0/1.9.1 新增的 CSS 全是深色硬编码（`#8fc7ff` / `#9ff5c8` / `#8b93a8` / `rgba(255,255,255,.x)`），浅色皮肤（04 全息幻彩、08 极地冰川、28 月白纸墨等）下白字白底、完全看不清。现在全部改为皮肤语义变量 `--dsb-ok` / `--dsb-fail` / `--dsb-warn` / `--dsb-dim` / `--dsb-soft` / `--dsb-line` / `--dsb-bar` 等，深色皮肤用亮色系、浅色皮肤用深色系。
2. **品牌强调色当正文色导致浅色皮肤看不见** — 卡片技能名、排行榜技能名、排序高亮、分组标签原来直接用皮肤品牌色 `var(--stA)`。08 极地冰川（`#f06a5d` 压 `#eef7fd`）只有 2.80:1、04 全息幻彩（`#e0559f` 压 `#f2f0ff`）只有 2.9:1。新增 `--dsb-brand` / `--dsb-brand-strong`：按「同色相逐级加深」的阶梯算出达标色，既保住品牌色观感又能看清。
3. **品牌渐变上的标签色** — 激活的 chip / tab / 排序按钮 / 快捷区间 / 新建分组是「品牌渐变 + 白字」，淡渐变上白字同样不可见。新增 `--dsb-onbrand`：按渐变中点亮度自动在白与近黑之间切换。
4. **趋势柱 / 迷你条不可见** — 柱状图直接用品牌色，浅色皮肤下 08 极地冰川只有 2.80 / 2.79:1。新增 `--dsb-bar1` / `--dsb-bar2`，按 3:1（非文字图形标准）取达标色。
5. **skinColorLum 支持 hsl() / hsla()** — 100 个派生皮肤的颜色是 hsl() 字符串，原先只解析 #rrggbb，导致亮度判定全部落回默认值、浅色判定失效。补齐 hsl → rgb 换算。
6. **次要小字改用 --dsb-dim** — 皮肤自带的 --hintC 对面板背景对比度实测仅 3.00~4.02:1（10~11px 小字达不到 WCAG AA 4.5:1），改为按候选链 hintC → itm → ptx → 兜底 取第一个达标的颜色，并按「卡片底」而非面板底核算（小字实际坐在卡片上）。
7. **开关开启态标签** — `.dsb-tgl-on` / `.dsb-sw-on` 原用皮肤 `--itD`，浅色皮肤同样是亮色，改走 `--dsb-ok`。
8. **日期选择器配色** — 新增 `--dsb-scheme`（light / dark），原生 `<input type="date">` 的日历弹窗在浅色皮肤下不再弹黑框。

### 变更

1. **分组栏改为紧凑单行卡** — 分组卡高度 56px → 30px，名称与数量同行，🎨/✏️/🗑 操作按钮浮到右上角 hover 才显形；12~18 个分组可一屏排完。
2. **「全部 / 未分组」改用统一样式的 chip** — 不再用内联渐变 hack，选中态统一走 .dsb-gadd-on。

### 新增

1. **全皮肤对比度自检** — 128 款皮肤 × 14 组前景/背景组合共 1792 项逐一校验（正文 4.5:1、品牌字 4.5:1、次要小字 4.5:1、大数字 3:1、趋势柱 3:1、渐变白字 3:1），当前 **0 项不达标**（20 款浅色皮肤全部通过）。

## 1.9.1 — 2026-10-24

### 重构

1. **失效台账 → 调用台账看板** — 原来的「📋 失效台账」只列人工台账表 + 最近 30 条自动登记流水，看不出调用规模与趋势，改为「📊 调用台账」看板。

### 新增

1. **时间区间筛选** — 7 个快捷区间（今天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 今年 / 全部）+ 自定义起止日期（`<input type="date">`），工具栏右侧实时显示数据的实际覆盖区间。
2. **日 / 周 / 月 / 年四种粒度** — 趋势与统计按粒度聚合，周以周一为起点，空洞自动补零。
3. **6 个汇总指标卡** — 调用次数、活跃技能数、活跃天数、成功率、失败次数、日均调用。
4. **纯 CSS 趋势柱状图** — 按粒度出柱，失败全部命中的柱标红，悬停显示「日期 · 调用 N（成功 X / 失败 Y）」。
5. **技能调用排行榜** — 列出每个技能的调用次数、成功、失败、成功率、最后调用时间，并带**版本号徽章**（无版本显示「暂未编版本号」）与相对调用量的迷你条；5 个表头可点击切换排序（调用 / 失败 / 成功率 / 最后调用 / 名称）；失败次数 > 0 的技能可点击直接打开该技能的人工台账明细。
6. **原始流水折叠** — 人工台账表与最近 30 条自动登记流水收进「展开原始流水」开关，默认收起，看板优先。
7. **新增接口 `GET /dsh-skill-browser/ledger/stats`** — 查询参数 `from` / `to`（YYYY-MM-DD）、`gran`（`day|week|month|year`）、`sort`（`calls|fails|rate|last|name`）、`top`；返回 `totals` / `buckets` / `ranks` / `dataFirst` / `dataLast` / `rankTotal`。带 30 秒缓存。
8. **新增模块 `lib/ledger-stats.js`** — 纯函数聚合层（无外部依赖）：`dayKeyOf` / `weekStartOf` / `normalizeGran` / `normalizeRecords` / `buildStats`。日期按本地时区取日键，避免 UTC 漂移。

### 变更

1. 台账 tab 文案由「📋 失效台账」改为「📊 调用台账」。
2. `#dsb-ledger` 由 `display:block` 改为 `display:flex`，内部改为工具栏 / 指标卡 / 趋势 / 排行 / 流水的纵向 flex 布局。
3. 台账视图打开时若无统计数据会自动拉取一次。
## 1.9.0 — 2026-10-22

### 新增

1. **技能版本号徽章** — 卡片技能名旁显示 `v<version>` 绿色徽章；版本读取顺序为 `SKILL.md` frontmatter 的 `version` 字段 → 同目录 `package.json` 的 `version` 字段；两者都没有时显示灰色「暂未编版本号」。
2. **自定义视图分组（手动建组）** — 面板新增「我的分组」横向栏，可手动新建分组（名称 + emoji + 颜色），并支持重命名与删除。分组数据存于 `~/.dsh/data/dsh-skill-browser/groups.json`；**分组只是视图归档，绝不移动或修改任何技能文件在磁盘上的位置**。
3. **一键把技能移入分组** — 每张技能卡片底部新增「📁 移动」按钮，点开浮层选择目标分组即可归档；卡片上同时显示当前所属分组标签，也可选择「移出分组」。
4. **AI 自动分类建组** — 分组栏新增「🤖 AI 自动分组」按钮，调用 DSH 宿主 llm 服务读取技能库清单（目录名 + 中文简介 + 描述），让模型输出分组方案（每组含名称、emoji、成员技能列表），一次性建好分组并完成成员归档；**只重建 AI 建的组，保留用户手工建的组**。
5. **AI 一键生成分组封面** — 每个分组卡片右上角新增「🎨」按钮，调用 llm 生成一段纯 SVG（200x200，深色渐变 + 几何装饰 + 居中符号，无文字），经安全清洗（剥 `<script>`、`on*=` 事件属性、外部 href，上限 40KB）后存入 `groups.json` 作为分组卡片背景图。
6. **新增 HTTP 接口** — `GET /dsh-skill-browser/groups`（列出分组 + 技能归属映射）；`POST /dsh-skill-browser/groups`（action = `create` / `rename` / `delete` / `assign` / `assign-batch` / `ai-classify` / `ai-cover`）。
7. **新增模块 `lib/groups.js`** — 承载分组存储与两个 AI 能力（自动分类建组、分组封面生成）。

### 变更

1. **宿主注入扩展** — `inject` 从 `["webServer"]` 扩展为 `["webServer", "llm"]`。
2. **新增可选依赖声明** — `@deepseek-ai/dsh-llm` 声明为 `optional peerDependency`：不安装也能正常使用，只是两个 AI 按钮会提示「AI 不可用」。

## 1.8.7 — 2026-10-19

### 文档与代码对齐（无功能改动）

按源码逐项取证后修正 7 处文档不符：

1. **README:13** — 把「搜索框 + 「全部技能 / 停用」开关」改为「全部技能」**聚合启停滑块**（一键全启用/全停用，或点开批量选择）。代码里没有名为「停用」的筛选控件。
2. **README 功能列表** — 补齐 v1.7.0～v1.7.2 整代核心功能「技能启停」：单卡开关 / 分类级聚合滑块 / 全库批量；停用即改写 `SKILL.md` frontmatter 的 `disable-model-invocation`（`scan.js:17,123,163,199`），自动备份 `.bak-toggle`，灰显+徽章（`client.js:129-149`）。中英双语都补。
3. **README:28 / :47** — 「16 个一级分类」→ **15**（`lib/zh.js` 的 `CATS.length` 实跑为 15，含 other 兜底）。
4. **README:37** — 推荐位由 2 个补为面板 **3 张**卡（多 `dsh-todo-float-ball`，`client.js:699-712`）、DSH 设置页 **4 条**（`client.js:1935-1948`）。原文「设置页不再显示推荐」也不成立，已改。
5. **README:38** — 设置页「悬浮球导航」由 2 个开关补为 **3 个**（新增 `📋 Todo 悬浮球`，`client.js:1882`）。
6. **README API 表** — 9 条补为 **14 条**：新增 `POST /toggle`（`index.js:450`）、`POST /toggle-batch`（`:456`）、`GET|POST /diag`（`:518`）、`GET /orb/<orb-*.html>`（`:366-367`）。
7. **locale/zh.json + en.json** — 删掉无实现的「快速路由 / quick routing」虚标；描述改为覆盖真实功能（悬浮球面板、一级/二级分类、技能启停、失效台账、技能库位置可配置、一键复位悬浮球）。

## 1.8.6 — 2026-10-14

### 合规性改进（无功能改动）

本次为**纯元数据与文档改动，未触碰任何运行代码**（`lib/*.js` 与上一版逐字节一致）：

- **包元数据**：`engines.node` 对齐 DSH 运行时（`^22.19.0 || >=24.0.0`）；补 `packageManager`；`files` 白名单补上裸目录 `lib`、`locale/*.json`、`icon.svg` 与多语言 README；`exports` 补 `./locale/*.json` 与 `./icon`。
- **交付元数据**（官方插件契约要求）：新增 `locale/en.json` 与 `locale/zh.json`（含 `meta.title` / `meta.description`），新增 `icon.svg`（插件管理器显示用图标，不再显示裸 id）。
- **多语言文档**：新增 `README-zh.md` 中文说明；`README-es/pt/hi.md` 标题与主 README 对齐。

以上改动使插件通过官方 `dsh-plugin-dev check` 全部检查项（`P=12 F=0 W=0`）。

### Compliance improvements (no functional changes)

This release is **metadata and documentation only — no runtime code was touched** (`lib/*.js` is byte-identical to the previous version):

- **Package metadata**: `engines.node` aligned with the DSH runtime (`^22.19.0 || >=24.0.0`); `packageManager` added; `files` allowlist now includes the bare `lib` directory, `locale/*.json`, `icon.svg` and the multi-language READMEs; `exports` gained `./locale/*.json` and `./icon`.
- **Display metadata** (required by the official plugin contract): added `locale/en.json` and `locale/zh.json` with `meta.title` / `meta.description`, plus `icon.svg` so the plugin manager shows a real name and icon instead of a bare id.
- **Multi-language docs**: added `README-zh.md`; `README-es/pt/hi.md` headings aligned with the main README.

With these changes the packages pass every official `dsh-plugin-dev check` item (`P=12 F=0 W=0`).

---

## 1.8.5 - 补齐 npm 包元数据（repository / homepage）

本版无功能变更，仅修正包元数据——它直接决定插件市场能否采集到本插件的下载量。

- **补 `repository` 字段**：此前 `package.json` 缺 `repository`，导致上游
  awesome-dsh-plugin 的 `scripts/probe-npm.mjs` 在「npm 包是否属于该仓库」这一步
  判定失败（该脚本读取 registry 里 `latest` 版本的 `repository`，要求包含对应
  GitHub 仓库路径），于是 `data/npm-map.json` 不收录本条目、`downloads` 在
  `plugins.json` 里落成 `null`。
- **症状**：插件市场列表与详情页**不显示下载量数字**（看起来像"一个下载都没有"），
  实际 npm 近30天有 1700+ 次下载；同时收录条目会降级为 `github:` 安装方式、
  不展示 npm 版本号。
- **补 `homepage` 字段**：指向仓库 README，用于 npm 页面与市场条目的主页链接。
- **`files` 白名单补 `CHANGELOG.md`**：此前变更日志未入 npm 包。

## 1.8.4 - 官方 DSH 兼容声明与引擎版本口径修正

依照 DeepSeek Harness **官方规范**（`packages/boot/app-boot/README.md`）修正兼容性声明。

- **新增官方 DSH 兼容声明**：内核检查的是 `peerDependencies` 中的
  `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 范围，**不读取 `engines.dsh`**。
  现已在 `peerDependencies` 与 `devDependencies` 同范围声明：
  `@deepseek-ai/cordis` `^4.0.2`、`@deepseek-ai/dsh` `>=0.1.7-rc.1`。
- **引擎口径修正为内核版本**：此前 `engines` 只写 `node`，未声明 DSH 内核要求；
  现补 `engines.dsh = >=0.1.7-rc.1`（内核版本口径，非客户端/外壳版本）。
- 说明：`^0.1.7` **不匹配**预发布内核 `0.1.7-rc.2`，故范围使用显式预发布下限。

无功能变更。


## 1.5.6 (2026-09-07)
- 默认位改为与字体悬浮球右下角水平并列（right:74px bottom:18px），迁移 v4 自动复位
- 设置分区推荐插件位回归（照片显示器/字体插件 + Star）
- 🎯 一键恢复升级为探测式双球联动：检测到字体插件已运行才挂载字体球复位，按钮文案动态显示「双球」

## 1.5.5 (2026-09-06)
- 版本号对齐修复：host 端 VERSION 常量此前停在 1.5.1，现统一

## 1.5.5 (2026-09-06)
- 版本号对齐修复：host 端 `lib/index.js` 的 VERSION 常量此前停在 1.5.1，未随 1.5.2~1.5.4 同步，`/health` 误报 1.5.1；现统一为 1.5.5

## 1.5.4 (2026-09-05)
- 移除技能列表每页末尾追加的「💡 悬浮球显隐设置」提示卡；技能列表只展示技能卡片本身

## 1.5.3 (2026-09-05)
- DSH 设置页「悬浮球导航」新增「🎯 一键恢复悬浮球默认位置（右下角）」按钮：悬浮球被拖出屏幕外卡住时，点击立即清除位置记忆 / 恢复显示 / 解除收起状态，无需重启
- 推荐插件位收敛：技能列表每页末尾与 DSH 设置页不再显示推荐广告卡，仅保留面板 ⚙ 设置展开区（技能库位置下方）一处

## 1.5.2 (2026-09-05)
- 复位迁移升级到 v3：客户端加载时自动恢复悬浮球显示、清除收起小圆点与拖拽位置记忆（针对"球找不到"的自救机制）

## 1.5.1 (2026-09-04)
- **台账搜索制**：初始化时全库搜索台账文件（文件名含「失效台账 / 失败台账 / 生效-失效」等，约定路径 `skill-master/references/` 优先）；搜到则复用（人工内容不动、首接管备份），没搜到才创建默认台账
- **默认台账模板**：对齐现行台账格式（〇铁律 / 一登记时机 / 二登记口令 / 三统计表 / 四失败明细 + 🤖 自动登记区块），表头与解析器严格兼容，零隐私内容
- **登记口令**：对话里说「触发失败，登记」/「登记失败：技能名 原因」→ AI 调上报接口写入台账；面板人工台账空态显示口令引导
- **文件夹选择器修复**：改由宿主端 spawn PowerShell 弹 Windows 原生 FolderBrowserDialog（`POST /pick-dir`），路径 100% 准确；renderer 侧 File API 方案（webkitdirectory）在 Electron 32+ 不可靠，已弃用
- **零机器路径**：插件本体不含任何预设/硬编码技能库路径；解析顺序 = 设置页覆盖 → 环境变量 `DSH_SKILLS_DIR` → 插件 config → `~/.dsh/skills`；未配置时面板引导选择
- **内置中文简介字典脱敏**：移除全部私有项目与个人技能条目，仅保留通用描述；未收录技能回退 frontmatter description
- 面板新增推荐插件卡（照片显示器 / 字体插件）与悬浮球显隐引导说明
- 修复：换根后 ledgerPath 未重置；ledgerEffectivePath 路径拼接错误
- 测试扩展至 38 项

## 1.4.0 - 1.4.4 (2026-09-04)
- 初始化检查（空库自动创建 skill-master 技能 + 台账，幂等不覆盖人工内容）
- 失效台账自动登记引擎（`tools/result` 事件监听 + JSONL 流水 + 标记区块增量写入）
- 技能库位置可配置（设置页可视化覆盖 / 环境变量 / 官方默认根自动探测）
- 官方 directoryPicker seam 与 webkitdirectory 选择器尝试（桌面端环境限制，1.5.1 已替换）

## 1.3.0 (2026-09-04)
- 失效台账自动登记（自动/人工分区显示）、技能库位置配置雏形

## 1.2.0 (2026-09-03)
- DSH 设置页「悬浮球导航」分区（settings.section）、双悬浮球视觉统一

## 1.1.0 (2026-09-03)
- 「📋 失效台账」Tab、悬浮球拖拽/收起、面板内设置

## 1.0.0 (2026-09-03)
- 首版：悬浮球 + 面板（技能浏览/分类/搜索/全文查看）
