const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const TEST_APP_DATA = path.join('/tmp', 'dailylist-test', 'appData');
const DATA_DIR = path.join(TEST_APP_DATA, '每日清单');
const DATA_FILE = path.join(DATA_DIR, 'todo-data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'todo-data.backup.json');

function createMemoryFs(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    existsSync(file) {
      return files.has(file);
    },
    readFileSync(file) {
      if (!files.has(file)) throw new Error(`ENOENT: ${file}`);
      return files.get(file);
    },
    writeFileSync(file, content) {
      files.set(file, content);
    },
    renameSync(from, to) {
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      files.set(to, files.get(from));
      files.delete(from);
    },
    copyFileSync(from, to) {
      if (!files.has(from)) throw new Error(`ENOENT: ${from}`);
      files.set(to, files.get(from));
    },
    mkdirSync() {},
  };
}

function loadMainProcess({
  fsMock = fs,
  fixedNow = null,
  platform = 'win32',
  dialogMock = {
    showSaveDialog: async () => ({ canceled: true }),
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
  },
} = {}) {
  const ipcHandlers = new Map();
  const notifications = [];
  const loginSettings = [];
  const applicationMenus = [];
  const consoleErrors = [];
  let currentNow = fixedNow;

  class MockDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [currentNow ?? Date.now()]));
    }

    static now() {
      return currentNow ?? Date.now();
    }
  }

  class MockNotification {
    constructor(options) {
      this.options = options;
      notifications.push(options);
    }

    on() {}

    show() {}

    static isSupported() {
      return true;
    }
  }

  const electronMock = {
    app: {
      setName() {},
      setPath() {},
      getPath: (name) => path.join('/tmp', 'dailylist-test', name),
      requestSingleInstanceLock: () => false,
      quit() {},
      setLoginItemSettings(settings) {
        loginSettings.push(settings);
      },
    },
    BrowserWindow: class {},
    Tray: class {},
    Menu: {
      setApplicationMenu(menu) {
        applicationMenus.push(menu);
      },
      buildFromTemplate(template) {
        return { template };
      },
    },
    Notification: MockNotification,
    ipcMain: {
      handle(name, handler) {
        ipcHandlers.set(name, handler);
      },
      on() {},
    },
    screen: {},
    dialog: dialogMock,
    powerMonitor: { on() {} },
  };

  function requireMock(id) {
    if (id === 'electron') return electronMock;
    if (id === 'fs') return fsMock;
    return require(id);
  }

  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf-8');
  const sandbox = {
    module: { exports: {} },
    require: requireMock,
    console: {
      error(...args) {
        consoleErrors.push(args);
      },
      log() {},
    },
    __dirname: path.join(__dirname, '..'),
    process: { platform },
    Date: MockDate,
    setTimeout: () => 1,
    clearTimeout: () => {},
    setInterval: () => 1,
  };
  const exports = `
    module.exports = {
      isValidDate,
      isValidTime,
      normalizeRemindLead,
      normalizeTask,
      normalizeSettings,
      normalizeData,
      nextRepeatDate,
      saveData,
      loadData,
      payload,
      tickReminders,
      registerIpc,
      createApplicationMenu,
    };
  `;
  vm.runInNewContext(source + exports, sandbox, { filename: 'main.js' });
  return {
    main: sandbox.module.exports,
    ipcHandlers,
    notifications,
    loginSettings,
    applicationMenus,
    consoleErrors,
  };
}

function localDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test('validates real dates and times', () => {
  const { main } = loadMainProcess();
  assert.equal(main.isValidDate('2026-02-28'), true);
  assert.equal(main.isValidDate('2026-02-30'), false);
  assert.equal(main.isValidDate('2026-2-28'), false);
  assert.equal(main.isValidTime('23:59'), true);
  assert.equal(main.isValidTime('24:00'), false);
});

test('normalizes task fields and allowed reminder leads', () => {
  const { main } = loadMainProcess();
  const task = main.normalizeTask({
    title: '  需求评审  ',
    note: '准备材料',
    date: '2026-02-30',
    time: '09:30',
    remindLead: 7,
    priority: 'urgent',
    category: '工作',
    repeat: 'monthly',
    repeatSourceId: 'source-task',
  });

  assert.equal(task.title, '需求评审');
  assert.equal(task.date, new Date().toISOString().slice(0, 10));
  assert.equal(task.time, '09:30');
  assert.equal(task.remindLead, null);
  assert.equal(task.priority, 'medium');
  assert.equal(task.repeat, null);
  assert.equal(task.repeatSourceId, 'source-task');
  assert.equal(main.normalizeRemindLead('15'), 15);
  assert.equal(main.normalizeRemindLead(15), 15);
  assert.equal(main.normalizeRemindLead(7), null);
});

