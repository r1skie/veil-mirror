import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT_DIR = resolve('gh-pages/prices')
// Steam's /market/search/render hard-caps the page at 10 items regardless of
// the requested `count`. The previous script asked for 100, got 10, and then
// advanced `start` by 100 — silently skipping 90% of every range. We now use
// the real page size and advance by the actual returned count (no skipping).
const PAGE = 10
const SLEEP_MS = Number(process.env.SLEEP_MS ?? 500)
const APPID = 753 // Steam Community items (cards, backgrounds, emoticons, boosters)
const UA = 'Mozilla/5.0 (compatible; VeilMirror/1.0; +https://github.com/r1skie/veil-mirror)'

// Item classes under app 753, each swept by quantity desc so the most-traded
// (most likely owned) items of EVERY class are captured. Cards (class 2,
// ~182k total) include foils. Caps bound runtime within the workflow timeout;
// the merge-over-prior behaviour accumulates deeper coverage across daily runs.
const CLASSES = [
  { tag: 'tag_item_class_2', label: 'cards', cap: Number(process.env.CAP_CARDS ?? 120000) },
  { tag: 'tag_item_class_3', label: 'backgrounds', cap: Number(process.env.CAP_BACKGROUNDS ?? 60000) },
  { tag: 'tag_item_class_4', label: 'emoticons', cap: Number(process.env.CAP_EMOTICONS ?? 40000) },
  { tag: 'tag_item_class_5', label: 'boosters', cap: Number(process.env.CAP_BOOSTERS ?? 20000) },
]

const url = (start, classTag) =>
  `https://steamcommunity.com/market/search/render/?count=${PAGE}&start=${start}` +
  `&appid=${APPID}&category_753_item_class%5B%5D=${classTag}` +
  `&sort_column=quantity&sort_dir=desc&norender=1`

async function fetchPage(start, classTag, attempt = 0) {
  try {
    const r = await fetch(url(start, classTag), { headers: { 'User-Agent': UA, 'Accept': 'application/json' } })
    if (r.status === 429) {
      if (attempt >= 5) throw new Error('429 exhausted')
      await new Promise(res => setTimeout(res, 30000 * (attempt + 1)))
      return fetchPage(start, classTag, attempt + 1)
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } catch (e) {
    if (attempt >= 3) throw e
    await new Promise(res => setTimeout(res, 5000))
    return fetchPage(start, classTag, attempt + 1)
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

// Merge over prior snapshot: items not refetched this run keep their previous
// price + `at` timestamp so consumers can see staleness.
let priorCards = {}
try {
  const prior = JSON.parse(await readFile(resolve(OUT_DIR, 'latest.json'), 'utf-8'))
  priorCards = prior?.cards && typeof prior.cards === 'object' ? prior.cards : {}
  console.debug(`Merging over prior snapshot: ${Object.keys(priorCards).length} entries`)
} catch {
  console.debug('No prior snapshot — starting fresh')
}

const now = new Date().toISOString()
const out = { generatedAt: now, cards: { ...priorCards } }
let refreshed = 0
let grandTotal = 0

// Flush the snapshot to disk periodically so a long run that hits the workflow
// timeout still leaves a usable, larger snapshot (writeFile only-at-end would
// lose everything on a kill).
async function flush() {
  out.refreshedThisRun = refreshed
  out.totalCards = Object.keys(out.cards).length
  out.totalCount = grandTotal
  out.classes = CLASSES.map((c) => ({ tag: c.tag, label: c.label, cap: c.cap }))
  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(resolve(OUT_DIR, 'latest.json'), JSON.stringify(out))
}

// Sweep each class up to its own cap, accumulating into the shared `cards` map.
for (const { tag, label, cap } of CLASSES) {
  let start = 0
  let total = Infinity
  let pages = 0
  let classRefreshed = 0
  let sinceFlush = 0
  console.debug(`--- class ${label} (${tag}), cap=${cap} ---`)

  while (start < total && classRefreshed < cap) {
    let data
    try {
      data = await fetchPage(start, tag)
    } catch (e) {
      console.error(`class ${label} fetch failed at start=${start}: ${e.message}`)
      break
    }
    if (!data?.success) {
      console.error(`class ${label} returned success=false at start=${start}`)
      break
    }
    total = typeof data.total_count === 'number' ? data.total_count : total
    const results = Array.isArray(data.results) ? data.results : []
    if (results.length === 0) break
    for (const row of results) {
      if (classRefreshed >= cap) break
      if (typeof row?.hash_name !== 'string') continue
      if (typeof row?.sell_price !== 'number' || row.sell_price <= 0) continue
      const appId = extractAppId(row)
      if (appId == null) continue
      out.cards[row.hash_name] = { price: row.sell_price, appId, at: now }
      classRefreshed++
      refreshed++
      sinceFlush++
    }
    pages++
    // Advance by what Steam actually returned — never skip rows.
    start += results.length
    if (pages % 50 === 0) console.debug(`  ${label}: start=${start}/${total}, refreshed=${classRefreshed}/${cap}`)
    if (sinceFlush >= 2000) { await flush(); sinceFlush = 0 }
    if (classRefreshed >= cap) break
    await new Promise(r => setTimeout(r, SLEEP_MS))
  }
  grandTotal = Math.max(grandTotal, total === Infinity ? 0 : total)
  console.debug(`class ${label}: refreshed ${classRefreshed}`)
  await flush()
}

await flush()
console.debug(`Done — ${refreshed} refreshed this run, ${Object.keys(out.cards).length} total in merged snapshot`)

const date = new Date().toISOString().slice(0, 10)
await mkdir(resolve(OUT_DIR, 'archive'), { recursive: true })
await writeFile(resolve(OUT_DIR, `archive/${date}.json`), JSON.stringify(out))
