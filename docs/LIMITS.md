# Scope and limits

## Preservation versus compilation

`raw.figma.json` preserves the response. `facts.json` traverses every selected descendant, without stripping zero/false/hidden values or stopping at known components. This means **all supplied fields are retained**, not that every Figma field has a renderer translation.

`screen.yaml` is a draft in the included interchange grammar. `measurements.*` describes the nodes compiled for outer layout; for component internals or rasterized subtrees, use facts. Actual renderer compatibility requires `--schema` and a render comparison. Passing our schema does not establish either visual or behavioral parity.

## Supported conversions

- Authored Auto Layout padding, gaps, alignment, wrapping, available grid tracks/cell placement.
- Parent-local transforms, positions and overlap measurements where the source provides sufficient geometry.
- Simple solid paints and strokes; basic divider lines, radius and shadows.
- Base typography and REST character-style overrides represented as inherited styles and inline run boxes.
- Component keys/variants and explicit typed props/content/nested slot rules.
- PNG rendered-node assets and optional frame reference, with local asset paths/hashes.
- Non-wrapped negative main-axis gaps as sibling margins; optional explicit flex HUG/FILL rules.

## Still needs review

- **No universal component registry:** every library has its own aliases, presets, slot gates, props and defaults. Mapping configuration is required for semantic components.
- **Tokens:** original variable bindings remain in facts. No token-name catalog or mode resolution is fetched. Literal CSS values are used where available, not guessed token names.
- **Text:** no guarantee of installed fonts, baseline parity, exact paragraph/list layout, vertical alignment, text-on-path, or browser line breaks. Hyperlinks stay in facts; navigation is not synthesized. A renderer must support inline styled boxes for mixed text.
- **Visual effects:** arbitrary gradients/multiple paints, masks, arbitrary stroke dashes, blend modes and advanced effects are not fully compiled. Some have explicit diagnostics; raw properties always remain available. Diagnostics are not an exhaustive proof of coverage.
- **Assets:** PNGs are baked node renders, not editable icon components or original image fills. Rotated/transformed assets need a visual check because rasterization may bake transforms. Rasterized subtrees are not duplicated as children. A PNG is not a semantic component replacement.
- **URLs:** CSS `backgroundImage` paths are relative to the exported bundle. Your renderer must serve the bundle assets at that base or rewrite those URLs. `$image` slot paths likewise need renderer asset resolution.
- **Responsive behavior:** snapshot is the default. Optional responsive conversion does not infer breakpoints, arbitrary grid stretch behavior or component-specific sizing props.
- **Pinning and behavior:** fixed/sticky facts are preserved and diagnosed, but `pinned` is not inferred. A template can supply a behavior object unchanged; handler names, state and business logic are not validated by this tool.
- **Large/partial data:** missing fields in bare node exports remain unknown. There is no arbitrary API depth cap, but extremely deep trees can exceed JavaScript recursion limits. Rate limits may require retrying later. Hidden/empty assets may not render.

## Verification status

The test suite covers synthetic snapshots, recursive slot mappings, missing/ambiguous data, text/style preservation, geometry, offline replay, mocked network behavior and local assets. CI runs the same suite and an offline demo across Node versions.

No live Figma account or target renderer was used to establish this release's visual fidelity. Start with one real screen and compare before treating generated YAML as production-ready.
