import { useState } from "react";
import { toast } from "sonner";

import { PropTable, ShowcaseItem, ShowcasePage, ShowcaseSection } from "#/components/layout/showcase";
import { FieldHint, FormSection, LabeledField, useAppForm } from "#/components/modules/shared/form-kit";
import { TagFieldInput } from "#/components/modules/shared/tag-badges";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { DateRangePicker, type DateRangeValue } from "#/components/ui/date-range-picker";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { NumField } from "#/components/ui/num-field";
import { RateSlider } from "#/components/ui/rate-slider";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { Separator } from "#/components/ui/separator";
import { Slider } from "#/components/ui/slider";
import { Switch } from "#/components/ui/switch";
import { type TagEntry, TagInput } from "#/components/ui/tag-input";
import { Textarea } from "#/components/ui/textarea";

/**
 * 表单组件展示页 —— 两层:
 *
 *  1. **无状态控件**(Input / Select / Checkbox…):只收 `value` + `onChange`,不认识表单库;
 *  2. **`form-kit` 接线层**:把控件挂到 TanStack Form 的 field context 上,一次注册、全站复用。
 *
 * 这两层是刻意的分工 —— 控件不该知道"值存在哪",而 40 个弹窗的"标签 + 控件 + 错误"排版
 * 完全一致,该由 form-kit 统一。**不要**为了省事把业务校验塞进控件。
 */

/** 控件的受控演示:每个例子自己持一份小 state */
function StatefulDemo({
	children,
}: {
	children: (api: { value: string; setValue: (v: string) => void }) => React.ReactNode;
}) {
	const [value, setValue] = useState("");
	return <>{children({ value, setValue })}</>;
}

function FormKitDemo() {
	const form = useAppForm({
		defaultValues: {
			名称: "",
			备注: "",
			级别: "一级",
			标签: [] as string[],
			优先级: 5 as number | null,
			接入方式: 1 as number | string,
			责任人: "",
		},
		onSubmit: ({ value }) => {
			toast.success("表单已通过校验", { description: JSON.stringify(value) });
		},
	});

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				form.handleSubmit();
			}}
			className="space-y-4"
		>
			<div className="grid gap-3 sm:grid-cols-2">
				<form.AppField name="名称">
					{(field) => <field.TextField label="名称" required placeholder="必填项" />}
				</form.AppField>
				<form.AppField name="备注">{(field) => <field.TextAreaField label="备注" rows={2} />}</form.AppField>
				<form.AppField name="级别">
					{(field) => <field.SelectField label="级别" values={["一级", "二级", "三级"]} required />}
				</form.AppField>
				<form.AppField name="责任人">
					{(field) => (
						<field.RefSelectField
							label="责任人"
							options={[
								{ value: "USER-01", label: "张三(综合科)" },
								{ value: "USER-02", label: "李四(执法队)" },
							]}
						/>
					)}
				</form.AppField>
				<form.AppField name="标签">
					{(field) => <field.TagField label="标签" options={["重点监管", "消防安全", "食品安全", "燃气安全"]} />}
				</form.AppField>
				<form.AppField name="优先级">
					{(field) => <field.NumberField label="优先级" min={0} max={99} hint="数值越大优先级越高" />}
				</form.AppField>
			</div>
			<form.AppField name="接入方式">
				{(field) => (
					<field.RadioField
						label="接入方式"
						columns={2}
						options={[
							{ value: 1, label: "库表直读", description: "直连对方数据库,按增量字段拉取" },
							{ value: 2, label: "接口拉取", description: "调对方 HTTP 接口,分页翻取" },
						]}
					/>
				)}
			</form.AppField>

			<Separator />
			<div className="flex items-center gap-2">
				<form.AppForm>
					<form.SubmitButton label="提交" />
				</form.AppForm>
				<Button type="button" variant="ghost" onClick={() => form.reset()}>
					重置
				</Button>
				<span className="text-[12px] text-muted-foreground">
					点「提交」会先跑校验:只填名称也能过,但名称留空会看到字段下方的红色错误文案。
				</span>
			</div>
		</form>
	);
}

