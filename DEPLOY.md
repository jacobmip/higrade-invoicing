# DEPLOY.md — Production deploy pipeline

## TL;DR

Production app at **https://app.higradeplumbing.com** is served from a Docker container on a Hostinger VPS. Auto-deploy is driven by a **systemd timer on the VPS** that polls the `vps-deploy` branch of this repo every 60 seconds.

Main (Vercel) preview deployments at `higrade-invoicing.vercel.app` are unrelated to this pipeline.

## Topology

```
  git push origin vps-deploy
           |
           v
  GitHub (public repo)
           |
           |  (polled every 60s via HTTPS)
           v
  VPS: higrade-deploy.timer  ->  higrade-deploy.service
           |
           v
  /home/deploy/app/auto_deploy.sh
           |
           v   (only if HEAD changed)
  /home/deploy/app/deploy.sh
           |
           v
  docker compose up -d --build  (recreates `higrade-web`)
           |
           v
  https://app.higradeplumbing.com  (nginx -> 127.0.0.1:8080)
```

## VPS

- Host: `srv1672733` (Hostinger), public IP `45.132.240.178`
- Deploy user: `deploy` (passwordless sudo, docker group)
- App dir: `/home/deploy/app` (git working tree, `origin` = `https://github.com/jacobmip/higrade-invoicing.git`)
- Container: `higrade-web`, binds `127.0.0.1:8080 -> 80/tcp`
- Web terminal: https://phx.hostingervps.com/1233/

## systemd units

### `/etc/systemd/system/higrade-deploy.service`
```ini
[Unit]
Description=HI Grade auto-deploy from vps-deploy branch
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
User=deploy
Group=deploy
WorkingDirectory=/home/deploy/app
Environment=BRANCH=vps-deploy
ExecStart=/home/deploy/app/auto_deploy.sh
StandardOutput=journal
StandardError=journal
```

### `/etc/systemd/system/higrade-deploy.timer`
```ini
[Unit]
Description=Run higrade-deploy every 60s

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Unit=higrade-deploy.service

[Install]
WantedBy=timers.target
```

## Scripts

### `/home/deploy/app/auto_deploy.sh` (polling wrapper)
No-op if `origin/vps-deploy` HEAD hasn't moved since the last successful deploy. Tracks last SHA in `/home/deploy/.higrade-last-sha`. Uses `flock` to prevent overlap.

### `/home/deploy/app/deploy.sh` (the actual deploy)
```bash
#!/bin/bash
set -e
cd /home/deploy/app
git fetch --all
git reset --hard origin/${BRANCH:-main}
docker compose --env-file .env up -d --build
docker image prune -f
```

## Common operations

### Watch live deploy logs
```bash
sudo journalctl -u higrade-deploy.service -f
```

### Force an immediate deploy (don't wait for timer)
```bash
sudo systemctl start higrade-deploy.service
```

### Confirm the timer is running
```bash
systemctl status higrade-deploy.timer
systemctl list-timers higrade-deploy.timer
```

### Disable auto-deploy temporarily (e.g. before manual surgery)
```bash
sudo systemctl stop higrade-deploy.timer
# ... do your thing ...
sudo systemctl start higrade-deploy.timer
```

### Permanently disable
```bash
sudo systemctl disable --now higrade-deploy.timer
```

### Roll back to a prior commit
```bash
sudo systemctl stop higrade-deploy.timer
cd /home/deploy/app
sudo -u deploy git reset --hard <good-sha>
BRANCH=vps-deploy sudo -u deploy bash deploy.sh
# Optionally reset the state file so the timer doesn't immediately overwrite you:
sudo -u deploy bash -c 'echo <good-sha> > /home/deploy/.higrade-last-sha'
sudo systemctl start higrade-deploy.timer
```

### Health checks
```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://app.higradeplumbing.com/
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
git -C /home/deploy/app log --oneline -3
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Push lands on `vps-deploy` but site doesn't update within ~90s | Timer stopped, or `auto_deploy.sh` failed | `systemctl status higrade-deploy.timer`, then `journalctl -u higrade-deploy.service -n 100` |
| `journalctl` shows `another run in progress, skip` repeatedly | Stale lockfile from a crashed run | `sudo rm /tmp/higrade-auto-deploy.lock` |
| `docker compose up` fails with build errors | Broken code on `vps-deploy` HEAD | Roll back (see above), fix on a feature branch, merge when green |
| Site returns 502 / connection refused | `higrade-web` container crashed | `sudo docker logs higrade-web --tail=100`; `sudo docker compose -f /home/deploy/app/docker-compose.yml up -d` |
| Container is up but serving stale build | Browser cache, or build skipped due to image cache | Hard refresh (Cmd+Shift+R); to force a clean rebuild: `sudo docker compose -f /home/deploy/app/docker-compose.yml build --no-cache && sudo docker compose ... up -d` |

## Why this exists (history)

The original auto-deploy was a GitHub Actions workflow (`.github/workflows/deploy-vps.yml`) that SSH'd into the VPS. It failed continuously with `Permission denied (publickey)` because the `VPS_SSH_KEY` GitHub secret didn't match any key in the VPS's `authorized_keys`. Rather than re-establish the SSH trust, the pipeline was moved to a **pull-based** model on the VPS so:

- No GitHub Actions secrets to rotate or leak
- No SSH surface exposed to GitHub's IP ranges
- Logs live next to the container (`journalctl`) instead of in a separate UI
- VPS is the single source of truth for what version is live

Tradeoff: deploys lag up to ~60s after `git push`. For this app that's fine.

## Database

Supabase project `cwhgcxxszyvevjpbnnkc` (`HI Grade Plumbing` org). Migrations live in `supabase/migrations/`. The VPS does **not** auto-apply migrations — apply them manually via the Supabase SQL editor or `supabase db push` from your laptop.

## Vercel (separate, not part of this pipeline)

Every push to **any** branch also triggers a Vercel build. `main` is the Production deployment on Vercel. `vps-deploy` (and other branches) get Preview deployments. The Vercel site `higrade-invoicing.vercel.app` is independent of the VPS site and serves as a build-validity check — if a `vps-deploy` commit fails on Vercel, it will almost certainly fail in the VPS Docker build too.
