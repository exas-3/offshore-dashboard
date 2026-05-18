#!/usr/bin/env bash
# Plausible CE on Hetzner — SSH-tunnel admin UI + adblock-evading tracking.
#
# Runs on the Hetzner VPS as root. Idempotent where possible — re-running
# won't clobber an existing install, but secrets generate only once.
#
# Architecture after this runs:
#
#   Browser  ──HTTPS──▶  Cloudflare  ──▶  Nginx :443  ──┬──▶  Next.js :3000
#                                                       └──▶  Plausible 127.0.0.1:3001
#                                                            via two extra location blocks:
#                                                              /ps/script.js  →  /js/script.js
#                                                              /ps/event      →  /api/event
#
#   Plausible admin UI lives on 127.0.0.1:3001 — NOT publicly exposed.
#   Reach it from your laptop:
#       ssh -L 3001:localhost:3001 root@178.105.127.121
#       open http://localhost:3001
#
# The /ps/* paths defeat adblockers — they aren't on any filter list. The
# `proxy_pass` rewrites them to Plausible's native /js/script.js + /api/event
# so the upstream container is unmodified.

set -euo pipefail

DOMAIN_MAIN="offshoredashboard.xyz"
PLAUSIBLE_PORT=3001
PLAUSIBLE_DIR="/opt/plausible"
NGINX_SITE="/etc/nginx/sites-enabled/offshore-dashboard"
MARKER="# ── plausible proxy ──"

# ── 1. Install Docker if missing ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[plausible] installing docker"
  apt update
  apt install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  # Pick the right Docker repo based on the distro (debian vs ubuntu).
  DISTRO_ID=$(lsb_release -is | tr '[:upper:]' '[:lower:]')
  case "$DISTRO_ID" in
    ubuntu|debian) ;;
    *) echo "[plausible] unsupported distro $DISTRO_ID for docker apt repo" >&2; exit 1 ;;
  esac
  curl -fsSL "https://download.docker.com/linux/${DISTRO_ID}/gpg" \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/${DISTRO_ID} $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt update
  apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# ── 2. Clone Plausible CE ───────────────────────────────────────────────────
mkdir -p "$PLAUSIBLE_DIR"
cd "$PLAUSIBLE_DIR"
if [ ! -d hosting ]; then
  echo "[plausible] cloning plausible/community-edition"
  git clone --depth 1 https://github.com/plausible/community-edition hosting
fi
cd hosting

# ── 3. Generate secrets (once; ignored on re-run) ──────────────────────────
if [ ! -f .env ]; then
  echo "[plausible] generating .env"
  SECRET_KEY_BASE=$(openssl rand -base64 48 | tr -d '\n')
  TOTP_VAULT_KEY=$(openssl rand -base64 32 | tr -d '\n')
  cat > .env <<EOF
# ── Plausible CE configuration ──────────────────────────────────────────────
# BASE_URL is what Plausible bakes into emailed links / shared-dashboard URLs.
# With SSH-tunnel access it points at localhost.
BASE_URL=http://localhost:${PLAUSIBLE_PORT}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
TOTP_VAULT_KEY=${TOTP_VAULT_KEY}

# Lock down registration after creating your admin account.
DISABLE_REGISTRATION=invite_only

# Container listens on the default 8000 internally; the compose override
# publishes it as 127.0.0.1:${PLAUSIBLE_PORT} on the host.
HTTP_PORT=8000
EOF
  chmod 600 .env
fi

# ── 4. Compose override: publish plausible on localhost-only port ──────────
# Upstream compose.yml exposes plausible only to the docker network. Add a
# host port binding so nginx can reach it. Bound to 127.0.0.1 — the admin UI
# stays SSH-tunnel-only.
if [ ! -f compose.override.yml ]; then
  cat > compose.override.yml <<EOF
services:
  plausible:
    ports:
      - "127.0.0.1:${PLAUSIBLE_PORT}:8000"
EOF
fi

