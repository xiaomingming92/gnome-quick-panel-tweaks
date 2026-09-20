// 配置读写：extension.js 与 prefs.js 共用；prefs 改完写文件，扩展用文件监视即时生效
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export const UUID = 'quick-panel-tweaks@xiaomingming92.github.io';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_user_config_dir(), UUID]);
export const CONFIG_PATH = GLib.build_filenamev([CONFIG_DIR, 'config.json']);

export const DEFAULT_CONFIG = {
    // 系统栏右侧显示的图标（按顺序，最多 maxRight 个）
    rightIcons: ['record', 'screenshot', 'settings', 'lock', 'shutdown'],
    maxRight: 5,
    // 左侧电池按钮左键行为：'cycle' 循环 性能/平衡/节能；'panel' 打开电源设置
    batteryClick: 'cycle',
    // 自定义按钮：{id, label, icon, command}
    custom: [],
};

function readJson(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        logError(e, `quick-panel-tweaks: 读取失败 ${path}`);
        return null;
    }
}

export function loadConfig() {
    const cfg = readJson(CONFIG_PATH) ?? {};
    return {
        rightIcons: cfg.rightIcons ?? [...DEFAULT_CONFIG.rightIcons],
        maxRight: cfg.maxRight ?? DEFAULT_CONFIG.maxRight,
        batteryClick: cfg.batteryClick ?? DEFAULT_CONFIG.batteryClick,
        custom: cfg.custom ?? [],
    };
}

export function saveConfig(cfg) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    GLib.file_set_contents(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function watchConfig(callback) {
    GLib.mkdir_with_parents(CONFIG_DIR, 0o755);
    const file = Gio.File.new_for_path(CONFIG_PATH);
    const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
    const id = monitor.connect('changed', (_m, _f, _o, event) => {
        if (event === Gio.FileMonitorEvent.CHANGED ||
            event === Gio.FileMonitorEvent.CREATED ||
            event === Gio.FileMonitorEvent.CHANGES_DONE_HINT)
            callback();
    });
    return {monitor, id};
}
