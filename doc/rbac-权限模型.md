# RBAC 权限模型(部门 / 角色 / 菜单可见性)

> 本文原在 `AGENTS.md` 里,2026-09 按「精简 AGENTS」的约定搬到这里
> (2026-09 功能权限改由 Casbin 承载后,表名与存储位置已同步更新)。
> 什么时候看它:动权限判定、`casbin_rule`,或 `/settings/{roles,users,departments}` 三页时。

**"部门当组织用",但走的不是 Better Auth 的 organization 插件** —— 那套是"选中一个当前组织 + 租户隔离",
而这里要的是"**同时属于多个部门 + 角色给权限**",语义不同(而且它会往 session 上加一个用不上的
`active_organization_id`)。所以是项目自己的五张表(下面四张管组织 / 角色 / 功能权限,第五张
`sys_data_policy` 是行级数据权限的载体,见下文「行级数据权限」):

```
sys_dept(树)                         上海公司 / 武汉公司(可嵌套)—— 纯组织架构
sys_role(全局定义)                          管理员 / 员工 / 开发 …   ← 不随部门数增长
sys_user_dept(user_id, department_id)  张三 ∈ 上海公司、武汉公司(**不带角色**)
casbin_rule:g(user, role)                      张三 → 管理员、普通员工(**权限 = 这些角色的并集**)
casbin_rule:p(role, menu)                      角色能看见哪些菜单 / 能用哪些按钮
```

**权限标识 = `域:资源:动作`(三段小写),每段可整段写 `*` 通配。** 例:`sys:role:add` / `sys:role:*` / `sys:*:*` / `*:*:*`(全部权限,**含以后新增的菜单**)。
- **通配在装载时展开**(唯一实现处 `lib/casbin.ts`):把模式命中的菜单行当成"被授权"再走同一套祖先补全 —— 所以
  `use-perms.ts` 与各页面**一行都不用改**,`*:*:*` 也自动覆盖未来新增的域/菜单(不用回来补勾);想收窄再加一条模式行。
- **域 = 一级模块 key**,允许长新域;受控的是**形状不是取值** —— 菜单接口的 `perm` 用 `PERM_FORMAT` 挡住
  两段 / 大写 / 半截通配(`sys:ro*`)。⚠️ 段数不符的模式**永远匹配不到**,症状是"勾了没权限",极难查。
- 运维权限点两条:`*:*:*`(通配,种子授给系统管理员)与 `sys:user:impersonate`(切换用户),挂在隐藏分组「运维工具」下。

- **角色全局定义、按人分配** —— 这是"角色爆炸"的解药:角色行数**不随部门数增长**
  (4 种角色在 100 个部门里也只有 4 行)。角色**与部门无关**(早期版本把角色记在部门成员上,
  结果是"同一个人在不同部门才能有不同角色",那是没必要的复杂度 —— `sys_user_dept.role_id`
  已经删掉,分配入口收在「用户管理 ▸ 编辑」里)。
- **并集**:一个人所有**角色**的授权取并集 —— **没有"当前部门",也不需要切换**。
  计算在 `lib/rbac.ts` 的 `effectiveMenusFor(userId)`(它只读 `casbin_rule` 的 `g` 行 + `sys_role`,不看部门):它**只吃 `userId`**,与"怎么拿 userId(会话)"解耦,
  所以单测可以直接喂一个 id,不必造 HTTP 会话。
- **菜单与按钮同一张表**:`sys_menu.type` = 1 目录 / 2 菜单 / 3 按钮,`perm` 是权限标识(如 `sys:role:write`)。
  按钮**不进侧边栏**(`buildNavTree` 会过滤),但作为叶子出现在角色授权树里
  (`PermissionPicker` 给它一个「操作」徽章);授权后它的 `perm` 进入用户的权限集合 ——
  前端 `useHasPerm(code)` 认它。**按钮行的 `path` 用不指向路由的占位值**
  (沿用"纯分组也给占位 path"的既有约定,`path` 保持 not null + 唯一)。
- **勾子节点要自动补全祖先**:侧边栏是按 `parentId` 拼树的,只授权一个深层子菜单会让那一枝无处安放
  ("勾了却看不见")。写入(`role.setMenus`)与读取(`rbac.ts`)用同一份 `withAncestorIds()`。
