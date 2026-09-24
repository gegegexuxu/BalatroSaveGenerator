# 小丑牌存档生成器 · 项目规范

> 目标游戏版本：**Balatro 1.0.1o（PC / PROD_PC）** —— 存档格式与本规范严格绑定此版本
> 术语与译名：以 `Code/localization/zh_CN.lua` 官方简体中文为准（游戏内称"牌组"，不叫"卡组"）

---

## 1. 项目概述

### 1.1 目标

做一个网页版存档生成器：玩家自定义起始状态（第一版为选择起始牌组），一键生成 Balatro **第一关（第 1 底注、盲注选择界面）** 的运行存档 `save.jkr`，放入游戏存档目录后从主菜单"继续游戏"进入。

### 1.2 交付形态

- Vite + TypeScript 构建的**纯静态网页**，构建产物 `dist/` 可部署到任意静态服务器（或本地预览）。
- 单页应用，无后端、无数据库、无网络请求（图片字体全部本地）。
- 导出物仅一个文件：`save.jkr`。

### 1.3 非目标（明确排除，写在这里防止范围蔓延）

| 排除项 | 说明 |
|---|---|
| 解析/修改已有存档 | 本项目**只生成**，不读取玩家现有 `save.jkr`（v2 及以后再议） |
| 修改 meta.jkr / profile.jkr | 解锁、图鉴、统计都在这两个文件里，与运行存档无关，**一律不碰** |
| Shader 效果（场景级） | 漩涡背景、CRT、溶解/闪光动画等场景级 shader 不做，用纯色替代。**例外**：卡牌「版本」shader（闪箔/全息/多彩/负片）在范围内，见 §5.7；背景 CRT 质感覆盖层为**试用项**，见 §3.4 |
| 顶点倾斜（鼠标 3D 视差） | 卡牌随光标向观者弹出的顶点 shader（`mouse_screen_pos`/`hovering`/`screen_scale`）**已定案不做，后续也不再做**——网页不做任何鼠标驱动的牌面视差 |
| 粒子效果 | 不做 |
| 音效/音乐 | 不做 |
| 游戏内逻辑模拟 | 只生成"开局状态"存档，不在网页里模拟任何游戏进程 |
| 跨版本兼容 | 只支持 1.0.1o；游戏更新后需重新提取模板与数据 |

---

## 2. 技术栈与工程结构

### 2.1 技术选型

| 项 | 选择 | 理由 |
|---|---|---|
| 语言 | TypeScript（`strict: true`） | 存档序列化对类型精度（int/float/bool/string）要求高 |
| 构建 | Vite | 已确认选型，产物纯静态 |
| UI 框架 | **无**（原生 DOM） | 界面简单，避免框架复杂度 |
| 运行时依赖 | `fflate`（唯一） | raw deflate 压缩，体积小 |
| 测试 | `vitest` | 序列化器往返测试、快照测试 |
| Node | ≥ 18 | Vite 5 最低要求 |

### 2.2 目录结构

```
BalatroSaveGenerator/               # 工作区根（git 仓库 = Web/，见 7 章）
├── Code/                           # 游戏源码（只读参考，不入库，版权属于游戏）
├── Resources/                      # 用户裁切的游戏资源（只读来源，不入库）
├── Save/                           # 个人活存档（不入库：存档位 1/2、settings、Steam 配置）
└── Web/                            # ★ git 仓库根 = 网页工程
    ├── PROJECT_SPEC.md             # 本文档
    ├── README.md                   # 项目入口：学习用途与版权声明、存档风险提示、使用方法
    ├── package.json / vite.config.ts / tsconfig.json
    ├── references/                 # 参考存档（只读，模板提取用）
    │   └── save/
    │       ├── template.jkr        # ../Save/1/save.jkr 的固化副本（模板来源，5.2）
    │       └── sample/             # 六份真机样例存档（附录 A.4）
    ├── scripts/
    │   ├── extractData.mjs         # 从 ../Code/game.lua 提取游戏数据 → src/data/
    │   └── embedTemplate.mjs       # 解压 references/save/template.jkr → src/data/
    ├── assets/                     # 复制进来的图片与字体（见第 4 章）
    │   ├── decks/                  # ← Resources/deck/*.png
    │   ├── tarot/ planet/ spectral/  # ← Resources/{tarot,planet,spectral}/*.png（消耗牌 22/12/18，全卡整图）
    │   ├── enhancement/ seal/ cards/  # ← Resources/ 同名目录
    │   ├── fonts/                  # ← Code/resources/fonts/
    │   └── ui/                     # ← Resources/icon、Resources/logo
    ├── test/                       # vitest（roundtrip.test.ts 为强制门禁）
    ├── tools/                      # 维护工具（Python，非构建链；换游戏版本/模板时用）
    │   ├── analyze_save.py         # Lua 表转储解析查看器（默认读仓库外 ../save_dec.lua）
    │   ├── analyze_samples.py      # 样例存档字段级 diff（8.3 对照真机）
    │   └── roundtrip_test2.py      # Python zlib 字节级往返验证（8.1）
    └── src/
        ├── main.ts                 # 入口
        ├── core/                   # ★ 存档引擎（纯逻辑，不依赖 DOM，可独立测试）
        │   ├── luaTable.ts         # Lua table 解析器 + STR_PACK 序列化器
        │   ├── deflate.ts          # fflate raw-deflate(level 1) 封装
        │   ├── saveDeck.ts         # 牌组/赌注 → 存档字段修改规则
        │   ├── consumables.ts      # 消耗牌查询 / 牌组默认 / 槽位容量（界面逻辑，纯函数）
        │   ├── generate.ts         # 组装入口 generateSave(...): Uint8Array
        │   └── validate.ts         # 生成前结构断言 validateSave(save)
        ├── data/                   # ⚙ 脚本单向生成，禁止手改
        │   ├── backs.ts            # b_* 牌组定义（P_CENTERS 提取）
        │   ├── stakes.ts           # 赌注定义（P_CENTER_POOLS.Stake 提取）
        │   ├── cardMods.ts         # 增强 / 蜡封 / 版本（m_*、P_SEALS、e_* 提取）
        │   ├── consumables.ts      # 消耗牌定义（c_* 提取：名称/描述/图集坐标/vars）
        │   └── templateSource.ts   # 模板 Lua 源码字符串（embedTemplate 生成）
        ├── ui/                     # 界面组件（原生 DOM）
        └── style/                  # 样式与 CSS 变量
```

### 2.3 模块边界

- `core/` 不得 import 任何 DOM / CSS / 图片；输入输出均为纯数据。
- `ui/` 只通过 `generate.ts` 的公开函数拿结果，不接触序列化细节。
- `data/` 全部由 `scripts/` 生成，文件头带 `// AUTO-GENERATED — DO NOT EDIT` 注释与生成时间。

---

## 3. 美术规范（向 Balatro 完全看齐）

> 原则：**像素感、纯色块、硬阴影、无渐变**。游戏 UI 本身就是纯色矩形 + 小圆角 + 浮雕描边，网页直接复刻这一语言，不引入任何现代 Web 设计惯例（毛玻璃、大圆角、柔和投影、渐变按钮都不允许）。

### 3.1 色板

全部来自 `Code/globals.lua:353-469` 的 `G.C` 定义，以 CSS 变量落地：

```css
:root {
  /* 主色 */
  --c-red: #FE5F55;        /* MULT/XMULT/RED —— 主按钮、倍数 */
  --c-blue: #009dff;       /* CHIPS/BLUE —— 筹码、次级主按钮 */
  --c-money: #f3b958;      /* MONEY —— 金钱数字 */
  --c-green: #4BC292;      /* GREEN/CHANCE */
  --c-pale-green: #56a887; /* 主菜单"收藏"按钮色 */
  --c-orange: #fda200;     /* ORANGE —— 选项类按钮 */
  --c-important: #ff9a00;  /* ATTENTION 类强调 */
  --c-gold: #eac058;
  --c-purple: #8867a5;
  --c-white: #ffffff;

  /* 深色系（面板与文字底） */
  --c-black: #374244;      /* BLACK —— 页面主背景（房间底色 G.C.BACKGROUND.D）*/
  --c-lblack: #4f6367;     /* L_BLACK —— 按钮容器、次级面板 */
  --c-grey: #5f7377;       /* GREY —— 描边色 */
  --c-joker-grey: #bfc7d5;

  /* UI 语义色（G.C.UI）*/
  --ui-text-light: #ffffff;
  --ui-text-dark: #4F6367;
  --ui-text-inactive: #88888899;
  --ui-bg-light: #B8D8D8;
  --ui-bg-dark: #7A9E9F;
  --ui-bg-inactive: #666666FF;   /* 不可用按钮底色 */
  --ui-outline-light: #D8D8D8;
  --ui-outline-dark: #7A9E9F;
  --ui-transparent-light: #eeeeee22;
  --ui-transparent-dark: #22222222;
  --ui-hover: #00000055;         /* 悬停统一叠加色 */

  /* 牌组/分类强调色（SECONDARY_SET）*/
  --set-joker: #708b91;
  --set-tarot: #a782d1;
  --set-planet: #13afce;
  --set-spectral: #4584fa;
  --set-voucher: #fd682b;

  /* 稀有度（RARITY）*/
  --rarity-common: #009dff;
  --rarity-uncommon: #4BC292;
  --rarity-rare: #fe5f55;
  --rarity-legendary: #b26cbb;
}
```

