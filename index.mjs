import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPowerPulsePlugin } from './lib/create-plugin.mjs'
import { createCollector } from './lib/collector.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

const plugin = createPowerPulsePlugin({
  createCollector,
  scriptPath: path.join(here, 'lib', 'pp-collect.ps1')
})

export const activate = plugin.activate
export const deactivate = plugin.deactivate
