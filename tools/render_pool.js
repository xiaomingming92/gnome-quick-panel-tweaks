// 渲染 docs/pool.png：把图标池里的真实主题图标 + 名称拼成一张总览图
// 用法：node tools/render_pool.js
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');

function loadPlaywright() {
    const candidates = [
        process.env.PLAYWRIGHT_PATH,
        'playwright',
        '/home/xmm/ai/farm-agent/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright',
    ].filter(Boolean);
    for (const c of candidates) {
        try {
            return require(c);
        } catch (e) { /* 继续 */ }
    }
    throw new Error('找不到 playwright，可用 PLAYWRIGHT_PATH 指定');
}

const ROOT = path.resolve(__dirname, '..');
const POOL = [
    ['system', '录屏', 'record-screen-symbolic'],
    ['system', '截图', 'screenshooter-symbolic'],
    ['system', '锁屏', 'system-lock-screen-symbolic'],
    ['system', '注销', 'system-log-out-symbolic'],
    ['system', '待机', 'media-playback-pause-symbolic'],
    ['system', '重启', 'system-reboot-symbolic'],
    ['system', '关机', 'system-shutdown-symbolic'],
    ['settings', '设置', 'preferences-system-symbolic'],
    ['settings', '电源设置', 'battery-symbolic'],
    ['settings', '网络设置', 'network-wireless-symbolic'],
    ['settings', '蓝牙设置', 'bluetooth-symbolic'],
    ['settings', '声音设置', 'audio-volume-high-symbolic'],
    ['settings', '辅助功能', 'preferences-desktop-accessibility-symbolic'],
    ['toggles', '勿扰', 'notifications-disabled-symbolic'],
    ['toggles', '夜灯', 'night-light-symbolic'],
    ['toggles', '深色模式', 'weather-clear-night-symbolic'],
    ['toggles', '静音', 'audio-volume-muted-symbolic'],
    ['apps', '终端', 'org.gnome.Terminal'],
    ['apps', '文件', 'org.gnome.Nautilus'],
    ['apps', '浏览器', 'google-chrome'],
    ['apps', 'VS Code', 'vscode'],
];

const GLYPH_COLOR = '#e95420';   // 符号图标颜色：Ubuntu 主色（GNOME palette orange 为 '#ed5b00'）
const SHELL_ICONS = ['record-screen-symbolic', 'screenshooter-symbolic'];
// 有些 App 的图标不在图标主题里（直接放在自己的安装目录）
const EXTRA_ICONS = {
    vscode: '/usr/share/code/resources/app/resources/linux/code.png',
};

function findIcon(name) {
    if (EXTRA_ICONS[name] && fs.existsSync(EXTRA_ICONS[name]))
        return EXTRA_ICONS[name];
    if (SHELL_ICONS.includes(name)) {
        const tmp = `/tmp/pool-${name}.svg`;
        try {
            const xml = execFileSync('gresource', ['extract', '/usr/share/gnome-shell/gnome-shell-icons.gresource',
                `/org/gnome/shell/icons/scalable/actions/${name}.svg`], {encoding: 'utf8'});
            fs.writeFileSync(tmp, xml);
            return tmp;
        } catch (e) { /* 落到下面找主题 */ }
    }
    const roots = ['/usr/share/icons/Yaru', '/usr/share/icons/Adwaita', '/usr/share/icons/hicolor'];
    for (const root of roots) {
        const hit = execFileSync('bash', ['-lc',
            `ls ${root}/*/*/${name}.svg ${root}/*/*/${name}.png ${root}/*/${name}.svg ` +
            `${root}/*/${name}.png 2>/dev/null | head -1`], {encoding: 'utf8'}).trim();
        if (hit)
            return hit;
    }
    return null;
}