# ── 5. Pull and start the stack ─────────────────────────────────────────────
echo "[plausible] docker compose up -d"
docker compose pull
docker compose up -d

# Wait for Plausible to answer.
for i in {1..30}; do
  if curl -fs "http://127.0.0.1:${PLAUSIBLE_PORT}/api/health" >/dev/null 2>&1; then
    echo "[plausible] healthcheck OK after ${i}s"
    break
  fi
  sleep 2
done

# ── 6. Inject Nginx proxy blocks ────────────────────────────────────────────
# We insert two `location` blocks into the HTTPS server{} of the existing
# offshore-dashboard site. Idempotent via the marker; re-runs won't duplicate.

if [ ! -f "$NGINX_SITE" ]; then
  echo "[plausible] nginx site not found at $NGINX_SITE; aborting" >&2
  exit 1
fi

if grep -qF "$MARKER" "$NGINX_SITE"; then
  echo "[plausible] nginx marker already present; skipping injection"
else
  # Keep backups OUT of sites-enabled — nginx loads any file in that dir
  # and would see the bak as a second server{} for the same names.
  BACKUP_PATH="/root/offshore-dashboard.nginx.bak.$(date +%s)"
  echo "[plausible] backing up $NGINX_SITE → $BACKUP_PATH"
  cp "$NGINX_SITE" "$BACKUP_PATH"

  # Insert before the FIRST `location / {` inside each server{} block. Using
  # sed to find the line and prepend our blocks. The site has two server{}
  # stanzas (port 80 + 443) — both should serve /ps/* so analytics works on
  # plain http too (Cloudflare may pass through during cert/SSL config).
  python3 - "$NGINX_SITE" "$MARKER" "$PLAUSIBLE_PORT" <<'PYEOF'
import sys, re
path, marker, port = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
block = f"""
    {marker}
    location = /ps/script.js {{
        proxy_pass http://127.0.0.1:{port}/js/script.js;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }}
    location = /ps/event {{
        proxy_pass http://127.0.0.1:{port}/api/event;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }}
"""
# Insert before each "location / {" line.
new = re.sub(r"(\n[ \t]*)location / \{", block + r"\1location / {", src)
if new == src:
    sys.stderr.write("could not find 'location / {' to anchor on\n")
    sys.exit(1)
open(path, "w").write(new)
PYEOF
  echo "[plausible] injected nginx proxy blocks"
fi

echo "[plausible] validating + reloading nginx"
nginx -t
systemctl reload nginx

# ── 7. Verification ─────────────────────────────────────────────────────────
echo
echo "─── Verify these URLs ───────────────────────────────────────────────"
echo "  curl -fs https://${DOMAIN_MAIN}/ps/script.js | head -c 80   (returns JS, ~7 KB)"
echo "  curl -i  https://${DOMAIN_MAIN}/ps/event                    (GET returns 400 — that's fine; tracker uses POST)"
echo "  curl -fs http://127.0.0.1:${PLAUSIBLE_PORT}/api/health      (returns 'ok')"
echo
echo "─── Reaching the admin UI ───────────────────────────────────────────"
echo "  From your laptop:"
echo "    ssh -L ${PLAUSIBLE_PORT}:localhost:${PLAUSIBLE_PORT} root@178.105.127.121"
echo "  Then open in a browser:"
echo "    http://localhost:${PLAUSIBLE_PORT}/register"
echo "  Create your admin user, then register a site for '${DOMAIN_MAIN}'."
echo
echo "─── The tracker is already wired in app/layout.jsx ──────────────────"
echo "  <script defer data-domain=\"${DOMAIN_MAIN}\" data-api=\"/ps/event\" src=\"/ps/script.js\" />"
echo
echo "─── Lock down registration after signup ─────────────────────────────"
echo "  In ${PLAUSIBLE_DIR}/hosting/.env set DISABLE_REGISTRATION=true, then:"
echo "    cd ${PLAUSIBLE_DIR}/hosting && docker compose restart plausible"
