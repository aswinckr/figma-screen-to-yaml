# Start here

## 1. Try the included example

Install Node.js 20.12+ if needed. In this folder:

```sh
npm ci
npm run demo
```

Open `exports/demo/screen.yaml`. It shows text styling, a divider, and a product with price/image slots. All example content is synthetic.

## 2. Try your Figma screen

Copy `.env.example` to `.env`. Paste your Figma personal access token after `FIGMA_TOKEN=`. It needs `file_content:read` and file access.

Select the screen frame in Figma, copy its link, and run:

```sh
npm run export-screen -- "PASTE_SCREEN_LINK" --out exports/my-first-screen --reference
```

Open `screen.yaml` and `diagnostics.json` in that output folder. `facts.json` preserves the full selected tree even if something cannot yet be translated into the YAML.

The terminal reports each stage, elapsed time, asset counts, and retry delays. During network waits it prints a heartbeat every 10 seconds. Each request has a 60-second timeout; the whole export can take longer because assets are fetched in batches and downloaded individually. No completion-time estimate is guessed. Progress goes to stderr, not the generated files. To inspect data without waiting for asset rendering, use `--no-assets` and omit `--reference`. Ctrl+C cancels without changing Figma; use a fresh output folder if a previous run finished.

**First export:** unknown components appear as generic boxes. To get your component aliases and slots, review `components.discovered.json` using [docs/MAPPING.md](docs/MAPPING.md), then replay the saved data with your mappings. You do not need another API call for that step.

## 3. Send useful feedback

Which element differed? What should its YAML say? Include relevant diagnostic codes and a sanitized snippet. Never post your token or confidential design exports in the public repo.

This version has automated tests and one private live-screen source audit. That is not a guarantee of visual parity or compatibility with your renderer; compare your own screen before relying on the result.
