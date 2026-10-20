/**
 * Figma main-thread code. It never renders: the UI iframe renders the texture
 * with the shared engine and sends PNG bytes, which are inserted here using
 * the documented image APIs. Inserted nodes are ordinary image-filled shapes.
 */
import { PLUGIN_DATA_KEY, type PluginToUi, type RecipeReference, type SelectionInfo, type UiToPlugin } from './messages';

figma.showUI(__html__, { width: 380, height: 640, themeColors: true });

function post(message: PluginToUi): void {
  figma.ui.postMessage(message);
}

type FillableNode = SceneNode & MinimalFillsMixin;

function isFillable(node: SceneNode): node is FillableNode {
  return 'fills' in node && node.fills !== figma.mixed && node.type !== 'TEXT';
}

function readReference(node: SceneNode): RecipeReference | null {
  try {
    const raw = node.getPluginData(PLUGIN_DATA_KEY);
    return raw ? (JSON.parse(raw) as RecipeReference) : null;
  } catch {
    return null;
  }
}

function selectionInfo(): SelectionInfo {
  const selection = figma.currentPage.selection;
  const only = selection.length === 1 ? selection[0] : undefined;
  return {
    count: selection.length,
    fillable: selection.filter(isFillable).length,
    reference: only ? readReference(only) : null,
  };
}

figma.on('selectionchange', () => post({ type: 'selection', info: selectionInfo() }));

figma.ui.onmessage = (message: UiToPlugin) => {
  if (message.type === 'ready') {
    post({ type: 'selection', info: selectionInfo() });
    return;
  }
  if (message.type === 'close') {
    figma.closePlugin();
    return;
  }
  if (message.type !== 'insert') return;

  try {
    const image = figma.createImage(message.bytes);
    const paint: ImagePaint = { type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' };
    const reference = JSON.stringify(message.reference);

    if (message.mode === 'fill') {
      // Only replace fills on the selected shapes the user chose to fill.
      const targets = figma.currentPage.selection.filter(isFillable);
      if (targets.length === 0) {
        post({ type: 'insert-error', message: 'Select a shape or frame that can take a fill, or insert as a new object.' });
        return;
      }
      for (const node of targets) {
        node.fills = [paint];
        node.setPluginData(PLUGIN_DATA_KEY, reference);
      }
      post({ type: 'inserted', mode: 'fill', count: targets.length });
      figma.notify(`Filled ${targets.length} layer${targets.length === 1 ? '' : 's'} with a rendered texture image`);
      return;
    }

    const rect = figma.createRectangle();
    rect.name = `${message.name} · texture`;
    rect.resize(message.width, message.height);
    rect.fills = [paint];
    rect.setPluginData(PLUGIN_DATA_KEY, reference);
    const center = figma.viewport.center;
    rect.x = Math.round(center.x - message.width / 2);
    rect.y = Math.round(center.y - message.height / 2);
    figma.currentPage.appendChild(rect);
    figma.currentPage.selection = [rect];
    figma.viewport.scrollAndZoomIntoView([rect]);
    post({ type: 'inserted', mode: 'new', count: 1 });
    figma.notify('Inserted a rectangle filled with the rendered texture image');
  } catch (error) {
    post({ type: 'insert-error', message: error instanceof Error ? error.message : String(error) });
  }
};
