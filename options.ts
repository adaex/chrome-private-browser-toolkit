import { ACTIVE_PREFIX, ARCHIVE_PREFIX, LEGACY_KEY } from './worker/backup.js';
import { loadFeatureSettings, saveFeatureSettings } from './worker/settings.js';

const deduplicate = document.querySelector<HTMLInputElement>('#deduplicate')!;
const fullscreen = document.querySelector<HTMLInputElement>('#fullscreen')!;
const featureStatus = document.querySelector<HTMLSpanElement>('#feature-status')!;
const backupStatus = document.querySelector<HTMLParagraphElement>('#backup-status')!;
const backupOutput = document.querySelector<HTMLPreElement>('#backup-output')!;

async function saveSettings() {
  featureStatus.textContent = '正在保存…';
  try {
    await saveFeatureSettings({
      deduplicate: deduplicate.checked,
      fullscreen: fullscreen.checked,
    });
    featureStatus.textContent = '已保存，更改立即生效';
  } catch (error) {
    featureStatus.textContent = '保存失败，请重试';
    console.error(error);
  }
}

deduplicate.addEventListener('change', saveSettings);
fullscreen.addEventListener('change', saveSettings);

async function loadBackups() {
  backupStatus.textContent = '正在读取…';
  try {
    const stored = await chrome.storage.local.get(null);
    const entries = Object.entries(stored).filter(
      ([key]) => key.startsWith(ACTIVE_PREFIX) || key.startsWith(ARCHIVE_PREFIX) || key === LEGACY_KEY,
    );
    const activeCount = entries.filter(([key]) => key.startsWith(ACTIVE_PREFIX)).length;
    const archivedCount = entries.filter(([key]) => key.startsWith(ARCHIVE_PREFIX)).length;
    backupOutput.textContent = JSON.stringify(Object.fromEntries(entries), null, 2);
    backupStatus.textContent = `当前标签组 ${activeCount} 个，历史归档 ${archivedCount} 条；按 JSON 中的网址手动重开即可恢复`;
  } catch (error) {
    backupStatus.textContent = '读取备份失败，请重试';
    console.error(error);
  }
}

document.querySelector<HTMLButtonElement>('#refresh')!.addEventListener('click', loadBackups);
document.querySelector<HTMLButtonElement>('#export')!.addEventListener('click', () => {
  const blob = new Blob([backupOutput.textContent ?? '{}'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `tab-group-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

async function initialize() {
  try {
    const settings = await loadFeatureSettings();
    deduplicate.checked = settings.deduplicate;
    fullscreen.checked = settings.fullscreen;
  } catch (error) {
    featureStatus.textContent = '读取设置失败，请刷新页面重试';
    console.error(error);
  }
  await loadBackups();
}

initialize();