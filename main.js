const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, screen } = require('electron');
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
  },
};

let mainWindow = null;
let floatWindow = null;
let tray = null;
let quitting = false;
let data = null;
let saveTimer = null;
let floatBoundsTimer = null;

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
  scheduleSave();
  if ('floatEnabled' in patch) applyFloat();
  broadcast();
}

// ---------- 提醒调度 ----------
function tickReminders() {
  const now = Date.now();
  const today = ymd(new Date());
  let changed = false;
  for (const t of data.tasks) {
    if (t.done || t.date !== today || !t.time || t.remindLead == null || t.reminded) continue;
    const [hh, mm] = t.time.split(':').map(Number);
    const taskTime = new Date();
    taskTime.setHours(hh, mm, 0, 0);
    const remindAt = taskTime.getTime() - t.remindLead * 60 * 1000;
    const deadline = taskTime.getTime() + 60 * 1000; // 过点 1 分钟内仍可提醒，防止调度间隙漏发
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
    for (const key of ['title', 'note', 'date', 'time', 'remindLead', 'priority', 'category']) {
      if (key in patch) {
        let v = patch[key];
        if (key === 'title') v = String(v || '').trim().slice(0, 100);
        else if (key === 'note') v = String(v || '').slice(0, 500);
        else if (key === 'remindLead') v = v == null || v === '' ? null : Number(v);
        else if (key === 'priority') v = ['high', 'medium', 'low'].includes(v) ? v : t.priority;
        else if (key === 'category') v = String(v || '').slice(0, 20);
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
    scheduleSave();
    broadcast();
    return { ok: true, task: t };
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
    Menu.setApplicationMenu(null);
    registerIpc();

    tray = new Tray(TRAY_PATH);
    updateTray();

    createMainWindow();
    if (data.settings.floatEnabled) applyFloat();

    tickReminders();
    setInterval(tickReminders, 20 * 1000);
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：仅在退出流程中真正退出
    if (quitting) app.quit();
  });
}
