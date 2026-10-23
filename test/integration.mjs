import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCollector } from '../lib/collector.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const scriptPath = path.join(here, '..', 'lib', 'pp-collect.ps1')

if (process.platform !== 'win32') {
  console.log('skip: integration probe only runs on Windows')
  process.exit(0)
}

const collector = createCollector({
  scriptPath,
  intervalSec: 10,
  logger: {
    debug: (message) => console.error(`[debug] ${message}`),
    info: () => {},
    warn: (message) => console.error(`[warn] ${message}`),
    error: (message) => console.error(`[error] ${message}`)
  },
  onSnapshot: (snapshot) => {
    console.log(JSON.stringify(snapshot, null, 2))
    collector.stop()
    process.exit(0)
  }
})

collector.start()
const snapshot = await collector.waitForSnapshot(20000)
if (!snapshot) {
  console.error('no snapshot within 20s')
  collector.stop()
  process.exit(1)
}
