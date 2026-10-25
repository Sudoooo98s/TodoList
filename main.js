const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen, dialog, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '每日清单';
app.setName(APP_NAME);
// 统一数据目录，保证开发与打包后数据一致：%APPDATA%\每日清单
const DATA_DIR = path.join(app.getPath('appData'), APP_NAME);
app.setPath('userData', DATA_DIR);
const DATA_FILE = path.join(DATA_DIR, 'todo-data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'todo-data.backup.json');
const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const TRAY_PATH = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png');

const DEFAULT_DATA = {
  tasks: [],
  settings: {
    categories: ['工作', '生活', '学习'],
    floatEnabled: false,
    floatBounds: null,
    autoLaunch: false,
    autoCleanDays: 0,
  },
};

let mainWindow = null;
let floatWindow = null;
let tray = null;
let quitting = false;
let data = null;
let saveTimer = null;
let floatBoundsTimer = null;
let lastDay = null; // 用于跨天检测
let lastSaveError = null;

// ---------- 数据存储 ----------
function loadData() {
  // 主文件损坏时自动回退到备份
  for (const file of [DATA_FILE, BACKUP_FILE]) {
    try {
      if (!fs.existsSync(file)) continue;
      data = normalizeData(JSON.parse(fs.readFileSync(file, 'utf-8')));
      return;
    } catch (err) {
      console.error(`读取数据失败(${file}):`, err);
    }
  }
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData() {
  const hadSaveError = lastSaveError !== null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
    fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    lastSaveError = null;
    if (hadSaveError) broadcast();
  } catch (err) {
    lastSaveError = '数据保存或备份失败，请检查磁盘空间和文件权限';
    console.error('保存数据失败:', err);
    broadcast();
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveData, 300);
}

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const REMIND_LEADS = new Set([0, 5, 10, 15, 30, 60]);
const AUTO_CLEAN_DAYS = new Set([0, 7, 30, 90]);

function normalizeRemindLead(value) {
  if (value == null || value === '') return null;
  const lead = Number(value);
  return REMIND_LEADS.has(lead) ? lead : null;
}

function generateTaskId(prefix = 't') {
  return `${Date.now()}-${prefix}${Math.random().toString(36).slice(2, 8)}`;
}

function assignUniqueId(task, existingIds, prefix = 'n') {
  if (!existingIds.has(task.id)) {
    existingIds.add(task.id);
    return task.id;
  }

  let id = generateTaskId(prefix);
  while (existingIds.has(id)) id = generateTaskId(prefix);
  existingIds.add(id);
  task.id = id;
  return id;
}

// 规范化单条任务：修复历史/导入数据中的缺字段与非法值，防止排序 NaN、重复任务生成 NaN 日期等问题
function normalizeTask(raw, idx = 0) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const time = isValidTime(r.time) ? r.time : null;
  const remindLead = time ? normalizeRemindLead(r.remindLead) : null;
  const done = !!r.done;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateTaskId(),
    title: String(r.title || '').trim().slice(0, 100),
    note: String(r.note || '').slice(0, 500),
    date: isValidDate(r.date) ? r.date : ymd(new Date()),
    time,
    remindLead,
    priority: ['high', 'medium', 'low'].includes(r.priority) ? r.priority : 'medium',
    category: String(r.category || '').slice(0, 20),
    repeat: ['daily', 'weekly'].includes(r.repeat) ? r.repeat : null,
    done,
    doneAt: done && Number.isFinite(Number(r.doneAt)) ? Number(r.doneAt) : null,
    reminded: !!r.reminded,
    createdAt: Number.isFinite(Number(r.createdAt)) ? Number(r.createdAt) : Date.now(),
    repeatSourceId: typeof r.repeatSourceId === 'string' && r.repeatSourceId ? r.repeatSourceId : null,
  };
}

function normalizeCategories(values, fallback = []) {
  if (!Array.isArray(values)) return [...fallback];
  return [...new Set(values.map((c) => String(c).trim().slice(0, 20)).filter(Boolean))].slice(0, 50);
}

function normalizeFloatBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
  return { x: Math.round(bounds.x), y: Math.round(bounds.y) };
}

// 规范化设置：防止导入文件中的非法结构污染运行时
function normalizeSettings(s) {
  const src = s && typeof s === 'object' ? s : {};
  const autoCleanDays = Number(src.autoCleanDays);
  return {
    categories: normalizeCategories(src.categories, DEFAULT_DATA.settings.categories),
    floatEnabled: !!src.floatEnabled,
    autoLaunch: !!src.autoLaunch,
    autoCleanDays: AUTO_CLEAN_DAYS.has(autoCleanDays) ? autoCleanDays : 0,
    floatBounds: normalizeFloatBounds(src.floatBounds),
  };
}

function normalizeData(parsed) {
  const p = parsed && typeof parsed === 'object' ? parsed : {};
  const tasks = (Array.isArray(p.tasks) ? p.tasks : [])
    .map(normalizeTask)
    .filter((t) => t.title);
  const existingIds = new Set();
  for (const task of tasks) assignUniqueId(task, existingIds);
  return {
    tasks,
    settings: normalizeSettings(p.settings),
  };
}

// ---------- 重复任务与历史清理 ----------
function nextRepeatDate(dateStr, repeat) {
  return repeat === 'weekly' ? addDays(dateStr, 7) : addDays(dateStr, 1);
}

// 未完成的重复任务跨天后滚动到今天，避免滞留在过去的日期
function rolloverRepeatingTasks() {
  const today = ymd(new Date());
  let changed = false;
  for (const t of data.tasks) {
    if (t.repeat && !t.done && t.date < today) {
      t.date = today;
      t.reminded = false;
      changed = true;
    }
  }
  return changed;
}

// 按设置自动清理 N 天前已完成的任务，返回是否有清理
function cleanOldDone() {
  const days = Number(data.settings.autoCleanDays) || 0;
  if (days <= 0) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const before = data.tasks.length;
  data.tasks = data.tasks.filter((t) => !(t.done && t.doneAt && t.doneAt < cutoff));
  return data.tasks.length !== before;
}

// 跨天检测：强制广播一次，让悬浮窗/托盘提示切换到新的一天
function checkDayRollover() {
  const today = ymd(new Date());
  if (lastDay === null) {
    lastDay = today;
    return;
  }
  if (today !== lastDay) {
    lastDay = today;
    const rolled = rolloverRepeatingTasks();
    const cleaned = cleanOldDone();
    if (rolled || cleaned) scheduleSave();
    broadcast();
  }
}

// ---------- 广播与托盘 ----------
function payload() {
  return { tasks: data.tasks, settings: data.settings, dataFile: DATA_FILE, saveError: lastSaveError };
}

function broadcast() {
  for (const w of [mainWindow, floatWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('data-changed', payload());
  }
  updateTray();
}

function todayRemainingCount() {
  const today = ymd(new Date());
  return data.tasks.filter((t) => t.date === today && !t.done).length;
}

function updateTray() {
  if (!tray) return;
  const n = todayRemainingCount();
  tray.setToolTip(n > 0 ? `每日清单 · 今天还有 ${n} 件未完成` : '每日清单 · 今天没有待办啦');
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => showMain() },
    {
      label: '悬浮窗',
      type: 'checkbox',
      checked: !!data.settings.floatEnabled,
      click: (item) => setSetting({ floatEnabled: item.checked }),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
  ]));
}

