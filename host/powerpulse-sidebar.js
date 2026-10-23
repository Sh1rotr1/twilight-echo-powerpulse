const CARD_ID = 'te-powerpulse-sidebar'
const COMMAND = 'powerpulse.overview'
const MIN_POLL_MS = 5000
const MAX_POLL_MS = 30000

let card = null
let shadow = null
let listEl = null
let metaEl = null
let timer = null
let pollMs = 10000
let lastPayload = null
let bootObserver = null
let resizeObserver = null

const CSS = `
  :host { display: block; margin: 6px 10px 8px; }
  .card {
    padding: 9px 10px 7px;
    border-radius: 12px;
    border: 1px solid color-mix(in srgb, currentColor 13%, transparent);
    background: color-mix(in srgb, currentColor 6%, transparent);
    color: inherit;
    font: inherit;
    cursor: default;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .02em;
    opacity: .78;
    user-select: none;
  }
  .head svg { width: 13px; height: 13px; flex: none; }
  .head .spacer { flex: 1; }
  .head .meta { font-size: 10px; font-weight: 500; opacity: .55; font-variant-numeric: tabular-nums; }
  .list { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; max-height: 168px; overflow: auto; }
  .row { display: flex; align-items: center; gap: 7px; font-size: 11.5px; line-height: 1.2; min-height: 16px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .88; }
  .bar { width: 38px; height: 4px; border-radius: 2px; background: color-mix(in srgb, currentColor 22%, transparent); overflow: hidden; flex: none; }
  .bar > i { display: block; height: 100%; border-radius: 2px; background: var(--te-accent, currentColor); }
  .pct { width: 36px; text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; opacity: .8; flex: none; }
  .pct.low { color: #ff6b6b; opacity: 1; font-weight: 600; }
  .charge { font-size: 9.5px; opacity: .55; margin-left: 2px; }
  .empty { font-size: 11px; opacity: .55; padding: 3px 0 1px; }
  .note { font-size: 10px; opacity: .45; margin-top: 4px; }
`

const ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="7" width="16" height="10" rx="2.5"/><path d="M21 10.5v3"/><path d="M10.5 9.5 8.5 13h3l-2 3.5"/></svg>'

function displayName(device) {
  if (device.kind === 'system') return '本机电池'
  return device.name || '无线设备'
}

function render(payload) {
  if (!shadow || !listEl) return
  lastPayload = payload
  const devices = Array.isArray(payload?.devices) ? payload.devices : []
  const interval = Math.max(1, Number(payload?.config?.intervalSec) || 10)
  const effective = Math.min(30, Math.max(5, interval))
  metaEl.textContent = `${effective}s`
  listEl.replaceChildren()

  if (!devices.length) {
    const empty = document.createElement('div')
    empty.className = 'empty'
    empty.textContent = payload?.unavailable ? '插件未启用' : '未检测到带电量设备'
    listEl.appendChild(empty)
    return
  }

  for (const device of devices) {
    const row = document.createElement('div')
    row.className = 'row'

    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = displayName(device)
    name.title = `${displayName(device)}${device.source ? ` · ${device.source}` : ''}`

    const bar = document.createElement('span')
    bar.className = 'bar'
    const fill = document.createElement('i')
    const level = Math.max(0, Math.min(100, Number(device.level) || 0))
    fill.style.width = `${level}%`
    if (device.low) fill.style.background = '#ff6b6b'
    bar.appendChild(fill)

    const pct = document.createElement('span')
    pct.className = device.low ? 'pct low' : 'pct'
    pct.textContent = `${level}%`

    row.append(name, bar, pct)
    if (device.charging) {
      const charge = document.createElement('span')
      charge.className = 'charge'
      charge.textContent = '充电'
      row.appendChild(charge)
    }
    listEl.appendChild(row)
  }

  if (pollMs !== Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, interval * 1000))) {
    schedule(interval)
  }
}

function schedule(seconds) {
  const next = Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Number(seconds) * 1000 || 10000))
  pollMs = next
  if (timer) clearInterval(timer)
  timer = setInterval(refresh, pollMs)
}

async function refresh() {
  const api = window.api?.extensions
  if (!api || typeof api.executeCommand !== 'function') return
  try {
    const result = await api.executeCommand(COMMAND, [{ source: 'sidebar' }])
    render(result)
  } catch {
    render({ devices: [], config: { intervalSec: 10 }, unavailable: true })
  }
}

function ensureCard() {
  const menu = document.querySelector('.side-menu')
  if (!menu) return false
  if (card && card.isConnected) return true

  card = document.createElement('div')
  card.id = CARD_ID
  card.setAttribute('role', 'region')
  card.setAttribute('aria-label', '设备电量')
  shadow = card.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = CSS

  const wrap = document.createElement('div')
  wrap.className = 'card'

  const head = document.createElement('div')
  head.className = 'head'
  const icon = document.createElement('span')
  icon.innerHTML = ICON
  const title = document.createElement('span')
  title.textContent = '设备电量'
  const spacer = document.createElement('span')
  spacer.className = 'spacer'
  metaEl = document.createElement('span')
  metaEl.className = 'meta'
  metaEl.textContent = '10s'
  head.append(icon, title, spacer, metaEl)
  head.addEventListener('click', () => void refresh())

  listEl = document.createElement('div')
  listEl.className = 'list'

  wrap.append(head, listEl)
  shadow.append(style, wrap)

  const bottom = menu.querySelector('.menu-bottom')
  if (bottom) menu.insertBefore(card, bottom)
  else menu.appendChild(card)

  if (resizeObserver) resizeObserver.disconnect()
  resizeObserver = new ResizeObserver(() => {
    if (!card) return
    card.style.display = menu.clientWidth < 100 ? 'none' : 'block'
  })
  resizeObserver.observe(menu)

  schedule(10)
  void refresh()
  return true
}

function boot() {
  if (bootObserver) return
  bootObserver = new MutationObserver(() => {
    if (!card || !card.isConnected) ensureCard()
  })
  bootObserver.observe(document.documentElement, { childList: true, subtree: true })
  ensureCard()
  window.addEventListener('focus', () => void refresh())
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh()
  })
  const plugins = window.api?.plugins
  if (plugins && typeof plugins.onChanged === 'function') {
    plugins.onChanged(() => void refresh())
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
