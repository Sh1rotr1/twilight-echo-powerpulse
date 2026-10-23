import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ASAR = 'D:\\TwilightEcho\\resources\\app.asar'
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const RESTORE = args.includes('--restore')
const asarIndex = args.indexOf('--asar')
const ASAR_PATH = asarIndex >= 0 && args[asarIndex + 1]
  ? path.resolve(args[asarIndex + 1])
  : DEFAULT_ASAR
const BACKUP_PATH = `${ASAR_PATH}.powerpulse-sidebar-backup`
const SCRIPT_SOURCE = path.join(HERE, 'powerpulse-sidebar.js')
const RENDERER_DIR = 'out/renderer'
const SCRIPT_NAME = 'powerpulse-sidebar.js'
const SCRIPT_TAG = '<script type="module" src="./powerpulse-sidebar.js"></script>'

function fail(message) {
  console.error(`\n[PowerPulse] ${message}`)
  process.exit(1)
}

if (!fs.existsSync(ASAR_PATH)) fail(`未找到 ${ASAR_PATH}（可用 --asar 指定路径）`)
if (!fs.existsSync(SCRIPT_SOURCE)) fail(`缺少 ${SCRIPT_SOURCE}`)

let asar
try {
  asar = await import('@electron/asar')
} catch {
  fail('缺少 @electron/asar。请在仓库根目录运行 npm install 后重试。')
}

if (RESTORE) {
  if (!fs.existsSync(BACKUP_PATH)) fail(`没有备份文件：${BACKUP_PATH}`)
  try {
    fs.copyFileSync(BACKUP_PATH, ASAR_PATH)
  } catch (error) {
    fail(`还原失败（请先完全退出 Twilight Echo）：${error.message}`)
  }
  console.log(`[PowerPulse] 已还原 ${ASAR_PATH}`)
  process.exit(0)
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'powerpulse-sidebar-'))
const extractDir = path.join(tempRoot, 'app')
const repackedPath = path.join(tempRoot, 'app.asar')

try {
  fs.mkdirSync(extractDir, { recursive: true })
  asar.extractAll(ASAR_PATH, extractDir)

  const indexPath = path.join(extractDir, RENDERER_DIR, 'index.html')
  if (!fs.existsSync(indexPath)) fail('app.asar 内没有 out/renderer/index.html，版本不匹配')

  let html = fs.readFileSync(indexPath, 'utf8')
  const alreadyPatched = html.includes(SCRIPT_NAME)
  if (!alreadyPatched) {
    if (!html.includes('</body>')) fail('index.html 结构异常：没有 </body>')
    html = html.replace('</body>', `  ${SCRIPT_TAG}\n</body>`)
    fs.writeFileSync(indexPath, html, 'utf8')
  }

  fs.copyFileSync(SCRIPT_SOURCE, path.join(extractDir, RENDERER_DIR, SCRIPT_NAME))
  await asar.createPackage(extractDir, repackedPath)

  const entries = asar.listPackage(repackedPath).map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
  if (!entries.includes(`${RENDERER_DIR}/${SCRIPT_NAME}`)) fail('打包校验失败：缺少侧边栏脚本')
  const checkHtml = asar.extractFile(repackedPath, path.join(RENDERER_DIR, 'index.html')).toString('utf8')
  if (!checkHtml.includes(SCRIPT_NAME)) fail('打包校验失败：index.html 未注入脚本')

  console.log('[PowerPulse] 补丁内容校验通过：')
  console.log(`  + ${RENDERER_DIR}/${SCRIPT_NAME}`)
  console.log(`  ~ ${RENDERER_DIR}/index.html (+1 script tag)`)
  console.log(`  补丁状态：${alreadyPatched ? '已安装（将刷新脚本）' : '未安装（将新增）'}`)

  if (DRY_RUN) {
    console.log(`\n[PowerPulse] dry-run 完成，生成包：${repackedPath}`)
    console.log('[PowerPulse] 未修改 app.asar')
    process.exit(0)
  }

  if (!fs.existsSync(BACKUP_PATH)) {
    fs.copyFileSync(ASAR_PATH, BACKUP_PATH)
    console.log(`[PowerPulse] 已备份原包：${BACKUP_PATH}`)
  }

  try {
    fs.copyFileSync(repackedPath, ASAR_PATH)
  } catch (error) {
    fail(`写入 app.asar 失败（请先完全退出 Twilight Echo，包括托盘）：${error.message}`)
  }

  console.log('[PowerPulse] 已安装侧边栏补丁。重新启动 Twilight Echo 后生效。')
  console.log(`[PowerPulse] 还原命令：node "${path.resolve(process.argv[1])}" --restore`)
} finally {
  if (!DRY_RUN) fs.rmSync(tempRoot, { recursive: true, force: true })
}
