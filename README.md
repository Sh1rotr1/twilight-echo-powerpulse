# PowerPulse 设备电量

Twilight Echo 插件：读取本机电池、Razer 2.4G 无线外设与蓝牙设备的电量。

- 插件 ID：`com.sh1rotr1.powerpulse`
- 版本：`0.2.0`
- 宿主：Twilight Echo `>=1.4.0-perview`
- 插件 API：`apiVersion 4`
- 权限：`settings`、`ui:inject`、`network`
- 仓库：https://github.com/Sh1rotr1/twilight-echo-powerpulse

## 1.4.0 适配

1.4.0 的渲染层改成了 Core Connection，旧的 `window.api.extensions.executeCommand` 不再注册 IPC；插件 API 仍然没有“侧边栏内嵌小组件”扩展点，`sidebarPage` / `localSidebarItem` 只会生成导航项或页面，`titleBarButton` 打开的是标题栏弹出面板。

所以位置分两种：

- **不修改 `app.asar`**：标题栏按钮 + 原生面板可用。
- **保留侧边栏底部卡片**：需要 `host/` 补丁。补丁把渲染层自己的 `executeCoreExtension` 暴露为 `window.__teExecuteCoreExtension`，侧边栏卡片复用它调用 `powerpulse.overview`，不创建第二个 Core 连接，也不依赖旧 IPC。

补丁点：

```text
out/renderer/index.html                  +1 行侧边栏脚本
out/renderer/assets/index-*.js           +window.__teExecuteCoreExtension
out/renderer/powerpulse-sidebar.js       新增卡片脚本
```

## 显示位置

| 入口 | 位置 | 命令 | 内容 |
|---|---|---|---|
| 侧边栏卡片 | 左侧导航底部，“导入歌曲”上方（宿主补丁） | `powerpulse.overview` | 设备列表、进度条、百分比、充电标记、低电量红色 |
| 标题栏面板 | 标题栏星形按钮 → “设备电量”（原生） | `powerpulse.overview` | 同一份设备数据，5 秒刷新 |
| 设置面板 | 设置 → 系统与关于 → PowerPulse 设备电量 | `powerpulse.overview` | 摘要 + 刷新间隔 / 显示本机 / 低电量阈值 |
| 播放栏按钮 | 底部播放栏 → 设备电量 | `powerpulse.toast` | 摘要写入“任务与通知”；低电量使用 warning 类别 |

侧边栏卡片每 5 秒检查一次设置与数据；保存设置后 5 秒内同步。标题栏面板同样 5 秒刷新。

## 安装

1. 扩展中心 → 从文件安装。
2. 选择 `com.sh1rotr1.powerpulse-0.2.0.tep`。
3. 启用插件。
4. 需要侧边栏卡片时，完全退出 Twilight Echo，运行：

```powershell
cd E:\DSHworks\te-powerpulse
npm install
node host/install-sidebar.mjs
```

5. 重新启动。标题栏出现“设备电量”按钮，左侧导航底部出现设备卡片。

只安装 `.tep`、不打补丁时，标题栏面板、设置面板、播放栏按钮仍可用。

还原宿主：

```powershell
node host/install-sidebar.mjs --restore
```

备份：`D:\TwilightEcho\resources\app.asar.powerpulse-sidebar-backup`。

插件运行位置：

```text
%APPDATA%\TwilightEcho\plugins\com.sh1rotr1.powerpulse\0.2.0\
```

插件数据：

```text
%APPDATA%\TwilightEcho\plugin-data\com.sh1rotr1.powerpulse\settings.json
```

## 数据来源

| 来源 | 读取方式 | 说明 |
|---|---|---|
| 本机电池 | `Win32_Battery` + `root\wmi BatteryStatus` | 百分比、充电/接电状态、剩余分钟数 |
| Razer 2.4G 外设 | HID Feature Report，class `0x07` / id `0x80`（电量）、`0x84`（充电） | 91 字节 Razer 协议；Viper V4 Pro 实测可用 |
| 蓝牙设备 | `SetupAPI` 读取 `DEVPKEY_Bluetooth_Battery` | 只读取设备主动上报的 GATT 电量 |

- 蓝牙读取用 `SetupDiGetDevicePropertyW`，单次扫描约 7 ms。
- Razer 电量原始值 0–255 线性换算到 0–100。
- 2.4G 外设是否可读取决于厂商协议；当前内置 Razer，其它厂商需要按设备补充。
- 手机、平板通常不上报电量；USB 音频设备不显示。

## 设备状态

| 设备 | 连接 | 状态 |
|---|---|---|
| Razer Viper V4 Pro | `1532:00E6` | 已验证，电量与充电状态正常 |
| Razer BlackWidow V4 Tenkeyless HyperSpeed | `1532:02D5` / `02D7` / BLE `02D6` | 蓝牙 GATT 正常；2.4G 需要接收器链路 |
| Xbox 无线控制器 | USB / BTHLE | USB 下没有 GATT 电量 |
| UGREEN MIC-CM379 | USB 音频 | 无电池 |
| MOONDROP DAWN PRO2 | USB 音频 | 无电池 |

## 刷新与稳定性

- 默认 10 秒；设置里可选 1 秒–5 分钟。
- 插件在 utilityProcess 里启动常驻 PowerShell 子进程，按间隔输出单行 JSON。
- 子进程退出后按 1s → 2s → 5s → 15s → 30s 退避重启；`deactivate` 时终止。
- 宿主 UI 命令超时 5 秒；快照命令只读缓存，首次读取最多等待 4.2 秒。
- 标题栏面板通过 `plugin.request` 调用插件，`network` 权限是体验桥的 `plugin.request` 要求。
- `ui.notify` 的 `info` / `warning` 走“任务与通知”，低电量时铃铛出现未读标记。

## 目录

```text
plugin.json                 清单与 experiences 声明
index.mjs                   入口
lib/create-plugin.mjs       设置面板、标题栏按钮、播放栏、experience 请求
lib/collector.mjs           PowerShell 子进程管理
lib/pp-collect.ps1          系统电池 / 蓝牙 / Razer 采集
lib/format.mjs              摘要与列表格式
ui/panel.html               标题栏面板
ui/panel.css
ui/panel.js                 体验桥 handshake 与设备列表
host/                       1.4.0 侧边栏补丁（不进入 .tep）
docs/                       架构、适配、发布说明
```

## 开发

```powershell
npm install
npm test
npm run build:tep
node test/integration.mjs
node test/loop-check.mjs
```

打包需要官方 `create-twilight-plugin` CLI：把 `Twilight_Echo` 克隆到仓库旁边，或设置 `TE_CLI` 指向 CLI 路径。

## 已知边界

- 仅 Windows。
- 1.4.0 的侧边栏底部卡片需要 `host/` 补丁；不打补丁时使用标题栏面板。
- 应用更新会替换 `app.asar`，升级后需重新运行 `host/install-sidebar.mjs`。
- 2.4G 外设目前只内置 Razer；Razer 键盘在蓝牙模式下由 GATT 读取。
- 只安装 `.tep` 不会修改应用文件。

## 许可

MIT。
