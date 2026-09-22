/**
 * UI 组件示例 —— 工作台 `/` 的一块。
 *
 * 为什么存在:`components/ui/` 是 vendored 的通用原语,删了可惜、留着没入口等于死代码。
 * 原来靠 7 个 `/showcase/*` 路由"点名",本轮把 7 个路由收敛成这里的一块 —— 组件照常保留、
 * 有活的例子可抄,但不再是 7 条路由 + 7 个页面文件的体量。
 *
 * 约定(改这个文件前读):
 *  - **只放最小可用示例**,不放长篇文档 —— 详细注释在各自 `ui/*.tsx` 的文件头;
 *  - 每个示例都要能**直接抄进业务页**:受控组件给好 useState,不给"半截用法";
 *  - 新增/删除 `ui/` 下的原语时,**同步在这里加减一格**,否则又会退回"孤儿组件";
 *  - 表格那种"一格里塞不下"的例子不挤进网格 —— 给它自己的整宽卡片(见 `UiGalleryTable`)。
 */
import { useState } from "react";
import { toast } from "sonner";

import { UiGalleryTable } from "#/components/modules/workbench/ui-gallery-table";
import { Avatar, AvatarFallback } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button, buttonVariants } from "#/components/ui/button";
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from "#/components/ui/button-group";
import { Calendar } from "#/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "#/components/ui/command";
import { ConfirmDialog } from "#/components/ui/confirm-dialog";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "#/components/ui/context-menu";
import { DateRangePicker } from "#/components/ui/date-range-picker";
import { DetailRow } from "#/components/ui/detail-row";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { FileDropzone } from "#/components/ui/file-dropzone";
import { HoldButton } from "#/components/ui/hold-button";
import { Input } from "#/components/ui/input";
import { JsonBlock } from "#/components/ui/json-block";
import { Label } from "#/components/ui/label";
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarTrigger } from "#/components/ui/menubar";
import { NumField } from "#/components/ui/num-field";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { RateSlider } from "#/components/ui/rate-slider";
import { Reveal } from "#/components/ui/reveal";
import { ScoreText } from "#/components/ui/score-text";
import { SearchSelect } from "#/components/ui/search-select";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "#/components/ui/sheet";
import { Skeleton, StatCardsSkeleton, TableSkeleton } from "#/components/ui/skeleton";
import { Slider } from "#/components/ui/slider";
import { Spinner } from "#/components/ui/spinner";
import { Switch } from "#/components/ui/switch";
import { Table, TableHead, TableHeader, TableRow } from "#/components/ui/table";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import {
	TAB_VARIANT_META,
	TABS_VARIANTS,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
	type TabVariant,
} from "#/components/ui/tabs";
import { TagInput } from "#/components/ui/tag-input";
import { Textarea } from "#/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/** 一格:标题 + 说明 + 渲染区。`wide` 让它在网格里跨满整行(内容宽的例子用) */
function Cell({
	name,
	hint,
	wide = false,
	children,
}: {
	name: string;
	hint?: string;
	wide?: boolean;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("min-w-0 rounded-xl border border-border bg-card p-3", wide && "md:col-span-2 xl:col-span-3")}>
			<div className="mb-2 flex items-baseline gap-2">
				<code className="font-mono text-[12px] text-foreground">{name}</code>
				{hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
			</div>
			<div className={cn(wide ? "space-y-2" : "flex flex-wrap items-center gap-2")}>{children}</div>
		</div>
	);
}

function Group({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-[14px]">{title}</CardTitle>
				<CardDescription>{desc}</CardDescription>
			</CardHeader>
			<CardContent className="pt-0">
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
			</CardContent>
		</Card>
	);
}