- **未启用不过滤**:`casbin_rule` 里**一条 `p` 行都没有** → 全部菜单可见 + `perms = null`(一律放行)。
  这是刻意的兜底:新项目/新库还没配权限时,不能把管理员自己锁在门外。配了第一条授权就立即生效。
- **认不到人 → 失败关闭**:权限体系开着但拿不到会话 → 空菜单 + `perms = []`(不是 `null`)。
- **隐藏 ≠ 禁止,所以拦两层**:侧边栏可见性只是"看不见入口",服务端另有两道判定 ——
  **页面级**(`routes/(main)/route.tsx` 的 `beforeLoad` → `canViewPath`)与
  **读接口级**(`integrations/trpc/init.ts` 的 `permMiddleware` → `PERM_BY_PATH`),
  两者读的都是这份"角色 → 菜单 + 按钮"的授权集合。详见下面「页面级(URL)与读接口拦截」。
- 三页页面:`/settings/departments`(树 + 成员,含加人/移出;角色只读展示)、`/settings/roles`(台账 + 权限点勾选)、
  `/settings/users`(账号台账 + **建 / 改 / 删** + 在**编辑弹窗里用多选框分配全局角色与部门**)。**账号仍归 BA**:
  - `create` 转调 `auth.api.signUpEmail`(密码哈希只有它会写);
  - `update` 改**姓名 / 邮箱 / 头像(`image`)/ 邮箱已验证(`email_verified`)**,
    并**覆盖式**保存**角色**(`roleIds`)与**部门**(`departmentIds`)—— 传进去的就是最终状态,
    四个字段都**必传**(少传一个就会把那一项清空;这也是为什么它们是必填而不是可选)。
    改密码是 BA 的 `changePassword`(要本人/邮件往返),不在这里假装能做;
    `sys_user` 的其余列(`id` / `created_at` / `updated_at`)是系统列,不开放编辑 —— 这就是"能编辑的字段"的全部;
  - `remove` 先清 session / account / 部门成员再删用户,**并拒绝删自己**(删掉自己的会话 = 立刻掉线)。
  ⚠️ `signUpEmail` 会顺手建一个会话并下发 cookie —— 建完**必须立刻删掉那个会话**,
  否则下一个请求就用新用户的身份了(`tests/user-crud.test.ts` 专门断言这一点)。
  ⚠️ 外键上虽然写了 `on delete cascade`,但 session / account 两张表**不归我们建**,别依赖它们的级联 —— 显式删。

**演示数据:`pnpm db:seed:rbac`**(幂等)—— 它**只造角色与权限点**(并给系统管理员授 `*:*:*`),
**不建**演示部门 / 演示账号:真实项目的部门与人员是区里每天推过来的,种子里建了也会被冲掉。

| 账号 | 密码 | 能看到什么 |
| --- | --- | --- |
| `admin@example.com` | `Passw0rd123` | 系统管理员 → 全部菜单 + 全部按钮权限点 |

> 本机另外手工准备了一批**街镇演示账号**(13 个街镇 × 队长 / 队员,密码同 `Passw0rd123`),
> 用来实际看数据范围的效果;它们**不在种子里**,清单与命名规则见 `doc/测试数据/README.md`。

⚠️ **跑过它之后权限体系就"启用"了**(`casbin_rule` 里有了 `p` 行):**没有任何角色的账号将看不到任何菜单**(部门归属不影响权限)。
要回到"未启用、全放行"的状态,把 `casbin_rule` 的 `p` 行清空即可。

---

## 页面级(URL)与读接口拦截(2026-09 加强)

**上一版的洞**:侧边栏隐藏只是"看不见入口"。记住 url 照样能直接进,页面里的读接口也照答
(实测:队长直敲 8 个 `/settings/*` 页面都能读出数据)。现在是两层拦截,判定都落在
`lib/rbac.ts`(`canViewPath` + `PERM_BY_PATH`)与 `integrations/trpc/init.ts` 的 `permMiddleware`,
用的还是同一份"角色 → 菜单 + 按钮"授权 —— **没有新增权限点**。

### 第一层:页面(路由)

- 合成码 **`page:<路径折算>:view`**(`pagePermOf()`:非字母数字折成 `_`,小写,去前导斜杠)
  —— `/settings/data-policy` → `page:settings_data_policy:view`。语义就是"这个人在菜单里能不能看见这一页"。
- 放行的三种情况:**权限体系未启用**(一条 `p` 行都没有 ⇒ `perms === null`)、
  `ALWAYS_VIEWABLE_PATHS`(`/`、`/notices`)、**不在菜单表里的地址**(demo 页、`/blank` 等)。
