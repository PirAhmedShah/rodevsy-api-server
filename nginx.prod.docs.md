# Production nginx Configuration - Complete Reference

> **Stack:** nginx stable-alpine · NestJS API upstream · Let's Encrypt SSL · Ubuntu 22.04 · 1 vCPU / 2GB RAM

---

## Table of Contents

1. [Architecture Role](#architecture-role)
2. [worker_processes & events](#worker_processes--events)
3. [Upstream Block](#upstream-block)
4. [HTTP Core](#http-core)
5. [Timeouts](#timeouts)
6. [Body Limits](#body-limits)
7. [Gzip Compression](#gzip-compression)
8. [Rate Limiting](#rate-limiting)
9. [Connection Limiting](#connection-limiting)
10. [SSL Session Cache](#ssl-session-cache)
11. [Server: HTTP (Port 80)](#server-http-port-80)
12. [Server: HTTPS (Port 443)](#server-https-port-443)
13. [TLS Configuration](#tls-configuration)
14. [Security Headers](#security-headers)
15. [Location: /gateway](#location-gateway)
16. [Location: / (API Proxy)](#location--api-proxy)
17. [CORS](#cors)
18. [Proxy Settings](#proxy-settings)
19. [Proxy Timeouts](#proxy-timeouts)
20. [Attack Surface & Threat Model](#attack-surface--threat-model)
21. [Tuning Cheatsheet](#tuning-cheatsheet)

---

## Architecture Role

nginx sits at the edge of the entire stack. It is the **only** service with ports exposed to the internet. Everything behind it - the NestJS API, Postgres, Redis - is on Docker's internal bridge network, unreachable from outside.

```
Internet
    │
    ▼
nginx :80 ──► 301 redirect to HTTPS
nginx :443 ──► TLS termination
    │           Rate limiting
    │           Connection limiting
    │           CORS headers
    │           Security headers
    ▼
NestJS API :8080 (internal only)
```

nginx does not serve static files in this stack. Its sole job is to be a hardened, rate-limited, SSL-terminating reverse proxy. Every config decision below serves that purpose.

---

## worker_processes & events

```nginx
worker_processes auto;

events {
    worker_connections 1024;
    multi_accept on;
}
```

### `worker_processes auto`

nginx spawns one worker process per CPU core by default with `auto`. On a 1 vCPU VPS this means exactly **one worker process**. There is no benefit to setting this higher than the CPU core count - extra workers would compete for the same core, adding context-switching overhead with no throughput gain.

If you upgrade to 2 vCPU, `auto` automatically uses both cores without any config change.

### `worker_connections 1024`

Maximum simultaneous connections **per worker process**. With one worker, this is the total connection ceiling for the entire nginx instance. Each connection consumes a file descriptor and approximately 1–4KB of memory in nginx's event loop.

1024 connections on a 1 vCPU machine is already generous - the CPU will saturate from SSL handshakes and proxy work long before 1024 simultaneous connections are reached in practice. Raising this to 10000 would only matter if nginx were serving static files at scale, which it isn't here.

The OS file descriptor limit (`ulimit -n`) must be at least `worker_processes × worker_connections`. The nginx:alpine image sets this correctly by default.

### `multi_accept on`

By default, each worker accepts one new connection per event loop iteration, even if multiple connections are queued. `multi_accept on` tells the worker to accept all pending connections in a single pass.

On a single-CPU machine under bursty traffic (e.g. a mobile client opening 6 parallel API requests on page load), this reduces the time those connections spend waiting in the accept queue. The difference is small but costs nothing to enable.

---

## Upstream Block

```nginx
upstream nest_api {
    server api:8080;
    keepalive 32;
}
```

### `server api:8080`

`api` resolves to the NestJS container's IP via Docker's internal DNS. Docker registers each service name as a hostname on the shared bridge network. No hardcoded IPs, no service discovery needed.

### `keepalive 32`

Without keepalive, nginx opens a new TCP connection to the upstream for every proxied request, then closes it. With `keepalive 32`, nginx maintains a pool of up to 32 idle persistent connections to the upstream and reuses them.

This matters because TCP connection establishment has real cost:
- TCP 3-way handshake: ~1 RTT
- On loopback (Docker bridge): microseconds, but still non-zero overhead per request
- At 100 req/s, that's 100 unnecessary connection setups per second

`keepalive 32` means the 33rd concurrent connection still opens a new TCP connection, but the first 32 concurrent requests reuse pooled connections. For an MVP this is more than sufficient.

**Critical companion setting:** `proxy_http_version 1.1` and `proxy_set_header Connection ""` in the location block are **required** for keepalive to work. HTTP/1.0 has no persistent connections. HTTP/1.1 has them but the `Connection: close` header disables them - clearing the Connection header lets the keepalive pool function correctly.

---

## HTTP Core

```nginx
server_tokens off;
include mime.types;
default_type application/octet-stream;
sendfile on;
tcp_nopush on;
tcp_nodelay on;
```

### `server_tokens off`

By default nginx adds a `Server: nginx/1.27.3` header to every response, advertising the exact version number. This makes it trivial for automated scanners to target known CVEs for that version. `server_tokens off` reduces the header to `Server: nginx`, giving nothing away.

This is security through obscurity - not a primary defense - but it's a free, zero-cost improvement that eliminates a class of automated opportunistic attacks.

### `include mime.types`

Maps file extensions to Content-Type headers. Without this, nginx would serve every file as `application/octet-stream`, causing browsers to download rather than render responses. For a JSON API this is less critical, but it's required for the ACME challenge files served on port 80 during certificate renewal, which nginx serves as static files from `/var/www/certbot`.

### `default_type application/octet-stream`

Fallback Content-Type for files not in mime.types. For an API proxy this is rarely triggered, but it's the correct safe default - force download rather than attempt rendering of unknown content.

### `sendfile on`

Enables the Linux `sendfile()` syscall for serving static files, which transfers file data directly from the kernel's file cache to the socket buffer without copying it to userspace first. This reduces CPU overhead and memory copies for static file serving.

For this stack it only affects the ACME challenge files on port 80, but it's a best-practice baseline setting with no downside.

### `tcp_nopush on`

Works together with `sendfile`. Tells the kernel to buffer outgoing data and send it in full packets rather than immediately, reducing the number of small TCP packets. Improves throughput for responses with HTTP headers + body by combining them into fewer packets.

### `tcp_nodelay on`

Disables Nagle's algorithm, which buffers small outgoing packets. For an API proxy, this is the right setting - you want low latency on small JSON responses, not packet coalescing. `tcp_nopush` and `tcp_nodelay` are complementary: `tcp_nopush` optimizes the initial send, then `tcp_nodelay` takes over for subsequent data.

---

## Timeouts

```nginx
keepalive_timeout 65;
client_header_timeout 10s;
client_body_timeout 10s;
send_timeout 10s;
reset_timedout_connection on;
```

### `keepalive_timeout 65`

How long nginx keeps an idle HTTP keepalive connection open waiting for the next request from the same client. 65 seconds is the nginx default and a reasonable value - long enough for a browser to reuse the connection for follow-up API calls, short enough not to exhaust worker connection slots with idle browsers.

### `client_header_timeout 10s`

How long nginx waits to receive the complete HTTP request headers from the client. If a client connects and sends headers slowly (or not at all), nginx waits 10 seconds then closes the connection with 408 Request Timeout.

This is a defense against **Slowloris attacks** - a class of DoS where an attacker opens many connections and sends headers one byte per second, eventually exhausting nginx's connection pool without triggering rate limiting (because they technically never complete a request).

### `client_body_timeout 10s`

Same as above but for the request body. Applies to POST/PUT requests. If the client stops sending body data mid-request for more than 10 seconds, nginx closes the connection. Another Slowloris variant mitigation.

### `send_timeout 10s`

How long nginx waits between successive write operations to the client. If the client stops receiving data (e.g. a mobile device goes offline mid-response), nginx waits 10 seconds then closes the connection, freeing the worker connection slot.

### `reset_timedout_connection on`

When nginx closes a timed-out connection, it sends a TCP RST packet instead of a graceful FIN. This immediately frees the port and associated kernel resources rather than leaving the socket in TIME_WAIT state. On a high-connection server, TIME_WAIT sockets can pile up and exhaust the ephemeral port range. On an MVP this is unlikely but costs nothing to enable.

---

## Body Limits

```nginx
client_max_body_size 64k;
client_body_buffer_size 16k;
```

### `client_max_body_size 64k`

Maximum allowed size of the HTTP request body. Requests exceeding this get a 413 Request Entity Too Large response before nginx even forwards them to NestJS.

64KB is appropriate for a JSON API. A typical REST request body is 1–10KB. 64KB allows for larger bulk operations while blocking:
- Accidental huge file uploads to an endpoint not designed for them
- Intentional oversized-body attacks attempting to exhaust API memory
- Misconfigured clients sending megabyte payloads

If you add file upload endpoints later, override this limit in a specific location block for those endpoints rather than raising the global limit.

### `client_body_buffer_size 16k`

When nginx receives a request body, it first buffers it in memory. If the body exceeds `client_body_buffer_size`, nginx writes the overflow to a temporary file on disk before forwarding to upstream.

Setting this to 16k means bodies up to 16KB are handled entirely in memory with no disk I/O. Since `client_max_body_size` is 64k, only requests between 16k and 64k will hit disk - and on an SSD this is fast. The 16k default is a sensible split that avoids disk writes for the vast majority of API requests.

---

## Gzip Compression

```nginx
gzip on;
gzip_types application/json text/plain application/javascript text/css;
gzip_min_length 256;
gzip_comp_level 4;
gzip_vary on;
```

### `gzip on`

Enables response compression. The server compresses responses before sending them, reducing bandwidth usage and improving perceived latency for clients on slower connections.

### `gzip_types`

Which Content-Types to compress. Note: `text/html` is always compressed by nginx regardless of this list. The types here cover:
- `application/json` - API responses (the primary use case)
- `text/plain` - health check and plain text responses
- `application/javascript` / `text/css` - if any static assets are ever served

**Never compress:** images (JPEG, PNG, WebP are already compressed - re-compressing wastes CPU with no size gain), binary formats, or already-compressed archives.

### `gzip_min_length 256`

Only compress responses larger than 256 bytes. Compressing tiny responses (e.g. `{"ok":true}`) actually makes them larger due to the gzip header overhead. 256 bytes is the threshold below which compression is counterproductive.

### `gzip_comp_level 4`

Compression level from 1 (fastest, least compression) to 9 (slowest, best compression). Level 4 hits the knee of the curve - approximately 80% of the size reduction of level 9 at roughly 30% of the CPU cost. Levels 6–9 give diminishing returns on compression ratio while consuming significantly more CPU. On a 1 vCPU machine, CPU is your scarcest resource.

### `gzip_vary on`

Adds `Vary: Accept-Encoding` to compressed responses. This tells CDNs and proxy caches to cache the compressed and uncompressed versions separately, preventing a compressed response from being served to a client that didn't request compression.

---

## Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=api_limit_short:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=api_limit_long:10m  rate=60r/m;
limit_req_status 429;
```

### How `limit_req_zone` works

nginx uses a **leaky bucket** algorithm. Requests fill a bucket at the rate they arrive; the bucket drains at the defined `rate`. Requests that arrive when the bucket is full are either delayed (queued) or rejected, depending on the `burst` and `nodelay` parameters in the location block.

The zone stores the state (a counter per IP) in shared memory accessible to all worker processes. This ensures rate limiting works correctly even with multiple workers.

### `$binary_remote_addr`

The key used to track each client - their IP address in binary form. Binary form uses 4 bytes for IPv4 vs 15 bytes for the string form, allowing the 10MB zone to hold more IP entries. 10MB can hold approximately 160,000 unique IP states - far more than this VPS will ever see.

### Two-zone strategy

A single rate limit zone has a weakness: a bot that sends exactly 4 requests/second (just under the 5r/s limit) indefinitely would never be throttled.

Two zones covering different time windows close this gap:

| Zone              | Rate                         | Catches                                                       |
| ----------------- | ---------------------------- | ------------------------------------------------------------- |
| `api_limit_short` | 5 req/s                      | Burst flooding, credential stuffing, rapid-fire attacks       |
| `api_limit_long`  | 60 req/m (= 1 req/s average) | Slow scrapers, distributed bots staying under the short limit |

Both zones are applied in the location block. A request must pass **both** limits. A client sending 4 req/s would pass the short limit but hit the long limit after 15 seconds (60 requests in a minute at 4/s = exhausted in 15s).

### `rate=60r/m` vs `rate=1r/s`

These are mathematically equivalent in average rate but not in behavior. `60r/m` allows bursts of up to 60 requests in a single second as long as the minute total stays under 60. `1r/s` strictly allows one request per second. The `burst` parameter in the location block provides the practical burst allowance, making `60r/m` the more forgiving choice for the long-term zone where legitimate clients making a few API calls in quick succession shouldn't be penalized.

### `limit_req_status 429`

The HTTP status returned to rate-limited requests. The nginx default is `503 Service Unavailable`, which incorrectly signals a server problem. `429 Too Many Requests` is the correct RFC 6585 status and what well-behaved API clients implement retry-after logic for.

---

## Connection Limiting

```nginx
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;
limit_conn_status 429;
```

Applied in the location block as `limit_conn conn_limit 20`.

### Why connection limiting in addition to rate limiting?

Rate limiting counts **completed requests per unit time**. It does not limit how many connections a single IP can hold **simultaneously**.

Without connection limiting, an attacker can:
1. Open 500 TCP connections from one IP
2. Send one slow request on each (passes rate limiting - only 1 req/s per connection)
3. Hold 500 nginx worker connection slots indefinitely
4. Real users can't connect because the connection pool is exhausted

`limit_conn conn_limit 20` caps any single IP at 20 simultaneous open connections. A legitimate browser making parallel API calls needs 4–8. Mobile apps need 1–4. 20 is generous for real users and restrictive for abusers.

### `limit_conn_status 429`

Same reasoning as `limit_req_status` - 429 is the correct status for connection limiting, not 503.

---

## SSL Session Cache

```nginx
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
```

### `ssl_session_cache shared:SSL:10m`

TLS handshakes are expensive - they require asymmetric cryptography (RSA or ECDH key exchange) which is CPU-intensive. Session resumption allows a returning client to skip the full handshake by reusing a previously negotiated session.

`shared:SSL:10m` creates a 10MB shared memory cache named `SSL`, accessible to all nginx worker processes. A client that connected within the last day can resume their session in ~1/10th the CPU cost of a full handshake. On a 1 vCPU machine, this meaningfully reduces CPU pressure under returning traffic.

### `ssl_session_timeout 1d`

Sessions cached for up to 24 hours. A mobile app user who leaves and returns within a day gets a fast session resumption. After 24 hours, a new full handshake is required.

### `ssl_session_tickets off`

TLS session tickets are an alternative resumption mechanism where the server encrypts session state and sends it to the client (who presents it on reconnect). The problem: all workers must share the same ticket encryption key, and if that key is compromised, **all past sessions encrypted with it can be decrypted** - violating forward secrecy.

Disabling tickets forces use of the server-side session cache above, which does not have this property. Each session's keys are independent. This is the Mozilla recommendation for production servers.

---

## Server: HTTP (Port 80)

```nginx
server {
    listen 80;
    server_name api.rodevsy.app;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}
```

### Purpose

Port 80 exists for exactly two things in production:
1. Responding to Let's Encrypt ACME HTTP-01 challenges during certificate issuance and renewal
2. Redirecting all other HTTP traffic to HTTPS

### `location /.well-known/acme-challenge/`

Certbot's HTTP-01 challenge works by placing a token file at `/.well-known/acme-challenge/<token>` and having Let's Encrypt's servers fetch it over plain HTTP. If this request is redirected to HTTPS before the challenge is served, certificate renewal fails - and your site goes down when the certificate expires.

The `root /var/www/certbot` serves files from that directory inside the nginx container. Your docker-compose file should bind-mount the Certbot webroot here, or you can use Certbot's standalone mode. The key point: this location block must be listed **before** the catch-all redirect.

### `return 301 https://$host$request_uri`

301 Permanent Redirect. Browsers cache permanent redirects - a returning user who types `http://api.rodevsy.app` will be redirected to HTTPS by their browser before even sending a request to the server. This reduces server load for repeat visitors.

`$request_uri` preserves the full path and query string: `http://api.rodevsy.app/users?page=2` redirects to `https://api.rodevsy.app/users?page=2`, not just the root.

---

## Server: HTTPS (Port 443)

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name api.rodevsy.app;
    ...
}
```

### `listen 443 ssl`

The primary production server block. All API traffic flows through here.

### `http2 on`

HTTP/2 is the second major revision of the HTTP protocol. Key improvements relevant to an API:

**Multiplexing:** Multiple requests share a single TCP connection without head-of-line blocking. A frontend making 6 simultaneous API calls on page load sends all 6 over one connection rather than opening 6 connections. Each connection requires a TLS handshake - multiplexing eliminates 5 of those 6 handshakes.

**Header compression (HPACK):** HTTP/2 compresses headers. API requests with JWT tokens in the Authorization header benefit significantly - a 512-byte JWT sent on every request is compressed to a few bytes after the first request (headers are delta-encoded against previously seen headers).

**Binary framing:** HTTP/2 uses binary rather than text framing, which is more efficient to parse and less error-prone than HTTP/1.1's text format.

For a mobile client making multiple API calls per screen, HTTP/2 meaningfully reduces latency and server connection overhead on a 1 vCPU machine.

---

## TLS Configuration

```nginx
ssl_certificate     /etc/letsencrypt/live/api.rodevsy.app/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/api.rodevsy.app/privkey.pem;

ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
ssl_prefer_server_ciphers off;
```

### `fullchain.pem` vs `cert.pem`

`fullchain.pem` includes your certificate **and** the intermediate CA certificate chain. `cert.pem` includes only your certificate.

Clients verify your certificate by tracing a chain from your cert up to a trusted root CA. If you serve only `cert.pem`, clients that don't have Let's Encrypt's intermediate cert cached must fetch it separately - or fail validation entirely. Always use `fullchain.pem` in production.

### `ssl_protocols TLSv1.2 TLSv1.3`

Drops TLS 1.0 and 1.1, which have known vulnerabilities (POODLE, BEAST, others). The clients that don't support TLS 1.2 are essentially Internet Explorer 8 on Windows XP - not a realistic concern for an API.

TLS 1.3 is preferred when both sides support it: faster handshakes (1 RTT vs 2 RTT for TLS 1.2), better security defaults, and no legacy cipher suite negotiation.

### The cipher suite list

The cipher list is the Mozilla "Intermediate" compatibility profile. Each cipher name follows the pattern:

```
ECDHE  - Key exchange algorithm (Elliptic Curve Diffie-Hellman Ephemeral)
ECDSA/RSA - Authentication (certificate type)
AES128/256-GCM - Symmetric encryption (AES in GCM mode)
SHA256/384 - Message authentication
CHACHA20-POLY1305 - Alternative to AES (faster on devices without AES hardware acceleration)
```

**ECDHE** (Ephemeral) is the critical component - it provides **forward secrecy**. Each TLS session generates a fresh key pair that is discarded after the session. Even if your private key is stolen years later, past session traffic cannot be decrypted because the ephemeral session keys no longer exist.

**CHACHA20-POLY1305** is included because mobile devices (especially older Android) often lack hardware AES acceleration. CHACHA20 is faster in software than AES on these devices, giving mobile users better performance without sacrificing security.

What's excluded: RC4 (broken), 3DES (SWEET32 vulnerability), CBC mode ciphers with SHA1 (Lucky 13, BEAST), non-ECDHE key exchange (no forward secrecy), export ciphers (intentionally weakened).

### `ssl_prefer_server_ciphers off`

When `on`, nginx imposes its cipher ordering on the client. When `off`, the client's preferred cipher is used if it appears in the server's list.

For TLS 1.3, this setting is ignored - the client always chooses from a small set of equally secure options. For TLS 1.2, turning it `off` lets modern clients (which know which cipher runs fastest on their hardware) choose optimally. Since all ciphers in the list are strong, there is no security reason to override the client's preference.

---

## Security Headers

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy no-referrer always;
```

### `Strict-Transport-Security` (HSTS)

Instructs browsers to **never** attempt an HTTP connection to this domain for the next 63,072,000 seconds (2 years). After a browser sees this header once, it internally upgrades all HTTP requests to HTTPS before sending them - no round trip to the server needed.

This eliminates a class of attacks where an attacker on the same network (coffee shop WiFi) intercepts the initial HTTP request before the redirect fires.

`includeSubDomains` extends the policy to all subdomains. Make sure all your subdomains actually serve HTTPS before enabling this - any HTTP-only subdomain becomes unreachable from browsers that have cached the HSTS policy.

**Warning:** Do not set this with a long `max-age` until you're confident SSL renewal is working correctly. A misconfigured certificate + cached HSTS = your site is unreachable for 2 years. Start with `max-age=300` (5 minutes) during initial setup and increase once you're confident.

### `X-Content-Type-Options: nosniff`

Prevents browsers from MIME-sniffing a response away from the declared Content-Type. Without this, if an attacker can inject content into a response that nginx serves as `text/plain`, Internet Explorer and older Chrome would sniff the content and potentially execute it as JavaScript.

For an API that exclusively serves `application/json`, this header is a safety net against future bugs where response types change unexpectedly.

### `X-Frame-Options: DENY`

Prevents the API from being embedded in an `<iframe>` on any page. Clickjacking attacks work by overlaying a transparent iframe over a legitimate-looking page and tricking users into clicking API endpoints (e.g., account deletion). For a pure API with no UI, `DENY` is the correct setting.

### `Referrer-Policy: no-referrer`

When a user clicks a link that makes a request to your API, the browser normally includes a `Referer` header with the origin URL. `no-referrer` suppresses this header entirely, preventing your API from leaking information about where requests originated.

For an API, this means JWTs in query strings (if you ever use them) are not exposed in Referer headers to third-party services.

### `always` parameter

Without `always`, nginx only adds these headers to 2xx and 3xx responses. Error responses (4xx, 5xx) would not have security headers. `always` ensures they're present on every response including errors, which is important because error pages are also loaded in browsers.

---

## Location: /gateway

```nginx
location /gateway {
    access_log off;
    return 200 'OK';
    add_header Content-Type text/plain;
}
```

### Purpose

This endpoint is used by Docker's healthcheck in the compose file to verify nginx is alive:

```yaml
healthcheck:
  test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:8080/"]
```

Wait - actually, nginx's healthcheck is handled differently. The `/gateway` location is primarily used for external uptime monitoring (Uptime Robot, Better Uptime, etc.) and manual verification that nginx is running.

### `access_log off`

Healthcheck probes hit this endpoint every 30 seconds. Without this, your access log fills with:

```
GET /gateway HTTP/1.1 200 - monitoring-bot/1.0
GET /gateway HTTP/1.1 200 - monitoring-bot/1.0
GET /gateway HTTP/1.1 200 - monitoring-bot/1.0
```

Every 30 seconds. Forever. That's 2,880 useless log lines per day. `access_log off` silences them without affecting logging for the actual API traffic.

### Why not proxy to the API?

A dedicated nginx-level healthcheck endpoint confirms nginx itself is alive, independent of the API's health. If the API is down but nginx is running, monitoring should report "API down" not "nginx down." Separating the two gives more precise failure visibility.

---

## Location: / (API Proxy)

```nginx
location / {
    limit_conn conn_limit 20;
    limit_req zone=api_limit_short burst=10 nodelay;
    limit_req zone=api_limit_long  burst=20;
    ...
    proxy_pass http://nest_api;
}
```

### `limit_conn conn_limit 20`

Enforces the connection limit defined in the http block. Any single IP is capped at 20 simultaneous open connections to this location. The 21st connection gets a 429 response immediately.

### `limit_req` - burst and nodelay

```nginx
limit_req zone=api_limit_short burst=10 nodelay;
limit_req zone=api_limit_long  burst=20;
```

**`burst=10 nodelay` on the short zone:**

The `burst` parameter defines a queue that absorbs requests exceeding the rate limit before they're rejected. Without `nodelay`, excess requests are queued and delayed to satisfy the rate. With `nodelay`, burst requests are forwarded immediately but consume burst slots.

In practice: a user who sends 15 requests in one second gets all 15 forwarded immediately (5 within rate + 10 from burst). The 16th request in that second gets a 429. The burst slot replenishes at 5r/s - after 2 seconds, 10 new burst slots are available.

This is the right behavior for a legitimate frontend making parallel API calls on page load. Without `burst`, a React app hydrating with 8 API calls would throttle itself.

**No `nodelay` on the long zone:**

The long zone does not have `nodelay`. Requests exceeding 60r/m are queued, introducing artificial delay rather than immediate rejection. This is intentional - slow scrapers get progressively slower responses rather than a clean 429 they can simply catch and retry.

---

## CORS

```nginx
set $cors_origin "https://rodevsy.app";

if ($request_method = OPTIONS) {
    add_header Access-Control-Allow-Origin      "$cors_origin" always;
    add_header Access-Control-Allow-Credentials true           always;
    add_header Access-Control-Allow-Methods     "GET, POST, PUT, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers     "DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,Fingerprint" always;
    add_header Access-Control-Max-Age           1728000;
    add_header Content-Type                     "text/plain; charset=utf-8";
    add_header Content-Length                   0;
    return 204;
}

add_header Access-Control-Allow-Origin      "$cors_origin" always;
add_header Access-Control-Allow-Credentials true           always;
...
```

### Why handle CORS in nginx instead of NestJS?

CORS headers are handled at nginx for two reasons:

1. **Preflight requests never reach the API.** `OPTIONS` requests are terminated at nginx with a 204 response, saving a full round-trip through the proxy, NestJS middleware stack, and back. Under heavy traffic this matters.

2. **Centralized policy.** CORS origin is a deployment concern, not an application concern. Changing allowed origins requires updating one line in `nginx.conf` and reloading nginx (`nginx -s reload`) - no application rebuild or deploy needed.

If NestJS also has CORS configured, disable it there. Duplicate CORS headers from both nginx and NestJS will cause browser errors (`The 'Access-Control-Allow-Origin' header contains multiple values`).

### `$cors_origin` variable

Using a variable rather than a hardcoded string makes it easy to see at a glance which origin is active, and makes search-and-replace simple when switching between environments. The commented-out localhost line is there for when you're debugging prod issues locally.

### `Access-Control-Allow-Credentials: true`

Required for the browser to include cookies and the `Authorization` header in cross-origin requests. Without this, fetch requests with `credentials: 'include'` are silently rejected by the browser, even if the server accepts them.

**Security implication:** When `credentials: true`, the `Access-Control-Allow-Origin` header must be a specific origin, never `*`. A wildcard origin with credentials is rejected by browsers as a security measure. Your nginx config already correctly uses the specific origin variable.

### `Access-Control-Max-Age: 1728000`

Browsers cache the preflight response for this many seconds (20 days). Without this, every cross-origin request with a non-simple Content-Type (like `application/json`) triggers a preflight OPTIONS request first. With 20-day caching, the preflight fires once and the result is cached - eliminating the extra round-trip for returning users.

### `Access-Control-Allow-Headers`

The `Fingerprint` header is your custom header. Any non-standard header your client sends must be explicitly listed here or the browser will block the request.

### Why `OPTIONS` inside an `if` block?

nginx's `if` directive is famously problematic - it has unexpected behavior in many contexts. However, `if ($request_method = OPTIONS)` with only `add_header` and `return` inside is a well-established exception that behaves correctly. The nginx documentation warning about `if` applies to more complex scenarios involving `proxy_pass` and `rewrite` inside `if` blocks.

---

## Proxy Settings

```nginx
proxy_pass         http://nest_api;
proxy_http_version 1.1;
proxy_set_header   Connection        "";
proxy_set_header   Host              $host;
proxy_set_header   X-Real-IP         $remote_addr;
proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header   X-Forwarded-Proto $scheme;
proxy_hide_header  X-Powered-By;
```

### `proxy_http_version 1.1`

Required for upstream keepalive connections (see upstream block). HTTP/1.0 has no persistent connections - without this, keepalive is silently disabled.

### `proxy_set_header Connection ""`

HTTP/1.1 allows the `Connection: keep-alive` header to request persistent connections, but it also allows `Connection: close` to signal the end of a session. Some clients send `Connection: close` in their requests. By setting `Connection ""` (empty string), nginx removes the Connection header before forwarding, preventing accidental keepalive pool disruption.

### `proxy_set_header Host $host`

Forwards the original `Host` header from the client to NestJS. Without this, NestJS sees `api:8080` (the upstream address) as the Host, which breaks any logic that depends on the hostname - link generation, JWT issuer validation, tenant routing.

### `X-Real-IP` and `X-Forwarded-For`

NestJS sees all connections originating from nginx's Docker IP, not the real client IP. These headers pass the original client IP through to the application.

`X-Real-IP` contains the single connecting client IP. `X-Forwarded-For` is a comma-separated list of all IPs in the proxy chain, useful when there are multiple proxy layers (CDN → nginx → API). NestJS should read these headers for rate limiting, audit logging, and geolocation - not `req.ip` which will always be nginx's internal IP.

In NestJS, enable trusted proxy in `main.ts`:
```typescript
app.set('trust proxy', 1);
```

### `X-Forwarded-Proto $scheme`

Tells NestJS whether the original client connected via HTTP or HTTPS. Without this, NestJS always sees `http` (because nginx→API is plain HTTP inside Docker), causing redirect generation and HTTPS detection logic to produce `http://` URLs.

### `proxy_hide_header X-Powered-By`

NestJS adds `X-Powered-By: Express` to all responses (because it's built on Express under the hood). This header advertises the framework and version to potential attackers. Hiding it follows the same principle as `server_tokens off` - don't give away fingerprinting information for free.

---

## Proxy Timeouts

```nginx
proxy_connect_timeout 5s;
proxy_send_timeout    10s;
proxy_read_timeout    30s;
```

### `proxy_connect_timeout 5s`

How long nginx waits to establish a TCP connection to the upstream (NestJS). If the API container is down or restarting, nginx fails fast after 5 seconds with a 502 Bad Gateway rather than holding the client connection open indefinitely. On Docker's bridge network, a connection to a running container happens in microseconds - a 5-second timeout only fires when the container is actually down.

### `proxy_send_timeout 10s`

How long nginx waits between successive write operations when sending a request to the upstream. If NestJS stops receiving data mid-request (highly unusual on loopback), nginx gives up after 10 seconds.

### `proxy_read_timeout 30s`

How long nginx waits for NestJS to send a response after forwarding the request. This is the most important of the three timeouts.

30 seconds is generous for standard REST endpoints - they should respond in milliseconds to seconds. The 30-second ceiling prevents a slow NestJS response (from a locked database query, runaway computation, or memory pressure) from holding nginx worker connections open indefinitely.

**If you add specific endpoint types, override per location:**

```nginx
# Long-polling or Server-Sent Events
location /events {
    proxy_read_timeout 120s;
    proxy_pass http://nest_api;
}

# Heavy report generation
location /reports/export {
    proxy_read_timeout 90s;
    proxy_pass http://nest_api;
}
```

---

## Attack Surface & Threat Model

This configuration defends against the following:

| Attack                         | Defense                                               |
| ------------------------------ | ----------------------------------------------------- |
| Version fingerprinting         | `server_tokens off`, `proxy_hide_header X-Powered-By` |
| HTTP downgrade / MITM          | HSTS header, HTTP→HTTPS redirect                      |
| Slowloris (slow headers)       | `client_header_timeout 10s`                           |
| Slowloris (slow body)          | `client_body_timeout 10s`                             |
| Request flood / DDoS           | `limit_req` rate limiting (both zones)                |
| Connection exhaustion          | `limit_conn 20` per IP                                |
| Oversized body attacks         | `client_max_body_size 64k`                            |
| Clickjacking                   | `X-Frame-Options DENY`                                |
| MIME sniffing                  | `X-Content-Type-Options nosniff`                      |
| Weak TLS ciphers               | Explicit cipher list, TLS 1.2+ only                   |
| Session ticket key compromise  | `ssl_session_tickets off`                             |
| CORS wildcard credential abuse | Explicit origin, `allow_credentials true`             |

**What this config does NOT defend against:**

- **Application-level attacks** (SQL injection, XSS, IDOR) - these must be handled in NestJS
- **Distributed DDoS** - per-IP limits are ineffective against botnets; requires a CDN (Cloudflare) or upstream filtering
- **Authenticated abuse** - a legitimate user hammering endpoints passes rate limiting unless you add per-user limits in NestJS
- **Zero-day nginx vulnerabilities** - keep the image updated with `docker compose pull`

---

## Tuning Cheatsheet

### You're seeing 429s from legitimate users

Raise burst allowance, not the base rate:
```nginx
limit_req zone=api_limit_short burst=20 nodelay;  # was 10
limit_req zone=api_limit_long  burst=40;           # was 20
```

### You have a file upload endpoint

Override body size in a specific location:
```nginx
location /uploads {
    client_max_body_size 10m;
    proxy_read_timeout 60s;
    proxy_pass http://nest_api;
}
```

### You add WebSocket support

```nginx
location /ws {
    proxy_pass http://nest_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;   # WebSockets are long-lived
}
```

### You add a CDN (Cloudflare) in front

Change `$remote_addr` to the real IP header Cloudflare provides:
```nginx
set_real_ip_from 103.21.244.0/22;  # Cloudflare IP ranges
real_ip_header CF-Connecting-IP;
```

And tighten CORS - the CDN handles the first hop, so your nginx sees requests from Cloudflare IPs, not end users.

### You want to add response caching for public endpoints

```nginx
proxy_cache_path /tmp/nginx_cache levels=1:2 keys_zone=api_cache:10m max_size=100m;

location /public/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 1m;
    proxy_cache_use_stale error timeout updating;
    proxy_pass http://nest_api;
}
```

Only cache endpoints with no authentication and stable responses. Never cache responses with `Set-Cookie` or `Authorization`.