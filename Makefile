UUID    := quick-panel-tweaks@xiaomingming92.github.io
DEST    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
FILES   := metadata.json extension.js prefs.js config.js pool.js stylesheet.css

.PHONY: help install uninstall enable disable pack log

help:
	@echo "make install    安装/更新到 ~/.local/share/gnome-shell/extensions"
	@echo "make enable     启用（Wayland 下新装扩展需要注销重登一次）"
	@echo "make disable    禁用"
	@echo "make pack       打包成 zip（可上传 extensions.gnome.org）"
	@echo "make log        查看 Shell 日志里的本扩展输出"

install:
	@mkdir -p $(DEST)
	@cp $(FILES) $(DEST)/
	@echo "✓ 已安装到 $(DEST)"
	@echo "  改动生效：配置即时生效；JS 改动需要注销重登（Wayland 无法重启 Shell）"

uninstall:
	@rm -rf $(DEST)
	@echo "✓ 已删除 $(DEST)"

enable:
	@gnome-extensions enable $(UUID) || echo "（若提示不存在：先注销重登一次）"

disable:
	@gnome-extensions disable $(UUID) || true

pack:
	@rm -f $(UUID).zip
	@zip -q $(UUID).zip $(FILES)
	@echo "✓ 生成 $(UUID).zip"

log:
	@journalctl --user -b -o cat | grep -i "quick-panel-tweaks" | tail -30
