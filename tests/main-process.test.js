const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMainProcess({ fsMock = fs } = {}) {
  const operations = [];
  const electronMock = {
    app: {
      setName() {},
      setPath() {},
      getPath: (name) => path.join('/tmp', 'dailylist-test', name),
      requestSingleInstanceLock: () => false,
      quit() {},
      setLoginItemSettings() {},
    },
    BrowserWindow: class {},
    Tray: class {},
    Menu: {},
    Notification: class {},
    ipcMain: { handle() {}, on() {} },
    screen: {},
    dialog: {},
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
    console,
    __dirname: path.join(__dirname, '..'),
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
    };
  `;
  vm.runInNewContext(source + exports, sandbox, { filename: 'main.js' });
  return { main: sandbox.module.exports, operations };
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
  });

  assert.equal(task.title, '需求评审');
  assert.equal(task.date, new Date().toISOString().slice(0, 10));
  assert.equal(task.time, '09:30');
  assert.equal(task.remindLead, null);
  assert.equal(task.priority, 'medium');
  assert.equal(task.repeat, null);
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
