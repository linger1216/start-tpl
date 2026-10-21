#!/usr/bin/env bash
#
# new-project.sh — 从 start-tpl 模板派生一个新项目。
#
# 用法:
#   ./new-project.sh <project-name> [--strict]
#   ./new-project.sh --help
#
# 行为:
#   - 在模板目录的同级(即 start-tpl 旁边)创建新项目
#   - 排除 node_modules / 构建产物 / 缓存 / .git / 本脚本
#   - 只带 .env.example,绝不复制任何真实 env 文件
#   - 重写 package.json 的 name 与 .cta.json 的 projectName
#   - 由 .env.example 生成 .env.local,并自动填充 BETTER_AUTH_SECRET
#   - **不初始化 git 仓库**,由使用者自行 git init
#
set -euo pipefail

# --- 解析脚本自身位置(支持 ./x.sh、绝对路径、经 PATH 调用、以及符号链接)------
SELF="$0"
case "$SELF" in
  */*) ;;
  *) SELF="$(command -v "$SELF" 2>/dev/null || printf '%s' "$SELF")" ;;
esac

# macOS 的 readlink 没有 -f,手动解链(最多 10 层)
LINK_DEPTH=0
while [ -L "$SELF" ] && [ "$LINK_DEPTH" -lt 10 ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
  LINK_DEPTH=$((LINK_DEPTH + 1))
done

SCRIPT_DIR="$(cd "$(dirname "$SELF")" && pwd)"
TEMPLATE_DIR="$SCRIPT_DIR"

usage() {
  cat <<'EOF'
用法: new-project.sh [project-name] [选项]

选项:
  --into <dir>    新项目放在哪个目录下(默认:模板的同级目录)
  --strict        模板目录存在未提交改动时直接中止(默认只警告并继续)
  --title <名>    网页标题 + 侧边栏品牌名;可与包名不同(中文也行),默认用你输入的项目名
  --port <端口>   本地开发端口(写入 package.json,默认: 3000)
  --install, -i   派生完成后自动安装依赖并生成路由
  --all           功能全要(= 包含全部业务与演示模块)
  --minimal       只要核心(登录 / 后台外壳 / 数据库 / 权限判定 / UI 原语)
  --features a,b  按模块 id 选择(清单与说明见仓库根 features.json)
  --modules a,b   --features 的别名,按模块定制新工程
  --no-input      不交互:功能按 features.json 的推荐值
  -h, --help      显示本帮助

示例:
  ./new-project.sh                                  # 交互式引导输入项目名并勾选模块
  ./new-project.sh my-cool-app
  ./new-project.sh MyApp --strict
  ./new-project.sh my-app --into ~/work/projects
  ./new-project.sh my-app --title '巡检系统' --port 3001
  ./new-project.sh my-app --modules task-close,notice -i
  ./new-project.sh my-app --minimal

说明:
  - 新项目不会包含 git 仓库,请自行在该目录执行 `git init`。
  - **标题**:写进 `package.json` 的 `app.title`,网页标题(`<title>`)与侧边栏顶部一起用它;
    包名 `name` 仍是清洗后的小写 ASCII —— 两者互不影响(读法见 `src/lib/app-meta.ts`)。
  - **功能切分**:不带 `--features` 时会逐项问你;选中的才落进新项目,
    其余功能的文件、菜单、路由注册、权限点、建表语句、脚本一并剔除(物理删除,不留死代码)。
    依赖会自动补齐(如 demo → files)并告诉你补了什么。
  - 排除规则**取自模板的 .gitignore**(由 git 现算):想少带东西就改 .gitignore,
    不用改本脚本。只有模板不是 git 仓库时才用脚本内置的兜底清单。
  - agent(Claude Code / Cursor / DSH 等)的文件沙箱以「会话工作区」为界:
    工作区之外的路径只能读、不能写。若新项目落在工作区之外,agent 改代码时
    会报 readonly / sandbox 错误。用 --into 指到工作区内的目录,或把 agent
    会话的工作区设在模板与新项目的共同上层目录即可。

  也可以用环境变量 NEW_PROJECT_ROOT 代替 --into(适合长期固定一个项目根目录)。
EOF
}

# --- parse arguments (显式循环,兼容 macOS 自带的 bash 3.2) -------------------
RAW=""
STRICT=0
INTO=""
# 功能选择:空 = 还没决定(交互式问);`__all__` / `__none__` 是 --all / --minimal 的哨兵
FEATURES=""
FEATURES_GIVEN=0
NO_INPUT=0
# 展示标题(网页标题 + 侧边栏品牌)。空 = 用你输入的项目名原样;中文标题走这个参数
TITLE=""
# 本地开发端口(写入 package.json scripts.dev)
PORT=""
# 自动安装依赖并构建路由
INSTALL_DEPS=0

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --strict) STRICT=1; shift ;;
    --all) FEATURES="__all__"; FEATURES_GIVEN=1; shift ;;
    --minimal) FEATURES="__none__"; FEATURES_GIVEN=1; shift ;;
    --no-input) NO_INPUT=1; shift ;;
    -i|--install) INSTALL_DEPS=1; shift ;;
    --port|-p)
      if [ $# -lt 2 ]; then
        echo "Error: $1 需要一个端口号(如 3001)。" >&2
        exit 1
      fi
      PORT="$2"; shift 2
      ;;
    --title)
      if [ $# -lt 2 ]; then
        echo "Error: --title 需要一个显示名(可与包名不同,支持中文)。" >&2
        exit 1
      fi
      TITLE="$2"; shift 2
      ;;
    --features|--modules|-m)
      if [ $# -lt 2 ]; then
        echo "Error: $1 需要一个逗号分隔的模块列表(如 task-close,notice)。" >&2
        exit 1
      fi
      FEATURES="$2"; FEATURES_GIVEN=1; shift 2
      ;;
    --into)
      if [ $# -lt 2 ]; then
        echo "Error: --into 需要一个目录参数。" >&2
        exit 1
      fi
      INTO="$2"; shift 2
      ;;
    -*) echo "Error: 未知选项 '$1'" >&2; echo >&2; usage >&2; exit 1 ;;
    *)
      if [ -n "$RAW" ]; then
        echo "Error: 只能指定一个项目名(多余参数:'$1')" >&2
        exit 1
      fi
      RAW="$1"; shift
      ;;
  esac
done

# --- 交互式引导项目名与存放目录(仅在 TTY 且未禁用交互时) ---------------------
if [ -t 0 ] && [ "$NO_INPUT" -eq 0 ]; then
  if [ -z "$RAW" ]; then
    printf "请输入新项目名称 (如 my-app, 输入 q 退出): "
    read -r RAW || RAW=""
    echo ""
    case "$RAW" in
      q|quit|exit) echo "已退出派生。"; exit 0 ;;
    esac
  fi

  if [ -z "$INTO" ]; then
    DEFAULT_PARENT="$(dirname "$TEMPLATE_DIR")"
    printf "请输入存放路径 [直接回车 = 默认同级目录 (%s), 输入 q 退出]: " "$DEFAULT_PARENT"
    read -r USER_INTO || USER_INTO=""
    echo ""
    case "$USER_INTO" in
      q|quit|exit) echo "已退出派生。"; exit 0 ;;
      "") ;; # 回车使用默认
      *) INTO="$USER_INTO" ;;
    esac
  fi
fi

if [ -z "$RAW" ]; then
  echo "Error: 缺少项目名。" >&2
  echo >&2
  usage >&2
  exit 1
fi

# --- 依赖检查 ----------------------------------------------------------------
command -v node >/dev/null 2>&1 || {
  echo "Error: 需要 node(用于校验与改写 package.json、生成密钥)。" >&2
  exit 1
}

# 校验 Node 版本 >= 20(TanStack Start 与 Drizzle 需要现代 Node 特性)
node -e 'const [m] = process.versions.node.split("."); if (Number(m) < 20) { console.error("Error: 需要 Node.js >= 20 (当前 " + process.version + ")"); process.exit(1); }'

# --- 模板自检(在拷贝之前,先确认源本身是好的) --------------------------------
TEMPLATE_PKG="$TEMPLATE_DIR/package.json"
if [ ! -f "$TEMPLATE_PKG" ]; then
  echo "Error: $TEMPLATE_DIR 下没有 package.json —— 这看起来不是 start-tpl 模板目录。" >&2
  exit 1
fi

# package.json 必须是可解析的 JSON。历史上出现过脚本被 HTML 转义
# (`&#34;` / `&amp;`)导致 `pnpm dev` 直接报错的静默故障,这里是它的守门人。
TEMPLATE_NAME="$(node -e '
  const fs = require("fs");
  let j;
  try {
    j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  } catch (e) {
    console.error("Error: 模板的 package.json 不是合法 JSON:" + e.message);
    process.exit(1);
  }
  if (typeof j.name !== "string" || j.name.length === 0) {
    console.error("Error: 模板的 package.json 缺少可用的 name 字段。");
    process.exit(1);
  }
  process.stdout.write(j.name);
' "$TEMPLATE_PKG")"

# --- 功能选择(features.json 是唯一真源;没有它就退化成"全要") ------------------
FEATURES_JSON="$TEMPLATE_DIR/features.json"
PRUNER="$TEMPLATE_DIR/scripts/prune-features.mjs"
FEATURES_IDS=""
if [ ! -f "$FEATURES_JSON" ] || [ ! -f "$PRUNER" ]; then
  echo "提示: 模板里没有 features.json / prune-features.mjs,本次按「全要」派生(不裁剪)。" >&2
elif [ "$FEATURES" = "__all__" ]; then
  FEATURES_IDS="$(node "$PRUNER" --list-ids)"
elif [ "$FEATURES" = "__none__" ]; then
  FEATURES_IDS=""
elif [ "$FEATURES_GIVEN" -eq 1 ]; then
  FEATURES_IDS="$FEATURES"
else
  # 交互式勾选;非 tty 或 --no-input 时用推荐值,不卡住脚本
  if [ "$NO_INPUT" -eq 1 ] || [ ! -t 0 ]; then
    FEATURES_IDS="$(node "$PRUNER" --pick --no-input | sed -n 's/^FEATURES=//p')"
  else
    FEATURES_IDS="$(node "$PRUNER" --pick | sed -n 's/^FEATURES=//p')"
  fi
fi

# --- sanitize into a valid npm package name ----------------------------------
# 小写化;非法字符转 '-' → 去掉首尾 '-'/下划线(npm 包名不允许以下划线开头)
PROJECT_NAME="$(printf '%s' "$RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9_-]+/-/g; s/^[_-]+//; s/[-_]+$//')"

if [ -z "$PROJECT_NAME" ]; then
  echo "Error: '$RAW' 清洗后为空,无法作为包名。" >&2
  echo "       包名必须是 ASCII(字母 / 数字 / 短横线)。想用中文标题就分开写:" >&2
  echo "         ./new-project.sh my-app --title '巡检系统'" >&2
  exit 1
fi

# 展示标题:没给 --title 就用输入原样(中文 / 大小写都保留)
TITLE="${TITLE:-$RAW}"

if [ "$PROJECT_NAME" != "$RAW" ]; then
  echo "注意: 项目名已从 '$RAW' 规范化为 '$PROJECT_NAME'"
fi

# --- 目标根目录:--into > $NEW_PROJECT_ROOT > 模板的同级目录 -------------------
if [ -n "$INTO" ]; then
  RAW_ROOT="$INTO"
elif [ -n "${NEW_PROJECT_ROOT:-}" ]; then
  RAW_ROOT="$NEW_PROJECT_ROOT"
else
  RAW_ROOT="$(dirname "$TEMPLATE_DIR")"
fi

# 展开 ~
case "$RAW_ROOT" in
  "~") RAW_ROOT="$HOME" ;;
  "~/"*) RAW_ROOT="$HOME/${RAW_ROOT#\~/}" ;;
esac

mkdir -p "$RAW_ROOT" 2>/dev/null || true
TARGET_ROOT="$(cd "$RAW_ROOT" 2>/dev/null && pwd)" || {
  echo "Error: 目标根目录不可用:$RAW_ROOT" >&2
  exit 1
}

# --- 写入预检 ----------------------------------------------------------------
# 文件模式位反映不了 harness 的「路径沙箱」,所以这里做一次真实写入探测:
# 把"新项目落在 agent 工作区之外"提前变成一句人话,而不是 rsync 的
# "Operation not permitted"。
PROBE="$TARGET_ROOT/.np-write-probe.$$"
if ! ( : > "$PROBE" ) 2>/dev/null; then
  cat >&2 <<EOF
Error: 目标根目录不可写:$TARGET_ROOT

最常见的原因:agent(Claude Code / Cursor / DSH 等)的文件沙箱以「会话工作区」
为界,工作区之外的路径只能读、不能写 —— 这与文件权限位无关,chmod 也解决不了。
任选一种办法:

  1) 用 --into 指到工作区内的目录:
       ./new-project.sh $PROJECT_NAME --into <工作区内的目录>
  2) 设一个长期生效的项目根目录:
       export NEW_PROJECT_ROOT=<工作区内的目录>
  3) 在你自己终端里运行本脚本(没有 agent 沙箱)
  4) 把 agent 会话的工作区设成 $TARGET_ROOT 或它的上层目录
EOF
  exit 1
fi
rm -f "$PROBE"

TARGET_DIR="$TARGET_ROOT/$PROJECT_NAME"

if [ "$TARGET_DIR" = "$TEMPLATE_DIR" ]; then
  echo "Error: 项目名与模板目录同名,会覆盖模板自身。请换一个名字。" >&2
  exit 1
fi

if [ -e "$TARGET_DIR" ]; then
  echo "Error: 目标已存在: $TARGET_DIR" >&2
  exit 1
fi

# --- 脏工作区提示 -------------------------------------------------------------
# 派生的是**当前工作区**,不是 HEAD。所以未提交的改动会一起被复制 ——
# 这通常是想要的行为(边改模板边派生),故默认只警告;要强约束就加 --strict。
IS_GIT=0
if command -v git >/dev/null 2>&1 \
   && git -C "$TEMPLATE_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  IS_GIT=1
fi

if [ "$IS_GIT" -eq 1 ]; then
  DIRTY="$(git -C "$TEMPLATE_DIR" status --porcelain)"
  if [ -n "$DIRTY" ]; then
    DIRTY_COUNT="$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')"
    if [ "$STRICT" -eq 1 ]; then
      echo "Error: 模板目录有 $DIRTY_COUNT 项未提交改动(--strict),中止:" >&2
      printf '%s\n' "$DIRTY" >&2
      exit 1
    fi
    echo "提示: 模板目录有 $DIRTY_COUNT 项未提交改动,会一并复制进新项目(加 --strict 可改为中止)。"
  fi
elif [ "$STRICT" -eq 1 ]; then
  # 静默失效最坑:用户以为加了强约束,其实什么都没检查。
  echo "提示: 模板目录不是 git 仓库,--strict 无从判断'未提交改动',本次已跳过该检查。" >&2
fi

echo "Scaffolding '$PROJECT_NAME' ..."
echo "  from: $TEMPLATE_DIR"
echo "  to:   $TARGET_DIR"
if [ -n "$FEATURES_IDS" ]; then
  echo "  模块: $FEATURES_IDS"
else
  echo "  模块: (仅核心 —— 所有可选模块都不带)"
fi

# --- 任何失败(含出错、显式中止、Ctrl-C)都清掉半成品 ---------------------------
# TARGET_DIR 在上面已确认原本不存在,所以这里 rm -rf 是安全的。
SCAFFOLD_OK=0
cleanup_on_exit() {
  if [ "$SCAFFOLD_OK" -eq 0 ] && [ -n "${TARGET_DIR:-}" ] && [ -d "$TARGET_DIR" ]; then
    echo "Error: 派生失败,已清理半成品目录: $TARGET_DIR" >&2
    rm -rf "$TARGET_DIR"
  fi
  if [ -n "${IGNORES_FROM_GIT:-}" ]; then rm -f "$IGNORES_FROM_GIT"; fi
  return 0
}
trap cleanup_on_exit EXIT INT TERM

# --- 排除集:单一真源 ---------------------------------------------------------
# 为什么不再手抄一份排除表:那和 `.gitignore` 是同一件事的两种写法,而手抄那份**已经漂移**
# (.idea / .sentryclirc / *.pem / *.key / *.log / test-results … 全在 .gitignore 里、不在脚本里),
# 结果是派生出来的项目带上本机垃圾甚至私钥。现在模板是 git 仓库时,由 **git 自己**给忽略集。
#
# ⚠️ 别把 .gitignore 整份抄成排除表:`*.html` / `*.xlsx` 是历史垃圾规则,抄过来会静默吞掉
#    将来要分发的 `public/404.html`。git 派生没有这个问题 —— 被跟踪的文件永远不会被判为 ignored。
# 所以这里只留「gitignore 表达不了、或必须无条件挡住」的:
DENY=( .git node_modules .pnpm-store new-project.sh .serena )

# 模板**不是** git 仓库时的兜底(pattern 形式;有 git 时不用这张表,那一路由 .gitignore 说话)
# 注意这张表是"尽力而为的镜像",故意**不**抄 .gitignore 里的 `*.html` —— 那会静默吞掉
# 将来要分发的 `public/404.html` 这类文件(见上面那段注释);宁可少排,不可误伤。
FALLBACK_DENY=(
  node_modules .pnpm-store .git .output dist .vite .tanstack .turbo coverage
  .DS_Store .serena .idea .cache logs test-results playwright-report
  '*.log' '*.tsbuildinfo' '.eslintcache' '.stylelintcache' '.sentryclirc*' 'sentry.properties'
  '*.pem' '*.key' '*.p12' '*.pfx' '*.sqlite' '*.sqlite3' '*.db' '*.bak' '*.tmp' '*.tgz' '*.xlsx'
  '.pnp' '.pnp.js' '.nitro' '.vinxi' build .wrangler .vercel .netlify .firebase .serverless
)

# 被 `.gitignore` 命中的路径(不含"未跟踪但想要"的文件)—— 由 git 自己列,脚本不维护第二份。
IGNORES_FROM_GIT=""
if [ "$IS_GIT" -eq 1 ]; then
  IGNORES_FROM_GIT="$(mktemp "${TMPDIR:-/tmp}/np-ignores.XXXXXX")"
  if ! git -C "$TEMPLATE_DIR" status --porcelain --ignored=matching -z 2>/dev/null \
       | tr '\0' '\n' | sed -n 's/^!! //p' \
       | while IFS= read -r ignored; do
           # 结尾的 `/` **要保留** —— rsync 里它表示"只匹配目录",连空目录一起排掉。
           # (别改写成 `dir/**`:那只排内容、目录本身仍会被建出来 —— 实测留下空的 .output/ 与 .idea/)
           # 带路径的按**根锚定**写(如 `/doc/旧目录/`),避免按 basename 误伤深处的同名目录;
           # 其余按组件匹配(与 .gitignore 同义,`foo.log` 命中任意层级)。
           case "$ignored" in
             */*) printf '/%s\n' "$ignored" ;;
             *) printf '%s\n' "$ignored" ;;
           esac
         done > "$IGNORES_FROM_GIT"; then
    # 老 git 不认 --ignored=matching:忽略集退化成空 ⇒ 改用兜底表(宁可多排,别漏)
    : > "$IGNORES_FROM_GIT"
    DENY+=( "${FALLBACK_DENY[@]}" )
    echo "提示: 当前 git 不支持 --ignored=matching,本次改用脚本内置的排除集。" >&2
  fi
