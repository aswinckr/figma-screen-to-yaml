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

**First export:** unknown components appear as generic boxes. To get your component aliases and slots, review `components.discovered.json` using [docs/MAPPING.md](docs/MAPPING.md), then replay the saved data with your mappings. You do not need another API call for that step.

## 3. Send useful feedback

Which element differed? What should its YAML say? Include relevant diagnostic codes and a sanitized snippet. Never post your token or confidential design exports in the public repo.

This version has automated tests but has not been verified against your live file or renderer. The point of this release is to make that local test possible and reproducible.
