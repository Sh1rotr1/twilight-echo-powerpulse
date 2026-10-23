import test from 'node:test'
import assert from 'node:assert/strict'
import { buildListText, buildSummary, hasLowBattery, visibleDevices } from '../lib/format.mjs'

const config = { intervalSec: 10, showSystem: true, lowThreshold: 20 }

function snapshot(devices) {
  return { schemaVersion: 1, updatedAt: '2026-10-20T14:15:03Z', devices, error: null }
}

const devices = [
  {
    id: 'system:0',
    kind: 'system',
    name: 'AP21A5T',
    level: 100,
    charging: true,
    plugged: true,
    minutesLeft: null
  },
  {
    id: 'razer:00E6',
    kind: 'wireless',
    name: 'Razer Viper V4 Pro',
    level: 60,
    charging: true,
    plugged: true,
    minutesLeft: null
  },
  {
    id: 'bt:AA',
    kind: 'bluetooth',
    name: 'DAWN PRO2',
    level: 15,
    charging: false,
    plugged: false,
    minutesLeft: null
  }
]

test('visibleDevices filters hidden system battery', () => {
  assert.equal(visibleDevices(snapshot(devices), config).length, 3)
  assert.equal(visibleDevices(snapshot(devices), { ...config, showSystem: false }).length, 2)
})

test('visibleDevices ignores invalid levels', () => {
  const result = visibleDevices(snapshot([{ id: 'x', level: 255 }, { id: 'y', level: 'nope' }]), config)
  assert.equal(result.length, 0)
})

test('summary marks low peripherals', () => {
  const summary = buildSummary(snapshot(devices), config)
  assert.match(summary, /本机电池 100% 充电中/)
  assert.match(summary, /Razer Viper V4 Pro 60% 充电中/)
  assert.match(summary, /⚠ DAWN PRO2 15%/)
  assert.ok(summary.length <= 500)
})

test('summary reports empty state', () => {
  assert.equal(buildSummary(snapshot([]), config), '暂未读取到带电量信息的设备')
})

test('hasLowBattery ignores plugged system battery', () => {
  assert.equal(hasLowBattery(snapshot(devices), config), true)
  const onlyPlugged = snapshot([{ ...devices[0], level: 10 }])
  assert.equal(hasLowBattery(onlyPlugged, config), false)
})

test('list text contains names and footer', () => {
  const text = buildListText(snapshot(devices), config)
  assert.match(text, /本机电池/)
  assert.match(text, /Razer Viper V4 Pro/)
  assert.match(text, /DAWN PRO2/)
  assert.match(text, /低电量/)
  assert.match(text, /共 3 个设备/)
})

test('list text explains empty result', () => {
  const text = buildListText(snapshot([]), config)
  assert.match(text, /当前没有读取到带电量信息的设备/)
})
