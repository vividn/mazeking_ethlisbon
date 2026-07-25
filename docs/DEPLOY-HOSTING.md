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
Storing it as a GitHub secret keeps it out of the repo; it does *not* keep it
out of the shipped JavaScript. Anyone can read
`VITE_POLYGON_ZKEVM_RPC_URL` out of the deployed site.

So use an RPC key that is domain-restricted or rate-limited. Never one with
billing exposure or write scope. This is true no matter how the bucket is
configured.

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

### 3. GitHub secrets

| Secret | Required | Notes |
|---|---|---|
| `SCW_ACCESS_KEY_ID` | yes | Scaleway API key with write access to the bucket |
| `SCW_SECRET_ACCESS_KEY` | yes | |
| `SCW_BUCKET` | yes | bucket name only, no `s3://` |
| `SCW_REGION` | no | defaults to `fr-par` |
| `VITE_SEPOLIA_RPC_URL` | no | **public once built** |
| `VITE_POLYGON_ZKEVM_RPC_URL` | no | **public once built** |
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