test('normalizes settings and drops unknown fields', () => {
  const { main } = loadMainProcess();
  const settings = main.normalizeSettings({
    categories: [' 工作 ', '工作', '', '生活'],
    floatEnabled: 1,
    autoLaunch: 0,
    autoCleanDays: 14,
    floatBounds: { x: 12.4, y: 34.7 },
    unknownField: 'must be dropped',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(settings)), {
    categories: ['工作', '生活'],
    floatEnabled: true,
    autoLaunch: false,
    autoCleanDays: 0,
    floatBounds: { x: 12, y: 35 },
  });
});

test('normalizing imported data filters empty tasks and resolves duplicate IDs', () => {
  const { main } = loadMainProcess();
  const result = main.normalizeData({
    tasks: [
      { id: 'duplicate', title: '第一个任务' },
      { id: 'duplicate', title: '第二个任务' },
      { title: '' },
    ],
    settings: { autoCleanDays: 30 },
  });

  assert.equal(result.tasks.length, 2);
  assert.equal(new Set(result.tasks.map((task) => task.id)).size, 2);
  assert.equal(result.settings.autoCleanDays, 30);
});

test('repeat dates cross month and year boundaries correctly', () => {
  const { main } = loadMainProcess();
  assert.equal(main.nextRepeatDate('2026-02-28', 'daily'), '2026-03-01');
  assert.equal(main.nextRepeatDate('2026-02-28', 'weekly'), '2026-03-07');
});

test('save writes the main file before replacing the backup', () => {
  const operations = [];
  const fsMock = {
    mkdirSync() {
      operations.push('mkdir');
    },
    writeFileSync(file) {
      operations.push(['write', file]);
    },
    renameSync(from, to) {
      operations.push(['rename', from, to]);
    },
    copyFileSync(from, to) {
      operations.push(['copy', from, to]);
    },
  };
  const { main } = loadMainProcess({ fsMock });
  main.saveData();

  assert.equal(operations[0], 'mkdir');
  assert.equal(operations[1][0], 'write');
  assert.equal(operations[2][0], 'rename');
  assert.equal(operations[3][0], 'copy');
  assert.equal(operations[3][2].endsWith('todo-data.backup.json'), true);
});

test('loadData falls back to backup when the main file is corrupted', () => {
  const fsMock = createMemoryFs({
    [DATA_FILE]: '{ corrupted',
    [BACKUP_FILE]: JSON.stringify({
      tasks: [{ id: 'backup-task', title: '备份任务' }],
      settings: { autoCleanDays: 30 },
    }),
  });
  const { main } = loadMainProcess({ fsMock });

  main.loadData();
  const loaded = main.payload();

  assert.equal(loaded.tasks.length, 1);
  assert.equal(loaded.tasks[0].id, 'backup-task');
  assert.equal(loaded.settings.autoCleanDays, 30);
});

test('loadData uses defaults when both data files are corrupted', () => {
  const fsMock = createMemoryFs({
    [DATA_FILE]: '{ corrupted',
    [BACKUP_FILE]: 'not-json',
  });
  const { main, consoleErrors } = loadMainProcess({ fsMock });

  main.loadData();
  const loaded = main.payload();

  assert.deepEqual(JSON.parse(JSON.stringify(loaded.tasks)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.settings.categories)), ['工作', '生活', '学习']);
  assert.equal(consoleErrors.length, 2);
});

test('reminder scheduling honors due, future, missed, and schedule changes', async () => {
  const fixedNow = new Date(2026, 1, 28, 10, 30, 0).getTime();
  const nowDate = new Date(fixedNow);
  const futureDate = new Date(fixedNow + 2 * 60 * 1000);
  const missedDate = new Date(fixedNow - 2 * 60 * 1000);
  const fsMock = createMemoryFs({
    [DATA_FILE]: JSON.stringify({
      tasks: [
        { id: 'due', title: '到点任务', date: localDate(nowDate), time: localTime(nowDate), remindLead: 0 },
        { id: 'future', title: '未来任务', date: localDate(futureDate), time: localTime(futureDate), remindLead: 0 },
        { id: 'missed', title: '错过任务', date: localDate(missedDate), time: localTime(missedDate), remindLead: 0 },
      ],
      settings: {},
    }),
  });
  const { main, ipcHandlers, notifications } = loadMainProcess({ fsMock, fixedNow });
  main.loadData();
  main.registerIpc();

  main.tickReminders();
  const tasks = main.payload().tasks;
  assert.equal(tasks.find((task) => task.id === 'due').reminded, true);
  assert.equal(tasks.find((task) => task.id === 'future').reminded, false);
  assert.equal(tasks.find((task) => task.id === 'missed').reminded, false);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].body.includes('到点任务'), true);

  const updated = await ipcHandlers.get('task:update')(null, {
    id: 'due',
    patch: { time: '10:35' },
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.task.reminded, false);
});

