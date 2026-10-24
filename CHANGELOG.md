# Changelog

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