花色（后续展示牌面时用）：红心/方块 `#FE5F55`，黑桃 `#374649`，梅花 `#424e54`。

### 3.2 字体

| 用途 | 字体 | 来源 |
|---|---|---|
| 拉丁字母与数字（标题、数值） | **m6x11**（`m6x11plus.ttf`） | 复制自 `Code/resources/fonts/` |
| 中文 | **Noto Sans SC Bold**（`NotoSansSC-Bold.ttf`） | 同上 |

```css
@font-face { font-family: 'm6x11'; src: url('../assets/fonts/m6x11plus.ttf'); }
@font-face { font-family: 'Noto Sans SC'; src: url('../assets/fonts/NotoSansSC-Bold.ttf'); font-weight: 700; }
body { font-family: 'm6x11', 'Noto Sans SC', monospace; }
```

要点：
- m6x11 无中文字形，**必须**回退到 Noto Sans SC，两套字重都按游戏是粗体观感。
- 文字颜色默认白 `--ui-text-light`；深色文字（浅色底上）用 `--ui-text-dark`。
- 数字（金币、筹码、倍数）用 m6x11，等宽感来自字体本身，不用 `letter-spacing` 伪造。

### 3.3 组件规范

以下规则提炼自 `Code/functions/UI_definitions.lua`（按钮 `UIBox_button` 6376-6430 行、主菜单 6194-6243 行）。

**按钮（复刻游戏按钮）**

```css
.btn {
  background: var(--c-red);          /* 纯色填充，禁止渐变 */
  border-radius: 6px;                /* 游戏 r=0.1（高度的10%），实际按高度 8%-10% 取 */
  color: #fff;
  font-family: 'm6x11', 'Noto Sans SC', monospace;
  text-shadow: 2px 2px 0 #374244;    /* 文字硬阴影（无模糊）*/
  box-shadow: 0 4px 0 rgba(0,0,0,.35); /* 硬偏移阴影，禁用 blur */
  padding: 10px 28px;                /* 游戏按钮约 3:1 宽高比 */
  border: none; cursor: pointer;
}
.btn:hover  { box-shadow: inset 0 0 0 999px var(--ui-hover), 0 4px 0 rgba(0,0,0,.35); } /* 统一悬停叠加 #00000055 */
.btn:active { transform: translateY(2px); box-shadow: inset 0 0 0 999px var(--ui-hover), 0 2px 0 rgba(0,0,0,.35); }
.btn[disabled] { background: var(--ui-bg-inactive); cursor: default; }
```

按钮语义色（对照主菜单）：主操作=红 `#FE5F55`、确认/继续=蓝 `#009dff`、设置/次要=橙 `#fda200`、工具类=浅绿 `#56a887`。

**弹窗 / 面板**

- 底色 `--c-black`（#374244）或 `--c-lblack`；
- `border: 2px solid var(--c-grey)`（游戏 outline 1.5，网页取 2px 视觉等效）；
- 浮雕感用双内描边模拟：`box-shadow: inset 0 2px 0 rgba(255,255,255,.08), inset 0 -2px 0 rgba(0,0,0,.25);`
- 圆角 8px 左右，与按钮一致；
- 弹窗遮罩用 `rgba(0,0,0,.6)` 纯黑半透明，无 backdrop-filter。

**牌组选择卡片**

- 图片保持原始比例 142:190，用 `image-rendering: pixelated`（像素画不被平滑）；
- 选中态：外描边 3px `--c-blue` + 右上角 `check.png` 图标（来源 `Resources/icon/check.png`）；
- 悬停态：叠加 `--ui-hover`；
- 排布参考游戏牌组选择页：横向滚动网格。

**牌组编辑弹窗（牌面网格）**

- 侧栏两列（宽度 223px，弹窗总宽锁定 1024px）：左列 = 牌组名 / 描述 / 基础卡牌（139px = 原 114px + 25；基础卡牌 Ace 独占首行、其余每行两个图标，行内 `space-evenly` 铺开）；右列 = 点数列（50px = 点数块 24 + 间距 6 + 数字位，竖排每行一条 A→2，13 行，点数块与张数紧邻左对齐、每行对齐同一列）。省下的宽度全部让给牌面区（751px），右缘与弹窗内缘贴齐。两列内容均在侧栏高度内铺满：基础卡牌面板 `flex:1` 由四行图标 `space-evenly` 撑开、点数列 13 行 `space-between` 拉伸，框体不留空隙；窄屏（≤720px）隐藏点数列。
- 「基础卡牌」统计与扑克详情的花色值改用游戏 UI 图标（`ui/icons.ts` 映射到 `assets/ui/ui_*.png`），不再用 `A/K/#/♠♥♣♦` 文字占位；图标为深色像素图，一律衬 `--c-joker-grey` 浅底。
- 牌面渲染统一走 `ui/playingCard.ts`：**两层图叠加** —— 底板（无增强 = `assets/enhancement/Normal.png` 空白牌底板，有增强 = 对应增强底板）+ 牌面（`assets/cards/<suit>_<rank>.png`），蜡封再叠一层（同尺寸整张）。`.pcard` 不再自绘白底/描边/圆角，观感完全来自底板图。
- 行内步进按行宽自适应：`step = clamp((行宽 - 牌宽) / (张数 - 1), 10px, 46px)`（`deckEditorModal.ts:applyRowFit`），牌多时重叠加大，不撑破牌区；窗口缩放时重算，极窄窗口退化为牌区横向滚动。
- 悬停：抬高 `z-index: 1` 并加 2px `--c-orange` 外框（否则会被右侧叠压的牌盖住），`cursor: pointer`。
- 左键单击 = 打开扑克详情弹窗；右键单击 = 删除该张（`contextmenu` 阻止浏览器菜单）；编辑后统计、牌区张数、`playing_card/sort_id`（按新顺序重编 1..n）即时更新。
- 扑克详情弹窗（`.card-detail`，叠在牌组编辑弹窗之上）：中间放大展示牌面（`--card-w: 216px / --card-h: 312px`），左右各五组切换箭头 —— 点数 / 花色 / 增强 / 蜡封 / 版本；每行「组名 · ◀ · 牌面 · ▶ · 当前值」用 CSS Grid 排列（牌面单元格 `grid-row: 1 / span 5`）。五组箭头语义：点数按**升序**循环（2→3→…→A），右箭头 = 增大（展示用的 `RANK_ORDER` 是递减序，不能直接拿来循环）；花色按 ♠♥♣♦；增强/蜡封首位为「无」。弹窗内编辑的是**副本**（`draft = { ...card }`），箭头只改副本并即时预览，三种出口：**「确定」（红 `--c-red`，仅 edit 模式）= 写回被点的那张牌**（保持对象引用不变，牌组编辑器据此重绘统计与牌面）、**「创建新的」（橙 `--c-orange`）= 按当前草稿追加一张新牌，原牌不动**、**「取消」（蓝 `--c-blue`）/点遮罩关闭 = 丢弃改动**。当前值槽的配色与游戏统一：**增强 / 蜡封 / 版本**有值时按游戏配色填充色块（底色 = 物品色、文字纯白，对应游戏 `create_badge`，见 `UI_definitions.lua:1153`）——增强取 `G.C.SECONDARY_SET.Enhanced`（#8389dd）、蜡封取 `G.BADGE_COL.<key>_seal`（金 #eac058 / 红 #fe5f55 / 蓝 #009dff / 紫 #8867a5），二者游戏侧是静态常量；**版本取 `G.BADGE_COL`（四种统一为 `G.C.DARK_EDITION`），且该色在游戏里逐帧呼吸**——主循环每帧改写它（`game.lua:2500-2502`：`R = base+amp·sin(w·t)`、`B = base+amp·(1−sin)`、`G = min(R,B)`，周期 `2π/w ≈ 4.833s`），故页面用 CSS 动画复刻同一节奏（`#cc9999`（暖灰）→ `#9999cc`（中位）→ `#6666ff`（蓝）→ 往返），中位色同时作为 `prefers-reduced-motion` 下的静态回退。点数为牌面本身、花色为游戏图标，二者与「无」一并保持中性深色槽。配色与呼吸参数由 `scripts/extractData.mjs` 从 `globals.lua`、`UI_definitions.lua`、`game.lua` 提取/计算后写入 `src/data/cardMods.ts` 的 `colour` 与 `EDITION_PULSE`。
- 牌组弹窗底部按钮：`重置`（红，按牌组规则重建）/ `创建卡牌`（蓝，以 `mode='create'` 打开同一弹窗且隐藏「确定」）/ `保存`（橙，关闭弹窗）。新建牌初值 = `blankCard()`（黑桃 A、无增强无蜡封无版本），追加到牌堆末尾后统一 `renumberDeck`。版本组五组箭头均为可用状态，切换即时预览（见 §5.7）。
- 至少保留 1 张牌（0 张无法通过 `validateSave` 的「牌堆不能为空」）；工作牌堆与所选牌组不一致或手工增删过时，仅在「重置」按钮的悬停文案里说明（不做视觉高亮）。

