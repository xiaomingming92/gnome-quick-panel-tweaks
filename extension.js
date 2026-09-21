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

import {loadConfig, saveConfig, watchConfig} from './config.js';
import {poolById} from './pool.js';

const UIMODE_SCREENCAST = 1;    // gnome-shell 的 UIMode.SCREENCAST（模块内部常量，未导出）
const POWER_PROFILES = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_PATH = '/org/freedesktop/UPower/PowerProfiles';
const PROFILE_LABELS = {performance: '性能', balanced: '平衡', 'power-saver': '节能'};
// 档位符号（插在电池图标与百分比之间）；balanced 用空槽位保持宽度不变
const PROFILE_ICON_NAMES = {
    'power-saver': 'profile-power-saver-symbolic',
    'performance': 'profile-performance-symbolic',
};
const LONG_PRESS_MS = 500;      // 长按多久进入编辑态
const DRAG_THRESHOLD = 8;       // 编辑态里移动多少像素算开始拖动
const REMOVE_OFFSET = 44;       // 拖到该行上方这么多像素 = 移除
const DEBUG = true;             // 调试期：把点击/录屏关键路径写进日志（稳定后可关）

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
        // 版本标记：用来确认扩展是否真的热重载成功（无需注销就能在日志里核对）
        console.log('quick-panel-tweaks: loaded build 2026-09-21f');
        this._config = loadConfig();
        this._dynamic = new Map();     // id -> St.Button（录屏 + 自定义按钮）
        this._recording = false;
        this._editMode = false;
        this._editButtons = [];
        this._screencastNotifyId = 0;
        this._pendingProfile = null;   // 连点切档时的“乐观值”，避免读缓存滞后一拍
        this._profileSlot = null;      // 电池与百分比之间的档位符号槽位
        this._profileIcon = null;
        this._press = null;
        this._longPressId = 0;
        this._drag = null;

        // 同理延迟创建：enable() 阶段只做零成本的事，D-Bus 代理等用户第一次点再建
        this._powerProfiles = null;

        try {
            this._theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
            this._stylesheet = Gio.File.new_for_path(
                GLib.build_filenamev([this.path, 'stylesheet.css']));
            this._theme.load_stylesheet(this._stylesheet);
        } catch (e) {
            this._theme = null;
            logError(e, 'quick-panel-tweaks: 加载样式失败');
        }

        // 面板是异步搭起来的：轮询到系统栏就绪后应用一次
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            if (this._apply()) {
                this._timerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });

        // 设置窗口改完配置即时生效
        try {
            this._watch = watchConfig(() => {
                this._config = loadConfig();
                this._resetDynamic();
                this._apply();
            });
        } catch (e) {
            this._watch = null;
            logError(e, 'quick-panel-tweaks: 监听配置文件失败');
        }
    }

    disable() {
        this._exitEditMode();
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
        if (this._profileSlot?.get_parent())
            this._profileSlot.get_parent().remove_child(this._profileSlot);
        this._profileSlot = null;
        this._profileIcon = null;
        if (this._screencastNotifyId && Main.screenshotUI) {
            Main.screenshotUI.disconnect(this._screencastNotifyId);
            this._screencastNotifyId = 0;
        }
        if (this._flex?.get_parent())
            this._flex.get_parent().remove_child(this._flex);
        this._flex = null;

        if (this._longPressId) {
            GLib.source_remove(this._longPressId);
            this._longPressId = 0;
        }
        this._press = null;
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

        this._powerProfiles = null;
    }

    _resetDynamic() {
        this._exitEditMode();
        for (const btn of this._dynamic.values())
            btn.destroy();
        this._dynamic.clear();
        this._recordButton = null;
    }

    _ensurePowerProfiles() {
        if (this._powerProfiles)
            return this._powerProfiles;
        try {
            this._powerProfiles = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null,
                POWER_PROFILES, POWER_PROFILES_PATH, POWER_PROFILES, null);
            // 属性真的变了就把乐观值清掉，之后以缓存为准
            this._powerProfiles.connect('g-properties-changed', () => {
                this._pendingProfile = null;
                this._syncProfileIcon();
            });
        } catch (e) {
            this._powerProfiles = null;
            logError(e, 'quick-panel-tweaks: 连接 PowerProfiles 失败');
        }
        return this._powerProfiles;
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

        // 自检用：报告系统行在网格中的位置（GNOME 50 应排在最前 = 面板顶部那一行）
        if (!this._loggedPosition) {
            this._loggedPosition = true;
            try {
                const grid = Main.panel.statusArea.quickSettings.menu?._grid;
                const items = grid?.get_children() ?? [];
                console.log(`quick-panel-tweaks: 系统行在网格第 ${items.indexOf(systemItem)} 位` +
                    `（共 ${items.length} 项，0 = 最前/顶部）`);
            } catch (e) {
                /* 忽略 */
            }
        }

        // shell 自带的两段弹性空白收起来，由我们按配置摆放
        for (const spacer of spacers)
            spacer.x_expand = false;

        const wanted = this._config.rightIcons.slice(0, this._config.maxRight);
        this._builtinButtons.forEach((btn, i) => {
            btn.visible = wanted.includes(BUILTIN_IDS[i]);
        });
        if (!this._boxMotionId) {
            this._boxMotionId = box.connect('motion-event', (_a, ev) => this._onMotion(ev));
            this._qsMenuClosedId = Main.panel.statusArea.quickSettings.menu.connect(
                'menu-closed', () => {
                    this._clearActivePseudo();
                    this._exitEditMode();
                });
        }
        // 录屏按钮状态跟随 shell（顶栏指示器/系统 UI 起录也会同步）
        this._bindRecordingState();

        let index = 0;
        place(box, this._powerToggle, index++);
        // 档位符号：插进电池按钮内部，位于「电池图标」和「百分比」之间
        this._ensureProfileSlot();
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

        // 统一接管这一行所有按钮的按下/松开：短按 = 原动作，长按 = 进编辑态。
        // 必须放在“创建完动态按钮（录屏/自定义）”之后 —— 否则新按钮收不到点击。
        this._attachPress(this._powerToggle, 'power');
        this._builtinButtons.forEach((btn, i) => this._attachPress(btn, BUILTIN_IDS[i]));
        for (const [id, btn] of this._dynamic)
            this._attachPress(btn, id);
        return true;
    }

    // ---------- 长按 / 编辑态 / 拖动排序 ----------
    _attachPress(btn, id) {
        if (btn._qptAttached)
            return;
        btn._qptAttached = true;
        btn._qptId = id;
        btn.connect('button-press-event', (_a, ev) => this._onPress(btn, ev));
        btn.connect('button-release-event', (_a, ev) => this._onRelease(btn, ev));
    }

    _onPress(btn, ev) {
        const mouseButton = ev.get_button();
        if (mouseButton === 3) {
            if (btn === this._powerToggle) {
                this._activatePanel('gnome-power-panel.desktop');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }
        if (mouseButton !== 1)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = ev.get_coords();
        this._press = {btn, x, y, longFired: false};
        if (this._longPressId)
            GLib.source_remove(this._longPressId);
        this._longPressId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, LONG_PRESS_MS, () => {
            this._longPressId = 0;
            if (this._press?.btn !== btn)
                return GLib.SOURCE_REMOVE;
            this._press.longFired = true;
            if (!this._editMode)
                this._enterEditMode();
            else if (btn !== this._powerToggle)
                this._drag = {actor: btn, x0: x, y0: y, active: false, remove: false};
            return GLib.SOURCE_REMOVE;
        });
        btn.add_style_pseudo_class?.('active');
        return Clutter.EVENT_STOP;   // 自己处理点击，避免 shell 的 clicked 抢先触发
    }

    _onRelease(btn, ev) {
        if (this._longPressId) {
            GLib.source_remove(this._longPressId);
            this._longPressId = 0;
        }
        btn.remove_style_pseudo_class?.('active');
        const press = this._press;
        this._press = null;
        if (this._drag) {
            this._endDrag();
            return Clutter.EVENT_STOP;
        }
        if (press?.longFired)
            return Clutter.EVENT_STOP;   // 长按松手不触发原动作
        // 编辑态里：图标单击不触发原动作（避免误触截图/关机），但编辑按钮（＋/✓）要正常派发
        if (this._editMode && !this._editButtons.includes(btn))
            return Clutter.EVENT_STOP;
        this._dispatchClick(btn);
        return Clutter.EVENT_STOP;
    }

    _onMotion(ev) {
        const drag = this._drag;
        if (!drag)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = ev.get_coords();
        if (!drag.active) {
            if (Math.hypot(x - drag.x0, y - drag.y0) < DRAG_THRESHOLD)
                return Clutter.EVENT_PROPAGATE;
            drag.active = true;
            drag.actor.add_style_class_name('dragging');
        }
        const box = this._box;
        const [, by] = box.get_transformed_position();

        const removing = y < by - REMOVE_OFFSET;
        if (removing !== drag.remove) {
            drag.remove = removing;
            drag.actor[removing ? 'add_style_class_name' : 'remove_style_class_name']('removing');
        }

        // 实时排序：插到“最后一个中心点在指针左侧”的图标之后
        const kids = box.get_children().filter(c => this._isRowIcon(c) && c !== drag.actor);
        let target = 1;                  // 电池之后
        for (const c of kids) {
            const [cx] = c.get_transformed_position();
            if (x > cx + c.width / 2)
                target = box.get_children().indexOf(c) + 1;
        }
        const maxIndex = box.get_children().length - 1;
        place(box, drag.actor, Math.max(1, Math.min(target, maxIndex)));
        return Clutter.EVENT_STOP;
    }

    _endDrag() {
        const drag = this._drag;
        this._drag = null;
        if (!drag)
            return;
        drag.actor.remove_style_class_name('dragging');
        drag.actor.remove_style_class_name('removing');
        if (!drag.active)
            return;
        if (drag.remove && drag.actor._qptId) {
            this._removeFromRow(drag.actor._qptId);
            return;
        }
        this._saveOrderFromRow();
    }

    _isRowIcon(actor) {
        return actor instanceof St.Button &&
            actor !== this._powerToggle &&
            !actor.has_style_class_name('edit-button');
    }

    _enterEditMode() {
        if (this._editMode || !this._box)
            return;
        this._editMode = true;
        this._box.add_style_class_name('editing');
        this._editButtons = [];

        const add = this._makeEditButton('list-add-symbolic', '添加 / 移除图标');
        const done = this._makeEditButton('object-select-symbolic', '完成');
        add._qptOnClick = () => {
            this.openPreferences();
            this._exitEditMode();
        };
        done._qptOnClick = () => this._exitEditMode();
        for (const btn of [add, done]) {
            btn.add_style_class_name('edit-button');
            this._box.add_child(btn);
            this._attachPress(btn, btn === add ? 'edit-add' : 'edit-done');
            this._editButtons.push(btn);
        }
    }

    _exitEditMode() {
        this._drag = null;
        if (!this._editMode)
            return;
        this._editMode = false;
        this._box?.remove_style_class_name('editing');
        for (const btn of this._editButtons)
            btn.destroy();
        this._editButtons = [];
        this._saveOrderFromRow();
    }

    _makeEditButton(iconName, tooltip) {
        return new St.Button({
            style_class: 'icon-button',
            can_focus: true,
            accessible_name: tooltip,
            child: new St.Icon({icon_name: iconName, style_class: 'system-status-icon'}),
        });
    }

    _dispatchClick(btn) {
        if (DEBUG)
            console.log(`quick-panel-tweaks: 点击 → ${btn._qptId ?? '(未知)'}`);
        // 带菜单的按钮（如“关机”按钮有 待机/重启/关机… 菜单）保持原有交互：开菜单
        if (btn.menu?.open) {
            btn.menu.open();
            return;
        }
        if (typeof btn._qptOnClick === 'function') {
            btn._qptOnClick();
            return;
        }
        const id = btn._qptId;
        if (!id)
            return;
        const custom = this._config.custom.find(c => c.id === id);
        if (custom) {
            this._runCommand(custom.command);
            return;
        }
        if (id === 'power') {
            if (this._config.batteryClick === 'panel')
                this._activatePanel('gnome-power-panel.desktop');
            else
                this._cyclePowerProfile();
            return;
        }
        this._runAction(id);
    }

    _saveOrderFromRow() {
        if (!this._box)
            return;
        const ids = this._box.get_children()
            .filter(c => this._isRowIcon(c) && c.visible && c._qptId)
            .map(c => c._qptId);
        const cfg = loadConfig();
        if (JSON.stringify(cfg.rightIcons) === JSON.stringify(ids))
            return;
        cfg.rightIcons = ids;
        this._config = cfg;
        saveConfig(cfg);
    }

    _removeFromRow(id) {
        const cfg = loadConfig();
        cfg.rightIcons = cfg.rightIcons.filter(x => x !== id);
        this._config = cfg;
        saveConfig(cfg);
        Main.notify('Quick Panel Tweaks', `已从系统栏移除「${poolById(id)?.label ?? id}」`);
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
        // 不接 clicked：这一行的点击统一由 _dispatchClick() 派发，避免和 shell 的 clicked 打架
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
        const proxy = this._ensurePowerProfiles();
        if (!proxy) {
            this._activatePanel('gnome-power-panel.desktop');
            return;
        }
        const profiles = (proxy.get_cached_property('Profiles')?.deep_unpack() ?? [])
            .map(p => p.Profile?.deep_unpack?.() ?? p.Profile);
        if (!profiles.length) {
            this._activatePanel('gnome-power-panel.desktop');
            return;
        }
        // 连点时缓存属性会滞后一拍，所以以上一次“我刚设过的目标”为基准推进
        const cached = proxy.get_cached_property('ActiveProfile')?.deep_unpack();
        const current = this._pendingProfile ?? cached;
        const next = profiles[(Math.max(profiles.indexOf(current), -1) + 1) % profiles.length];
        this._pendingProfile = next;
        this._syncProfileIcon(next);       // 先就地换符号，体感即时
        // Gio.DBusProxy.call 的签名是 (method, params, flags, timeout, cancellable, callback) 6 个参数，
        // 方法名要写成 "接口.方法" 的点号形式
        proxy.call('org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [POWER_PROFILES, 'ActiveProfile', new GLib.Variant('s', next)]),
            Gio.DBusCallFlags.NONE, -1, null,
            (p, res) => {
                try {
                    p.call_finish(res);
                } catch (e) {
                    this._pendingProfile = null;
                    logError(e, 'quick-panel-tweaks: 切换电源模式失败');
                    Main.notify('电源模式', '切换失败，可右键打开电源设置');
                }
            });
    }

    // 在电池按钮内部插一个固定宽度的槽位： [电池图标][档位符号][百分比]
    _ensureProfileSlot() {
        if (this._profileSlot || !this._powerToggle?._box)
            return;
        const inner = this._powerToggle._box;
        this._profileIcon = new St.Icon({style_class: 'quick-tweaks-profile-icon'});
        this._profileSlot = this._profileIcon;          // 直接用 St.Icon，避免额外容器影响度量
        const iconIndex = inner.get_children().indexOf(this._powerToggle._icon);
        inner.insert_child_at_index(this._profileIcon,
            iconIndex >= 0 ? iconIndex + 1 : inner.get_children().length);
        this._syncProfileIcon();
    }

    // 换档位符号：性能=仪表、节能=叶子、平衡=空（槽位宽度不变，不会跳动）
    _syncProfileIcon(explicit) {
        if (!this._profileIcon)
            return;
        const proxy = this._powerProfiles;
        const current = explicit ??
            this._pendingProfile ??
            proxy?.get_cached_property('ActiveProfile')?.deep_unpack();
        const name = PROFILE_ICON_NAMES[current];
        if (!name) {
            this._profileIcon.set({gicon: null});
            return;
        }
        // 用文件图标（不依赖图标主题搜索路径），按深浅主题选对应着色版本
        const dark = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'})
            .get_string('color-scheme') === 'prefer-dark';
        const file = GLib.build_filenamev([this.path, 'icons',
            `${name}-${dark ? 'light' : 'dark'}.svg`]);
        this._profileIcon.set({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(file)),
            icon_size: 16,
        });
    }

    // ---------- 录屏 ----------
    _toggleRecording() {
        const ui = Main.screenshotUI;
        if (!ui) {
            Main.notify('录屏不可用', '系统截图/录屏 UI 不可用');
            return;
        }
        // 以 shell 自己的状态为准：这样顶栏的录制指示器、停止按钮、快门 UI 全都会联动
        if (ui.screencastInProgress) {
            ui.stopScreencast().catch(e => {
                logError(e, 'quick-panel-tweaks: 停止录屏失败');
                Main.notify('录屏', '停止失败，可点顶栏的录制指示器结束');
            });
            return;
        }
        this._startScreencastViaShell(ui);
    }

    async _startScreencastViaShell(ui) {
        if (typeof ui._startScreencast !== 'function') {
            Main.notify('录屏失败', '当前 GNOME 版本的录屏接口与扩展不匹配');
            return;
        }
        try {
            // 直接走 shell 的“整屏录制”入口：它会自己收起 UI、点亮顶栏指示器
            await ui._startScreencast();
        } catch (e) {
            // 少数版本要求先进入录屏模式
            try {
                await ui.open(UIMODE_SCREENCAST);
                await ui._startScreencast();
            } catch (e2) {
                logError(e2, 'quick-panel-tweaks: 开始录屏失败');
                Main.notify('录屏失败', `${e2.message ?? e2}`);
                return;
            }
        }
        // 兜底自检：1.5 秒后仍未进入录制态，就打开系统录屏界面让用户点一下
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            const live = Main.screenshotUI;
            if (live && !live.screencastInProgress) {
                console.warn('quick-panel-tweaks: shell 录屏入口未生效，改为打开系统录屏 UI');
                live.open(UIMODE_SCREENCAST)?.catch?.(logError);
                Main.notify('录屏', '系统接口没直接生效，已打开录屏界面 —— 点其中的“录制”即可');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // 让按钮状态始终跟随 shell（含从系统 UI 发起的录制）
    _bindRecordingState() {
        const ui = Main.screenshotUI;
        if (!ui || this._screencastNotifyId)
            return;
        this._setRecordingUI(ui.screencastInProgress);
        this._screencastNotifyId = ui.connect('notify::screencast-in-progress',
            () => this._setRecordingUI(ui.screencastInProgress));
    }

    _setRecordingUI(on) {
        this._recording = on;
        const btn = this._recordButton;
        if (!btn)
            return;
        if (on) {
            btn.add_style_class_name('recording');
            btn.child?.set_icon_name('media-playback-stop-symbolic');
        } else {
            btn.remove_style_class_name('recording');
            btn.child?.set_icon_name('record-screen-symbolic');
        }
    }

    _clearActivePseudo() {
        const all = [this._powerToggle, ...(this._builtinButtons ?? []),
            ...this._dynamic.values(), ...(this._editButtons ?? [])];
        for (const btn of all)
            btn?.remove_style_pseudo_class?.('active');
    }
}
