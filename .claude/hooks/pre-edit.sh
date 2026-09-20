#!/usr/bin/env bash
# PreToolUse hook for Edit/Write: block edits to generated files. Exits 2
# (the block code) with a stderr message pointing at the regen command.
#
# Args: $1 = project root (absolute path)
# Hook stdin: JSON with .tool_input.file_path (absolute path).

set -uo pipefail

root=${1:-}
[ -z "$root" ] && { echo "pre-edit.sh: missing project root arg" >&2; exit 1; }

f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

# Only enforce rules on files inside the project root.
case "$f" in
"$root"/*) rel=${f#"$root/"} ;;
*) exit 0 ;;
esac

reason=""
case "$rel" in
drizzle/*) reason="drizzle-kit output — change src/lib/server/db/schema.ts and re-run 'pnpm db:generate' instead" ;;
pnpm-lock.yaml) reason="pnpm lockfile — re-run 'pnpm install' or 'pnpm add <pkg>' instead" ;;
.svelte-kit/* | build/*) reason="build output — re-run 'pnpm build' instead" ;;
*) exit 0 ;;
esac

echo "Refusing to edit generated file: $f" >&2
echo "Reason: $reason" >&2
exit 2
