# Design System Inspired by Airtable

> Swiss-precision management dashboard with Airtable Blue accents.

一个简洁、优雅、有轻微动画的管理后台。

---

## 1. 视觉主题与氛围

Airtable 的网站是企业级友好的清爽平台,通过白底画布 + 深海军蓝文字传达"精致的简约",Airtable Blue (`#1b61c9`) 作为主要交互强调色。Haas 字体族(Display + Text 双变体)构成 Swiss-precision 排版系统,正文配合正向字距(positive letter-spacing)。

**关键特征:**
- 白底画布 `#ffffff` + 深海军蓝文字 `#181d26`
- Airtable Blue `#1b61c9` 作为主要 CTA 与链接色,不当背景大色块使用
- Haas + Haas Groot Disp 双字体系统
- 正文与 Caption 文字应用正向字距 `0.08px–0.28px`
- 12px 圆角按钮,16–24px 圆角卡片
- 多层蓝调阴影: `rgba(45,127,249,0.28) 0px 1px 3px`
- Semantic token 命名: `--theme_*` CSS 变量前缀

---

## 2. 色板与角色

> 7 个 token。所有 hex 取自 brand palette;不要新增 brand 之外的颜色字面量。

### 主色 (Primary)

| Role | Name | Hex | OKLch | 用途 |
|---|---|---|---|---|
| `background` | White | `#ffffff` | `oklch(1.000 0.000 89.6)` | 页面画布 |
| `foreground` | Deep Navy | `#181d26` | `oklch(0.230 0.019 262.1)` | 正文与标题 |
| `accent` | Airtable Blue | `#1b61c9` | `oklch(0.513 0.176 259.1)` | 主 CTA 与链接 |
| `surface` | Light Surface | `#f8fafc` | `oklch(0.984 0.003 247.9)` | 卡片与面板 |

### 中性 (Neutral)

| Role | Name | Hex | OKLch | 用途 |
|---|---|---|---|---|
| `muted` | Dark Gray | `#333333` | `oklch(0.321 0.000 89.6)` | 次要文字与元数据 |
| `border` | Border | `#e0e2e6` | `oklch(0.912 0.006 264.5)` | 分割线与边框 |

### 语义 (Semantic)

| Role | Name | Hex | OKLch | 用途 |
|---|---|---|---|---|
| `accent-secondary` | Success Green | `#006400` | `oklch(0.436 0.148 142.5)` | 成功状态与语义链接 |

---

## 2.1 点缀色谱(Hue Palette)—— 6 个低饱和色相

> 上表 7 色是**品牌骨架**。只有一条蓝强调色的后台在长列表里"能看但不鲜活",
> 于是补一组点缀色 —— 但**不是**加高饱和色:全部压在 oklch chroma 0.086–0.135
> (约 9%–13% 彩度),比 Material 的鲜艳档(0.18+)低一半以上。
> 目标观感是"耐看、有层次",不是"亮、吵"。

| 色相 | Oklch | 用途 |
|---|---|---|
| `blue` | `oklch(0.513 0.176 259.1)`(即 Airtable Blue) | 主 CTA、工作台 |
| `violet` | `oklch(0.525 0.132 293)` | 组件展示 / 分类标签 |
| `teal` | `oklch(0.548 0.086 197)` | 框架能力 / 次级指标 |
| `amber` | `oklch(0.632 0.108 72)` | 系统设置 / 提醒类指标 |
| `rose` | `oklch(0.570 0.128 14)` | 停用类、需要留意但不告警的计数 |
| `emerald` | `oklch(0.528 0.098 162)` | 在线状态、可用性 |

**五个角色,必须配对使用**(定义在 `src/styles.css` 的「点缀色谱」段):

| 角色 | token | 值 | 用在哪 |
|---|---|---|---|
| 实体 | `--hue-X` | 色相本体 | 图标实心块 / 小圆点 / 标记条 / 进度条 |
| 文字 | `--hue-X-fg` | 实体往深海军蓝压一档 | 浅底上的文字与图标(保证 4.5:1) |
| 软底 | `--hue-X-soft` | 实体 10% 混白 | 选中行底色 / 胶囊 / 图标浅块 |
| 描边 | `--hue-X-line` | 实体 28% 透明 | 细边框 / 分隔 |
| 反白前景 | `--hue-X-on` | 浅色模式=白;深色模式=深海军蓝 | 压在实体块上的文字 |

