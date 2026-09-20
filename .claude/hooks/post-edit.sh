#!/usr/bin/env bash
# PostToolUse hook for Edit/Write: format + lint the changed file, blocking
# the edit (exit 2) when Biome reports something it cannot fix itself.
#
# Args: $1 = project root (absolute path)
# Hook stdin: JSON with .tool_input.file_path (absolute path).

set -uo pipefail

root=${1:-}
[ -z "$root" ] && { echo "post-edit.sh: missing project root arg" >&2; exit 1; }

f=$(jq -r '.tool_input.file_path // empty')
[ -z "$f" ] && exit 0

# Only act on files inside the project root.
case "$f" in
"$root"/*) rel=${f#"$root/"} ;;
*) exit 0 ;;
esac

case "$rel" in
*.ts | *.js | *.svelte | *.json | *.css) ;;
*) exit 0 ;;
esac

command -v biome >/dev/null || exit 0

out=$(biome check --write "$f" 2>&1)
status=$?

# A path Biome's config excludes is not a lint failure, but Biome exits 1 on
# it all the same — it reads an explicit path that matches nothing as a user
# error. Both exclusion routes reach this: files.includes (src/app.css, whose
# Tailwind v4 at-rules the CSS parser rejects) and vcs.useIgnoreFile, which
# drops every gitignored file, .claude/settings.local.json among them.
case "$out" in
*"No files were processed"*) exit 0 ;;
esac

# Diagnostics go to stderr so Claude Code surfaces them as the block reason;
# printed to stdout the hook would exit 2 with an empty message.
[ "$status" -eq 0 ] || { printf '%s\n' "$out" >&2; exit 2; }
