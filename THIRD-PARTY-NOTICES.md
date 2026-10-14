# Third-party code and references

## Adapted code: TemPad Dev (MIT)

Upstream: https://github.com/ecomfe/tempad-dev

Pinned source: `1588e3e6a9832e22e50d43b7c0859afcabbcc6e9`

- `src/visuals.mjs` `resizingStyle`: adapted explicit sizing rules from `packages/extension/mcp/tools/code/styles/layout.ts` (`inferResizingStyles`). Ported to REST nodes and camelCase style objects; no caches/browser API dependencies, and no inferred Auto Layout.
- `src/negative-gap.mjs`: adapted negative-gap-to-margin approach and numeric CSS helpers from `packages/extension/mcp/tools/code/sanitize/negative-gap.ts`. Narrowed to non-wrapping main-axis flow, skipping hidden/absolute children; no padding compensation is needed because the first flow child does not receive a negative margin.

Copyright (c) 2024-Present Baidu EFE team. Full license: [licenses/tempad-dev-MIT.txt](licenses/tempad-dev-MIT.txt).

TemPad's collection, text and asset modules additionally informed our design. Our REST text segmentation, network asset adapter and fact extraction are new implementations; they are not copies of its complete pipeline. Its browser extension, private compatibility adapter and MCP server are **not** shipped.

## Reviewed references, not bundled code

- [Figma Console](https://github.com/southleft/figma-console-mcp/tree/7f0d8bfe633b08514413c7da18ec315375d2f092): recursive extraction and component identity/reference concepts. The implementation here preserves the raw REST tree rather than copying its lossy deep extractor.
- [Figma Code Snippet Editor](https://github.com/figma/code-snippet-editor-plugin/tree/ece47d8ccfa0f6ab6704ceab2cae11b8dc7d7c09): typed component properties, template inheritance and instance-swap resolution concepts. Our registry uses typed objects and explicit actual-instance selectors, not its string template engine.
- [TalkToFigma](https://github.com/grab/cursor-talk-to-figma-mcp/tree/ddd90f3a6d454ea0b2fc29f1b084f50fd062b880) and [Figma Measure](https://github.com/ph1p/figma-measure/tree/5d526939073bbe0c10234ac86ad05a933828c769): reviewed; no code included.

Runtime dependencies are `yaml` (ISC) and `ajv` (MIT), pinned in package-lock.json and distributed with their own package licenses through npm.
