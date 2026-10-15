import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Tag as TagIcon, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "#/components/ui/select";
import { writeError, writeSuccess } from "#/hooks/use-ledger-write";
import { useTRPC } from "#/integrations/trpc/react";

/**
 * 工作台 · **打标签**示例(标签 ↔ 业务对象 的多态多对多)。
 *
 * 这是 `sys_tag_relation` 那几个接口唯一的界面消费方,所以它的职责就是把用法演示清楚:
 *  · `tag.list`            → 取标签树(只拿叶子当可选项:维度是分类,不贴到对象上);
 *  · `tagsOfObject`        → 这个对象身上有哪些标签(带标签名,直接渲染);
 *  · `tag.link` / `unlink` → 贴 / 撕(**都幂等**,重复贴不会多出一行);
 *  · `objectIdsOfTag`      → 反查:这个标签打在哪些对象上(只要 id)。
 *
 * 三个演示对象的 id 是写死的 `demo-obj-*`,**不会碰你的业务表** ——
 * 产生的关联行只在 `sys_tag_relation` 里,`obj_type` 用 1(本页约定 = 「示例档案」)。
 * 想恢复原样,点右下角的「清空三个演示对象的标签」。
 */

/** 业务对象类型码:表上是 tinyint,演示对象占一个(真实项目请集中登记一份常量) */
const DEMO_OBJ_TYPE = 1;
const DEMO_OBJECTS = [
	{ id: "demo-obj-1", name: "示例档案 A" },
	{ id: "demo-obj-2", name: "示例档案 B" },
	{ id: "demo-obj-3", name: "示例档案 C" },
];

