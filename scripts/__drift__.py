#!/usr/bin/env python3
"""对比 scripts/create-system-tables.ts 里的 DDL 与活库 eg 的实际列类型、是否为空、默认值。
只读,不写任何东西。一次性的诊断脚本,跑完删。"""
import re, subprocess, sys

src = open("scripts/create-system-tables.ts", encoding="utf-8").read()
# 在 TS 里,反引号是转义的 \`col\`
blocks = re.findall(
    r'name:\s*"([a-z_]+)",\s*\n\s*ddl:\s*`(.*?)`,\s*\n\t\},',
    src, re.S,
)
desired = {}
desired_full = {}  # column -> (type, rest_of_line for nullable/default)
for name, ddl in blocks:
    cols = {}
    cols_full = {}
    for line in ddl.splitlines():
        m = re.match(r'\s*\\`([a-z_]+)\\`\s+([a-z0-9_]+(?:\([0-9,]+\))?)(.*)$', line, re.I)
        if not m:
            continue
        col, typ, rest = m.group(1), m.group(2).lower(), m.group(3).lower()
        cols[col] = typ
        cols_full[col] = (typ, rest.strip())
    desired[name] = cols
    desired_full[name] = cols_full

# DDL 里出现的 on delete cascade 关系(粗略匹配 — 用于看 DDL 的意图)
fk_cascade_desired = []
for line in src.splitlines():
    if "on delete" in line.lower():
        fk_cascade_desired.append(line.strip())

# 活库凭据
env = open(".env.local", encoding="utf-8").read()
m = re.search(r'DATABASE_URL="?([^"\n]+)', env)
url = m.group(1)
U = re.match(r'mysql://([^:]+):', url).group(1)
P = re.match(r'mysql://[^:]+:([^@]+)@', url).group(1)


def q(sql: str) -> str:
    return subprocess.run(
        ["mysql", "-h", "localhost", "-u", U, f"-p{P}", "-N", "-B", "-e", sql],
        capture_output=True, text=True,
    ).stdout


# 活库 eg
live = {}
live_full = {}
for line in q(
    "select table_name,column_name,column_type,is_nullable,column_default "
    "from information_schema.columns where table_schema='eg' "
    "order by table_name,ordinal_position"
).strip().splitlines():
    t, c, ct, nul, dflt = line.split("\t")
    ct = ct.lower()
    live.setdefault(t, {})[c] = ct
    live_full.setdefault(t, {})[c] = (ct, nul, "null" if dflt == "NULL" else dflt)

# 差异
print(f"DDL 表 {len(desired)} 张;活库 eg {len(live)} 张")
only_ddl = sorted(set(desired) - set(live))
only_live = sorted(set(live) - set(desired))
print(f"DDL 有而活库没有: {only_ddl}")
print(f"活库有而 DDL 没有: {only_live}")

# 列级类型差异
n = 0
for t in sorted(set(desired) & set(live)):
    for c, dt in desired[t].items():
        if c not in live[t]:
            print(f"  [活库缺列] {t}.{c}  DDL={dt}")
            n += 1
            continue
        if live[t][c] != dt:
            print(f"  {t}.{c}: DDL={dt}  活库={live[t][c]}")
            n += 1
print(f"类型不一致列: {n} 处")

# 外键删除规则
print("\n=== eg 外键删除规则 ===")
print(q(
    "select constraint_name,table_name,referenced_table_name,delete_rule "
    "from information_schema.referential_constraints where constraint_schema='eg'"
).strip())

print("\n=== DDL 里写了 on delete ... 的行 ===")
for s in fk_cascade_desired:
    print("  ", s[:200])