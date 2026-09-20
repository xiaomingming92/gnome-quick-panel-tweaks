// 图标池定义：纯数据，extension.js / prefs.js 共用（不要在这里 import shell 模块，prefs 进程会加载不到）

export const GROUPS = [
    ['system', '系统 / 会话'],
    ['settings', '设置入口'],
    ['toggles', '一键开关'],
    ['apps', '常用应用'],
];

export const POOL = [
    // 系统 / 会话
    {id: 'record', label: '录屏', icon: 'record-screen-symbolic', group: 'system'},
    {id: 'screenshot', label: '截图', icon: 'screenshooter-symbolic', group: 'system'},
    {id: 'lock', label: '锁屏', icon: 'system-lock-screen-symbolic', group: 'system'},
    {id: 'logout', label: '注销', icon: 'system-log-out-symbolic', group: 'system'},
    {id: 'suspend', label: '待机', icon: 'media-playback-pause-symbolic', group: 'system'},
    {id: 'restart', label: '重启', icon: 'system-reboot-symbolic', group: 'system'},
    {id: 'shutdown', label: '关机', icon: 'system-shutdown-symbolic', group: 'system'},
    // 设置入口
    {id: 'settings', label: '设置', icon: 'preferences-system-symbolic', group: 'settings'},
    {id: 'powerpanel', label: '电源设置', icon: 'battery-symbolic', group: 'settings'},
    {id: 'networkpanel', label: '网络设置', icon: 'network-wireless-symbolic', group: 'settings'},
    {id: 'bluetoothpanel', label: '蓝牙设置', icon: 'bluetooth-symbolic', group: 'settings'},
    {id: 'soundpanel', label: '声音设置', icon: 'audio-volume-high-symbolic', group: 'settings'},
    {id: 'a11ypanel', label: '辅助功能', icon: 'preferences-desktop-accessibility-symbolic', group: 'settings'},
    // 一键开关
    {id: 'dnd', label: '勿扰', icon: 'notifications-disabled-symbolic', group: 'toggles'},
    {id: 'nightlight', label: '夜灯', icon: 'night-light-symbolic', group: 'toggles'},
    {id: 'darkmode', label: '深色模式', icon: 'weather-clear-night-symbolic', group: 'toggles'},
    {id: 'mute', label: '静音', icon: 'audio-volume-muted-symbolic', group: 'toggles'},
    // 常用应用
    {id: 'terminal', label: '终端', icon: 'org.gnome.Terminal', group: 'apps'},
    {id: 'files', label: '文件', icon: 'org.gnome.Nautilus', group: 'apps'},
    {id: 'browser', label: '浏览器', icon: 'google-chrome', group: 'apps'},
    {id: 'vscode', label: 'VS Code', icon: 'vscode', group: 'apps'},
];

export function poolById(id) {
    return POOL.find(p => p.id === id) ?? null;
}