export function WorkbenchTagging() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [objId, setObjId] = useState(DEMO_OBJECTS[0]?.id ?? "");
	const [pickTag, setPickTag] = useState("");
	const [probeTag, setProbeTag] = useState("");

	const tagsQuery = useQuery(trpc.tag.list.queryOptions());
	const tagsOfObjectQuery = useQuery(trpc.tag.tagsOfObject.queryOptions({ objId, objType: DEMO_OBJ_TYPE }));
	const objectsOfTagQuery = useQuery({
		...trpc.tag.objectIdsOfTag.queryOptions({ tagId: probeTag || "__none__" }),
		enabled: probeTag !== "",
	});

	/** 叶子标签(有父节点的)= 能贴到对象上的那些 */
	const leafTags = useMemo(() => {
		const rows = tagsQuery.data ?? [];
		const dimName = new Map(rows.filter((row) => !row.parentId).map((row) => [row.id, row.label]));
		return rows
			.filter((row) => row.parentId)
			.map((row) => ({ id: row.id, label: row.label, dim: dimName.get(row.parentId as string) ?? "—" }))
			.sort((a, b) =>
				a.dim === b.dim ? a.label.localeCompare(b.label, "zh-Hans-CN") : a.dim.localeCompare(b.dim, "zh-Hans-CN"),
			);
	}, [tagsQuery.data]);

	const loading = tagsQuery.isPending;
	/** 表里真的一个叶子标签都没有(要和"还在读"区分 —— 否则 SSR 首帧会闪一句"先去跑种子") */
	const noTags = !loading && leafTags.length === 0;

	const invalidate = () => queryClient.invalidateQueries(trpc.tag.pathFilter());

	const linkMutation = useMutation(
		trpc.tag.link.mutationOptions({
			onSuccess: writeSuccess(invalidate, {
				close: () => setPickTag(""),
				message: (o) => (o.created ? "已打标签" : "这个标签已经贴过了"),
			}),
			onError: writeError,
		}),
	);

	const unlinkMutation = useMutation(
		trpc.tag.unlink.mutationOptions({
			onSuccess: writeSuccess(invalidate),
			onError: writeError,
		}),
	);

	const current = tagsOfObjectQuery.data?.items ?? [];
	const linkedIds = new Set(current.map((item) => item.tagId));
	/** 只列"还没贴过"的候选,免得下拉里全是贴过的 */
	const candidates = leafTags.filter((tag) => !linkedIds.has(tag.id));

	/** 清空演示数据:三个对象上的关联逐条 unlink(标签本身不动) */
	async function clearDemoLinks() {
		for (const object of DEMO_OBJECTS) {
			const existing = await queryClient.fetchQuery(
				trpc.tag.tagsOfObject.queryOptions({ objId: object.id, objType: DEMO_OBJ_TYPE }),
			);
			for (const item of existing.items) {
				await unlinkMutation.mutateAsync({ tagId: item.tagId, objId: object.id, objType: DEMO_OBJ_TYPE });
			}
		}
		toast.success("已清空三个演示对象上的标签");
	}

	return (
		<Card tone="var(--hue-teal)">
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<TagIcon className="size-4 text-muted-foreground" />
					打标签(标签 ↔ 业务对象)
				</CardTitle>
				<CardDescription>
					一个标签能贴到任意多个对象上,一个对象也能带多个标签 —— 靠
					<code className="mx-1 font-mono">sys_tag_relation</code>的{" "}
					<code className="font-mono">tag_id + obj_type + obj_id</code> 实现,不用给每张业务表加列。下面三个是演示对象。
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 pt-0">
				{noTags ? (
					<div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
						标签表里还没有叶子标签 —— 先跑
						<code className="mx-1 font-mono text-foreground">pnpm db:seed:tags</code>
						灌一份示例标签体系(幂等,可重复执行)。
					</div>
				) : null}

				{/* 两栏始终渲染:演示对象是静态常量,不该等在请求后面 */}
				<div className="grid gap-4 lg:grid-cols-2">
					{/* ── 左:选对象 → 看它身上的标签 → 贴 / 撕 ─────────────── */}
					<div className="space-y-3 rounded-xl border border-border p-3">
						<div className="flex flex-wrap items-center gap-1.5">
							{DEMO_OBJECTS.map((object) => (
								<Button
									key={object.id}
									size="sm"
									variant={object.id === objId ? "default" : "outline"}
									onClick={() => setObjId(object.id)}
								>
									{object.id === objId ? <Check className="size-3.5" /> : null}
									{object.name}
								</Button>
							))}
						</div>

						<div className="min-h-10">
							<div className="mb-1.5 text-xs text-muted-foreground">
								当前标签({current.length})
								<span className="ml-1 text-muted-foreground/70">
									obj_type = {DEMO_OBJ_TYPE},obj_id = {objId}
								</span>
							</div>
							{loading ? (
								<p className="text-xs text-muted-foreground">读取标签中…</p>
							) : current.length === 0 ? (
								<p className="text-xs text-muted-foreground">还没贴标签 —— 从下面选一个加进来。</p>
							) : (
								// 可删除的标签也走 BadgeList(onRemove 自带 ×):不要用 span + 手写 button 拼一个"像徽章"的东西
								<BadgeList
									values={current.map((item) => item.label)}
									layout="wrap"
									color={["bg-hue-teal-soft text-hue-teal-fg"]}
									onRemove={(index) => {
										const item = current[index];
										if (!item) return;
										unlinkMutation.mutate({ tagId: item.tagId, objId, objType: DEMO_OBJ_TYPE });
									}}
								/>
							)}
						</div>

						{loading || noTags ? (
							<p className="text-xs text-muted-foreground">{loading ? "读取标签中…" : "暂无可贴的标签"}</p>
						) : (
							<div className="flex items-center gap-2">
								<Select value={pickTag} onValueChange={(value) => setPickTag(value ?? "")}>
									<SelectTrigger size="sm" className="w-52">
										<SelectValue placeholder="选一个标签…" />
									</SelectTrigger>
									<SelectContent>
										{candidates.length === 0 ? (
											<div className="px-2 py-1.5 text-xs text-muted-foreground">没有可贴的了</div>
										) : (
											candidates.map((tag) => (
												<SelectItem key={tag.id} value={tag.id}>
													{tag.dim} · {tag.label}
												</SelectItem>
											))
										)}
									</SelectContent>
								</Select>
								<Button
									size="sm"
									disabled={!pickTag || linkMutation.isPending}
									onClick={() => linkMutation.mutate({ tagId: pickTag, objId, objType: DEMO_OBJ_TYPE })}
								>
									贴上去
								</Button>
							</div>
						)}
					</div>

					{/* ── 右:反查 —— 这个标签打在哪些对象上 ───────────────── */}
					<div className="space-y-3 rounded-xl border border-border p-3">
						<div>
							<div className="mb-1.5 text-xs text-muted-foreground">按标签反查对象(`objectIdsOfTag`)</div>
							{loading || noTags ? (
								<p className="text-xs text-muted-foreground">{loading ? "读取标签中…" : "暂无可查的标签"}</p>
							) : (
								<Select value={probeTag} onValueChange={(value) => setProbeTag(value ?? "")}>
									<SelectTrigger size="sm" className="w-full">
										<SelectValue placeholder="选一个标签,看看它贴在谁身上" />
									</SelectTrigger>
									<SelectContent>
										{leafTags.map((tag) => (
											<SelectItem key={tag.id} value={tag.id}>
												{tag.dim} · {tag.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</div>

						<div className="min-h-9">
							{probeTag === "" ? (
								<p className="text-xs text-muted-foreground">先选一个标签。</p>
							) : objectsOfTagQuery.data && objectsOfTagQuery.data.length > 0 ? (
								<div className="flex flex-wrap gap-1.5">
									{objectsOfTagQuery.data.map((id) => (
										<Badge key={id} variant="outline" className="font-mono text-xs">
											{id}
										</Badge>
									))}
								</div>
							) : (
								<p className="text-xs text-muted-foreground">这个标签还没贴到任何对象上。</p>
							)}
						</div>

						<div className="border-t border-border pt-3">
							<Button variant="outline" size="sm" className="gap-1.5" onClick={() => void clearDemoLinks()}>
								<Trash2 className="size-3.5" />
								清空三个演示对象的标签
							</Button>
							<p className="mt-1.5 text-xs text-muted-foreground">只删演示对象上的关联(`unlink`),不动标签本身。</p>
						</div>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
