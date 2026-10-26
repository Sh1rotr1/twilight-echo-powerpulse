# 适配手册

Twilight Echo 升级后按下面顺序检查。

## 1. 版本与 API

```powershell
Get-Item "D:\TwilightEcho\resources\app.asar" | Select-Object Length,LastWriteTime
```

确认宿主支持 `apiVersion 4`，并且 UI kind 白名单包含：

```text
sidebarPage / playerBarButton / settingsPanel / localSidebarItem / streamingHome / titleBarButton
```

1.4.0 的 titleBarButton 还需要 `contributes.experiences`（`bridgeVersion: 2`、`launch: "panel"`）；`plugin.request` 需要 `network` 权限。

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
| `titleBarButton` | 需要 panel experience 才打开 | `App-*.js` 的 `pluginTitleButtons` |
| experience panel | `plugin.request` → `experience.onRequest` | `experienceBridge-*.js` |
| `playerBarButton` | 点击执行命令、参数为当前曲目 | `PlayerBar-*.js` |

## 4. 系统数据源

- 本机电池：`Win32_Battery` 字段与 `BatteryStatus` 值域。
- 蓝牙电量：`DEVPKEY_Bluetooth_Battery` 的 GUID 与 PID（`{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2`）；Windows 大版本升级后确认设备仍在该键上报。
- 如果新系统把电量移到其它 DEVPROPKEY，更新 `lib/pp-collect.ps1` 中的 `pkeyBattery`。

## 5. 标题栏 / 歌词 / 迷你播放器

1.4.0 新增 `titleBarButton` + panel experience，已用于标题栏设备面板。

歌词和迷你播放器仍没有插件 UI 挂载点；若未来新增，优先使用宿主扩展点，不要改 `app.asar`。

## 6. 验证

```powershell
npm test
node test\integration.mjs
node test\loop-check.mjs
```

然后在标题栏面板、设置页、播放栏各看一次；低电量设备的百分比和进度条应变红。

## 7. 元数据

更新 `COMPATIBILITY.json` 的 `host.tested`、`CHANGELOG.md`；版本号只递增。
