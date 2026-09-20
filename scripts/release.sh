#!/usr/bin/env bash
# Cuts a release of the app (v* tags) or of the chart (chart-v* tags); the two version
# independently. Each is two halves: write the version and the changelog into a revision
# of their own and advance main, then tag main and push. Run the halves apart to read
# the generated changelog first — the tag push is what CI publishes from.
set -euo pipefail
cd "$(dirname "$0")/.."

CHART=chart/Chart.yaml

die() {
	echo "release: $*" >&2
	exit 1
}

usage() {
	cat >&2 <<'EOF'
usage: release app <version>             app-changelog, then app-tag
       release app-changelog <version>   CHANGELOG.md + package.json version, committed on main
       release app-tag <version>         tag main v<version> and push it
       release chart <version>           chart-bump, then chart-tag
       release chart-bump <version>      Chart.yaml version + chart/CHANGELOG.md, committed on main
       release chart-tag                 tag main chart-v<Chart.yaml version> and push it
A leading v on <version> is accepted and stripped.
EOF
	exit 2
}

version() {
	local v=${1#v}
	[[ $v =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
		die "version must look like 1.2.3 or 1.2.3-rc.1, got '$1'"
	echo "$v"
}

tag_free() {
	# jj tag list prints nothing on stdout for a name it does not have.
	[ -z "$(jj tag list "$1" 2>/dev/null)" ] || die "$1 already exists"
}

# The working copy becomes the release revision, so it has to hold nothing else. The
# edit runs inside it, and jj snapshots it on the bookmark move that follows — so the
# change lands on the revision main ends up at, not in a working copy left behind.
commit_to_main() {
	local message=$1
	shift
	[ "$(jj log -r @ --no-graph -T empty)" = true ] ||
		die "the working copy has changes; commit or move them before releasing"
	jj describe -m "$message"
	"$@"
	jj bookmark set main -r @
	jj new
}

push_tag() {
	tag_free "$1"
	jj tag set "$1" -r main
	jj git push --remote origin --bookmark main
	# This push is the trigger: it fans out to .github/workflows/image.yml or release-chart.yml.
	jj git push --remote origin --tag "$1"
}

write_app() {
	# package.json is the version the Nix package, the Nix image tag and the app itself
	# read; the git tag never reaches them.
	sed -i "s/^\t\"version\": \".*\",$/\t\"version\": \"$1\",/" package.json
	grep -q "^\s\"version\": \"$1\",$" package.json || die "could not rewrite the version in package.json"
	git-cliff --tag "v$1" --exclude-path 'chart/**' -o CHANGELOG.md
}

write_chart() {
	sed -i "s/^version: .*/version: $1/" "$CHART"
	git-cliff --config cliff.chart.toml --tag "chart-v$1" --include-path 'chart/**' -o chart/CHANGELOG.md
}

app_changelog() {
	local v
	v=$(version "$1")
	tag_free "v$v"
	commit_to_main "docs(changelog): v$v" write_app "$v"
}

# Both tag halves read main, not the working copy: only what is committed gets released.
app_tag() {
	local v
	v=$(version "$1")
	jj file show -r main CHANGELOG.md 2>/dev/null | grep -q "^## \[$v\]" ||
		die "main's CHANGELOG.md has no $v section — run: release app-changelog $v"
	jj file show -r main package.json | grep -q "^\s\"version\": \"$v\",$" ||
		die "main's package.json is not at $v — run: release app-changelog $v"
	push_tag "v$v"
}

chart_bump() {
	local v
	v=$(version "$1")
	tag_free "chart-v$v"
	commit_to_main "chore(chart): chart v$v" write_chart "$v"
}

chart_tag() {
	local v
	v=$(jj file show -r main "$CHART" | sed -n 's/^version: *//p')
	jj file show -r main chart/CHANGELOG.md 2>/dev/null | grep -q "^## \[$v\]" ||
		die "main's chart/CHANGELOG.md has no $v section — run: release chart-bump $v"
	push_tag "chart-v$v"
}

case ${1:-} in
app) [ $# -eq 2 ] || usage; app_changelog "$2"; app_tag "$2" ;;
app-changelog) [ $# -eq 2 ] || usage; app_changelog "$2" ;;
app-tag) [ $# -eq 2 ] || usage; app_tag "$2" ;;
chart) [ $# -eq 2 ] || usage; chart_bump "$2"; chart_tag ;;
chart-bump) [ $# -eq 2 ] || usage; chart_bump "$2" ;;
chart-tag) [ $# -eq 1 ] || usage; chart_tag ;;
*) usage ;;
esac
