// Quick Panel Tweaks —— 快捷面板底部系统栏自定义
//   · 左侧电池按钮：左键循环 性能/平衡/节能 三档；右键打开电源设置
//   · 右侧圆图标：从图标池里挑最多 5 个（默认 录屏/截图/设置/锁屏/关机），可排序
//   · 支持新增自定义命令按钮参与排序
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as SystemActions from 'resource:///org/gnome/shell/misc/systemActions.js';

import {loadConfig, watchConfig} from './config.js';
import {poolById} from './pool.js';

const SCREENCAST_XML = `<node>
<interface name="org.gnome.Shell.Screencast">
  <method name="Screencast">
    <arg type="s" direction="in" name="file_template"/>
    <arg type="a{sv}" direction="in" name="options"/>
    <arg type="b" direction="out" name="success"/>
    <arg type="s" direction="out" name="filename_used"/>
  </method>
  <method name="StopScreencast">
    <arg type="b" direction="out" name="success"/>
  </method>
</interface>
</node>`;
const ScreencastProxy = Gio.DBusProxy.makeProxyWrapper(SCREENCAST_XML);

const POWER_PROFILES = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_PATH = '/org/freedesktop/UPower/PowerProfiles';
const PROFILE_LABELS = {performance: '性能', balanced: '平衡', 'power-saver': '节能'};

// shell 自带的 4 个按钮在系统栏里的顺序（截图/设置/锁屏/关机）
const BUILTIN_IDS = ['screenshot', 'settings', 'lock', 'shutdown'];

function place(parent, child, index) {
    try {
        if (typeof parent.set_child_at_index === 'function')
            parent.set_child_at_index(child, index);
        else
            parent.insert_child_at_index(child, index);
    } catch (e) {
        logError(e, 'quick-panel-tweaks: 重新排列失败');
    }
}

export default class QuickPanelTweaksExtension extends Extension {
    enable() {
        this._config = loadConfig();
        this._dynamic = new Map();     // id -> St.Button（录屏 + 自定义按钮）
        this._recording = false;
        this._pressId = 0;

        this._screencast = new ScreencastProxy(
            Gio.DBus.session, 'org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast');
        try {
            this._powerProfiles = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.NONE, null,
                POWER_PROFILES, POWER_PROFILES_PATH, POWER_PROFILES, null);
        } catch (e) {
            this._powerProfiles = null;
            logError(e, 'quick-panel-tweaks: 连接 PowerProfiles 失败');
        }

        this._theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._stylesheet = Gio.File.new_for_path(
            GLib.build_filenamev([this.path, 'stylesheet.css']));
        this._theme.load_stylesheet(this._stylesheet);

