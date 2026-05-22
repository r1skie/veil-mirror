# SteamIdler+ Community Hub

Snapshots and docs served from the gh-pages branch of [r1skie/SteamIdler-](https://github.com/r1skie/SteamIdler-).

## Resources

- **[Price snapshot](prices/latest.json)** — daily-refreshed JSON of Steam 753 trading-card sell prices.
- **[Wiki](wiki/)** — mirrored from [zevnda/steam-game-idler](https://github.com/zevnda/steam-game-idler).

## Price snapshot format

```json
{
  "generatedAt": "2026-05-22T06:00:00.000Z",
  "totalCards": 32457,
  "totalCount": 32457,
  "cards": { "<market_hash_name>": <sell_price_cents>, ... }
}
```
