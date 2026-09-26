import { actionsColumn, TextCell } from "#/components/modules/shared/table-kit";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Badge } from "#/components/ui/badge";
import { BadgeList } from "#/components/ui/badge-list";
import { createAppColumnHelper } from "#/lib/table";
import { formatLocalMinute } from "#/lib/time";

/**
 * 用户台账的一行(tRPC `user.list` 出参)—— **与 `sys_user` 的列一一对应**,
 * 外加三个派生字段:部门(来自 `sys_user_dept`)、角色名与角色 id(来自 `sys_user_role`)。
 */
export type UserRow = {
	id: string;
	name: string;
	email: string;
	emailVerified: boolean;
	image: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	/** 这个人属于哪些部门(组织架构)—— 派生自 `sys_user_dept` */
	departmentNames: string[];
	/** 部门 id —— 编辑弹窗里的部门多选框要按 id 回填 */
	departmentIds: string[];
	/** 这个人的角色名(全局)—— 派生自 `sys_user_role` */
	roleNames: string[];
	/** 角色 id,与 `roleNames` 同序 —— 编辑弹窗里的角色多选框按 id 回填 */
	roleIds: string[];
};

const columnHelper = createAppColumnHelper<UserRow>();

/**
 * 用户台账的列定义 —— 版式对齐参数 / 角色的台账页。
 *
 * **列 = `sys_user` 的全部列**(账号字段归 Better Auth,这里是只读镜像),
 * 嫌挤就点工具条里的「列」把不要的收起来。
 *
 * 「部门」与「角色」是**两个**派生列:前者是组织架构,后者是全局角色(与部门无关),
 * 混在一列里会让人以为"角色挂在部门上"。
 */
export function userColumns({
	onView,
	onEdit,
	onDelete,
}: {
	onView: (row: UserRow) => void;
	onEdit: (row: UserRow) => void;
	/** 删除账号(危险操作,由页面弹确认框) */
	onDelete: (row: UserRow) => void;
}) {
	return columnHelper.columns([
		columnHelper.accessor("name", {
			header: "姓名",
			sortFn: "text",
			size: 150,
			cell: (ctx) => <span className="text-sm">{ctx.getValue() || "(未填姓名)"}</span>,
		}),
		columnHelper.accessor("email", {
			header: "邮箱",
			sortFn: "text",
			size: 220,
			cell: (ctx) => <span className="text-xs text-muted-foreground">{ctx.getValue()}</span>,
		}),
		columnHelper.accessor("departmentNames", {
			header: "部门",
			size: 200,
			cell: (ctx) => {
				const list = ctx.getValue();
				// 多值一律走 BadgeList —— 别自己拿 span 拼一个"长得像徽章"的东西:
				// 那样字号 / 圆角 / 配色会各写各的,和详情页 / 别处的徽章对不上。
				if (list.length === 0) return <span className="text-xs text-muted-foreground">未加入部门</span>;
				return <BadgeList values={list} layout="wrap" color="stable" />;
			},
		}),
		columnHelper.accessor("roleNames", {
			header: "角色",
			size: 200,
			cell: (ctx) => {
				const list = ctx.getValue();
				if (list.length === 0) return <span className="text-xs text-warn-fg">未分配(看不到任何菜单)</span>;
				return <BadgeList values={list} layout="wrap" color="stable" />;
			},
		}),
		columnHelper.accessor("emailVerified", {
			header: "邮箱已验证",
			size: 100,
			cell: (ctx) => (
				<Badge variant={ctx.getValue() ? "secondary" : "outline"} className="text-xs">
					{ctx.getValue() ? "已验证" : "未验证"}
				</Badge>
			),
		}),
		columnHelper.accessor("image", {
			header: "头像",
			size: 96,
			cell: (ctx) => {
				const url = ctx.getValue();
				const who = ctx.row.original.name;
				// 真头像;没有地址就退回首字(以前这里是把 URL 当文本显示 —— 那不算「看到头像」)
				return (
					<Avatar className="size-8">
						{url ? <AvatarImage src={url} alt={who} /> : null}
						<AvatarFallback className="text-xs">{(who || "?").slice(0, 1)}</AvatarFallback>
					</Avatar>
				);
			},
		}),
		columnHelper.accessor("createdAt", {
			header: "创建时间",
			size: 140,
			cell: (ctx) => (
				<span className="text-xs text-muted-foreground tabular-nums">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("updatedAt", {
			header: "更新时间",
			size: 140,
			cell: (ctx) => (
				<span className="text-xs text-muted-foreground tabular-nums">
					<TextCell value={formatLocalMinute(ctx.getValue())} />
				</span>
			),
		}),
		columnHelper.accessor("id", {
			header: "ID",
			size: 200,
			cell: (ctx) => <span className="font-mono text-xs text-muted-foreground/70">{ctx.getValue()}</span>,
		}),
		actionsColumn<UserRow>({ size: 160, onView, onEdit, onDelete }),
	]);
}
