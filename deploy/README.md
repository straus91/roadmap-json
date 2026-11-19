# Running the card creator on the droplet

The droplet's front door is the Caddy container of the casedeck project: it owns ports 80
and 443 and serves every site on the server. The card creator runs beside it as one container
with no open port, on a private network that only it and that Caddy join.

## Install or update

In the droplet's console (as root):

```bash
curl -fsSL https://raw.githubusercontent.com/straus91/roadmap-json/v2-rebuild/deploy/install-droplet.sh -o /root/install-card-creator.sh && bash /root/install-card-creator.sh
```

The first run asks once for the Gemini API key and takes a few minutes. Running it again
updates the app. A plain update is also:

```bash
cd /opt/card-creator && git pull && docker compose up -d --build
```

## What is where

| On the server | What it is |
|---|---|
| `/opt/card-creator` | This repository. `.env` there holds the settings and the API key (readable by root only). |
| Docker volume `card-creator_roadmap-data` or similar | The month's spending ledger and the latest ATLAS schema copy. |
| Docker network `card-creator-front` | The private network shared by the app and Caddy. |
| `<casedeck>/caddy/Caddyfile.front` | Imports casedeck's own Caddyfile unchanged and adds the card creator's site. |
| `<casedeck>/docker-compose.override.yml` | Makes casedeck's Caddy load that front file and join the private network. |

The last two files are not part of casedeck's repository and none of casedeck's own files are
edited, so `git pull && docker compose up -d --build` in casedeck keeps working and keeps the
card creator's site. The tidy long-term home for those few lines is casedeck's own
configuration, next to its other sites.

## Remove it

```bash
cd <casedeck> && rm caddy/Caddyfile.front docker-compose.override.yml && docker compose up -d --no-deps caddy
cd /opt/card-creator && docker compose down
```

## Settings

Everything is in `/opt/card-creator/.env` (see `.env.example` for what each line means).
After changing it: `cd /opt/card-creator && docker compose up -d`.