> `-on` 这一项为什么单独存在:深色模式下实体色会被提亮,白字压浅色块读不出来,
> 所以前景要跟着模式翻转。组件里用 `text-hue-X-on`,**不要在调用点硬编码 `text-white`**。

**用法纪律**

- ✅ 做**有含义的编码**:同一张表里不同口径的指标卡、分类标签、筛选 chip 用不同色相区分。
- ❌ **导航不用色相**:侧边栏只认品牌蓝一种强调色(见 §5.1 一)。
  六个色相铺在菜单上就是"彩虹",反而看不清"我在哪"。
- ❌ 不做装饰性上色。一屏内出现的色相**不超过 4 个**;不做彩虹渐变;不把色相当背景大色块。
- ❌ 告警语义仍然只走 `--success` / `--warn` / `--danger`,不拿点缀色顶替(emerald ≠ success)。
- 色相 → 类名走 Tailwind 的**字面量类名**(`bg-hue-x-soft` / `text-hue-x-fg` / `border-hue-x-line`),
  映射在 `styles.css` 的 `@theme inline`(`--color-hue-*`)。
  **不能拼字符串**(`bg-hue-${tone}-soft` 扫描不到,不会生成 CSS)。
  加色相要改三处:①`styles.css` 的 `:root` ②`styles.css` 的 `.dark` ③`@theme inline` 的映射。

### 可直接复制的 CSS 变量

```css
:root {
  --color-bg:        #ffffff;
  --color-fg:        #181d26;
  --color-accent:    #1b61c9;
  --color-surface:   #f8fafc;
  --color-muted:     #333333;
  --color-border:    #e0e2e6;
  --color-success:   #006400;

  /* 点缀色:低饱和(oklch chroma ≤ 0.135),四角色齐全 */
  --hue-blue:        #1b61c9;
  --hue-violet:      oklch(0.525 0.132 293);
  --hue-teal:        oklch(0.548 0.086 197);
  --hue-amber:       oklch(0.632 0.108 72);
  --hue-rose:        oklch(0.570 0.128 14);
  --hue-emerald:     oklch(0.528 0.098 162);
  /* --hue-X-fg / -soft / -line / -on 由 color-mix 从上面派生,见 styles.css */

  /* Blue-tinted multi-layer shadow */
  --elev-card:       rgba(0,0,0,0.32) 0px 0px 1px,
                     rgba(0,0,0,0.08) 0px 0px 2px,
                     rgba(45,127,249,0.28) 0px 1px 3px,
                     rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset;
  --elev-soft:       rgba(15,48,106,0.05) 0px 0px 20px;

  /* 抬升三档(静置 / 悬停 / 浮起):hover **只换这一档**,不做位移 */
  --af-raise-1:  0 1px 1px rgba(15,48,106,.03), 0 0 0 1px var(--border);
  --af-raise-2:  0 1px 2px rgba(15,48,106,.05), 0 6px 16px -8px rgba(15,48,106,.10), 0 0 0 1px var(--border);
  --af-raise-3:  0 2px 4px rgba(15,48,106,.05), 0 14px 32px -12px rgba(15,48,106,.16), 0 0 0 1px var(--border);
}
```

---

## 2.2 分类色板(`BADGE_THEMES`)

标签列、可编辑标签输入、快速筛选 chip、已选筛选 pill 都读
`src/components/ui/badge-list.tsx` 的 `BADGE_THEMES`。这套主题**已从 Tailwind 默认的
`*-100 / *-700`(约 25%–40% 彩度)换成上表的点缀色 token** —— 改那一处 = 全站分类色一次性统一。

各主题的区别在**色相轮转顺序**(每页从不同色相起手),不是"用不同的色板";
色相就 6 个,靠顺序 + 起手色制造区分度,同时保证同一屏里不撞色。

---

## 3. 字体系统

### 字体族

- **Display**: `Haas Groot Disp` — weights 400 / 500 / 700 / 900
- **Body**: `Haas` — weights 400 / 500 / 700

### Fallback 栈

