import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DetailMeta } from "#/components/modules/shared/detail-dialog";
import { Button } from "#/components/ui/button";
import { DetailRow } from "#/components/ui/detail-row";
import {
	DIALOG_FIT,
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { SearchSelect } from "#/components/ui/search-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { useTRPC } from "#/integrations/trpc/react";
import {
	DATA_SCOPE_REMARK_MAX,
	formatSubject,
	SUBJECT_ALL,
	SUBJECT_KIND_META,
	type SubjectKind,
} from "#/lib/data-scope-spec";
import type { DataScopeRow } from "./settings-data-scope-table";

export type DataScopeFormPayload = {
	subject: string;
	resource: string;
	column: string | null;
	/** 从插件输出的每行里取哪个 key(m23422);不选插件时为 null */
	valueKey: string | null;
	pluginKey: string | null;
	remark?: string;
};

/** 主体选择器里的下拉顺序 —— 「角色 → 部门 → 用户」是配规则时最常用的排序 */
const SUBJECT_PICK_ORDER = ["role", "dept", "user"] as const satisfies readonly SubjectKind[];

type ResourceOption = {
	table: string;
	label: string;
	pk: string | null;
	columns: Array<{ column: string; label: string; dataType: string }>;
};
type PluginOption = {
	key: string;
	label: string;
	impl: string;
	remark?: string | null;
	/** 这个插件会给哪些 key(m23422)—— 「值域的 key」下拉的选项就是它 */
	valueKeys: string[];
};

const NO_PLUGIN = "__none__";

/**
 * 数据范围规则表单 —— 一份「谁 · 看哪张表的哪些行」的声明。
 *
 * v2 (m20034)起:规则**不再带输出值** —— 清单装在插件自己(`sys_data_plugin.output_values`)里;
 * 这里只存「谁 · 资源表 · 列 · 插件 · key」(m23422 补上 key:一个清单可以放多类值,规则说取哪个)。
 */
export function SettingsDataScopeForm({
	open,
	onOpenChange,
	creating,
	row,
	pending,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (next: boolean) => void;
	creating: boolean;
	row: DataScopeRow | null;
	pending: boolean;
	onSubmit: (payload: DataScopeFormPayload) => void;
}) {
	const trpc = useTRPC();
	const rolesQuery = useQuery(trpc.role.list.queryOptions());
	const deptsQuery = useQuery(trpc.department.tree.queryOptions());
	const usersQuery = useQuery(trpc.user.list.queryOptions());
	const resourcesQuery = useQuery(trpc.dataScope.resources.queryOptions());
	// 数据范围规则的「可选插件」下拉用 data-scope 路由的 `plugins` —— 它返回平铺数组;
	// data-scope 页面自己的权限点,不强制超管(数据权限本就是授给"管权限的人"的活)。
	// ❌ 不要换回 `dataPlugin.list`,后者(v1.3 起)返 `{ builtin, custom }`,这里按数组 `.map` 会炸。
	const pluginsQuery = useQuery(trpc.dataScope.plugins.queryOptions());

	const resources = (resourcesQuery.data ?? []) as ResourceOption[];
	const plugins = (pluginsQuery.data ?? []) as PluginOption[];

	const [subjectKind, setSubjectKind] = useState<SubjectKind | "all">("all");
	const [subjectId, setSubjectId] = useState("");
	const [resource, setResource] = useState("");
	const [column, setColumn] = useState("");
	const [valueKey, setValueKey] = useState("");
	const [pluginKey, setPluginKey] = useState("");
	const [remark, setRemark] = useState("");

	useEffect(() => {
		if (!open) return;
		if (creating) {
			setSubjectKind("all");
			setSubjectId("");
			setResource("");
			setColumn("");
			setValueKey("");
			setPluginKey("");
			setRemark("");
			return;
		}
		if (!row) return;
		const at = row.subject.indexOf(":");
		const kind = (at > 0 ? row.subject.slice(0, at) : "all") as SubjectKind | "all";
		setSubjectKind(kind);
		setSubjectId(at > 0 ? row.subject.slice(at + 1) : "");
		setResource(row.resource);
		setColumn(row.column ?? "");
		setValueKey(row.valueKey ?? "");
		setPluginKey(row.pluginKey ?? "");
		setRemark(row.remark);
	}, [open, creating, row]);

	const subjectItems = [
		{ value: "all", label: SUBJECT_KIND_META.all },
		...SUBJECT_PICK_ORDER.map((kind) => ({ value: kind, label: SUBJECT_KIND_META[kind] })),
	];

	const entityItems = (() => {
		if (subjectKind === "role") {
			return ((rolesQuery.data ?? []) as Array<{ id: string; name: string }>).map((item) => ({
				value: item.id,
				label: `${item.name}(${item.id})`,
			}));
		}
		if (subjectKind === "dept") {
			return ((deptsQuery.data ?? []) as Array<{ id: string; name: string }>).map((item) => ({
				value: item.id,
				label: `${item.name}(${item.id})`,
			}));
		}
		if (subjectKind === "user") {
			return ((usersQuery.data ?? []) as Array<{ id: string; name: string; email: string }>).map((item) => ({
				value: item.id,
				label: `${item.name} · ${item.email}`,
			}));
		}
		return [];
	})();

	const resourceItems = resources.map((item) => ({ value: item.table, label: item.label }));
	const meta = resources.find((item) => item.table === resource) ?? null;

	// v2 (m20034)起:清单不再在规则上,装在插件自己里 —— 规则下拉列**所有**已装插件
	// (内置 4 个 + 用户自建的),其中「指定清单」类(`fixed` / 用户自建)的清单在插件表单上编辑。
	const pluginItems = plugins.map((item) => ({
		value: item.key,
		label: `${item.label}(${item.impl === "builtin" ? "内置" : "自定义"})`,
	}));

	const columnItems = (meta?.columns ?? []).map((item) => ({
		value: item.column,
		label: item.label,
	}));

	// m23422:「值域的 key」的选项来自**插件自己声明的** `valueKeys`(内置的写死在代码里,自建的按清单去重),
	// 所以离线就能渲染成真下拉 —— 不必为了拿候选去试跑一次(管理员可能一行都取不到)。
	const valueKeyItems = (plugins.find((item) => item.key === pluginKey)?.valueKeys ?? []).map((key) => ({
		value: key,
		label: key,
	}));

	const subject = subjectKind === "all" ? SUBJECT_ALL : subjectId ? formatSubject(subjectKind, subjectId) : "";

	const submitProblem = (() => {
		if (!subject) return "先选具体是哪个角色 / 部门 / 用户";
		if (!resource) return "先选一张资源表";
		// v2 (m20034)起:清单(输出值)整个装在插件上,规则只挑一列 —— 所以只要有插件就必须选列。
		// 与后端 `validatePolicyCombo()` 同口径(以前 `fixed` 单独开后门,那个后门是 v1.5 的遗留,已删)。
		if (pluginKey && !column) return "这个插件给的是值,必须再选一列";
		// m23422:插件声明了会给的 key ⇒ 必须挑一个,不然取不到值(失败关闭,一行也看不到)
		if (pluginKey && valueKeyItems.length > 0 && !valueKey) return "这个插件给的是值,还得选一个 key";
		return null;
	})();

	function handleSubmit() {
		if (submitProblem) return;
		onSubmit({
			subject,
			resource,
			column: pluginKey ? column : null,
			valueKey: pluginKey && valueKey ? valueKey : null,
			pluginKey: pluginKey || null,
			remark: remark || undefined,
		});
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (pending) return;
				onOpenChange(next);
			}}
		>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{creating ? "新增数据范围规则" : "修改数据范围规则"}</DialogTitle>
					<DialogDescription>
						规则说的是「谁 · 看哪张表的哪些行」。行是由值域插件算出来的值集合 —— 规则里不存人,所以调岗 /
						换角色不用回来改。
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="flex flex-col gap-3">
					<DetailRow label="谁" htmlFor="scope-kind">
						<div className="flex flex-col gap-2">
							<Select
								items={subjectItems}
								value={subjectKind}
								onValueChange={(next) => {
									setSubjectKind(next as SubjectKind | "all");
									setSubjectId("");
								}}
							>
								<SelectTrigger id="scope-kind" size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{subjectItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{subjectKind === "all" ? (
								<p className="text-xs text-muted-foreground">
									所有人 —— 这条规则对每个登录用户生效(通常用在"这张表全都能看")。
								</p>
							) : (
								<SearchSelect
									value={subjectId || undefined}
									onValueChange={setSubjectId}
									options={entityItems}
									placeholder="搜名字或 ID"
									loading={rolesQuery.isLoading || deptsQuery.isLoading || usersQuery.isLoading}
								/>
							)}
						</div>
					</DetailRow>

					<DetailRow label="资源表" htmlFor="scope-resource">
						<div className="flex flex-col gap-1.5">
							<Select
								items={resourceItems}
								value={resource}
								onValueChange={(next) => {
									setResource(next ?? "");
									setColumn("");
								}}
							>
								<SelectTrigger id="scope-resource" size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{resourceItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{meta ? (
								<p className="text-xs text-muted-foreground">
									主键 <span className="font-mono">{meta.pk ?? "读不到"}</span> · {meta.columns.length} 个字段
								</p>
							) : null}
						</div>
					</DetailRow>

					<DetailRow label="值域插件" htmlFor="scope-plugin">
						<div className="flex flex-col gap-1.5">
							<Select
								items={[{ value: NO_PLUGIN, label: "不用插件(整类可见)" }, ...pluginItems]}
								value={pluginKey || NO_PLUGIN}
								onValueChange={(next) => {
									const key = !next || next === NO_PLUGIN ? "" : next;
									setPluginKey(key);
									setColumn("");
									// m23422:换插件就把 key 落到新插件的第一个(它声明了什么就给什么,省一次手点)
									setValueKey(plugins.find((item) => item.key === key)?.valueKeys[0] ?? "");
								}}
							>
								<SelectTrigger id="scope-plugin" size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_PLUGIN}>不用插件(整类可见)</SelectItem>
									{pluginItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{!pluginKey
									? "不筛行:这张表的全部行都对上面选的那个人可见。"
									: "这个插件给的是「值」,下面还得选一列 + 一个 key 来接 —— v2 起清单在插件自己的页面里编辑。"}
							</p>
						</div>
					</DetailRow>

					{pluginKey ? (
						<DetailRow label="判据列" htmlFor="scope-column">
							<Select items={columnItems} value={column} onValueChange={(next) => setColumn(next ?? "")}>
								<SelectTrigger id="scope-column" size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{columnItems.map((item) => (
										<SelectItem key={item.value} value={item.value}>
											{item.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</DetailRow>
					) : null}

					{pluginKey && valueKeyItems.length > 0 ? (
						<DetailRow label="值域的 key" htmlFor="scope-value-key">
							<div className="flex flex-col gap-1.5">
								<Select items={valueKeyItems} value={valueKey} onValueChange={(next) => setValueKey(next ?? "")}>
									<SelectTrigger id="scope-value-key" size="sm" className="w-full">
										<SelectValue placeholder="选一个 key" />
									</SelectTrigger>
									<SelectContent>
										{valueKeyItems.map((item) => (
											<SelectItem key={item.value} value={item.value}>
												{item.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<p className="text-xs text-muted-foreground">
									插件每行形如 <span className="font-mono">{"{key: value}"}</span>,这里选拿哪个 key 的值去和上面的列比
									—— 一个清单可以放多类值,各配一条规则互不干扰。
								</p>
							</div>
						</DetailRow>
					) : null}

					<DetailRow label="说明" htmlFor="scope-remark">
						<Input
							id="scope-remark"
							value={remark}
							maxLength={DATA_SCOPE_REMARK_MAX}
							onChange={(event) => setRemark(event.target.value)}
						/>
					</DetailRow>
				</DialogBody>

				{submitProblem ? <p className="text-xs text-destructive">{submitProblem}</p> : null}

				<DialogFooter>
					{creating ? null : <DetailMeta meta={{ createdAt: row?.createdAt, updatedAt: row?.updatedAt }} />}
					<Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button type="button" disabled={Boolean(submitProblem) || pending} onClick={handleSubmit}>
						{pending ? "保存中…" : creating ? "创建" : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
