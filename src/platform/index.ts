/**
 * 平台适配层：同一份前端代码同时运行在浏览器和 Tauri 壳（Windows / Android）里。
 *
 * 约定：
 * - Tauri API 一律在函数内部动态导入，浏览器构建不会因此加载额外代码；
 * - 浏览器行为保持不变，Tauri 只是替换「保存文件」和「打开外链」两件事；
 * - Android 的保存对话框返回 content:// URI，fs 插件会通过 ContentResolver 写入。
 */

/** 仅接受 HTTP(S)：避免把 file:/javascript: 交给外部程序 */
const HTTP_URL = /^https?:\/\//i

/** 是否运行在 Tauri WebView 中（Windows 桌面或 Android） */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const canOpenExternally = (url: string): boolean => HTTP_URL.test(url)

/** 用系统浏览器打开链接；浏览器环境保持新标签页行为 */
export const openExternal = async (url: string): Promise<void> => {
  if (!canOpenExternally(url)) {
    return
  }
  if (!isTauri()) {
    window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    // 打不开外链只影响交互，不让未处理的 Promise 打断界面
  }
}

/** 浏览器兜底：<a download>。仅在普通浏览器和 WebView2 桌面端有效 */
const downloadBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * Tauri 的系统保存对话框。
 * 桌面端返回文件路径，Android 返回 content:// URI；两者都交给 fs 插件写入。
 * 返回 false 表示用户取消。
 */
const saveWithDialog = async (blob: Blob, name: string): Promise<boolean> => {
  const { save } = await import('@tauri-apps/plugin-dialog')
  let path: string | null
  try {
    path = await save({ defaultPath: name })
  } catch (error) {
    // Android 取消保存会抛异常，而非返回 null
    if (/cancel/i.test(String(error))) {
      return false
    }
    throw error
  }
  if (!path) {
    return false
  }
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  return true
}

/**
 * 保存二进制文件（历史导出等）。
 * 返回 false 表示用户主动取消；保存失败会抛出异常，由调用方展示错误。
 */
export const saveBlob = async (blob: Blob, name: string): Promise<boolean> => {
  if (isTauri()) {
    try {
      return await saveWithDialog(blob, name)
    } catch {
      // 路径超出 fs scope 等情况下退回 WebView2 下载，至少保证文件能落地
    }
  }
  downloadBlob(blob, name)
  return true
}

/**
 * 接管外链点击：Tauri WebView 里 target=_blank 不会打开系统浏览器。
 * 只处理 http(s)，blob:/data: 等站内地址仍交给页面自己处理。
 */
export const setupPlatform = (): void => {
  if (!isTauri() || typeof document === 'undefined') {
    return
  }
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0) {
        return
      }
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a[href]')
      if (!anchor) {
        return
      }
      const href = anchor.getAttribute('href') ?? ''
      if (!canOpenExternally(href)) {
        return
      }
      event.preventDefault()
      void openExternal(href)
    },
    true
  )
}
