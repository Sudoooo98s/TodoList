const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');

const projectRoot = path.join(__dirname, '..');
const electronBin = path.join(projectRoot, 'node_modules', '.bin', 'electron');

function ymd(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return ymd(new Date(year, month - 1, day + days));
}

async function getFreePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    };
    socket.onerror = () => {
      const error = new Error('DevTools WebSocket connection failed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    };
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await once(socket, 'open');
    return new CdpConnection(socket);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const message = { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(message));
    });
  }

  close() {
    this.socket.close();
  }
}

async function getDebugTarget(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`DevTools HTTP ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === 'page' && item.url.endsWith('/src/index.html'));
  if (!target) throw new Error('Main window debug target not found');
  return target;
}

async function waitForDebugTarget(app, port, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error(`Electron exited early with code ${app.exitCode}`);
    try {
      return await getDebugTarget(port);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error('DevTools target timeout');
}

async function evaluate(connection, expression) {
  const result = await connection.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function waitForPageExpression(connection, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(connection, expression);
    if (lastValue === true) return;
    await delay(100);
  }
  throw new Error(`Page condition timeout: ${expression}; last value: ${JSON.stringify(lastValue)}`);
}

async function run() {
  assert.equal(fs.existsSync(electronBin), true, 'Electron binary is not installed');
  const port = await getFreePort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dailylist-gui-'));
  const app = spawn(electronBin, [projectRoot, `--remote-debugging-port=${port}`], {
    cwd: projectRoot,
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  app.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const createdTaskIds = [];
  let connection;
  try {
    const target = await waitForDebugTarget(app, port);
    connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    await waitForPageExpression(
      connection,
      'document.readyState === "complete" && !!window.api && !!document.getElementById("taskList")'
    );

    const today = ymd(new Date());
    const tomorrow = addDays(today, 1);
    const added = await evaluate(
      connection,
      `window.api.addTask(${JSON.stringify({
        title: 'GUI 自验证任务',
        note: '冒烟测试',
        date: today,
        priority: 'high',
        category: '工作',
      })})`
    );
    assert.equal(added.ok, true, JSON.stringify(added));
    createdTaskIds.push(added.task.id);

    await waitForPageExpression(
      connection,
      '[...document.querySelectorAll("#taskList .task-title")].some((el) => el.textContent.trim() === "GUI 自验证任务")'
    );

    await evaluate(
      connection,
      `(() => {
        const input = document.getElementById("searchInput");
        input.value = "GUI 自验证任务";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return input.value;
      })()`
    );
    const searchResults = await evaluate(
      connection,
      '[...document.querySelectorAll("#taskList .task-title")].map((el) => el.textContent.trim())'
    );
    assert.equal(searchResults.includes('GUI 自验证任务'), true);
    assert.equal(await evaluate(connection, 'document.getElementById("searchStatus").textContent'), '找到 1 项');

    await evaluate(connection, 'document.getElementById("searchInput").focus()');
    assert.equal(
      await evaluate(connection, 'getComputedStyle(document.getElementById("searchInput")).outlineStyle'),
      'solid'
    );

    await evaluate(connection, 'document.getElementById("prevDay").click()');
    assert.equal(await evaluate(connection, 'document.getElementById("searchInput").value'), '');
    assert.equal(
      await evaluate(
        connection,
        '[...document.querySelectorAll("#taskList .task-title")].some((el) => el.textContent.trim() === "GUI 自验证任务")'
      ),
      false
    );

    await evaluate(connection, 'document.getElementById("btnSettings").click()');
    assert.equal(
      await evaluate(connection, '!document.getElementById("settingsModal").classList.contains("hidden")'),
      true
    );
    await evaluate(connection, 'document.getElementById("closeSettings").click()');

    const invalidReminderUpdate = await evaluate(
      connection,
      `window.api.updateTask(${JSON.stringify(added.task.id)}, { remindLead: "invalid" })`
    );
    assert.equal(invalidReminderUpdate.ok, true);
    assert.equal(invalidReminderUpdate.task.remindLead, null);

    await evaluate(connection, `window.api.deleteTask(${JSON.stringify(added.task.id)})`);
    const restored = await evaluate(
      connection,
      `window.api.restoreTask(${JSON.stringify({ ...added.task, remindLead: null })})`
    );
    assert.equal(restored.ok, true, JSON.stringify(restored));

    const repeatTask = await evaluate(
      connection,
      `window.api.addTask(${JSON.stringify({
        title: 'GUI 重复自验证',
        date: today,
        time: '23:59',
        remindLead: 5,
        repeat: 'daily',
        category: '工作',
      })})`
    );
    assert.equal(repeatTask.ok, true, JSON.stringify(repeatTask));
    createdTaskIds.push(repeatTask.task.id);

    const toggled = await evaluate(
      connection,
      `window.api.toggleTask(${JSON.stringify(repeatTask.task.id)})`
    );
    assert.equal(toggled.ok, true);

    const data = await evaluate(connection, 'window.api.getData()');
    const nextRepeatTask = data.tasks.find(
      (task) =>
        task.title === 'GUI 重复自验证' &&
        task.date === tomorrow &&
        task.time === '23:59' &&
        task.category === '工作' &&
        !task.done
    );
    assert.ok(nextRepeatTask, 'Next daily task was not generated with matching time and category');
    createdTaskIds.push(nextRepeatTask.id);

    for (const taskId of createdTaskIds) {
      const deleted = await evaluate(connection, `window.api.deleteTask(${JSON.stringify(taskId)})`);
      assert.equal(deleted.ok, true);
    }
    const finalData = await evaluate(connection, 'window.api.getData()');
    assert.equal(
      finalData.tasks.some((task) => task.title.startsWith('GUI ')),
      false
    );
  } finally {
    if (connection) connection.close();
    if (app.exitCode === null) {
      app.kill('SIGTERM');
      await Promise.race([once(app, 'exit'), delay(3000)]);
      if (app.exitCode === null) app.kill('SIGKILL');
    }
    fs.rmSync(home, { recursive: true, force: true });

    if (stderr.trim()) {
      console.error(`Electron stderr:\n${stderr.trim()}`);
    }
  }
  console.log('GUI smoke test passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