- 拿不到会话 → `redirect` 到 `/login?redirect=<原地址>`;有会话但没授权 →
  `notFound({ data: { forbidden: true, pageName } })`。
- ⚠️ **为什么是 404 而不是 403**:框架对**任何错误终态**都写死 `status: 500`
  (`router-core` 的 `applyFailure` ERROR 分支;`error.status` 与 `setResponseStatus` 都不参与判定,
  h3 的 `prepareResponse` 对 SSR 返回的 `Response` 还有一条 `!val.ok` 原样早退),
  只有 not-found 终态自带 4xx。顺带也不暴露"这个地址存在"。
  页面本身在 `routes/__root.tsx` 的 `notFoundComponent`,按 `data.forbidden` 区分
  「没权限」与「地址不存在」两种 404。
- ⚠️ 判定**只能读 `data`(或其它自有字段)**:抛出的错误对象要序列化给客户端做水合,
  `prototype` 会丢 —— `instanceof` 在首屏为真、水合后为假(踩过的症状:页面先显示友好页,
  水合后变成通用「页面出错了」)。

### 第二层:读接口

- **每个 query 都必须分类**,三种结局之一:
  1. 有对应页面 ⇒ 登记成那个页面的合成码(写接口仍用 `sys:*` 权限点);
  2. 外壳级 / 跨页面共用(顶栏通知、`para.byKey`、工作台打标签…)⇒ 登记进 `UNMAPPED_QUERIES`,**每条都写了理由**;
  3. 一个读被多页共用 ⇒ 值写成数组 = **任一命中即放行**(如 `role.list` = 角色 / 用户 / 部门 / 数据权限四页)。
- 新增 query 忘了分类 ⇒ `tests/auth.test.ts` 直接挂;它还断言每条 `PERM_BY_PATH` 的码真实存在、
  `page:` 码能反查到真实菜单路由、无权限账号读受管接口得到「没有权限」。
- 失败关闭:认不到人 ⇒ `perms = []` ⇒ 受管读接口一律 `没有权限:<code>`(HTTP 403;
  未登记的读接口只要登录就能读 —— 所以"忘了登记"的表现是**不拦**,由上面那条测试兜住)。

### 实测基线(生产构建 + 真实浏览器)

| 账号 | 请求 | 结果 |
| --- | --- | --- |
| 未登录 | `/settings/roles` | 307 → `/login?redirect=%2Fsettings%2Froles` |
| 七宝镇队长 | `/settings/{roles,logs,data-policy}` | **404 + 友好页**(水合前后一致,无控制台异常) |
| 七宝镇队长 | `/settings/users` · `/demo/grid` | 200(2 人 / 7 条) |
| 七宝镇队员 | `/demo/grid` · `/settings/users` | 200(4 条 / 1 人) |
| admin | 全部页面 | 200(网格 71 / 规则 89 / 角色 12) |
| 七宝镇队员 | 读接口 `log.list` | 403 `没有权限:sys:log:list` |
| 七宝镇队员 | 读接口 `role.list` | 200 —— 他能看用户管理页,而这一页要用角色名 |

---

## 行级数据权限 —— 直白授权规则(2026-09 重做)

> 本节是**正式口径**,已经取代旧的「`sys_role.data_scope` 四档」写法(那一列**已删**)。
> 核心一句话:
> **数据权限不是"给角色一个档位词",而是"写一条直白的授权规则";规则由 Casbin 判定,再编译成 SQL 条件。**
> 角色从此**只管功能权限**(能看见哪些菜单 / 能用哪些按钮)。

### 一、唯一载体:`sys_data_policy`

| 列 | 语义 | 例 |
| --- | --- | --- |
| `ptype` | Casbin 的策略类型,固定 `p` | `p` |
| `v0` | **主体**(谁) | `*` / `user:u1` / `role:duizhang` / `dept:d7` |
| `v1` | **资源**(哪个东西) | `*` / `demo_grid` / `demo_grid@org:d7` / `demo_grid@g12` |
| `v2` | **动作** | `read` / `write` / `*` |
| `v3` | **效果** | `allow` / `deny` |
| `status` | 1 生效 / 0 停用(停用的行**不进引擎**) | `1` |
| `remark` | 人话备注(指派流程会写"指派负责人自动授权") | |

