const SYSTEM_NAME = '本机电池'
const MAX_SUMMARY_CHARS = 500

function isFiniteLevel(level) {
  return Number.isFinite(level) && level >= 0 && level <= 100
}

export function visibleDevices(snapshot, config) {
  const devices = Array.isArray(snapshot?.devices) ? snapshot.devices : []
  const filtered = devices.filter((device) => {
    if (!device || typeof device !== 'object') return false
    if (!isFiniteLevel(device.level)) return false
    if (device.kind === 'system' && config?.showSystem === false) return false
    return true
  })
  return filtered.slice().sort((left, right) => {
    const rank = (device) => (device.kind === 'system' ? 0 : device.kind === 'wireless' ? 1 : 2)
    if (rank(left) !== rank(right)) return rank(left) - rank(right)
    if (left.level !== right.level) return left.level - right.level
    return String(left.name).localeCompare(String(right.name), 'zh-Hans-CN')
  })
}

export function isLowBattery(device, threshold) {
  if (!device || !isFiniteLevel(device.level)) return false
  if (device.charging) return false
  if (device.kind === 'system' && device.plugged) return false
  return device.level <= Number(threshold)
}

export function hasLowBattery(snapshot, config) {
  return visibleDevices(snapshot, config).some((device) => isLowBattery(device, config?.lowThreshold ?? 20))
}

function shortName(device) {
  if (device.kind === 'system') return SYSTEM_NAME
  return String(device.name || '蓝牙设备')
}

function statusSuffix(device) {
  if (device.charging) return ' 充电中'
  if (device.kind === 'system' && device.plugged) return ' 已接电源'
  return ''
}

function formatClock(updatedAt) {
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleTimeString('zh-CN', { hour12: false })
}

export function buildSummary(snapshot, config) {
  const devices = visibleDevices(snapshot, config)
  const threshold = config?.lowThreshold ?? 20
  if (devices.length === 0) {
    if (snapshot?.error) return `暂时读不到电量：${String(snapshot.error).slice(0, 120)}`
    return '暂未读取到带电量信息的设备'
  }
  const parts = devices.slice(0, 4).map((device) => {
    const mark = isLowBattery(device, threshold) ? '⚠ ' : ''
    return `${mark}${shortName(device)} ${device.level}%${statusSuffix(device)}`
  })
  if (devices.length > 4) parts.push(`另有 ${devices.length - 4} 个设备`)
  return parts.join(' · ').slice(0, MAX_SUMMARY_CHARS)
}

function displayWidth(text) {
  let width = 0
  for (const char of String(text)) {
    width += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1
  }
  return width
}

function padToWidth(text, width) {
  const current = displayWidth(text)
  if (current >= width) return text
  return text + ' '.repeat(width - current)
}

function truncateToWidth(text, width) {
  let result = ''
  let used = 0
  for (const char of String(text)) {
    const size = displayWidth(char)
    if (used + size > width) break
    result += char
    used += size
  }
  return used < displayWidth(text) ? `${result}…` : result
}

export function buildListText(snapshot, config) {
  const devices = visibleDevices(snapshot, config)
  const threshold = config?.lowThreshold ?? 20
  const lines = ['PowerPulse 设备电量', `更新于 ${formatClock(snapshot?.updatedAt)}`, '─'.repeat(34)]
  if (devices.length === 0) {
    lines.push('当前没有读取到带电量信息的设备。')
    if (!config?.showSystem) lines.push('本机电池已在设置中隐藏。')
    else lines.push('台式机没有系统电池，蓝牙外设也可能不上报电量。')
    if (snapshot?.error) lines.push(`说明：${String(snapshot.error).slice(0, 200)}`)
  } else {
    for (const device of devices) {
      const name = truncateToWidth(shortName(device), 18)
      const level = `${device.level}%`.padStart(4)
      const tags = []
      if (device.charging) tags.push('充电中')
      else if (device.kind === 'system' && device.plugged) tags.push('已接电源')
      if (isLowBattery(device, threshold)) tags.push('低电量')
      if (Number.isFinite(device.minutesLeft) && device.minutesLeft > 0 && !device.plugged) {
        tags.push(`约 ${Math.round(device.minutesLeft / 60 * 10) / 10} 小时`)
      }
      lines.push(`${padToWidth(name, 18)} ${level}  ${tags.join(' · ')}`.trimEnd())
    }
  }
  lines.push('─'.repeat(34))
  lines.push(`共 ${devices.length} 个设备 · 间隔 ${config?.intervalSec ?? 10} 秒`)
  return lines.join('\n')
}