```css
--font-display: "Haas Groot Disp", Haas, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-body:    Haas, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

> Haas 是商用字体,加载失败时自动落到系统栈。fallback 必须保留。

### 字号阶 (Type Scale)

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|---|
| Display Hero | Haas | 48px | 400 | 1.15 | normal |
| Display Bold | Haas Groot Disp | 48px | 900 | 1.50 | normal |
| Section Heading | Haas | 40px | 400 | 1.25 | normal |
| Sub-heading | Haas | 32px | 400–500 | 1.15–1.25 | normal |
| Card Title | Haas | 24px | 400 | 1.20–1.30 | 0.12px |
| Feature | Haas | 20px | 400 | 1.25–1.50 | 0.1px |
| Body | Haas | 18px | 400 | 1.35 | 0.18px |
| Body Medium | Haas | 16px | 500 | 1.30 | 0.08–0.16px |
| Button | Haas | 16px | 500 | 1.25–1.30 | 0.08px |
| Caption | Haas | 14px | 400–500 | 1.25–1.35 | 0.07–0.28px |

---

## 4. 组件规格

### 按钮 (Buttons)

**尺寸档**(`ui/button.tsx` 的 `size`):`lg` 52px(引导页大 CTA)/ `default` 36px(后台默认)/ `sm` 32px(工具条)/ `xs` 28px(**表格行内**,一行 4~5 个操作时用)/ `icon*` 方形。行内操作按钮一律 `xs`,否则行高会被按钮撑到两倍。
**颜色**:同一行里用**语义**区分,不按喜好上色 —— 主数据操作(导入 / 同步)蓝 `border-primary/40 text-primary`,
推进类(推送建档)绿 `border-success/40 text-success-fg hover:bg-success-soft`,查看 / 编辑中性,删除 `border-destructive/40 text-destructive`。

- **Primary Blue**: `background: #1b61c9` · `color: #ffffff` · `padding: 16px 24px` · `border-radius: 12px`
- **White (Secondary)**: `background: #ffffff` · `color: #181d26` · `border: 1px solid #e0e2e6` · `border-radius: 12px`
- **Cookie Consent**: `background: #1b61c9` · `border-radius: 2px` (锐角小元素)

### 卡片 (Cards)

- `border: 1px solid #e0e2e6`
- `border-radius: 16px` (小卡片) / `24px` (区块)
- `box-shadow: var(--elev-card)`(工具类 `shadow-card`)—— 蓝调多层阴影

### 输入框 (Inputs)

- 标准 Haas 排版
- 焦点态: `border-color: #1b61c9` + 蓝调光晕

### 字号字距规则

| 字号范围 | letter-spacing |
|---|---|
| Body (14–18px) | `0` (默认) |
| Small (11–13px) | `0.01em–0.02em` (正向) |
| UI Labels & Buttons | `0.02em` |
| ALL CAPS | `0.06em–0.1em` |
| Headings 32px+ | `-0.01em–-0.02em` |
| Display 48px+ | `-0.02em–-0.03em` |

---

## 5. 布局

- **Spacing**: 8px baseline grid,实际范围 1–48px
- **Radius 阶**:
  - `2px` — 小/锐角元素
  - `8px` — 默认
  - `12px` — 按钮
  - `16px` — 小卡片
  - `24px` — 区块
  - `32px` — 大区块
  - `50%` — 圆形

- **Border**: 1px solid `#e0e2e6`
- **Breakpoints**: 425px / 768px / 1024px / 1440px / 1664px (23 个细档)

### 5.1 侧边栏 —— 单强调色 + 缩进层级

> 实现:`src/components/layout/sidebar.tsx` + `sidebar-header.tsx`(顶部品牌标题区,独立组件)
> + `nav-config.ts`(菜单与图标表)+ `lib/sidebar-mode.ts`(收起形态)。
> 层级的表达方式改过两回(色相编码 → 引导线 → 纯缩进),以下是**当前**规格。

**一、导航只用品牌色一种强调色。**
色相(§2.1)不参与侧边栏:曾经给每个一级模块配一个色相,真实菜单密度下它变成了"彩虹",
反而比单色更难看清"我在哪"。色相只服务**数据展示**(指标卡 / 分类标签 / 筛选 chip)。

**二、三种节点:**

| 节点 | 表现 |
|---|---|
| 分组行(有 `children`) | 图标 + 文字 + chevron;`aria-expanded` 标出展开态 |
| 叶子(有 `path`) | 图标 + 文字,整行是链接 |
| 纯文字分组(无 `path` 无 `children`) | 全大写小标题 + 一条渐隐分隔线(菜单表里可能出现这种行) |

