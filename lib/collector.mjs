import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const MAX_LINE_LENGTH = 64 * 1024
const RESTART_DELAYS_MS = [1000, 2000, 5000, 15000, 30000]
const HEALTHY_RUN_MS = 60 * 1000
const DEFAULT_TIMEOUT_MS = 3000

export function resolvePowerShellPath(env = process.env) {
  const root = env.SystemRoot || env.windir
  if (root) {
    const candidate = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (existsSync(candidate)) return candidate
  }
  return 'powershell.exe'
}

function toLevel(value) {
  const level = Number(value)
  if (!Number.isFinite(level)) return null
  if (level < 0 || level > 100) return null
  return Math.round(level)
}

function toMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 100000) return null
  return Math.round(minutes)
}

export function normalizeDevices(rawDevices) {
  const list = Array.isArray(rawDevices)
    ? rawDevices
    : rawDevices && typeof rawDevices === 'object'
      ? [rawDevices]
      : []
  const devices = []
  const seen = new Set()
  for (const item of list) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const level = toLevel(item.level)
    if (level === null) continue
    const kind = item.kind === 'system' ? 'system' : item.kind === 'wireless' ? 'wireless' : 'bluetooth'
    const id = String(item.id || '').slice(0, 120) || `device:${devices.length}`
    if (seen.has(id)) continue
    seen.add(id)
    devices.push({
      id,
      kind,
      name: String(item.name || (kind === 'system' ? '本机电池' : '蓝牙设备')).slice(0, 80),
      level,
      charging: item.charging === true,
      plugged: item.plugged === true,
      minutesLeft: toMinutes(item.minutesLeft),
      source: String(item.source || '').slice(0, 60)
    })
  }
  return devices
}

/**
 * One PowerShell line in, one normalized snapshot out. Malformed lines are
 * rejected instead of throwing so a noisy child process cannot crash the plugin.
 */
export function parseSnapshotLine(line) {
  if (typeof line !== 'string') return { ok: false, error: 'snapshot line is not a string' }
  const trimmed = line.replace(/^\uFEFF/, '').trim()
  if (!trimmed) return { ok: false, error: 'empty snapshot line' }
  if (trimmed.length > MAX_LINE_LENGTH) return { ok: false, error: 'snapshot line is too long' }

  let raw
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'snapshot line is not valid JSON' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'snapshot payload is not an object' }
  }

  const devices = normalizeDevices(raw.devices)
  const error = typeof raw.error === 'string' && raw.error.trim() ? raw.error.trim().slice(0, 300) : null
  return {
    ok: true,
    snapshot: {
      schemaVersion: 1,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      intervalSec: Number.isFinite(Number(raw.intervalSec)) ? Number(raw.intervalSec) : null,
      devices,
      error
    }
  }
}

export function createCollector({ scriptPath, intervalSec, logger = console, onSnapshot = () => {} }) {
  let child = null
  let stopped = false
  let latest = null
  let currentInterval = Math.max(1, Math.round(Number(intervalSec) || 10))
  let restartIndex = 0
  let restartTimer = null
  let childStartedAt = 0
  let waiters = new Set()
  let stderrTail = ''

  function settleWaiters(snapshot) {
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve(snapshot)
    }
    waiters.clear()
  }

  function acceptSnapshot(snapshot) {
    if (snapshot.error && snapshot.devices.length === 0 && latest && latest.devices.length > 0) {
      logger.debug?.(`powerpulse: ignore transient collector error: ${snapshot.error}`)
      return
    }
    latest = snapshot
    settleWaiters(snapshot)
    try {
      onSnapshot(snapshot)
    } catch (error) {
      logger.warn?.(`powerpulse: snapshot callback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function clearRestartTimer() {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
  }

  function scheduleRestart(reason) {
    if (stopped) return
    if (Date.now() - childStartedAt > HEALTHY_RUN_MS) restartIndex = 0
    const delay = RESTART_DELAYS_MS[Math.min(restartIndex, RESTART_DELAYS_MS.length - 1)]
    restartIndex += 1
    logger.warn?.(`powerpulse: collector stopped (${reason}); restarting in ${delay}ms`)
    clearRestartTimer()
    restartTimer = setTimeout(() => {
      restartTimer = null
      startChild()
    }, delay)
    if (typeof restartTimer.unref === 'function') restartTimer.unref()
  }

  function startChild() {
    if (stopped) return
    const executable = resolvePowerShellPath()
    childStartedAt = Date.now()
    stderrTail = ''
    let options
    try {
      child = spawn(
        executable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath,
          '-IntervalSec',
          String(currentInterval)
        ],
        { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
      )
    } catch (error) {
      child = null
      scheduleRestart(error instanceof Error ? error.message : String(error))
      return
    }

    const stdout = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
    stdout.on('line', (line) => {
      const parsed = parseSnapshotLine(line)
      if (!parsed.ok) {
        logger.debug?.(`powerpulse: skip collector line: ${parsed.error}`)
        return
      }
      acceptSnapshot(parsed.snapshot)
    })

    child.stderr?.on('data', (chunk) => {
      stderrTail = (stderrTail + String(chunk)).slice(-2000)
    })

    child.on('error', (error) => {
      logger.warn?.(`powerpulse: collector spawn error: ${error.message}`)
      child = null
      scheduleRestart('spawn-error')
    })

    child.on('exit', (code, signal) => {
      child = null
      if (stopped) return
      const detail = signal ? `signal ${signal}` : `code ${code}`
      if (stderrTail.trim()) logger.debug?.(`powerpulse: collector stderr: ${stderrTail.trim().slice(-400)}`)
      scheduleRestart(detail)
    })
  }

  function stopChild() {
    const running = child
    child = null
    if (!running) return
    try {
      running.kill()
    } catch (error) {
      logger.debug?.(`powerpulse: collector kill failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return {
    start() {
      if (stopped) return
      if (child) return
      clearRestartTimer()
      startChild()
    },
    stop() {
      stopped = true
      clearRestartTimer()
      stopChild()
      settleWaiters(null)
    },
    setInterval(nextIntervalSec) {
      const next = Math.max(1, Math.round(Number(nextIntervalSec) || currentInterval))
      if (next === currentInterval) return
      currentInterval = next
      if (child) {
        stopChild()
        clearRestartTimer()
        startChild()
      }
    },
    getInterval() {
      return currentInterval
    },
    getLatest() {
      return latest
    },
    getPid() {
      return child?.pid ?? null
    },
    async waitForSnapshot(timeoutMs = DEFAULT_TIMEOUT_MS) {
      if (latest) return latest
      if (stopped) return null
      return new Promise((resolve) => {
        const waiter = { resolve }
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter)
          resolve(null)
        }, Math.max(250, timeoutMs))
        if (typeof waiter.timer.unref === 'function') waiter.timer.unref()
        waiters.add(waiter)
      })
    }
  }
}