**消耗牌入口（`.consumables-entry`，v1 仅界面配置，尚未写入存档）**

- 位置：右侧参数列（`.run-params-col`）内、参数面板**正下方**，宽度与种子条 / 参数面板一致（258px）；主页 `.actions` 不再放消耗牌按钮。
- 内容一行一个含义：左「消耗牌 N / M」（N = 已选张数、M = 参数面板的「消耗品」槽位数，实时读取），右「修改消耗牌」按钮（紫 `G.C.PURPLE`，打开图鉴弹窗）；下一行平铺已有消耗牌的牌面（52×70，142:190），未占满时用虚线空槽补齐（虚线沿用 `.param-input` 的下虚线语汇，一眼看出还剩几个空位），空槽最多画 6 个（槽位数可填到 99）。
- 交互：**左键点已有牌 = 移除该张**（toast 提示），是列表唯一的移除入口；槽位数被调小到低于已选数量时计数标红（`.ce-over`）并禁止继续添加，不自动删除已选牌。
- 高度做了压缩（计数与按钮同一行、牌面 52×70、内边距收紧），使 1280×720 视口仍保持单屏、不出现纵向滚动条（与 5046b73 的单屏目标一致）。

**消耗牌图鉴弹窗（`.consumables-modal`）**

- 入口：主页「修改消耗牌」按钮。弹窗只做**图鉴**：不展示已有消耗牌列表（已有牌与其移除都在入口里）。
- 结构自上而下：标题「消耗牌图鉴」/ 分类标签 / 牌池（左右箭头 + 两行牌面）/ 页点 / 提示行 / 操作行（`重置` 红 144px、`完成` 蓝铺满）。
- 分类标签 `全部 / 塔罗牌 / 星球牌 / 幻灵牌`（数量 52 / 22 / 12 / 18，选中态 = 分类色底 + 2px 白描边，白描边是本站既有的选中语汇）。
- 牌池为**固定版式分页**，不做滚动条：每页 2 行 × 每行 8 张（`PAGE_SIZE = 16`），左右各一个 `.arrow-btn` 翻页，下方页点（复用牌组选择的 `.dots/.dot`）标出页码；只有一页时翻页控件用 `visibility` 收起（保留占位，牌池宽度不变）。牌块宽度 `flex: 0 0 11.625%`（(100% − 7×1%) / 8），**行高用整行的 `aspect-ratio: 6.429/1` 锁死**——间距取百分比后行高只与行宽相关，因此空行也保持同样高度，翻页时弹窗不跳动。
- 交互：**左键点击牌面即添加**（允许重复，与真机魔法牌组「愚者×2」一致）；已被选中的牌右下角显示 `×N` 角标；槽位满时不添加并提示「消耗品槽位已满（M），可在右侧参数面板调大槽位数」。换分类标签回到第 1 页。
- 数量为**硬上限**（`core/consumables.ts:canAddConsumable`），上限实时取自参数面板，改了槽位数立刻生效。
- 「重置」恢复当前牌组开局自带的消耗牌（`backs.ts` 的 `config.consumables`：魔法 = 愚者×2、幽灵 = 妖法×1、其余为空），并同时刷新入口；与默认不一致时仅改悬停文案（与牌组编辑弹窗同一约定）。
- **说明框是悬停才浮出的独立框体**（`.cm-desc-pop`，绝对定位到牌池右上角，`display: none` → 悬停时 `.show`）：平时**完全不占位、不预留空白**，也不影响牌池布局；`pointer-events: none` 保证它不会抢走悬停目标（否则鼠标一进框体就会来回闪）。内容用 `renderDescLine(line, vars)` 渲染 `{C:xx}` 配色，`zhName` 按分类色 `--set-tarot/-planet/-spectral` 上色。`#N#` 取值由提取脚本按**开局状态**静态解析（等级 1、无小丑、概率基数 1），取不到的行整行省略（`c_temperance` 的当前小丑售价合计即此类）。
- 弹窗打开时方向键不再切换牌组／赌注（与牌组编辑、详情弹窗同一套键盘守卫）。
- 灵魂 / 黑洞（`hidden = true`）同样列为可选：本工具面向「开局想要什么就放什么」，不做游戏内图鉴的未解锁灰化。

**页面背景**

- 纯色 `--c-black`（#374244）。**不做**漩涡 shader、不做动态背景、不做粒子。

### 3.4 交互反馈总则

- 悬停：统一叠加 `#00000055`，无缩放动画（或至多 100ms 内的位移/亮度变化）。
- 按压：下移 2px + 阴影缩短，瞬时完成。
- 选中：蓝色描边 + check 图标，不用复杂动画。
- 过渡时长上限 150ms，`transition` 只允许 color/background/border-color/transform。
- **弹窗入场动效**（三个弹窗统一）：面板自屏幕底部划入（`translateY(100vh)` → `0`，300ms，ease-out），用 `animation` 实现（遮罩由 `display:none` 切到 `flex`，`transition` 不会触发）；`prefers-reduced-motion: reduce` 下关闭。这是上一条 150ms 上限的**唯一例外**——行程为整屏高度，150ms 会呈现为瞬移。仅做入场，关闭仍是瞬时（不做退场动效）。
- **背景 CRT 质感【试用中，未定案】**：页面纯色背景叠一层 CRT 纹理，只取 `CRT.fs` 在纯色下**真正可见**的三样——扫描线、边缘羽化暗角、极淡噪点（曲率/bulge 与 bloom 在纯色上不可见故不做；游戏侧 `glitch_intensity` 本就为 0）。实现为 `body::before`（`position: fixed` / `z-index: -1` / `pointer-events: none`，静态无动画），不参与 `body` 的 flex 布局、不挡交互、不影响页面高度；界面元素（面板/卡片/弹窗）不受影响。**评估不通过即回滚**：删除 `main.css` 中该段（`body::before`）即可，无其它代码依赖，同时删除本条并把 §1.3 的「场景级 shader 不做」恢复原状。

### 3.5 明确不做清单

shader 波动背景、粒子、卡牌晃动（tilt/juice）、抽卡翻转动画、音效、光晕。若后期要加，须先修订本规范。

---

## 4. 资源规范

### 4.1 资源策略

- 网页用到的图片/字体**复制**进 `Web/assets/`，不直接引用 `Resources/`（已确认决策）。
- 复制时**保留原文件名（含空格）**，与游戏资源一一对应，便于比对与补齐；构建由 Vite 处理带空格路径。
- `Resources/` 与 `Code/` 为只读来源，网页工程不反向写这两个目录。

### 4.2 来源映射表

