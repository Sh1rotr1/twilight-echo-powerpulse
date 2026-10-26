(() => {
  const parent = window.parent
  const summaryEl = document.getElementById('summary')
  const listEl = document.getElementById('list')
  const metaEl = document.getElementById('meta')
  const refreshEl = document.getElementById('refresh')

  let port = null
  let nextId = 1
  let loading = false
  let timer = null
  let retryTimer = null
  let readyTimer = null
  const pending = new Map()

  function postReady() {
    parent.postMessage({ type: 'twilight-experience-ready', bridgeVersion: 2 }, '*')
  }

  function request(method, args) {
    return new Promise((resolve, reject) => {
      if (!port) {
        reject(new Error('面板尚未连接'))
        return
      }
      const id = nextId++
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error('请求超时'))
      }, 12000)
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      })
      port.postMessage({ id, method, args })
    })
  }

  function label(device) {
    if (device.kind === 'system') return '本机电池'
    return device.name || '无线设备'
  }

  function clock(value) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString('zh-CN', { hour12: false })
  }

  function formatInterval(seconds) {
    const value = Math.max(1, Number(seconds) || 10)
    if (value >= 60 && value % 60 === 0) return `${value / 60} 分钟`
    return `${value} 秒`
  }

  function render(form) {
    const devices = Array.isArray(form?.devices) ? form.devices : []
    const updated = clock(form?.config?.updatedAt)
    const interval = Math.max(1, Number(form?.config?.intervalSec) || 10)

    listEl.replaceChildren()

    if (!devices.length) {
      const empty = document.createElement('div')
      empty.className = form?.error ? 'error' : 'empty'
      empty.textContent = form?.error || '未检测到带电量设备'
      listEl.appendChild(empty)
    } else {
      for (const device of devices) {
        const row = document.createElement('div')
        row.className = 'row'

        const name = document.createElement('span')
        name.className = 'name'
        name.textContent = label(device)
        name.title = `${label(device)}${device.source ? ` · ${device.source}` : ''}`

        const bar = document.createElement('span')
        bar.className = 'bar'
        const fill = document.createElement('i')
        const level = Math.max(0, Math.min(100, Number(device.level) || 0))
        fill.style.width = `${level}%`
        if (device.low) fill.style.background = 'var(--te-danger)'
        bar.appendChild(fill)

        const pct = document.createElement('span')
        pct.className = device.low ? 'pct low' : 'pct'
        pct.textContent = device.charging ? `⚡ ${level}%` : `${level}%`
        pct.title = device.charging ? '正在充电' : ''

        row.append(name, bar, pct)
        listEl.appendChild(row)
      }
    }

    summaryEl.textContent = devices.length
      ? `${devices.length} 台设备${updated ? ` · 更新于 ${updated}` : ''}`
      : updated
        ? `更新于 ${updated}`
        : '等待设备数据'
    metaEl.textContent = `每 ${formatInterval(interval)} 刷新`
  }

  async function load() {
    if (loading || !port) return
    loading = true
    refreshEl.disabled = true
    try {
      const form = await request('plugin.request', {
        request: {
          command: 'powerpulse.overview',
          args: [{ source: 'titlebar' }]
        }
      })
      render(form)
    } catch (error) {
      render({ devices: [], error: error instanceof Error ? error.message : String(error) })
      if (port && !retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null
          void load()
        }, 3000)
      }
    } finally {
      loading = false
      refreshEl.disabled = false
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== parent) return
    if (event.data?.type !== 'twilight-experience-connect') return
    const next = event.ports?.[0]
    if (!next) return
    if (port) {
      try {
        port.close()
      } catch {}
      for (const item of pending.values()) {
        item.reject(new Error('面板已重连'))
      }
      pending.clear()
    }
    port = next
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (readyTimer) {
      clearInterval(readyTimer)
      readyTimer = null
    }
    port.onmessage = ({ data }) => {
      const item = data?.id ? pending.get(data.id) : null
      if (!item) return
      pending.delete(data.id)
      if (data.error) item.reject(new Error(String(data.error)))
      else item.resolve(data.value)
    }
    port.start()
    if (timer) clearInterval(timer)
    timer = setInterval(load, 5000)
    void load()
  })

  refreshEl.addEventListener('click', () => void load())
  window.addEventListener('pagehide', () => {
    if (timer) clearInterval(timer)
    timer = null
    port = null
  })

  postReady()
  readyTimer = setInterval(() => {
    if (!port) postReady()
  }, 1500)
})()
