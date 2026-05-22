# veil-mirror

Public price snapshot mirror for the Veil / SteamIdler+ project.

Daily cron at 06:00 UTC scrapes Steam Market prices for cards in our snapshot list, commits the result to the gh-pages branch, and serves it via GitHub Pages at:

- https://r1skie.github.io/veil-mirror/prices/latest.json

Source code that consumes this data lives in private repos. This repo exists solely to host the public JSON artifact.