约束:`unique (v0, v1, v2)`(同一主体对同一资源同一动作只留一条)+ `index (v0, status)`。
**刻意不留 `v4` / `v5`、不写 Casbin 的 `g` 行、任何一列都不带业务语义** —— 加"业务列"就等于把
老毛病(`data_scope` 那种"一个词承载一整套逻辑")换个地方重演。

**主体的三种写法**(`user:` 是 `user:` **不是** `uid:`;`: ` 后面最多 64 字符,角色 code 与部门 id 都不限字符集):

| 写法 | 含义 |
| --- | --- |
| `*` | 任何人(等价于"这一类的默认放开") |
| `user:<id>` | 某个人 —— **借调、队长、队员都用它** |
| `role:<code>` | 持有该**角色**的人(角色只给功能权限,但这里可以按角色放行数据) |
| `dept:<部门 id>` | ⚠️ **该部门下的所有人**(不是"该部门的数据")。用它要清楚这一点 |

**资源的四种写法**:

| 写法 | 含义 |
| --- | --- |
| `*` | 任何已登记的资源类型 |
| `demo_grid` | 该类型**全部行** |
| `demo_grid@org:<部门 id>` | 归属组织 = **该节点及其子树**的行(所以没有"不含下级"这种词) |
| `demo_grid@<行 id>` | **就那一行** |

**动作**:`read` / `write` / `*`。列表 / 详情问 `read`,`update` / `remove` / `assign` 问 `write`。
**效果**:`allow` 给范围,`deny` 从范围里**减掉**(见下)。

### 二、判定怎么跑(引擎:`lib/data-policy.ts` + `lib/data-policy-spec.ts`)

```text
① 主体集合 = * + user:<我> + role:<我每个启用角色的 code> + dept:<我的每个部门> + 这些部门的全部祖先
② 对每个主体 enforce(sub, 资源类型, 动作)      ← 命中到具体行 / 组织的规则都算命中
③ 全都不命中 ⇒ sql`1 = 0`(**fail-closed**:认不出人就什么都看不到)
④ 有命中 ⇒ 取这些主体名下的**全部**规则(一个队员可能有多条按行授权,必须全取)
⑤ compileScopePlan:allow 取并集、deny 做减法 ⇒ scopeSql 拼成 SQL 条件
```

- **拆两个文件**是刻意的(同 `sys-para.ts` / `para-spec.ts` 的手法):`data-policy-spec.ts` 是**纯逻辑**
  (解析 / 校验 / 编译计划,**不 import `#/db`**),所以能进客户端包;`data-policy.ts` 才碰数据库。
  ⚠️ 踩过的坑:把服务端模块混进客户端包,**`typecheck` 与 `build` 全绿,只有浏览器里白屏**
  (`Cannot read properties of undefined (reading 'prototype')`)—— 所以纯逻辑必须真的纯。
- **规则行会逐条校验**(`policyRuleProblem`):形状不对的行**装载时记一条 `policy.rule_invalid`(warn)并跳过**,不装载。
  宁可少授权,也不把一条看不懂的规则当放行。写入侧也一样:`grantRule` 先校验再落库
  (否则写进去等于静默失效)。
- **`deny` 的粒度决定它是不是"一票否决"**:`[policy_effect]` 的 `!some(deny)` 是在 matcher **筛出来的规则集合**上算的,
  而 `resourceUnder` 是**相交**语义(一条 `@org:` / `@<行>` 的 deny 与"这一类能不能读"这种请求也算命中),
  所以 matcher 里额外写了 `(p.eft != "deny" || wholeTypeDeny(p.obj))`:只有 `*` / 裸类型的 deny 参与一票否决,
  行级 / 组织级的 deny 一律交给 SQL 做减法(`scopeSql` 的 `not in` 分支)。
  ⚠️ 少了这句会出事:同一个人身上「允许这个组织 + 拒绝其中一行」,那条行级 deny 会把他的**整类 allow 一起否掉**,
  变成一条都看不见(实测踩到,回归用例见 `tests/data-policy.test.ts` 的「同一个人的…也必须做减法」)。
- **30 秒缓存**(`clearDataPolicyCache()` 由所有写 helpers 自动调):策略是只读表,不是热路径。
- **适配器是只读的**:`sys_data_policy` 的 4 个 Casbin 写方法一律 `throw` —— 策略只由
  **迁移脚本 / 指派流程**维护,不允许业务代码随手改。

**理解范围的三个模式**(和功能权限一一对应):

