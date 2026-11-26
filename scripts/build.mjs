/**
 * 跨平台前端构建入口。
 *
 * npm/pnpm 在 Windows 上用 cmd.exe 执行脚本，`rm -rf` 和 `NODE_ENV=production`
 * 都无法工作；这里统一用 Node 删除产物并以生产环境调用 rspack。
 */
import { rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
rmSync(join(root, 'dist'), { recursive: true, force: true })

const result = spawnSync(
  process.execPath,
  [
    join(root, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js'),
    'build',
    '-c',
    join(root, 'rspack.config.ts'),
  ],
  { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } }
)

if (result.error) {
  throw result.error
}
process.exit(result.status ?? 1)
