---
target: 详情页(task-close-detail-page)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/lid/Downloads/src/bb/stack-tpl/src/components/modules/task-close/task-close-detail-page.tsx"
target_fingerprint: "sha256:281f9910120428cc4058b0a8c041b142d86dba6d8e50284d77be8fc8cd30d2f4"
target_path: /Users/lid/Downloads/src/bb/stack-tpl/src/components/modules/task-close/task-close-detail-page.tsx
timestamp: 2026-10-15T16-15-25Z
slug: les-task-close-task-close-detail-page-tsx-7384109a
---
# 任务闭环详情页 · 设计评审(A:设计总监子代理 / B:detector 被计划模式拦截)

## Design Health Score: 27/40 (Acceptable)
1 状态可见性 3 | 2 贴近真实 3 | 3 用户控制 2 | 4 一致性 3 | 5 错误预防 2 | 6 识别 3 | 7 灵活 3 | 8 美学 3 | 9 错误恢复 3 | 10 帮助 2

## 设计专属性
半落地——章与批注是真资产(44px 圆章 textPath 圆周文字/方章/批注皮/宋体标题);流程脊仍是通用 stepper(脊档 spine 死代码未接)、评论头像自称 Airtable Blue 异物、meta 未落版记行。拿掉两枚章和批注皮,这页 100% 是普通后台。

## 优先问题
- P1 「通过」一次点击不可逆零确认(摩擦倒挂:删评论反而有确认)
- P1 首开即播盖章动画(prevStatusRef 初始 null)
- P1 同屏双章(详情档 44px + meta 行 StatusBadge)违反"同一状态只盖一枚"
- P1 流程脊通用 stepper,脊档章死代码
- P2 头部 8 控件齐平无主次;meta 未落版记行

## Persona 红旗
Alex:主动按钮藏第 3 位;通过读飞车无反悔;单候选仍弹窗三步;附件两段式。
Sam:详情章 aria-hidden 双保险变单通道;待办按钮 accessible name 只有二字;ⓘ 解释藏 hover;disabled 原因只在 placeholder。

## 次要观察
批注皮靠前缀字符串;reachedAt 分页劫持;自定义状态 label.slice(0,2) 残片;头像"最圆最蓝";aside top-[72px] 硬编码;两档输入圆角。

## 挑衅问题
1. 脊档章+驳回红章会让这页变成"一份被批回的公文"吗?
2. 待办条若成全页唯一动作组?
3. 通过后原位盖 44px 章,仪式感能否同时解决 Peak-End 与误点?