export function UiGallery() {
	// 受控组件的状态集中在这里 —— 每个示例都给成"能直接抄走"的形态
	const [switchOn, setSwitchOn] = useState(true);
	const [checkOn, setCheckOn] = useState(false);
	const [sliderVal, setSliderVal] = useState(40);
	const [numVal, setNumVal] = useState(8);
	const [rateVal, setRateVal] = useState(3.5);
	const [selectVal, setSelectVal] = useState("b");
	const [searchVal, setSearchVal] = useState<string | undefined>("sh");
	const [tags, setTags] = useState<Array<{ value: string }>>([{ value: "紧急" }]);
	const [fileName, setFileName] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [collapsedOpen, setCollapsedOpen] = useState(false);
	const [day, setDay] = useState<Date | undefined>(undefined);
	const [range, setRange] = useState<{ from?: string; to?: string }>({
		from: "2026-09-01",
		to: "2026-09-07",
	});

	return (
		<div className="space-y-4">
			{/* 台账表格:一格里塞不下,给它整宽卡片(见文件头最后一条约定) */}
			<Card>
				<CardHeader>
					<CardTitle className="text-[14px]">台账表格(完整业务页骨架)</CardTitle>
					<CardDescription>
						指标卡 → 快速筛选 chip → 工具条 → 批量操作条 → 表格(多选 / 排序 / 徽章 / 标签 / 数值对齐 / 行操作)→
						分页。列定义走 <code className="font-mono">lib/table.ts</code> 的 v9 app hook,多选列与 操作列用{" "}
						<code className="font-mono">shared/table-kit</code> 的 <code className="font-mono">selectColumn</code> /{" "}
						<code className="font-mono">actionsColumn</code> —— 抄这一份就够搭一个台账页。
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-0">
					<UiGalleryTable />
				</CardContent>
			</Card>

			<Group title="基础录入" desc="表单里最常用的受控原语 —— 每个都给好了 useState,可直接抄进业务页。">
				<Cell name="Input" hint="单行输入">
					<Input placeholder="请输入" className="w-40" />
				</Cell>
				<Cell name="Textarea" hint="多行输入">
					<Textarea placeholder="备注" className="w-40" rows={2} />
				</Cell>
				<Cell name="Label + Input" hint="标签绑定(htmlFor)">
					<div className="flex w-full items-center gap-2">
						<Label htmlFor="g-name" className="shrink-0">
							用户名
						</Label>
						<Input id="g-name" className="w-full" />
					</div>
				</Cell>
				<Cell name="Checkbox" hint="勾选">
					<Checkbox checked={checkOn} onCheckedChange={(v) => setCheckOn(v === true)} />
					<span className="text-[12px] text-muted-foreground">{checkOn ? "已选" : "未选"}</span>
				</Cell>
				<Cell name="Switch" hint="开关">
					<Switch checked={switchOn} onCheckedChange={setSwitchOn} />
					<span className="text-[12px] text-muted-foreground">{switchOn ? "开" : "关"}</span>
				</Cell>
				<Cell name="Slider" hint="滑杆">
					<Slider
						value={[sliderVal]}
						onValueChange={(v) => setSliderVal(typeof v === "number" ? v : (v[0] ?? 0))}
						className="w-32"
					/>
					<span className="text-[12px] text-muted-foreground">{sliderVal}</span>
				</Cell>
				<Cell name="NumField" hint="数字输入(带 min/max)">
					<NumField value={numVal} onChange={setNumVal} min={0} max={99} />
				</Cell>
				<Cell name="RateSlider" hint="评分滑杆">
					<RateSlider value={rateVal} onChange={setRateVal} label="满意度" />
				</Cell>
				<Cell name="Select" hint="下拉选择(可分组)">
					<Select value={selectVal} onValueChange={(v) => setSelectVal(v ?? "")}>
						<SelectTrigger className="w-32">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectLabel>分组</SelectLabel>
								<SelectItem value="a">选项 A</SelectItem>
								<SelectItem value="b">选项 B</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</Cell>
				<Cell name="SearchSelect" hint="可搜索下拉">
					<SearchSelect
						value={searchVal}
						onValueChange={setSearchVal}
						options={[
							{ value: "sh", label: "上海" },
							{ value: "bj", label: "北京" },
						]}
					/>
				</Cell>
				<Cell name="TagInput" hint="标签输入">
					<TagInput value={tags} onChange={setTags} placeholder="加标签" />
				</Cell>
				<Cell name="FileDropzone" hint="文件拖放">
					<FileDropzone
						fileName={fileName}
						onFile={(f) => setFileName(f.name)}
						onClear={() => setFileName(null)}
						className="w-56"
					/>
				</Cell>
			</Group>

			<Group title="展示与反馈" desc="只读的展示类原语 —— 徽章 / 数值 / 加载态 / 头像。">
				<Cell name="Badge" hint="徽章(4 个变体)">
					<Badge>默认</Badge>
					<Badge variant="secondary">次要</Badge>
					<Badge variant="outline">描边</Badge>
					<Badge variant="destructive">危险</Badge>
				</Cell>
				<Cell name="BadgeList" hint="徽章列表(可换配色主题)">
					<BadgeList values={["紧急", "已核对", "跨区"]} />
				</Cell>
				<Cell name="BadgeList" hint="按值稳定取色(同一值永远同色)">
					<BadgeList values={["华东", "华北", "华南", "西南"]} color="stable" />
				</Cell>
				<Cell name="ScoreText" hint="数值着色">
					<ScoreText value={88} />
					<ScoreText value={42} />
				</Cell>
				<Cell name="JsonBlock" hint="JSON 块(只读)">
					<JsonBlock value={{ ok: true, rows: 3 }} />
				</Cell>
				<Cell name="DetailRow" hint="详情一行(标签 + 值)">
					<div className="w-full space-y-1.5">
						<DetailRow label="创建人">管理员</DetailRow>
						<DetailRow label="创建时间">2026-09-21 09:12</DetailRow>
					</div>
				</Cell>
				<Cell name="Avatar" hint="头像(无图退回首字)">
					<Avatar>
						<AvatarFallback>管</AvatarFallback>
					</Avatar>
					<Avatar>
						<AvatarFallback>李</AvatarFallback>
					</Avatar>
				</Cell>
				<Cell name="Spinner" hint="加载中">
					<Spinner />
					<Spinner size="sm" />
				</Cell>
				<Cell name="Skeleton" hint="骨架块">
					<Skeleton className="h-4 w-24" />
				</Cell>
				<Cell name="StatCardsSkeleton" hint="指标卡骨架">
					<StatCardsSkeleton />
				</Cell>
				<Cell name="TableSkeleton" hint="表格骨架">
					<TableSkeleton />
				</Cell>
			</Group>

			<Group title="按钮与动作" desc="按钮的变体 / 尺寸 / 组合,以及需要防误触的「长按执行」。">
				<Cell name="Button" hint="变体">
					<Button size="sm">默认</Button>
					<Button size="sm" variant="outline">
						描边
					</Button>
					<Button size="sm" variant="secondary">
						次要
					</Button>
					<Button size="sm" variant="ghost">
						幽灵
					</Button>
					<Button size="sm" variant="destructive">
						危险
					</Button>
					<Button size="sm" variant="link">
						链接
					</Button>
				</Cell>
				<Cell name="Button" hint="尺寸 xs → lg + 禁用">
					<Button size="xs">xs</Button>
					<Button size="sm">sm</Button>
					<Button>default</Button>
					<Button size="lg">lg</Button>
					<Button size="sm" disabled>
						禁用
					</Button>
				</Cell>
				<Cell name="HoldButton" hint="长按到进度走满才执行(防误触)">
					<HoldButton
						variant="destructive"
						holdingLabel="松手取消…"
						onHold={() => toast.success("已执行(示例)", { description: "松手早于进度走满则取消" })}
					>
						长按清空
					</HoldButton>
					<HoldButton variant="outline" onHold={() => toast.info("已提交(示例)")}>
						长按提交
					</HoldButton>
				</Cell>
				<Cell name="ButtonGroup" hint="并排按钮组">
					<ButtonGroup>
						<Button size="sm" variant="outline">
							左
						</Button>
						<ButtonGroupSeparator />
						<Button size="sm" variant="outline">
							中
						</Button>
						<ButtonGroupSeparator />
						<Button size="sm" variant="outline">
							右
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="ButtonGroupText" hint="按钮组里的只读文字">
					<ButtonGroup>
						<ButtonGroupText>共 3 条</ButtonGroupText>
						<Button size="sm" variant="outline">
							刷新
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="TableResizeHandle" hint="列宽拖拽(放在 th 内)">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="relative">
									列
									<TableResizeHandle columnId="demo" onChange={(u) => u} />
								</TableHead>
							</TableRow>
						</TableHeader>
					</Table>
				</Cell>
			</Group>

			<Group title="浮层与导航" desc="需要触发器的浮层类原语,以及四种分割形态的页签(同一套 API,换 variant 即可)。">
				<Cell name="Dialog" hint="模态对话框">
					<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
						<DialogTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>打开</DialogTrigger>
						<DialogContent>
							<DialogHeader>
								<DialogTitle>标题</DialogTitle>
								<DialogDescription>说明文字。</DialogDescription>
							</DialogHeader>
							<DialogFooter>
								<Button size="sm" onClick={() => setDialogOpen(false)}>
									知道了
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</Cell>
				<Cell name="ConfirmDialog" hint="二次确认">
					<Button variant="outline" size="sm" onClick={() => setConfirmOpen(true)}>
						删除
					</Button>
					<ConfirmDialog
						open={confirmOpen}
						onOpenChange={setConfirmOpen}
						title="删除这条?"
						description="删除后不可恢复。"
						onConfirm={() => setConfirmOpen(false)}
					/>
				</Cell>
				<Cell name="Sheet" hint="侧边抽屉">
					<Sheet>
						<SheetTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>抽屉</SheetTrigger>
						<SheetContent>
							<SheetHeader>
								<SheetTitle>标题</SheetTitle>
								<SheetDescription>说明文字。</SheetDescription>
							</SheetHeader>
						</SheetContent>
					</Sheet>
				</Cell>
				<Cell name="Popover" hint="气泡">
					<Popover>
						<PopoverTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>气泡</PopoverTrigger>
						<PopoverContent className="text-[12px]">内容</PopoverContent>
					</Popover>
				</Cell>
				<Cell name="Tooltip" hint="提示(需 TooltipProvider)">
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>悬停</TooltipTrigger>
							<TooltipContent>提示文案</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</Cell>
				<Cell name="DropdownMenu" hint="下拉菜单(分组 + 快捷键 + 危险项)">
					<DropdownMenu>
						<DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							菜单
						</DropdownMenuTrigger>
						<DropdownMenuContent className="w-48">
							{/* 需要「分组标题」用 label 属性 —— 不能把 <DropdownMenuLabel> 塞进 Group 里当标题 */}
							<DropdownMenuGroup label="常用操作">
								<DropdownMenuItem>
									编辑
									<DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
								</DropdownMenuItem>
								<DropdownMenuItem>
									复制
									<DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
								</DropdownMenuItem>
							</DropdownMenuGroup>
							<DropdownMenuSeparator />
							{/* 独立小标题:普通 div,放哪都行(不依赖分组) */}
							<DropdownMenuLabel>危险区</DropdownMenuLabel>
							<DropdownMenuItem variant="destructive">删除</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</Cell>
				<Cell name="Breadcrumb" hint="面包屑">
					<Breadcrumb>
						<BreadcrumbList>
							<BreadcrumbItem>
								<BreadcrumbLink href="#/">首页</BreadcrumbLink>
							</BreadcrumbItem>
							<BreadcrumbSeparator />
							<BreadcrumbItem>
								<BreadcrumbPage>当前</BreadcrumbPage>
							</BreadcrumbItem>
						</BreadcrumbList>
					</Breadcrumb>
				</Cell>
				<Cell name="ContextMenu" hint="右键菜单">
					<ContextMenu>
						<ContextMenuTrigger className="flex h-9 w-28 items-center justify-center rounded-lg border border-dashed border-border text-[12px] text-muted-foreground">
							右键我
						</ContextMenuTrigger>
						<ContextMenuContent>
							<ContextMenuItem>编辑</ContextMenuItem>
							<ContextMenuItem>删除</ContextMenuItem>
						</ContextMenuContent>
					</ContextMenu>
				</Cell>
				<Cell name="Command" hint="命令面板(cmdk)">
					<Command className="w-48 border border-border">
						<CommandInput placeholder="搜索" />
						<CommandList>
							<CommandEmpty>无结果</CommandEmpty>
							<CommandGroup>
								<CommandItem>新建</CommandItem>
								<CommandItem>打开</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</Cell>
				<Cell name="Menubar" hint="顶部菜单栏">
					<Menubar>
						<MenubarMenu>
							<MenubarTrigger>文件</MenubarTrigger>
							<MenubarContent>
								<MenubarItem>新建</MenubarItem>
								<MenubarItem>打开</MenubarItem>
							</MenubarContent>
						</MenubarMenu>
					</Menubar>
				</Cell>
				{TABS_VARIANTS.map((variant: TabVariant) => (
					<Cell key={variant} name={`Tabs · ${TAB_VARIANT_META[variant].label}`} hint={TAB_VARIANT_META[variant].hint}>
						<Tabs variant={variant} defaultValue="all" className="w-full">
							<TabsList>
								<TabsTrigger value="all" count={12}>
									全部
								</TabsTrigger>
								<TabsTrigger value="mine" count={3}>
									我负责的
								</TabsTrigger>
								<TabsTrigger value="done">已完成</TabsTrigger>
							</TabsList>
							<TabsContent value="all" className="text-[12px] text-muted-foreground">
								{variant} 形态的内容区 —— 换 variant 只改容器与选中态,API 完全一致。
							</TabsContent>
							<TabsContent value="mine" className="text-[12px] text-muted-foreground">
								我负责的 3 条。
							</TabsContent>
							<TabsContent value="done" className="text-[12px] text-muted-foreground">
								已完成的内容。
							</TabsContent>
						</Tabs>
					</Cell>
				))}
				<Cell name="Collapsible" hint="折叠">
					<Collapsible open={collapsedOpen} onOpenChange={setCollapsedOpen}>
						<CollapsibleTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							{collapsedOpen ? "收起" : "展开"}
						</CollapsibleTrigger>
						<CollapsibleContent className="pt-2 text-[12px]">被折叠的内容</CollapsibleContent>
					</Collapsible>
				</Cell>
				<Cell name="Reveal" hint="进场动画">
					<Reveal>
						<Badge variant="outline">淡入</Badge>
					</Reveal>
				</Cell>
				<Cell name="Separator" hint="分隔线">
					<div className="w-32">
						<Separator />
					</div>
				</Cell>
			</Group>

			<Group title="日期" desc="单月日历与日期区间选择器长得一样 —— 同一份默认值(中文 + 年月下拉 + 四箭头导航)。">
				<Cell name="Calendar" hint="单月日历(受控)">
					<div className="w-full rounded-lg border border-border bg-card p-2 shadow-card">
						<Calendar mode="single" selected={day} onSelect={setDay} />
					</div>
					<p className="text-[12px] text-muted-foreground">已选:{day ? day.toLocaleDateString("zh-CN") : "—"}</p>
				</Cell>
				<Cell name="DateRangePicker" hint="日期区间(带快捷范围)">
					<DateRangePicker value={range} onChange={setRange} />
					<p className="text-[12px] text-muted-foreground">
						{range.from ?? "—"} ~ {range.to ?? "—"}
					</p>
				</Cell>
			</Group>
		</div>
	);
}
