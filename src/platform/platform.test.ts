import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isTauri, openExternal, saveBlob, setupPlatform } from './index.ts'

/**
 * 适配层分支测试：在 Node 里伪造 window / navigator / document，
 * 确认浏览器与 Tauri 两条路径选择正确。不启动真实 WebView。
 */

const define = (key: string, value: unknown) => {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
}

const browserWindow = () => {
  const opened: unknown[][] = []
  return { opened, window: { open: (...args: unknown[]) => opened.push(args) } }
}

test('未注入 Tauri 内建对象时按浏览器处理', () => {
  define('window', {})
  assert.equal(isTauri(), false)
})

test('检测到 __TAURI_INTERNALS__ 时按 Tauri 处理', () => {
  define('window', { __TAURI_INTERNALS__: {} })
  assert.equal(isTauri(), true)
})

test('浏览器外链走 window.open，且只接受 HTTP(S)', async () => {
  const { opened, window } = browserWindow()
  define('window', window)
  await openExternal('https://example.com/a')
  await openExternal('javascript:alert(1)')
  await openExternal('file:///etc/passwd')
  assert.deepEqual(opened, [['https://example.com/a', '_blank', 'noopener,noreferrer']])
})

test('浏览器保存回退到 <a download>', async () => {
  define('window', {})
  // 缩短 revokeObjectURL 的延时，避免测试等待 10 秒
  const realSetTimeout = globalThis.setTimeout
  define('setTimeout', (fn: () => void) => realSetTimeout(fn, 0))
  let clicked = 0
  define('document', {
    createElement: () => ({
      href: '',
      download: '',
      click: () => {
        clicked += 1
      },
    }),
  })
  const saved = await saveBlob(new Blob(['x']), 'history.zip')
  assert.equal(saved, true)
  assert.equal(clicked, 1)
})

test('非 Tauri 环境不安装全局点击拦截', () => {
  define('window', {})
  let listeners = 0
  define('document', {
    addEventListener: () => {
      listeners += 1
    },
  })
  setupPlatform()
  assert.equal(listeners, 0)
})
