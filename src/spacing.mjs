import {textStyle} from './visuals.mjs';

// Rendering paint is deliberately excluded. Keep text metrics and stroke geometry:
// both can affect spacing, even when the screenshot supplies all appearance.
export function spacingStyle(node) {
  const style = {};
  if (node.type === 'TEXT') {
    const metrics = textStyle(node.style || node);
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
      'letterSpacing', 'textAlign', 'textTransform']) {
      if (metrics[key] !== undefined) style[key] = metrics[key];
    }
    style.whiteSpace = 'pre-wrap';
  }
  return style;
}

export function auditSource(node, parent, index, visible, component, mapped) {
  const source = {
    nodeId: node.id, name: node.name || '', type: node.type,
    parentId: parent?.id ?? null, childIndex: index, visible,
  };
  if (node.type === 'INSTANCE') source.component = component;
  if (mapped) source.mappedTarget = mapped.target;
  // Source rules supplement CSS-shaped layout without turning paint into a border
  // or mistaking authored overlap for a zero gap.
  const fields = ['itemSpacing', 'strokesIncludedInLayout', 'strokeWeight', 'strokeAlign',
    'individualStrokeWeights', 'layoutSizingHorizontal', 'layoutSizingVertical',
    'layoutGrow', 'layoutAlign', 'layoutPositioning', 'scrollBehavior', 'overflowDirection'];
  for (const key of fields) if (Object.hasOwn(node, key)) source[key] = structuredClone(node[key]);
  return source;
}
