# Full design QA export · v0.4.0

## One fresh test

```sh
npm ci
npm run export-screen -- "YOUR_FIGMA_FRAME_LINK" --profile qa --reference --out exports/qa-review-1
npm run validate -- exports/qa-review-1/screen.yaml
```

Use a new folder. Send that complete output folder as a ZIP for review, excluding
`.env` (it lives in the project, not the output). `--profile qa` is the full QA
profile; `spacing` remains a narrower layout-only compatibility profile; `render`
is still the default rendering draft. QA is a new schema, not a drop-in replacement
for the old `body/box/children` renderer or the external `yaml_layout.cjs` reader.

## Contract: preserve evidence, never invent coverage

QA YAML preserves **every property supplied on every node in the selected Figma
subtree**, including unknown future fields. Before writing it, the exporter
rehydrates the records and verifies exact structural equality with the source
tree. That checks strings, numbers, null, false, zero, empty collections, child
order, IDs, hidden nodes and all nested properties. Source values are not rounded.

This is source preservation, **not proof that all desired information exists in
Figma or that an Android comparison has passed**. Unfetched variants/screens,
absent annotations, API omissions and denied variables cannot be invented.
`coverage` enumerates required domains and explicit limitations. `--strict`
currently exits 2 for QA because runtime accessibility evidence remains required;
output is still written. Normal exit 0 means export succeeded, not QA passed.

### Layout and geometry

All supplied positions, local transforms, dimensions, constraints, min/max bounds,
HUG/FILL rules, auto-layout/grid settings, padding/gaps, clipping, scrolling,
mask and overlap information survive. `effectiveLayout.mainAxisGap` is zero for
`SPACE_BETWEEN`; the original inactive `itemSpacing` is retained in properties.
Do not add that stale authored gap to distributed spacing. Snapshot positions
are Figma coordinates; normalize density and platform/system insets separately
before comparing with Android. The spacing/render profiles also receive this fix.

### Typography

Original `style`, `characters`, `characterStyleOverrides`, `styleOverrideTable`,
paragraph/list/line information, text sizing and truncation fields survive. This
includes exact units, font style, mixed-format runs, fills and hyperlinks wherever
supplied. Do not flatten rich text to a single font. A missing field is not proof
of a default. Text-style IDs resolve via the source style catalog, separately
from variable tokens. Fonts and actual baseline/font rendering need runtime
verification; this tool does not download font binaries.

### Components, configurations and icons

Component and set IDs, keys, names, remote flags and catalog metadata are retained.
So are structured `componentProperties`, definitions, overrides, property references,
instance swaps and nested content. A mapped component never hides its descendants
in QA. User-supplied mappings and their evaluated props/slots are separate,
explicitly labelled evidence; missing selectors/assets get diagnostics.

Icons retain actual component identity, vector paths/network when provided,
transforms, fills, strokes, image hashes and export settings. An icon-looking
layer is not automatically assigned a code token. Use reviewed identity mappings
and inspect unresolved records. Geometry paths absent from a bare snapshot cannot
be reconstructed; live file reads request geometry. Frame PNGs are reference
pixels, not substitutes for editable vectors or original source image bytes.

### Appearance, strokes and corners

Preserve all supplied paints (including disabled paints), gradients, image crop
transforms, opacity, blend modes, shadows/effects, stroke types and visibility,
per-side thickness, alignment, exact dash sequences, caps/joins, variable-width
stroke data, per-corner radii and smoothing. `strokeWeight: 1` alone does NOT prove
there is a visible stroke: check the strokes array and each paint's visibility.
The full source model is retained rather than converted to approximate CSS borders.

### Tokens and styles

All `VARIABLE_ALIAS` bindings in source node properties are indexed, not only
spacing: colors, typography, corners, strokes, component properties and overrides
are included. `catalogs.tokenResolutions` stores shared resolutions with names,
keys, types, collections, modes, aliases and catalog values. The original property
values remain untouched. FLOAT, COLOR, STRING and BOOLEAN are supported.

Statuses: `resolved`, `mode-unverified` or `unresolved` with an explicit reason.
Here `resolved` means the catalog binding resolved; **it does not mean that value
matches the authored snapshot or Android implementation**. Compare those values
separately. Default mode selection is unverified when the selected frame's ancestor
mode is not available. Missing remote-library variables and alias targets stay
unresolved. There is no number-to-token-name guessing.

