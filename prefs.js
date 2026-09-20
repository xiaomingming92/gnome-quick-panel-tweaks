// 设置窗口：挑右侧 5 个图标、排序、加自定义按钮、改电池点击行为
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {DEFAULT_CONFIG, loadConfig, saveConfig} from './config.js';
import {GROUPS, POOL, poolById} from './pool.js';

const GROUP_LABEL = Object.fromEntries(GROUPS);

export default class QuickPanelTweaksPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        this._window = window;
        this._cfg = loadConfig();
        this._groups = [];
        window.set_default_size(640, 780);

        this._page = new Adw.PreferencesPage({
            title: '快捷面板',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(this._page);
        this._render();
    }

    _render() {
        for (const g of this._groups)
            this._page.remove(g);
        this._groups = [];

        this._page.add(this._buildIconsGroup());
        this._page.add(this._buildBatteryGroup());
        this._page.add(this._buildCustomGroup());
    }

    // ---------- 右侧图标 ----------
    _buildIconsGroup() {
        const group = new Adw.PreferencesGroup({
            title: '右侧图标',
            description: `按顺序显示在系统栏右侧，最多 ${this._cfg.maxRight} 个。` +
                '（左侧那个电池按钮不在这里，它固定在最左边）',
        });
        this._groups.push(group);

        this._cfg.rightIcons.forEach((id, idx) => {
            const custom = this._cfg.custom.find(c => c.id === id);
            const spec = custom ?? poolById(id);
            const row = new Adw.ActionRow({
                title: spec?.label ?? id,
                subtitle: custom ? `自定义命令：${custom.command}` : this._describe(id),
            });
            row.add_prefix(new Gtk.Image({
                icon_name: spec?.icon ?? 'application-x-executable-symbolic',
                pixel_size: 22,
            }));
            row.add_suffix(this._iconButton('go-up-symbolic', '上移', idx > 0,
                () => this._move(idx, -1)));
            row.add_suffix(this._iconButton('go-down-symbolic', '下移',
                idx < this._cfg.rightIcons.length - 1, () => this._move(idx, 1)));
            row.add_suffix(this._iconButton('window-close-symbolic', '移除',
                this._cfg.rightIcons.length > 1, () => this._remove(idx)));
            group.add(row);
        });

        if (this._cfg.rightIcons.length < this._cfg.maxRight) {
            const addRow = new Adw.ActionRow({title: '添加图标'});
            const labels = POOL
                .filter(p => !this._cfg.rightIcons.includes(p.id))
                .map(p => `${GROUP_LABEL[p.group] ?? p.group} · ${p.label}`);
            this._poolIds = POOL
                .filter(p => !this._cfg.rightIcons.includes(p.id))
                .map(p => p.id);
            if (this._poolIds.length) {
                this._dropdown = Gtk.DropDown.new_from_strings(labels);
                addRow.add_suffix(this._dropdown);
                const add = new Gtk.Button({
                    label: '添加',
                    valign: Gtk.Align.CENTER,
                    css_classes: ['suggested-action'],
                });
                add.connect('clicked', () => {
                    const id = this._poolIds[this._dropdown.selected];
                    if (!id)
                        return;
                    this._cfg.rightIcons.push(id);
                    this._save();
                });
                addRow.add_suffix(add);
            } else {
                addRow.subtitle = '图标池里已经全部加进来了';
            }
            group.add(addRow);
        }

        const maxRow = new Adw.SpinRow({
            title: '最多显示几个',
            adjustment: new Gtk.Adjustment({
                lower: 3, upper: 6, step_increment: 1,
                value: this._cfg.maxRight,
            }),
        });
        maxRow.connect('notify::value', () => {
            const value = Math.round(maxRow.value);
            if (value === this._cfg.maxRight)
                return;
            this._cfg.maxRight = value;
            this._save();
        });
        group.add(maxRow);

        const hint = new Adw.ActionRow({
            subtitle: '系统栏宽度有限：5 个圆图标 ≈ 11.2em，加电池那块刚好放得下；' +
                '要放更多可以把数字调大，面板会自适应变宽。',
        });
        hint.activatable = false;
        group.add(hint);
        return group;
    }

    _describe(id) {
        const map = {
            record: '开始 / 停止录屏（录制中变红）',
            screenshot: '打开截图 UI（截图 / 录屏 / 选区）',
            lock: '锁定屏幕',
            logout: '注销当前用户',
            suspend: '挂起 / 待机',
            restart: '重启',
            shutdown: '关机',
            settings: '打开系统设置',
            powerpanel: '打开电源设置面板',
            networkpanel: '打开 Wi‑Fi / 网络面板',
            bluetoothpanel: '打开蓝牙面板',
            soundpanel: '打开声音面板',
            a11ypanel: '打开辅助功能面板',
            dnd: '切换「勿扰」（显示 / 隐藏通知横幅）',
            nightlight: '切换夜灯',
            darkmode: '在深色 / 浅色之间切换',
            mute: '切换输出静音',
            terminal: '打开终端',
            files: '打开文件管理器',
            browser: '打开浏览器',
            vscode: '打开 VS Code',
        };
        return map[id] ?? '';
    }

    _iconButton(iconName, tooltip, sensitive, onClick) {
        const btn = new Gtk.Button({
            icon_name: iconName,
            tooltip_text: tooltip,
            valign: Gtk.Align.CENTER,
            sensitive,
            css_classes: ['flat'],
        });
        btn.connect('clicked', onClick);
        return btn;
    }

    _move(index, delta) {
        const list = this._cfg.rightIcons;
        const target = index + delta;
        if (target < 0 || target >= list.length)
            return;
        [list[index], list[target]] = [list[target], list[index]];
        this._save();
    }

    _remove(index) {
        if (this._cfg.rightIcons.length <= 1)
            return;
        this._cfg.rightIcons.splice(index, 1);
        this._save();
    }

    // ---------- 电池 ----------
    _buildBatteryGroup() {
        const group = new Adw.PreferencesGroup({
            title: '电池按钮（最左边那个）',
            description: 'GNOME 默认点它会跳转到设置里的电源面板；这里可以改成直接切档（该按钮在系统行最左边）。',
        });
        this._groups.push(group);

        const row = new Adw.ComboRow({
            title: '左键点击',
            model: Gtk.StringList.new(['循环性能档位（性能 → 平衡 → 节能）', '打开电源设置面板']),
            selected: this._cfg.batteryClick === 'panel' ? 1 : 0,
        });
        row.connect('notify::selected', () => {
            this._cfg.batteryClick = row.selected === 1 ? 'panel' : 'cycle';
            this._save();
        });
        group.add(row);

        const hint = new Adw.ActionRow({
            subtitle: '右键点击始终是打开电源设置面板。',
        });
        hint.activatable = false;
        group.add(hint);
        return group;
    }

    // ---------- 自定义按钮 ----------
    _buildCustomGroup() {
        const group = new Adw.PreferencesGroup({
            title: '自定义按钮',
            description: '任意图标 + 任意命令，加进来后会出现在上面的「添加图标」列表里。',
        });
        this._groups.push(group);

        this._cfg.custom.forEach(custom => {
            const row = new Adw.ActionRow({
                title: custom.label || custom.id,
                subtitle: custom.command,
            });
            row.add_prefix(new Gtk.Image({
                icon_name: custom.icon || 'application-x-executable-symbolic',
                pixel_size: 22,
            }));
            row.add_suffix(this._iconButton('user-trash-symbolic', '删除', true, () => {
                this._cfg.custom = this._cfg.custom.filter(c => c.id !== custom.id);
                this._cfg.rightIcons = this._cfg.rightIcons.filter(id => id !== custom.id);
                this._save();
            }));
            group.add(row);
        });

        const addRow = new Adw.ActionRow({title: '新建自定义按钮'});
        const add = new Gtk.Button({
            label: '新建…',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        add.connect('clicked', () => this._newCustomDialog());
        addRow.add_suffix(add);
        group.add(addRow);

        const defaults = new Adw.ActionRow({title: '恢复默认设置'});
        const reset = new Gtk.Button({label: '恢复默认', valign: Gtk.Align.CENTER});
        reset.connect('clicked', () => {
            this._cfg = {...DEFAULT_CONFIG, rightIcons: [...DEFAULT_CONFIG.rightIcons], custom: []};
            this._save();
        });
        defaults.add_suffix(reset);
        group.add(defaults);
        return group;
    }

    _newCustomDialog() {
        const dialog = new Adw.MessageDialog({
            transient_for: this._window,
            heading: '新建自定义按钮',
            body: '图标名要能在图标主题里找到（例如 utilities-terminal-symbolic）。',
        });
        dialog.add_response('cancel', '取消');
        dialog.add_response('ok', '创建');
        dialog.set_response_appearance('ok', Adw.ResponseAppearance.SUGGESTED);
        dialog.set_default_response('ok');

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_top: 8,
        });
        const labelEntry = new Gtk.Entry({placeholder_text: '名称（显示名称/提示）'});
        const iconEntry = new Gtk.Entry({placeholder_text: '图标名，如 utilities-terminal-symbolic'});
        const cmdEntry = new Gtk.Entry({placeholder_text: '命令，如 gnome-terminal 或 /path/to/script.sh'});
        box.append(labelEntry);
        box.append(iconEntry);
        box.append(cmdEntry);
        dialog.set_extra_child(box);
        dialog.connect('response', (_d, response) => {
            if (response !== 'ok')
                return;
            const label = labelEntry.text.trim() || '自定义';
            const command = cmdEntry.text.trim();
            if (!command) {
                this._window.add_toast(new Adw.Toast({title: '命令不能为空'}));
                return;
            }
            const id = `custom-${GLib.get_monotonic_time()}`;
            this._cfg.custom.push({
                id,
                label,
                icon: iconEntry.text.trim() || 'application-x-executable-symbolic',
                command,
            });
            if (this._cfg.rightIcons.length < this._cfg.maxRight)
                this._cfg.rightIcons.push(id);
            this._save();
        });
        dialog.present();
    }

    _save() {
        saveConfig(this._cfg);
        this._render();     // 立即刷新列表；扩展侧通过文件监视即时生效
    }
}
