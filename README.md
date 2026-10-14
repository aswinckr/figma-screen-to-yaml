# Figma Screen → YAML

A local, deterministic **Figma REST API** exporter. No MCP server or AI model is required.

Give it a screen link. Get the complete selected layer data, a structured screen YAML draft, local assets, and explicit diagnostics. Component internals are **inspected**, but not emitted as duplicate layout boxes when a reviewed component mapping exists.

**Status: v0.2.0, experimental.** Automated fixtures and mocked network tests pass; live Figma export and compatibility with your particular renderer still need local verification. The included schema is an interchange contract, **not an official Bento or Figma schema**. This is not a universal one-click app generator.

## Run the demo

Requires Node.js 20.12+ and npm. No credentials needed.

```sh
npm ci
npm run demo
```

Open `exports/demo/screen.yaml`. The synthetic demo includes mixed-weight text, a divider, a product component with a nested price slot, and a local image slot. It contains no company designs or proprietary component definitions.

Output directories are never overwritten. To rerun, use a new `--out` directory with `export-screen`.

## Export your Figma screen

1. Copy `.env.example` to `.env` and set `FIGMA_TOKEN` to your Figma personal access token with `file_content:read` and access to the file. This is a Figma token, not an AI key.
2. Select the screen frame in Figma and copy its link (must include `node-id`).
3. Run:

```sh
npm run export-screen -- "YOUR_FIGMA_SCREEN_URL" --out exports/first --reference
```

The initial export works **without a component registry**: unknown instances become generic containers and are flagged. All available source properties and descendant content remain in `facts.json` and `raw.figma.json`. To produce your library's component names and slots, review mappings as described below.

| Output | Purpose |
| --- | --- |
| `screen.yaml` | Structured screen draft with boxes, text and mapped components |
| `facts.json` | Every selected node, including mapped internals, hidden layers, text runs and original properties |
| `raw.figma.json` | Original Figma response for offline replay |
| `measurements.json` / `.yaml` | Layout compilation measurements; authored padding separate from geometric distances |
| `components.discovered.json` | Component keys, property values and descendant candidates for mapping |
| `assets.json` + `assets/` | Node-to-file mapping, SHA-256 hashes and local image bytes |
| `reference.png` | Figma-rendered frame when `--reference` succeeds |
| `diagnostics.json` | Missing data, unresolved mappings and unsupported conversions |
| `manifest.json` | Input/mapping/template/asset hashes and source version |

Live export downloads required image/vector nodes as **PNG node renders**, preserving their baked appearance rather than claiming editable icon identity. It does not fetch original image-fill files or SVGs in this version. Assets use the snapshot's version when provided by Figma. API failures become diagnostics; inspect them even when the process exits successfully.

## Map your components once

Copy `exports/first/components.discovered.json` to a local mapping file under `exports/`. Set the appropriate `target`, property rules and slot rules. `target: null` means unresolved, never an automatic name-based guess.

```sh
npm run export-screen -- --input exports/first/raw.figma.json \
  --mapping exports/my-components.json \
  --asset-manifest exports/first/assets.json \
  --out exports/mapped
```

See [mapping instructions](docs/MAPPING.md) and the working [synthetic mapping](examples/rich.mapping.json). Map stable component keys, then select actual descendant instances/text/images. No hardcoded registry for a company's design system is bundled.

The example screen grammar supports `meta`, `body`, `box`, `children`, `layout`, `style`, `component`, `preset`, `props`, `text`, and recursive `slots` with `$component`, `$image`, `$text`, `$asset`, `$icon` and `$state` markers. Image/text/component slot rules are generated from Figma; icon/state/asset markers may be supplied explicitly. Business logic is never inferred.

You can supply your actual JSON Schema:

```sh
npm run export-screen -- --input exports/first/raw.figma.json \
  --mapping exports/my-components.json --schema path/to/renderer.schema.json \
  --asset-manifest exports/first/assets.json --out exports/checked
npm run validate -- exports/checked/screen.yaml --schema path/to/renderer.schema.json
```

The additional schema must be self-contained with local `$ref` definitions; remote references are not fetched. The exporter does not implement or include your renderer.

## Options

`npm run export-screen -- --help` lists all options.

- `--no-assets`: skip live asset downloads; missing assets remain explicit diagnostics.
- `--reference`: render the selected frame too (live export).
- `--asset-manifest PATH`: reuse local assets offline; file paths must stay under the manifest's directory.
- `--sizing snapshot|responsive`: measured sizes by default; optional explicit HUG/FILL conversion. Responsive inference is limited to authored flex layouts.
- `--version ID`: select a live file version.
- `--node-id ID`, `--file-key KEY`: identify offline data when metadata is missing.
- `--template PATH`: meta object, empty body, optional explicitly authored behavior object.
- `--strict`: still writes the bundle, then exits 2 if diagnostics require review.

Exit 0 = export completed, **not** visual correctness. Exit 1 = invalid configuration, fetch failure, schema failure or existing output directory. Exit 2 = strict-mode review items.

## What improved in v0.2

- Separate full-fidelity source preservation from component compilation.
- Explicit nested slot and content selectors; ambiguous matches are diagnosed.
- Standalone font/color/line-height/letter-spacing and mixed text runs.
- Simple solid fills, divider strokes, corner radii and shadows.
- Local hashed assets, version-pinned render requests, credential-free CDN downloads.
- Non-wrapping negative gaps converted to sibling margins, with original values preserved.
- Optional authored HUG/FILL sizing and external renderer-schema checks.
- Synthetic examples, regression tests, CI, and upstream attribution.

## Limits and feedback

Read [supported behavior and limits](docs/LIMITS.md) before treating YAML as a faithful rendering. Unknown token names, arbitrary masks/gradients, wrapped overlaps and runtime behavior are not guessed. Named icons, component gates and library slot names require reviewed mapping rules.

For a useful first test, export one Auto Layout screen, inspect `diagnostics.json`, then check a text layer, a divider, a component's nested content, and an image against Figma. Share the command, Node version, diagnostic codes and a **sanitized** example of expected versus actual YAML. Exported designs and tokens stay local; do not commit them to this public repository.

## Development

```sh
npm ci
npm test
npm audit
```

MIT. See [third-party notices](THIRD-PARTY-NOTICES.md) for actual adapted code and references. No upstream MCP/browser runtime is included.