For live exports, Variables API lookup requires `file_variables:read` and Figma
account/file eligibility. HTTP status and a sanitized, explicitly reported cause
are saved on `VARIABLES_UNAVAILABLE`; a generic denial remains `undetermined`.
Raw error bodies and credentials are not included. `--tokens off` skips the lookup,
but preserves all binding IDs. Style names already in the file response can
resolve independently of Variables API access.

The Variables endpoint is current, not version-pinned. `variables.json` and the
manifest record catalog provenance. A saved catalog can be supplied using
`--variables PATH`; known file-key mismatch is rejected. The YAML contains the
provided variable catalog, including modes and any code syntax metadata Figma
supplied; names unavailable through that catalog remain unresolved.

### Accessibility and behavior

Authored annotations, descriptions, interactions and plugin data present in the
input are preserved. The exporter does not invent roles/labels from layer names,
or interpret arbitrary plugin data as verified accessibility semantics. Missing
annotations are `not-exposed`, not an accessibility pass. Plugin data not included
in the source request is not captured; use an appropriately permissioned export
that includes it when the design's accessibility specification lives in a plugin.

The downstream audit must obtain expected semantics from a design specification
and measure Android labels/content descriptions, roles, states, actions, traversal
and focus order, actual touch bounds, font scaling, clipping and TalkBack behavior.
Contrast requires text/paint opacity and actual composited backgrounds, not merely
two nominal colors. Source geometry, appearance and annotations enable these
checks; this exporter does not perform them. Device verification is still required.

## Read the compact data correctly

- `nodes`: active or visibility-unknown nodes in source traversal order.
- `hiddenNodes`: excluded-from-active-measurement evidence; not discarded. An
  ancestor-hidden descendant remains hidden even if its own `visible` is true.
- `id`, `name`, `type`, `parentId`, `childIndex`, `children`: source identity and
  hierarchy. `childrenPresent` distinguishes omitted children from an empty array.
- `properties`: inline source scalar values.
- `propertyRefs`: references into `catalogs.values` for shared complex/long values.
- `component`, `mapping`, `tokens`: references to their named catalog dictionaries.
- `styleBindings`: exact style IDs and resolution status; names in `catalogs.styles`.
- `coverage`: property counts, categories, uncategorized-but-retained properties,
  missing-field policy and checks requiring external evidence.

Use the supplied reader rather than treating an absent inline field as missing:

```js
import fs from 'node:fs';
import YAML from 'yaml';
import {readQANode, qaField, restoreQATree} from './src/qa.mjs';
const screen = YAML.parse(fs.readFileSync('exports/qa-review-1/screen.yaml', 'utf8'));
for (const node of screen.nodes) {
  const source = readQANode(screen, node); // All original non-child properties
  const strokes = qaField(screen, node, 'strokes');
  // captured / explicitly-absent / not-exposed; never a pass/fail verdict
}
const sourceTree = restoreQATree(screen); // Does not read facts.json
```

Shared dictionaries and shallow flow records reduce repetition, not coverage.
Full QA files may be larger than spacing-only files because hidden-state evidence,
vector geometry and all appearance/configuration data are included. No arbitrary
file-size target is allowed to delete useful source information.

## Replay and validation

```sh
npm run export-screen -- --input exports/qa-review-1/raw.figma.json \
  --profile qa --reference --asset-manifest exports/qa-review-1/assets.json \
  --out exports/qa-replay-1
```

Add `--variables exports/qa-review-1/variables.json` if it exists, and the same
`--mapping` if used originally. Replays need no network. Validation checks schema,
node identity/order, reachability, property/catalog references, binding coverage
and visibility partition. Generation additionally proves exact source-tree
reconstruction. The report consumer must support the QA schema and required
property types before marking comparison coverage complete.

Automated tests cover full-source reconstruction, hidden states, rich text,
styles, stroke/corner/paint evidence, configurations, mappings, general variable
aliases/types/modes, denied access, deterministic replay and `space-between`.
All published fixtures are synthetic; private supplied designs are not committed.
