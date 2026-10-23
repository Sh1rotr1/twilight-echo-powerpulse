# 适配手册

Twilight Echo 升级后按下面顺序检查。

## 1. 版本与 API

```powershell
Get-Item "D:\TwilightEcho\resources\app.asar" | Select-Object Length,LastWriteTime
```

确认宿主仍支持 `apiVersion 3`，并且 `normalizeUiContribution` 的 kind 白名单没有变化：

```text
sidebarPage / playerBarButton / settingsPanel / localSidebarItem / streamingHome
```

## 2. 命令返回结构

宿主对 `settingsPanel` 的返回值解析在 `SettingsPage-*.js` 的 `normalizePluginSettingsForm`：

- 必须有 `kind: 'settings-form'`
- `submitCommand` 非空、长度 ≤ 160
- `fields` 数组，最多 20 个
- 字段类型只接受 `text` / `password` / `url` / `select`
- `notice` 最多 500 字符

若新版放宽或收紧，更新 `lib/create-plugin.mjs` 的 `buildForm`。

## 3. UI 扩展点

| 扩展点 | 变化风险 | 检查 |
|---|---|---|
| `settingsPanel` | 表单字段类型、notice 长度 | `normalizePluginSettingsForm` |
| `sidebarPage` | 命令结果仍按文本渲染 | `PluginExtensionPage-*.js` |
| `playerBarButton` | 点击执行命令、参数为当前曲目 | `PlayerBar-*.js` |

## 4. 系统数据源

- 本机电池：`Win32_Battery` 字段与 `BatteryStatus` 值域。
- 蓝牙电量：`DEVPKEY_Bluetooth_Battery` 的 GUID 与 PID（`{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2`）；Windows 大版本升级后确认设备仍在该键上报。
- 如果新系统把电量移到其它 DEVPROPKEY，更新 `lib/pp-collect.ps1` 中的 `pkeyBattery`。

## 5. 标题栏 / 歌词 / 迷你播放器

宿主当前没有这三个位置的插件挂载点。若未来版本新增（例如 `ui.register` 增加 `titlebarItem` 或通用 slot），优先使用宿主扩展点，不要改 `app.asar`。

## 6. 验证

```powershell
npm test
node test\integration.mjs
node test\loop-check.mjs
```

然后在设置页、侧边栏、播放栏各看一次；低电量设备应带 `⚠` 前缀。

## 7. 元数据

更新 `COMPATIBILITY.json` 的 `host.tested`、`CHANGELOG.md`；版本号只递增。