| Web/assets/ | 来源 | 内容 | 规格 |
|---|---|---|---|
| `assets/decks/` | `Resources/deck/` | 16 张牌组（卡背）图 | 142×190 PNG |
| `assets/fonts/m6x11plus.ttf` | `Code/resources/fonts/` | 拉丁/数字字体 | — |
| `assets/fonts/NotoSansSC-Bold.ttf` | `Code/resources/fonts/` | 中文字体 | — |
| `assets/ui/balatro.png` | `Resources/logo/` | 页面标题 logo | 666×432 |
| `assets/ui/check.png` | `Resources/icon/` | 选中勾图标 | 132×132 |
| `assets/ui/ui_*.png` | `Resources/ui_asset/` | 游戏 UI 小图标（`ui_{x}_{y}` = `ui_assets.png` 图集切片）：`{3,1}`黑桃 `{0,1}`红桃 `{2,1}`梅花 `{1,1}`方片、`{1,0}`A `{2,0}`人头牌 `{3,0}`数字牌（坐标语义依据 `UI_definitions.lua:3368-3378` 的 `tally_sprite`） | 36×36 PNG（2× 资源，18×18 逻辑像素；深色像素图，需衬浅色底） |
| `assets/enhancement/` | `Resources/enhancement/` | 8 张增强牌底板 + `Normal.png`（**空白牌底板**，无增强时用） | 142×190 PNG（整张完整牌面底，直接铺在 `.pcard` 上，不另绘白底/描边） |
| `assets/seal/` | `Resources/seal/` | 4 张蜡封（Red/Blue/Gold/Purple） | 142×190 PNG（**与牌面同尺寸、带透明留白**，按整张铺在牌面上即自动对齐，不要按裁剪图定位） |
| `assets/tarot/` `assets/planet/` `assets/spectral/` | `Resources/{tarot,planet,spectral}/` | 22 / 12 / 18 张消耗牌（塔罗/星球/幻灵）整卡图，文件名 = 英文名（含空格） | 142×190 PNG（**整卡**：自带描边与画框，无需底板或裁剪） |

后续版本按需追加（`joker/` 152 张、`blind/`、`tag/`、`voucher/`、`sticker/` 均已在 `Resources/` 备好，规格见附录 A）。

### 4.3 缺失资源处理流程

1. 开发中发现缺图/缺字体：在 `Web/assets/` 建占位文件并在**附录 A 的"缺失清单"**登记（用途、期望规格、来源建议）；
2. 告知用户，由用户提供资源；
3. 补齐后从清单移除。

**当前状态：v1（牌组选择）所需资源已全部齐备，无缺失。**

---

## 5. 存档生成规范（核心）

### 5.1 存档格式定义

`save.jkr` = **raw deflate（level 1，无 zlib/gzip 头）** 压缩的 Lua 源码文本。证据：

- 序列化：`Code/engine/string_packer.lua:22` `STR_PACK` 生成 `return {["k"]=v,...}` 形式 Lua 表字面量；
- 压缩：`string_packer.lua:68-72` `love.data.compress('string','deflate',...,1)`；
- 读取：`string_packer.lua:53-66` `get_compressed`（前 6 字节非 `return` 则按 deflate 解压）+ `STR_UNPACK`（`loadstring` 执行）。

网页端：`fflate.deflateSync(utf8Bytes, { level: 1 })`。注意 fflate 默认输出 raw deflate，与 LÖVE 的 `'deflate'` 格式一致。

### 5.2 模板策略

**模板来源**：`references/save/template.jkr`（真机存档 `../Save/1/save.jkr` 的固化副本）—— 已验证它就是"第 1 底注、盲注选择界面"的开局状态（`STATE=7` BLIND_SELECT、`GAME.round=0`、`round_resets.ante=1`、牌堆满 52 张、BLIND 表为空）。

**处理方式**：构建期由 `scripts/embedTemplate.ts` 把它解压并解析成 TypeScript 结构化对象存入 `src/data/template.ts`；运行时**深拷贝**模板 → 按规则修改 → 重新序列化。禁止对 Lua 文本做字符串替换（脆弱）。

**模板基线数值**（附录 B 有完整快照）：模板是红色牌组开局，`dollars=4, hands=4, discards=4, hand_size=8, joker_slots=5, consumable_slots=2, reroll_cost=5`，seed=`7C95TXA7`。

### 5.3 序列化规则（`core/luaTable.ts` 必须遵守）

