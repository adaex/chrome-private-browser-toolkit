export interface FeatureSettings {
  deduplicate: boolean;
  fullscreen: boolean;
}

const SETTINGS_KEY = 'featureSettings';

// 默认开启，保持升级前的行为；每次任务直接读存储，不增加 SW 设置缓存和同步状态
export async function loadFeatureSettings(): Promise<FeatureSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const value = result[SETTINGS_KEY] as Partial<FeatureSettings> | null | undefined;
  return {
    deduplicate: value?.deduplicate !== false,
    fullscreen: value?.fullscreen !== false,
  };
}

export function saveFeatureSettings(settings: FeatureSettings): Promise<void> {
  return chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
