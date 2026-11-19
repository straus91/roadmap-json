#!/usr/bin/env bash
# Install or update the ROADMAP card creator on a server whose front door is the Caddy
# container of the "casedeck" project (the pedsrad-web droplet).
#
# What it does, in order:
#   1. Downloads (or updates) the app's code into /opt/card-creator.
#   2. Creates its settings file (.env), asking once for the Gemini API key.
#   3. Builds and starts the app in its own container, on a private network of its own.
#      No port is opened on the server.
#   4. Adds the site to the front-door Caddy by placing two new files in the casedeck
#      folder. None of casedeck's own files are edited.
#   5. Restarts Caddy once (a few seconds), checks that the sites that worked before still
#      answer the same way, and UNDOES step 4 automatically if they do not.
#
# Safe to run again: it then just updates the app.
set -euo pipefail

HOST="${CARDS_HOST:-card-creator.pedsrad.org}"
APP_DIR="${APP_DIR:-/opt/card-creator}"
CASEDECK_DIR="${CASEDECK_DIR:-/home/deploy/casedeck}"
BRANCH="${BRANCH:-v2-rebuild}"
REPO="https://github.com/straus91/roadmap-json.git"
NETWORK="card-creator-front"

say()  { printf '\n==> %s\n' "$*"; }
fail() { printf '\nSTOPPED: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "run this as root (the web console already is)."
command -v docker >/dev/null || fail "Docker is not installed."
command -v git >/dev/null || fail "git is not installed."
[ -f "$CASEDECK_DIR/docker-compose.yml" ] || fail "casedeck was not found in $CASEDECK_DIR."
[ -f "$CASEDECK_DIR/caddy/Caddyfile" ] || fail "casedeck's Caddyfile was not found."
CADDY="$(cd "$CASEDECK_DIR" && docker compose ps -q caddy)"
[ -n "$CADDY" ] || fail "casedeck's Caddy container is not running; start casedeck first."

# ---------------------------------------------------------------- 1. the code
say "Getting the app's code into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
    git -C "$APP_DIR" checkout --quiet "$BRANCH"
    git -C "$APP_DIR" merge --quiet --ff-only "origin/$BRANCH"
else
    git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"
echo "    version: $(git log -1 --format='%h %s')"

# ---------------------------------------------------------------- 2. settings
if [ ! -f .env ]; then
    say "Creating the settings file"
    cp .env.example .env
    sed -i -E 's/^LLM_PROVIDER=.*/LLM_PROVIDER=gemini/; s/^LLM_MODEL=.*/LLM_MODEL=gemini-4-hydrogen/' .env
    printf '\n# This server: also apply deploy/docker-compose.droplet.yml (no open port, private network).\nCOMPOSE_FILE=docker-compose.yml:deploy/docker-compose.droplet.yml\n' >> .env
    chmod 600 .env
fi
grep -q '^COMPOSE_FILE=' .env || printf '\nCOMPOSE_FILE=docker-compose.yml:deploy/docker-compose.droplet.yml\n' >> .env
if ! grep -qE '^GEMINI_API_KEY=.+' .env && ! grep -qE '^ANTHROPIC_API_KEY=.+' .env; then
    echo
    echo "The app needs your Gemini API key (from Google AI Studio) to read papers."
    echo "Paste it and press Enter. It will not be shown on screen."
    read -rs -p "Gemini API key: " KEY </dev/tty; echo
    [ -n "$KEY" ] || fail "no key entered. Run the same command again when you have it."
    case "$KEY" in *[[:space:]\"\'\\]*) fail "that does not look like a key (it contains spaces or quotes).";; esac
    sed -i -E "s|^GEMINI_API_KEY=.*|GEMINI_API_KEY=${KEY}|" .env
    unset KEY
fi

# ---------------------------------------------------------------- 3. the app
say "Building and starting the app (the first time takes a few minutes)"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null
docker compose up -d --build --quiet-pull 2>&1 | tail -n 5
APP="$(docker compose ps -q app)"
for _ in $(seq 1 40); do
    STATE="$(docker inspect --format '{{.State.Health.Status}}' "$APP" 2>/dev/null || echo none)"
    [ "$STATE" = healthy ] && break
    sleep 3
done
[ "$STATE" = healthy ] || { docker compose logs --tail 30 app; fail "the app did not start correctly (see the lines above). Nothing was changed in casedeck."; }
echo "    the app is running"

# ---------------------------------------------------------------- 4. the front door
cd "$CASEDECK_DIR"
FRONT="caddy/Caddyfile.front"
OVERRIDE="docker-compose.override.yml"
if [ -f "$OVERRIDE" ] && ! grep -q 'roadmap-json' "$OVERRIDE"; then
    fail "casedeck already has its own $OVERRIDE. The app is running, but adding its address to Caddy needs to be done by hand; see $APP_DIR/deploy/README.md."
fi

# How every site this Caddy serves answers right now, to compare after the restart.
SITES="$(docker exec "$CADDY" sh -c 'printenv CASEDECK_HOST PEDSRAD_HOST PROGRAM_HOST 2>/dev/null' | grep -vE 'localhost$|^$' || true)"
probe() { curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$1/" 2>/dev/null || true; }
BEFORE=""; for site in $SITES; do BEFORE="$BEFORE $site=$(probe "$site")"; done
echo "    sites served now:$BEFORE"

NEW_FRONT="$(sed "s/__CARDS_HOST__/$HOST/" "$APP_DIR/deploy/casedeck/Caddyfile.front")"
if [ -f "$FRONT" ] && [ -f "$OVERRIDE" ] && [ "$(cat "$FRONT")" = "$NEW_FRONT" ] \
   && cmp -s "$OVERRIDE" "$APP_DIR/deploy/casedeck/docker-compose.override.yml" \
   && docker inspect "$CADDY" --format '{{json .NetworkSettings.Networks}}' | grep -q "$NETWORK"; then
    say "Caddy already serves $HOST; nothing to change there"
else
    say "Adding $HOST to the front-door Caddy (two new files; casedeck's own files are not edited)"
    OWNER="$(stat -c '%u:%g' caddy/Caddyfile)"
    printf '%s\n' "$NEW_FRONT" > "$FRONT"
    cp "$APP_DIR/deploy/casedeck/docker-compose.override.yml" "$OVERRIDE"
    chown "$OWNER" "$FRONT" "$OVERRIDE"

    undo() {
        echo
        echo "UNDOING the Caddy change: $1"
        rm -f "$FRONT" "$OVERRIDE"
        docker compose up -d --no-deps caddy 2>&1 | tail -n 2
        sleep 8
        AGAIN=""; for site in $SITES; do AGAIN="$AGAIN $site=$(probe "$site")"; done
        echo "    sites after undoing:$AGAIN"
        fail "the card creator was NOT added to Caddy; casedeck is back as it was. The app itself is still running, unreachable from outside. Send this whole output to whoever is helping you."
    }

    docker compose config --quiet || undo "Docker did not accept the settings"
    docker compose up -d --no-deps caddy 2>&1 | tail -n 2 || undo "Caddy could not be restarted"
    sleep 8
    CADDY="$(docker compose ps -q caddy)"
    [ "$(docker inspect --format '{{.State.Running}} {{.State.Restarting}}' "$CADDY" 2>/dev/null)" = "true false" ] \
        || { docker compose logs --tail 15 caddy; undo "Caddy did not stay up"; }
    AFTER=""; for site in $SITES; do AFTER="$AFTER $site=$(probe "$site")"; done
    [ "$AFTER" = "$BEFORE" ] || { sleep 10; AFTER=""; for site in $SITES; do AFTER="$AFTER $site=$(probe "$site")"; done; }
    echo "    sites served after:$AFTER"
    [ "$AFTER" = "$BEFORE" ] || undo "the existing sites answer differently than before"
fi

# ---------------------------------------------------------------- 5. check from outside
say "Checking https://$HOST (the first secure certificate can take a minute)"
CODE=000
for _ in $(seq 1 30); do
    CODE="$(curl -s -o /dev/null -m 15 -w '%{http_code}' "https://$HOST/api/health" 2>/dev/null || true)"
    [ "$CODE" = 200 ] && break
    sleep 5
done
if [ "$CODE" = 200 ]; then
    printf '\nDONE. The card creator is live at https://%s\n' "$HOST"
    echo "To update it later:  cd $APP_DIR && git pull && docker compose up -d --build"
else
    printf '\nThe app and Caddy are running, but https://%s answered "%s" instead of 200.\n' "$HOST" "$CODE"
    echo "Existing sites are unaffected. Often this is the certificate still being issued: try the"
    echo "address in a browser in a few minutes. If it still fails, send this output to whoever is helping you."
    docker compose logs --tail 12 caddy 2>&1 | grep -iE "card-creator|error|obtain" | tail -n 6 || true
fi
