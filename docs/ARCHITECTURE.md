# 架构

## 进程模型

- 插件入口 `index.mjs` 创建 `createPowerPulsePlugin`。
- 插件宿主运行在 Twilight Echo 的 utilityProcess 中。
- Windows 下启动一个常驻 PowerShell 子进程，按间隔输出单行 JSON；子进程退出后按 1s → 2s → 5s → 15s → 30s 退避重启。
- `deactivate` 终止子进程并清空快照。

## UI 贡献（1.4.0）

| 类型 | id | 行为 |
|---|---|---|
| sidebar widget | `te-powerpulse-sidebar` | 宿主补丁注入左侧导航底部，复用 `window.__teExecuteCoreExtension` |
| `titleBarButton` | `powerpulse-titlebar` | 标题栏“设备电量”按钮，点击打开 `powerpulse-panel` |
| experience panel | `powerpulse-panel` | `ui/panel.html`，`bridgeVersion: 2`，`launch: "panel"` |
| `settingsPanel` | `powerpulse-settings` | 设置 → 系统与关于，表单命令 `powerpulse.overview` |
| `playerBarButton` | `powerpulse-bar` | 播放栏按钮，命令 `powerpulse.toast` |

1.4.0 没有侧边栏内嵌小组件扩展点。标题栏面板走原生 API；侧边栏卡片由 `host/` 补丁实现，补丁把应用自己的 `executeCoreExtension` 暴露为 `window.__teExecuteCoreExtension`，卡片复用同一个 Core 连接。

`host/` 不进入 `.tep`。

## 标题栏面板桥接

1. `ExperienceFlyout` 加载 `plugin-ui://<pluginId>/<version>/ui/panel.html`。
2. iframe 发送 `twilight-experience-ready`（bridgeVersion 2）。
3. 宿主回传 `twilight-experience-connect` 和 MessagePort。
4. iframe 通过端口发送 `{ id, method: "plugin.request", args: { request } }`。
5. 宿主转到 `extensions.pluginRequest`，再进入插件的 `context.twilight.experience.onRequest`。
6. 插件返回 `buildForm(snapshot)`；面板渲染 `devices` / `config`。

`plugin.request` 在体验桥里映射到 `network` 权限，所以 `plugin.json` 声明了 `network`。

## 侧边栏补丁

1. `index.html` 注入 `powerpulse-sidebar.js`。
2. 主渲染 bundle 中 `const executeCoreExtension = ...` 改为同时赋值 `window.__teExecuteCoreExtension`。
3. 卡片等待该函数出现，调用 `executeCoreExtension('powerpulse.overview', [{ source: 'sidebar' }])`。
4. 这条路径使用应用自己的 Core 连接，不创建第二个连接，也不需要旧的 preload IPC。

## 数据流

```text
PowerShell 单行 JSON
  → normalizeDevices
  → snapshot { devices, updatedAt, error }
  → buildForm
      ├─ settingsPanel
      ├─ experience panel
      └─ playerBar toast
```

`snapshotNow` 优先返回缓存；超过 `max(3 × interval, 15s)` 才等待新快照，最多 4.2 秒。

## 刷新

- 采集间隔：默认 10 秒，1 秒–5 分钟。
- 标题栏面板：每 5 秒调用一次 `powerpulse.overview`；面板只在打开时轮询。
- 设置保存：立即更新采集器间隔，面板下一次轮询读取新配置。

## 超时

- 宿主 UI 命令 5 秒。
- 快照首次读取 4.2 秒。
- 体验桥 `plugin.request` 没有 5 秒限制；面板自身 12 秒超时并重试。

## 目录

```text
plugin.json
index.mjs
lib/create-plugin.mjs
lib/collector.mjs
lib/pp-collect.ps1
lib/format.mjs
lib/config.mjs
ui/panel.html
ui/panel.css
ui/panel.js
host/                 1.4.0 侧边栏补丁
```
