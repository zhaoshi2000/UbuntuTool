export const ACTIONS = [
    {key: 'open-clipboard', label: '剪贴板历史', windows: 'Win + V', accelerator: '<Super>v', always: true, action: 'clipboard'},
    {key: 'open-toolbox', label: '打开 UbuntuTool 工具箱', windows: 'Win + Shift + T', accelerator: '<Super><Shift>t', always: true, action: 'toolbox'},
    {key: 'take-screenshot', label: '截图并标注', windows: 'Alt + A', accelerator: '<Alt>a', always: true, action: 'screenshot'},
    {key: 'open-files', label: '文件资源管理器', windows: 'Win + E', accelerator: '<Super>e', action: 'files'},
    {key: 'open-run', label: '运行命令', windows: 'Win + R', accelerator: '<Super>r', action: 'run'},
    {key: 'open-settings', label: '系统设置', windows: 'Win + I', accelerator: '<Super>i', action: 'settings'},
    {key: 'open-search', label: '应用和文件搜索', windows: 'Win + S', accelerator: '<Super>s', action: 'search'},
    {key: 'open-quick-settings', label: '快速设置', windows: 'Win + A', accelerator: '<Super>a', action: 'quick-settings'},
    {key: 'open-task-manager', label: '任务管理器 / 系统监视器', windows: 'Ctrl + Shift + Esc', accelerator: '<Control><Shift>Escape', action: 'task-manager'},
    {key: 'open-emoji', label: '表情和符号面板', windows: 'Win + .', accelerator: '<Super>period', action: 'emoji'},
    {key: 'minimize-all', label: '最小化当前工作区全部窗口', windows: 'Win + M', accelerator: '<Super>m', action: 'minimize-all'},
    {key: 'restore-all', label: '恢复上次最小化的窗口', windows: 'Win + Shift + M', accelerator: '<Super><Shift>m', action: 'restore-all'},
];

export const SYSTEM_MAPPINGS = [
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'show-desktop', value: ['<Super>d'], label: '显示桌面', windows: 'Win + D'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'maximize', value: ['<Super>Up'], label: '最大化窗口', windows: 'Win + ↑'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'unmaximize', value: ['<Super>Down'], label: '还原窗口', windows: 'Win + ↓'},
    {schema: 'org.gnome.mutter.keybindings', key: 'toggle-tiled-left', value: ['<Super>Left'], label: '窗口靠左', windows: 'Win + ←'},
    {schema: 'org.gnome.mutter.keybindings', key: 'toggle-tiled-right', value: ['<Super>Right'], label: '窗口靠右', windows: 'Win + →'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-windows', value: ['<Alt>Tab'], label: '切换窗口', windows: 'Alt + Tab'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-windows-backward', value: ['<Shift><Alt>Tab'], label: '反向切换窗口', windows: 'Alt + Shift + Tab'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'close', value: ['<Alt>F4'], label: '关闭窗口', windows: 'Alt + F4'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'activate-window-menu', value: ['<Alt>space'], label: '窗口菜单', windows: 'Alt + 空格'},
    {schema: 'org.gnome.shell.keybindings', key: 'toggle-overview', value: ['<Super>Tab'], label: '任务视图', windows: 'Win + Tab'},
    {schema: 'org.gnome.shell.keybindings', key: 'show-screenshot-ui', value: ['<Super><Shift>s', 'Print'], label: '截图面板', windows: 'Win + Shift + S / Print'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-to-workspace-left', value: ['<Control><Super>Left'], label: '上一个工作区', windows: 'Ctrl + Win + ←'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'switch-to-workspace-right', value: ['<Control><Super>Right'], label: '下一个工作区', windows: 'Ctrl + Win + →'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'move-to-monitor-left', value: ['<Shift><Super>Left'], label: '移到左侧显示器', windows: 'Win + Shift + ←'},
    {schema: 'org.gnome.desktop.wm.keybindings', key: 'move-to-monitor-right', value: ['<Shift><Super>Right'], label: '移到右侧显示器', windows: 'Win + Shift + →'},
];

export const NATIVE_SHORTCUTS = [
    ['Ctrl + C / X / V', '复制 / 剪切 / 粘贴'], ['Ctrl + A', '全选'],
    ['Ctrl + Z / Shift + Z', '撤销 / 重做（部分应用使用 Ctrl+Y）'],
    ['Ctrl + S / Shift + S', '保存 / 另存为'], ['Ctrl + N / O / P', '新建 / 打开 / 打印'],
    ['Ctrl + F / H', '查找 / 替换（由应用决定）'], ['Ctrl + L', '地址栏'],
    ['Ctrl + T / W / Shift + T', '新建 / 关闭 / 恢复标签页'],
    ['Ctrl + Tab / Shift + Tab', '切换标签页'], ['F2', '重命名'],
    ['F5 / Ctrl + R', '刷新'], ['F11', '全屏'], ['Shift + Delete', '永久删除'],
    ['Alt + ← / →', '后退 / 前进'], ['Win + L', '锁定屏幕（Ubuntu 原生）'],
    ['Win + 数字键', '打开或切换 Dock 中的应用（Ubuntu Dock 原生）'],
    ['Win + 空格', '切换输入法（Ubuntu 原生）'],
];

export const LIMITATIONS = [
    ['Ctrl + Alt + Delete', 'Ubuntu 使用自己的会话 / 电源操作，不能复制 Windows 安全桌面。'],
    ['Win + Ctrl + D / F4', 'GNOME 默认动态管理工作区，不等同于 Windows 手动创建 / 关闭桌面。'],
    ['Win + P / K / G / H / U / X', '投影、连接、游戏栏、语音输入等系统专属功能不做虚假的一对一映射；可在自定义命令里指定 Ubuntu 应用。'],
    ['应用内部快捷键', '由应用自己处理；本工具不会全局改写 Ctrl、Alt 或绕过应用的按键行为。'],
];