1. **未启用 → 不过滤**:`sys_data_policy` 里**一条生效行都没有** ⇒ `dataScopeWhere` 返回 `undefined`(不收窄)。
   与「`casbin_rule` 里一条 `p` 行都没有 = 功能权限未启用」**同口径**。新库开箱即用,不会一上来就把人锁死。
2. **已启用 + 认不出我 → 空**:表里已经有规则,而"我是谁"一个主体都没命中 ⇒ `1 = 0`。
   ⚠️ 这一条曾把老测试全打挂(`user.list` 带范围后,合成的 test-admin 读不到任何用户),
   修法是给测试注入一条 `user:test-admin → *, *` 的规则,见 `tests/helpers.ts` 的 `ensureTestAdminPolicy()`。
3. **`deny` 是减法,不是无差别全否**:`deny` 的 obj 写成 `*` / 裸类型 ⇒ 整类作废(且不牵连别人的规则);
   写成具体组织 / 行 ⇒ 只把那部分**减掉**,其余照常 —— 判定侧靠上面那句 matcher 守卫,拼 SQL 侧靠 `not in`。

> **调试姿势**:日志事件 `policy.load`(装载了几条、跳过了几条) / `policy.disabled`(表空 ⇒ 不过滤) / `policy.denied`(认不出主体 ⇒ 0 行,带 subjects) / `policy.scope`(最终编译出的 orgs / rows / deny),
> 一次请求到底算出了什么范围,看这四条就够 —— 完整日志字典见 `doc/审计日志.md` §七。

### 三、业务表的约定(与旧写法相同,一个字没改)

| 字段 | 谁在用 | 没有会怎样 |
| --- | --- | --- |
| **归属组织列**(`demo_grid.group_id`;名字可叫 `org_id` / `area_id` …) | `@org:` 规则 | `NULL` 的行**不在任何组织集合里**(只有 `*` / 裸类型 / 按行授权能看到它) |
| **负责人列**(`owner_id` / `create_by`) | 按行授权(`@<行 id>`) | 指派时无从写授权 |
| 展示 / 统计列(`town_id` 这种"所属街镇") | **不参与过滤** | 与权限无关 —— 别拿它当归属组织 |

**不强制每张表都加** —— 字典 / 参数 / 菜单这类全局表**就是不该过滤**(那不是漏,是明确不需要)。
**关联继承**也行:业务表不带列、靠 join 到带列的表(零 schema 改动),规则完全一样。

**表单里「归属组织」的候选怎么给**:只列**该层级下真有人挂着的子部门**
(`grid-page.tsx` 的 `groupOptionsOf`,拿 `user.list` 的 `departmentIds` 反查):
一个街镇底下几十个科室,把整个子部门列表倒出来等于让人踩坑 —— 挑中一个没人挂的组织,
配 `dept:` 规则没人命中、配 `@org:` 规则又跟人对不上(实测:七宝镇名下 ~80 个子部门,真有人挂的只有「七宝镇网格组」)。
新库 / 还没挂人时退回全部子部门,否则第一条数据没得选。
**不要让 placeholder 替候选说话** —— 候选数量由数据决定,文案只能说"未指定"。

### 四、代码怎么用

```ts
// 每个列表 / 详情 / 写操作都问同一个入口:
const scope = await dataScopeWhere(me.id, "demo_grid", "read");  // SQL | undefined
// undefined = 不过滤;恒假条件 = 什么都看不到;其余 = 拼进 where

// 写操作:先按同范围取出那一行,取不到就是 NOT_FOUND(不区分"不存在"与"无权",防 IDOR)
const before = await visibleRow(input.id, me.id, "write");

// 授权 / 收回(指派流程的写入口):
await grantRow(ownerId, "demo_grid", rowId);   // 按行:user:<ownerId> → demo_grid@<rowId>
await grantOrg(userId, "demo_grid", deptId);   // 按组织:user:<id> → demo_grid@org:<deptId>
await revokeRow(ownerId, "demo_grid", rowId);
await revokeRows("demo_grid", removedIds);     // 删行时顺手清掉指着这些行的策略
await revokeUser(userId);                      // 删用户时清掉他的全部策略
await grantRule(sub, obj, act?, remark?);      // 最底层:写任意一条(先校验形状)
await ensureRule(sub, obj, act?, remark?);     // 同上,但**只补不覆盖**(已存在则原样返回 false)
```

**两条硬规矩**(没变):

