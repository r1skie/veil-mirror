import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OUT_DIR = resolve('gh-pages/prices')
const PAGE = 100
const SLEEP_MS = 700
const UA = 'Mozilla/5.0 (compatible; VeilMirror/1.0; +https://github.com/r1skie/veil-mirror)'

// Trading-card-class filter narrows from ~200k 753 items to ~30-50k cards.
const url = (start) =>
  `https://steamcommunity.com/market/search/render/?count=${PAGE}&start=${start}&appid=753&category_753_item_class%5B%5D=tag_item_class_2&norender=1`

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

const out = { generatedAt: new Date().toISOString(), cards: {} }
let start = 0
let total = Infinity
let pages = 0

while (start < total) {
  const data = await fetchPage(start)
  if (!data?.success) {
    console.error('SCE search returned success=false at start=', start)
    break
  }
  total = typeof data.total_count === 'number' ? data.total_count : total
  const results = Array.isArray(data.results) ? data.results : []
  if (results.length === 0) break
  for (const row of results) {
    if (typeof row?.hash_name !== 'string') continue
    if (typeof row?.sell_price !== 'number') continue
    out.cards[row.hash_name] = row.sell_price
  }
  pages++
  start += PAGE
  if (pages % 25 === 0) console.debug(`page ${pages}, start=${start}/${total}, captured=${Object.keys(out.cards).length}`)
  await new Promise(r => setTimeout(r, SLEEP_MS))
}

out.totalCards = Object.keys(out.cards).length
out.totalCount = total
console.debug(`Done — ${out.totalCards} cards from ${pages} pages (total_count=${total})`)

await mkdir(OUT_DIR, { recursive: true })
await writeFile(resolve(OUT_DIR, 'latest.json'), JSON.stringify(out))
const date = new Date().toISOString().slice(0, 10)
await mkdir(resolve(OUT_DIR, 'archive'), { recursive: true })
await writeFile(resolve(OUT_DIR, `archive/${date}.json`), JSON.stringify(out))
