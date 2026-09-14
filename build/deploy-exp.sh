#!/usr/bin/env bash
# Deploy the experimental ("Rus Marble (Exp)") userscript to a private static host.
#
# The exp build is gitignored, so it can't auto-update from GitHub raw like the
# regular script. Instead we host it as a static file behind nginx and point the
# exp build's @downloadURL / @updateURL at it (see build/build-ex.js). This script
# uploads dist/RusMarble.exp.user.js and dist/RusMarble.exp.meta.js to the server
# and installs an idempotent nginx block that serves them.
#
# Everything that identifies the host — SSH target, directories, origin and the
# unguessable public path — lives in build/exp.local.json (gitignored; see
# build/exp.local.example.json). Nothing here should name the real server.
#
# Usage:
#   build/deploy-exp.sh [options]
#
# Options:
#   --host HOST      Remote SSH target          (overrides exp.local.json "host")
#   --static-dir P   Remote static directory    (overrides "staticDir")
#   --nginx-site P   Remote nginx site config   (overrides "nginxSite")
#   --build          Run `node build/build-ex.js` before deploying
#   --help, -h       Show this help
set -euo pipefail

log() { printf '[deploy-exp] %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

EXP_CONFIG="${REPO_DIR}/build/exp.local.json"
[[ -f "$EXP_CONFIG" ]] || { echo "Missing ${EXP_CONFIG} — copy build/exp.local.example.json and fill it in" >&2; exit 1; }
cfg() { node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=c[process.argv[2]];process.stdout.write(Array.isArray(v)?v.join("\n"):(v??""))' "$EXP_CONFIG" "$1"; }

HOST="$(cfg host)"
# Keep the static dir standalone (not under any app dir that gets re-synced/cleaned on redeploy).
STATIC_DIR="$(cfg staticDir)"
NGINX_SITE="$(cfg nginxSite)"
ORIGIN="$(cfg origin)"
PUBLIC_PATH="$(cfg publicPath)"
# Previous public paths that still serve the current files, so installs that
# point at an old @updateURL update once more and pick up the new one. Drop a
# path from the list once every install has moved and it will be removed from nginx.
LEGACY_PATHS="$(cfg legacyPublicPaths)"
DO_BUILD=0

EXP_JS="${REPO_DIR}/dist/RusMarble.exp.user.js"
EXP_META="${REPO_DIR}/dist/RusMarble.exp.meta.js"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)       HOST="${2:-}"; shift 2 ;;
    --static-dir) STATIC_DIR="${2:-}"; shift 2 ;;
    --nginx-site) NGINX_SITE="${2:-}"; shift 2 ;;
    --build)      DO_BUILD=1; shift ;;
    --help|-h)    sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

require_cmd ssh
require_cmd rsync
require_cmd node
for v in HOST STATIC_DIR NGINX_SITE ORIGIN PUBLIC_PATH; do
  [[ -n "${!v}" ]] || { echo "exp.local.json is missing a value for ${v}" >&2; exit 1; }
done
ORIGIN="${ORIGIN%/}"
PUBLIC_PATH="/${PUBLIC_PATH#/}"; PUBLIC_PATH="${PUBLIC_PATH%/}"

if [[ "$DO_BUILD" == "1" ]]; then
  log "Building exp userscript"
  ( cd "$REPO_DIR" && node build/build-ex.js )
fi

[[ -f "$EXP_JS" ]]   || { echo "Missing $EXP_JS — run: node build/build-ex.js" >&2; exit 1; }
[[ -f "$EXP_META" ]] || { echo "Missing $EXP_META — run: node build/build-ex.js" >&2; exit 1; }

log "Checking remote nginx on ${HOST}"
ssh "$HOST" 'command -v nginx >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1' \
  || { echo "Remote is missing nginx/systemctl" >&2; exit 1; }

log "Uploading userscript files to ${HOST}:${STATIC_DIR}"
ssh "$HOST" "mkdir -p '${STATIC_DIR}'"
rsync -az "$EXP_JS"   "${HOST}:${STATIC_DIR}/RusMarble.exp.user.js"
rsync -az "$EXP_META" "${HOST}:${STATIC_DIR}/RusMarble.exp.meta.js"