// ---------- 主窗口 ----------
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1060,
    height: 740,
    minWidth: 840,
    minHeight: 600,
    backgroundColor: '#f5f6fa',
    autoHideMenuBar: true,
    show: false,
    icon: ICON_PATH,
    title: '每日清单',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // 关闭时隐藏到托盘
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// ---------- 悬浮窗 ----------
function createFloatWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  floatWindow = new BrowserWindow({
    width: 320,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  floatWindow.setAlwaysOnTop(true, 'screen-saver');
  floatWindow.loadFile(path.join(__dirname, 'src', 'float.html'));

  // 默认位置：工作区右下角
  const b = data.settings.floatBounds;
  if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
    floatWindow.setPosition(Math.round(b.x), Math.round(b.y));
  } else {
    floatWindow.setPosition(sw - 320 - 16, sh - 520 - 16);
  }
  // 记录拖动后的位置（move 事件在 Windows 无边框窗口上比 moved 更可靠，配合防抖落盘）
  floatWindow.on('move', () => {
    clearTimeout(floatBoundsTimer);
    floatBoundsTimer = setTimeout(() => {
      if (floatWindow && !floatWindow.isDestroyed()) {
        const [x, y] = floatWindow.getPosition();
        data.settings.floatBounds = { x, y };
        scheduleSave();
      }
    }, 400);
  });
  floatWindow.on('closed', () => {
    floatWindow = null;
  });
}

function applyFloat() {
  if (data.settings.floatEnabled) {
    if (!floatWindow || floatWindow.isDestroyed()) createFloatWindow();
    clampFloatIntoScreen();
    floatWindow.showInactive();
  } else if (floatWindow && !floatWindow.isDestroyed()) {
    floatWindow.hide();
  }
}

