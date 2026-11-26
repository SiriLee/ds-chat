# Tauri 双平台壳（Windows 10 / Android）：验证与 MVP

本文记录把项目从「纯静态网页」接到 Rust + Tauri 壳上的可行性验证结果、当前实现和已知缺口。
目标平台：Windows 10 桌面、Android 手机。

## 结论

可行，且改动集中在平台边界。前端（React / rspack / IndexedDB / 音频处理）保持原样，Rust 只承担窗口、权限、文件保存和外部链接。

已在本机实际验证：

| 验证项 | 方式 | 结果 |
| --- | --- | --- |
| Tauri 配置与 ACL | `cargo check --target x86_64-pc-windows-msvc` | 通过（tauri 2.12.7 / wry 0.57.4） |
| Windows 壳可编译 | 同上（MSVC 目标） | 通过 |
| 前端构建 | `pnpm build` | 通过 |
| 平台适配层分支 | `pnpm test:platform`（Node） | 5/5 通过 |
| Android APK | `pnpm tauri android build --debug -t aarch64` | 通过 |
| 真机安装/启动 | `adb install` + `am start` | 通过，界面正常渲染 |
| API 跨域 | `curl` 预检，Origin 为 `http(s)://tauri.localhost` | 回显该 Origin，允许 |
| 安全上下文 | 真机 CDP `isSecureContext` | `true` |
| IndexedDB / localStorage | 真机 CDP | 可用 |
| 保存文件 | 真机 SAF + `fs` 写入 | 通过，落盘内容校验一致 |
| 外链 | 真机 `opener` | 通过，拉起系统 Chrome |
| 麦克风 API | 真机 CDP `getUserMedia` | 存在（权限弹窗未实测） |

未验证：Windows 运行时与 MSI/NSIS 产物（本机是 WSL2，无法出 Windows 安装包）、Android 麦克风授权弹窗、软键盘安全区、发布签名。

## 真机环境

- HUAWEI ADY-AL00，Android 12（API 31），arm64-v8a，1256×2760 @540dpi
- WebView：`com.huawei.webview` 114.0.5.302（Chromium 114），无 GMS
- 页面来源：`http://tauri.localhost`，Tauri 内建对象存在

WebView 114 高于 rspack 的 `chrome >= 105` 目标，说明「无 GMS 国产机 WebView 过旧」的风险在当前设备上不成立；但低端老机型仍需按 105 划线。

## 实现结构

```text
src-tauri/
  Cargo.toml                 # tauri 2 + dialog / fs / opener 插件
  tauri.conf.json            # frontendDist ../dist、devUrl 8090、dragDropEnabled=false
  capabilities/default.json  # core / opener / dialog / fs 写权限
  src/lib.rs                 # 只注册插件，无业务逻辑
  gen/android/               # tauri android init 生成，含麦克风权限与 adjustResize
src/platform/index.ts        # 平台适配层：保存文件、打开外链、Tauri 检测
src/platform/platform.test.ts
```

关键决策：

- **不做 Rust 业务重写**：SSE、Markdown、KaTeX、Mermaid、IndexedDB、WAV 编码都在前端，Rust 只做壳。
- **不加 HTTP 代理插件**：api.deepseek.com 的 CORS 回显任意 Origin，前端直连可用；少一层依赖和一次请求转发。
- **保存文件统一走系统对话框**：桌面返回路径，Android 返回 `content://` URI，`fs` 插件通过 ContentResolver 写入。Android 的 `navigator.share` 在 WebView 中不存在（真机确认），Web Share 方案不可行。
- **外链用捕获阶段点击拦截 + opener**：Tauri WebView 里 `target=_blank` 不会打开系统浏览器。
- **关闭原生拖放**：`dragDropEnabled: false`，保留页面现有的 HTML5 拖拽上传。
- **Android 清单**：声明 `RECORD_AUDIO` 与 `MODIFY_AUDIO_SETTINGS`（wry 的 `onPermissionRequest` 会申请运行时权限），并设 `windowSoftInputMode="adjustResize"`。
- **compileSdk 固定 36**：`tauri android init` 模板写的是 37，但 SDK 稳定通道最高 36。

## 运行与构建

浏览器版本不受影响，原有命令照旧。壳相关：

```sh
# 桌面（必须在 Windows 主机上出安装包；WSL2 只能编译 Linux 目标）
pnpm tauri:dev
pnpm tauri:build        # NSIS + MSI，需要 Windows + WebView2

# Android（Linux/WSL2 可构建；需要 SDK 36、NDK 27.2、JDK 17）
export ANDROID_HOME="$PWD/.android-sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.2.12479018"
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export GRADLE_USER_HOME="$PWD/.gradle-home"
export ANDROID_USER_HOME="$PWD/.android-user"

pnpm android:dev
pnpm tauri android build --debug -t aarch64
```

`.android-sdk/`、`.gradle-home/`、`.cargo-home/`、`.tmp/` 是本地工具链缓存，已在 `.gitignore` 中忽略。
在 Linux/WSL2 上做 Windows 目标的 `cargo check` 需要 `llvm-rc`（`tauri-winres` 嵌入资源用）；Android 构建不需要。

## 已知缺口

1. **Windows 安装包未产出**：本机无 Windows 主机，签名也未配置。CI 里补 `windows-latest` 任务。
2. **Android 发布签名未配置**：当前只构建 debug APK（约 140 MB，含调试符号），release 需要 keystore。
3. **附件预览**：图片/PDF 仍沿用 `target=_blank` + `download` 属性，在 WebView2 可用、Android 上无效，后续改为「保存后交给系统打开」或内嵌查看器。
4. **麦克风授权**：清单与 wry 流程已就绪，但未在真机上点过授权弹窗。
5. **软键盘安全区**：已设 `adjustResize`，仍需真机回归输入框是否被遮挡。
6. **升级通道**：Tauri updater / Play 分发未接。
7. **数据迁移**：Tauri 的 origin 与网页版不同，历史不会自动带过去；依赖现有的 ZIP 导入导出。

## 真机验证方法（可复现）

```sh
export PATH="$HOME/.local/bin:$PATH"
adb devices
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb shell am start -n com.sirilee.dschat/.MainActivity

# 打开 WebView DevTools（debug 构建）
PID=$(adb shell pidof com.sirilee.dschat | tr -d '\r')
adb forward tcp:9222 localabstract:webview_devtools_remote_$PID
curl -s http://127.0.0.1:9222/json/version
```

拿到 `webSocketDebuggerUrl` 后可用任意 CDP 客户端执行 JS，验证 `isSecureContext`、IndexedDB、`navigator.share`、插件 IPC 等。
`uiautomator dump` + `input tap` 可以驱动 SAF 对话框，用于自动化验证保存链路。
