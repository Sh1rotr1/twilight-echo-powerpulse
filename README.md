# PowerPulse 设备电量

Twilight Echo 插件：读取本机电池、Razer 2.4G 无线外设与蓝牙设备的电量，只显示当前有电量数值的设备。

- 插件 ID：`com.sh1rotr1.powerpulse`
- 版本：`0.1.0`
- 宿主 API：`apiVersion 3`
- 权限：`settings`、`ui:inject`
- 仓库：https://github.com/Sh1rotr1/twilight-echo-powerpulse

## 支持设备（本机实测）

| 设备 | VID:PID | 读取方式 | 状态 |
|---|---|---|---|
| Razer Viper V4 Pro | `1532:00E6` | Razer 91 字节 HID Feature Report（class `0x07` / id `0x80`、`0x84`） | 已验证，电量与充电状态正常 |
| Razer BlackWidow V4 Tenkeyless HyperSpeed | `1532:02D7`（2.4G） | 91 字节接口目前只返回遥测，未响应电池命令 | 待补协议/官方驱动路径 |
| Xbox 无线控制器 | `045E:0B12`（USB）/ BTHLE | 蓝牙 GATT 电量 | 当前 USB 连接，不走电量上报 |
| UGREEN USB MIC-CM379 | `2B89:D82F` | USB 音频 + 麦克风，无电池 | 不显示 |
| MOONDROP DAWN PRO2（USB 音频端点） | USB 音频 | 有线 DAC，无电池 | 不显示 |

2.4G 外设是否可读取决于厂商协议。当前内置 Razer 协议；其它厂商需要按设备补充协议表。

### Razer 键盘的读取方式

BlackWidow V4 Tenkeyless HyperSpeed 有三种 USB 身份：

| 模式 | PID | 电池读取 |
|---|---|---|
| USB 有线 | `1532:02D5` | 不暴露电池命令；91 字节接口是遥测块，51/64 字节接口是按键统计 |
| 2.4G 接收器 | `1532:02D7` | 91 字节接口仍只返回遥测，Razer 官方驱动 `RZCONTROL` 是后续路径 |
| 蓝牙 | `02D6`（BLE HID） | Windows 通过 GATT 暴露电量，走内置蓝牙读取器 |

有线或 2.4G 模式下目前都读不到这块键盘的电池；切到蓝牙后由 GATT 读取器处理。

## 显示位置

主入口是侧边栏底部的设备卡片（在“导入歌曲 / 编辑页面”上方）。1.3.1 的插件 API 没有侧边栏内嵌挂载点，这张卡片由仓库里的 `host/` 补丁注入；插件本身只提供数据与设置。

| 入口 | 位置 | 命令 | 内容 |
|---|---|---|---|
| 侧边栏卡片 | 左侧导航底部（宿主补丁） | `powerpulse.overview` | 所有带电量设备的名称、进度条、百分比、充电标记 |
| 设置面板 | 设置 → 插件设置 → PowerPulse 设备电量 | `powerpulse.overview` | 摘要 + 刷新间隔 / 显示本机 / 低电量阈值 / 提示开关 |
| 播放栏按钮 | 底部播放栏 → 设备电量 | `powerpulse.toast` | 摘要写入“任务与通知”（标题栏铃铛）；低电量使用 warning 类别 |

不再注册独立的“设备电量”导航页；完整设备列表直接在侧边栏卡片中滚动显示。

宿主补丁只改两个文件：

```text
out/renderer/index.html                 +1 行 <script type="module" src="./powerpulse-sidebar.js">
out/renderer/powerpulse-sidebar.js      新增
```

补丁脚本、安装器和还原命令在仓库的 `host/` 目录：

```powershell
npm install
# 安装（需先完全退出 Twilight Echo）
node host/install-sidebar.mjs

# 还原
node host/install-sidebar.mjs --restore
```

备份文件：`D:\TwilightEcho\resources\app.asar.powerpulse-sidebar-backup`。

宿主补丁只用于本地集成参考；`.tep` 本身不包含 `host/`，安装 `.tep` 不会修改应用文件。

## 数据来源

