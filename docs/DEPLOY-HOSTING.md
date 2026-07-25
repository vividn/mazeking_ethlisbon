# Hosting: Scaleway Object Storage + Cloudflare

Merging to `main` runs `.github/workflows/deploy.yml`, which builds the
frontend and publishes it to a Scaleway bucket. Cloudflare sits in front for
TLS, caching and DNS.

---

## Should the bucket be public or private?

**Public read.** Not because private is hard, but because private would be
protecting the wrong thing.

The deployed artifact is a static public website. Every byte in it — the JS,
the WASM, the circuit — is meant to be fetched by anonymous browsers. There is
no confidential content for a private bucket to protect. What "private" would
actually buy you is *origin protection*: stopping people from bypassing
Cloudflare and hitting Scaleway directly.

That protection is real but modest, and the usual way to get it is expensive
in moving parts: a private bucket means Cloudflare must authenticate every
request, which means a Worker performing AWS SigV4 signing, which means a
long-lived S3 credential living in Cloudflare and a new failure mode sitting
directly in the request path. That is a bad trade the night before a demo.

**If you do want origin protection later**, the cheap version is a bucket
policy that allows anonymous `GetObject` only from Cloudflare's published IP
ranges. Same effect, no Worker, no credential at the edge, and it can be added
without touching the deploy pipeline.

### The thing that actually needs care

**Anything in a `VITE_*` variable is inlined into the bundle and is public.**
Storing it in CI keeps it out of the repository; it does *not* keep it out of
the shipped JavaScript. Anyone can read `VITE_ALCHEMY_KEY` out of the deployed
site. (Verifiable: build with a placeholder value and grep `dist/assets/*.js`.)

Because of that, RPC credentials here belong in a GitHub Actions **variable**,
not a secret. A secret would be masked in CI logs while being published in
plain sight, which is false confidence and misleads the next maintainer. A
variable states what is true: public by construction, protected by the
provider's origin allowlist rather than by concealment.

Two notes on relying on an origin allowlist:

- **The production key is domain-restricted and is not used locally.** Local
  development supplies its own key through `frontend/.env` — copy
  `frontend/.env.example` and fill it in with a personal Alchemy key. Leaving
  it blank also works; the app falls back to public RPCs, which are adequate
  for local use. Keeping the production endpoint narrow is the point of
  restricting it.
- **Origin allowlists are checked from browser-sent headers**, which
  non-browser clients can spoof, so they bound casual reuse rather than
  determined abuse. On a free plan the provider's own quota already caps the
  downside, which is a reasonable place to leave it; tighter controls are worth
  revisiting only if the key is actually abused.

Never use a key carrying billing exposure or write scope. This is true no
matter how the bucket is configured.

---

## One-time setup

### 1. Bucket

Create a bucket in Scaleway Object Storage (e.g. region `fr-par`) and enable
**bucket website** mode:

- **index document:** `index.html`
- **error document:** `index.html` (or `404.html`, which the workflow also
  uploads — see *SPA routing* below)

Grant anonymous read. A minimal bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET/*"
    }
  ]
}
```

### 2. Cloudflare

Point a proxied (orange-cloud) `CNAME` at the bucket's website endpoint:

```
mazeking.example  CNAME  YOUR-BUCKET.s3-website.fr-par.scw.cloud   [proxied]
```

Set SSL/TLS mode to **Full**. Leave Cloudflare's default caching — the
workflow already sets correct `Cache-Control` per object, and Cloudflare
honours it.

### 3. GitHub secrets and variables

| Secret | Required | Notes |
|---|---|---|
| `SCW_ACCESS_KEY_ID` | yes | Scaleway API key with write access to the bucket |
| `SCW_SECRET_ACCESS_KEY` | yes | |
| `SCW_BUCKET` | yes | bucket name only, no `s3://` |
| `SCW_REGION` | no | defaults to `fr-par` |
| `VITE_ALCHEMY_KEY` | no | **variable, not secret** — public once built; covers every chain |
| `VITE_SEPOLIA_RPC_URL` | no | variable; per-chain override, wins over the key |
| `VITE_POLYGON_ZKEVM_RPC_URL` | no | variable; per-chain override, wins over the key |
| `CLOUDFLARE_API_TOKEN` | no | enables automatic cache purge |
| `CLOUDFLARE_ZONE_ID` | no | |

The Cloudflare purge step is skipped cleanly when its secrets are absent, so
the deploy works before Cloudflare is wired up.

---

## What the workflow handles, and why

Three things about this particular app break a naive `s3 sync`:

**WebAssembly content type.** The bundle ships two `.wasm` files (the Noir ACVM
and ABI encoders). Browsers refuse `WebAssembly.instantiateStreaming` on
anything except `application/wasm`, and CLI extension-guessing can't be relied
on. Getting this wrong is nasty because the page loads perfectly and only
*proof generation* fails. The workflow uploads WASM separately with an explicit
content type.

**SPA routing.** The app uses `BrowserRouter`, so `/gallery` and `/my-mazes`
are not keys in the bucket. Without an error document pointing at the app, a
deep link or a refresh returns 404. The workflow publishes `index.html` as
`404.html`; set the bucket's error document to match.

**Cache correctness.** Hashed assets are immutable and get a one-year cache.
`index.html` is the one file whose name is stable across deploys, so it is
uploaded `no-cache` — a stale copy would point browsers at asset hashes from an
older build. Upload order matters for the same reason: assets first,
`index.html` last, so the entry point never references files that aren't there
yet.

**No `--delete`.** Old hashed assets are left in place so that any client still
holding a cached `index.html` keeps working. They are small and harmless. To
prune when it eventually matters:

```bash
aws s3 sync frontend/dist s3://$SCW_BUCKET \
  --endpoint-url https://s3.fr-par.scw.cloud --delete
```

---

## Verifying a deploy

```bash
# correct WASM type (the failure that hides until you try to prove)
curl -sI https://your-domain/assets/<hash>.wasm | grep -i content-type
#   expect: application/wasm

# index.html must not be cached long
curl -sI https://your-domain/ | grep -i cache-control
#   expect: no-cache, must-revalidate

# deep link resolves instead of 404ing
curl -s -o /dev/null -w '%{http_code}\n' https://your-domain/gallery
#   expect: 200
```

The most valuable of these is the first: solve a maze on the deployed site and
generate a proof. That exercises the WASM path end to end, which is the part a
static-hosting mistake breaks most quietly.
