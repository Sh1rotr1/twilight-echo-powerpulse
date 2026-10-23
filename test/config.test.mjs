import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_CONFIG,
  buildConfigFields,
  clampInterval,
  clampThreshold,
  migrateConfig,
  normalizeConfig,
  readConfigFormValues
} from '../lib/config.mjs'

test('defaults stay stable', () => {
  assert.equal(DEFAULT_CONFIG.intervalSec, 10)
  assert.equal(DEFAULT_CONFIG.lowThreshold, 20)
  assert.equal(DEFAULT_CONFIG.showSystem, true)
  assert.equal(DEFAULT_CONFIG.toastSummary, true)
  assert.equal(DEFAULT_CONFIG.schemaVersion, 1)
})

test('interval clamps to 1..300', () => {
  assert.equal(clampInterval(0), 1)
  assert.equal(clampInterval(999), 300)
  assert.equal(clampInterval('30'), 30)
  assert.equal(clampInterval('abc'), 10)
})

test('threshold clamps to 1..100', () => {
  assert.equal(clampThreshold(0), 1)
  assert.equal(clampThreshold(150), 100)
  assert.equal(clampThreshold('35'), 35)
  assert.equal(clampThreshold(null), 20)
})

test('normalizeConfig accepts form values and booleans', () => {
  const normalized = normalizeConfig({ intervalSec: '30', showSystem: 'off', lowThreshold: '15', toastSummary: 'off' })
  assert.deepEqual(normalized, {
    schemaVersion: 1,
    intervalSec: 30,
    showSystem: false,
    lowThreshold: 15,
    toastSummary: false
  })
})

test('migrateConfig upgrades legacy objects', () => {
  const migrated = migrateConfig({ intervalSec: 5, showSystem: false })
  assert.equal(migrated.schemaVersion, 1)
  assert.equal(migrated.intervalSec, 5)
  assert.equal(migrated.showSystem, false)
  assert.equal(migrated.lowThreshold, 20)
})

test('migrateConfig survives garbage', () => {
  assert.deepEqual(migrateConfig(null), DEFAULT_CONFIG)
  assert.deepEqual(migrateConfig(['nope']), DEFAULT_CONFIG)
})

test('form fields use host-supported types', () => {
  const fields = buildConfigFields(normalizeConfig({}))
  assert.equal(fields.length, 4)
  for (const field of fields) {
    assert.ok(['text', 'select', 'password', 'url'].includes(field.type))
    assert.ok(field.label.length <= 100)
    assert.ok(field.value.length <= 4096)
  }
  const interval = fields.find((field) => field.key === 'intervalSec')
  assert.ok(interval.options.some((option) => option.value === '300'))
})

test('readConfigFormValues keeps current values for missing fields', () => {
  const current = normalizeConfig({ intervalSec: 10, showSystem: true, lowThreshold: 20, toastSummary: true })
  const next = readConfigFormValues({ intervalSec: '60' }, current)
  assert.equal(next.intervalSec, 60)
  assert.equal(next.showSystem, true)
  assert.equal(next.lowThreshold, 20)
})