> 1. **统计 / 导出 / 多表 join 必须走同一个入口** —— 这是行级权限最经典的越权通道,禁止手写 where;
> 2. **写操作也要套同一个范围**(先 `visibleRow` 再动手),
>    只在 `list` 上套 = 拿到别人的 id 照样能改能删(IDOR)。

### 五、迁移与启用(一次性,已在本机跑过)

```bash
pnpm db:create                # 建出 sys_data_policy(-- 达梦线是 pnpm db:dm:create-ba)
```

`sys_role.data_scope` 的迁移已经执行完毕(旧列已删),那个一次性迁移脚本已随迁移一起移除。

映射口径(实测 12 个角色 ⇒ 88 条规则,与手算逐条相等):

| 旧档位 | 新规则 | 为什么 |
| --- | --- | --- |
| `all`(含空值) | 每个角色一条 `role:<code> → *, *, allow` | 一个词覆盖该角色所有人 |
| `dept_below` | **按人授权**:每个持该角色的人 × 每个登记资源各一条 `user:<id> → <资源>@org:<他的部门>` | ⚠️ **不能**翻译成 `dept:<部门 id>` —— 队长与队员挂在**同一个**「××网格组」上,部门规则对该部门**所有人**生效 ⇒ 队员会看到整条街。定稿按人授权 |
| `self` | 该人 `owner_id` 的每条 `demo_grid` 一条 `demo_grid@<行 id>` + 一条 `sys_user@<他自己>` | 按行授权要一行一条(引擎取的是规则并集) |
| `dept`(不含下级)、认不出的值(含老 `up:N`) | **只打印告警,不猜** | 表示不出来就别静默近似(现网无此档角色) |

- **为什么保留 `dept:` 主体**:需求原话里有"甚至某个部门"这种说法,所以口径上支持;
  但文档必须写清「部门规则 = 该部门**所有人**都适用」,免得被当成"部门的数据"误用。
- **删列写在迁移脚本里**,**不登记进建表脚本的删列注册表**(`COLUMN_DROPS` / 达梦的 `columnDrops`)——
  那是建表后跑的:登记了第一次 `db:create` 就把列删了,迁移脚本再也读不到。
- 迁移脚本**幂等**:没有旧列时打印「读不到旧列…按"已经迁过"处理」后正常退出;
  `--keep-column` 保留旧列(先验证再删)。
- **借调** = 给这个人**再加一条 `user:` 规则**(`grantOrg`);**编制推送不参与策略** ⇒ 冲不掉它,
  也**不动 `sys_user_dept`**(动了下次同步就没了)。
- **多主体规则取并集** —— 顺带把旧设计里记为「第二期:跨轴精确并集」的缺口补上了:
  "既看本部门、又要看'我负责的那几条'"现在就是两条规则并存。

### 基线策略种子:新库从零也有基本权限

```bash
pnpm db:seed:policies                 # 幂等,只补不覆盖
pnpm db:seed:policies -- --dry-run    # 只看计划,不写库
```

迁移脚本管的是「**旧库**里的 `data_scope` 搬过来」;新库没有旧列,于是**同一个口径做成了种子**:
区级角色不受限(`role:<code> → *`)、队长按组织(`user:<id> → <资源>@org:<他的部门>`)、
队员按行(他负责的每条网格 + 看自己)。派工角色由常数 `ASSIGNED_ROLE_CODES`(`duizhang` / `duiyuan`)
排除在"角色不受限"之外 —— 否则队员会凭角色拿到全量。

- **只补不覆盖**:已存在的 `(v0, v1, v2)` 一行都不动 ⇒ 迁移来的行留着「迁移:…」备注,
  被手工改成 `deny` 的行也不会被改回 `allow`;
- 实测(dry-run 与真跑**逐条比对**):计划 **88 条**(角色 10 + 队长组织 26 + 队员按行 52),
  库里已有 **89**(多出的 1 条是 `tests/helpers.ts` 注入的 `user:test-admin → *`),**真跑新增 0 条** ⇒ 幂等;
- 跑完会列出「**既没有角色规则、也没有个人规则**」的账号(登录后看不到任何数据):本机 1 个
  (`张三 <zhangsan@example.com>`,还没配角色)—— 这是"失败关闭"的正常表现,不是 bug。

### 第二个真实落点:`demo_grid`(Demo › 网格履职)