**三、选中态与 hover 是两件事,别混:**

- **选中** = `--af-blue-soft` 浅底 + `--primary` 文字与图标,无边框。
  判据:父级**精确匹配**(`pathname === node.path`,子页不算),叶子**前缀匹配**(子页也算命中)——
  蓝色只属于"被点中的那一项",所以父级不能用前缀匹配,否则停在子页时父级和子级一起变蓝。
- **hover** 只换 `--af-hover` 中性灰底,**不变蓝**。
- 分组行的 chevron **只做 `rotate-90`**,不换图标:换图标是硬切,旋转才是连续的。

**四、层级只靠缩进,不画引导线。**
展开面板 = 一层 `ml-2 pl-3` 容器把子项推进去 12px;嵌套时递归成立。**不要按 depth 手算 `paddingLeft`**。

> 早先这里画肘形接头 + 贯穿竖线,还给每条线算"该不该亮" —— 一整套几何 + 归属判定换一根 1px 的线,
> 而且实测出过"选中第 3 项、亮线却落在第 1 项"。整块已删除,**别再捡回来**。

**五、分组展开用 `grid-template-rows: 0fr → 1fr`。**
这是本项目**唯一允许的布局动画**(折叠面板本来就该改高度)。
收起时必须给面板加 `inert` —— 内容仍在 DOM 里,不然键盘 Tab 会钻进看不见的链接。

**六、收起后长什么样是系统参数,不是写死的。**
键 `ui.sidebar.collapsed_mode`(存 `sys_para`,设置入口「系统设置 ▸ 参数管理」),两种取值:

| 值 | 表现 |
|---|---|
| `rail`(默认) | 60px 迷你图标栏:只列一级菜单,含当前页的那一项高亮(底色与展开态的选中行**同一套** `--af-blue-soft` 浅蓝,不用实心主色块);底部一枚圆形按钮可以展开回去 |
| `hidden` | 宽度归零、连右边框一起收掉(否则屏幕上留一条 1px 竖线);叫回来的入口是顶栏的菜单按钮 |

> 迷你栏的名字用**原生 `title`** 而不是自绘浮层:它的滚动容器在 CSS 上无法同时
> "纵向 `auto` + 横向可见"(一个轴为 `auto`,另一个轴必然也是 `auto`),自绘气泡必被裁掉。
> 值非法 / 读不到 / 库里没这条 → 回落到 `rail`(见 `lib/sidebar-mode.ts`),不会白屏也不会崩。

**七、顶部品牌标题区**(`layout/sidebar-header.tsx`,**独立于菜单**)。
`h-14`(与顶栏同高,两栏底边对齐)、左侧 28px 主色方块(icon)+ 右侧标题(`14px semibold`)/ 副标题(`10.5px muted`),
整块可点回首页。迷你图标栏形态只留方块,名字走原生 `title`。
标题区讲"这是哪个系统",菜单讲"有哪些页面、我在哪" —— 两者互不 import,换系统名不必动菜单逻辑。

**八、首屏交错入场。** 导航容器挂 `stagger` 类,一级项按 22ms 依次浮入(见 §7)。

### 5.2 页面头

见 §5.6(标题 + 色相强调条 + 问号 popover 的完整规格)。

### 5.3 列表页布局节奏 — 三段式独立行,不挤一起

```
[KPI strip]                ← 4 卡,业务指标
[Chip bar 快速筛选]          ← 独立行,chip + 视图切换
[Active filter pills]      ← 已选筛选
[Table card]
  ├─ Card head(标题 + 分段 Tab)
  ├─ Table toolbar(左搜索,右操作组)
  ├─ Bulk action bar(仅在选中态)
  ├─ Table
  └─ Pagination row(分页 + 每页大小)
[Side detail panel]        ← sticky 360px
```

每段**独立一行**,中间 16-20px 间距。**不要把搜索/筛选/导出/分页塞进同一个 flex**。

### 5.4 表格工具栏 — 左搜索,右操作组,带分隔

```html
<div class="table-toolbar">
  <SearchInput />         <!-- 320px 宽 -->
  <Spacer />
  <Button>筛选</Button>   <!-- 28px 高 -->
  <Button>导出</Button>
  <Button>导入</Button>
  <Button variant="primary">+ 新建主体</Button>
</div>
```

