import { Badge } from "#/components/ui/badge";
import { EFFECT_LABEL, type PolicyEffect, type PolicySubjectKind, SUBJECT_KIND_LABEL } from "#/lib/data-policy-spec";

/**
 * 规则台账里的两个小徽标 —— 清单 / 详情 / 解释器三处都要画同一件东西,放一处。
 *
 * 为什么要收:这三处以前各写了一遍(类名逐字相同),配色想换个色调就得记住改三处 ——
 * 而"允许/拒绝"的红绿是**语义色**,漂了一个就变成误导。
 */

/** 主体种类 → 配色 */
const SUBJECT_TONE: Record<PolicySubjectKind, string> = {
	all: "bg-hue-blue-soft text-hue-blue-fg",
	user: "bg-hue-teal-soft text-hue-teal-fg",
	role: "bg-hue-violet-soft text-hue-violet-fg",
	dept: "bg-hue-amber-soft text-hue-amber-fg",
};

/** 效果 → 配色:允许(绿)/ 拒绝(红) */
const EFFECT_TONE: Record<PolicyEffect, string> = {
	allow: "bg-hue-emerald-soft text-hue-emerald-fg",
	deny: "bg-hue-rose-soft text-hue-rose-fg",
};

/** 主体种类徽标。`tone` = 用种类配色(清单里用),否则就是普通的次级徽标(详情 / 解释器里用) */
export function SubjectKindBadge({ kind, tone = false }: { kind: PolicySubjectKind; tone?: boolean }) {
	if (!tone) {
		return (
			<Badge variant="secondary" className="text-xs">
				{SUBJECT_KIND_LABEL[kind]}
			</Badge>
		);
	}
	return <Badge className={`text-xs ${SUBJECT_TONE[kind]}`}>{SUBJECT_KIND_LABEL[kind]}</Badge>;
}

/**
 * 效果徽标(允许 / 拒绝)。
 *
 * 参数收 `string` 而不是 `"allow" | "deny"`:解释器要把库里真有的值原样画出来,
 * 认不出的效果照实显示(显示成红),不藏。
 */
export function EffectBadge({ effect }: { effect: string }) {
	// 库里理论上只有 allow / deny(不合法的行在装载时就被跳过了),但画的时候不赌:认不出就红着原样显示
	const known = effect === "allow" || effect === "deny" ? effect : null;
	return (
		<Badge className={`text-xs ${known ? EFFECT_TONE[known] : EFFECT_TONE.deny}`}>
			{known ? EFFECT_LABEL[known] : effect}
		</Badge>
	);
}
