#!/usr/bin/env bash
# Plausible CE on Hetzner — adblock-evading setup script.
#
# Runs on the Hetzner VPS as root. Idempotent where possible — re-running
# won't clobber an existing install, but the secrets only generate once.
#
# Architecture after this runs:
#
#   Browser  ──HTTPS──▶  Caddy  ──┬──▶  Next.js (offshore-dashboard) :3000
#                                 ├──▶  Plausible :8000  (admin UI on stats.offshoredashboard.xyz)
#                                 └──▶  proxied analytics paths on the main domain:
#                                         offshoredashboard.xyz/js/pa.js  →  Plausible /js/script.js
#                                         offshoredashboard.xyz/api/e     →  Plausible /api/event
#
# The proxied paths are what defeats adblockers — they target known
# Plausible URLs, not our renamed paths on the main domain.
#
# Pre-flight requirements (do these BEFORE running this script):
#   1. DNS A records (at your registrar):
#         offshoredashboard.xyz         → <vps-ip>
#         www.offshoredashboard.xyz     → <vps-ip>
#         stats.offshoredashboard.xyz   → <vps-ip>
#   2. Ports 80 and 443 open in Hetzner firewall (cloud firewall, NOT just ufw).
#   3. SSH access as root.

set -euo pipefail

# ── Tunables ────────────────────────────────────────────────────────────────
DOMAIN_MAIN="offshoredashboard.xyz"
DOMAIN_STATS="stats.offshoredashboard.xyz"
NEXTJS_UPSTREAM="127.0.0.1:3000"      # where pm2's offshore-dashboard listens
PLAUSIBLE_PORT=8000                   # internal-only, behind Caddy
PLAUSIBLE_DIR="/opt/plausible"

# ── 1. Install Docker if missing ────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "[plausible] installing docker"
  apt update
  apt install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/debian $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
  apt update
  apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# ── 2. Install Caddy if missing ─────────────────────────────────────────────
if ! command -v caddy >/dev/null 2>&1; then
  echo "[plausible] installing caddy"
  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt update
  apt install -y caddy
fi

# ── 3. Clone Plausible CE ───────────────────────────────────────────────────
mkdir -p "$PLAUSIBLE_DIR"
cd "$PLAUSIBLE_DIR"
if [ ! -d hosting ]; then
  echo "[plausible] cloning plausible/community-edition"
  git clone --depth 1 https://github.com/plausible/community-edition hosting
fi
cd hosting

# ── 4. Generate secrets (once; ignored on re-run) ──────────────────────────
if [ ! -f .env ]; then
  echo "[plausible] generating .env"
  SECRET_KEY_BASE=$(openssl rand -base64 48 | tr -d '\n')
  TOTP_VAULT_KEY=$(openssl rand -base64 32 | tr -d '\n')
  cat > .env <<EOF
# ── Plausible CE configuration ──────────────────────────────────────────────
BASE_URL=https://${DOMAIN_STATS}
SECRET_KEY_BASE=${SECRET_KEY_BASE}
TOTP_VAULT_KEY=${TOTP_VAULT_KEY}

# Disable user registration after you've created your admin account.
DISABLE_REGISTRATION=invite_only

# SMTP — fill in after you sign up with a transactional email provider.
# Plausible needs this only for password resets / shared-link emails.
MAILER_EMAIL=admin@${DOMAIN_MAIN}
SMTP_HOST_ADDR=smtp.example.com
SMTP_HOST_PORT=587
SMTP_USER_NAME=
SMTP_USER_PWD=
SMTP_HOST_SSL_ENABLED=true

# Bind the Plausible HTTP port to localhost only — Caddy fronts it.
HTTP_PORT=${PLAUSIBLE_PORT}
LISTEN_IP=127.0.0.1
EOF
  chmod 600 .env
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

# ── 6. Caddy reverse proxy ──────────────────────────────────────────────────
# Two virtual hosts:
#   1) stats.offshoredashboard.xyz — Plausible admin UI + raw API.
#   2) offshoredashboard.xyz       — Next.js, plus the renamed analytics
#      paths that the browser-side snippet calls.
#
# The renamed paths defeat adblockers: /js/pa.js and /api/e aren't on any
# filter list. handle_path strips the matched prefix before forwarding so
# Plausible receives the request at its native path.

CADDYFILE=/etc/caddy/Caddyfile
if ! grep -q "${DOMAIN_STATS}" "$CADDYFILE" 2>/dev/null; then
  cat >> "$CADDYFILE" <<EOF

# ── Plausible admin (stats.${DOMAIN_MAIN}) ────────────────────────────────
${DOMAIN_STATS} {
  reverse_proxy 127.0.0.1:${PLAUSIBLE_PORT}
}

# ── Next.js + adblock-proxied analytics (${DOMAIN_MAIN}) ──────────────────
${DOMAIN_MAIN}, www.${DOMAIN_MAIN} {
  # Adblock-evading proxy paths. Browser calls these on the main domain.
  handle /js/pa.js {
    reverse_proxy 127.0.0.1:${PLAUSIBLE_PORT} {
      header_up Host ${DOMAIN_STATS}
      rewrite /js/script.js
    }
  }
  handle /api/e {
    reverse_proxy 127.0.0.1:${PLAUSIBLE_PORT} {
      header_up Host ${DOMAIN_STATS}
      rewrite /api/event
    }
  }

  # Everything else goes to Next.js.
  handle {
    reverse_proxy ${NEXTJS_UPSTREAM}
  }
}
EOF
fi

echo "[plausible] reloading caddy"
caddy validate --config "$CADDYFILE"
systemctl reload caddy

# ── 7. Verification ─────────────────────────────────────────────────────────
echo
echo "─── Verify these URLs ───────────────────────────────────────────────"
echo "  https://${DOMAIN_STATS}/             (Plausible admin login)"
echo "  https://${DOMAIN_MAIN}/js/pa.js      (returns JS, ~7 KB)"
echo "  https://${DOMAIN_MAIN}/api/e         (POST endpoint — GET returns 400, that's fine)"
echo
echo "─── Next steps ──────────────────────────────────────────────────────"
echo "  1. Open https://${DOMAIN_STATS}/register and create your admin user."
echo "  2. After login, register a site for domain '${DOMAIN_MAIN}'."
echo "  3. Add this snippet to app/layout.jsx <head>:"
echo
echo "       <script"
echo "         defer"
echo "         data-domain=\"${DOMAIN_MAIN}\""
echo "         data-api=\"/api/e\""
echo "         src=\"/js/pa.js\"></script>"
echo
echo "  4. (Optional) Set DISABLE_REGISTRATION=true in .env once your admin"
echo "     account exists, then 'docker compose restart plausible'."
echo "  5. (Optional) Daily backup of /var/lib/docker/volumes/plausible-* to"
echo "     an off-VPS location."
