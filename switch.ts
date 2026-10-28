import { requestExternalProxyMode } from './worker/proxy.js';
import { showStatus } from './ui.js';

const statusText = document.querySelector<HTMLParagraphElement>('#proxy-status')!;

async function closeCurrentTab() {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) await chrome.tabs.remove(tab.id);
}

async function run() {
  const mode = new URLSearchParams(location.search).get('mode');
  if (mode !== 'direct' && mode !== 'socks5') {
    showStatus(statusText,'无效指令：请使用 ?mode=direct 或 ?mode=socks5', true);
    return;
  }

  const label = mode === 'direct' ? '直连' : '本机 SOCKS5';
  showStatus(statusText,`正在切换为${label}…`);
  try {
    if (!await requestExternalProxyMode(mode)) {
      showStatus(statusText,'代理由其他扩展控制，请先停用它', true);
      return;
    }
  } catch (error) {
    console.error(error);
    showStatus(statusText,'切换失败，请检查代理控制状态后重试', true);
    return;
  }

  showStatus(statusText,`已切换为${label}`);
  try {
    await closeCurrentTab();
  } catch (error) {
    console.error(error);
  }
}

void run();
