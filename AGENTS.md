# AGENTS.md

## 项目定位

DailyList 是一个面向 Windows 与 macOS 的 Electron 桌面待办应用；macOS 仅支持 Apple Silicon。核心原则是本地优先、轻量、无登录、无联网同步、无遥测。当前技术栈为 Electron + 原生 HTML/CSS/JavaScript，不引入前端框架、状态管理库或后端服务，除非用户明确要求。

## 架构约束

- `main.js` 是唯一的数据所有者：文件读写、数据规范化、任务变更、提醒调度、导入导出、窗口与托盘管理都必须在主进程完成。
- 渲染进程不得直接访问 Node.js、文件系统或 Electron API；必须保持 `contextIsolation: true`、`nodeIntegration: false`，并通过 `preload.js` 暴露白名单 IPC API。
- `src/js/app.js` 只负责主窗口交互与渲染，`src/js/float.js` 只负责悬浮窗交互与渲染，二者共享的逻辑放在 `src/js/common.js`。
- 用户输入必须使用 `escapeHTML` 后再进入 HTML 模板；不要使用 `innerHTML` 直接拼接未转义的标题、备注或分类。
- 新增 IPC API 时必须同步更新 `preload.js`，并在主进程入口处完成输入校验和数据规范化。
- UI 文案默认简体中文；深色模式样式必须与浅色模式同步维护。

## 产品需求规范

### 任务

- 支持新增、编辑、完成/取消完成、删除、删除后 6 秒内撤销。
- 标题必填，修剪空白后长度为 1–100 字符；备注最长 500 字符；分类最长 20 字符。
- 优先级仅支持 `high`、`medium`、`low`，默认 `medium`。
- 日期必须是真实存在的 `YYYY-MM-DD`；时间必须是 `HH:MM` 且为 00:00–23:59。
- 提醒提前量仅支持 `null`（不提醒）、`0`、`5`、`10`、`15`、`30`、`60` 分钟；没有时间时必须没有提醒。
- 重复规则仅支持 `null`（不重复）、`daily`、`weekly`。
- 每条任务必须有唯一非空 `id`；导入或历史数据修复时发现重复 ID 必须重新生成，不能保留歧义数据。

### 列表与搜索

- 默认展示当前查看日期的未完成任务，并按优先级、时间排序；已完成任务放入“已完成”折叠区。
- 日期导航支持前一天、后一天、回到今天；搜索激活时不能让用户误以为仍在查看单日列表，需明确显示搜索状态或退出搜索。
- 搜索范围包含标题、备注、分类，大小写不敏感，输入即时过滤。
- 搜索结果跨日期展示，按日期从早到晚排序，每条结果显示归属日期标签；`Esc` 清空并退出搜索。
- Windows 使用 `Ctrl+F` 聚焦搜索框、`Ctrl+N` 聚焦快速添加输入框；macOS 使用对应 `Cmd` 快捷键。

### 重复任务与提醒

- 完成每日/每周重复任务后，自动生成下一次未完成实例；去重规则必须包含重复规则、标题、日期、时间和分类，避免不同配置的同名任务被误合并。
- 取消完成重复任务时，仅删除由该任务自动生成且仍未完成的下一次实例；用户手工创建或已完成的实例不得被误删。
- 未完成的重复任务跨天后滚动到今天，并重置提醒状态。
- 提醒调度每 20 秒检查一次；计划字段变更后必须重置 `reminded`。
- 睡眠唤醒后允许 15 分钟补发窗口；正常运行时允许到点后 1 分钟内的提醒，避免调度间隙漏发。
- 点击提醒通知必须打开主窗口。

### 数据与设置

- Windows 数据文件位于 `%APPDATA%\每日清单\todo-data.json`；macOS 数据文件位于 `~/Library/Application Support/每日清单/todo-data.json`；备份均为 `todo-data.backup.json`。
- 主数据损坏时回退备份；两者都不可用才使用默认数据。
- 写入必须先写临时文件，成功后再原子替换主文件；备份必须始终保存最近一次成功写入的数据，不能用损坏内容覆盖可用备份。
- 分类列表必须去重、去除空值、每项最长 20 字符、最多 50 个。
- `autoCleanDays` 仅支持 `0`、`7`、`30`、`90`，`0` 表示不清理。
- 导入数据必须先确认覆盖，导入后统一经过数据规范化；`autoLaunch` 无论 true/false 都必须同步到系统开机启动设置。
- 导出 JSON 包含 `app: "DailyList"`、`version`、`exportedAt`、`tasks`、`settings`。

### 桌面集成

- 关闭主窗口时应用常驻托盘；托盘悬停显示今日剩余未完成数量；Windows 左键点击托盘打开主窗口，右键菜单提供悬浮窗开关与退出。
- macOS 使用 `assets/trayTemplate.png` 作为菜单栏模板图标，保留标准应用菜单；点击 Dock 图标必须重新显示主窗口。
- 悬浮窗置顶显示今日未完成任务，可拖动，位置持久化，且不能移出屏幕工作区。
- 支持系统深浅色模式自动切换。

## 当前待完善清单

以下事项按优先级排列，后续修改应优先处理高优先级问题，不要引入无关重构。

1. **发布信任（高）**：Windows 安装包与 macOS DMG 尚未代码签名；macOS 也未公证。需要开发者证书、Apple 公证凭据和安全的 CI Secret 后再实施。
2. **Windows 手工冒烟（中，当前受阻）**：维护者暂无可用 Windows 实机。CI 已运行 Windows GUI 冒烟，但仍不能覆盖安装版、便携版、托盘交互、系统通知、开机自启和真实重启；获得设备后必须补做发布前手工验证。
3. **可访问性精修（低）**：设置弹窗仍可补充焦点圈定、`aria-modal` 与关闭后焦点返回；macOS 文案可动态显示 `Cmd` 快捷键。

## 验证要求

- **特性需求开发结束（高）**：必须执行自验证后才能交付。至少运行相关语法检查或测试，并针对该特性完成一次手工冒烟验证；无法本地验证时必须说明原因、已验证范围和剩余风险。
- 每次修改 JavaScript 后运行：

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

- 涉及 UI 的改动需运行 `npm run test:gui` 做自动化冒烟测试；涉及视觉样式或布局时，还需运行 `npm start` 做人工确认。
- 涉及数据结构、导入导出、重复任务或提醒的改动，必须补充或运行对应测试；没有测试时至少用临时数据文件验证损坏 JSON、备份回退和导入结果。
- 修改 CI、GUI 冒烟测试、打包或发布流程前，必须先阅读 `docs/development.md`；GUI CI 固定 `ubuntu-24.04`，Xvfb 环境需设置 `ELECTRON_DISABLE_SANDBOX=1`，macOS 仅构建 `arm64`。
- 发布相关改动需运行 `npm run dist:mac` 并确认 macOS Apple Silicon 产物生成；如需同时发布 Windows，再运行 `npm run dist` 并确认安装版与便携版产物生成。
- 不提交 `release/`、`node_modules/`、`.DS_Store` 或用户本地数据文件。
