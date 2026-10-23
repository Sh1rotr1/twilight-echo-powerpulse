import test from 'node:test'
import assert from 'node:assert/strict'
import { createPowerPulsePlugin } from '../lib/create-plugin.mjs'

const SNAPSHOT = {
  schemaVersion: 1,
  updatedAt: new Date().toISOString(),
  intervalSec: 10,
  devices: [
    {
      id: 'system:0',
      kind: 'system',
      name: 'AP21A5T',
      level: 92,
      charging: false,
      plugged: false,
      minutesLeft: 180
    },
    {
      id: 'bt:AA',
      kind: 'bluetooth',
      name: 'DAWN PRO2',
      level: 12,
      charging: false,
      plugged: false,
      minutesLeft: null
    }
  ],
  error: null
}

function makeContext() {
  const settings = new Map()
  const commands = new Map()
  const contributions = []
  const notices = []
  const context = {
    apiVersion: 3,
    storagePath: 'C:/tmp/powerpulse',
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {
      get: async (key) => settings.get(key),
      set: async (key, value) => {
        settings.set(key, value)
      },
      delete: async (key) => {
        settings.delete(key)
      }
    },
    twilight: {
      events: { on: () => () => {} },
      player: {},
      providers: { register: async () => {} },
      themes: { register: async () => {} },
      ui: {
        register: async (contribution) => {
          contributions.push(contribution)
        },
        onCommand: (command, handler) => {
          commands.set(command, handler)
        },
        notify: async (notice) => {
          notices.push(notice)
        }
      }
    }
  }
  return { context, settings, commands, contributions, notices }
}

function makeFactory(snapshot = SNAPSHOT) {
  const created = []
  const factory = ({ intervalSec, onSnapshot }) => {
    const state = { intervalSec, started: false, stopped: false }
    const collector = {
      state,
      start() {
        state.started = true
        onSnapshot(snapshot)
      },
      stop() {
        state.stopped = true
      },
      setInterval(value) {
        state.intervalSec = value
      },
      waitForSnapshot: async () => snapshot
    }
    created.push(collector)
    return collector
  }
  return { factory, created }
}

test('activate registers three surfaces and starts the collector', async () => {
  const { context, contributions } = makeContext()
  const { factory, created } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })

  await plugin.activate(context)

  assert.equal(contributions.length, 2)
  assert.deepEqual(
    contributions.map((item) => item.kind).sort(),
    ['playerBarButton', 'settingsPanel']
  )
  assert.equal(created.length, 1)
  assert.equal(created[0].state.started, true)
})

test('overview returns a host settings form with a summary', async () => {
  const { context, commands } = makeContext()
  const { factory } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })
  await plugin.activate(context)

  const form = await commands.get('powerpulse.overview')({ source: 'settingsPanel' })
  assert.equal(form.kind, 'settings-form')
  assert.equal(form.submitCommand, 'powerpulse.overview')
  assert.equal(form.fields.length, 4)
  assert.match(form.notice, /本机电池 92%/)
  assert.match(form.notice, /DAWN PRO2 12%/)
})

test('list returns a readable device table', async () => {
  const { context, commands } = makeContext()
  const { factory } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })
  await plugin.activate(context)

  const text = await commands.get('powerpulse.list')()
  assert.match(text, /PowerPulse 设备电量/)
  assert.match(text, /共 2 个设备/)
})

test('toast uses warning kind when a device is low', async () => {
  const { context, commands, notices } = makeContext()
  const { factory } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })
  await plugin.activate(context)

  await commands.get('powerpulse.toast')()
  assert.equal(notices.length, 1)
  assert.equal(notices[0].kind, 'warning')
})

test('save clamps values, persists config and restarts interval', async () => {
  const { context, commands, settings } = makeContext()
  const { factory, created } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })
  await plugin.activate(context)

  const result = await commands.get('powerpulse.overview')({
    intervalSec: '300',
    showSystem: 'off',
    lowThreshold: '150',
    toastSummary: 'off'
  })

  assert.equal(settings.get('config').intervalSec, 300)
  assert.equal(settings.get('config').lowThreshold, 100)
  assert.equal(settings.get('config').showSystem, false)
  assert.equal(created[0].state.intervalSec, 300)
  assert.equal(result.form.kind, 'settings-form')
  assert.match(result.form.notice, /已保存/)
})

test('deactivate stops the collector', async () => {
  const { context } = makeContext()
  const { factory, created } = makeFactory()
  const plugin = createPowerPulsePlugin({ createCollector: factory, scriptPath: 'unused', platform: 'win32' })
  await plugin.activate(context)
  await plugin.deactivate()
  assert.equal(created[0].state.stopped, true)
})