log "Installing nginx block on ${NGINX_SITE}"
# Paths served: the current one plus any legacy ones (space-separated for awk).
ALL_PATHS="$PUBLIC_PATH"
while IFS= read -r legacy; do
  [[ -n "$legacy" ]] || continue
  legacy="/${legacy#/}"; legacy="${legacy%/}"
  [[ "$legacy" == "$PUBLIC_PATH" ]] || ALL_PATHS="$ALL_PATHS $legacy"
done <<<"$LEGACY_PATHS"

ssh "$HOST" bash -s -- "$STATIC_DIR" "$NGINX_SITE" "$ALL_PATHS" <<'REMOTE'
set -euo pipefail

STATIC_DIR="$1"
NGINX_SITE="$2"
ALL_PATHS="$3"

TS="$(date -u +%Y%m%d-%H%M%S)"
NGINX_BACKUP_PATH="${NGINX_SITE}.bak-exp-${TS}"
TMP_NGINX="$(mktemp)"
trap 'rm -f "$TMP_NGINX"' EXIT

log() { printf '[remote deploy-exp] %s\n' "$*"; }

[[ -f "$NGINX_SITE" ]] || { echo "nginx site not found: $NGINX_SITE" >&2; exit 1; }

cp "$NGINX_SITE" "$NGINX_BACKUP_PATH"

# Remove any previous managed block, then insert a fresh one before `location /`.
awk -v static_dir="$STATIC_DIR" -v paths="$ALL_PATHS" '
  BEGIN {
    n = split(paths, p, " ")
    block = ""
    for (i = 1; i <= n; i++) {
      block = block \
            "    location = " p[i] "/RusMarble.exp.user.js {\n" \
            "        default_type application/javascript;\n" \
            "        add_header Cache-Control \"no-cache\";\n" \
            "        alias " static_dir "/RusMarble.exp.user.js;\n" \
            "    }\n\n" \
            "    location = " p[i] "/RusMarble.exp.meta.js {\n" \
            "        default_type application/javascript;\n" \
            "        add_header Cache-Control \"no-cache\";\n" \
            "        alias " static_dir "/RusMarble.exp.meta.js;\n" \
            "    }\n"
      if (i < n) block = block "\n"
    }
    in_managed = 0
    inserted = 0
  }
  /# BEGIN RUSMARBLE EXP USERSCRIPT/ { in_managed = 1; next }
  /# END RUSMARBLE EXP USERSCRIPT/   { in_managed = 0; next }
  in_managed == 1 { next }
  !inserted && $0 ~ /^    location \/ \{$/ {
    print "    # BEGIN RUSMARBLE EXP USERSCRIPT"
    printf "%s", block
    print "    # END RUSMARBLE EXP USERSCRIPT"
    print ""
    inserted = 1
  }
  { print }
  END { if (!inserted) exit 11 }
' "$NGINX_SITE" >"$TMP_NGINX" || {
  echo "Could not find a 'location / {' block to anchor to in ${NGINX_SITE}" >&2
  exit 1
}

cp "$TMP_NGINX" "$NGINX_SITE"

if ! nginx -t; then
  echo "nginx config test failed; restoring backup" >&2
  cp "$NGINX_BACKUP_PATH" "$NGINX_SITE"
  exit 1
fi
systemctl reload nginx

log "Deployed. nginx backup: ${NGINX_BACKUP_PATH}"
REMOTE

# A CDN in front of the origin may cache .js aggressively (and cache 404s), so a
# fresh deploy can stay hidden behind a stale edge cache. Purge every served URL
# if Cloudflare credentials are available; otherwise tell the user to purge manually.
EXP_URLS=()
for path in $ALL_PATHS; do
  EXP_URLS+=("${ORIGIN}${path}/RusMarble.exp.user.js" "${ORIGIN}${path}/RusMarble.exp.meta.js")
done
if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ZONE_ID:-}" ]]; then
  log "Purging Cloudflare cache for exp URLs"
  files_json="$(printf '"%s",' "${EXP_URLS[@]}")"; files_json="[${files_json%,}]"
  curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":${files_json}}" >/dev/null \
    && log "Cloudflare cache purged" \
    || log "WARN: Cloudflare purge failed"
else
  log "Set CF_API_TOKEN and CF_ZONE_ID to auto-purge the CDN cache, or purge these URLs manually:"
  for u in "${EXP_URLS[@]}"; do log "  $u"; done
fi

log "Verifying public URLs"
for u in "${EXP_URLS[@]}"; do
  curl -fsS -o /dev/null "$u" && log "OK: $u" || log "WARN: could not fetch $u"
done

log "Done."