操作按钮之间 8px gap,主操作(+ 新建)与次操作之间加 4px `margin-left` 形成视觉分组。

### 5.5 Tab 模式 —— 四种**分割形态**,一套 API

> 本节 2026-09 修正过两次:先是从"卡片式"改为按代码重写,再是按需求**补出四种 variant**
> (原先写死"只有下划线一种,不要新增 variant"—— 那条已作废)。
> 代码是真源(`src/components/ui/tabs.tsx`),文档跟着代码走。

| variant | 形态 | 用在哪 |
| --- | --- | --- |
| `underline`(默认) | 下划线页签(Linear / Vercel 风格) | 页面头部的主分区:台账页的「列表 / 已归档」 |
| `segmented` | 分段控件(iOS Segmented) | 同一份数据切**视图口径**(全部 / 我负责的 / 我参与的) |
| `pill` | 药丸子(选中 = 主色实底) | 卡片内的轻量切换、筛选预设 |
| `card` | 卡片式(与内容区相接) | 抽屉 / 弹窗里的分区,或需要"文件夹"隐喻的地方 |

**共同纪律(四种都要守):**

- tab **不是**独立按钮:它属于某一组,组内几何统一,**只有选中态承担强调色**;
- hover 只提示"这里可点",强度必须低于选中态 —— 否则同时几个都像选中;
- **计数只走 `count` 属性**(渲染成小胶囊),不要在页面里手写 `({n})`;
- 颜色 / 几何全部走 token(`--border` / `--muted` / `--primary` / `--hue-blue-*`);
  要换样子就**往下加一种 variant**,不要在调用点覆盖颜色。

**`underline` 的细节(默认形态):**

- **形状**:`TabsList` 零间隙横向排开 + 底部 **1px 浅灰基线**;`TabsTrigger` `h-9` / `px-3.5` / `text-[13px]`;
- **选中**:文字加深加粗 + **底部 2px 主色实线**(圆头 + 一层极淡蓝晕)。**不做底色反转**;
- **hover(未激活)**:文字转 `foreground` + 底部 2px 浅灰提示线;
- **聚焦**:`ring-[3px] ring-ring/40`;
- **换行**:`TabsList` 内置 `flex-wrap max-w-full`。

**另外三种的形状要点:**

- `segmented`:浅灰轨道(`bg-muted`)+ 内边距 4px,选中项是**白底胶囊 + `--af-raise-1` 一档抬升**;
  `h-7`、`text-[12.5px]`,比下划线更"紧凑一格"。
- `pill`:无容器,选中 = **主色实底 + 反白**(`bg-primary text-primary-foreground` + `shadow-glow`);
  计数胶囊压在实底上时用 `bg-primary-foreground/20`,**不要硬编码白色**。
- `card`:容器是"底部一条边",选中页签白底 + 真边框,并用一条 1px 白线**盖住容器底边**,
  与内容区连成一片;`TabsContent` 自动补 `pt-3`。

**动效**:全部 `duration-200 ease-out`,只过渡 `color / background-color / opacity / transform`(下划线与卡片遮线),
不做位移与缩放。

```tsx
// 换形态只改 variant,子件 API 完全一致
<Tabs variant="segmented" defaultValue="all">
  <TabsList>
    <TabsTrigger value="all" count={12}>全部</TabsTrigger>
    <TabsTrigger value="mine" count={3}>我负责的</TabsTrigger>
  </TabsList>
  <TabsContent value="all" className="space-y-4 pt-2">…</TabsContent>
</Tabs>
```

> ⚠️ **类名必须是字面量**:variant 的样式表里存的是**完整类名字符串**(含 `data-[state=active]:` 前缀),
> 不做 `${variant}` 二次拼接 —— Tailwind 只扫描源码文本,拼出来的类名不会生成 CSS。

> ⚠️ `src/components/ui/` 是 vendored 目录,但**这一个文件已被项目改写**:
> 跑 `pnpm dlx shadcn@latest add tabs` 会覆盖它,覆盖后按本节重做。

### 5.6 页面头 —— 标题 + 色相强调条 + 问号 popover

实现:`src/components/layout/page-header.tsx`。

- 标题左侧一条 **3px 圆角强调条**(`h-[18px] w-[3px] rounded-full`),
  色相**自动取当前页所属一级模块**(`toneOfTrail`)—— 与侧边栏 / 面包屑同色。
  需要覆盖时传 `tone="violet"`。