        // 面板是异步搭起来的：轮询到系统栏就绪后应用一次
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            if (this._apply()) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });

        // 设置窗口改完配置即时生效
        this._watch = watchConfig(() => {
            this._config = loadConfig();
            this._resetDynamic();
            this._apply();
        });
    }

    disable() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._watch) {
            this._watch.monitor.disconnect(this._watch.id);
            this._watch = null;
        }

        this._resetDynamic();

        if (this._box)
            this._box.remove_style_class_name('quick-tweaks-row');
        if (this._flex?.get_parent())
            this._flex.get_parent().remove_child(this._flex);
        this._flex = null;

        if (this._powerToggle && this._pressId) {
            this._powerToggle.disconnect(this._pressId);
            this._pressId = 0;
        }
        this._powerToggle = null;

        for (const btn of this._builtinButtons ?? [])
            btn.visible = true;
        for (const spacer of this._spacers ?? [])
            spacer.x_expand = true;
        this._builtinButtons = [];
        this._spacers = [];
        this._box = null;

        try {
            this._theme?.unload_stylesheet(this._stylesheet);
        } catch (e) {
            /* 忽略 */
        }

        this._screencast = null;
        this._powerProfiles = null;
    }

    _resetDynamic() {
        for (const btn of this._dynamic.values())
            btn.destroy();
        this._dynamic.clear();
        this._recordButton = null;
    }

    // ---------- 布局 ----------
    _apply() {
        const qs = Main.panel.statusArea?.quickSettings;
        const systemItem = qs?._system?.quickSettingsItems?.[0];
        const box = systemItem?.child;
        if (!box)
            return false;

        const children = box.get_children();
        const buttons = children.filter(c => c instanceof St.Button);
        const spacers = children.filter(c => !(c instanceof St.Button));
        if (buttons.length < 5)
            return false;

        this._box = box;
        this._powerToggle = buttons[0];          // 左侧电池按钮
        this._builtinButtons = buttons.slice(1); // 截图/设置/锁屏/关机
        this._spacers = spacers;
        box.add_style_class_name('quick-tweaks-row');

        // shell 自带的两段弹性空白收起来，由我们按配置摆放
        for (const spacer of spacers)
            spacer.x_expand = false;

        if (!this._pressId) {
            this._pressId = this._powerToggle.connect('button-press-event', (_actor, event) => {
                const button = event.get_button();
                if (button === 1 && this._config.batteryClick === 'cycle') {
                    this._cyclePowerProfile();
                    return Clutter.EVENT_STOP;
                }
                if (button === 3) {
                    this._activatePanel('gnome-power-panel.desktop');
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        const wanted = this._config.rightIcons.slice(0, this._config.maxRight);
        this._builtinButtons.forEach((btn, i) => {
            btn.visible = wanted.includes(BUILTIN_IDS[i]);
        });

        let index = 0;
        place(box, this._powerToggle, index++);
        this._flex = this._flex ?? new Clutter.Actor({x_expand: true});
        if (this._flex.get_parent() !== box)
            box.add_child(this._flex);
        place(box, this._flex, index++);

        for (const id of wanted) {
            const actor = this._resolveIcon(id);
            if (!actor)
                continue;
            if (actor.get_parent() !== box)
                box.add_child(actor);
            place(box, actor, index++);
        }

        // 未选中的原生按钮留在末尾（已隐藏）
        for (const btn of this._builtinButtons) {
            if (!btn.visible)
                place(box, btn, index++);
        }
        return true;
    }

    _resolveIcon(id) {
        const builtinIndex = BUILTIN_IDS.indexOf(id);
        if (builtinIndex >= 0)
            return this._builtinButtons[builtinIndex] ?? null;
        return this._actionButton(id);
    }

    _actionButton(id) {
        if (this._dynamic.has(id))
            return this._dynamic.get(id);

        const custom = this._config.custom.find(c => c.id === id);
        const spec = custom
            ? {label: custom.label || id, icon: custom.icon || 'application-x-executable-symbolic'}
            : poolById(id);
        if (!spec)
            return null;

        const btn = new St.Button({
            style_class: 'icon-button',
            can_focus: true,
            accessible_name: spec.label,
            child: new St.Icon({icon_name: spec.icon, style_class: 'system-status-icon'}),
        });
        if (custom)
            btn.add_style_class_name('custom-item');
        btn.connect('clicked', () => {
            try {
                if (custom)
                    this._runCommand(custom.command);
                else
                    this._runAction(id);
            } catch (e) {
                logError(e, `quick-panel-tweaks: ${id} 执行失败`);
            }
        });
        if (id === 'record')
            this._recordButton = btn;
        this._dynamic.set(id, btn);
        return btn;
    }

    // ---------- 动作 ----------
    _runAction(id) {
        const actions = SystemActions.getDefault();
        switch (id) {
        case 'screenshot':
            Main.panel.closeQuickSettings();
            Main.screenshotUI.open().catch(logError);
            break;
        case 'record':
            this._toggleRecording();
            break;
        case 'lock':
            Main.panel.closeQuickSettings();
            actions.activateLockScreen();
            break;
        case 'logout':
            Main.panel.closeQuickSettings();
            actions.activateLogout();
            break;
        case 'suspend':
            Main.panel.closeQuickSettings();
            actions.activateSuspend();
            break;
        case 'restart':
            Main.panel.closeQuickSettings();
            actions.activateRestart();
            break;
        case 'shutdown':
            Main.panel.closeQuickSettings();
            actions.activatePowerOff();
            break;
        case 'settings':
            this._activatePanel('org.gnome.Settings.desktop');
            break;
        case 'powerpanel':
            this._activatePanel('gnome-power-panel.desktop');
            break;
        case 'networkpanel':
            this._activatePanel('gnome-network-panel.desktop');
            break;
        case 'bluetoothpanel':
            this._activatePanel('gnome-bluetooth-panel.desktop');
            break;
        case 'soundpanel':
            this._activatePanel('gnome-sound-panel.desktop');
            break;
        case 'a11ypanel':
            this._activatePanel('gnome-universal-access-panel.desktop');
            break;
        case 'dnd': {
            const s = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
            s.set_boolean('show-banners', !s.get_boolean('show-banners'));
            break;
        }
        case 'nightlight': {
            const s = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
            s.set_boolean('night-light-enabled', !s.get_boolean('night-light-enabled'));
            break;
        }
        case 'darkmode': {
            const s = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            s.set_string('color-scheme',
                s.get_string('color-scheme') === 'prefer-dark' ? 'default' : 'prefer-dark');
            break;
        }
        case 'mute':
            GLib.spawn_command_line_async('wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle');
            break;
        case 'terminal':
            this._launch(['org.gnome.Terminal.desktop']);
            break;
        case 'files':
            this._launch(['org.gnome.Nautilus.desktop']);
            break;
        case 'browser':
            this._launch(['google-chrome.desktop']);
            break;
        case 'vscode':
            this._launch(['code.desktop']);
            break;
        default:
            break;
        }
    }

    _activatePanel(desktopId) {
        Main.overview.hide();
        Main.panel.closeQuickSettings();
        const app = Shell.AppSystem.get_default().lookup_app(desktopId);
        if (app)
            app.activate();
        else
            GLib.spawn_command_line_async('gnome-control-center');
    }

    _launch(desktopIds) {
        const appSystem = Shell.AppSystem.get_default();
        for (const id of desktopIds) {
            const app = appSystem.lookup_app(id);
            if (app) {
                Main.overview.hide();
                Main.panel.closeQuickSettings();
                app.activate();
                return;
            }
        }
        Main.notify('Quick Panel Tweaks', `找不到应用：${desktopIds[0]}`);
    }

    _runCommand(command) {
        if (!command)
            return;
        const [, argv] = GLib.shell_parse_argv(command);
        Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    }

    // ---------- 电池：循环性能档位 ----------
    _cyclePowerProfile() {
        const proxy = this._powerProfiles;
        if (!proxy) {
            this._activatePanel('gnome-power-panel.desktop');
            return;
        }
        const profiles = (proxy.get_cached_property('Profiles')?.deep_unpack() ?? [])
            .map(p => p.Profile?.deep_unpack?.() ?? p.Profile);
        const active = proxy.get_cached_property('ActiveProfile')?.deep_unpack();
        if (!profiles.length) {
            this._activatePanel('gnome-power-panel.desktop');
            return;
        }
        const next = profiles[(Math.max(profiles.indexOf(active), -1) + 1) % profiles.length];
        proxy.call('org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', [POWER_PROFILES, 'ActiveProfile', new GLib.Variant('s', next)]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
        Main.notify('电源模式', `已切换到「${PROFILE_LABELS[next] ?? next}」`);
    }

    // ---------- 录屏 ----------
    _toggleRecording() {
        if (this._recording) {
            this._screencast.StopScreencastRemote((_result, error) => {
                if (error) {
                    logError(error, 'quick-panel-tweaks: 停止录屏失败');
                    return;
                }
                this._recording = false;
                this._recordButton?.remove_style_class_name('recording');
                this._recordButton?.child?.set_icon_name('record-screen-symbolic');
                Main.notify('录屏', '已结束，文件在「视频 / Screencasts」');
            });
            return;
        }
        this._screencast.ScreencastRemote(
            'Screencasts/录屏 %d %t',
            {'draw-cursor': new GLib.Variant('b', true), 'framerate': new GLib.Variant('i', 30)},
            (result, error) => {
                if (error) {
                    logError(error, 'quick-panel-tweaks: 开始录屏失败');
                    Main.notify('录屏失败', error.message ?? String(error));
                    return;
                }
                this._recording = true;
                this._recordButton?.add_style_class_name('recording');
                this._recordButton?.child?.set_icon_name('media-playback-stop-symbolic');
                const file = result?.[1] ? GLib.path_get_basename(result[1]) : '';
                Main.notify('开始录屏', file ? `正在录制：${file}` : '正在录制屏幕');
            });
    }
}
