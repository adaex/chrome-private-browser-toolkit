import { ACTIVE_PREFIX, ARCHIVE_PREFIX, LEGACY_KEY } from './worker/backup.js';
import { isValidProxyPort, loadProxyPort, saveProxyPort } from './worker/proxy.js';
import { Queue } from './worker/queue.js';
import { loadFeatureSettings, saveFeatureSettings } from './worker/settings.js';

const deduplicate = document.querySelector<HTMLInputElement>('#deduplicate')!;
const fullscreen = document.querySelector<HTMLInputElement>('#fullscreen')!;
const featureStatus = document.querySelector<HTMLParagraphElement>('#feature-status')!;
const proxyForm = document.querySelector<HTMLFormElement>('#proxy-form')!;
const proxyPort = document.querySelector<HTMLInputElement>('#proxy-port')!;
const proxySave = document.querySelector<HTMLButtonElement>('#proxy-save')!;
const proxyStatus = document.querySelector<HTMLParagraphElement>('#proxy-status')!;
const backupStatus = document.querySelector<HTMLParagraphElement>('#backup-status')!;
const backupOutput = document.querySelector<HTMLPreElement>('#backup-output')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;

let settingsChangeVersion = 0;
let proxyPortEdited = false;
const settingsSaveQueue = new Queue(1);
const inIncognitoContext = chrome.extension?.inIncognitoContext === true;

function showStatus(element: HTMLElement, message: string, error = false) {
  element.textContent = message;
  element.classList.toggle('error', error);
}

if (inIncognitoContext) {
  proxyPort.disabled = true;
  proxySave.disabled = true;
  showStatus(proxyStatus, '请在普通窗口中修改代理端口');
}

function saveSettings() {
  const version = ++settingsChangeVersion;
  const settings = {
    deduplicate: deduplicate.checked,
    fullscreen: fullscreen.checked,
  };
  showStatus(featureStatus, '正在保存…');

  // 连续改动按顺序落盘，避免较早的写请求最后完成、把新开关状态覆盖掉
  settingsSaveQueue.run(async () => {
    try {
      await saveFeatureSettings(settings);
      if (version === settingsChangeVersion) showStatus(featureStatus, '已保存，更改立即生效');
    } catch (error) {
      if (version === settingsChangeVersion) showStatus(featureStatus, '保存失败，请重试', true);
      console.error(error);
    }
  });
}

deduplicate.addEventListener('change', saveSettings);
fullscreen.addEventListener('change', saveSettings);
proxyPort.addEventListener('input', () => {
  proxyPortEdited = true;
});

proxyForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (inIncognitoContext) {
    showStatus(proxyStatus, '请在普通窗口中修改代理端口');
    return;
  }
  const port = Number(proxyPort.value);
  if (!isValidProxyPort(port)) {
    showStatus(proxyStatus, '端口必须是 1–65535 之间的整数', true);
    return;
  }

  proxySave.disabled = true;
  showStatus(proxyStatus, '正在保存…');
  try {
    await saveProxyPort(port);
    showStatus(proxyStatus, '代理端口已保存');
  } catch (error) {
    showStatus(proxyStatus, '保存失败，请检查代理控制状态后重试', true);
    console.error(error);
  } finally {
    proxySave.disabled = inIncognitoContext;
  }
});

let backupLoadVersion = 0;

async function loadBackups() {
  const version = ++backupLoadVersion;
  showStatus(backupStatus, '正在读取…');
  exportButton.disabled = true;
  try {
    const stored = await chrome.storage.local.get(null);
    if (version !== backupLoadVersion) return;
    const entries = Object.entries(stored).filter(
      ([key]) => key.startsWith(ACTIVE_PREFIX) || key.startsWith(ARCHIVE_PREFIX) || key === LEGACY_KEY,
    );
    const activeCount = entries.filter(([key]) => key.startsWith(ACTIVE_PREFIX)).length;
    const archivedCount = entries.filter(([key]) => key.startsWith(ARCHIVE_PREFIX)).length;
    backupOutput.textContent = JSON.stringify(Object.fromEntries(entries), null, 2);
    showStatus(backupStatus, `当前标签组 ${activeCount} 个，历史归档 ${archivedCount} 条；按 JSON 中的网址手动重开即可恢复`);
    exportButton.disabled = false;
  } catch (error) {
    if (version !== backupLoadVersion) return;
    showStatus(backupStatus, '读取备份失败，请重试', true);
    console.error(error);
  }
}

document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', loadBackups);
exportButton.addEventListener('click', () => {
  const blob = new Blob([backupOutput.textContent ?? '{}'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-group-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function initialize() {
  const backupsReady = loadBackups();
  const [settingsResult, portResult] = await Promise.allSettled([loadFeatureSettings(), loadProxyPort()]);

  if (settingsResult.status === 'fulfilled') {
    // 页面初始化读取期间用户已经改过开关时，不用旧结果覆盖用户输入
    if (settingsChangeVersion === 0) {
      deduplicate.checked = settingsResult.value.deduplicate;
      fullscreen.checked = settingsResult.value.fullscreen;
    }
  } else {
    showStatus(featureStatus, '读取设置失败，请刷新页面重试', true);
    console.error(settingsResult.reason);
  }

  if (portResult.status === 'fulfilled') {
    if (!proxyPortEdited) proxyPort.value = String(portResult.value);
  } else {
    showStatus(proxyStatus, '读取代理端口失败，请刷新页面重试', true);
    console.error(portResult.reason);
  }

  await backupsReady;
}

initialize();
