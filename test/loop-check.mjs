import { createCollector } from '../lib/collector.mjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.join(here, '..', 'lib', 'pp-collect.ps1')
const started = Date.now()
const stamps = []

const collector = createCollector({
  scriptPath,
  intervalSec: 5,
  logger: { debug() {}, info() {}, warn: (m) => console.error(m), error: (m) => console.error(m) },
  onSnapshot: (snapshot) => {
    stamps.push({ at: Date.now() - started, devices: snapshot.devices.length })
    if (stamps.length >= 2) {
      const pid = collector.getPid()
      collector.stop()
      setTimeout(() => {
        let alive = false
        try {
          process.kill(pid, 0)
          alive = true
        } catch {
          alive = false
        }
        console.log(JSON.stringify({ stamps, pid, aliveAfterStop: alive }))
        process.exit(alive ? 1 : 0)
      }, 1500)
    }
  }
})

collector.start()
setTimeout(() => {
  console.error('timeout waiting for snapshots', JSON.stringify(stamps))
  collector.stop()
  process.exit(1)
}, 30000)
