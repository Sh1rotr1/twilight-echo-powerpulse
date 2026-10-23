import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDevices, parseSnapshotLine } from '../lib/collector.mjs'

test('parses a valid collector line', () => {
  const line = JSON.stringify({
    updatedAt: '2026-10-20T14:15:03Z',
    intervalSec: 10,
    devices: [
      { id: 'system:0', kind: 'system', name: 'AP21A5T', level: 100, charging: true, plugged: true, minutesLeft: 240 },
      { id: 'bt:AA', kind: 'bluetooth', name: '耳机', level: 65 }
    ]
  })
  const parsed = parseSnapshotLine(line)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.snapshot.devices.length, 2)
  assert.equal(parsed.snapshot.devices[1].kind, 'bluetooth')
  assert.equal(parsed.snapshot.devices[1].charging, false)
})

test('accepts a BOM and powershell single-device object', () => {
  const line = '\uFEFF' + JSON.stringify({
    updatedAt: '2026-10-20T14:15:03Z',
    devices: { id: 'system:0', kind: 'system', level: 88, charging: false }
  })
  const parsed = parseSnapshotLine(line)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.snapshot.devices.length, 1)
  assert.equal(parsed.snapshot.devices[0].level, 88)
})

test('keeps wireless kind for 2.4G devices', () => {
  const line = JSON.stringify({
    devices: [{ id: 'razer:00E6', kind: 'wireless', name: 'Razer Viper V4 Pro', level: 60, charging: true }]
  })
  const parsed = parseSnapshotLine(line)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.snapshot.devices[0].kind, 'wireless')
  assert.equal(parsed.snapshot.devices[0].charging, true)
})

test('rejects malformed lines without throwing', () => {
  assert.equal(parseSnapshotLine('not json').ok, false)
  assert.equal(parseSnapshotLine('').ok, false)
  assert.equal(parseSnapshotLine('[]').ok, false)
  assert.equal(parseSnapshotLine('x'.repeat(70000)).ok, false)
})

test('keeps collector error text', () => {
  const parsed = parseSnapshotLine('{"error":"boom","devices":[]}')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.snapshot.error, 'boom')
})

test('normalizes levels and drops out-of-range devices', () => {
  const devices = normalizeDevices([
    { id: 'a', level: 101 },
    { id: 'b', level: -1 },
    { id: 'c', level: 42.6 },
    { id: 'c', level: 50 },
    null,
    'x'
  ])
  assert.equal(devices.length, 1)
  assert.equal(devices[0].id, 'c')
  assert.equal(devices[0].level, 43)
})

test('deduplicates by id', () => {
  const devices = normalizeDevices([
    { id: 'bt:AA', level: 10 },
    { id: 'bt:AA', level: 20 }
  ])
  assert.equal(devices.length, 1)
  assert.equal(devices[0].level, 10)
})
