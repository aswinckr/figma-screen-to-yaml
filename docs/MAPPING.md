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
- `childIndex`: zero-based index within the immediate parent. Combine with name/type/path when identically named siblings have different roles. This is an explicit authored-order rule, not a guess based on their text.

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

## Structured props and local image props

`propBindings` builds arrays/objects such as product-list items. Literal values keep their types; expressions read the actual instance, not its library defaults:

```json
{
  "failClosed": true,
  "propBindings": {
    "items": [{
      "id": {"$source": {"field": "id"}},
      "name": {"$source": {"selector": {"name": "Title", "type": "TEXT"}, "field": "characters"}},
      "imageSrc": {"$source": {"selector": {"name": "Photo content"}, "asset": true}},
      "featured": {"$source": {"selector": {"name": "Featured indicator"}, "exists": true}}
    }]
  }
}
```

A `$source` expression has exactly one read mode: `field` (`characters`, `id`, or explicit `name`), `property` (exact property name), `asset:true` (local `{$asset:path}`), or `exists:true` (visible matches become a boolean). Without a selector, it reads the current instance. INSTANCE_SWAP properties cannot supply actual overridden content.

Use `values` for an explicit typed value lookup, or `all:true` for an ordered array. `join:" "` explicitly joins an all-string array. Missing/ambiguous required values produce diagnostics; they do not choose the first match. `optional:true` omits an unresolved bound prop without a missing-match warning; do not use it for required content. An unresolved nested value causes its entire bound prop to be omitted, not a malformed partial item.

`{$each:{selector:{...},value:{label:{$source:{field:"characters"}}}}` builds one structured value per visible match in authored order. Inside `value`, the selected node becomes the current scope. This is useful for lists but does **not** prove that labels are the entire component configuration: inspect icons, selection, badges and other slots too.

With `failClosed:true`, any mapping-resolution diagnostic other than the general content-review reminder retains the generic source subtree instead of collapsing it into an incomplete component. This includes missing assets; a live export plans those assets and recompiles after downloading them. Unknown configuration syntax remains an error. This guard catches failed rules, **not content for which no rule was written**.

`measurements.json.componentReads` records component node, actual source node, source field, and output destination for successful mappings. It is provenance, not proof that a target renderer supports the props or reproduces the design. Keep explicit review warnings until the full component content and renderer contract have been checked.

For a photo prop, select the photo composition, not a whole component containing buttons/text/borders. Leaf-image bytes alone may lose authored crops/positioning; rendering the entire thumbnail may bake in a border the component draws again. Inspect the subtree and choose the intended content boundary.

## Offline replay

```sh
npm run export-screen -- --input exports/first/raw.figma.json \
  --mapping exports/my-components.json --asset-manifest exports/first/assets.json \
  --out exports/second
```

Same snapshot, mappings, template, assets and options produce the same semantic output. No model samples or timestamps are involved. Additional mappings may require assets absent from the first bundle; run a new live export to fetch those nodes.
