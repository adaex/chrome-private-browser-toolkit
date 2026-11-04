import {
  readBackupDetails,
  readBackupSummary,
  type BackupSummary,
} from './worker/backup.js';
import { isValidProxyPort, loadProxyPort, saveProxyPort } from './worker/proxy.js';
import { Queue } from './worker/queue.js';
import { loadFeatureSettings, saveFeatureSettings } from './worker/settings.js';
import { showStatus, startProxyStatusIconSync } from './ui.js';

const deduplicate = document.querySelector<HTMLInputElement>('#deduplicate')!;
const fullscreen = document.querySelector<HTMLInputElement>('#fullscreen')!;
const featureStatus = document.querySelector<HTMLParagraphElement>('#feature-status')!;
const proxyForm = document.querySelector<HTMLFormElement>('#proxy-form')!;
const proxyPort = document.querySelector<HTMLInputElement>('#proxy-port')!;
const proxySave = document.querySelector<HTMLButtonElement>('#proxy-save')!;
const proxyStatus = document.querySelector<HTMLParagraphElement>('#proxy-status')!;
const proxyStatusIcon = document.querySelector<HTMLImageElement>('#proxy-status-icon')!;
const backupStatus = document.querySelector<HTMLParagraphElement>('#backup-status')!;
const backupDetails = document.querySelector<HTMLDetailsElement>('#backup-details')!;
const backupOutput = document.querySelector<HTMLPreElement>('#backup-output')!;
const exportButton = document.querySelector<HTMLButtonElement>('#export')!;

let settingsChangeVersion = 0;
let proxyPortEdited = false;
const settingsSaveQueue = new Queue(1);
const inIncognitoContext = chrome.extension?.inIncognitoContext === true;

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
let backupJson: string | null = null;
let backupOutputDirty = true;

function backupSummaryMessage(summary: BackupSummary) {
  if (summary.hasLegacyBackup) {
    return '已读取备份（含旧版数据）；迁移完成后请刷新查看计数';
  }
  return `已读取 ${summary.activeCount} 份组快照、${summary.archivedCount} 条历史归档`;
}

// 打开设置页只按键名统计，避免为折叠的备份面板读取并格式化全部历史归档
async function loadBackupSummary() {
  const version = ++backupLoadVersion;
  showStatus(backupStatus, '正在读取…');
  exportButton.disabled = true;
  try {
    const summary = await readBackupSummary();
    if (version !== backupLoadVersion) return;
    showStatus(backupStatus, backupSummaryMessage(summary));
    exportButton.disabled = false;
  } catch (error) {
    if (version !== backupLoadVersion) return;
    showStatus(backupStatus, '读取备份失败，请重试', true);
    console.error(error);
  }
}

async function loadBackups(): Promise<string | null> {
  const version = ++backupLoadVersion;
  showStatus(backupStatus, '正在读取…');
  exportButton.disabled = true;
  try {
    const { entries, summary } = await readBackupDetails();
    if (version !== backupLoadVersion) return null;
    const json = JSON.stringify(entries, null, 2);
    backupJson = json;
    if (backupDetails.open) {
      backupOutput.textContent = json;
      backupOutputDirty = false;
    } else {
      backupOutputDirty = true;
    }
    showStatus(backupStatus, backupSummaryMessage(summary));
    exportButton.disabled = false;
    return json;
  } catch (error) {
    if (version !== backupLoadVersion) return null;
    showStatus(backupStatus, '读取备份失败，请重试', true);
    exportButton.disabled = backupJson === null;
    console.error(error);
    return null;
  }
}

document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', () => {
  void loadBackups();
});
backupDetails.addEventListener('toggle', () => {
  if (!backupDetails.open) return;
  if (backupJson === null) void loadBackups();
  else if (backupOutputDirty) {
    backupOutput.textContent = backupJson;
    backupOutputDirty = false;
  }
});
exportButton.addEventListener('click', async () => {
  const json = backupJson ?? (await loadBackups());
  if (json === null) return;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-group-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function initialize() {
  const backupsReady = loadBackupSummary();
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

startProxyStatusIconSync(proxyStatusIcon);
initialize();
