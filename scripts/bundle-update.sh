#!/usr/bin/env bash
# Vendors a released @jodybrewster/gemini-live into vendor/.
#
#   npm run bundle:update -- 0.4.0
#
# The tarball comes only from an immutable GitHub Release of the private
# jodybrewster/gemini-live-nextjs repo that its release workflow made on
# main. Before anything is written here, the script checks that:
#   - the release is published (not a draft), immutable and was created by
#     github-actions[bot];
#   - its tag points at a commit whose bundle package.json is this version
#     and which has a successful push run of .github/workflows/release.yml
#     on main whose "release" job succeeded;
#   - it has exactly two assets, the tarball and its .sha256;
#   - the downloaded tarball's sha256 matches both the digest GitHub
#     recorded for the asset and the .sha256 file;
#   - the tarball's own package.json names this package and version.
# Any failure stops the script with nothing in vendor/ or package.json
# changed. It is a supply-chain control: do not loosen a check to get past
# it, find out why it failed.
set -euo pipefail

REPO="jodybrewster/gemini-live-nextjs"
PACKAGE="@jodybrewster/gemini-live"
BOT="github-actions[bot]"
WORKFLOW_PATH=".github/workflows/release.yml"

die() {
  echo "bundle:update: $*" >&2
  exit 1
}

[ "$#" -eq 1 ] || die "usage: npm run bundle:update -- <version>   (for example 0.4.0)"
VERSION="$1"

# Strict semver (semver.org), without build metadata: no leading zeros, and
# nothing a shell, a path or a URL could read as anything but a version.
SEMVER='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*)?$'
[[ "$VERSION" =~ $SEMVER ]] || die "'$VERSION' is not a semver version such as 0.4.0"

command -v gh >/dev/null 2>&1 || die "needs the GitHub CLI (gh), signed in with access to $REPO"
command -v node >/dev/null 2>&1 || die "needs node"
command -v npm >/dev/null 2>&1 || die "needs npm"
if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "needs sha256sum or shasum"
fi

TAG="gemini-live@$VERSION"
ASSET="jodybrewster-gemini-live-$VERSION.tgz"
CHECKSUM="$ASSET.sha256"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[ -f package.json ] && [ -d vendor ] || die "run from the site repo (no package.json or vendor/ in $ROOT)"

echo "Checking release $TAG of $REPO"

# One read of the release, so every check below sees the same answer.
# Lines: draft, immutable, author, tag, asset count, then "name<TAB>digest"
# per asset.
release="$(gh api "repos/$REPO/releases/tags/$TAG" --jq '
  (.draft | tostring),
  (.immutable | tostring),
  .author.login,
  .tag_name,
  (.assets | length | tostring),
  (.assets[] | "\(.name)\t\(.digest // "")")
')" || die "no release $TAG in $REPO (or gh cannot read it)"

lines=()
while IFS= read -r line; do lines+=("$line"); done <<<"$release"
[ "${#lines[@]}" -ge 5 ] || die "unexpected release data for $TAG"

[ "${lines[0]}" = "false" ] || die "release $TAG is a draft"
[ "${lines[1]}" = "true" ] || die "release $TAG is not immutable"
[ "${lines[2]}" = "$BOT" ] || die "release $TAG was created by '${lines[2]}', not $BOT"
[ "${lines[3]}" = "$TAG" ] || die "release tag is '${lines[3]}', not $TAG"
[ "${lines[4]}" = "2" ] || die "release $TAG has ${lines[4]} assets; expected exactly 2 ($ASSET and $CHECKSUM)"
[ "${#lines[@]}" -eq 7 ] || die "unexpected asset list for $TAG"

asset_digest=""
checksum_seen=0
for entry in "${lines[@]:5:2}"; do
  name="${entry%%$'\t'*}"
  digest="${entry#*$'\t'}"
  case "$name" in
    "$ASSET")
      [ -z "$asset_digest" ] || die "asset $ASSET listed twice"
      asset_digest="$digest"
      ;;
    "$CHECKSUM")
      [ "$checksum_seen" -eq 0 ] || die "asset $CHECKSUM listed twice"
      checksum_seen=1
      ;;
    *) die "unexpected asset '$name' on release $TAG" ;;
  esac