- 下沿分隔**不用实线**,用"左实右虚"的渐隐 hairline(`.page-head::after`)——
  与侧边栏分组标题、顶栏下沿共用同一套分隔线语言。
- 副标题放到标题右侧的小问号 trigger 上,hover / focus-within 弹出 popover。
  **默认不占视觉空间**,鼠标上去再展开(见下)。

```html
<div class="page-title-group">
  <h1>角色管理</h1>
  <button class="info-trigger" aria-label="页面说明"><InfoIcon /></button>
  <div class="info-popover">详细描述...</div>
</div>
```

---

## 6. 阴影系统

```css
--elev-card:    rgba(0,0,0,0.32) 0px 0px 1px,
                rgba(0,0,0,0.08) 0px 0px 2px,
                rgba(45,127,249,0.28) 0px 1px 3px,
                rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset;

--elev-soft:    rgba(15,48,106,0.05) 0px 0px 20px;
```

蓝调多层阴影,永远不用厚重黑色阴影。

---

## 7. 动效语言

统一曲线 `cubic-bezier(.23, 1, .32, 1)`,统一时长 160–200ms。

- **Hover**:**只做颜色 / 边框 / 阴影 / 透明度**,不做任何位移与缩放
  (元素一动,光标就可能落在它外面 → hover 反复开关 → 视觉抖动;卡片位移还会把里面的按钮一起挪走)
- **Active**: 阴影收掉(按压反馈,allow 一次性的 `translateY(0.5px)`)
- **Entry**: opacity 0 → 1 + translateY 6px → 0(进场一次性,不做循环)
- **Reduced motion**: 全部 `transition-duration: 0.001ms`,transform/shadow/filter 复位

```css
.btn {
  /* 过渡列表里**不要**放 transform:留一个 hover 位移就会抖 */
  transition: border-color .16s cubic-bezier(.23,1,.32,1),
              color .16s cubic-bezier(.23,1,.32,1),
              background-color .16s cubic-bezier(.23,1,.32,1),
              box-shadow .16s cubic-bezier(.23,1,.32,1);
}
.btn:hover { box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--color-accent) 32%, transparent); }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

---

### 7.1 现成的动效原语(先查这张表,不要每次现搓)

全部定义在 `src/styles.css` 的「动效层」。**它们已经处理过 `prefers-reduced-motion`**,
业务侧直接挂类名即可。

| 原语 | 类名 / 组件 | 时长 | 用在哪 |
|---|---|---|---|
| 页面进场 | `.page-enter`(由 `layout/page-transition.tsx` 按 `pathname` 重挂载触发) | 260ms | 每次路由切换 |
| 路由进度条 | `.route-progress-bar`(`layout/route-progress.tsx`) | 260ms | 主色→紫的渐变条从左推到满再淡出 |
| 列表交错入场 | `.stagger`(挂在**容器**上,子项各 22ms 延迟) | 260ms | 侧边栏一级菜单、面包屑、指标条、工作台卡片网格 |
| 滚动入场 | `<Reveal delay={n}>`(`ui/reveal.tsx` → `.reveal` / `.reveal-in`) | 260ms | 长页面里逐块揭示 |
| 状态脉冲 | `.pulse-dot`(父元素需 `relative`) | 2.4s 循环 | 侧边栏"已连接"绿点 |
| 通知呼吸 | `.attention-dot` | 2s 循环 | 顶栏未读红点 |
| 图标换位 | `.icon-swap`(给元素挂 `key={状态}`) | 260ms | 主题切换的日/月图标 |
| 折叠展开 | `.collapse-grid` + `.is-open`(`grid-template-rows` 0fr→1fr) | 180ms | 侧边栏分组(唯一允许的布局动画) |
| 入场(KPI) | `.kpi`(自带 40ms 交错) | 260ms | 旧版指标卡(新代码优先用 `.stagger`) |
| 主题/环境色温 | `.ambient-veil`、`.tone-topline`(`--tone-color`) | — | 侧边栏顶部、内容区顶部、卡片强调线 |

**新增动效前先问三句:** ① 它传达了什么信息?② 这张表里有现成的吗?③ 去掉位移还成立吗?
三问都过了再写 keyframes。

---

### 7.2 抖动红线(别踩)

| 别做 | 为什么 |
| --- | --- |
| hover 时 `translateY/translateX/scale` | 元素从光标下移走 → hover 反复开关 → 抖 |
| `[data-slot=card]:hover` 整卡上浮 | 卡内按钮/行跟着挪,鼠标在边缘时连锁反应 |
| `transition-all` | 一刀切会把 width/height/padding 一起过渡,布局属性一动就是抖动/拖拽发飘 |
| hover 改 `border-width` / `padding` / 字号 / 行高 | 改的是尺寸,直接触发重排 |
| hover 弹层盖住触发点且 `pointer-events: auto` | 弹层抢走 hover → 开-关-开循环(本项目帮助气泡用 `pointer-events: none`) |
| 弹窗锁滚动时不给滚动条留位 | 整页横向跳一下(已在 `html { scrollbar-gutter: stable }` 兜住) |

## 8. 图像策略

- **风格**: Clean、enterprise-friendly、structured-data 美学;最少装饰
- **主体**: 产品 UI 截图、dashboard 表格、workflow 示意图
- **处理**: 卡片多层蓝调阴影;无厚重渐变;保留原生组件观感
- **避免**: 装饰噪声、堆图填充

---

## 9. 语气与文案

**形容词:** 简洁、优雅、轻微动画、管理后台

**Pillars:**
- 一个简洁,优雅, 有轻微的动画的, 管理后台
- Spreadsheet-database hybrid. Colorful, friendly, structured data aesthetic.

**Use:** sophisticated simplicity · structured data
**Avoid:** heavy shadows · missing letter-spacing

---

## 10. Do's & Don'ts

### Do
- 用 Airtable Blue 作为主 CTA 与链接色
- 标题用 Haas Groot Disp + Display weight,正文用 Haas
- 按钮 12px 圆角 + 16px/24px padding
- 卡片 16–24px 圆角 + 1px `#e0e2e6` 边框
- 阴影用蓝调多层结构
- 正文与 caption 应用 `0.08–0.28px` 正向字距

