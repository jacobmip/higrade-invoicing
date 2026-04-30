# Local Mirror — Mac Mini Setup

A local Postgres mirror of your Supabase database, running on your Mac mini.
It's a **read replica for safety** — you can query it, dump it, and use it
as a sandbox without touching production. It's also dress rehearsal for an
eventual VPS/NAS migration.

## How it works

We use Supabase's built-in Postgres connection string to take an exact
`pg_dump` of your live database, then restore that dump into a local
Postgres running in Docker. No manual schema reconstruction — Postgres
copies its own schema 1:1.

After the initial seed, a small Python script keeps the local copy in
sync nightly by re-running the same dump.

## Tonight's setup (~20 minutes)

### 1. Install Docker Desktop

If you don't already have it: download from
[docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/).
Open it once so it's running.

### 2. Pull the latest repo

```bash
cd ~                          # or wherever you keep code
git clone https://github.com/jacobmip/higrade-invoicing.git
# or, if you already have it cloned:
cd higrade-invoicing && git pull
```

### 3. Get your Supabase database connection string

On your phone or Mac, open
[Project Settings → Database](https://supabase.com/dashboard/project/cwhgcxxszyvevjpbnnkc/settings/database)
and find the **"Connection string"** section. Pick the **"Session pooler"**
option (recommended for one-off jobs). It looks like:

```
postgres://postgres.cwhgcxxszyvevjpbnnkc:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres
```

Replace `[YOUR-PASSWORD]` with your DB password (set when you created the
project; if you don't remember, click **"Reset database password"** on that
same page — note this also invalidates any existing direct connections,
but the app uses the REST API and is unaffected).

Save the full connection string somewhere — you'll paste it in step 5.

### 4. Start the local Postgres

```bash
cd ~/higrade-invoicing/local-mirror
docker compose up -d
```

You now have:
- Local Postgres on `localhost:5432` (user `higrade`, password `localdev`, db `higrade`)
- pgAdmin web UI on [http://localhost:5433](http://localhost:5433)
  (login `jacobmip@gmail.com` / `localdev`)

### 5. Seed the local DB from Supabase

```bash
# Set the source connection string for this shell session
export SUPABASE_DB_URL='postgres://postgres.cwhgcxxszyvevjpbnnkc:YOUR-PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres'

# Run the seed script
./seed_from_supabase.sh
```

This:
1. `pg_dump`s the entire `public` schema from Supabase
2. Drops and recreates the local `public` schema
3. Restores the dump into the local DB

You'll see something like `clients: 16 rows, invoices: 138 rows, ...`.

### 6. (Optional) Set up nightly auto-sync at 4:30am

Save the connection string permanently:

```bash
echo 'export SUPABASE_DB_URL="postgres://postgres.cwhgcxxszyvevjpbnnkc:YOUR-PASSWORD@aws-0-us-west-1.pooler.supabase.com:5432/postgres"' >> ~/.zshrc
```

Then install the launch agent (replace REPLACE_ME with your username):

```bash
sed -i '' "s|REPLACE_ME|$(whoami)|g" com.higrade.mirror.plist
cp com.higrade.mirror.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.higrade.mirror.plist
```

Logs land in `sync.log` next to the script.

To turn it off later:
```bash
launchctl unload ~/Library/LaunchAgents/com.higrade.mirror.plist
```

## Daily use

- **Browse data**: open [pgAdmin](http://localhost:5433), connect to host
  `postgres` (Docker network), port `5432`, db `higrade`
- **Query from the terminal**: `psql postgresql://higrade:localdev@localhost:5432/higrade`
- **Dump for offsite backup**: `pg_dump postgresql://higrade:localdev@localhost:5432/higrade > backup-$(date +%Y%m%d).sql`
- **Manual refresh from Supabase**: `./seed_from_supabase.sh`

## When you're ready for a real VPS / NAS migration

The exact same `docker-compose.yml` runs on any Linux box with Docker
(Synology, Unraid, a $5 VPS, etc.). The migration becomes:

1. Run this stack on the new host
2. `pg_dump` from the local mirror, `psql` into the new host
3. Add [PostgREST](https://docs.postgrest.org/) as a third Docker container
   so the React app can talk to it
4. Update Vercel env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
   to point at the new host
5. Cancel Supabase

Total real work: another evening. The local mirror you set up tonight is
80% of that work already done.

## Troubleshooting

- **"docker: command not found"** — Docker Desktop isn't running. Open it.
- **`pg_dump: command not found`** — Postgres client tools aren't installed.
  Install with `brew install libpq && brew link --force libpq`.
- **Schema looks out of date** — re-run `./seed_from_supabase.sh`. It always
  drops and recreates the local schema, so it stays in sync.
- **Connection refused on local port 5432** — `docker compose ps` to confirm
  Postgres is running. If a stale process is on 5432, edit
  `docker-compose.yml` to map a different host port (e.g. `5434:5432`).
