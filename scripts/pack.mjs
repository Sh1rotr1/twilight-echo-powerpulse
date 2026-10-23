import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const excludedDirs = new Set(['dist', 'test', 'node_modules', '.git', 'host', 'scripts', '.twilight-echo'])
const excludedFiles = new Set(['package-lock.json'])

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory() && excludedDirs.has(entry.name)) continue
    if (entry.isFile() && excludedFiles.has(entry.name)) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) await copyDir(source, target)
    else if (entry.isFile()) await fs.copyFile(source, target)
  }
}

const candidates = [
  process.env.TE_CLI,
  path.resolve(root, '..', 'Twilight_Echo', 'packages', 'create-twilight-plugin', 'bin', 'create-twilight-plugin.cjs'),
  path.resolve(root, '.twilight-echo', 'packages', 'create-twilight-plugin', 'bin', 'create-twilight-plugin.cjs'),
  'E:/DSHworks/_ref/te_src/packages/create-twilight-plugin/bin/create-twilight-plugin.cjs'
].filter(Boolean)

let cli = null
for (const candidate of candidates) {
  try {
    await fs.access(candidate)
    cli = candidate
    break
  } catch {}
}
if (!cli) {
  console.error('找不到 create-twilight-plugin CLI。')
  console.error('请克隆 https://github.com/Px-asen/Twilight_Echo 到仓库旁边，或设置 TE_CLI 指向 CLI 路径。')
  process.exit(1)
}

const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'powerpulse-pack-'))
try {
  await copyDir(root, staging)
  const outDir = path.join(root, 'dist')
  await fs.mkdir(outDir, { recursive: true })
  const result = await run(process.execPath, [cli, 'pack', staging, '--out', outDir], {
    cwd: root,
    windowsHide: true
  })
  process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
} finally {
  await fs.rm(staging, { recursive: true, force: true })
}
