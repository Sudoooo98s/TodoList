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
const TRAY_PATH = path.join(__dirname, 'assets', 'tray.png');

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

// ---------- 数据存储 ----------
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      data = {
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
      };
      return;
    }
  } catch (err) {
    console.error('读取数据失败，尝试备份:', err);
    try {
      if (fs.existsSync(BACKUP_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8'));
        data = {
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          settings: { ...DEFAULT_DATA.settings, ...(parsed.settings || {}) },
        };
        return;
      }
    } catch (e) {
      console.error('读取备份也失败:', e);
    }
  }
  data = JSON.parse(JSON.stringify(DEFAULT_DATA));
}

function saveData() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 先备份上一份
    if (fs.existsSync(DATA_FILE)) {
      fs.copyFileSync(DATA_FILE, BACKUP_FILE);
    }
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('保存数据失败:', err);
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
  return { tasks: data.tasks, settings: data.settings, dataFile: DATA_FILE };
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
  // 记录拖动后的位置
  floatWindow.on('moved', () => {
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
function setSetting(patch) {
  data.settings = { ...data.settings, ...patch };
  if ('autoLaunch' in patch) {
    app.setLoginItemSettings({ openAtLogin: !!patch.autoLaunch });
  }
  scheduleSave();
  if ('floatEnabled' in patch) applyFloat();
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
    const t = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: String(task.title || '').trim().slice(0, 100),
      note: String(task.note || '').slice(0, 500),
      date: task.date || ymd(new Date()),
      time: task.time || null,
      remindLead: task.remindLead == null || task.remindLead === '' ? null : Number(task.remindLead),
      priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
      category: String(task.category || '').slice(0, 20),
      repeat: ['daily', 'weekly'].includes(task.repeat) ? task.repeat : null,
      done: false,
      doneAt: null,
      reminded: false,
      createdAt: Date.now(),
    };
    if (!t.title) return { ok: false, error: '标题不能为空' };
    data.tasks.push(t);
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
  });

  ipcMain.handle('task:update', (e, { id, patch }) => {
    const t = data.tasks.find((x) => x.id === id);
    if (!t) return { ok: false, error: '任务不存在' };
    const scheduleFields = ['date', 'time', 'remindLead'];
    let scheduleChanged = false;
    for (const key of ['title', 'note', 'date', 'time', 'remindLead', 'priority', 'category', 'repeat']) {
      if (key in patch) {
        let v = patch[key];
        if (key === 'title') v = String(v || '').trim().slice(0, 100);
        else if (key === 'note') v = String(v || '').slice(0, 500);
        else if (key === 'remindLead') v = v == null || v === '' ? null : Number(v);
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
    // 完成重复任务时生成下一次实例（按标题+日期去重，防止反复勾选产生重复）
    if (t.done && t.repeat) {
      const nextDate = nextRepeatDate(t.date, t.repeat);
      const exists = data.tasks.some(
        (x) => x.repeat === t.repeat && x.title === t.title && x.date === nextDate && !x.done
      );
      if (!exists) {
        data.tasks.push({
          ...t,
          id: `${Date.now()}-r${Math.random().toString(36).slice(2, 6)}`,
          date: nextDate,
          done: false,
          doneAt: null,
          reminded: false,
          createdAt: Date.now(),
        });
      }
    }
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
  });

  // 撤销删除：按原样恢复任务对象
  ipcMain.handle('task:restore', (e, raw) => {
    if (!raw || typeof raw !== 'object' || !raw.id || !String(raw.title || '').trim()) {
      return { ok: false, error: '无效的任务数据' };
    }
    if (data.tasks.some((x) => x.id === raw.id)) {
      return { ok: false, error: '任务已存在' };
    }
    data.tasks.push(raw);
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
    setSetting(patch || {});
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
      const tasks = Array.isArray(parsed.tasks)
        ? parsed.tasks.filter((t) => t && typeof t === 'object' && String(t.title || '').trim())
        : null;
      if (!tasks) return { ok: false, error: '文件格式不正确：缺少有效的 tasks 数组' };
      const settings = {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}),
      };
      data = { tasks, settings };
      if ('autoLaunch' in settings) app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch });
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

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dailylist.app');
    if (fs.existsSync(DATA_DIR) === false) fs.mkdirSync(DATA_DIR, { recursive: true });
    loadData();
    lastDay = ymd(new Date());
    rolloverRepeatingTasks();
    cleanOldDone();
    Menu.setApplicationMenu(null);
    registerIpc();

    tray = new Tray(TRAY_PATH);
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
