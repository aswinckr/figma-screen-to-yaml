# Spacing audit export · v0.3.0

## Generate the next file for review

```sh
npm ci
npm run export-screen -- "YOUR_FIGMA_FRAME_LINK" --profile spacing --reference --out exports/spacing-review-1
```

Use a new output directory for every run. Send `screen.yaml`, `diagnostics.json`,
and `reference.png` for review. Include `measurements.json` to cross-check geometry.
For reproducible debugging, retain `raw.figma.json`, `facts.json`, `manifest.json`,
and `variables.json` (if produced). Credentials are never included.

The default `--profile render` still emits the existing interchange-v2 screen
format. `--profile spacing` emits **spacing audit schema v1**, identified by
`meta.profile: spacing` and `meta.schemaVersion: 1`. It is a measurement input,
not a drop-in rendering document. Validate either with:

```sh
npm run validate -- exports/spacing-review-1/screen.yaml
```

## What changes in spacing mode

- Hidden nodes and descendants of hidden nodes are absent from audit YAML and
  its measurement ledger. The complete selected source remains in `facts.json`
  and `raw.figma.json`. Offscreen content is retained. Transparent nodes are
  retained because they can still occupy layout space.
- Every source box includes `source.nodeId`, `name`, `type`, `parentId`, original
  `childIndex` and effective `visible`. Names and text are separate; duplicate
  names are valid. Match with IDs/hierarchy/aliases, not names alone. IDs are
  file-scoped; `meta.figmaFileKey` supplies the file when known.
- Mapped components remain measurable trees, with component identity and an
  optional `mappedTarget` annotation. Component padding belongs to its own box,
  not a duplicate outer wrapper. Image downloads cannot replace child geometry.
- Dimensions, layout, padding, gaps, wrapping, alignment, positioning,
  transforms, clipping, relevant text metrics and source stroke rules remain.
  Backgrounds, gradients, shadows, decorative assets and synthetic rich-text
  rendering wrappers are omitted. This is not a universal 18-field whitelist.
- Only the frame reference is downloaded when `--reference` is requested. No
  per-icon/image downloads are needed for the audit. `--no-assets --reference`
  also works in render mode: skip individual assets, keep the reference.
- Diagnostics report excluded hidden-node count, retained node count, unknown
  visibility and actual YAML byte size. Smaller files are not a correctness
  guarantee; compare the supported visible geometry against the cross-check.

## Layout-reader contract

The main `meta → body → box/children` structure and numeric `layout.padding`
(top, right, bottom, left) / `layout.gap` remain. Text is in child `text` entries.
Sizes describe this fixed snapshot, not responsive design rules. Responsive
sizing is rejected in spacing mode.

Missing `style.position` means relative/in-flow placement. Box dimensions are
border-box measurements; no repeated `boxSizing` field is needed. Positions,
transforms, row/column gaps and margins retain the existing CSS-shaped fields.
`source.itemSpacing` retains an authored negative gap even where the existing
layout representation uses zero gap plus negative sibling margins. Strokes
are source geometry, not invented CSS borders; do not add their widths to
measured dimensions twice. Preserve distinctions between authored padding/gap
and resulting geometric distances (wrapping and space-between can differ).

An older reader that rejects metadata or assumes omitted CSS defaults must be
updated before using this profile. The external `yaml_layout.cjs` audit kit is
not included in this repository and has not been integration-tested here.
Its adapter must ignore non-layout metadata while respecting these defaults.
Unsupported masks, missing grid tracks, partial visibility and transformed
flow items remain explicit diagnostics. Never turn missing coverage into a
pass. `measurements.json` is a cross-check, not a substitute input for YAML
reconstruction.

## Token names without guessing

Spacing bindings are emitted in `box.spacingTokens`, keyed by the original
Figma property (`paddingLeft`, `itemSpacing`, etc.). Plain values stay numeric:

```yaml
layout:
  padding: [0, 0, 0, 12]
spacingTokens:
  paddingLeft:
    value: 12
    bindingId: VariableID:example
    name: spacing/st
    resolvedValue: 12
    status: resolved
```

This is an illustrative excerpt, not a complete node. The export also records
collection/mode identity and alias chains. The name comes from a binding ID,
never a lookup that assumes every numeric 12 uses the same token.

For live spacing exports, the tool automatically fetches the Variables API
only if visible nodes contain spacing bindings. The token needs
`file_variables:read` in addition to `file_content:read`, and the account must
be eligible for Figma's Variables REST API. Denial does not discard numeric
measurements: bindings stay `unresolved`, with `VARIABLES_UNAVAILABLE` and
`SPACING_TOKEN_REVIEW` diagnostics. Add `--tokens off` to skip the lookup.

Mode selection follows explicit/resolved modes exposed by a node and its
ancestors inside the selected subtree. If only the collection default is
known, the result is `mode-unverified`: an ancestor outside the selected frame
could have selected a different mode. Missing alias targets, cycles and absent
mode values stay unresolved. A catalog value different from the source number
is `value-mismatch`; it never overwrites the source number.

Figma's Variables endpoint returns **current** variables, not a version-pinned
catalog. `variables.json` and the run manifest record that provenance. For a
historical frame, a current token value is not evidence of its historical
binding value, even if its name resolves. Keep the original snapshot values.
Use a trusted saved catalog for offline review:

```sh
npm run export-screen -- --input exports/spacing-review-1/raw.figma.json \
  --profile spacing --variables exports/spacing-review-1/variables.json \
  --asset-manifest exports/spacing-review-1/assets.json --reference \
  --out exports/spacing-review-replay
```

Omit `--variables` if the original run could not obtain a catalog. A catalog
must use Figma's local-variables response shape (`meta.variables` and
`meta.variableCollections`, or those two objects directly). It maps actual
variable IDs, not numeric guesses. Exported catalogs carry file provenance;
a known mismatch with the snapshot's file key is rejected.

## Failure handling and verification

- Exit 0: output produced; inspect diagnostics. Not a visual-parity claim.
- Exit 1: invalid input/setup/schema or existing output directory.
- `--strict` exits 2 after saving output when review items remain.
- An explicitly requested but missing reference image gets
  `REFERENCE_NOT_EXPORTED`; it is never silently treated as a successful image
  capture. Offline exports need a local frame PNG in their asset manifest.
- Full facts survive filtering. The manifest hashes inputs, mappings, template,
  assets and the optional variable catalog. Offline replay is deterministic.

Tests cover pruning, component internals, image-independent geometry, duplicate
names, grids/wrapping/transforms, negative gaps, partial inputs, token modes and
aliases, denied API access, frame-only export and offline replay. Tests use
synthetic fixtures and mocked network responses; a fresh real-screen review is
still required. No size reduction from an unprovided design is claimed.
