import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import type { MultiSelectOption } from "#/components/ui/multi-select";
import { TagList } from "#/components/ui/tag-list";
import { useTRPC } from "#/integrations/trpc/react";
import { cn } from "#/lib/utils";

type Department = { id: string; parentId: string | null; name: string };

/** 部门树选人：支持跨部门选择、姓名搜索和移除已选人员。 */
export function DepartmentUserSelect({
	options,
	value,
	onChange,
	disabled = false,
	compact = false,
}: {
	options: readonly MultiSelectOption[];
	value: string[];
	onChange: (next: string[]) => void;
	disabled?: boolean;
	/** 嵌入较窄的表单弹窗时压缩树的高度和层级缩进。 */
	compact?: boolean;
}) {
	const trpc = useTRPC();
	const departments = useQuery(trpc.department.tree.queryOptions());
	const users = useQuery(trpc.user.list.queryOptions());
	const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
	const [keyword, setKeyword] = useState("");
	const search = keyword.trim().toLocaleLowerCase();
	const optionsById = useMemo(() => new Map(options.map((option) => [option.value, option])), [options]);
	const selected = useMemo(() => new Set(value), [value]);
	const { grouped, members, unassigned } = useMemo(() => {
		const grouped = new Map<string | null, Department[]>();
		const members = new Map<string, MultiSelectOption[]>();
		const unassigned: MultiSelectOption[] = [];
		const rows = departments.data ?? [];
		const ids = new Set(rows.map((row) => row.id));
		for (const row of rows) {
			const parent = row.parentId && ids.has(row.parentId) ? row.parentId : null;
			const group = grouped.get(parent) ?? [];
			group.push(row);
			grouped.set(parent, group);
		}
		for (const user of users.data ?? []) {
			const option = optionsById.get(user.id);
			if (!option) continue;
			const valid = user.departmentIds.filter((id) => ids.has(id));
			if (!valid.length) unassigned.push(option);
			for (const id of valid) {
				const list = members.get(id) ?? [];
				list.push(option);
				members.set(id, list);
			}
		}
		return { grouped, members, unassigned };
	}, [departments.data, users.data, optionsById]);
	const toggle = (id: string, checked: boolean) =>
		onChange(checked ? [...value.filter((item) => item !== id), id] : value.filter((item) => item !== id));
	const searchResult = useMemo(() => {
		const visible = new Set<string>();
		const matchedDepartments = new Set<string>();
		const matchedPeople = new Set<string>();
		if (!search) return { visible, matchedDepartments, matchedPeople };
		const rows = departments.data ?? [];
		const byId = new Map(rows.map((row) => [row.id, row]));
		const addAncestors = (id: string) => {
			const seen = new Set<string>();
			let current: string | null = id;
			while (current && !seen.has(current)) {
				seen.add(current);
				visible.add(current);
				current = byId.get(current)?.parentId ?? null;
			}
		};
		for (const dept of rows) {
			if (!dept.name.toLocaleLowerCase().includes(search)) continue;
			const pending = [dept.id];
			while (pending.length) {
				const id = pending.pop();
				if (!id || matchedDepartments.has(id)) continue;
				matchedDepartments.add(id);
				addAncestors(id);
				for (const child of grouped.get(id) ?? []) pending.push(child.id);
			}
		}
		for (const user of users.data ?? []) {
			const option = optionsById.get(user.id);
			if (!option || !`${option.label} ${option.hint ?? ""}`.toLocaleLowerCase().includes(search)) continue;
			matchedPeople.add(user.id);
			for (const id of user.departmentIds) addAncestors(id);
		}
		return { visible, matchedDepartments, matchedPeople };
	}, [search, departments.data, grouped, users.data, optionsById]);
	const person = (option: MultiSelectOption) => (
		<div
			key={option.value}
			className="flex min-w-0 cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
		>
			<Checkbox
				aria-label={`选择${option.label}`}
				checked={selected.has(option.value)}
				disabled={disabled}
				onCheckedChange={(checked) => toggle(option.value, checked === true)}
			/>
			<button
				type="button"
				disabled={disabled}
				className="min-w-0 break-words text-left"
				onClick={() => toggle(option.value, !selected.has(option.value))}
			>
				{option.label}
			</button>
			{option.hint ? <span className="truncate text-xs text-muted-foreground">{option.hint}</span> : null}
		</div>
	);
	const branch = (parent: string | null, ancestors: Set<string>): React.ReactNode =>
		(grouped.get(parent) ?? []).map((dept) => {
			if (ancestors.has(dept.id)) return null;
			if (search && !searchResult.visible.has(dept.id)) return null;
			const next = new Set(ancestors).add(dept.id);
			const open = search ? !expanded.has(dept.id) : expanded.has(dept.id);
			const people = (members.get(dept.id) ?? []).filter(
				(option) =>
					!search || searchResult.matchedDepartments.has(dept.id) || searchResult.matchedPeople.has(option.value),
			);
			return (
				<div key={dept.id} className={cn("min-w-0", compact ? "pl-1" : "pl-2")}>
					<button
						type="button"
						aria-expanded={open}
						disabled={disabled}
						className="flex w-full items-center gap-1 rounded px-1 py-1.5 text-left text-sm hover:bg-muted"
						onClick={() =>
							setExpanded((current) => {
								const updated = new Set(current);
								if (updated.has(dept.id)) updated.delete(dept.id);
								else updated.add(dept.id);
								return updated;
							})
						}
					>
						{open ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />}
						<span className="min-w-0 break-words" title={dept.name}>
							{dept.name}
						</span>
					</button>
					{open ? (
						<div className={cn("min-w-0 border-l border-border pl-1", compact ? "ml-1.5" : "ml-3")}>
							{people.map(person)}
							{branch(dept.id, next)}
							{!(members.get(dept.id)?.length || grouped.get(dept.id)?.length) ? (
								<p className="px-2 py-1 text-xs text-muted-foreground">暂无可选人员</p>
							) : null}
						</div>
					) : null}
				</div>
			);
		});
	const unassignedMatches = search
		? unassigned.filter((option) => searchResult.matchedPeople.has(option.value))
		: unassigned;
	return (
		<div className={cn("grid min-w-0", compact ? "gap-2" : "gap-3")}>
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					aria-label="搜索人员或部门"
					placeholder="搜索姓名或部门"
					value={keyword}
					onChange={(event) => {
						setKeyword(event.target.value);
						setExpanded(new Set());
					}}
					className="w-full pl-9 pr-9"
					disabled={disabled}
				/>
				{keyword ? (
					<button
						type="button"
						aria-label="清空搜索"
						title="清空搜索"
						className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded hover:bg-muted"
						onClick={() => {
							setKeyword("");
							setExpanded(new Set());
						}}
					>
						<X className="size-4" />
					</button>
				) : null}
			</div>
			<div
				className={cn(
					"min-w-0 overflow-auto rounded-md border border-border p-2",
					compact ? "h-[min(14rem,28vh)]" : "h-[min(24rem,40vh)]",
				)}
			>
				{departments.isPending || users.isPending ? (
					<p className="p-2 text-sm text-muted-foreground">正在加载人员…</p>
				) : departments.isError || users.isError ? (
					<p className="p-2 text-sm text-destructive">人员或部门加载失败，请重试。</p>
				) : search && searchResult.visible.size === 0 && unassignedMatches.length === 0 ? (
					<p className="p-2 text-sm text-muted-foreground">没有匹配的部门或人员</p>
				) : (
					<>
						{branch(null, new Set())}
						{unassignedMatches.length ? (
							<details open={search ? true : undefined}>
								<summary className="cursor-pointer px-2 py-1.5 text-sm">未分配部门</summary>
								{unassignedMatches.map(person)}
							</details>
						) : null}
					</>
				)}
			</div>
			<div className="min-w-0">
				<p className="mb-2 text-xs text-muted-foreground">已选 {value.length} 人</p>
				<div className={cn("overflow-y-auto", compact ? "max-h-12" : "max-h-20")}>
					<TagList
						layout="wrap"
						values={value.map((id) => optionsById.get(id)?.label ?? id)}
						onRemove={disabled ? undefined : (index) => onChange(value.filter((_, i) => i !== index))}
						emptyPlaceholder="请选择人员"
					/>
				</div>
			</div>
		</div>
	);
}
