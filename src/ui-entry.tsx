/**
 * UI bootstrap: load library styles first, then render Plugin so UI is never blank.
 */
import '!@create-figma-plugin/ui/css/base.css';
import { render } from '@create-figma-plugin/ui';
import { Plugin } from './ui-app';

const renderPlugin = render(Plugin);

function bootstrap() {
  const root = document.getElementById('create-figma-plugin');
  if (!root) return;
  // Force initial render so Scan Settings show immediately (no blank screen)
  try {
    renderPlugin(root, {});
  } catch (err) {
    console.error('Plugin render error:', err);
    root.innerHTML = '<p style="padding:12px;color:red;">Failed to load UI. Check console.</p>';
    return;
  }
  parent.postMessage({ pluginMessage: { type: 'UI_READY' } }, '*');
  window.onmessage = function (e: MessageEvent) {
    const m = e.data?.pluginMessage;
    if (m?.type === 'INIT') {
      try {
        renderPlugin(root, m.data || {});
      } catch (err) {
        console.error('Plugin render error:', err);
      }
    }
  };
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
}

export default renderPlugin;
