import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT_DIR = resolve('gh-pages/prices')
const PAGE = 100
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 1200)
const MAX_LISTINGS = Number(process.env.MAX_LISTINGS ?? 5000)
const APPID = 753 // Steam Community items (trading cards live under this app)
const UA = 'Mozilla/5.0 (compatible; VeilMirror/1.0; +https://github.com/r1skie/veil-mirror)'

// Sort by listings desc → Steam's "most-traded" first. This is the implicit default
// for /market/search/render, but we set it explicitly so the cap captures the
// highest-liquidity items.
// Trading-card-class filter narrows from ~200k items to ~30-50k cards.
const url = (start) =>
  `https://steamcommunity.com/market/search/render/?count=${PAGE}&start=${start}` +
  `&appid=${APPID}&category_753_item_class%5B%5D=tag_item_class_2` +
  `&sort_column=quantity&sort_dir=desc&norender=1`

async function fetchPage(start, attempt = 0) {
  try {
    const r = await fetch(url(start), { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    if (r.status === 429) {
      if (attempt >= 5) throw new Error('429 exhausted')
      await new Promise(res => setTimeout(res, 30000 * (attempt + 1)))
      return fetchPage(start, attempt + 1)
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } catch (e) {
    if (attempt >= 3) throw e
    await new Promise(res => setTimeout(res, 5000))
    return fetchPage(start, attempt + 1)
  }
}

function extractAppId(row) {
  // Try multiple shapes Steam returns: row.asset_description.appid, row.app_id, row.appid
  const desc = row?.asset_description
  if (desc && typeof desc.appid === 'number') return desc.appid
  if (typeof row?.app_id === 'number') return row.app_id
  if (typeof row?.appid === 'number') return row.appid
  return null
}

const out = { generatedAt: new Date().toISOString(), cards: {} }
let start = 0
let total = Infinity
let pages = 0
let captured = 0

while (start < total && captured < MAX_LISTINGS) {
  const data = await fetchPage(start)
  if (!data?.success) {
    console.error('SCE search returned success=false at start=', start)
    break
  }
  total = typeof data.total_count === 'number' ? data.total_count : total
  const results = Array.isArray(data.results) ? data.results : []
  if (results.length === 0) break
  for (const row of results) {
    if (captured >= MAX_LISTINGS) break
    if (typeof row?.hash_name !== 'string') continue
    if (typeof row?.sell_price !== 'number' || row.sell_price <= 0) continue
    const appId = extractAppId(row)
    if (appId == null) continue
    out.cards[row.hash_name] = { price: row.sell_price, appId }
    captured++
  }
  pages++
  start += PAGE
  if (pages % 5 === 0) console.debug(`page ${pages}, start=${start}/${total}, captured=${captured}/${MAX_LISTINGS}`)
  if (captured >= MAX_LISTINGS) break
  await new Promise(r => setTimeout(r, SLEEP_MS))
}

out.totalCards = captured
out.totalCount = total
out.cap = MAX_LISTINGS
console.debug(`Done — ${captured} cards from ${pages} pages (total_count=${total}, cap=${MAX_LISTINGS})`)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(resolve(OUT_DIR, 'latest.json'), JSON.stringify(out))
const date = new Date().toISOString().slice(0, 10)
await mkdir(resolve(OUT_DIR, 'archive'), { recursive: true })
await writeFile(resolve(OUT_DIR, `archive/${date}.json`), JSON.stringify(out))
