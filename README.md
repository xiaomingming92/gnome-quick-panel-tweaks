# GNOME Quick Panel Tweaks

给 GNOME 快捷面板最下面那行「系统栏」做自定义的小扩展（GNOME Shell 50 / Ubuntu 26.04 上开发测试）：

- **电池按钮（左侧长的那个）**：GNOME 默认点它会跳去设置里的电源面板；本扩展把**左键**改成
  **循环切换性能档位（性能 → 平衡 → 节能）**，并弹通知显示当前档位；**右键**仍然是打开电源设置面板。
- **右侧圆图标**：从 **21 个图标池** 里挑最多 5 个、自由排序；默认
  `录屏 · 截图 · 设置 · 锁屏 · 关机`。
- **自带录屏按钮**：调用 GNOME 原生的 `org.gnome.Shell.Screencast`，录制中按钮变红、图标变成停止，
  文件存到 `~/视频/Screencasts/`。
- **自定义按钮**：任意图标名 + 任意命令（脚本、App、`gnome-control-center` 面板…），加入后一样能排序。
- **尺寸适配**：系统栏里圆图标从 `padding 0.818em / 图标 1.091em` 收到 `0.62em / 1.05em`，
  5 个 ≈ 11.2em，正好和左侧电池按钮（≈2 图标 + 一个间隙）并排放下。

![icon pool](docs/pool.md)

## 图标池（21 个内置）

| 分组 | 图标 |
| --- | --- |
| 系统 / 会话 | 录屏 · 截图 · 锁屏 · 注销 · 待机 · 重启 · 关机 |
| 设置入口 | 设置 · 电源设置 · 网络设置 · 蓝牙设置 · 声音设置 · 辅助功能 |
| 一键开关 | 勿扰 · 夜灯 · 深色模式 · 静音 |
| 常用应用 | 终端 · 文件 · 浏览器 · VS Code |

外加不限量的自定义命令按钮。

## 安装

```bash
git clone git@github.com:xiaomingming92/gnome-quick-panel-tweaks.git
cd gnome-quick-panel-tweaks
make install          # 拷贝到 ~/.local/share/gnome-shell/extensions/<uuid>/
# 注销重新登录一次（Wayland 下新装的扩展必须重登）
gnome-extensions enable quick-panel-tweaks@xiaomingming92.github.io
```

然后在「扩展 / Extension Manager」里点本扩展的齿轮打开设置窗口。

## 配置

设置窗口改完**即时生效**（扩展监听配置文件变化，不用重登）：

```
~/.config/quick-panel-tweaks@xiaomingming92.github.io/config.json
```

```json
{
  "rightIcons": ["record", "screenshot", "settings", "lock", "shutdown"],
  "maxRight": 5,
  "batteryClick": "cycle",
  "custom": [
    {"id": "custom-1", "label": "工作区", "icon": "folder-symbolic", "command": "xdg-open ~/ai"}
  ]
}
```

## 实现说明

- 目标对象是快捷面板里的 `SystemItem`（`Main.panel.statusArea.quickSettings._system.quickSettingsItems[0]`），
  它的 `child` 是一个 `St.BoxLayout`，依次放着：电池按钮 / 弹簧 / 截图 / 设置 / 弹簧 / 锁屏 / 关机。
- 电池按钮不改控件本体（避免破坏顶栏电池图标、百分比绑定），只拦截它的 `button-press-event`；
  切档通过 `org.freedesktop.UPower.PowerProfiles` 的 `ActiveProfile` 属性。
- 右侧图标按配置重新 insert（`set_child_at_index`），未选中的原生按钮只做 `visible = false`，
  禁用扩展时会全部还原。
- 录屏走 GNOME 原生 D-Bus `org.gnome.Shell.Screencast`，和系统截图 UI 里的录屏是同一套。

## 已知限制

- `metadata.json` 里 `shell-version` 目前写死 `["50"]`（用到了 GNOME 50 的内部结构，升级前请留意）。
- Wayland 下改 JS 需要注销重登；只改配置则即时生效。
- 用的是 shell 内部 API（`_system`、`quickSettingsItems`），GNOME 大版本升级可能需要适配。

## License

MIT（见 [LICENSE](LICENSE)）。

---

**English**: A small GNOME Shell 50 extension that tweaks the Quick Settings system row:
left battery button cycles power profiles (performance → balanced → power-saver) on left click and
opens the power panel on right click; the right side shows up to five reorderable icon buttons picked
from a 21-icon pool (plus user-defined command buttons), with a built-in screen-recorder button.