function clampFloatIntoScreen() {
  if (!floatWindow || floatWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(
    data.settings.floatBounds
      ? { x: data.settings.floatBounds.x, y: data.settings.floatBounds.y }
      : screen.getCursorScreenPoint()
  );
  const wa = display.workArea;
  const [x, y] = floatWindow.getPosition();
  const [w, h] = floatWindow.getSize();
  const nx = Math.min(Math.max(x, wa.x), wa.x + wa.width - w);
  const ny = Math.min(Math.max(y, wa.y), wa.y + wa.height - h);
  if (nx !== x || ny !== y) floatWindow.setPosition(nx, ny);
}

// ---------- 设置 ----------
function normalizeSettingsPatch(patch) {
  const src = patch && typeof patch === 'object' ? patch : {};
  const out = {};
  const current = data && data.settings ? data.settings : DEFAULT_DATA.settings;

  if (Array.isArray(src.categories)) {
    out.categories = normalizeCategories(src.categories, current.categories);
  }
  if ('floatEnabled' in src) out.floatEnabled = !!src.floatEnabled;
  if ('autoLaunch' in src) out.autoLaunch = !!src.autoLaunch;
  if ('autoCleanDays' in src) {
    const days = Number(src.autoCleanDays);
    out.autoCleanDays = AUTO_CLEAN_DAYS.has(days) ? days : current.autoCleanDays;
  }

  return out;
}

function setSetting(patch) {
  const normalizedPatch = normalizeSettingsPatch(patch);
  data.settings = { ...data.settings, ...normalizedPatch };
  if ('autoLaunch' in normalizedPatch) {
    app.setLoginItemSettings({ openAtLogin: !!normalizedPatch.autoLaunch });
  }
  scheduleSave();
  if ('floatEnabled' in normalizedPatch) applyFloat();
  broadcast();
}

// ---------- 提醒调度 ----------
function tickReminders(resumeGrace = false) {
  checkDayRollover();
  const now = Date.now();
  const today = ymd(new Date());
  let changed = false;
  for (const t of data.tasks) {
    if (t.done || t.date !== today || !t.time || t.remindLead == null || t.reminded) continue;
    const [hh, mm] = t.time.split(':').map(Number);
    const taskTime = new Date();
    taskTime.setHours(hh, mm, 0, 0);
    const remindAt = taskTime.getTime() - t.remindLead * 60 * 1000;
    // 过点 1 分钟内仍可提醒，防止调度间隙漏发；睡眠唤醒后放宽到 15 分钟补发错过的提醒
    const graceMin = resumeGrace ? 15 : 1;
    const deadline = taskTime.getTime() + graceMin * 60 * 1000;
    if (now >= remindAt && now <= deadline) {
      t.reminded = true;
      changed = true;
      if (Notification.isSupported()) {
        const leadText = t.remindLead === 0 ? '时间到了' : `还有 ${t.remindLead} 分钟`;
        const n = new Notification({
          title: '任务提醒',
          body: `${leadText}：${t.title}（${t.time}）`,
          icon: ICON_PATH,
        });
        n.on('click', () => showMain());
        n.show();
      }
    }
  }
  if (changed) {
    scheduleSave();
    broadcast();
  }
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('data:get', () => payload());

  ipcMain.handle('task:add', (e, task) => {
    const input = task && typeof task === 'object' ? task : {};
    const t = normalizeTask({
      ...input,
      id: null,
      done: false,
      doneAt: null,
      reminded: false,
      createdAt: Date.now(),
    });
    if (!t.title) return { ok: false, error: '标题不能为空' };
    data.tasks.push(t);
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
  });

  ipcMain.handle('task:update', (e, request) => {
    const { id, patch } = request && typeof request === 'object' ? request : {};
    const t = data.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: '任务不存在' };

    const source = patch && typeof patch === 'object' ? patch : {};
    const allowedFields = ['title', 'note', 'date', 'time', 'remindLead', 'priority', 'category', 'repeat'];
    const p = {};
    for (const key of allowedFields) {
      if (key in source) p[key] = source[key];
    }
    if ('title' in p && !String(p.title || '').trim()) {
      return { ok: false, error: '标题不能为空' };
    }

    if ('date' in p && !isValidDate(p.date)) delete p.date;
    if ('time' in p) {
      p.time = isValidTime(p.time) ? p.time : null;
      if ('remindLead' in p) p.remindLead = normalizeRemindLead(p.remindLead);
      if (p.time === null) p.remindLead = null;
    }
    if ('remindLead' in p) {
      p.remindLead = normalizeRemindLead(p.remindLead);
      if (!('time' in p) && !t.time) p.remindLead = null;
    }

    const scheduleFields = ['date', 'time', 'remindLead'];
    let scheduleChanged = false;
    for (const key of ['title', 'note', 'date', 'time', 'remindLead', 'priority', 'category', 'repeat']) {
      if (key in p) {
        let v = p[key];
        if (key === 'title') v = String(v || '').trim().slice(0, 100);
        else if (key === 'note') v = String(v || '').slice(0, 500);
        else if (key === 'priority') v = ['high', 'medium', 'low'].includes(v) ? v : t.priority;
        else if (key === 'category') v = String(v || '').slice(0, 20);
        else if (key === 'repeat') v = ['daily', 'weekly'].includes(v) ? v : null;
        if (scheduleFields.includes(key) && v !== t[key]) scheduleChanged = true;
        t[key] = v;
      }
    }
    if (scheduleChanged) t.reminded = false; // 计划变更后重新安排提醒
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
  });

  ipcMain.handle('task:toggle', (e, id) => {
    const t = data.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: '任务不存在' };
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
      // 完成重复任务时生成下一次实例（同名但时间/分类不同的任务不合并）
    if (t.done && t.repeat) {
      const nextDate = nextRepeatDate(t.date, t.repeat);
      const exists = data.tasks.some(
          (x) =>
            x.repeat === t.repeat &&
            x.title === t.title &&
            x.date === nextDate &&
            x.time === t.time &&
            x.category === t.category &&
            !x.done
      );
      if (!exists) {
        data.tasks.push({
          ...t,
            id: generateTaskId('r'),
          date: nextDate,
          done: false,
          doneAt: null,
          reminded: false,
          createdAt: Date.now(),
          repeatSourceId: t.id,
        });
      }
    }
    if (!t.done && t.repeat) {
      data.tasks = data.tasks.filter((task) => !(
        task.repeatSourceId === t.id &&
        !task.done &&
        task.repeat === t.repeat &&
        task.title === t.title &&
        task.date === nextRepeatDate(t.date, t.repeat) &&
        task.time === t.time &&
        task.category === t.category
      ));
    }
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
  });

  // 撤销删除：恢复前统一规范化，避免非法或重复 ID 数据重新入库
  ipcMain.handle('task:restore', (e, raw) => {
    const restored = normalizeTask(raw);
    if (!restored.title) {
      return { ok: false, error: '无效的任务数据' };
    }
    const existingIds = new Set(data.tasks.map((task) => task.id));
    assignUniqueId(restored, existingIds, 'u');
    data.tasks.push(restored);
    scheduleSave();
    broadcast();
    return { ok: true };
  });

  ipcMain.handle('task:delete', (e, id) => {
    const before = data.tasks.length;
    data.tasks = data.tasks.filter((x) => x.id !== id);
    if (data.tasks.length !== before) {
      scheduleSave();
      broadcast();
    }
    return { ok: true };
  });

  ipcMain.handle('settings:set', (e, patch) => {
    setSetting(patch);
    return { ok: true, settings: data.settings };
  });

  // 导出全部数据到用户选择的 JSON 文件
  ipcMain.handle('data:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出数据',
      defaultPath: path.join(app.getPath('documents'), `dailylist-backup-${ymd(new Date()).replace(/-/g, '')}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    try {
      const payload = {
        app: 'DailyList',
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: data.tasks,
        settings: data.settings,
      };
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: '写入文件失败：' + err.message };
    }
  });

  // 从 JSON 备份文件导入并覆盖当前数据
  ipcMain.handle('data:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };
    try {
      const parsed = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tasks)) {
        return { ok: false, error: '文件格式不正确：缺少有效的 tasks 数组' };
      }
      data = normalizeData(parsed);
      app.setLoginItemSettings({ openAtLogin: !!data.settings.autoLaunch });
      lastDay = ymd(new Date());
      rolloverRepeatingTasks();
      cleanOldDone();
      scheduleSave();
      broadcast();
      return { ok: true, count: data.tasks.length };
    } catch (err) {
      return { ok: false, error: '导入失败：' + err.message };
    }
  });

  ipcMain.handle('float:close', () => {
    setSetting({ floatEnabled: false });
    return { ok: true };
  });

  ipcMain.handle('notify:test', () => {
    if (Notification.isSupported()) {
      const n = new Notification({
        title: '通知测试',
        body: '这是一条提醒测试，到点提醒就会这样弹出。',
        icon: ICON_PATH,
      });
      n.on('click', () => showMain());
      n.show();
      return { ok: true };
    }
    return { ok: false, error: '当前系统不支持通知' };
  });

  ipcMain.on('win:show', () => showMain());
  ipcMain.on('win:hide', () => mainWindow && mainWindow.hide());
  ipcMain.on('win:minimize', () => mainWindow && mainWindow.minimize());
}

// ---------- 应用生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());
  app.on('activate', () => showMain());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dailylist.app');
    if (fs.existsSync(DATA_DIR) === false) fs.mkdirSync(DATA_DIR, { recursive: true });
    loadData();
    lastDay = ymd(new Date());
    rolloverRepeatingTasks();
    cleanOldDone();
    createApplicationMenu();
    registerIpc();

    tray = new Tray(TRAY_PATH);
    // Windows 下托盘左键点击直接打开主窗口（右键菜单不受影响）
    if (process.platform === 'win32') tray.on('click', () => showMain());
    updateTray();

    createMainWindow();
    if (data.settings.floatEnabled) applyFloat();

    tickReminders();
    setInterval(tickReminders, 20 * 1000);

    // 睡眠唤醒后立即补一次提醒检查，补发错过的提醒
    powerMonitor.on('resume', () => {
      checkDayRollover();
      tickReminders(true);
    });
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：仅在退出流程中真正退出
    if (quitting) app.quit();
  });
}
