# 侧边栏卡片宿主补丁

Twilight Echo 1.3.1 的插件 API 没有侧边栏内嵌挂载点。这个补丁把设备卡片注入到左侧导航底部（“导入歌曲 / 编辑页面”上方）。

## 补丁点

| 文件 | 改动 |
|---|---|
| `out/renderer/index.html` | 在 `</body>` 前加入 `<script type="module" src="./powerpulse-sidebar.js"></script>` |
| `out/renderer/powerpulse-sidebar.js` | 新增渲染脚本 |

不改主进程、preload、CSP、EXE 或用户配置。

## 安装

需要 Node.js 22+。在仓库根目录执行一次 `npm install`（安装 `@electron/asar`），然后完全退出 Twilight Echo：

```powershell
npm install
node host/install-sidebar.mjs
```

默认目标：

```text
D:\TwilightEcho\resources\app.asar
```

如果安装目录不同：

```powershell
node host/install-sidebar.mjs --asar "E:\Other\TwilightEcho\resources\app.asar"
```

安装器会：

1. 备份原包到 `<app.asar>.powerpulse-sidebar-backup`
2. 解包、写入脚本、注入一行 `<script>`
3. 重新打包并校验
4. 覆盖 `app.asar`

先验证不写入：

```powershell
node host/install-sidebar.mjs --dry-run
```

## 还原

```powershell
node host/install-sidebar.mjs --restore
```

## 与插件的关系

补丁只负责“把卡片放进侧边栏”。卡片的数据来自插件的 `powerpulse.overview` 命令，所以还需要安装 `com.sh1rotr1.powerpulse` 插件并启用。

应用升级会覆盖 `app.asar`，升级后需要重新运行安装器。