| 身份 | 规则 | 实测(真实数据 71 条) |
| --- | --- | --- |
| 队员 | 按行:`user:<队员> → demo_grid@<行 id>`(指派时自动写) | **4 条**(七宝镇 7 条里指派给他的) |
| 队长 | 按人:`user:<队长> → demo_grid@org:<××网格组>` | **7 条**(整个七宝镇) |
| 区 | `role:<code> → *, *` | **71 条** |

⚠️ 71 条里有 **2 条没有街镇**(Excel 里是"申北(北部)片区 / 鑫都(南部)片区",部门树里没有对应节点)⇒
`group_id` 为空、**按组织的规则都看不到**(只有 `*` / 裸类型 / 按行授权能看到)。这不是 bug,是"归属未知"的正确表现。

⚠️ **指派流程 = 权限写入口**:`demoGrid.create` 带 `ownerId`、`update` 换负责人、`assign` 批量指派,
都会自动 revoke 旧的 + grant 新的;**删行 / 删用户会连带清掉指着它的策略行**
(`tests/demo-grid.test.ts` 钉住了这一整条闭环)。

### 上线检查 / 维护 SQL

```sql
-- 1) 数据权限到底"启用"了没(0 条 = 未启用 = 一律不过滤)
select count(*) from sys_data_policy where status = 1;

-- 2) 当前有哪些规则(按主体看最直观)
select v0, v1, v2, v3, remark from sys_data_policy where status = 1 order by v0;

-- 3) 有没有"归属组织为空"的业务行 —— 这些行按组织的规则都看不到,要么补上,要么确认它本就不属于任何组织
select count(*) from demo_grid where group_id is null;

-- 4) 有没有指着已删行的僵尸策略(正常应由 remove 清掉)
select p.v0, p.v1 from sys_data_policy p
left join demo_grid g on p.v1 = concat('demo_grid@', g.id)
where p.v1 like 'demo_grid@%' and p.v1 not like '%@org:%' and g.id is null;
```

### 在界面上维护:`/settings/data-policy`(系统设置 ▸ 数据权限)

- 页面只干一件事:**回答「谁因为哪条规则,能看到什么」**,并给出增删改入口。
- 台账列:谁(主体) / 看什么(资源类型 + 范围) / 动作 / 效果 / 状态 / 说明 / 更新时间;支持多选批量删除,选中后有批量条。
- **新增规则是叉积**:主体可多选、范围可多选 ⇒ 一次登记 `主体数 × 范围数` 条(表单实时显示「将新增 N 条」),
  上限 **200** 条(超了接口直接 `BAD_REQUEST`,免得手滑生成上千条)。主体:通配 / 某人 / 某角色 / 某部门;
  范围:全部资源 / 某资源整类 / 某组织及以下 / 具体一行。
- **编辑只开放「效果 / 启用 / 说明」**:`(v0,v1,v2)` 是判定键,改它等于删了重建,所以界面上直接不给改(要换主体或范围就删了重加)。
- **「试算」**(挑任意账号)返回四段:主体集合(每条都带"为什么算这个主体")、命中的规则、每个受管资源的结论
  (`不受限 / 受范围限制 / 一条也看不到(1 = 0) / 全部被拒绝`)、以及**实测的可见条数**
  (与列表页走的是同一条编译路径,不是估算)。
- 权限点:`sys:policy:list` / `:add` / `:edit` / `:remove`(`pnpm db:seed:menus` + `db:seed:rbac` 之后落到 `sys_menu` 与 admin 名下)。
- **纪律**:这个页面**只写 `sys_data_policy`,绝不动 `sys_user_dept`**(编制是区里每天推的)。
  借调就是在「新增规则」里给那个人多加一条 `user:<id>` 规则 —— 见上一节的借调口径。

### 第二期(讨论过、暂不实现)

| 题目 | 需要什么 |
| --- | --- |
| **`custom` 指定若干部门**(跨互不从属的组织) | 角色表单里做部门多选 ⇒ 落成多条 `dept:` / `@org:` 规则(表不用改) |
| **组织类型表 / 非组织维度的资源** | 现在只认 `@org:` 一个轴;要多轴(比如"按街镇"+"按片区")就得给资源加维度列 |
| **跨轴精确并集**(多角色时应把组织条件与按行条件 OR 起来,现在只取"最宽的一档") | 引擎侧小改(`compileScopePlan` 已按并集编译,缺的是"多主体各自判定再并集"),要有真实诉求再动 |
