# Component mapping

Mappings are explicit, deterministic rules. A recognized component's internal layout is not duplicated. Its entire source subtree still appears in `facts.json`.

Use `componentKey` or `componentSetKey` for reusable library identity. `componentId` and `nodeId` require `fileKey` because node IDs are file-scoped. Names alone are not component identities. `when` matches exact Figma property names and typed values to select variants; multiple matches are an error.

```json
{
  "version": 1,
  "entries": [{
    "match": {"componentKey": "YOUR_COMPONENT_KEY"},
    "target": "product",
    "preset": "product",
    "props": {"hasPriceSlot": true},
    "propertyRules": [{"from": "Disabled#11:1", "to": "props.disabled"}],
    "contentRules": [{"selector": {"property": "Title#4"}, "to": "text"}],
    "slotRules": {
      "price": {"selector": {"componentKey": "YOUR_PRICE_KEY"}, "kind": "component"},
      "photo": {"selector": {"name": "Photo"}, "kind": "image", "alt": ""}
    }
  }]
}
```

The price needs its own mapping entry. Its **actual descendant instance** supplies its overridden props, not the main component's defaults. An `INSTANCE_SWAP` property is an ID, not a ready-to-use nested component: use a selector to find the instance occupying that slot.

## Properties

`propertyRules`: `from` is an exact Figma property name including its ID suffix. `to` is `text` or `props.NAME`. `values` can explicitly map values, e.g. `{"Small":"small","Large":"large"}`. Without `values`, boolean false, zero, null and strings retain their types. Swaps without an explicit values map are diagnosed instead of copied as meaningless IDs.

`props` may contain fixed, reviewed gate props/default overrides. `slots` may contain fixed marker values. These are your declarations, not inferred facts.

## Content and slot selectors

A selector may combine these exact-match fields:

- `property`: value in the node's `componentPropertyReferences`, e.g. `characters` or `mainComponent` reference.
- `componentKey`: descendant instance's main-component key.
- `nodeId`: exact instance descendant ID; useful for one screen, not cross-screen reuse.
- `name`: exact layer name; brittle if designers rename it.
- `type`: Figma node type.
- `path`: array of exact layer names from the mapped instance's immediate child to the target.

All supplied criteria must match. Hidden nodes and their hidden subtrees are excluded from slot selection, but retained in facts. A selector matching multiple nodes emits `AMBIGUOUS_SELECTOR` unless `all:true` explicitly requests a list in authored traversal order.

`contentRules` reads `characters` by default. `field:"name"` is only used when you explicitly request a layer name. For `all:true`, values become an array and must target a prop, not `text`.

`slotRules` supports:

- `kind:"component"`: recursively mapped `$component` content.
- `kind:"text"`: `$text` containing exact characters.
- `kind:"image"`: `$image` pointing to a locally exported asset.
- `optional:true`: no warning when no visible node matches.
- `when:{"Figma property":value}`: only populate this slot for matching parent properties.
- `all:true`: populate a slot with a list.

These rules do not infer slot semantics from arbitrary layer names. Figma SLOT nodes may be selected by path/type/reference, but a generic slot-container-to-library-slot translation is not automatic.

Review the actual populated content, then set `contentReviewed:true` to acknowledge that unused internal layers are implementation detail. Until then, `COMPONENT_CONTENT_REVIEW` reminds you the mapping may omit content. This flag does not prove visual correctness.

## Offline replay

```sh
npm run export-screen -- --input exports/first/raw.figma.json \
  --mapping exports/my-components.json --asset-manifest exports/first/assets.json \
  --out exports/second
```

Same snapshot, mappings, template, assets and options produce the same semantic output. No model samples or timestamps are involved. Additional mappings may require assets absent from the first bundle; run a new live export to fetch those nodes.
