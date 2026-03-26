# Production Docker Compose — Complete Configuration Reference

> **Stack:** NestJS API · PostgreSQL 18 · Redis 8 · nginx · Ubuntu 22.04 · 2GB RAM / 1 vCPU / 50GB SSD

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Startup Order & Dependency Chain](#startup-order--dependency-chain)
3. [Service: gateway (nginx)](#service-gateway-nginx)
4. [Service: db_migration (dbmate)](#service-db_migration-dbmate)
5. [Service: api (NestJS)](#service-api-nestjs)
6. [Service: db (PostgreSQL)](#service-db-postgresql)
7. [Service: cache (Redis)](#service-cache-redis)
8. [Secrets](#secrets)
9. [Volumes](#volumes)
10. [Memory Budget](#memory-budget)
11. [Scale Cheatsheet](#scale-cheatsheet)

---

## Architecture Overview

```
Internet
   │
   ▼
[nginx :80/:443]          ← SSL termination, reverse proxy
   │
   ▼
[NestJS API :8080]        ← Business logic, auth, request handling
   │         │
   ▼         ▼
[Postgres] [Redis]        ← Persistence / Cache
   ▲
   │
[dbmate]                  ← One-shot migration runner (exits after completion)
```

All services communicate over Docker's internal bridge network. **Nothing except nginx is exposed to the host machine.**

---

## Startup Order & Dependency Chain

Docker Compose resolves the `depends_on` graph and starts services in this order:

```
db ──────────────────────────────────────────────┐
                                                  ▼
cache ──────────────────────────────────────────► api ──► gateway
                                                  ▲
db ──► db_migration ─────────────────────────────┘
```

Each arrow is gated by a health check condition:

| Waits for                      | Condition                        |
| ------------------------------ | -------------------------------- |
| `api` waits for `db`           | `service_healthy`                |
| `api` waits for `cache`        | `service_healthy`                |
| `api` waits for `db_migration` | `service_completed_successfully` |
| `db_migration` waits for `db`  | `service_healthy`                |
| `gateway` waits for `api`      | `service_healthy`                |

This means **nginx will never start serving traffic until the API is healthy**, the API will never start until the DB is ready and all migrations have run, and migrations will never run against an unready database. The chain is airtight.

---

## Service: gateway (nginx)

```yaml
gateway:
  image: nginx:stable-alpine
  ports:
    - 80:80
    - 443:443
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf
    - /etc/letsencrypt:/etc/letsencrypt:ro
  restart: unless-stopped
```

### `image: nginx:stable-alpine`

Uses the `stable` channel rather than `latest` or `mainline`. nginx has two release tracks:

- **mainline** — latest features, potentially less stable
- **stable** — backports only, no new features, preferred for production

`alpine` base keeps the image ~25MB vs ~140MB for the Debian variant. Less attack surface, faster pulls.

### `ports: 80:80 and 443:443`

These are the **only** host-exposed ports in the entire compose file. All other services are on Docker's internal network only.

Port 80 is kept open to handle HTTP → HTTPS redirects and Let's Encrypt HTTP-01 ACME challenges (Certbot needs to respond on port 80 during certificate renewal).

### `volumes`

**`./nginx.conf`**: bind-mounted from the repo. nginx has no built-in way to read config from environment variables, so the config file must be provided directly. Changes to `nginx.conf` require `docker compose restart gateway` or a config reload by accessing container's shell and running (`nginx -s reload`).

**`/etc/letsencrypt:ro`**: the Let's Encrypt certificate directory from the host, mounted read-only. nginx needs to read the certificate and private key to terminate SSL. The `:ro` flag means nginx cannot accidentally modify or delete your certificates even if compromised.

### `restart: unless-stopped`

Tells Docker to restart the container automatically if it crashes or if the VPS reboots. Unless you explicitly ran `docker compose stop`. This is the correct policy for all long-lived production services. The alternative `always` would restart even after a deliberate stop, which is annoying during maintenance.

### Why no memory limit?

nginx is stateless, its memory footprint is flat and proportional to the number of active connections, not accumulated state. On this VPS it will consume ~20-30MB and never grow meaningfully. A Docker memory limit would add overhead with zero benefit.

---

## Service: db_migration (dbmate)

```yaml
db_migration:
  image: amacneil/dbmate
  entrypoint: >
    sh -c '
      export DATABASE_URL="postgres://postgres:$$(cat /run/secrets/db_password | tr -d "\n")@db:5432/prod?sslmode=disable";
      dbmate up
    '
  volumes:
    - ./migrations:/db/migrations
  secrets:
    - db_password
  restart: 'no'
  depends_on:
    db:
      condition: service_healthy
```

### Why dbmate?

dbmate is a language-agnostic migration tool. It reads plain `.sql` files, tracks applied migrations in a `schema_migrations` table, and is idempotent. Running `dbmate up` when all migrations are already applied is a no-op. This makes it safe to run on every deploy.

### The entrypoint pattern

The `$$` double-dollar-sign is a Docker Compose escape. In a compose file, `$VAR` is interpolated by Compose itself. `$$` tells Compose to pass a literal `$` through to the shell, so the shell (not docker compose) can evaluates `$(cat /run/secrets/db_password)`.

`tr -d "\n"` strips the trailing newline that `cat` adds when reading a file. Without this, the password would have a newline character appended, causing authentication failures.

### `restart: 'no'`

This container is intentionally a one-shot job. After `dbmate up` completes, it should exit and stay exited. Setting `restart: 'no'` prevents Docker from re-running migrations in a loop if the container exits with code 0 (success). The API's `depends_on` condition `service_completed_successfully` checks for a clean zero exit code.

### `volumes: ./migrations:/db/migrations`

dbmate expects migration files at `/db/migrations` by default. This bind-mount makes your repo's `migrations/` folder available inside the container without baking the SQL files into the image because migrations change frequently and you don't want to rebuild the dbmate image on every schema change.

---

## Service: api (NestJS)

```yaml
api:
  image: your-registry/your-api:${IMAGE_TAG:-latest}
  environment:
    - PORT=8080
    - NODE_OPTIONS=--max-old-space-size=400
    - DB_HOST=db
    ...
  healthcheck:
    test: ['CMD', 'wget', '-q', '-O', '-', 'http://localhost:8080/']
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 20s
  restart: unless-stopped
  deploy:
    resources:
      limits:
        memory: 512m
```

### `image: your-registry/your-api:${IMAGE_TAG:-latest}`

In production, the container runs a **pre-built image** from a registry, not a local build. This is fundamentally different from development:

- Dev: `build: .` — Docker builds from source on the VPS at runtime
- Prod: `image: registry/app:sha` — pre-built, tested, immutable artifact

`${IMAGE_TAG:-latest}` reads the `IMAGE_TAG` environment variable, falling back to `latest` if unset. In your GitHub Actions workflow this is set to `${{ github.sha }}` — the Git commit hash — so every deploy is pinned to an exact, traceable build.

### `NODE_OPTIONS=--max-old-space-size=400`

This is the critical Node.js memory configuration. Without it, V8 uses a heuristic based on available system RAM — on a 2GB machine it might set the heap ceiling at ~1.4GB, leaving almost nothing for Postgres, Redis, and the OS.

`--max-old-space-size=400` caps the V8 old generation heap at 400MB. When Node approaches this limit, it triggers garbage collection more aggressively. If GC cannot free enough memory, Node throws a JavaScript `heap out of memory` error — which is a clean, recoverable crash — rather than silently consuming RAM until the Linux OOM killer picks a random process to terminate.

`NODE_OPTIONS` is the standard environment variable that Node 20+ reads automatically on startup. No changes to `package.json`, Dockerfile, or start scripts are needed.

The relationship between this and the Docker memory limit:

```
400MB  ← NODE_OPTIONS: V8 heap ceiling, clean JS error thrown here
512MB  ← Docker limit: hard kernel kill if process exceeds this
 gap   ← headroom for native addons, Buffer allocations outside V8 heap,
         and internal Node.js overhead not counted against the V8 heap
```

### `DB_HOST=db` and `CACHE_HOST=cache`

Docker Compose creates a default bridge network and registers each service by its name as a DNS hostname. `db` resolves to the PostgreSQL container's IP, `cache` resolves to Redis. No hardcoded IPs needed.

### `DB_POOL_MIN_CONNECTIONS=2` / `DB_POOL_MAX_CONNECTIONS=20`

**Min connections (2):** The pool keeps 2 connections open even when idle. This avoids the latency of establishing a new TCP connection + TLS handshake + Postgres auth on the first request after a quiet period. 2 is enough for an MVP — no point warming more connections for zero traffic.

**Max connections (20):** This is the ceiling the pool will open under load. It must be significantly less than Postgres's `max_connections=50`, leaving headroom for:
- dbmate during migrations
- `psql` from an admin SSH session
- Future additional API replicas
- Postgres's own internal background workers

Setting `max_connections` equal between pool and Postgres would cause connection refused errors the moment a second process tried to connect.

### `CACHE_POOL_MIN_CONNECTIONS=1` / `CACHE_POOL_MAX_CONNECTIONS=20`

Redis is cheaper per connection than Postgres (no heavyweight auth protocol), so min=1 is sufficient. The max=20 is consistent with the DB pool — the API won't realistically need 20 simultaneous Redis commands for MVP traffic.

### `JWT_ISSUER=https://yourdomain.com`

Must be your actual production domain. JWTs embed the issuer claim and your API validates it on every authenticated request. A mismatch (e.g., still set to `http://localhost:8080`) will cause all JWT validation to fail in production.

### Healthcheck

```yaml
healthcheck:
  test: ['CMD', 'wget', '-q', '-O', '-', 'http://localhost:8080/']
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 20s
```

**`wget` vs `curl`:** Alpine-based images include `wget` but not `curl`. Using `curl` would require installing it in the Dockerfile — `wget` works out of the box.

**`localhost:8080` from inside the container:** The healthcheck runs inside the api container via `docker exec`. `localhost` here refers to the container's own loopback, not the host machine. The port does not need to be exposed to the host for this to work.

**`-q -O -`:** Silent mode (`-q`), output to stdout (`-O -`). We don't care about the response body — just the exit code. wget exits 0 on HTTP 2xx/3xx, non-zero on connection failure or 4xx/5xx.

**`interval: 30s`:** Docker checks health every 30 seconds. Lower values consume more CPU for the check itself and generate more log noise.

**`timeout: 10s`:** If the API doesn't respond within 10 seconds, the check is counted as failed. NestJS should respond to a simple GET in under 100ms normally — 10s is generous and accounts for temporary GC pauses.

**`retries: 3`:** Three consecutive failures before the container is marked `unhealthy`. Single transient failures (a GC pause, a brief DB query delay) won't trigger an unhealthy state.

**`start_period: 20s`:** During the first 20 seconds after container start, failed health checks do not count against the retry counter. NestJS takes time to compile decorators, establish DB connections, load modules — without `start_period`, Docker would mark a perfectly healthy container as unhealthy during normal cold-start and potentially restart it in a loop.

### `deploy.resources.limits.memory: 512m`

The only Docker memory limit in the entire compose file. Justified because Node.js is the only service without an internal memory governor:

- Postgres: governed by `max_connections` + `shared_buffers`
- Redis: governed by `--maxmemory 256mb`
- nginx: stateless, flat memory
- Node.js: **no internal cap** without `NODE_OPTIONS`

The Docker limit is the backstop. If a memory leak, runaway JSON serialization, or a large file buffer bypasses the V8 heap accounting, the kernel will kill the container cleanly at 512MB rather than letting it take down the entire VPS.

---

## Service: db (PostgreSQL)

```yaml
db:
  image: postgres:18-alpine
  command: >
    postgres
      -c max_connections=50
      -c shared_buffers=128MB
      -c effective_cache_size=512MB
      -c maintenance_work_mem=32MB
      -c work_mem=4MB
      -c wal_buffers=8MB
      -c checkpoint_completion_target=0.9
      -c random_page_cost=1.1
      -c effective_io_concurrency=200
      -c log_min_duration_statement=500
      -c log_connections=off
      -c log_disconnections=off
```

### Why tune Postgres at all?

Postgres ships with defaults designed to be safe on any hardware — including machines from 1999 with 64MB of RAM. On a modern VPS these defaults leave most of the available memory unused and lead to suboptimal query planning. Every flag below is a deliberate right-sizing for a 2GB / SSD environment.

### `max_connections=50`

Each Postgres connection consumes approximately 5–10MB of RAM for its backend process, stack, and working memory. At the default of 100 connections, Postgres alone could hold 500MB–1GB just in idle process overhead.

50 connections is sufficient for this stack:
- API pool max: 20
- dbmate migrations: 1–2
- Admin/monitoring: 2–3
- Background autovacuum workers: ~3
- Buffer: remaining

### `shared_buffers=128MB`

This is Postgres's in-memory page cache — the hot data it keeps in RAM to avoid disk reads. The standard recommendation is 25% of total RAM. On 2GB, that's 512MB — but this machine runs four other services, so 128MB is a conservative right-sizing that leaves headroom.

Postgres also benefits from the OS page cache (captured in `effective_cache_size`), so `shared_buffers` doesn't need to hold everything.

### `effective_cache_size=512MB`

This is **not** a memory allocation. It is a hint to the query planner about how much memory is available for caching across shared_buffers + OS page cache combined. The planner uses this to decide between index scans (good when data fits in cache) and sequential scans (better when it doesn't).

Setting it too low causes the planner to underestimate cache effectiveness and choose sequential scans unnecessarily. 512MB is a reasonable estimate for this VPS — the OS will cache frequently accessed pages, and this tells the planner to assume it can.

### `maintenance_work_mem=32MB`

Memory allocated per maintenance operation: `VACUUM`, `CREATE INDEX`, `ALTER TABLE ADD FOREIGN KEY`. These operations run infrequently and don't overlap with normal query traffic, so giving them a bit more RAM speeds them up without impacting regular queries. 32MB is appropriate for MVP table sizes.

### `work_mem=4MB`

Memory allocated **per sort or hash operation, per query**. This is the most misunderstood Postgres memory setting.

The danger: a single complex query can open multiple sort/hash nodes simultaneously, and each connection can run one query. At `max_connections=50` with a complex query using 5 sort nodes each, peak consumption is `50 × 5 × 4MB = 1GB` in a worst-case burst.

4MB is conservative and safe for this VPS. If you see `EXPLAIN ANALYZE` output showing sort operations spilling to disk, raise it — but only after profiling actual queries.

### `wal_buffers=8MB`

Memory for Write-Ahead Log buffers before they're flushed to disk. The default (`-1`, auto) is 3% of `shared_buffers` = ~3.8MB. Explicitly setting 8MB ensures enough buffer for write-heavy operations without over-allocating.

### `checkpoint_completion_target=0.9`

Postgres periodically flushes all dirty pages to disk (a checkpoint). By default it tries to complete this within 50% of the `checkpoint_timeout` interval, which causes I/O spikes. Setting `0.9` tells Postgres to spread checkpoint writes across 90% of the interval — smoothing out disk I/O and reducing latency variance for concurrent queries. Critical on SSDs where sustained write bursts degrade read performance.

### `random_page_cost=1.1`

The planner's assumed cost ratio between a random disk read and a sequential disk read. The default is `4.0`, which made sense for spinning HDDs where random seeks are expensive. On SSDs, random reads are nearly as fast as sequential reads. Setting `1.1` tells the planner this is an SSD, causing it to prefer index scans over sequential scans more aggressively — often the right choice for OLTP workloads.

### `effective_io_concurrency=200`

How many simultaneous I/O requests Postgres can issue for bitmap heap scans. On a modern NVMe SSD, high concurrency is cheap. Setting this to 200 (the recommended value for SSDs) allows Postgres to pre-fetch multiple data pages in parallel rather than waiting for each one sequentially.

### `log_min_duration_statement=500`

Logs any query that takes longer than 500ms. This is your early warning system for missing indexes, N+1 queries, or lock contention. Queries under 500ms are not logged, keeping log volume manageable during normal operation. Reduce to 100ms when actively debugging performance.

### `log_connections=off` / `log_disconnections=off`

With a connection pool doing `min_connections=2`, Postgres would log connection and disconnection events constantly — generating hundreds of useless log lines per day. Disabled.

### Why no Docker memory limit on Postgres?

Postgres is already constrained by `shared_buffers` and `max_connections`. Adding a Docker memory limit on top creates a risk: autovacuum and `ANALYZE` operations can temporarily spike Postgres memory usage beyond normal operating levels. If Docker kills Postgres mid-autovacuum, you risk table bloat and eventually degraded query performance. The application-level limits are sufficient and safer.

---

## Service: cache (Redis)

```yaml
cache:
  image: redis:8.4.0-alpine
  command: >
    sh -c 'redis-server
      --requirepass "$$(cat /run/secrets/cache_password | tr -d "\n")"
      --appendonly yes
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --save 900 1
      --save 300 10
      --hz 10
      --aof-rewrite-incremental-fsync yes'
```

### Why pass config via `command` instead of a config file?

The password must come from a Docker secret (a file at `/run/secrets/cache_password`), not a plain environment variable. Redis's config file format doesn't support shell command substitution. The `sh -c` wrapper lets the shell evaluate `$(cat /run/secrets/...)` before passing the assembled command to redis-server.

### `--requirepass`

Redis has no authentication by default — any process on the same network can read and write all keys. In Docker's bridge network this is already restricted to containers on the same compose network, but defense in depth matters. The password is read from the secret file at runtime, never embedded in the image or compose file.

### `--appendonly yes`

Enables Append-Only File (AOF) persistence. Redis offers two persistence modes:

- **RDB (snapshot):** Periodic full dumps. Fast recovery, but can lose up to minutes of data between snapshots.
- **AOF:** Logs every write operation. Slower to replay on restart, but loses at most 1 second of data (with `appendfsync everysec`, the default).

AOF is the right choice for a production cache that may hold session tokens, rate limit counters, or other state you'd rather not lose on a crash.

### `--maxmemory 256mb`

Redis's internal memory ceiling. When Redis reaches this limit, it does not crash or start refusing writes — instead it evicts keys according to `--maxmemory-policy`. This is the primary OOM protection for Redis. No Docker memory limit is needed on top of this.

256MB is generous for MVP usage. Redis stores data extremely efficiently — 256MB can hold millions of small keys.

### `--maxmemory-policy allkeys-lru`

When Redis is full and needs to evict keys to make room, this policy evicts the **Least Recently Used** key across **all keys** (not just those with a TTL set). This is the right policy for a general-purpose cache where the working set is smaller than available memory — the hottest data stays, the coldest gets evicted automatically.

Alternative policies:
- `noeviction` — returns errors when full. Never use this on a cache.
- `volatile-lru` — only evicts keys with TTL set. Dangerous if some keys have no TTL.
- `allkeys-lfu` — evicts Least Frequently Used. Better for stable hot-key workloads.

### `--save 900 1` and `--save 300 10`

RDB snapshot triggers (in addition to AOF):
- `900 1` — save if at least 1 key changed in the last 900 seconds (15 minutes)
- `300 10` — save if at least 10 keys changed in the last 300 seconds (5 minutes)

These create periodic RDB snapshots as a secondary backup to AOF. On recovery, Redis loads the latest RDB snapshot first (fast), then replays any AOF entries after it (catching up the remainder). This hybrid approach gives faster restarts than AOF-only with minimal data loss risk.

### `--hz 10`

Redis's internal task frequency — how many times per second it runs background jobs (expiring keys, closing idle connections, etc.). Default is 10. Raising it to 100 gives faster key expiry at the cost of more CPU. 10 is the right setting for MVP.

### `--aof-rewrite-incremental-fsync yes`

When Redis rewrites the AOF file (to compact it), it syncs to disk incrementally in 32MB chunks rather than one large `fsync` call at the end. This prevents a single large fsync from causing a latency spike for concurrent read/write operations. Important on any disk where fsync latency is variable.

### Why no Docker memory limit on Redis?

`--maxmemory 256mb` is Redis's internal cap. When Redis hits that limit, it evicts keys — it does not allocate more memory. The container's actual memory usage will plateau at ~280–300MB (256MB data + Redis process overhead). A Docker memory limit would need to be set above that threshold to avoid false kills, making it redundant. The internal limit is more precise and safer.

---

## Secrets

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.secret
  cache_password:
    file: ./secrets/cache_password.secret
  jwt_public:
    file: ./secrets/jwt_public.pem
  jwt_private:
    file: ./secrets/jwt_private.pem
```

### Why Docker secrets instead of environment variables?

Environment variables are visible in several places where they shouldn't be:
- `docker inspect <container>` — outputs all env vars in plaintext
- `/proc/<pid>/environ` — readable by any process with the right permissions
- Accidentally printed in crash logs or error messages

Docker secrets are mounted as files at `/run/secrets/<name>` inside the container. They exist only in a `tmpfs` (in-memory filesystem) — never written to the container's writable layer or image history. Services read them with `cat /run/secrets/db_password` and discard the value, keeping it out of the process environment.

### `./secrets/` directory

The `secrets/` directory lives on the VPS at `/opt/app/secrets/` and is:
- Created by the GitHub Actions deploy workflow, never committed to git
- Written from GitHub Actions secrets during each deploy
- Permissions locked to `600` (owner read/write only)

The directory is in `.gitignore`. It never touches version control.

---

## Volumes

```yaml
volumes:
  db_data:
    driver: local
  cache_data:
    driver: local
```

### Named volumes vs bind mounts

Named volumes (`db_data`, `cache_data`) are managed by Docker and stored at `/var/lib/docker/volumes/`. Bind mounts (e.g., `./data:/var/lib/postgresql/data`) link to a specific host path.

Named volumes are preferred for databases because:
- Docker manages permissions automatically (Postgres runs as `postgres` user inside the container)
- Data survives `docker compose down` — only destroyed with `docker compose down -v`
- No risk of host filesystem permission mismatches

### Persistence across deploys

`docker compose up -d` never destroys named volumes. `docker compose down` never destroys named volumes. Only `docker compose down -v` or `docker volume rm` removes them. Your database data is safe across all normal deploy operations.

---

## Memory Budget

Total system RAM: ~1.85GB usable (2GB minus OS overhead)

| Service              | Idle       | Under load                                |
| -------------------- | ---------- | ----------------------------------------- |
| OS + kernel          | ~200MB     | ~300MB                                    |
| Docker daemon        | ~80MB      | ~100MB                                    |
| nginx                | ~25MB      | ~40MB                                     |
| NestJS API           | ~150MB     | up to 512MB (hard limit)                  |
| PostgreSQL           | ~150MB     | ~400MB                                    |
| Redis                | ~50MB      | up to ~300MB (maxmemory 256mb + overhead) |
| **Total worst case** | **~655MB** | **~1.65GB**                               |

Worst-case headroom: ~200MB — sufficient buffer for `docker pull` during deploys (which temporarily runs two versions of the API container) and OS page cache growth.

---

## Scale Cheatsheet

When you outgrow the MVP configuration, here's what to change and in what order:

### First bottleneck: CPU (most likely on this VPS)

Upgrade to 2 vCPU. No config changes needed — all services will automatically use the additional core.

### Second bottleneck: API memory

```yaml
# Raise together:
NODE_OPTIONS=--max-old-space-size=768   # or 900 on 4GB box
memory: 1g                              # Docker limit
```

### Third bottleneck: Database connections

```yaml
# Raise together (must stay in sync):
DB_POOL_MAX_CONNECTIONS=40              # API env var
-c max_connections=100                  # Postgres command flag
```

### Moving to a 4GB box

```yaml
# Postgres
-c shared_buffers=256MB
-c effective_cache_size=1GB
-c work_mem=8MB

# Redis
--maxmemory 512mb

# API
NODE_OPTIONS=--max-old-space-size=900
memory: 1g
```

### Adding PgBouncer (high connection volume)

Insert PgBouncer between the API and Postgres in transaction pooling mode. This allows hundreds of application-level pool connections to multiplex over a small number of actual Postgres connections, bypassing the `max_connections` ceiling without upgrading hardware.