| 来源 | 读取方式 | 说明 |
|---|---|---|
| 本机电池 | `Win32_Battery` + `root\wmi BatteryStatus` | 百分比、充电/接电状态、剩余分钟数 |
| Razer 2.4G 外设 | HID Feature Report，命令 class `0x07` / id `0x80`（电量）、`0x84`（充电） | 91 字节 Razer 协议；Viper V4 Pro 实测可用 |
| 蓝牙设备 | `SetupAPI` 读取 `DEVPKEY_Bluetooth_Battery` | 只读取设备主动上报的 GATT 电量 |

- 蓝牙电量通过 `SetupDiGetDevicePropertyW` 直接读取，本机实测单次扫描约 7 ms；PowerShell 的 `Get-PnpDeviceProperty` 在同一台机器上单设备需要 1.7–8 秒，因此没有采用。
- Razer 设备通过 `HidD_SetFeature` / `HidD_GetFeature` 直接发送 91 字节厂商报文；电量原始值 0–255 线性换算到 0–100。
- 手机、平板通常不上报电量；2.4G 接收器外设是否可读取决于厂商协议。当前内置 Razer 协议，其它厂商需要按设备协议补充。
- 参考实现：[2.4G-battery-viewer](https://github.com/yszyszysz233/2.4G-battery-viewer)（本插件借用了其“逐设备厂商报文”的思路，没有引入其依赖）。

## 刷新与稳定性

- 默认 10 秒，可在设置中选择 1 秒–5 分钟。
- 插件在 utilityProcess 内启动一个常驻 Windows PowerShell 子进程，按间隔输出单行 JSON。
- 子进程退出后按 1s → 2s → 5s → 15s → 30s 退避重启；`deactivate` 时终止。
- 宿主 UI 命令超时为 5 秒；快照命令只读缓存，首次读取最多等待 3 秒。
- 1.3.1 的 `ui.notify` 对 `info` / `warning` 走“任务与通知”记录，不弹浮动 toast；低电量时铃铛处会出现未读标记。

## 安装（本地）

1. 在扩展中心 → 从文件安装，选择 Release 里的 `com.sh1rotr1.powerpulse-0.1.0.tep`。
2. 启用插件。
3. 侧边栏卡片是宿主补丁，按上一节的 `host/` 步骤安装；不安装补丁时仍可使用设置面板与播放栏按钮。
4. 设置 → 插件设置 → PowerPulse 设备电量。

插件运行位置：

```text
%APPDATA%\TwilightEcho\plugins\com.sh1rotr1.powerpulse\0.1.0\
```

插件数据（仅 `context.settings`）：

```text
%APPDATA%\TwilightEcho\plugin-data\com.sh1rotr1.powerpulse\settings.json
```

存储的是 `{ schemaVersion: 1, intervalSec, showSystem, lowThreshold, toastSummary }`；旧版本缺少 `schemaVersion` 时按同一套规则归一化，不会丢字段。

## 开发

```powershell
npm install
npm test                  # 单元测试
npm run build:tep         # 用官方 CLI 打包到 dist/
node test/integration.mjs # 真实 PowerShell 单次采集
node test/loop-check.mjs  # 连续采集 + 子进程退出检查
```

打包需要官方 `create-twilight-plugin` CLI：把 `Twilight_Echo` 克隆到仓库旁边，或设置 `TE_CLI` 指向 CLI 路径。

## 已知边界

- 仅支持 Windows；其他平台激活后显示“当前系统不支持设备电量读取”。
- 蓝牙设备电量依赖驱动与设备上报；没有上报的设备不会显示。
- 2.4G 外设目前只内置 Razer 协议；Razer 键盘在 USB/2.4G 下的 91 字节接口仍只返回遥测，正在补官方驱动路径。
- 侧边栏卡片依赖 `host/` 补丁；只安装 `.tep` 时使用设置面板与播放栏按钮。
- 其它厂商（ATK/VXE、Endgame、VAXEE、Nordic、杰理方案耳机等）需要单独补充协议；参考 [2.4G-battery-viewer](https://github.com/yszyszysz233/2.4G-battery-viewer) 的逐设备方法。
- 应用升级或插件更新后需要重新检查 `plugin.json`、UI 扩展点和命令返回结构。
- 不申请 `network`、`filesystem:*`、`player:*`；不写入插件目录以外的文件。
