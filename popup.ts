import {
  LOCAL_PROXY_HOST,
  readProxyStatus,
  setProxyMode,
  type ProxyMode,
  type ProxyStatus,
} from './worker/proxy.js';

const modeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="proxy-mode"]'));
const statusText = document.querySelector<HTMLParagraphElement>('#proxy-status')!;
const socksEndpoint = document.querySelector<HTMLElement>('#socks-endpoint')!;

let busy = true;
let blocked = false;

function updateDisabled() {
  for (const input of modeInputs) input.disabled = busy || blocked;
}

function showStatus(message: string, error = false) {
  statusText.textContent = message;
  statusText.classList.toggle('error', error);
}

function render(status: ProxyStatus) {
  blocked = status.controlledByOther;
  socksEndpoint.textContent = `${LOCAL_PROXY_HOST}:${status.port}`;

  for (const input of modeInputs) {
    const selected = input.value === status.mode;
    input.checked = selected;
  }
  updateDisabled();

  if (status.controlledByOther) {
    showStatus('代理由其他扩展控制，请先停用它', true);
  } else if (status.mode === 'other') {
    showStatus('当前是其他代理模式，选择一项即可替换');
  } else {
    showStatus(status.mode === 'direct' ? '当前：直连' : '当前：本机 SOCKS5');
  }
}

async function refresh(errorMessage?: string) {
  try {
    const status = await readProxyStatus();
    render(status);
    if (errorMessage) showStatus(errorMessage, true);
  } catch (error) {
    blocked = true;
    for (const input of modeInputs) {
      input.checked = false;
    }
    updateDisabled();
    showStatus('读取代理状态失败，请重新打开弹窗', true);
    console.error(error);
  }
}

for (const input of modeInputs) {
  input.addEventListener('change', async () => {
    if (!input.checked || busy || blocked) return;
    const mode: ProxyMode = input.value === 'socks5' ? 'socks5' : 'direct';
    busy = true;
    updateDisabled();
    showStatus('正在切换…');

    try {
      await setProxyMode(mode);
      await refresh();
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
  showStatus('请在普通窗口中切换代理');
} else {
  refresh().finally(() => {
    busy = false;
    updateDisabled();
  });
}
