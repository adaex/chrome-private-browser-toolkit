import {
  LOCAL_PROXY_HOST,
  readProxyStatus,
  setProxyMode,
  type ProxyMode,
  type ProxyStatus,
} from './worker/proxy.js';
import { setProxyStatusIcon, showStatus } from './ui.js';

const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="proxy-mode"]'));
const statusText = document.querySelector<HTMLParagraphElement>('#proxy-status')!;
const socksEndpoint = document.querySelector<HTMLElement>('#socks-endpoint')!;
const statusIcon = document.querySelector<HTMLImageElement>('#proxy-status-icon')!;

let busy = true;
let blocked = false;
let proxyChangeVersion = 0;
let refreshInFlight: Promise<void> | null = null;
let refreshQueued = false;
let queuedErrorMessage: string | undefined;

function updateDisabled() {
  for (const input of modeInputs) input.disabled = busy || blocked;
}

function render(status: ProxyStatus) {
  blocked = status.controlledByOther;
  setProxyStatusIcon(statusIcon, status.mode);
  socksEndpoint.textContent = `${LOCAL_PROXY_HOST}:${status.port}`;

  for (const input of modeInputs) {
    const selected = input.value === status.mode;
    input.checked = selected;
  }
  updateDisabled();

  if (status.controlledByOther) {
    showStatus(statusText,'代理由其他扩展控制，请先停用它', true);
  } else if (status.mode === 'other') {
    showStatus(statusText,'当前是其他代理模式，选择一项即可替换');
  } else {
    showStatus(statusText,status.mode === 'direct' ? '当前：直连' : '当前：本机 SOCKS5');
  }
}

async function performRefresh(errorMessage?: string) {
  try {
    const status = await readProxyStatus();
    render(status);
    if (errorMessage) showStatus(statusText,errorMessage, true);
  } catch (error) {
    blocked = true;
    for (const input of modeInputs) {
      input.checked = false;
    }
    updateDisabled();
    showStatus(statusText,'读取代理状态失败，请重新打开弹窗', true);
    console.error(error);
  }
}

// 串行读取并合并事件；读取期间的新变化只补一次尾随刷新，不并发重复请求
async function refresh(errorMessage?: string) {
  if (refreshInFlight) {
    refreshQueued = true;
    queuedErrorMessage = errorMessage;
    return refreshInFlight;
  }

  refreshInFlight = performRefresh(errorMessage);
  try {
    await refreshInFlight;
  } finally {
    refreshInFlight = null;
    if (refreshQueued) {
      refreshQueued = false;
      const nextErrorMessage = queuedErrorMessage;
      queuedErrorMessage = undefined;
      await refresh(nextErrorMessage);
    }
  }
}

for (const input of modeInputs) {
  input.addEventListener('change', async () => {
    if (!input.checked || busy || blocked) return;
    const mode: ProxyMode = input.value === 'socks5' ? 'socks5' : 'direct';
    busy = true;
    updateDisabled();
    showStatus(statusText,'正在切换…');

    // 切换期间已收到变化事件时，事件刷新已经覆盖本次写入，不再重复读取
    const changeVersion = proxyChangeVersion;
    try {
      await setProxyMode(mode);
      if (proxyChangeVersion === changeVersion) await refresh();
    } catch (error) {
      console.error(error);
      await refresh('切换失败，请重试');
    } finally {
      busy = false;
      updateDisabled();
    }
  });
}

if (chrome.extension.inIncognitoContext) {
  busy = false;
  blocked = true;
  updateDisabled();
  showStatus(statusText,'请在普通窗口中切换代理');
} else {
  chrome.proxy.settings.onChange.addListener(() => {
    proxyChangeVersion++;
    void refresh();
  });
  refresh().finally(() => {
    busy = false;
    updateDisabled();
  });
}
