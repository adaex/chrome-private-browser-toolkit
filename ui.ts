import { pageIconForProxyMode, proxyModeOf, readProxyStatus, type ProxyModeState } from './worker/proxy.js';

export function showStatus(element: HTMLElement, message: string, error = false) {
  element.textContent = message;
  element.classList.toggle('error', error);
}

export function setProxyStatusIcon(image: HTMLImageElement, mode: ProxyModeState) {
  const path = pageIconForProxyMode(mode);
  if (image.getAttribute('src') !== path) image.src = path;
}

// 启动读取一次，之后直接消费事件携带的配置；慢返回的启动结果不能覆盖新图标
export function startProxyStatusIconSync(image: HTMLImageElement) {
  let version = 0;
  const refresh = async () => {
    const currentVersion = ++version;
    try {
      const status = await readProxyStatus(false);
      if (currentVersion === version) setProxyStatusIcon(image, status.mode);
    } catch (error) {
      if (currentVersion === version) console.error(error);
    }
  };

  if (chrome.extension?.inIncognitoContext !== true) {
    chrome.proxy.settings.onChange.addListener(details => {
      version++;
      setProxyStatusIcon(image, proxyModeOf(details.value));
    });
    void refresh();
  }
}