export function ShowcaseFormPage() {
	return (
		<ShowcasePage
			title="表单组件"
			description="无状态控件 + form-kit 接线层。form-kit 解决的是「40 个弹窗把同一段标签/控件/错误排版抄 40 遍」的问题,不是「用声明式配置生成表单」。"
			toc={[
				["formkit", "form-kit 接线层"],
				["text", "文本类"],
				["choice", "选择类"],
				["number", "数值类"],
				["date", "日期类"],
				["layout", "分组与排版"],
			]}
		>
			<ShowcaseSection
				id="formkit"
				title="form-kit 接线层"
				description="注册在 useAppForm 上的 7 个字段组件 + 1 个提交按钮。字段的排版(标签在上、错误在下)、值类型转换、以及 isSubmitting 订阅全在这里,各业务表单不用重复。"
			>
				<ShowcaseItem
					name="useAppForm + AppField"
					summary="一个能跑的真实表单"
					source="modules/shared/form-kit.tsx"
					note={
						<>
							值类型约定:<code className="font-mono">TextField/TextAreaField/SelectField/RefSelectField</code> 是{" "}
							<code className="font-mono">string</code>;<code className="font-mono">TagField</code> 是{" "}
							<code className="font-mono">string[]</code>;<code className="font-mono">NumberField</code> 是{" "}
							<code className="font-mono">number | null</code>(空串写回 <code className="font-mono">null</code>
							,「没填」与「填了 0」是两件事)。 数字化发生在各域 <code className="font-mono">-form-mappers.ts</code>
							,不在控件里。
						</>
					}
					demo={<FormKitDemo />}
					code={`const form = useAppForm({
  defaultValues: toForm(initial),
  validators: { onSubmit: workFormSchema },
  onSubmit: ({ value }) => onSubmit(toSubmit(value)),
});

<form.AppField name="名称">{(field) => <field.TextField label="名称" required />}</form.AppField>
<form.AppField name="标签">{(field) => <field.TagField label="标签" options={TAGS} />}</form.AppField>

<form.AppForm><form.SubmitButton label="保存" /></form.AppForm>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="text" title="文本类" description="受控、无状态。校验与错误展示由 form-kit 或调用方负责。">
				<ShowcaseItem
					name="Input · Textarea · Label"
					summary="单行 / 多行 / 标签"
					source="ui/input.tsx · ui/textarea.tsx · ui/label.tsx"
					dense
					demo={
						<StatefulDemo>
							{({ value, setValue }) => (
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="space-y-1.5">
										<Label htmlFor="demo-input">单行文本</Label>
										<Input
											id="demo-input"
											value={value}
											onChange={(e) => setValue(e.target.value)}
											placeholder="请输入"
										/>
									</div>
									<div className="space-y-1.5">
										<Label>数字类型</Label>
										<Input type="number" inputMode="numeric" min={0} max={999} placeholder="0" />
									</div>
									<div className="space-y-1.5 sm:col-span-2">
										<Label>多行文本</Label>
										<Textarea rows={2} placeholder="最多 200 字" />
									</div>
									<div className="space-y-1.5 sm:col-span-2">
										<Label>错误态(aria-invalid)</Label>
										<Input aria-invalid defaultValue="值不合法" />
										<p className="text-[12px] font-medium text-destructive">该字段格式不正确</p>
									</div>
								</div>
							)}
						</StatefulDemo>
					}
					code={`<Label htmlFor={id}>名称</Label>
<Input id={id} value={value} onChange={e => setValue(e.target.value)} />
<Input aria-invalid={hasError} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="choice"
				title="选择类"
				description="从最轻到最重:Checkbox / Switch → Select(原生语义)→ SearchSelect(可搜索)→ TagInput(多值)。枚举值少用 Select,超过 ~10 项用 SearchSelect。"
			>
				<ShowcaseItem
					name="Checkbox · Switch"
					summary="布尔控件"
					source="ui/checkbox.tsx · ui/switch.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-6">
							<span className="flex items-center gap-2 text-[13px]">
								<Checkbox aria-label="记住我的选择" checked onCheckedChange={() => {}} />
								记住我的选择
							</span>
							<span className="flex items-center gap-2 text-[13px]">
								<Checkbox aria-label="未选中" />
								未选中
							</span>
							<span className="flex items-center gap-2 text-[13px]">
								<Checkbox aria-label="禁用" disabled />
								禁用
							</span>
							<span className="flex items-center gap-2 text-[13px]">
								<Switch checked onCheckedChange={() => {}} />
								启用同步
							</span>
						</div>
					}
					code={`<Checkbox checked={on} onCheckedChange={(v) => setOn(v === true)} />
<Switch checked={on} onCheckedChange={setOn} />`}
				/>

				<ShowcaseItem
					name="Select"
					summary="原生语义下拉(项数少、不需要搜索)"
					source="ui/select.tsx"
					dense
					demo={
						<div className="flex flex-wrap items-center gap-3">
							<Select defaultValue="一级">
								<SelectTrigger className="w-40">
									<SelectValue placeholder="请选择级别" />
								</SelectTrigger>
								<SelectContent>
									{["一级", "二级", "三级"].map((item) => (
										<SelectItem key={item} value={item}>
											{item}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<span className="text-[12px] text-muted-foreground">
								项数多 / 需要键入过滤时改用 <code className="font-mono">SearchSelect</code>
							</span>
						</div>
					}
					code={`<Select value={v} onValueChange={setV}>
  <SelectTrigger className="w-40"><SelectValue placeholder="请选择" /></SelectTrigger>
  <SelectContent>{options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
</Select>`}
				/>

				<ShowcaseItem
					name="SearchSelect"
					summary="可搜索下拉,泛型收窄值类型"
					source="ui/search-select.tsx"
					note={
						<>
							<code className="font-mono">value</code> 用 <code className="font-mono">undefined</code> 表示"未选择"
							(不是空串)。<code className="font-mono">triggerClassName=&quot;h-9 w-full&quot;</code>{" "}
							是表单里的标准写法,让它和 Input 等高对齐。
						</>
					}
					demo={
						<StatefulDemo>
							{({ value, setValue }) => (
								<div className="flex flex-wrap items-center gap-3">
									<SearchSelect
										value={value || undefined}
										onValueChange={setValue}
										options={[
											"企业档案",
											"人员档案",
											"地点档案",
											"案件档案",
											"小额工程档案",
											"示例档案类型",
											"户外广告档案",
										].map((item) => ({ value: item, label: item }))}
										placeholder="选择档案类型(可键入搜索)"
										triggerClassName="h-9 w-64"
									/>
									<span className="text-[12px] text-muted-foreground">当前值:{value || "(未选择)"}</span>
								</div>
							)}
						</StatefulDemo>
					}
					code={`<SearchSelect
  value={value || undefined}
  onValueChange={setValue}
  options={items.map(i => ({ value: i, label: i }))}
  triggerClassName="h-9 w-full"
/>`}
				/>

				<ShowcaseItem
					name="TagInput"
					summary="多值标签输入(回车 / 逗号 / JSON 数组一次展开)"
					source="ui/tag-input.tsx"
					note="值类型是 { value }[] 而不是 string[] —— 表单里的 string[] ↔ TagEntry[] 转换收在 form-kit 的 TagField 里。"
					demo={<TagInputDemo />}
					code={`<TagInput
  value={value}
  onChange={setValue}
  max={12}
  enableCopy
  copySeparator=","
/>`}
				/>
				<ShowcaseItem
					name="TagFieldInput"
					summary="TagInput + 候选标签快选(现场标签常超出枚举时用)"
					source="shared/tag-badges.tsx"
					note={
						<>
							候选标签做成可点选的快捷按钮,同时<strong className="text-foreground">保留自由输入</strong> ——
							真实场景里标签既有一份权威清单,又经常冒出新值。候选清单由调用方传入(不给就只渲染输入框)。
						</>
					}
					demo={<TagFieldInputDemo />}
					code={`<TagFieldInput
  value={tags}
  onChange={setTags}
  options={["重点监管", "消防安全", "食品安全", "夜间施工"]}
  max={12}
/>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="number"
				title="数值类"
				description="滑动与步进。数值控件一律带 clamp,不要把非法值放进 state。"
			>
				<ShowcaseItem
					name="Slider · RateSlider · NumField"
					summary="滑动条 / 比率滑动 / 紧凑数字框"
					source="ui/slider.tsx · ui/rate-slider.tsx · ui/num-field.tsx"
					dense
					demo={<NumberDemo />}
					code={`<NumField value={n} onChange={setN} min={0} max={999} />
<RateSlider label="置信度" value={rate} onChange={setRate} />
<Slider value={[n]} min={0} max={100} step={5} onValueChange={v => setN(sliderNumber(v))} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="date"
				title="日期类"
				description="DateRangePicker 自带快捷范围(近 7 天 / 本月…),值是 ISO 字符串而不是 Date 对象。"
			>
				<ShowcaseItem
					name="DateRangePicker"
					summary="区间选择器 + 快捷预设"
					source="ui/date-range-picker.tsx"
					note="值形状 { from?: string; to?: string },传给接口前不用再格式化。窄列表列里用「本地分钟」口径,见 lib/time.ts。"
					demo={<DateRangeDemo />}
					code={`const [range, setRange] = useState<DateRangeValue>({});
<DateRangePicker value={range} onChange={setRange} />`}
				/>
			</ShowcaseSection>

			<ShowcaseSection
				id="layout"
				title="分组与排版"
				description="字段数超过 8 个的表单才需要它们 —— 否则说明文字会把面板堆成墙。"
			>
				<ShowcaseItem
					name="FormSection · LabeledField · FieldHint"
					summary="分组标题线 + 带 hover 说明的字段位 + 两行说明写法"
					source="modules/shared/form-kit.tsx"
					note={
						<>
							<code className="font-mono">FieldHint</code> 的写法是强制的两行:<code className="font-mono">spec</code>{" "}
							写「参数=值」,
							<code className="font-mono">effect</code> 写它落到哪个 SQL / query 参数上。不要写科普语气。
						</>
					}
					demo={
						<div className="space-y-4 rounded-xl border border-border p-3.5">
							<FormSection title="连接配置" columns={3}>
								<LabeledField label="主机地址">
									<Input className="h-8" defaultValue="10.0.0.21" />
								</LabeledField>
								<LabeledField
									label="首次同步口径"
									hint={<FieldHint spec="firstFull=false" effect="true → 不传 from,只带 to;false → 按增量窗口拉" />}
								>
									<Input className="h-8" defaultValue="false" />
								</LabeledField>
								<LabeledField label="分页大小" hint={<FieldHint spec="pageSize=500" effect="→ SQL LIMIT 500" />}>
									<Input className="h-8" defaultValue="500" />
								</LabeledField>
							</FormSection>

							<FormSection title="增量配置" columns={2} description="(留空 = 全量)">
								<LabeledField label="增量字段">
									<Input className="h-8" defaultValue="update_time" />
								</LabeledField>
								<LabeledField label="回退窗口">
									<Input className="h-8" defaultValue="5" />
								</LabeledField>
							</FormSection>
						</div>
					}
					code={`<FormSection title="连接配置" columns={3}>
  <LabeledField label="主机地址"><Input className="h-8" /></LabeledField>
  <LabeledField label="首次同步口径" hint={<FieldHint spec="firstFull=false" effect="true → 不传 from" />}>
    <Input className="h-8" />
  </LabeledField>
</FormSection>`}
				/>
			</ShowcaseSection>

			<ShowcaseSection id="api" title="字段速查" description="写业务表单时对着这张表挑控件。">
				<PropTable
					rows={[
						{
							name: "TextField / TextAreaField",
							type: "string",
							note: '单行 / 多行文本。TextField 支持 type="text" | "number" | "date"',
						},
						{ name: "SelectField", type: "string", note: "「值即文案」的自在枚举;空串表示未选择" },
						{ name: "RefSelectField", type: "string", note: "值与文案不同(部门 id / 部门名);值仍以字符串落库" },
						{ name: "TagField", type: "string[]", note: "多值;内部转 TagEntry[],候选标签点一下即加" },
						{ name: "NumberField", type: "number | null", note: "空串写回 null;超界即 clamp 到 min/max" },
						{ name: "RadioField", type: "与选项 value 同型", note: "卡片式单选,可带 description;不做字符串化" },
						{ name: "SubmitButton", type: "—", note: "订阅 isSubmitting,提交中自动禁用并显示「保存中…」" },
						{ name: "FieldRow", type: "—", note: "自研复合字段复用它做错误排版,不要各写一套" },
						{ name: "fieldMessages(errors)", type: "FieldError[]", note: "过滤掉 TanStack Form 的 undefined 错误项" },
					]}
				/>
			</ShowcaseSection>
		</ShowcasePage>
	);
}

/** TagFieldInput 的候选标签示例(真实项目里通常来自字典或标签体系表) */
const TAG_CANDIDATES = ["重点监管", "消防安全", "食品安全", "夜间施工", "流动"] as const;

function TagFieldInputDemo() {
	const [tags, setTags] = useState<TagEntry[]>([]);
	return (
		<div className="max-w-xl">
			<TagFieldInput value={tags} onChange={setTags} options={TAG_CANDIDATES} max={12} />
		</div>
	);
}

function TagInputDemo() {
	const [tags, setTags] = useState<TagEntry[]>([{ value: "重点监管" }]);
	return (
		<div className="max-w-xl space-y-1.5">
			<TagInput
				value={tags}
				onChange={setTags}
				max={8}
				enableCopy
				placeholder="输入标签后回车,或粘贴逗号分隔的多个值"
			/>
			<p className="text-[12px] text-muted-foreground">
				当前 {tags.length} 个:{tags.map((t) => t.value).join("、") || "(空)"}
			</p>
		</div>
	);
}

function NumberDemo() {
	const [n, setN] = useState(12);
	const [rate, setRate] = useState(60);
	return (
		<div className="flex flex-wrap items-center gap-6">
			<div className="flex items-center gap-2">
				<span className="text-[12px] text-muted-foreground">NumField</span>
				<NumField value={n} onChange={setN} min={0} max={999} />
			</div>
			<RateSlider label="置信度" value={rate} onChange={setRate} />
			<div className="flex items-center gap-2">
				<span className="text-[12px] text-muted-foreground">Slider</span>
				<div className="w-40">
					<Slider
						value={n}
						min={0}
						max={100}
						step={5}
						onValueChange={(v) => setN(Array.isArray(v) ? (v[0] ?? 0) : v)}
					/>
				</div>
				<span className="w-8 text-right text-[12px] tabular-nums text-muted-foreground">{n}</span>
			</div>
		</div>
	);
}

function DateRangeDemo() {
	const [range, setRange] = useState<DateRangeValue>({});
	return (
		<div className="flex flex-wrap items-center gap-3">
			<DateRangePicker value={range} onChange={setRange} />
			<span className="font-mono text-[12px] text-muted-foreground">
				{range.from ?? "—"} ~ {range.to ?? "—"}
			</span>
		</div>
	);
}