| 规则 | 说明 |
|---|---|
| 字符串键 | `["key"]=`，键与字符串值用 Lua `%q` 转义 |
| `%q` 转义细节 | `"` → `\"`、`\` → `\\`、换行 → `\` 后跟真实换行符（**不是 `\n`**）、控制字符 → `\ddd` 十进制 |
| 数字键 | `[1]=` |
| 布尔值 | 裸 `true` / `false`，**不得**写成字符串 |
| 整数 | 无小数点（`4` 而非 `4.0`） |
| 浮点 | `%.14g` 格式（如 `0.599651559225`），必须与 Lua 数字字符串化一致 |
| nil / 函数 / 循环引用 | 不允许出现（模板数据里本就没有；Object 引用已是被 `recursive_table_cull` 替换的 `"MANUAL_REPLACE"` 字符串占位符，保持原样） |
| 键序 | 任意（`loadstring` 解析不依赖顺序），但实现应保持稳定输出以保证快照测试可 diff |

**验收标准**：分两层——
- **源码层（强制门禁）**：模板经解析→序列化后与原 Lua 源码**逐字符一致**；且嵌入模板 = `references/save/template.jkr` 的解压结果。此往返已在预研中用 Python（zlib）验证到**压缩字节级**一致，网页实现保持源码级一致。
- **压缩层（有效性）**：浏览器端 fflate（及 pako）与 zlib level-1 的 deflate 输出**不逐字节一致**（同为合法 raw deflate 流，仅分块/哈夫曼选择不同），故压缩层验收为「产物解压回读 = 序列化源码」。游戏经 `love.data.decompress` 读取任意合法 deflate 流，加载不受影响（`string_packer.lua:53-66`）。

### 5.4 牌组替换的字段映射（v1 全部功能）

**总原则：所有数值从标准默认值重算，不依赖模板当前值。** 模板是红色牌组（discards 已含 +1），实现时先还原成 `get_starting_params()` 的标准基线（`Code/functions/misc_functions.lua:1868`：`dollars=4, hand_size=8, discards=3, hands=4, reroll_cost=5, joker_slots=5, consumable_slots=2`），再套用目标牌组规则，最后一次性写入下列字段：

| 存档字段 | 说明 |
|---|---|
| `BACK`（name/pos/effect/key） | 整块替换为目标牌组；`effect.center` 取 `src/data/backs.ts` 中对应 `b_*` 定义 |
| `GAME.selected_back_key` | 目标牌组 key |
| `GAME.starting_params.*` | 按牌组规则修改后的起始参数 |
| `GAME.round_resets.hands / discards` | 与 starting_params 同步 |
| `GAME.current_round.hands_left / discards_left` | 与 starting_params 同步 |
| `GAME.dollars` | 修改后的起始金钱 |
| `cardAreas.hand.config.card_limit / temp_limit` | = hand_size |
| `cardAreas.jokers.config.card_limit / temp_limit` | = joker_slots |
| `cardAreas.consumeables.config.card_limit / temp_limit` | = consumable_slots（水晶球另 +1） |
| `cardAreas.deck.cards` | 按牌组规则重建的牌堆（见 5.5） |
| `cardAreas.deck.config.card_limit / temp_limit` | = 牌堆张数 |
| `GAME.starting_deck_size` | = 牌堆张数 |
| `GAME.used_vouchers` | 优惠券牌组需写入（见下表） |
| `GAME.modifiers` | 绿色牌组的 no_interest / money_per_hand / money_per_discard |
| `GAME.spectral_rate` | 幽灵牌组 = 2 |
| `GAME.tarot_rate / planet_rate / shop.joker_max` | 黄道牌组优惠券效果 |

**15 种可选牌组完整规则表**（来源：`Code/game.lua:628-644` 的 `b_*` 定义 + `Code/back.lua:174-278` `Back:apply_to_run` + `Code/card.lua:1880-1971` `Card:apply_to_run`）：

| key | 译名 | 规则（相对标准基线） |
|---|---|---|
| `b_red` | 红色牌组 | discards 3→4 |
| `b_blue` | 蓝色牌组 | hands 4→5 |
| `b_yellow` | 黄色牌组 | dollars 4→14 |
| `b_green` | 绿色牌组 | `modifiers.money_per_hand=2`、`modifiers.money_per_discard=1`、`modifiers.no_interest=true` |
| `b_black` | 黑色牌组 | hands 4→3；joker_slots 5→6 |
| `b_magic` | 魔法牌组 | `used_vouchers.v_crystal_ball=true`（消耗品区上限 +1）；消耗品区放入 2 张「愚者」`c_fool` |
| `b_nebula` | 星云牌组 | `used_vouchers.v_telescope=true`；consumable_slots 2→1 |
| `b_ghost` | 幽灵牌组 | `spectral_rate=2`；消耗品区放入 1 张「妖法」`c_hex` |
| `b_abandoned` | 废弃牌组 | `starting_params.no_faces=true`；牌堆 40 张（去掉全部 J/Q/K） |
| `b_checkered` | 方格牌组 | 牌堆花色重排：梅花→黑桃、方块→红心（26 黑桃 + 26 红心） |
| `b_zodiac` | 黄道牌组 | `used_vouchers` 写入 `v_tarot_merchant`、`v_planet_merchant`、`v_overstock_norm`；`tarot_rate=9.6`、`planet_rate=9.6`、`shop.joker_max=3` |
| `b_painted` | 彩绘牌组 | hand_size 8→10；joker_slots 5→4 |
| `b_anaglyph` | 浮雕牌组 | 开局无字段变化（击败 Boss 给双倍标签属运行时效果） |
| `b_plasma` | 等离子牌组 | `starting_params.ante_scaling=2` |
| `b_erratic` | 古怪牌组 | 牌堆 52 张全部随机点数+花色（网页端自行随机） |
| `b_challenge` | 挑战牌组 | `omit` 标记，**不出现在选择列表** |

说明：
- **本表已全部经真机样例验证**（`references/save/sample/` 中红色/魔法/星云/幽灵/彩绘五种牌组的开局存档，逐字段比对一致：幽灵 `spectral_rate=2` 且带 1 张妖法、彩绘 `hand_size=10`/小丑槽 4、星云消耗槽 1 + `used_vouchers.v_telescope`、魔法消耗区 `card_limit=3` 而 `starting_params.consumable_slots` 保持 2、红色弃牌 4）。
- 网页**不校验游戏内解锁状态**：Continue 路径（`button_callbacks.lua:196` 起）只做版本检查，锁定牌组的存档同样能进入。
- 优惠券数值依据：水晶球=消耗品区上限+1（`card.lua:1912`）；库存过剩=`shop.joker_max+1`（`common_events.lua:1097`）；塔罗牌商人/星球牌商人=出现率 `4 × 9.6/4 = 9.6`（`card.lua:1890-1899`）；望远镜无存档字段效果。
- 各区 `temp_limit` 与 `card_limit` 始终同步写（真机样例证实两值恒相等）。
- **开局参数面板可覆盖**（v0.4 起，`ui/runParamsPanel.ts` → `generate.ts:applyRunInit`）：出牌（三处）、弃牌（三处）、**手牌上限**（`starting_params.hand_size` + `cardAreas.hand.config.card_limit/temp_limit` 两处；实际抓牌数取手牌区 `card_limit`，`state_events.lua:362`）、**小丑槽**（`starting_params.joker_slots` + `cardAreas.jokers.config.card_limit/temp_limit`）、**消耗品槽**（`starting_params.consumable_slots` + `cardAreas.consumeables.config.card_limit/temp_limit`；两区开局由 `game.lua:2239-2245` 从 `starting_params` 派生，读档时该段不执行，故必须同时落盘）、金币（`GAME.dollars` + `starting_params.dollars`）、种子（`pseudorandom.seed` 并清空其余流缓存）。面板默认值 = 标准基线 + 牌组修正（如彩绘牌组 `hand_size` 8→10、黑色牌组 `joker_slot` +1）。

### 5.5 牌对象数据字典（`core/playingCard.ts`）

模板 `cardAreas.deck.cards` 里的 52 张牌就是全部 52 种 `H/C/D/S × A,2-9,T,J,Q,K` 的**完整序列化样本**。构建期提取脚本按 `save_fields.card`（如 `S_Q`）建字典：每种牌的 `base`（含 nominal/colour/suit_nominal/face_nominal 等）、`ability`、`rank` 等全部字段照抄。

重建牌堆时：

1. 按目标牌组规则生成牌面列表（`[suit, rank]` 序列）；
2. 逐张从字典深拷贝对应卡对象；
3. 重新分配唯一标识：`playing_card`（`params.playing_card` 与卡对象同名字段）与 `sort_id` 统一按新顺序 1..n 连编。**唯一性是唯一硬约束**——真机样例中同一张「愚者」的两张实例 `sort_id` 分别为 303/302，证明它是实例计数器而非按牌面固定的值；古怪牌组会出现重复牌面，按牌面查表必然撞号，因此统一重编号（源码依据：`CardArea:load` 按下标恢复、`cardarea.lua:632-655`）；
4. `rank` 按 1..n 写入（游戏加载时 `set_ranks()`，`cardarea.lua:214`，会按下标重算，写对只是为了存档可读）；外层 table 键 `[1..n]` 重排；
5. **牌堆的物理顺序 = 存档 `cards` 数组顺序**（`CardArea:load` 顺序恢复，`align_cards` 不按 `sort_id` 重排），生成器直接以数组顺序表达洗牌结果；
6. 方格牌组改花色后，`base.suit`、`base.colour`、`base.name`、`base.suit_nominal`、`save_fields.card`、`cardAreas.deck.config.card_limit/temp_limit`、`GAME.starting_deck_size` 必须一并更新（以目标花色牌的字典项为准做整体替换，而不是字段级修改）；
7. 古怪牌组随机时逐张独立随机（52 次有放回抽样，与游戏 `pseudorandom_element` 语义一致）；
8. **增强 / 蜡封**（扑克详情弹窗可改，定义见 `src/data/cardMods.ts`，提取自 `game.lua` 的 `P_CENTERS(m_*)` / `P_SEALS`）：
   - 增强牌：`save_fields.center` = 增强 key（如 `m_glass`），`label` = `center.label`，`ability` 按 `card.lua:277-337 Card:set_ability` 重算 —— `name/effect/set` 取增强中心、`mult/h_mult/h_x_mult/h_dollars/p_dollars/t_mult/t_chips` 取 `config` 同名项、`x_mult` 取 `config.Xmult or 1`、`bonus` 取 `config.bonus or 0`、`extra` 取 `config.extra`、`order` 取中心 order，其余字段沿用基础牌（`base_cost/cost/sell_cost` 不变：增强中心无 `cost`）；
   - 蜡封：新增 `seal` 字段（字符串 `Red/Blue/Gold/Purple`）写入 `Card:save` 的同名字段；`label`/`ability` 不受蜡封影响；
   - 版本（闪箔 Foil / 全息 Holographic / 多彩 Polychrome / 负片 Negative）：定义见 `src/data/cardMods.ts` 的 `EDITIONS`（提取自 `game.lua` 的 `P_CENTERS(e_*)`）。**互斥单值**（`card.lua:387 Card:set_edition` 是 `elseif` 链），存档字段取自 `set_edition` + 中心 `config.extra`：
     - `{foil = true, type = 'foil', chips = 50}`
     - `{holo = true, type = 'holo', mult = 10}`
     - `{polychrome = true, type = 'polychrome', x_mult = 1.5}`
     - `{negative = true, type = 'negative'}`（**不**动 `jokers/consumeables.card_limit`：`set_edition` 的槽位 +1 只在 `added_to_deck`（局内获得）时发生，开局牌堆里的牌不触发）
   - **扑克牌只开放 闪箔 / 镭射 / 多彩，不含负片**——依据（游戏逻辑，非美术取舍）：
     - 给扑克牌加版本的两条路径都显式排除负片：`Aura` 幽灵牌（`card.lua:1195 poll_edition('aura', nil, true, true)`）与标准包（`card.lua:1761 poll_edition('standard_edition…', edition_rate, true)`），第 3 参 `_no_neg = true` 直接跳过 `negative` 分支（`common_events.lua:2055`）；能出负片的只有小丑/消耗品路径（`Ectoplasm`、`Negative Tag`、`Perkeo`、挑战预设）。
     - 负片的唯一效果是「不占槽位」（`card.lua:687` jokers 分支 / `931` consumeables 分支），而扑克牌在牌堆里本就不占槽位——即便写进存档也无任何作用。
     - 因此 `core/saveDeck.ts:buildEdition` 对扑克牌拒绝负片，`core/validate.ts` 同样断言拦截；详情弹窗的版本组也只在三者间循环。
     - `ui/cardShader.ts` 仍保留 `negative` / `negative_shine` 两个 program：v2「起始小丑（含负片版本）」要用——负片在小丑上是合法且有意义的。
   - 版本 shader 渲染（`ui/cardShader.ts`）：移植 `resources/shaders/{foil,holo,polychrome,negative,negative_shine}.fs`，用**单个共享 WebGL context** 渲染全部牌面（program 数不受限，context 数受限）。移植三条约定：① `dissolve = 0`（正常显示）时 `dissolve_mask()` 为恒等函数，解散/`burn_colour` 逻辑整段不移植；② 卡面是独立 PNG（非图集），令 `texture_details = (0, 0, W, H)`、`image_details = (W, H)`，则 shader 内 `uv = texture_coords`；③ 纹理不做 sRGB 转换（与游戏一致，直出 RGBA8）。
   - 合成次序与游戏一致（`card.lua:4416-4472`）：闪箔/全息/多彩 = 底板 + 牌面各过一次同名 shader；负片 = 底板 + 牌面各过一次 `negative`，再对底板叠一次 `negative_shine`（后画故在最上层）。

### 5.6 消耗品卡对象（魔法/幽灵牌组专用）

**⚠️ 状态：v1 仅界面，尚未写入存档。** 消耗牌的选择入口与弹窗已完成（见 3.3），但 `core/generate.ts` 仍只写牌堆与数值：`cardAreas.consumeables.cards` 恒为空表，`backs.ts` 的 `config.consumables`（魔法愚者×2 / 幽灵妖法×1）与 `used_vouchers.v_crystal_ball` 也尚未落到存档，因此当前导出的魔法/幽灵牌组存档**不带**开局消耗牌（与真机样例存在已知差异）。下面与附录 D 是写入时的生成蓝本，实现后需同批补 validate 断言与对样例存档的字段级测试。

**✅ 结构已解决**：用户已提供真机样例存档（`references/save/sample/magic_initial.jkr`、`ghost_initial.jkr`），`c_fool`（愚者）与 `c_hex`（妖法）的完整 `Card:save` 结构已提取，固化在**附录 D** 作为生成蓝本。

生成规则要点（详见附录 D）：

- 消耗品卡只写 `save_fields.center`，无 `card`/`playing_card` 键；
- `params.bypass_back` 填**目标牌组**的图集坐标（魔法 `{x:0,y:3}`、幽灵 `{x:6,y:2}`，即 `b_*` 定义的 `pos`）；
- `rank` = 在消耗品区中的位置（1..n）；`sell_cost = floor(cost / 2)`；`added_to_deck = true`；
- `sort_id` 为实例计数器，取区段内不与牌堆冲突的唯一值即可；
- 光谱类（妖法）需要在 `ability.extra` 与 `ability.consumeable.extra` 两处写同一数值（塔罗类愚者则两处均无 `extra` 键）。

### 5.7 Seed 与 RNG

v1 不提供 seed 自定义，保留模板 seed `7C95TXA7`。注意两点：

- 模板的 `pseudorandom` 计数器保留原值即可（不改动就没有一致性问题）；
- 古怪牌组虽然在网页端随机牌面，但**不需要**动 `pseudorandom`：游戏加载存档时牌堆以 `cardAreas.deck.cards` 为准，RNG 只影响后续事件（`game.lua:2308` 起）。若后续版本提供 seed 自定义，规则是：改 `pseudorandom.seed` 并把**所有非 seed 键值清零**，游戏加载时会自动 `pseudohash` 重播种（`game.lua:2167-2168` 容错路径）。

**现状（v0.5 起：牌堆按「牌组类型 + 种子」生成并写入存档）**：

- seed 自定义已实现（`core/generate.ts:applySeed` 清零非 `seed` 键），牌堆随之重建。
- **随机数复刻**（`core/luajitRandom.ts` + `core/balatroRng.ts`）：Balatro 用的是 LÖVE 内置 LuaJIT 的全局 `math.random`/`math.randomseed`（LÖVE 只额外提供 `love.math.*`，未替换全局 `math.*`），因此按 LuaJIT v2.1 源码逐位复刻：
  - `lj_prng.c` TW223（四路 Tausworthe 异或，周期 2^223）；
  - `lib_math.c:random_seed` —— 用**种子的 double 位模式**构造 4 个 64 位状态（依次 `d = d*π + e`，并补足 k[i] 的最高位），再预热 10 步；
  - `math.random(n) = floor(d * n) + 1`，其中 `d` 由 `u64d` 的 `[1,2)` 位模式减 1 得到；
  - `pseudohash`（逐字节 `((1.1239285023/num)*byte*π + π*i) % 1`）与 `pseudoseed`（`2.134453429141 + v*1.72431234` 递推 → `%.13f` 截断 → 与 `hashed_seed` 折半）；**每个 key 一条独立随机流**，首次使用时以 `pseudohash(key..seed)` 起步；
  - `pseudorandom_element` 的候选表按 key 字符串序（花色 C<D<H<S，点数 2..9 < A < J < K < Q < T）；`pseudoshuffle` 先按 `sort_id` 归位再 Fisher–Yates。
- **牌组组成**：普通牌组 52 张；废弃牌组按 `no_faces` 过滤人头牌 → 40 张；方格牌组梅花→黑桃、方块→红桃（26+26）；古怪牌组逐张 `pseudorandom_element(P_CARDS, pseudoseed('erratic'))` 抽 52 次（与游戏同源）。
- **牌堆顺序**：复刻 `game.lua:2383 self.deck:shuffle()` —— 建牌序（按 `s..r` 字符串序）经 `pseudoshuffle(pseudoseed('shuffle'))` 洗牌，与真机同 seed 的开局牌堆顺序一致（牌堆顺序不影响玩法：进入回合时游戏会以 `pseudoseed('nr'..ante)` 重洗，`state_events.lua:344`）。
- **校验向量**（均来自外部参考实现/实测数据，落在 `test/deckGen.test.ts`）：`random(1.0)=0.3238105623786367`；`pseudohash('erratic')=0.45752552206801056`；种子 `11153DRU` → K 17 张 / 方块 19 张；`8778L6US` → 红桃 39 张；`77XX2TEK` → 4 共 20 张 + 黑桃 38 张；坏种子 `7LB2WVPK`（`pseudohash` 溢出成 NaN → 随机流定死）→ 整副 52 张黑桃 10。
- **「修改牌组」弹窗**：展示当前工作牌堆（按花色/点数分组统计），底部「重置」按钮按**当前牌组规则 + 当前种子**重建默认牌堆（古怪牌组按种子随机生成）。**切换牌组、修改种子都不会自动刷新牌堆**（避免覆盖已有牌堆）；工作牌堆与所选牌组不一致时「重置」按钮以悬停文案说明，导出提示同步标注「牌堆未重置」。牌面按行宽自适应重叠（见 §3.3），牌多时不撑破牌区。

### 5.8 版本与校验

- 生成存档的 `VERSION` 保持模板原值 `1.0.1o-FULL`，不修改。
- **赌注选择**：`GAME.stake`（1-8）+ `BACK.effect.center.stake` 与 `GAME.selected_back_key.stake` 同步。赌注效果 modifiers 必须写入存档（`game.lua:2049-2058` 仅在开局执行，读档时 `G.GAME` 整表替换不重放），累进规则（>= 即生效）：
  | 赌注 | 等级 | 存档效果 |
  |---|---|---|
  | 红注 | ≥2 | `modifiers.no_blind_reward = {Small=true}` |
  | 绿注 | ≥3 | `modifiers.scaling = 2` |
  | 黑注 | ≥4 | `modifiers.enable_eternals_in_shop = true` |
  | 蓝注 | ≥5 | `starting_params.discards -1`，并同步 `round_resets.discards`、`current_round.discards_left` |
  | 紫注 | ≥6 | `modifiers.scaling = 3` |
  | 橙注 | ≥7 | `modifiers.enable_perishables_in_shop = true` |
  | 金注 | ≥8 | `modifiers.enable_rentals_in_shop = true` |
- **起始底注（v3 规划，暂未开放）**：届时需同步 `round_resets.ante` 与 `round_resets.blind_ante`（后者驱动选择界面显示数值，`UI_definitions.lua:1548`；游戏在击败 Boss 时同步两者，`button_callbacks.lua:2950`）。小盲基础值（`get_blind_amount` scaling=1）：300/800/2000/5000/11000/20000/35000/50000；大盲 ×1.5、Boss ×2；奖励 $3/$4/$5。
- `core/validate.ts` 在序列化前断言：顶层含 `STATE=7`、`GAME.round=0`、`round_resets.ante=1`、`GAME.stake` 为 1-8 整数且三处 stake 字段一致、蓝注及以上弃牌数三处同步、六个 cardAreas 齐全、`deck.cards` 张数 = `starting_deck_size` = `deck.config.card_limit`、各槽位数值自洽。断言失败直接抛错，不产出文件。
- 导出文件名固定 `save.jkr`。

---

## 6. 功能范围与路线图

| 版本 | 内容 | 状态 |
|---|---|---|
| v1（MVP） | 15 种牌组选择（魔法/幽灵待消耗品样本）→ 生成并下载 `save.jkr` + 使用说明弹窗；**赌注选择（白注~金注）** | 进行中（牌组+赌注已实现，牌组规则数值未应用） |
| v1.1 | 基础数值自定义：金钱、手牌数、弃牌数、手牌区大小、小丑/消耗品槽位；牌组规则落地（deckRules） | 进行中（数值与牌组数值修正已实现；牌组非数值规则待补：星云/黄道起始优惠券、幽灵出现率、绿牌组无利息） |
| v1.2 | **卡牌「版本」**（闪箔/全息/多彩/负片）：`edition` 存档字段 + 四个 shader 的 WebGL 移植（单共享 context）+ 详情弹窗预览 | 进行中 |
| v2 | 起始小丑（含版本：箔/镭射/多彩/负片）、起始消耗品、seed 自定义 | 进行中（**起始消耗品：界面完成**——入口/弹窗/筛选/增删/说明/牌组默认已交付，写入存档与 validate 断言待补，见 5.6；8 级赌注已实现） |
| v3 | 进阶：牌型起始等级、优惠券、商店概率、逐张定制 52 张牌（强化/版本/印章）、起始底注 | 规划 |
| 远期 | 解析已有存档、场景级 shader/动效增强（背景漩涡、溶解动画等；卡牌版本 shader 已单列为 v1.2） | 不承诺 |

每加一个自定义项，必须同步补充：`deckRules` 同风格的规则模块、validate 断言、快照测试、本规范第 5 章的字段映射表。

---

## 7. 代码规范

- TypeScript `strict: true`，禁用 `any`（确需时用 `unknown` + 收窄）。
- 存档数据类型：Lua table 解析结果定义为 `LuaValue = number | string | boolean | { [k: string]: LuaValue }`；**int/float 之分**在序列化层用 `Number.isInteger` 处理，不单独建模。
- 命名：文件 kebab-case 或与现有规划一致的 camelCase；类型 PascalCase；常量 UPPER_SNAKE；中文注释解释"为什么"，不复述代码。
- UI 文案一律中文，游戏术语以 `zh_CN.lua` 官方译名为准（牌组、盲注、底注、赌注、优惠券）。
- `src/data/` 由脚本单向生成：改数据 = 改提取脚本后重跑，**禁止手改**。
- 提交前必须过 `vitest` 全量测试；建议引入 eslint（typescript-eslint 推荐配置），非强制。
- git 仓库根为 `Web/`：`Code/`、`Resources/`、个人活存档 `Save/`（存档位 1/2、`settings.jkr`、`steam_autocloud.vdf`）留在仓库外，不入库（版权与隐私）；参考存档已入库于 `references/save/`。重跑 `npm run gen` 的 extractData 需在父目录自备 `Code/`。

---

## 8. 验证与质量规范

1. **序列化器往返测试（强制门禁）**：`references/save/template.jkr` 解压结果 = 嵌入模板；模板 → 解析 → 序列化 → 与源码逐字符一致（压缩层只要求解压回读一致，理由见 5.3——浏览器端 deflate 与 zlib 字节不逐位一致但均为合法流）。任何 `luaTable.ts` 改动都不得破坏（Python 侧等价验证：`tools/roundtrip_test2.py`，压缩字节级）。
2. **牌组快照测试**：15 种牌组各生成一份存档 → 解压为 Lua 文本做快照；数值断言抽查关键字段（hands/discards/dollars/牌堆张数/used_vouchers）。
3. **对照真机（v1 已有基准）**：`references/save/sample/` 已提供红/魔/星/幽/彩五种牌组的真机开局存档，网页产物与其做字段级 diff，工具 `tools/analyze_samples.py`（允许 seed/RNG 类字段、`sort_id` 实例号不同）。其余牌组（黄/绿/黑/废/方/黄道/浮雕/等离/古怪）按原计划由用户后续补充真机样本，或以 8.4 人工验收兜底。此项结论记录在测试文档。
4. **人工验收清单**：每个牌组生成的存档放入 `%APPDATA%\Balatro\<n>\` → 主菜单"继续游戏" → 确认开局状态（牌组名、金钱、手牌/弃牌数、牌堆张数、特效如无利息/光谱率）。
5. 模板升级（游戏版本变化）时，以上 1-3 全部重跑。

---

## 9. 交付与使用说明

- 构建产物：`Web/dist/`（`npm run build`）；开发：`npm run dev`。
- 页面必须内置"使用说明"弹窗（首次访问自动弹出一次）：
  1. 选择牌组 → 点击「生成存档」下载 `save.jkr`；
  2. 关闭游戏（有运行中存档时 Continue 会占用）；
  3. 将文件放入 `C:\Users\<用户名>\AppData\Roaming\Balatro\<存档位1~3>\`，覆盖同名文件（建议先备份原文件）；
  4. 启动游戏 → 主菜单「继续游戏」。
- 页面显著位置标注：适用游戏版本 1.0.1o；覆盖存档有风险，请先备份。
- 不做自动写入游戏目录的功能（浏览器安全模型也不允许），导出-手动放置是固定交互。

---

## 附录 A：资源清单与来源

### A.1 Resources/ 已有资源（按需复制）

| 目录 | 数量 | 规格 | 用途 |
|---|---|---|---|
| `deck/` | 16 | 142×190 | v1 牌组选择 |
| `joker/` | 152 | 142×190 | v2 起始小丑 |
| `cards/` | 52 | 142×190 | v2+ 牌面预览（`S_A.png` 命名：花色_点数） |
| `tarot/` `planet/` `spectral/` | 22 / 12 / 18 | 142×190 | v2 起始消耗品（**已复制进 `Web/assets/`**，界面已用） |
| `voucher/` | 34 | 142×190 | v3 优惠券 |
| `enhancement/` `seal/` `sticker/` | 8 / 4 / 11 | 142×190 | v3 逐张定制 |
| `blind/` | 31 | 68×68 | 远期 |
| `tag/` | 24 | 68×68 | 远期 |
| `stake/` | 8 | 58×58 | v2 赌注 |
| `booster/` | 33 | — | 远期 |
| `icon/` | 16 | 132×132 | check 等图标（多为空切片，可用仅 4 个） |
| `logo/` | 2 | 666×432 | balatro.png 页面标题 |
| `ui_asset/` | 8 | 36×36 | 暂不用（网页 UI 用 CSS 纯色块实现） |

### A.2 字体

`m6x11plus.ttf`、`NotoSansSC-Bold.ttf` 复制自 `Code/resources/fonts/`（该目录另有 Noto 系 TC/KR/JP 等，不需要）。

### A.3 缺失资源清单（动态维护）

当前无缺失。魔法/幽灵牌组的消耗品卡样本已由用户提供（见 5.6 与附录 D）。

### A.4 样例存档清单（`references/save/sample/`，用户提供，只读）

| 文件 | 内容 | 用途 |
|---|---|---|
| `red_initial.jkr` | 红色牌组开局 | 与 `references/save/template.jkr` 交叉验证模板一致性 |
| `magic_initial.jkr` | 魔法牌组开局（愚者×2） | 附录 D 消耗品结构蓝本；5.4 规则验证 |
| `nebula_initial.jkr` | 星云牌组开局 | 5.4 规则验证 |
| `ghost_initial.jkr` | 幽灵牌组开局（妖法×1） | 附录 D 消耗品结构蓝本；5.4 规则验证 |
| `painted_initial.jkr` | 彩绘牌组开局 | 5.4 规则验证 |
| `red_round1_jokers.jkr` | 红色牌组、round=1、已击败小盲注、带 2 张小丑（j_gift、j_wrathful_joker） | **仅作数据参考，不作模板**：附录 D 小丑结构蓝本；v2 起始小丑功能的对照样本 |

全部样例均为 STATE=7、ante=1、VERSION 1.0.1o-FULL。

---

## 附录 B：模板基线快照（references/save/template.jkr 关键字段，源自 ../Save/1/save.jkr）

```
STATE = 7                      -- BLIND_SELECT（盲注选择界面）
VERSION = "1.0.1o-FULL"
GAME.round = 0                 -- 回合 0
GAME.round_resets.ante = 1     -- 第 1 底注（"第一关"）
GAME.dollars = 4
GAME.stake = 1                 -- 白色赌注
GAME.win_ante = 8
GAME.starting_params = { dollars=4, hand_size=8, discards=4, hands=4,
                         reroll_cost=5, joker_slots=5, consumable_slots=2,
                         ante_scaling=1, no_faces=false, erratic_suits_and_ranks=false }