// 内联符号图标：
//  1) 沿用原文件的 viewBox（主题图标多是 16×16，写死 24 会缩在左上角、看着不居中）
//  2) 把显式的 fill/stroke 全改写成 currentColor —— 不管是 fill 型、stroke 型
//     还是 <use>/<symbol> 型，最后都是同一个颜色，不会出现有的深有的浅
function inlineGlyph(file, color) {
    const xml = fs.readFileSync(file, 'utf8')
        .replace(/<\?xml[^>]*\?>/g, '')
        .replace(/<!DOCTYPE[^>]*>/g, '');
    const tag = xml.match(/<svg[^>]*>/i)?.[0] ?? '';
    const box = tag.match(/viewBox="([^"]+)"/i)?.[1]
        ?? (() => {
            const w = tag.match(/width="([\d.]+)/i)?.[1];
            const h = tag.match(/height="([\d.]+)/i)?.[1];
            return w && h ? `0 0 ${w} ${h}` : '0 0 16 16';
        })();
    const inner = xml
        .replace(/^[\s\S]*?<svg[^>]*>/i, '')
        .replace(/<\/svg>\s*$/i, '')
        .replace(/\s(fill|stroke)="(?!none")[^"]*"/g, ' $1="currentColor"');
    return `<svg viewBox="${box}" width="18" height="18" style="color:${color};display:block">${inner}</svg>`;
}

const groups = {'system': '系统 / 会话', 'settings': '设置入口', 'toggles': '一键开关', 'apps': '常用应用'};
let cards = '';
let lastGroup = null;
for (const [group, label, icon] of POOL) {
    if (group !== lastGroup) {
        if (lastGroup !== null)
            cards += '</div>';
        cards += `<h2>${groups[group]}</h2><div class="grid">`;
        lastGroup = group;
    }
    const file = findIcon(icon);
    const isApp = group === 'apps';
    // 彩色应用图标直接引用原文件（内联会丢 defs/渐变），符号图标内联后统一染色并居中
    const art = !file ? ''
        : isApp ? `<img src="file://${file}">`
        : inlineGlyph(file, GLYPH_COLOR);
    cards += `<div class="card"><div class="icon${isApp ? ' app' : ''}">${art}</div>` +
        `<div class="text"><div class="label">${label}</div><div class="id">${icon}</div></div></div>`;
}
if (lastGroup !== null)
    cards += '</div>';

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin:0; background:#1c1c1e; color:#e8e8ea; font:14px "Noto Sans CJK SC", system-ui, sans-serif; padding:28px 32px; }
h1 { font-size:22px; margin:4px 0 6px; }
.sub { color:#9a9aa2; font-size:13px; margin-bottom:18px; }
h2 { font-size:15px; color:#c8c8d0; margin:22px 0 10px; font-weight:600; }
/* 卡片走 flex：固定宽高 + 内容垂直居中，行与行严格对齐 */
.grid { display:flex; flex-wrap:wrap; gap:12px; align-items:stretch; }
.card {
  flex:0 0 250px; height:66px; box-sizing:border-box;
  background:#26262a; border-radius:14px; padding:0 14px;
  display:flex; align-items:center; gap:12px;
}
.icon {
  flex:0 0 36px; width:36px; height:36px; border-radius:50%; background:#3a3a40;
  display:flex; align-items:center; justify-content:center;
}
/* 符号图标统一颜色：想换成系统主色就改 GLYPH_COLOR 常量（脚本顶部） */
.icon.app { background:#f3f3f5; }
.icon.app img { width:20px; height:20px; display:block; }
.text { min-width:0; display:flex; flex-direction:column; justify-content:center; gap:3px; }
.label { font-size:13.5px; line-height:1.1; }
.id { font-size:9.5px; color:#8b8b93; font-family:ui-monospace, monospace; line-height:1.25; word-break:break-all; }
</style></head><body>
<h1>Quick Panel Tweaks · 图标池</h1>
<div class="sub">21 个内置图标，右侧最多显示 5 个（可在设置里排序 / 勾选），另外可添加任意自定义命令按钮</div>
${cards}
</body></html>`;

fs.mkdirSync(path.join(ROOT, 'docs'), {recursive: true});
const htmlPath = '/tmp/pool-preview.html';
fs.writeFileSync(htmlPath, html);

(async () => {
    const {chromium} = loadPlaywright();
    const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
    const page = await browser.newPage({viewport: {width: 900, height: 900}, deviceScaleFactor: 2});
    await page.goto('file://' + htmlPath);
    const out = path.join(ROOT, 'docs/pool.png');
    await page.screenshot({path: out, fullPage: true});
    await browser.close();
    console.log('✓ 生成', out);
})();
