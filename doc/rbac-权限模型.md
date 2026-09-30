# RBAC 权限模型(部门 / 角色 / 菜单可见性)

> 本文原在 `AGENTS.md` 里,2026-09 按「精简 AGENTS」的约定搬到这里
> (2026-09 功能权限改由 Casbin 承载后,表名与存储位置已同步更新)。
> 什么时候看它:动权限判定、`sys_casbin_rule`,或 `/settings/{roles,users,departments}` 三页时。

**"部门当组织用",但走的不是 Better Auth 的 organization 插件** —— 那套是"选中一个当前组织 + 租户隔离",
而这里要的是"**同时属于多个部门 + 角色给权限**",语义不同(而且它会往 session 上加一个用不上的
`active_organization_id`)。所以是项目自己的四张表(管组织 / 角色 / 功能权限):

```
sys_dept(树)                         上海公司 / 武汉公司(可嵌套)—— 纯组织架构
sys_role(全局定义)                          管理员 / 员工 / 开发 …   ← 不随部门数增长
sys_user_dept(user_id, department_id)  张三 ∈ 上海公司、武汉公司(**不带角色**)
sys_casbin_rule:g(user, role)                      张三 → 管理员、普通员工(**权限 = 这些角色的并集**)
sys_casbin_rule:p(role, menu)                      角色能看见哪些菜单 / 能用哪些按钮
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
  计算在 `lib/rbac.ts` 的 `effectiveMenusFor(userId)`(它只读 `sys_casbin_rule` 的 `g` 行 + `sys_role`,不看部门):它**只吃 `userId`**,与"怎么拿 userId(会话)"解耦,
  所以单测可以直接喂一个 id,不必造 HTTP 会话。
- **菜单与按钮同一张表**:`sys_menu.type` = 1 目录 / 2 菜单 / 3 按钮,`perm` 是权限标识(如 `sys:role:write`)。
  按钮**不进侧边栏**(`buildNavTree` 会过滤),但作为叶子出现在角色授权树里
  (`PermissionPicker` 给它一个「操作」徽章);授权后它的 `perm` 进入用户的权限集合 ——
  前端 `useHasPerm(code)` 认它。**按钮行的 `path` 用不指向路由的占位值**
  (沿用"纯分组也给占位 path"的既有约定,`path` 保持 not null + 唯一)。
- **勾子节点要自动补全祖先**:侧边栏是按 `parentId` 拼树的,只授权一个深层子菜单会让那一枝无处安放
  ("勾了却看不见")。写入(`role.setMenus`)与读取(`rbac.ts`)用同一份 `withAncestorIds()`。
- **未启用不过滤**:`sys_casbin_rule` 里**一条 `p` 行都没有** → 全部菜单可见 + `perms = null`(一律放行)。
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

⚠️ **跑过它之后权限体系就"启用"了**(`sys_casbin_rule` 里有了 `p` 行):**没有任何角色的账号将看不到任何菜单**(部门归属不影响权限)。
要回到"未启用、全放行"的状态,把 `sys_casbin_rule` 的 `p` 行清空即可。

---

## 页面级(URL)与读接口拦截(2026-09 加强)

**上一版的洞**:侧边栏隐藏只是"看不见入口"。记住 url 照样能直接进,页面里的读接口也照答
(实测:队长直敲 8 个 `/settings/*` 页面都能读出数据)。现在是两层拦截,判定都落在
`lib/rbac.ts`(`canViewPath` + `PERM_BY_PATH`)与 `integrations/trpc/init.ts` 的 `permMiddleware`,
用的还是同一份"角色 → 菜单 + 按钮"授权 —— **没有新增权限点**。

### 第一层:页面(路由)

- 合成码 **`page:<路径折算>:view`**(`pagePermOf()`:非字母数字折成 `_`,小写,去前导斜杠)
  —— `/settings/logs` → `page:settings_logs:view`。语义就是"这个人在菜单里能不能看见这一页"。
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
  3. 一个读被多页共用 ⇒ 值写成数组 = **任一命中即放行**(如 `role.list` = 角色 / 用户 / 部门三页)。
- 新增 query 忘了分类 ⇒ `tests/auth.test.ts` 直接挂;它还断言每条 `PERM_BY_PATH` 的码真实存在、
  `page:` 码能反查到真实菜单路由、无权限账号读受管接口得到「没有权限」。
- 失败关闭:认不到人 ⇒ `perms = []` ⇒ 受管读接口一律 `没有权限:<code>`(HTTP 403;
  未登记的读接口只要登录就能读 —— 所以"忘了登记"的表现是**不拦**,由上面那条测试兜住)。

### 实测基线(生产构建 + 真实浏览器)

| 账号 | 请求 | 结果 |
| --- | --- | --- |
| 未登录 | `/settings/roles` | 307 → `/login?redirect=%2Fsettings%2Froles` |
| 七宝镇队长 | `/settings/{roles,logs}` | **404 + 友好页**(水合前后一致,无控制台异常) |
| 七宝镇队长 | `/settings/users` · `/demo/grid` | 200(2 人 / 7 条) |
| 七宝镇队员 | `/demo/grid` · `/settings/users` | 200(4 条 / 1 人) |
| admin | 全部页面 | 200(网格 71 / 角色 12) |
| 七宝镇队员 | 读接口 `log.list` | 403 `没有权限:sys:log:list` |
| 七宝镇队员 | 读接口 `role.list` | 200 —— 他能看用户管理页,而这一页要用角色名 |

---

> **行级数据权限(ABAC,Casbin 规则 + `sys_data_policy`)已在 2026-09 整体删除** ——
> 表 drop、代码 / 种子 / 权限点 / 菜单行一并清掉,读接口不再做任何行级过滤(所有人看全部)。
> 本文此前那一整节随之移除;上面两层(菜单可见性 + 页面 / 读接口拦截)是现在权限的全部内容。
