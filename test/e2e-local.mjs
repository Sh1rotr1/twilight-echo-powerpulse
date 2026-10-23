import { activate, deactivate } from '../index.mjs'

const settings = new Map()
const commands = new Map()
const contributions = []
const notices = []

const context = {
  apiVersion: 3,
  storagePath: 'C:/tmp/powerpulse-e2e',
  logger: {
    debug: (m) => console.log(`[debug] ${m}`),
    info: (m) => console.log(`[info] ${m}`),
    warn: (m) => console.log(`[warn] ${m}`),
    error: (m) => console.error(`[error] ${m}`)
  },
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
      register: async (contribution) => contributions.push(contribution),
      onCommand: (command, handler) => commands.set(command, handler),
      notify: async (notice) => notices.push(notice)
    }
  }
}

const started = Date.now()
await activate(context)
console.log(JSON.stringify({ contributions: contributions.map((c) => `${c.kind}:${c.command}`) }, null, 2))

const form = await commands.get('powerpulse.overview')({ source: 'settingsPanel', panelId: 'powerpulse-settings' })
console.log(JSON.stringify({ formKind: form.kind, submit: form.submitCommand, notice: form.notice, fields: form.fields.map((f) => f.key) }, null, 2))

const list = await commands.get('powerpulse.list')({ source: 'sidebarPage', pageId: 'powerpulse-page' })
console.log(list)

await commands.get('powerpulse.toast')({ id: 'track', title: 'demo' })
console.log(JSON.stringify({ notice: notices.at(-1) }, null, 2))

const saved = await commands.get('powerpulse.overview')({ intervalSec: '60', showSystem: 'on', lowThreshold: '25', toastSummary: 'on' })
console.log(JSON.stringify({ saved: settings.get('config'), notice: saved.form.notice }, null, 2))

await deactivate()
console.log(`done in ${Date.now() - started}ms`)
process.exit(0)
