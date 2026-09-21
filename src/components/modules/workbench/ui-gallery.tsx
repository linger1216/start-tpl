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
 *  - 新增/删除 `ui/` 下的原语时,**同步在这里加减一格**,否则又会退回"孤儿组件"。
 */
import { useState } from "react";
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
import { Button, buttonVariants, MotionButton } from "#/components/ui/button";
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
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { FileDropzone } from "#/components/ui/file-dropzone";
import { Input } from "#/components/ui/input";
import { JsonBlock } from "#/components/ui/json-block";
import { JsonCell } from "#/components/ui/json-cell";
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
import { Skeleton } from "#/components/ui/skeleton";
import { StatCardsSkeleton, TableSkeleton } from "#/components/ui/skeleton-blocks";
import { Slider } from "#/components/ui/slider";
import { Spinner } from "#/components/ui/spinner";
import { StatusBadge, StatusWordBadge } from "#/components/ui/status-badge";
import { Switch } from "#/components/ui/switch";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { TableResizeHandle } from "#/components/ui/table-resize-handle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { TagInput } from "#/components/ui/tag-input";
import { Textarea } from "#/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "#/components/ui/tooltip";

/** 一格:标题 + 说明 + 渲染区 */
function Cell({ name, hint, children }: { name: string; hint?: string; children: React.ReactNode }) {
	return (
		<div className="min-w-0 rounded-xl border border-border bg-card p-3">
			<div className="mb-2 flex items-baseline gap-2">
				<code className="font-mono text-[12px] text-foreground">{name}</code>
				{hint ? <span className="truncate text-[11px] text-muted-foreground">{hint}</span> : null}
			</div>
			<div className="flex flex-wrap items-center gap-2">{children}</div>
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
	const [range, setRange] = useState<{ from?: string; to?: string }>({
		from: "2026-09-01",
		to: "2026-09-07",
	});

	return (
		<div className="space-y-4">
			<Group title="基础录入" desc="表单里最常用的受控原语 —— 每个都给好了 useState,可直接抄进业务页。">
				<Cell name="Input" hint="单行输入">
					<Input placeholder="请输入" className="w-40" />
				</Cell>
				<Cell name="Textarea" hint="多行输入">
					<Textarea placeholder="备注" className="w-40" rows={2} />
				</Cell>
				<Cell name="Label" hint="表单标签">
					<Label htmlFor="g-name">用户名</Label>
					<Input id="g-name" className="w-32" />
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
				<Cell name="Select" hint="下拉选择">
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
				<Cell name="Badge" hint="徽章">
					<Badge>默认</Badge>
					<Badge variant="secondary">次要</Badge>
					<Badge variant="outline">描边</Badge>
				</Cell>
				<Cell name="BadgeList" hint="徽章列表">
					<BadgeList values={["紧急", "已核对"]} />
				</Cell>
				<Cell name="StatusBadge" hint="状态徽章(按 status 数字)">
					<StatusBadge status={1} />
					<StatusBadge status={0} />
				</Cell>
				<Cell name="StatusWordBadge" hint="按文案映射状态">
					<StatusWordBadge value="启用" />
					<StatusWordBadge value="停用" />
				</Cell>
				<Cell name="ScoreText" hint="数值着色">
					<ScoreText value={88} />
					<ScoreText value={42} />
				</Cell>
				<Cell name="JsonBlock" hint="JSON 块">
					<JsonBlock value={{ ok: true, rows: 3 }} />
				</Cell>
				<Cell name="JsonCell" hint="表格里的 JSON 单元格">
					<JsonCell value={["紧急", "已核对"]} />
				</Cell>
				<Cell name="DetailRow" hint="详情一行(标签 + 值)">
					<div className="w-full">
						<DetailRow label="创建人">管理员</DetailRow>
					</div>
				</Cell>
				<Cell name="Avatar" hint="头像">
					<Avatar>
						<AvatarFallback>管</AvatarFallback>
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

			<Group title="浮层与导航" desc="需要触发器的浮层类原语 —— Dialog / Sheet / Popover / 菜单 / 标签页。">
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
				<Cell name="ConfirmDialog" hint="确认删除">
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
						{/* base-ui 的触发器用 render,不是 asChild */}
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
				<Cell name="DropdownMenu" hint="下拉菜单">
					<DropdownMenu>
						<DropdownMenuTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							菜单
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuLabel>操作</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem>编辑</DropdownMenuItem>
							<DropdownMenuItem>删除</DropdownMenuItem>
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
				<Cell name="Tabs" hint="标签页">
					<Tabs defaultValue="a" className="w-48">
						<TabsList>
							<TabsTrigger value="a">A</TabsTrigger>
							<TabsTrigger value="b">B</TabsTrigger>
						</TabsList>
						<TabsContent value="a" className="text-[12px]">
							内容 A
						</TabsContent>
						<TabsContent value="b" className="text-[12px]">
							内容 B
						</TabsContent>
					</Tabs>
				</Cell>
				<Cell name="Collapsible" hint="折叠">
					<Collapsible open={collapsedOpen} onOpenChange={setCollapsedOpen}>
						<CollapsibleTrigger className={buttonVariants({ variant: "outline", size: "sm" })}>
							{collapsedOpen ? "收起" : "展开"}
						</CollapsibleTrigger>
						<CollapsibleContent className="text-[12px]">被折叠的内容</CollapsibleContent>
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

			<Group title="按钮与表格" desc="动作类原语 —— 按钮变体 / 按钮组 / 表格(含列宽拖拽)。">
				<Cell name="Button" hint="变体与尺寸">
					<Button size="sm">默认</Button>
					<Button size="sm" variant="outline">
						描边
					</Button>
					<Button size="sm" variant="ghost">
						幽灵
					</Button>
					<Button size="sm" variant="destructive">
						危险
					</Button>
				</Cell>
				<Cell name="MotionButton" hint="带动效的按钮">
					<MotionButton size="sm">动效</MotionButton>
				</Cell>
				<Cell name="ButtonGroup" hint="按钮组">
					<ButtonGroup>
						<Button size="sm" variant="outline">
							左
						</Button>
						<ButtonGroupSeparator />
						<Button size="sm" variant="outline">
							右
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="ButtonGroupText" hint="按钮组里的文字">
					<ButtonGroup>
						<ButtonGroupText>共 3 条</ButtonGroupText>
						<Button size="sm" variant="outline">
							刷新
						</Button>
					</ButtonGroup>
				</Cell>
				<Cell name="Table" hint="表格(含 caption / footer)">
					<Table>
						<TableCaption>示例表</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead>名称</TableHead>
								<TableHead>数量</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							<TableRow>
								<TableCell>甲</TableCell>
								<TableCell>12</TableCell>
							</TableRow>
						</TableBody>
						<TableFooter>
							<TableRow>
								<TableCell>合计</TableCell>
								<TableCell>12</TableCell>
							</TableRow>
						</TableFooter>
					</Table>
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

			<Group title="日期" desc="日历与日期区间。">
				<Cell name="Calendar" hint="单月日历">
					<Calendar className="rounded-lg border border-border" />
				</Cell>
				<Cell name="DateRangePicker" hint="日期区间">
					<DateRangePicker value={range} onChange={setRange} />
				</Cell>
			</Group>
		</div>
	);
}