### Don't
- 跳过 positive letter-spacing
- 用厚重纯黑色阴影
- 把 Airtable Blue 当背景大色块
- 用 emoji 作为功能图标
- 在产品 UI 中混入紫色渐变洗

---

## 11. 快速接入 (Quick Start)

```html
<style>
  :root {
    --color-bg:        #ffffff;
    --color-fg:        #181d26;
    --color-accent:    #1b61c9;
    --color-surface:   #f8fafc;
    --color-muted:     #333333;
    --color-border:    #e0e2e6;
    --color-success:   #006400;

    --font-display: "Haas Groot Disp", Haas, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-body:    Haas, -apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;

    --elev-card: rgba(0,0,0,0.32) 0px 0px 1px,
                   rgba(0,0,0,0.08) 0px 0px 2px,
                   rgba(45,127,249,0.28) 0px 1px 3px,
                   rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset;
  }

  body {
    background: var(--color-bg);
    color: var(--color-fg);
    font-family: var(--font-body);
    font-size: 16px;
    line-height: 1.5;
    letter-spacing: 0.08px;
  }

  .btn-primary {
    background: var(--color-accent);
    color: #ffffff;
    border-radius: 12px;
    padding: 16px 24px;
    font-family: var(--font-body);
    font-weight: 500;
    letter-spacing: 0.08px;
    border: 0;
    cursor: pointer;
    transition: box-shadow .16s cubic-bezier(.23,1,.32,1);
  }
  /* hover 只动阴影,不动位移 —— §7 明令 hover 不做 translateY(抖动红线) */
  .btn-primary:hover {
    box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--color-accent) 32%, transparent);
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 18px;
    box-shadow: var(--elev-card);
  }
</style>
```

---

## token 细则(原 `AGENTS.md` 的「设计系统」段,内容一字未改)

视觉规范是 **`DESIGN.md`**(Inspired by Airtable),实现落在 `src/styles.css` 的 token 层。

