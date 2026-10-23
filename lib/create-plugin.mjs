import {
  DEFAULT_CONFIG,
  buildConfigFields,
  migrateConfig,
  readConfigFormValues
} from './config.mjs'
import { buildListText, buildSummary, hasLowBattery, isLowBattery, visibleDevices } from './format.mjs'

const SETTINGS_KEY = 'config'
const COMMAND_OVERVIEW = 'powerpulse.overview'
const COMMAND_LIST = 'powerpulse.list'
const COMMAND_TOAST = 'powerpulse.toast'
const SNAPSHOT_TIMEOUT_MS = 3000
const FORM_VALUE_KEYS = ['intervalSec', 'showSystem', 'lowThreshold', 'toastSummary']

function looksLikeFormValues(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return FORM_VALUE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function emptySnapshot(error) {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    intervalSec: null,
    devices: [],
    error: error || null
  }
}

function isStale(snapshot, intervalSec) {
  if (!snapshot?.updatedAt) return true
  const updated = Date.parse(snapshot.updatedAt)
  if (!Number.isFinite(updated)) return true
  return Date.now() - updated > Math.max(intervalSec * 3, 15000)
}

export function createPowerPulsePlugin({ createCollector, scriptPath, platform = process.platform }) {
  let context = null
  let collector = null
  let collectorStart = null
  let config = { ...DEFAULT_CONFIG }
  let latest = null

  async function ensureCollector() {
    if (collector || platform !== 'win32' || !context) return collector
    if (collectorStart) return collectorStart
    collectorStart = (async () => {
      try {
        const instance = createCollector({
          scriptPath,
          intervalSec: config.intervalSec,
          logger: context.logger,
          onSnapshot: (snapshot) => {
            latest = snapshot
          }
        })
        instance.start()
        collector = instance
      } catch (error) {
        context.logger.error(
          `powerpulse: collector start failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
      return collector
    })().finally(() => {
      collectorStart = null
    })
    return collectorStart
  }

  async function snapshotNow() {
    if (latest && !isStale(latest, config.intervalSec)) return latest
    await ensureCollector()
    if (!collector) {
      return emptySnapshot(platform === 'win32' ? '设备电量采集器未启动' : '当前系统不支持设备电量读取')
    }
    const incoming = await collector.waitForSnapshot(SNAPSHOT_TIMEOUT_MS)
    if (incoming) return incoming
    return latest ?? emptySnapshot('正在读取设备电量…')
  }

  function buildForm(snapshot, extraNotice) {
    const summary = buildSummary(snapshot, config)
    const notice = [summary, extraNotice].filter(Boolean).join(' · ').slice(0, 500)
    const devices = visibleDevices(snapshot, config).map((device) => ({
      id: device.id,
      name: device.name,
      kind: device.kind,
      level: device.level,
      charging: Boolean(device.charging),
      low: isLowBattery(device, config.lowThreshold),
      source: device.source || ''
    }))
    return {
      kind: 'settings-form',
      submitCommand: COMMAND_OVERVIEW,
      notice,
      fields: buildConfigFields(config),
      // Extra payload for the optional host sidebar widget. The settings form
      // parser ignores unknown keys.
      devices,
      config: {
        intervalSec: config.intervalSec,
        lowThreshold: config.lowThreshold,
        updatedAt: snapshot?.updatedAt || null
      }
    }
  }

  async function saveConfig(values) {
    const next = readConfigFormValues(values, config)
    const intervalChanged = next.intervalSec !== config.intervalSec
    config = next
    try {
      await context.settings.set(SETTINGS_KEY, config)
    } catch (error) {
      context.logger.warn(
        `powerpulse: config save failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    if (intervalChanged && collector) collector.setInterval(config.intervalSec)
    const snapshot = await snapshotNow()
    return { form: buildForm(snapshot, '已保存') }
  }

  async function activate(nextContext) {
    context = nextContext
    let stored = null
    try {
      stored = await context.settings.get(SETTINGS_KEY)
    } catch (error) {
      context.logger.warn(
        `powerpulse: config read failed: ${error instanceof Error ? error.message : String(error)}`
      )
    }
    config = migrateConfig(stored)
    if (!stored) {
      try {
        await context.settings.set(SETTINGS_KEY, config)
      } catch {
        // A read-only settings backend still lets the plugin run with defaults.
      }
    }

    context.twilight.ui.onCommand(COMMAND_OVERVIEW, async (payload) => {
      if (looksLikeFormValues(payload)) return saveConfig(payload)
      const snapshot = await snapshotNow()
      return buildForm(snapshot)
    })

    context.twilight.ui.onCommand(COMMAND_LIST, async () => {
      const snapshot = await snapshotNow()
      return buildListText(snapshot, config)
    })

    context.twilight.ui.onCommand(COMMAND_TOAST, async () => {
      const snapshot = await snapshotNow()
      const message = buildSummary(snapshot, config)
      if (config.toastSummary && typeof context.twilight.ui.notify === 'function') {
        await context.twilight.ui
          .notify({
            kind: hasLowBattery(snapshot, config) ? 'warning' : 'info',
            message,
            durationMs: 4500
          })
          .catch(() => undefined)
      }
      return message
    })

    await context.twilight.ui.register({
      id: 'powerpulse-settings',
      kind: 'settingsPanel',
      title: 'PowerPulse 设备电量',
      description: '本机电池、2.4G 无线外设与蓝牙设备的电量；侧边栏卡片显示同一份数据。',
      icon: 'ph ph-battery-full',
      command: COMMAND_OVERVIEW,
      autoLoad: true
    })

    await context.twilight.ui.register({
      id: 'powerpulse-bar',
      kind: 'playerBarButton',
      title: '设备电量',
      description: '把当前设备电量摘要写入任务与通知中心',
      icon: 'ph ph-battery-full',
      command: COMMAND_TOAST
    })

    await ensureCollector()
  }

  async function deactivate() {
    if (collector) {
      collector.stop()
      collector = null
    }
    collectorStart = null
    latest = null
    context = null
  }

  return { activate, deactivate }
}
