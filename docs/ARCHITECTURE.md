# 架构

## 数据流

```text
Windows
  ├─ Win32_Battery / root\wmi BatteryStatus      本机电池
  ├─ SetupAPI DEVPKEY_Bluetooth_Battery          蓝牙外设电量
  └─ HID feature report (Razer 0x07/0x80)        2.4G 无线外设电量
        │
        ▼
lib/pp-collect.ps1（常驻 PowerShell 子进程）
  └─ while ($true) { 采集 → 输出单行 JSON → Start-Sleep }
        │ stdout
        ▼
lib/collector.mjs（utilityProcess）
  ├─ readline 逐行解析
  ├─ 校验 / 归一化 / 去重
  ├─ 崩溃退避重启
  └─ 缓存最新快照
        │
        ▼
lib/create-plugin.mjs
  ├─ powerpulse.overview → settings-form（提交时同一命令保存）
  ├─ powerpulse.list     → 纯文本列表
  ├─ powerpulse.toast    → ui.notify
  └─ 配置持久化 + 采集间隔重载
```

## 模块

| 路径 | 职责 |
|---|---|
| `index.mjs` | 宿主入口，组装采集器与插件 |
| `lib/create-plugin.mjs` | 命令、UI 注册、配置读写 |
| `lib/collector.mjs` | PowerShell 子进程生命周期与行协议 |
| `lib/pp-collect.ps1` | 采集脚本与 SetupAPI 读取 |
| `lib/config.mjs` | 默认值、迁移、表单字段 |
| `lib/format.mjs` | 摘要、列表、低电量判断 |

## 命令

| 命令 | 注册扩展点 | 返回 |
|---|---|---|
| `powerpulse.overview` | `settingsPanel`（autoLoad）；同时承担表单提交 | `{ kind: 'settings-form', submitCommand, notice, fields }` |
| `powerpulse.list` | `sidebarPage`（autoLoad） | `string` |
| `powerpulse.toast` | `playerBarButton` | `string`，并调用 `ui.notify` 写入“任务与通知” |

## Razer 2.4G 协议

- 目标接口：HID，`VID 0x1532`，Feature Report 长度 91。
- 报文：`[report id 0x00][status 0x00][transaction 0x1F][remaining 0x0000][protocol 0x00][data_size 0x02][class 0x07][id][80 字节参数][XOR CRC][0x00]`。
- 电量：class `0x07` / id `0x80`，响应 `status=0x02`，`arguments[1]` 为 0–255，换算 `level = round(raw * 100 / 255)`。
- 充电：class `0x07` / id `0x84`，`arguments[1] != 0` 表示充电中。
- 读取用 `HidD_SetFeature` + 300ms + `HidD_GetFeature`；结果缓存 5 秒，避免 1 秒刷新时频繁阻塞。
- 设备休眠或未连接时响应不是 `0x02`，本轮跳过，下一轮重试。

宿主 `executeUiCommand` 只派发“在某个 UI 扩展点里声明过”的命令。表单提交因此复用 `powerpulse.overview`：载荷里出现表单字段（`intervalSec` / `showSystem` / `lowThreshold` / `toastSummary`）时执行保存并返回 `{ form }`，否则返回设置表单。`submitCommand` 不能再指向未注册的独立命令。

`ui.notify` 的实际呈现：1.3.1 只对 `kind: 'error'` 或带 action 的通知走浮动 toast；`info` / `warning` 写入通知中心（标题栏铃铛）并计入未读。插件按该行为把播放栏按钮定义为“写入通知中心”。

宿主对 `settings-form` 的约束：`fields` 最多 20 个，`type` 只接受 `text` / `password` / `url` / `select`，`notice` 最多 500 字符。本插件按该约束生成字段。

## 行协议

PowerShell 每行输出一个 JSON 对象：

```json
{
  "updatedAt": "2026-10-20T14:21:57Z",
  "intervalSec": 10,
  "devices": [
    { "id": "system:0", "kind": "system", "name": "AP21A5T", "level": 100,
      "charging": false, "plugged": true, "minutesLeft": null,
      "source": "Win32_Battery" }
  ]
}
```

- `level` 不是 0–100 的设备直接丢弃。
- `devices` 是单对象时按单元素数组处理。
- 无效行只记日志，不抛异常，不影响后续行。
- 采集器连续报错且没有可用数据时，向 UI 返回 `error` 文本。

## 进程与超时

- 每次 `activate` 最多启动一个 PowerShell 子进程。
- 单行上限 64 KB；超过直接忽略。
- 宿主命令超时 5 秒；`snapshotNow` 最多等 3 秒，拿不到缓存时返回“正在读取设备电量…”。
- 宿主 5 分钟无命令会休眠插件，子进程随之退出；下次命令重新激活。

## 宿主能力边界

1.3.1 的 `ui` 扩展点白名单在 `out/main/index.js` 的 `normalizeUiContribution` 中，仅 5 种。桌面歌词与迷你播放器是独立 `BrowserWindow`，preload 只暴露各自专用 API。本插件不修改 `app.asar`，因此不向这三个位置注入任何内容。