test('reminder scheduling resumes reminders missed within the sleep window', () => {
  const fixedNow = new Date(2026, 1, 28, 10, 30, 0).getTime();
  const missedDate = new Date(fixedNow - 10 * 60 * 1000);
  const fsMock = createMemoryFs({
    [DATA_FILE]: JSON.stringify({
      tasks: [{
        id: 'resume',
        title: '唤醒补发',
        date: localDate(missedDate),
        time: localTime(missedDate),
        remindLead: 0,
      }],
      settings: {},
    }),
  });
  const { main, notifications } = loadMainProcess({ fsMock, fixedNow });
  main.loadData();

  main.tickReminders();
  assert.equal(main.payload().tasks[0].reminded, false);
  assert.equal(notifications.length, 0);

  main.tickReminders(true);
  assert.equal(main.payload().tasks[0].reminded, true);
  assert.equal(notifications.length, 1);
});

test('import and export IPC normalize data and sync auto launch', async () => {
  const exportPath = '/tmp/dailylist-test/dailylist-export.json';
  const importPath = '/tmp/dailylist-test/dailylist-import.json';
  const fsMock = createMemoryFs({
    [DATA_FILE]: JSON.stringify({
      tasks: [{ id: 'current', title: '当前任务' }],
      settings: { categories: ['工作'], autoLaunch: false },
    }),
    [importPath]: JSON.stringify({
      app: 'DailyList',
      version: 1,
      tasks: [
        { id: 'duplicate', title: '导入任务一' },
        { id: 'duplicate', title: '导入任务二' },
      ],
      settings: { categories: [' 工作 ', '工作', '生活'], autoLaunch: true, autoCleanDays: 999 },
    }),
  });
  const dialogMock = {
    showSaveDialog: async () => ({ canceled: false, filePath: exportPath }),
    showOpenDialog: async () => ({ canceled: false, filePaths: [importPath] }),
  };
  const { main, ipcHandlers, loginSettings } = loadMainProcess({ fsMock, dialogMock });
  main.loadData();
  main.registerIpc();

  const exported = await ipcHandlers.get('data:export')();
  assert.equal(exported.ok, true);
  const exportPayload = JSON.parse(fsMock.files.get(exportPath));
  assert.equal(exportPayload.app, 'DailyList');
  assert.equal(exportPayload.version, 1);
  assert.equal(exportPayload.tasks.length, 1);
  assert.deepEqual(exportPayload.settings.categories, ['工作']);

  const imported = await ipcHandlers.get('data:import')();
  assert.equal(imported.ok, true);
  assert.equal(imported.count, 2);
  const loaded = main.payload();
  assert.equal(loaded.tasks.length, 2);
  assert.equal(new Set(loaded.tasks.map((task) => task.id)).size, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.settings.categories)), ['工作', '生活']);
  assert.equal(loaded.settings.autoLaunch, true);
  assert.equal(loaded.settings.autoCleanDays, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(loginSettings)), [{ openAtLogin: true }]);
});

test('canceling a completed repeating task removes only its generated next instance', async () => {
  const fsMock = createMemoryFs({
    [DATA_FILE]: JSON.stringify({
      tasks: [
        {
          id: 'source-a',
          title: '自动生成重复',
          date: '2026-02-28',
          time: '10:30',
          category: '工作',
          repeat: 'daily',
        },
        {
          id: 'source-b',
          title: '手工下一实例',
          date: '2026-02-28',
          time: '11:00',
          category: '生活',
          repeat: 'daily',
        },
        {
          id: 'manual-next-b',
          title: '手工下一实例',
          date: '2026-03-01',
          time: '11:00',
          category: '生活',
          repeat: 'daily',
        },
      ],
      settings: {},
    }),
  });
  const { main, ipcHandlers } = loadMainProcess({ fsMock });
  main.loadData();
  main.registerIpc();
  const toggle = (id) => ipcHandlers.get('task:toggle')(null, id);

  await toggle('source-a');
  await toggle('source-b');
  let tasks = main.payload().tasks;
  const generated = tasks.find((task) => task.repeatSourceId === 'source-a');
  assert.ok(generated);
  assert.equal(generated.date, '2026-03-01');
  assert.equal(tasks.filter((task) => task.title === '手工下一实例').length, 2);

  await toggle('source-a');
  await toggle('source-b');
  tasks = main.payload().tasks;
  assert.equal(tasks.some((task) => task.repeatSourceId === 'source-a'), false);
  assert.equal(tasks.some((task) => task.id === 'manual-next-b'), true);
  assert.equal(tasks.filter((task) => task.title === '手工下一实例').length, 2);
});

test('macOS uses a standard application menu', () => {
  const { main, applicationMenus } = loadMainProcess({ platform: 'darwin' });
  main.createApplicationMenu();

  assert.equal(applicationMenus.length, 1);
  const template = applicationMenus[0].template;
  assert.equal(template[0].label, '每日清单');
  assert.deepEqual(JSON.parse(JSON.stringify(template[0].submenu.map((item) => item.role).filter(Boolean))), [
    'about', 'services', 'hide', 'hideOthers', 'unhide', 'quit',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(template[1].submenu.map((item) => item.role))), [
    'cut', 'copy', 'paste', 'selectAll',
  ]);
});
