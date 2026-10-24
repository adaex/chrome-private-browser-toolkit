export const LOCAL_PROXY_HOST = '127.0.0.1';
export const DEFAULT_PROXY_PORT = 7890;

const PROXY_PORT_KEY = 'proxyPort';

export type ProxyMode = 'direct' | 'socks5';
export type ProxyModeState = ProxyMode | 'other';

export interface ProxyStatus {
  mode: ProxyModeState;
  port: number;
  controlledByOther: boolean;
}

const ACTION_ICONS = {
  direct: {
    16: 'icon/icon_16.png',
    32: 'icon/icon_32.png',
    48: 'icon/icon_48.png',
  },
  socks5: {
    16: 'icon/socks5_16.png',
    32: 'icon/socks5_32.png',
    48: 'icon/socks5_48.png',
  },
  other: {
    16: 'icon/other_16.png',
    32: 'icon/other_32.png',
    48: 'icon/other_48.png',
  },
} as const;

export function isValidProxyPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function assertRegularProxyContext() {
  if (chrome.extension?.inIncognitoContext === true) {
    throw new Error('Proxy changes require a regular context');
  }
}

function proxyModeOf(value: chrome.proxy.ProxyConfig): ProxyModeState {
  if (value.mode === 'direct') return 'direct';
  const proxy = value.rules?.singleProxy;
  if (
    value.mode === 'fixed_servers' &&
    proxy?.scheme === 'socks5' &&
    proxy.host === LOCAL_PROXY_HOST
  ) {
    return 'socks5';
  }
  return 'other';
}

export async function loadProxyPort(): Promise<number> {
  const result = await chrome.storage.local.get(PROXY_PORT_KEY);
  const port = result[PROXY_PORT_KEY];
  return typeof port === 'number' && isValidProxyPort(port) ? port : DEFAULT_PROXY_PORT;
}

async function writeProxyMode(mode: ProxyMode, port: number): Promise<void> {
  const value: chrome.proxy.ProxyConfig = mode === 'direct'
    ? { mode: 'direct' }
    : {
        mode: 'fixed_servers',
        rules: {
          singleProxy: { scheme: 'socks5', host: LOCAL_PROXY_HOST, port },
        },
      };
  await chrome.proxy.settings.set({ value, scope: 'regular' });
}

export async function setProxyMode(mode: ProxyMode): Promise<void> {
  assertRegularProxyContext();
  const port = mode === 'socks5' ? await loadProxyPort() : DEFAULT_PROXY_PORT;
  await writeProxyMode(mode, port);
}

export async function saveProxyPort(port: number): Promise<void> {
  assertRegularProxyContext();
  if (!isValidProxyPort(port)) throw new Error('Invalid proxy port');

  const current = await chrome.proxy.settings.get({});
  if (current.levelOfControl !== 'controlled_by_other_extensions' && proxyModeOf(current.value) === 'socks5') {
    await writeProxyMode('socks5', port);
  }
  await chrome.storage.local.set({ [PROXY_PORT_KEY]: port });
}

export async function readProxyStatus(includeConfiguredPort = true): Promise<ProxyStatus> {
  const [current, configuredPort] = await Promise.all([
    chrome.proxy.settings.get({}),
    includeConfiguredPort ? loadProxyPort() : Promise.resolve(DEFAULT_PROXY_PORT),
  ]);
  const mode = proxyModeOf(current.value);
  const activePort = current.value.rules?.singleProxy?.port;
  return {
    mode,
    controlledByOther: current.levelOfControl === 'controlled_by_other_extensions',
    port: mode === 'socks5' && typeof activePort === 'number' && isValidProxyPort(activePort)
      ? activePort
      : configuredPort,
  };
}

let indicatorSyncVersion = 0;

export async function syncProxyIndicator(): Promise<void> {
  const syncVersion = ++indicatorSyncVersion;
  const status = await readProxyStatus(false);
  // 多次设置变化只让最后一次状态读取更新图标，避免慢请求回写旧状态
  if (syncVersion !== indicatorSyncVersion) return;
  const mode = status.mode === 'direct'
    ? '直连'
    : status.mode === 'socks5'
      ? `本机 SOCKS5 · ${LOCAL_PROXY_HOST}:${status.port}`
      : '其他代理模式';
  const controller = status.controlledByOther ? ' · 由其他扩展控制' : '';

  await Promise.all([
    chrome.action.setIcon({ path: ACTION_ICONS[status.mode] }),
    chrome.action.setTitle({ title: `Private Browser Toolkit\n当前：${mode}${controller}` }),
  ]);
}