GAME.round_resets = { hands=4, discards=4, reroll_cost=5, ante=1,
                      blind_choices={Small=bl_small, Big=bl_big, Boss=bl_psychic},
                      blind_states={Small=Select, Big=Upcoming, Boss=Upcoming} }
GAME.current_round = { hands_left=4, discards_left=4, reroll_cost=5 }
GAME.pseudorandom.seed = "7C95TXA7"   -- 含 hashed_seed 及 anc1/idol1/shuffle 等计数器
GAME.used_vouchers = {}
GAME.shop = { joker_max = 2 }
cardAreas.deck.cards = 52 张（每张含 base/ability/save_fields/playing_card/sort_id 完整结构）
cardAreas.{hand,discard,play,jokers,consumeables}.cards = 空
cardAreas.hand.config.card_limit = 8
cardAreas.jokers.config.card_limit = 5
cardAreas.consumeables.config.card_limit = 2
BLIND = 全空表（未选择盲注）
BACK = 红色牌组（b_red）
tags = 空
```

## 附录 C：术语对照（zh_CN.lua 官方译名）

| 英文/key | 官方中文 |
|---|---|
| Deck / Back（b_*） | 牌组 |
| Ante | 底注 |
| Blind | 盲注（Small/Big/Boss = 小/大盲注/Boss盲注） |
| Stake | 赌注（白色→黑色 8 级） |
| Voucher | 优惠券 |
| Joker | 小丑牌 |
| Tarot / Planet / Spectral | 塔罗牌 / 星球牌 / **幻灵牌**（`zh_CN.lua:3513` 的 `b_spectral_cards`；旧版文档写作「光谱牌」，以游戏文案为准） |
| Consumable | 消耗牌 |
| b_red 红色牌组 · b_blue 蓝色牌组 · b_yellow 黄色牌组 · b_green 绿色牌组 · b_black 黑色牌组 · b_magic 魔法牌组 · b_nebula 星云牌组 · b_ghost 幽灵牌组 · b_abandoned 废弃牌组 · b_checkered 方格牌组 · b_zodiac 黄道牌组 · b_painted 彩绘牌组 · b_anaglyph 浮雕牌组 · b_plasma 等离子牌组 · b_erratic 古怪牌组 | |
| v_crystal_ball 水晶球 · v_telescope 望远镜 · v_tarot_merchant 塔罗牌商人 · v_planet_merchant 星球牌商人 · v_overstock_norm 库存过剩 · c_fool 愚者 · c_hex 妖法 | |

## 附录 D：消耗品与小丑卡对象结构（真机提取）

> 来源：`references/save/sample/magic_initial.jkr`（愚者×2）、`references/save/sample/ghost_initial.jkr`（妖法×1）、`references/save/sample/red_round1_jokers.jkr`（礼盒小丑 j_gift、愤怒小丑 j_wrathful_joker）。字段值为真机原样，生成时按规则替换。

### D.1 消耗品卡（塔罗类，以愚者为例）

```
{
  save_fields = { center = "c_fool" },        -- 无 card / playing_card 键
  label = "The Fool",
  rank = 1,                                    -- 区内位置，加载时 set_ranks() 重算
  sort_id = 303,                               -- 实例计数器，唯一即可
  facing = "front", sprite_facing = "front",
  base = { nominal=0, suit_nominal=0, face_nominal=0, times_played=0 },  -- 全零
  ability = { set="Tarot", name="The Fool", order=1, effect="Disable Blind Effect",
              consumeable={},                  -- 塔罗类空表
              bonus=0, h_mult=0, mult=0, t_mult=0, t_chips=0, h_dollars=0,
              p_dollars=0, h_size=0, d_size=0, x_mult=1, perma_bonus=0,
              extra_value=0, h_x_mult=0, hands_played_at_create=0, type="" },
  base_cost = 3, cost = 3, extra_cost = 0, sell_cost = 1,   -- sell_cost = floor(cost/2)
  added_to_deck = true, debuff = false,
  bypass_discovery_center = true, bypass_discovery_ui = true, bypass_lock = true,
  params = { discover=true, bypass_discovery_center=true,
             bypass_back = { x=0, y=3 } },     -- ← 目标牌组的 pos（魔法牌组）
}
```

### D.2 消耗品卡（光谱类，以妖法为例）

与 D.1 同构，差异处：

```
save_fields = { center = "c_hex" },  label = "Hex",
ability = { set="Spectral", name="Hex", order=13,
            extra = 2,                         -- ← 数值来自 c_hex 的 config.extra
            consumeable = { extra = 2 } },     -- ← 同值双写