done
[ -n "$asset_digest" ] && [ "$checksum_seen" -eq 1 ] || die "release $TAG must have exactly $ASSET and $CHECKSUM"
[[ "$asset_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "GitHub recorded no sha256 digest for $ASSET (got '$asset_digest')"
expected_sha="${asset_digest#sha256:}"

# The commit the tag names. The release workflow makes a lightweight tag;
# an annotated one is followed to its commit.
ref="$(gh api "repos/$REPO/git/ref/tags/$TAG" --jq '"\(.object.type)\t\(.object.sha)"')" || die "cannot read tag $TAG"
ref_type="${ref%%$'\t'*}"
sha="${ref#*$'\t'}"
if [ "$ref_type" = "tag" ]; then
  ref="$(gh api "repos/$REPO/git/tags/$sha" --jq '"\(.object.type)\t\(.object.sha)"')" || die "cannot read tag object for $TAG"
  ref_type="${ref%%$'\t'*}"
  sha="${ref#*$'\t'}"
fi
[ "$ref_type" = "commit" ] || die "tag $TAG does not point at a commit"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "tag $TAG points at '$sha', not a commit sha"

# The bundle at that commit must be this version. Without it, a tag for a
# new version placed on an older release commit (which has a successful
# release run) would pass the run check below.
tagged_version="$(gh api "repos/$REPO/contents/packages/gemini-live-bundle/package.json?ref=$sha" --jq .content | base64 --decode | node -e '
  process.stdout.write(String(JSON.parse(require("fs").readFileSync(0, "utf8")).version ?? ""));
')" || die "cannot read the bundle version at $sha"
[ "$tagged_version" = "$VERSION" ] || die "the bundle at $sha is version '$tagged_version', not $VERSION"

# A successful push run of release.yml on main at that commit, whose
# "release" job succeeded.
run_ids="$(gh api "repos/$REPO/actions/workflows/release.yml/runs?event=push&branch=main&head_sha=$sha&status=success" \
  --jq '.workflow_runs[] | select(.path == "'"$WORKFLOW_PATH"'" and .head_branch == "main" and .head_sha == "'"$sha"'") | .id')" \
  || die "cannot read release.yml runs for $sha"
released_by=""
while IFS= read -r run_id; do
  [ -n "$run_id" ] || continue
  [[ "$run_id" =~ ^[0-9]+$ ]] || die "unexpected run id '$run_id'"
  job="$(gh api "repos/$REPO/actions/runs/$run_id/jobs?per_page=100" \
    --jq '.jobs[] | select(.name == "release" and .conclusion == "success") | .id')" \
    || die "cannot read the jobs of run $run_id"
  if [ -n "$job" ]; then
    released_by="$run_id"
    break
  fi
done <<<"$run_ids"
[ -n "$released_by" ] || die "no successful push run of $WORKFLOW_PATH on main at $sha has a successful release job"

echo "Release $TAG: immutable, by $BOT, from run $released_by at $sha"

tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

gh release download "$TAG" -R "$REPO" -p '*.tgz' -p '*.sha256' -D "$tmp" || die "download of $TAG failed"

downloaded="$(cd "$tmp" && ls -A | LC_ALL=C sort | tr '\n' ' ')"
[ "$downloaded" = "$ASSET $CHECKSUM " ] || die "downloaded files are '$downloaded', expected '$ASSET $CHECKSUM'"
[ -f "$tmp/$ASSET" ] && [ ! -L "$tmp/$ASSET" ] || die "$ASSET is not a regular file"
[ -f "$tmp/$CHECKSUM" ] && [ ! -L "$tmp/$CHECKSUM" ] || die "$CHECKSUM is not a regular file"

actual_sha="$(sha256 "$tmp/$ASSET")"
[ "$actual_sha" = "$expected_sha" ] || die "$ASSET has sha256 $actual_sha, but GitHub recorded $expected_sha"

# The release workflow writes "<sha256>  <file name>" and nothing else.
read -r file_sha file_name extra <"$tmp/$CHECKSUM" || true
[ "$(wc -l <"$tmp/$CHECKSUM" | tr -d ' ')" = "1" ] || die "$CHECKSUM is not a single line"
[ -z "${extra:-}" ] || die "$CHECKSUM has more than a checksum and a file name"
[ "${file_name:-}" = "$ASSET" ] || die "$CHECKSUM names '${file_name:-}', not $ASSET"
[ "${file_sha:-}" = "$actual_sha" ] || die "$CHECKSUM says ${file_sha:-nothing}, but $ASSET has sha256 $actual_sha"

# The tarball must be the package and version it claims to be.
manifest="$(tar -xzOf "$tmp/$ASSET" package/package.json)" || die "$ASSET has no package/package.json"
node -e '
  const [want, version] = process.argv.slice(1);
  const pkg = JSON.parse(require("fs").readFileSync(0, "utf8"));
  if (pkg.name !== want || pkg.version !== version) {
    console.error(`bundle:update: the tarball is ${pkg.name}@${pkg.version}, not ${want}@${version}`);
    process.exit(1);
  }
' "$PACKAGE" "$VERSION" <<<"$manifest" || exit 1

echo "sha256 $actual_sha matches GitHub's digest and $CHECKSUM"

# Vendor it: the new tarball in, the old ones out, package.json pointed at
# it and the lockfile updated without running any package's scripts.
mv "$tmp/$ASSET" "vendor/$ASSET"
shopt -s nullglob
for old in vendor/jodybrewster-gemini-live-*.tgz; do
  [ "$old" = "vendor/$ASSET" ] || rm -f -- "$old"
done
shopt -u nullglob

node -e '
  const fs = require("fs");
  const [pkgName, spec] = process.argv.slice(1);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  if (!pkg.dependencies || !(pkgName in pkg.dependencies)) {
    console.error(`bundle:update: package.json has no dependency on ${pkgName}`);
    process.exit(1);
  }
  pkg.dependencies[pkgName] = spec;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
' "$PACKAGE" "file:vendor/$ASSET"

npm install --ignore-scripts

cat <<EOF

Vendored $PACKAGE $VERSION (vendor/$ASSET, sha256 $actual_sha).

Next:
  1. npm test && npm run typecheck && npm run build
  2. npx playwright install chromium webkit firefox
     npm run test:headers && npm run test:a11y
  3. Commit vendor/, package.json and package-lock.json on a branch and open a PR.
  4. Jody merges it, which deploys production.
EOF
