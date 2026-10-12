# crawler-homedirect

Discovery worker for HomeDirect's **„Anunțuri Particulari”** feed (Dashboard → Prospectare): new
private-owner listings from OLX, Storia, Publi24 and Imobiliare.ro, posted to the HomeDirect API
(`POST /api/market-listings/ingest`). Agencies "Preia" a listing from the feed and get the owner's
phone by saving the ad with the HomeDirect Chrome extension. **This worker never collects owner
names or phone numbers.**

## Rules it follows (don't loosen these)
- **robots.txt** of every portal is fetched and honoured (`src/robots.js`); disallowed URLs are skipped.
- Honest user agent (`HomeDirectResearchBot/1.0 (+mailto:…)`), no browser impersonation, no proxies,
  no CAPTCHA solving. A 403/429/503 or a challenge page **stops that portal** and pauses it
  6 h → 24 h (`output/state.json`). It is never retried around a block.
- One request at a time per portal, ≥4 s apart (OLX: 15 s), ± jitter.
- Category/search pages carry ~20–50 ads each with full data, so ad pages are only fetched for
  Imobiliare (RSS → each new ad once, `output/seen.json`) and for re-checks (below).
- **Incremental paging:** pages are read newest-first and a category stops at the first page whose
  ads are all already known (`output/known.json`, 45 days) — every new ad is caught with the
  fewest requests (usually 1 page per category per run).
- **Re-checks:** after each discovery, up to 30 listings not seen for 3+ days are opened once and
  reported to the API as still online or gone (Storia, Publi24), so the feed doesn't drop
  listings that merely scrolled off page 1, and doesn't keep sold ones.
- Storia sends `Content-Signal: ai-train=no, ai-input=no` — its data must not feed AI features.

## Portal status (2026-10-13)
| Portal | How | Owner detection | Status |
|---|---|---|---|
| Storia | sale searches with `ownerTypeSingleSelect=PRIVATE` | `isPrivateOwner` | works |
| Publi24 | category pages (JSON-LD ItemList) | owner wording only (no portal flag) | works |
| OLX | categories with `search[private_business]=private` | `isBusiness` | first page OK, then 403 → back-off |
| Imobiliare | RSS + ad JSON-LD | `offeredBy.@type = Person` | ad pages 403 → back-off |

Blocked portals are still covered by agents' extension captures (they feed the same list).

## Run
```bash
cp .env.example .env              # API_URL + CRAWLER_INGEST_SECRET (same value as the API's)
npm run dry-run                   # one pass, writes output/dry-run.json, nothing sent
node src/worker.js --once --source=storia,publi24 --dry-run
npm start                         # forever: each portal every ~45 min (+ re-checks)
node --env-file=.env src/worker.js --once --backfill --source=storia   # one-time deep pass, 8 s pacing
```
Flags: `--source=a,b` `--pages=N` (max pages per category, default 5; 40 with `--backfill`)
`--limit=N` (Imobiliare ads per run) `--delay=ms` `--once` `--dry-run` `--backfill` `--no-recheck` `--out=dir`.

## Other ways listings reach the feed
- **Extension, passive (opt-in):** with „Contribuie la Anunțuri Particulari” on (extension popup /
  Options / the dashboard feed), `content-scripts/feed-observer.js` sends the private ads already on
  the page an agent is viewing → `POST /api/market-listings/observe`. No extra portal requests.
  This is how OLX and Imobiliare get covered while they block the crawler.
- **Extension, "save" button:** every prospect capture is also added to the feed.

## Deploy (small DigitalOcean droplet, Node ≥ 22)
```bash
sudo mkdir -p /opt/crawler-homedirect && sudo chown $USER /opt/crawler-homedirect
# copy this folder there, then:
cd /opt/crawler-homedirect && cp .env.example .env && nano .env   # API_URL=https://www.homedirect.ro/api
sudo tee /etc/systemd/system/hd-crawler.service >/dev/null <<'UNIT'
[Unit]
Description=HomeDirect private-listings crawler
After=network-online.target
[Service]
WorkingDirectory=/opt/crawler-homedirect
ExecStart=/usr/bin/node --env-file=.env src/worker.js
Restart=always
RestartSec=60
User=nobody
[Install]
WantedBy=multi-user.target
UNIT
sudo chown -R nobody /opt/crawler-homedirect/output 2>/dev/null; sudo systemctl daemon-reload && sudo systemctl enable --now hd-crawler
journalctl -u hd-crawler -f        # logs
```

## Layout
- `src/worker.js` — scheduler, back-off state, seen cache
- `src/known.js` — known ad ids + `pageUntilKnown` incremental pager
- `src/recheck.js` — still-online / gone re-checks via the API
- `src/sources/{olx,storia,publi24,imobiliare}.js` — `discover()` → listing snapshots
- `src/http.js` — robots-checked, paced fetch; `BlockedError` on 403/429/503/challenge
- `src/listing.js` — `deriveExternalId` (**must match the extension's**), type/rooms helpers
- `src/ownerSignals.js` — „fără agenții” / agency / owner wording (identical copy of `api/utils/ownerSignals.js`)
- `src/ingest.js` — batches to the API, or `output/dry-run.json`
- `legacy/` — the previous single-portal CLI, kept for reference only
