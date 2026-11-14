import { useEffect, useState } from "react";

import type { ShareTokenRow } from "#/components/modules/settings/guests/table";
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
import { Textarea } from "#/components/ui/textarea";
import { parseAllowedPaths, SHARE_EXPIRES_PATTERN, SHARE_PATHS_MAX } from "#/lib/share-token-spec";
import { formatLocalDate } from "#/lib/time";

export type GuestFormPayload = {
	remark: string;
	allowedPaths: string[];
	/** 「YYYY-MM-DD」或 null(长期有效);编辑时传 null = 清掉有效期 */
	expiresAt: string | null;
};

/**
 * 访客令牌表单(新建 / 编辑)—— 单 tab,版式对齐用户 / 参数表单:
 * 宽度不动(`sm:max-w-2xl`)、弹窗本体不出滚动条(`DialogBody` 自己滚)、页脚只放时间行。
 *
 * 「允许页面」是**多行文本**(每行一条路径前缀),校验真源在 `lib/share-token-spec.ts`
 * (`parseAllowedPaths`,服务端入参同一份口径);problem 存在时保存键置灰。
 */
export function SettingsGuestsForm({
	token,
	creating,
	open,
	pending,
	onOpenChange,
	onSubmit,
}: {
	/** 编辑哪一行(creating 时忽略) */
	token: ShareTokenRow | null;
	creating: boolean;
	open: boolean;
	pending: boolean;
	onOpenChange: (next: boolean) => void;
	onSubmit: (payload: GuestFormPayload) => void;
}) {
	const [remark, setRemark] = useState("");
	const [pathsText, setPathsText] = useState("");
	const [expiresAt, setExpiresAt] = useState("");

	// 打开时把当前值灌进来(关掉不清,免得关闭动画期间闪一下空值)
	useEffect(() => {
		if (!open) return;
		setRemark(token?.remark ?? "");
		setPathsText(token?.allowedPaths.join("\n") ?? "");
		setExpiresAt(formatLocalDate(token?.expiresAt));
	}, [open, token]);

	const parsed = parseAllowedPaths(pathsText);
	const expiresInvalid = expiresAt !== "" && !SHARE_EXPIRES_PATTERN.test(expiresAt);
	const invalid = parsed.problem !== null || expiresInvalid;

	function submit() {
		if (invalid) return;
		onSubmit({ remark: remark.trim(), allowedPaths: parsed.paths, expiresAt: expiresAt || null });
	}

	return (
		<Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
			<DialogContent className={`${DIALOG_FIT} sm:max-w-2xl`}>
				<DialogHeader className="shrink-0">
					<DialogTitle>{creating ? "新增访客令牌" : "编辑访客令牌"}</DialogTitle>
					<DialogDescription>
						{creating
							? "生成外链:持有者可读取管理员可见的全部数据,写操作一律拒绝;允许页面仅限制页面入口。"
							: "改备注 / 允许页面 / 有效期。令牌本体不变,已发出去的外链继续有效。"}
					</DialogDescription>
				</DialogHeader>

				<DialogBody className="flex flex-col pr-1">
					<DetailRow label="备注" htmlFor="guest-form-remark">
						<Input
							id="guest-form-remark"
							value={remark}
							placeholder="如:合作方数据分析(发给谁、看什么)"
							className="h-8 text-sm"
							onChange={(event) => setRemark(event.target.value)}
						/>
					</DetailRow>
					<DetailRow label={`允许页面(路径前缀,每行一条,最多 ${SHARE_PATHS_MAX} 条)`} htmlFor="guest-form-paths">
						<div className="flex flex-col gap-1">
							<Textarea
								id="guest-form-paths"
								value={pathsText}
								rows={4}
								placeholder={"/demo/grid"}
								className={`font-mono text-sm${parsed.problem ? " border-destructive" : ""}`}
								onChange={(event) => setPathsText(event.target.value)}
							/>
							{parsed.problem ? <p className="text-xs text-destructive">{parsed.problem}</p> : null}
						</div>
					</DetailRow>
					<DetailRow label="有效期至(留空 = 长期有效)" htmlFor="guest-form-expires">
						<Input
							id="guest-form-expires"
							type="date"
							value={expiresAt}
							className="h-8 text-sm"
							onChange={(event) => setExpiresAt(event.target.value)}
						/>
					</DetailRow>
				</DialogBody>

				<div className="flex shrink-0 items-center justify-end gap-2 pt-3">
					<Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button disabled={pending || invalid} onClick={submit}>
						{pending ? "保存中…" : creating ? "生成令牌" : "保存"}
					</Button>
				</div>

				{/* 页脚只放时间行;没有时间可显示就整条不渲染(新建时它是空的) */}
				{token ? (
					<DialogFooter className="mt-0">
						<DetailMeta meta={{ id: token.id, createdAt: token.createdAt, updatedAt: token.updatedAt }} />
					</DialogFooter>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
