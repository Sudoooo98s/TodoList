# 开发、CI 与发布经验

本文记录已经在本仓库验证过的工程约定，避免重复排查同类问题。修改 CI、GUI 冒烟测试、打包或发布流程前，请先阅读本文。

## 验证基线

每次修改 JavaScript 后，至少运行：

```bash
node --check main.js
node --check preload.js
node --check src/js/app.js
node --check src/js/float.js
node --check src/js/common.js
node --check scripts/gen-icon.js
node --check tests/main-process.test.js
node --check tests/gui-smoke.js
npm test
npm run test:gui
```

修改 UI、CI、打包或发布配置后，还必须确认 GitHub Actions 的 `quality` 与 `gui` 两个 job 都成功。

## Linux GUI CI 约定

GUI 冒烟测试在 CI 中使用 `ubuntu-24.04`，不要改回 `ubuntu-latest`。GitHub 的 `ubuntu-latest` 会随系统镜像升级漂移；本仓库已遇到过镜像切换带来的依赖差异。

CI 必须安装：

- `xvfb`：提供虚拟 X Server
- `libayatana-appindicator3-1`：Electron 托盘所需
- `libgtk-3-0t64`、`libnss3`、`libgbm1`、`libasound2t64` 等 Electron/Chromium 运行库

运行命令使用：

```bash
xvfb-run -a --server-args="-screen 0 1280x1024x24" npm run test:gui
```

同时在 CI 环境设置：

```text
ELECTRON_DISABLE_SANDBOX=1
ELECTRON_ENABLE_LOGGING=1
```

`ELECTRON_DISABLE_SANDBOX=1` 仅用于 GitHub Runner 的 Xvfb 环境。已验证的错误特征是：

```text
The SUID sandbox helper binary was found, but is not configured correctly.
... chrome-sandbox is owned by root and has mode 4755.
```

不要通过修改 `node_modules` 文件权限来解决 CI 问题；依赖重装后会失效，也会让本地与 CI 行为不一致。

## GUI 失败诊断

`tests/gui-smoke.js` 已做两件事：

1. 清理 Electron 进程和临时 `HOME`，避免失败后残留进程或用户数据。
2. 失败时把错误栈和 Electron stderr 编码为 GitHub Actions `::error::` 注解。

因此排查远端失败时优先看 check-run annotation；它比“Process completed with exit code 1”更能定位根因。CI 还会把 `gui.log` 的最后 120 行写入 job summary。

注意：Xvfb 环境里可能出现 D-Bus、GPU、dri3 等非致命 warning。只有配合断言失败或进程退出码时才需要处理，不要仅因这些 warning 增加依赖或禁用功能。

## 跨平台焦点样式

不要依赖浏览器默认 focus 样式或只在深色模式中定义 `:focus-visible`。本仓库已验证过 Linux 与 macOS 的焦点判定差异会导致同一测试得到 `outline-style: none`。

当前约定：

- 所有 `button`、`input`、`select`、`textarea` 的 `:focus-visible` 统一显示 2px 轮廓。
- 搜索框额外使用 `:focus` 显示轮廓，保证程序化聚焦和快捷键聚焦也可见。
- 浅色与深色模式都通过 `--accent` 变量维护同一焦点规则。

## macOS 打包与发布

- macOS 仅支持 Apple Silicon，构建目标固定为 `arm64`；不要添加 Intel 或 universal。
- 本仓库当前未签名、未公证，`mac.identity` 为 `null`。
- Release workflow 使用 `GH_TOKEN: ${{ github.token }}`，不要提交 GitHub Personal Access Token，也不要在本地日志中输出 token。
- 推送 `v*` 标签会触发 Release。已有 Release 不要重打同名标签；需要重新发布时先升级 `package.json` 版本并创建新标签。
- 本地构建 macOS 产物使用 `npm run dist:mac`；Electron 下载慢时可临时设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 已验证决策

| 问题 | 决策 |
| --- | --- |
| `ubuntu-latest` 镜像漂移 | 固定 `ubuntu-24.04` |
| Electron SUID sandbox 在 Runner 上失败 | 仅 CI 设置 `ELECTRON_DISABLE_SANDBOX=1` |
| 远端日志缺少具体错误 | GUI 测试输出 GitHub annotation，并写 job summary |
| Linux/macOS focus 样式不一致 | 显式定义全局 `:focus-visible` 与搜索框 `:focus` |
| macOS 构建范围 | 仅 `arm64`，不输出 Intel/universal |
| Release 鉴权 | 使用 `github.token`，不提交 PAT |
