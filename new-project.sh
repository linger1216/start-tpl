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
用法: new-project.sh <project-name> [选项]

选项:
  --into <dir>  新项目放在哪个目录下(默认:模板的同级目录)
  --strict      模板目录存在未提交改动时直接中止(默认只警告并继续)
  -h, --help    显示本帮助

示例:
  ./new-project.sh my-cool-app
  ./new-project.sh MyApp --strict
  ./new-project.sh my-app --into ~/work/projects

说明:
  - 新项目不会包含 git 仓库,请自行在该目录执行 `git init`。
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

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --strict) STRICT=1; shift ;;
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

# --- sanitize into a valid npm package name ----------------------------------
# 小写化;非法字符转 '-' → 去掉首尾 '-'/下划线(npm 包名不允许以下划线开头)
PROJECT_NAME="$(printf '%s' "$RAW" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9_-]+/-/g; s/^[_-]+//; s/[-_]+$//')"

if [ -z "$PROJECT_NAME" ]; then
  echo "Error: '$RAW' 清洗后为空,无法作为包名。" >&2
  exit 1
fi

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

# --- 任何失败(含出错、显式中止、Ctrl-C)都清掉半成品 ---------------------------
# TARGET_DIR 在上面已确认原本不存在,所以这里 rm -rf 是安全的。
SCAFFOLD_OK=0
cleanup_on_error() {
  if [ "$SCAFFOLD_OK" -eq 0 ] && [ -n "${TARGET_DIR:-}" ] && [ -d "$TARGET_DIR" ]; then
    echo "Error: 派生失败,已清理半成品目录: $TARGET_DIR" >&2
    rm -rf "$TARGET_DIR"
  fi
}
trap cleanup_on_error EXIT

# --- copy, excluding build/git artifacts, caches, secrets and this script ---
# Prefer rsync when available (fast, respects trailing-slash semantics).
EXCLUDES=(
  --exclude node_modules
  --exclude .pnpm-store
  --exclude .git
  --exclude .output
  --exclude dist
  --exclude .vite
  --exclude .tanstack
  --exclude .turbo
  --exclude coverage
  --exclude .DS_Store
  # .env.example is the ONLY env file that ships — never copy real secrets.
  # ORDER MATTERS: rsync uses the first matching pattern, so the include
  # must precede the exclude.
  --include .env.example
  --exclude '.env*'
  --exclude new-project.sh
)

if command -v rsync >/dev/null 2>&1; then
  rsync -a "${EXCLUDES[@]}" "$TEMPLATE_DIR/" "$TARGET_DIR/"
else
  # Fallback: copy with find, pruning the excluded dirs.
  mkdir -p "$TARGET_DIR"
  ( cd "$TEMPLATE_DIR"
    find . \( -name node_modules -o -name .pnpm-store -o -name .git -o -name .output -o -name dist \
              -o -name .vite -o -name .tanstack -o -name .turbo -o -name coverage \) -prune \
      -o -type f -print \
      | while IFS= read -r f; do
          case "$f" in
            ./new-project.sh) continue ;;
            ./.env.example) ;;        # the only env file that ships
            ./.env*) continue ;;      # .env / .env.local / .env.*.local — never copy
          esac
          mkdir -p "$TARGET_DIR/$(dirname "$f")" && cp "$f" "$TARGET_DIR/$f"
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

# --- 权限归一化 ---------------------------------------------------------------
# agent 的 write 工具默认产出 600(仅属主可读写),而 rsync -a 会把它原样带过来,
# 结果项目里混着一批"同组/其他用户读不到"的文件。统一成 644 / 755。
# 例外:env 文件含密钥,不参与归一化,单独收紧成 600(见下面的 .env.local 一段)。
PERM_FIXED="$(find "$TARGET_DIR" -type f ! -name '.env*' ! -perm -o+r 2>/dev/null | wc -l | tr -d ' ')"
if [ "$PERM_FIXED" != "0" ]; then
  find "$TARGET_DIR" -type f ! -name '.env*' ! -perm -o+r -exec chmod go+r {} + 2>/dev/null || true
  find "$TARGET_DIR" -type d ! -perm -o+x -exec chmod go+rx {} + 2>/dev/null || true
  echo "  修正 $PERM_FIXED 个文件的权限(600 → 644)"
fi

# --- rename the package name in the new project -----------------------------
# 用 JSON 解析而不是正则替换:模板改过名、或 name 出现在别处都不会出错。
node -e '
  const fs = require("fs");
  const [p, name] = process.argv.slice(1);
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.name = name;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  // 复核
  const back = JSON.parse(fs.readFileSync(p, "utf8"));
  if (back.name !== name) {
    console.error("Error: 写入后复核失败,name = " + back.name);
    process.exit(1);
  }
' "$PKG" "$PROJECT_NAME"
echo "  package.json name -> $PROJECT_NAME"

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
  cp "$ENV_EXAMPLE" "$ENV_LOCAL"
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
  node -e '
    const fs = require("fs");
    const [p, secret] = process.argv.slice(1);
    let t = fs.readFileSync(p, "utf8");
    if (/^BETTER_AUTH_SECRET=/m.test(t)) {
      t = t.replace(/^BETTER_AUTH_SECRET=.*$/m, "BETTER_AUTH_SECRET=" + secret);
    } else {
      // .env.example 里没有这一项也要能用
      t = t.replace(/\s*$/, "") + "\n\n# Better Auth\nBETTER_AUTH_SECRET=" + secret + "\n";
    }
    fs.writeFileSync(p, t);
  ' "$ENV_LOCAL" "$SECRET"
  # .env.local 含 BETTER_AUTH_SECRET(以及你之后填的 DATABASE_URL),收紧为仅属主可读写
  chmod 600 "$ENV_LOCAL" 2>/dev/null || true
  echo "  .env.local 已生成(BETTER_AUTH_SECRET 随机填充,权限 600)"
else
  echo "提示: 目标目录没有 .env.example,跳过 .env.local 生成。" >&2
fi

SCAFFOLD_OK=1

echo ""
echo "Done. 项目位置: $TARGET_DIR"
echo ""
echo "Next steps:"
echo "  cd $TARGET_DIR"
echo "  git init -b main          # 新项目不含 git,按需自行初始化"
echo "  pnpm install"
echo "  # 编辑 .env.local,补上 DATABASE_URL 等真实值"
echo "  pnpm dev"
echo ""
echo "提示:agent 的文件沙箱以「会话工作区」为界,工作区外的路径只能读、不能写。"
echo "      要在 agent 里改这个项目的代码,请让它的工作区包含:"
echo "        $TARGET_ROOT"
