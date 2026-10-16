#!/usr/bin/env bash
# Backs up every synced key for one profile (default "roxie") out of the
# Worker's KV namespace into a dated JSON file in backups/ (gitignored --
# this is Roxie's real personal data, never committed to the public repo).
# Uses `wrangler kv key` directly against Cloudflare, bypassing the
# Worker's own password/rate-limit gate entirely (this runs with the
# developer's own `wrangler` auth, not SEARCH_PASSWORD).
#
# Lists keys first and only calls `kv key get` on ones that actually
# exist: `wrangler kv key get` on a MISSING key doesn't just return empty,
# it prints an interactive "report this error to Cloudflare?" prompt to
# stdout (even with a piped/non-interactive stdin), which would otherwise
# corrupt the backup JSON.
#
# Usage: worker/scripts/backup_kv.sh [profile_id]
set -euo pipefail

PROFILE_ID="${1:-roxie}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/.." && pwd)"
BACKUP_DIR="$REPO_ROOT/backups"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$BACKUP_DIR/kv-${PROFILE_ID}-${TIMESTAMP}.json"

# Keep in sync with worker/src/index.js's STATE_ALLOWED_KEYS.
KEYS=(mis_productos not_for_me mi_lista hidden_categories earnings_goal)

mkdir -p "$BACKUP_DIR"
cd "$WORKER_DIR"

echo "Backing up profile \"$PROFILE_ID\" to $OUT_FILE" >&2

EXISTING_KEYS="$(npx wrangler kv key list --binding SEARCH_KV --prefix "state:${PROFILE_ID}:" 2>/dev/null)"

{
  echo "{"
  echo "  \"profile_id\": \"$PROFILE_ID\","
  echo "  \"backed_up_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"keys\": {"
  first=1
  for key in "${KEYS[@]}"; do
    kv_key="state:${PROFILE_ID}:${key}"
    if [ "$first" -eq 0 ]; then echo ","; fi
    first=0
    if echo "$EXISTING_KEYS" | grep -q "\"$kv_key\""; then
      value="$(npx wrangler kv key get --binding SEARCH_KV --text "$kv_key" 2>/dev/null)"
      printf '    "%s": %s' "$key" "$value"
      echo "Backed up: $kv_key" >&2
    else
      printf '    "%s": null' "$key"
      echo "Key not set (yet): $kv_key" >&2
    fi
  done
  echo ""
  echo "  }"
  echo "}"
} > "$OUT_FILE"

echo "Wrote $OUT_FILE" >&2
echo "$OUT_FILE"
