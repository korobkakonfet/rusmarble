#!/usr/bin/env bash
# Deploy the experimental ("Rus Marble (Exp)") userscript to the Hetzner box.
#
# The exp build is gitignored, so it can't auto-update from GitHub raw like the
# regular script. Instead we host it as a static file behind nginx on
# wplace.zaebal.me and point the exp build's @downloadURL / @updateURL at it
# (see build/build-ex.js). This script uploads dist/RusMarble.exp.user.js and
# dist/RusMarble.exp.meta.js to the server and installs an idempotent nginx
# block that serves them.
#
# Usage:
#   build/deploy-exp.sh [options]
#
# Options:
#   --host HOST      Remote SSH target.        Default: root@het
#   --static-dir P   Remote static directory.  Default: /opt/wplacetgbot/static
#   --nginx-site P   Remote nginx site config. Default: /etc/nginx/sites-available/wplace.zaebal.me
#   --build          Run `node build/build-ex.js` before deploying
#   --help, -h       Show this help
set -euo pipefail

log() { printf '[deploy-exp] %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Required command not found: $1" >&2; exit 1; }
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

HOST="root@het"
STATIC_DIR="/opt/wplacetgbot/static"
NGINX_SITE="/etc/nginx/sites-available/wplace.zaebal.me"
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
ssh "$HOST" bash -s -- "$STATIC_DIR" "$NGINX_SITE" <<'REMOTE'
set -euo pipefail

STATIC_DIR="$1"
NGINX_SITE="$2"

TS="$(date -u +%Y%m%d-%H%M%S)"
NGINX_BACKUP_PATH="${NGINX_SITE}.bak-exp-${TS}"
TMP_NGINX="$(mktemp)"
trap 'rm -f "$TMP_NGINX"' EXIT

log() { printf '[remote deploy-exp] %s\n' "$*"; }

[[ -f "$NGINX_SITE" ]] || { echo "nginx site not found: $NGINX_SITE" >&2; exit 1; }

cp "$NGINX_SITE" "$NGINX_BACKUP_PATH"

# Remove any previous managed block, then insert a fresh one before `location /`.
awk -v static_dir="$STATIC_DIR" '
  BEGIN {
    block = "    location = /wplacebot/RusMarble.exp.user.js {\n" \
            "        default_type application/javascript;\n" \
            "        add_header Cache-Control \"no-cache\";\n" \
            "        alias " static_dir "/RusMarble.exp.user.js;\n" \
            "    }\n\n" \
            "    location = /wplacebot/RusMarble.exp.meta.js {\n" \
            "        default_type application/javascript;\n" \
            "        add_header Cache-Control \"no-cache\";\n" \
            "        alias " static_dir "/RusMarble.exp.meta.js;\n" \
            "    }\n"
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

# Cloudflare fronts wplace.zaebal.me and caches .js aggressively (and caches
# 404s), so a fresh deploy stays hidden behind a stale edge cache. Purge it if
# credentials are available; otherwise tell the user to purge manually.
EXP_URLS=(
  "https://wplace.zaebal.me/wplacebot/RusMarble.exp.user.js"
  "https://wplace.zaebal.me/wplacebot/RusMarble.exp.meta.js"
)
if [[ -n "${CF_API_TOKEN:-}" && -n "${CF_ZONE_ID:-}" ]]; then
  log "Purging Cloudflare cache for exp URLs"
  curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"files\":[\"${EXP_URLS[0]}\",\"${EXP_URLS[1]}\"]}" >/dev/null \
    && log "Cloudflare cache purged" \
    || log "WARN: Cloudflare purge failed"
else
  log "Set CF_API_TOKEN and CF_ZONE_ID to auto-purge Cloudflare, or purge these URLs manually in the Cloudflare dashboard:"
  log "  ${EXP_URLS[0]}"
  log "  ${EXP_URLS[1]}"
fi

log "Verifying public URLs"
curl -fsS -o /dev/null "https://wplace.zaebal.me/wplacebot/RusMarble.exp.user.js" \
  && log "OK: https://wplace.zaebal.me/wplacebot/RusMarble.exp.user.js" \
  || log "WARN: could not fetch exp userscript over HTTPS (check DNS/TLS)"
curl -fsS -o /dev/null "https://wplace.zaebal.me/wplacebot/RusMarble.exp.meta.js" \
  && log "OK: https://wplace.zaebal.me/wplacebot/RusMarble.exp.meta.js" \
  || log "WARN: could not fetch exp meta over HTTPS"

log "Done."