fi

# --- 根据所选模块计算排除路径 (未选模块在拷贝时直接跳过, 按需拷贝对应文件) ---
MODULE_EXCLUDES=()
if [ -f "$PRUNER" ] && [ -f "$FEATURES_JSON" ]; then
  while IFS= read -r p; do
    [ -n "$p" ] && MODULE_EXCLUDES+=( "$p" )
  done < <(node "$PRUNER" --list-excluded-paths --features "$FEATURES_IDS" 2>/dev/null || true)
fi

if [ ${#MODULE_EXCLUDES[@]} -gt 0 ]; then
  echo "  按模块过滤: 排除未选模块的 ${#MODULE_EXCLUDES[@]} 项路径, 仅拷贝所需模块文件"
fi

# --- copy, excluding build/git artifacts, caches, secrets and this script ---
if command -v rsync >/dev/null 2>&1; then
  # Prefer rsync when available (fast, preserves modes, respects trailing-slash semantics).
  RSYNC_ARGS=( -a )
  for pattern in "${DENY[@]}"; do RSYNC_ARGS+=( --exclude "$pattern" ); done
  for pattern in "${MODULE_EXCLUDES[@]}"; do
    case "$pattern" in
      /*) RSYNC_ARGS+=( --exclude "$pattern" ) ;;
      *) RSYNC_ARGS+=( --exclude "/$pattern" ) ;;
    esac
  done
  # .env.example is the ONLY env file that ships — never copy real secrets.
  # ORDER MATTERS: rsync uses the first matching pattern, so the include must precede the exclude.
  RSYNC_ARGS+=( --include .env.example --exclude '.env*' )
  if [ -n "$IGNORES_FROM_GIT" ]; then RSYNC_ARGS+=( --exclude-from "$IGNORES_FROM_GIT" ); fi
  rsync "${RSYNC_ARGS[@]}" "$TEMPLATE_DIR/" "$TARGET_DIR/"
elif [ "$IS_GIT" -eq 1 ]; then
  # 没有 rsync:让 git 给出**要哪些文件**(tracked + 未跟踪但没被忽略)。
  # 这一路最准,而且天然带上"边改模板边派生"的未跟踪新文件。
  mkdir -p "$TARGET_DIR"
  ( cd "$TEMPLATE_DIR" &&
    git ls-files -z --cached --others --exclude-standard |
    while IFS= read -r -d '' f; do
      # 环境文件按 **basename** 兜一道:这条策略不能只靠 .gitignore(它是"绝不带真值"的硬规矩,
      # 而 `.gitignore` 是会被改的业务配置)
      case "$(basename "$f")" in
        .env.example) ;;
        .env*) continue ;;
      esac
      case "$f" in new-project.sh|.serena|.serena/*) continue ;; esac
      for ex in "${MODULE_EXCLUDES[@]}"; do
        case "$f" in
          "$ex"|"$ex"/*) continue 2 ;;
        esac
      done
      mkdir -p "$TARGET_DIR/$(dirname "$f")" && cp -p "$f" "$TARGET_DIR/$f"
    done
  )
else
  # 既没有 rsync 也不是 git 仓库:按兜底表剪枝 + 逐文件过滤。
  # ⚠️ 过滤看的是 **basename** —— 老版本只挡得住根目录的 `./.env*`,嵌套的 `.env.local` 会被复制(真实漏洞)。
  mkdir -p "$TARGET_DIR"
  ( cd "$TEMPLATE_DIR"
    find . \( -name node_modules -o -name .pnpm-store -o -name .git -o -name .output \
              -o -name .tanstack -o -name .cache \) -prune \
      -o -type f -print \
      | while IFS= read -r f; do
          case "$(basename "$f")" in
            .env.example) ;;        # the only env file that ships
            .env*) continue ;;      # .env / .env.local / .env.*.local — never copy, 任意层级
          esac
          skip=0
          for pattern in "${FALLBACK_DENY[@]}"; do
            case "$(basename "$f")" in $pattern) skip=1; break ;; esac
            case "$f" in */"$pattern"|*/"$pattern"/*) skip=1; break ;; esac
          done
          for ex in "${MODULE_EXCLUDES[@]}"; do
            case "${f#./}" in
              "$ex"|"$ex"/*) skip=1; break ;;
            esac
          done
          if [ "$skip" -eq 1 ]; then continue; fi
          mkdir -p "$TARGET_DIR/$(dirname "$f")" && cp -p "$f" "$TARGET_DIR/$f"
        done
  )
fi

# --- 拷贝结果自检 -------------------------------------------------------------
PKG="$TARGET_DIR/package.json"
if [ ! -f "$PKG" ]; then
  echo "Error: 拷贝结果里没有 package.json,模板目录可能不完整。" >&2
  exit 1
fi

# 模板自身的 .git 绝不能被带过来(rsync/find 都排除了,这里再兜一道)
if [ -e "$TARGET_DIR/.git" ]; then
  echo "Error: 目标目录里出现了 .git —— 排除规则失效,已中止以免污染新项目。" >&2
  exit 1
fi

# 数量核对:把"静默漏拷"变成一句人话(差值 = 被排除的项,不为零是正常的)
if [ "$IS_GIT" -eq 1 ]; then
  EXPECTED="$( ( cd "$TEMPLATE_DIR" && git ls-files --cached --others --exclude-standard ) | wc -l | tr -d ' ')"
  ACTUAL="$(find "$TARGET_DIR" -type f | wc -l | tr -d ' ')"
  echo "  拷贝 $ACTUAL 个文件(模板 git 视角 $EXPECTED 个;差值即未选模块与被排除项)"
fi

# --- 模块联动清理与注册点同步(规则与依赖都在 features.json) -------------
# 跑在按模块复制之后:由于未选模块的文件已在拷贝时跳过,此处主要执行跨文件联动规则(清理 router/nav/schema 引用与测试数字)
if [ -f "$PRUNER" ] && [ -f "$FEATURES_JSON" ]; then
  node "$PRUNER" --root "$TARGET_DIR" --features "$FEATURES_IDS"
fi

# --- 权限归一化 ---------------------------------------------------------------
# agent 的 write 工具默认产出 600(仅属主可读写),而 rsync -a 会把它原样带过来,
# 结果项目里混着一批"同组/其他用户读不到"的文件。统一成 644 / 755。
# 例外:env 文件含密钥,不参与归一化,单独收紧成 600(见下面的 .env.local 一段)。
PERM_FIXED="$(find "$TARGET_DIR" -type f ! -name '.env*' ! -perm -o+r -print -exec chmod go+r {} + 2>/dev/null \
  | wc -l | tr -d ' ')"
if [ "$PERM_FIXED" != "0" ]; then
  find "$TARGET_DIR" -type d ! -perm -o+x -exec chmod go+rx {} + 2>/dev/null || true
  echo "  修正 $PERM_FIXED 个文件的权限(600 → 644)"
fi

# --- rename the package name in the new project -----------------------------
# 用 JSON 解析而不是正则替换:模板改过名、或 name 出现在别处都不会出错。
node -e '
  const fs = require("fs");
  const [p, name, title, port] = process.argv.slice(1);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.name = name;
  // 展示标题用**你输入的原样**(中文 / 大小写都保留),包名必须是小写 ASCII —— 两者分开,
  // 见 src/lib/app-meta.ts:页面标题与侧边栏品牌都读 app.title。副标题留空,自己的品牌自己填。
  j.app = { ...(j.app ?? {}), title, subtitle: "" };
  if (port && j.scripts && j.scripts.dev) {
    j.scripts.dev = j.scripts.dev.replace(/--port\s+\d+/, "--port " + port);
  }
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  // 复核
  const back = JSON.parse(fs.readFileSync(p, "utf8"));
  if (back.name !== name || back.app?.title !== title) {
    console.error("Error: 写入后复核失败,name = " + back.name + ", app.title = " + back.app?.title);
    process.exit(1);
  }
' "$PKG" "$PROJECT_NAME" "$TITLE" "$PORT"

if [ -n "$PORT" ]; then
  echo "  package.json name -> $PROJECT_NAME, app.title -> $TITLE, dev 端口 -> $PORT"
else
  echo "  package.json name -> $PROJECT_NAME, app.title -> $TITLE(副标题留空,按需填)"
fi

# --- keep the TanStack CLI state file in sync --------------------------------
CTA="$TARGET_DIR/.cta.json"
if [ -f "$CTA" ]; then
  node -e '
    const fs = require("fs");
    const [p, name] = process.argv.slice(1);
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    if ("projectName" in j) {
      j.projectName = name;
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
    }
  ' "$CTA" "$PROJECT_NAME"
  echo "  .cta.json projectName -> $PROJECT_NAME"
fi

# --- bootstrap .env.local from the example -----------------------------------
ENV_EXAMPLE="$TARGET_DIR/.env.example"
ENV_LOCAL="$TARGET_DIR/.env.local"
if [ -f "$ENV_EXAMPLE" ]; then
  # umask 077 包住:让文件**生下来**就是 600,而不是先 644 再 chmod —— 中间那一瞬
  # BETTER_AUTH_SECRET 是同组/其他可读的(单机影响小,但没理由留着)
  ( umask 077; cp "$ENV_EXAMPLE" "$ENV_LOCAL" )
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
  node -e '
    const fs = require("fs");
    const [p, secret, name] = process.argv.slice(1);
    let t = fs.readFileSync(p, "utf8");
    if (/^BETTER_AUTH_SECRET=/m.test(t)) {
      t = t.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=" + secret);
    } else {
      // .env.example 里没有这一项也要能用
      t = t.replace(/\s*$/, "") + "\n\n# Better Auth\nBETTER_AUTH_SECRET=" + secret + "\n";
    }
    // 自动将默认数据库名 mydb 替换为项目同名库,隔离多项目开发
    if (name) {
      t = t.replace(/(mysql:\/\/[^/]+\/)mydb([?"\s]|$)/m, "$1" + name + "$2");
    }
    fs.writeFileSync(p, t);
  ' "$ENV_LOCAL" "$SECRET" "$PROJECT_NAME"
  # .env.local 含 BETTER_AUTH_SECRET(以及你之后填的 DATABASE_URL),收紧为仅属主可读写
  chmod 600 "$ENV_LOCAL" 2>/dev/null || true
  echo "  .env.local 已生成(BETTER_AUTH_SECRET 随机填充, DATABASE_URL 库名 -> $PROJECT_NAME, 权限 600)"
else
  echo "提示: 目标目录没有 .env.example,跳过 .env.local 生成。" >&2
fi

SCAFFOLD_OK=1

# --- 自动安装依赖与构建路由 ---------------------------------------------------
DID_INSTALL=0
if [ "$INSTALL_DEPS" -eq 1 ]; then
  DID_INSTALL=1
elif [ -t 0 ] && [ "$NO_INPUT" -eq 0 ]; then
  echo ""
  printf "是否立即安装依赖并构建路由 (pnpm install && pnpm generate-routes)? [y/N]: "
  read -r DO_INSTALL || DO_INSTALL=""
  case "$DO_INSTALL" in
    y*|Y*) DID_INSTALL=1 ;;
  esac
fi

if [ "$DID_INSTALL" -eq 1 ]; then
  echo ""
  echo "正在安装依赖与生成路由表 (pnpm install && pnpm generate-routes) ..."
  if command -v pnpm >/dev/null 2>&1; then
    ( cd "$TARGET_DIR" && pnpm install && pnpm generate-routes )
  else
    echo "提示: 未找到 pnpm,跳过自动安装。请在目标目录下手动执行 pnpm install && pnpm generate-routes。" >&2
    DID_INSTALL=0
  fi
fi

echo ""
echo "Done. 项目位置: $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  git init -b main          # 新项目不含 git,按需自行初始化"
if [ "$DID_INSTALL" -eq 1 ]; then
  echo "  pnpm typecheck && pnpm check"
  echo "  # 编辑 .env.local,补上 DATABASE_URL 等真实值"
  echo "  pnpm db:create            # 只建剩下的表(见上面「不再建的表」)"
  echo "  pnpm dev                  # 启动开发服务器"
else
  echo "  pnpm install"
  echo "  pnpm generate-routes      # ★ 必跑:路由表是生成物,裁过功能(删过路由文件)必须重建"
  echo "  pnpm typecheck && pnpm check"
  echo "  # 编辑 .env.local,补上 DATABASE_URL 等真实值"
  echo "  pnpm db:create            # 只建剩下的表(见上面「不再建的表」)"
  echo "  pnpm dev                  # 种子按上面「建议先跑的种子」那几个跑"
fi
echo ""
echo "提示:agent 的文件沙箱以「会话工作区」为界,工作区外的路径只能读、不能写。"
echo "      要在 agent 里改这个项目的代码,请让它的工作区包含:"
echo "        $TARGET_ROOT"

# --- 模板名残留清单(只列不改)-------------------------------------------------
# 脚本只改了 package.json / .cta.json;README、AGENTS 的标题里仍写着模板名。
# **刻意不自动替换**:`doc/已知陷阱.md` 里那句「不要把 start-tpl 硬编码进业务代码」是**举例说明**,
# 盲替换会把文档改坏 —— 所以只出清单,由人决定改哪些。
if [ -n "$TEMPLATE_NAME" ] && [ "$TEMPLATE_NAME" != "$PROJECT_NAME" ]; then
  LEFTOVER="$(grep -rlF -I "$TEMPLATE_NAME" "$TARGET_DIR" 2>/dev/null | grep -v '/pnpm-lock\.yaml$' || true)"
  if [ -n "$LEFTOVER" ]; then
    echo ""
    echo "提示: 以下文件仍含模板名 '$TEMPLATE_NAME'(标题 / 文案按需自己改):"
    printf '%s\n' "$LEFTOVER" | while IFS= read -r hit; do
      printf '  %s\n' "${hit#"$TARGET_DIR"/}"
    done
  fi
fi
