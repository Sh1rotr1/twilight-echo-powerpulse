export const CONFIG_SCHEMA_VERSION = 1

export const INTERVAL_OPTIONS = Object.freeze([
  { value: '1', label: '实时（1 秒）' },
  { value: '2', label: '2 秒' },
  { value: '5', label: '5 秒' },
  { value: '10', label: '10 秒（默认）' },
  { value: '30', label: '30 秒' },
  { value: '60', label: '1 分钟' },
  { value: '180', label: '3 分钟' },
  { value: '300', label: '5 分钟' }
])

export const DEFAULT_CONFIG = Object.freeze({
  schemaVersion: CONFIG_SCHEMA_VERSION,
  intervalSec: 10,
  showSystem: true,
  lowThreshold: 20,
  toastSummary: true
})

const ON_OFF_OPTIONS = Object.freeze([
  { value: 'on', label: '开启' },
  { value: 'off', label: '关闭' }
])

export function clampInterval(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_CONFIG.intervalSec
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.intervalSec
  return Math.min(300, Math.max(1, Math.round(parsed)))
}

export function clampThreshold(value) {
  if (value === null || value === undefined || value === '') return DEFAULT_CONFIG.lowThreshold
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_CONFIG.lowThreshold
  return Math.min(100, Math.max(1, Math.round(parsed)))
}

export function normalizeOnOff(value, fallback) {
  if (value === true || value === 'on' || value === 'true' || value === 1) return true
  if (value === false || value === 'off' || value === 'false' || value === 0) return false
  return fallback
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_CONFIG }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    intervalSec: clampInterval(raw.intervalSec),
    showSystem: normalizeOnOff(raw.showSystem, DEFAULT_CONFIG.showSystem),
    lowThreshold: clampThreshold(raw.lowThreshold),
    toastSummary: normalizeOnOff(raw.toastSummary, DEFAULT_CONFIG.toastSummary)
  }
}

/**
 * v0 configs are the pre-schema flat objects; they only need the same
 * normalization pass, so migration stays idempotent.
 */
export function migrateConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_CONFIG }
  const version = Number(raw.schemaVersion)
  if (Number.isFinite(version) && version >= CONFIG_SCHEMA_VERSION) return normalizeConfig(raw)
  return normalizeConfig({ ...raw, schemaVersion: CONFIG_SCHEMA_VERSION })
}

export function buildConfigFields(config) {
  return [
    {
      key: 'intervalSec',
      label: '刷新间隔',
      type: 'select',
      value: String(config.intervalSec),
      options: INTERVAL_OPTIONS.map((option) => ({ ...option }))
    },
    {
      key: 'showSystem',
      label: '显示本机电池',
      type: 'select',
      value: config.showSystem ? 'on' : 'off',
      options: ON_OFF_OPTIONS.map((option) => ({ ...option }))
    },
    {
      key: 'lowThreshold',
      label: '低电量阈值（1-100）',
      type: 'text',
      value: String(config.lowThreshold),
      placeholder: '20'
    },
    {
      key: 'toastSummary',
      label: '播放栏按钮写入通知中心',
      type: 'select',
      value: config.toastSummary ? 'on' : 'off',
      options: ON_OFF_OPTIONS.map((option) => ({ ...option }))
    }
  ]
}

export function readConfigFormValues(values, current) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return { ...current }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    intervalSec: clampInterval(values.intervalSec ?? current.intervalSec),
    showSystem: normalizeOnOff(values.showSystem, current.showSystem),
    lowThreshold: clampThreshold(values.lowThreshold ?? current.lowThreshold),
    toastSummary: normalizeOnOff(values.toastSummary, current.toastSummary)
  }
}