base_cost = 4, cost = 4, sell_cost = 2,
params = { ..., bypass_back = { x=6, y=2 } },  -- 幽灵牌组 pos
sort_id = 76
```

### D.3 小丑卡（以真机样例为参考）

```
{
  save_fields = { center = "j_gift" },         -- 无 card / playing_card 键
  label = "Gift Card",
  rank = 1,                                    -- 区内位置
  sort_id = 519,
  facing = "front", sprite_facing = "front",
  base = { 全零，同 D.1 },
  ability = { set="Joker", name="Gift Card", order=79,     -- order = P_CENTERS 的 order
              extra = 1,                                    -- 来自该小丑 config（逐小丑不同）
              effect="...", mult=0, ... 其余数值字段同 D.1 },
  base_cost = 6, cost = 6, extra_cost = 0, sell_cost = 3,
  added_to_deck = true, debuff = false,
  bypass_discovery_center = true, bypass_discovery_ui = true, bypass_lock = true,
  params = { discover=false, bypass_discovery_center=true, bypass_discovery_ui=true,
             bypass_back = { x=0, y=0 } },
}
```

### D.4 生成规则汇总

| 规则 | 依据 |
|---|---|
| 键集合固定：18 个键（见 D.1），无 `playing_card`/`edition`/`seal`/`pinned`（nil 键不序列化）；带版本/印章的小丑需另补对应键（v2 再定） | 真机样例键集合 |
| `sort_id` 唯一即可（实例计数器）；同一 center 多张实例各不相同 | 两张愚者 303/302 |
| `rank` = 区内位置 1..n | `set_ranks()` 重算（`cardarea.lua:214`） |
| `sell_cost = floor(cost / 2)` | 3→1、4→2、5→2、6→3 |
| `params.bypass_back` = 目标牌组 pos；小丑/商店来源用 `{x:0,y:0}` | 样例与 `b_*` 定义一致 |
| `ability.order` / `base_cost` / `ability.effect` / `ability.extra` 等来自 `G.P_CENTERS` 对应定义 → 由数据提取脚本进 `src/data/` | `card.lua:4659` Card:load |
| 开局态补充：`hands_played_at_create = 0`（真机参考存档里的 2 是局中购买所致）、`debuff = false`、`added_to_deck = true` | 样例对比 |
| 塔罗类无 `extra` 键；光谱/星球类 `ability.extra` 与 `ability.consumeable.extra` 同值双写 | 妖法样本 |

---

*本规范是项目的唯一标准来源；美术、资源、存档格式、验证方式的任何变更都先改这里再动代码。*