- **改视觉只改 token**,不要在组件里写死 hex 或逐个改色值。
- 品牌色映射:`#1b61c9`(Airtable Blue)→ `--primary` / `--ring`;`#181d26` → `--foreground`;`#ffffff` → `--background`;`#f8fafc` → `--card` / `--muted` / `--secondary` / `--accent`;`#333333` → `--muted-foreground`;`#e0e2e6` → `--border` / `--input`;`#006400` → `--success`。
- **点缀色谱(6 色相)**:`--hue-{blue,violet,teal,amber,rose,emerald}`,每个色相五个角色(实体 `--hue-X`、文字 `--hue-X-fg`、软底 `--hue-X-soft`、描边 `--hue-X-line`、反白前景 `--hue-X-on`,浅色=白 / 深色=深海军蓝,**不要在调用点硬编码 `text-white`**)。色相不是装饰:一级模块各认一色(侧边栏 → 面包屑 → 页头强调条 → 工作台入口卡四处一致)。规格见 `DESIGN.md` §2.1。
  - 色相 → 类名的映射**只有一份**:`src/styles.css` 的 `@theme inline`(`--color-hue-X` / `-fg` / `-soft` / `-line` / `-on`)。加色相改三处:①`:root` ②`.dark` ③`@theme inline` —— 漏了第 ③ 步,`bg-hue-X-soft` 这类工具类不会生成(Tailwind 扫不到、也不报错)。
  - 同理,`--af-*` 那套中性/品牌 token 也在 `@theme inline` 里映射成了标准工具类(`bg-hover` / `bg-brand-soft` / `border-border-strong` / `shadow-card` / `shadow-raise-1` …)。**组件里不要再写 `bg-[color:var(--af-hover)]` 这种任意值** —— 又长又容易拼错 var 名,拼错了整条规则静默失效。
  - **Tailwind 只扫描源码里的字面量类名**,不能写 `bg-hue-${tone}-soft` 这种拼接 —— 扫描不到就不会生成 CSS。所有按色相取类名的地方必须查表。
  - 告警语义仍然只走 `--success` / `--warn` / `--danger`,`emerald` ≠ `success`。一屏内出现的色相不超过 4 个。
- `--warn-*` / `--danger-*` / `--destructive` / `--chart-1..5` 是**规范之外的功能色**(规范只定义 7 个品牌色),不要把它们当品牌色扩散使用。`BadgeList` 的彩色主题(`rainbow` / `ocean` / …,定义在 `ui/badge-list.tsx` 的 `BADGE_THEMES`)**已改为读点缀色 token**(原先用的是 Tailwind 默认 `*-100/*-700`,约 25%–40% 彩度,太亮)。改那一处 = 全站分类色统一。默认值仍是规范内的 `brand` 主题。
- **不要在渲染期用 `Math.random()`**:会造成 SSR 水合不一致,而且每次重渲染都变值。需要"看起来随机"的效果时,用基于 `useId()` 或数据本身的稳定哈希(`BadgeList` 的 `stable` 就是这么做的)。
- **不要覆盖 Tailwind 的 `--radius-*` 命名空间。** 它的默认阶就是 `DESIGN.md` §5 要的:`rounded-lg` 8px、`rounded-xl` 12px(按钮)、`rounded-2xl` 16px(小卡片)、`rounded-3xl` 24px(区块)。覆盖会让所有组件圆角一起漂移。
- 字体在 `@theme inline` 的 `--font-sans` / `--font-heading`(Haas / Haas Groot Disp,fallback 到系统栈,**fallback 必须保留**)。换字体只改这两行。
- 字距在 `@layer base`:正文 `0.08px`、标题负向、按钮与 label `0.02em`、全大写 `0.08em`。组件里的 `tracking-*` 会覆盖 base。
- 阴影用工具类 `shadow-card` / `shadow-soft` / `shadow-glow`,**不要写厚重纯黑阴影**(实现变量叫 `--elev-*`、和 Tailwind 的 `--shadow-*` 命名空间避开;映射在 `@theme inline`)。
  **抬升三档 `shadow-raise-1|2|3`(静置 / 悬停 / 浮起)**。hover **只换档位**(可加边框加深),不做位移 —— 三档同族颜色,切换才不跳。
- 动效用 `--ease-brand` + `--t-fast|base|slow`(120 / 180 / 260ms)。**先查 `DESIGN.md` §7.1 的「现成动效原语」表**,不要每次现搓 keyframes;表里没有的才自己写,并保证 `prefers-reduced-motion` 下复位(全局媒体查询已兜底,但别用 `transform` 表达"必须保持的位置")。
- `.dark` 是品牌色经 `color-mix` 推导的对偶值;`DESIGN.md` 只规定浅色,加新 token 时记得同时补 `.dark`。
