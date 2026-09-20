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

  /* Blue-tinted multi-layer shadow */
  --shadow-card:     rgba(0,0,0,0.32) 0px 0px 1px,
                     rgba(0,0,0,0.08) 0px 0px 2px,
                     rgba(45,127,249,0.28) 0px 1px 3px,
                     rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset;
  --shadow-soft:     rgba(15,48,106,0.05) 0px 0px 20px;
}
```

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
- `box-shadow: var(--shadow-card)` — 蓝调多层阴影

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

### 5.1 侧边栏激活态 — 不画左蓝条,只用内容内高亮(蓝底 + 蓝字 + 蓝图标)

> 不再使用"激活态 chevron":它在选中时插入元素会改变 flex 布局,切换菜单时出现抖动。

**Do:** 选中项用 8px 圆角浅蓝底 + 主色文字 + 主色图标 + 右侧 `chevron-right` 微动效。
**Don't:** 不要 3px 左边蓝条 — 视觉上像「外贴在侧边栏的标签」,与菜单本身割裂。

```css
.nav-item { padding: 7px 10px; border-radius: 8px; transition: 180ms; }
.nav-item.is-active {
  background: var(--selected);   /* 浅蓝 7% */
  color: var(--accent);
  font-weight: 600;
}
/* 右侧 chevron:常显,不做"从左滑入"(hover 位移动效 = 抖动源) */
.nav-item .nav-chevron {
  margin-left: auto; color: var(--accent);
  transition: color 180ms;
}
.nav-item.is-active .nav-chevron { opacity: 1; transform: translateX(0); }
```

### 5.2 页面头 — 标题 + 问号 trigger,hover 显示说明 popover

副标题放到标题右侧的小问号 trigger 上,hover / focus-within 时弹出 popover。**默认不占视觉空间**,鼠标上去再展开。

```html
<div class="page-title-group">
  <h1>案件档案</h1>
  <button class="info-trigger" aria-label="页面说明"><InfoIcon /></button>
  <div class="info-popover">详细描述...</div>
</div>
```

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

### 5.5 Tab 模式 — **卡片式页签**(全项目唯一实现)

实现固定在 `src/components/ui/tabs.tsx`(`Tabs / TabsList / TabsTrigger / TabsContent`),**只有这一种样式**:不要新增 `variant`、不要手写 `role="tablist"`(守卫 `pnpm check:convergence` 会拦)。

- **形态**:每个页签本身就是一张小卡片 —— `rounded-xl`(12px,与 `ui/card.tsx` 同阶)+ `border-border` + `bg-card`;`h-9`、`px-3`、`text-[13px] font-medium`、标签间距 `gap-1.5`。
- **选中态**:`border-primary`(品牌蓝边框)+ `bg-primary/5`(5% 蓝底)+ `shadow-(--shadow-card)`。**不做底色反转**(不把整张卡涂蓝),否则会和下方台账卡片抢视觉。
- **hover**:`border-primary/45` + `bg-secondary` + 文字转 `foreground`。
- **focus-visible**:`border-ring` + `ring-[3px] ring-ring/40`,保证键盘可达。
- **计数**:页签上的数字一律用 `count` 属性(渲染成 `rounded-full bg-muted` 小胶囊,选中态转 `bg-primary/15 text-primary`);不要在页面里手写 `({n})` 或自定义 span。
- **换行**:`TabsList` 内置 `flex-wrap max-w-full`,6 个以上页签不会横向溢出,调用点不必再写 class。
- **动效**:`transition-[color,background-color,border-color,box-shadow] duration-150`(阴影也参与过渡,选中态的卡片阴影不会硬切);与 `filter-chips`、`card` 同一档克制程度,不做位移/缩放弹跳。
- **为什么不用下划线**:底边线与下方表格列头视觉重复;也不再使用早先设想的 `.seg` 分段控件(该说法已失效,仓库里没有 `.seg` 实现)。

```tsx
<Tabs defaultValue="12345">
	<TabsList>
		<TabsTrigger value="12345" count={caseRows.length}>12345 案件</TabsTrigger>
		<TabsTrigger value="petition" count={petitionRows.length}>信访案件</TabsTrigger>
	</TabsList>
	<TabsContent value="12345" className="space-y-4 pt-2">…</TabsContent>
</Tabs>
```

> ⚠️ `src/components/ui/` 是 vendored 目录,但**这一个文件已被项目改写**为卡片式:跑 `pnpm dlx shadcn@latest add tabs` 会覆盖它,覆盖后按本节重做。

---

## 6. 阴影系统

```css
--shadow-card:  rgba(0,0,0,0.32) 0px 0px 1px,
                rgba(0,0,0,0.08) 0px 0px 2px,
                rgba(45,127,249,0.28) 0px 1px 3px,
                rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset;

--shadow-soft:  rgba(15,48,106,0.05) 0px 0px 20px;
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

### 7.1 抖动红线(别踩)

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

    --shadow-card: rgba(0,0,0,0.32) 0px 0px 1px,
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
    transition: transform .16s cubic-bezier(.23,1,.32,1),
                box-shadow .16s cubic-bezier(.23,1,.32,1);
  }
  .btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px -4px color-mix(in srgb, var(--color-accent) 32%, transparent);
  }

  .card {
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    padding: 18px;
    box-shadow: var(--shadow-card);
  }
</style>
```
