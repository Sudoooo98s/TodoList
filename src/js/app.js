// 主窗口渲染逻辑
let tasks = [];
let settings = { categories: [], floatEnabled: false, floatBounds: null };
let dataFile = '';
let viewDate = ymd(new Date()); // 当前查看的日期
let editingId = null; // 正在编辑的任务 id
let doneOpen = false;

const $ = (id) => document.getElementById(id);

// ---------- 工具 ----------
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return ymd(dt);
}

function fmtDateCN(dateStr) {
  const today = ymd(new Date());
  if (dateStr === today) return null; // 今天由调用方特殊处理
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}

function weekStart() {
  const now = new Date();
  const day = now.getDay() === 0 ? 7 : now.getDay(); // 周一为一周开始
  const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day - 1));
  return dt;
}

function priorityRank(p) {
  return { high: 0, medium: 1, low: 2 }[p] ?? 1;
}

function sortTasks(list) {
  return [...list].sort((a, b) => {
    const pa = priorityRank(a.priority) - priorityRank(b.priority);
    if (pa !== 0) return pa;
    const ta = a.time || '99:99';
    const tb = b.time || '99:99';
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.createdAt - b.createdAt;
  });
}

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const BELL_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 1 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/></svg>';
const PRI_LABEL = { high: '高', medium: '中', low: '低' };

// ---------- 渲染 ----------
function render() {
  renderHeader();
  renderCategoryOptions();
  renderList();
  renderFloatBtnState();
}

function renderHeader() {
  const today = ymd(new Date());
  const titleEl = $('viewTitle');
  if (viewDate === today) {
    titleEl.textContent = '今天要做的事';
  } else {
    titleEl.textContent = `${fmtDateCN(viewDate)}要做的事`;
  }
  $('todayBtn').classList.toggle('active', viewDate === today);

  const dayTasks = tasks.filter((t) => t.date === viewDate);
  const remain = dayTasks.filter((t) => !t.done).length;
  const weekDone = tasks.filter(
    (t) => t.done && t.doneAt && t.doneAt >= weekStart().getTime()
  ).length;
  const dateLabel = viewDate === today ? '今天' : fmtDateCN(viewDate);
  $('heroSub').textContent = `${dateLabel}还剩 ${remain} 件 · 本周已完成 ${weekDone} 件`;
}

function renderCategoryOptions() {
  const sel = $('fCategory');
  const current = sel.value;
  sel.innerHTML = '<option value="">无分类</option>';
  for (const c of settings.categories || []) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
}

function taskItemHTML(t) {
  const chips = [];
  chips.push(`<span class="chip pri-${t.priority}">${PRI_LABEL[t.priority] || '中'}优先级</span>`);
  if (t.category) chips.push(`<span class="chip">${escapeHTML(t.category)}</span>`);
  if (t.time) chips.push(`<span class="chip time-chip">${CLOCK_SVG}${t.time}</span>`);
  if (t.time && t.remindLead != null) {
    const label = t.remindLead === 0 ? '到点提醒' : `提前 ${t.remindLead} 分钟提醒`;
    chips.push(`<span class="chip remind-chip">${BELL_SVG}${label}</span>`);
  }
  const noteHTML = t.note
    ? `<div class="task-note">${escapeHTML(t.note)}</div>`
    : '';
  return `
    <button class="check" data-act="toggle" title="完成/取消完成">${CHECK_SVG}</button>
    <div class="task-body">
      <div class="task-title">${escapeHTML(t.title)}</div>
      ${noteHTML}
      <div class="task-meta">${chips.join('')}</div>
    </div>
    <div class="task-actions">
      <button class="icon-btn edit" data-act="edit" title="编辑">${EDIT_SVG}</button>
      <button class="icon-btn del" data-act="delete" title="删除">${DEL_SVG}</button>
    </div>`;
}

function renderList() {
  const dayTasks = tasks.filter((t) => t.date === viewDate);
  const unfinished = sortTasks(dayTasks.filter((t) => !t.done));
  const done = sortTasks(dayTasks.filter((t) => t.done));

  const ul = $('taskList');
  ul.innerHTML = '';
  for (const t of unfinished) {
    const li = document.createElement('li');
    li.className = `task p-${t.priority}`;
    li.dataset.id = t.id;
    li.innerHTML = taskItemHTML(t);
    ul.appendChild(li);
  }

  $('emptyState').classList.toggle('hidden', dayTasks.length > 0);
  $('emptyText').textContent =
    viewDate === ymd(new Date()) ? '今天没有待办事项，添加一件吧' : '这一天没有待办事项';

  // 已完成区
  const doneSec = $('doneSection');
  if (done.length > 0) {
    doneSec.classList.remove('hidden');
    $('doneCount').textContent = `已完成 (${done.length})`;
    $('doneList').classList.toggle('hidden', !doneOpen);
    $('doneToggle').classList.toggle('open', doneOpen);
    const dul = $('doneList');
    dul.innerHTML = '';
    for (const t of done) {
      const li = document.createElement('li');
      li.className = `task done-item p-${t.priority}`;
      li.dataset.id = t.id;
      li.innerHTML = taskItemHTML(t);
      dul.appendChild(li);
    }
  } else {
    doneSec.classList.add('hidden');
  }
}

function renderFloatBtnState() {
  $('btnFloat').classList.toggle('open', !!settings.floatEnabled);
  $('btnFloat').style.color = settings.floatEnabled ? 'var(--accent)' : '';
}

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- 表单 ----------
function formValues() {
  return {
    title: $('quickInput').value.trim(),
    date: $('fDate').value || viewDate,
    time: $('fTime').value || null,
    remindLead: $('fTime').value ? $('fRemind').value : '',
    priority: $('fPriority').value,
    category: $('fCategory').value,
    note: $('fNote').value.trim(),
  };
}

function resetForm() {
  $('quickInput').value = '';
  $('fDate').value = viewDate;
  $('fTime').value = '';
  $('fRemind').value = '15';
  $('fPriority').value = 'medium';
  $('fCategory').value = '';
  $('fNote').value = '';
  editingId = null;
  $('addBtn').textContent = '添加';
  $('cancelEdit').classList.add('hidden');
}

function startEdit(t) {
  editingId = t.id;
  $('quickInput').value = t.title;
  $('fDate').value = t.date;
  $('fTime').value = t.time || '';
  $('fRemind').value = t.remindLead == null ? '' : String(t.remindLead);
  $('fPriority').value = t.priority;
  $('fCategory').value = t.category || '';
  $('fNote').value = t.note || '';
  $('detailPanel').classList.remove('hidden');
  $('toggleDetail').classList.add('open');
  $('addBtn').textContent = '保存修改';
  $('cancelEdit').classList.remove('hidden');
  $('quickInput').focus();
}

async function submitForm() {
  const v = formValues();
  if (!v.title) {
    $('quickInput').focus();
    return;
  }
  if (editingId) {
    await window.api.updateTask(editingId, v);
  } else {
    await window.api.addTask(v);
  }
  resetForm();
}

// ---------- 事件绑定 ----------
$('addBtn').addEventListener('click', submitForm);
$('quickInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitForm();
});

$('toggleDetail').addEventListener('click', () => {
  const p = $('detailPanel');
  const hidden = p.classList.toggle('hidden');
  $('toggleDetail').classList.toggle('open', !hidden);
});

$('cancelEdit').addEventListener('click', resetForm);

// 任务列表事件（事件委托）
for (const listId of ['taskList', 'doneList']) {
  $(listId).addEventListener('click', async (e) => {
    const li = e.target.closest('li.task');
    if (!li) return;
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = li.dataset.id;
    const act = btn.dataset.act;
    if (act === 'toggle') {
      await window.api.toggleTask(id);
    } else if (act === 'delete') {
      await window.api.deleteTask(id);
      if (editingId === id) resetForm();
    } else if (act === 'edit') {
      const t = tasks.find((x) => x.id === id);
      if (t) startEdit(t);
    }
  });
}

// 日期导航
$('prevDay').addEventListener('click', () => {
  viewDate = addDays(viewDate, -1);
  render();
});
$('nextDay').addEventListener('click', () => {
  viewDate = addDays(viewDate, 1);
  render();
});
$('todayBtn').addEventListener('click', () => {
  viewDate = ymd(new Date());
  render();
});

// 已完成折叠
$('doneToggle').addEventListener('click', () => {
  doneOpen = !doneOpen;
  renderList();
});

// 悬浮窗开关
$('btnFloat').addEventListener('click', () => {
  window.api.setSettings({ floatEnabled: !settings.floatEnabled });
});

// ---------- 设置弹窗 ----------
function openSettings() {
  renderSettings();
  $('settingsModal').classList.remove('hidden');
}

function renderSettings() {
  const list = $('catList');
  list.innerHTML = '';
  for (const c of settings.categories || []) {
    const item = document.createElement('span');
    item.className = 'cat-item';
    item.innerHTML = `${escapeHTML(c)}<button title="删除分类">&times;</button>`;
    item.querySelector('button').addEventListener('click', async () => {
      const cats = settings.categories.filter((x) => x !== c);
      const res = await window.api.setSettings({ categories: cats });
      settings = res.settings;
      renderSettings();
    });
    list.appendChild(item);
  }
  $('floatToggle').checked = !!settings.floatEnabled;
  $('dataPath').textContent = dataFile || '-';
}

$('btnSettings').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
$('settingsModal').addEventListener('click', (e) => {
  if (e.target === $('settingsModal')) $('settingsModal').classList.add('hidden');
});

$('catAddBtn').addEventListener('click', async () => {
  const name = $('catInput').value.trim();
  if (!name) return;
  if ((settings.categories || []).includes(name)) {
    $('catInput').value = '';
    return;
  }
  const res = await window.api.setSettings({
    categories: [...(settings.categories || []), name],
  });
  settings = res.settings;
  $('catInput').value = '';
  renderSettings();
});

$('catInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('catAddBtn').click();
});

$('floatToggle').addEventListener('change', (e) => {
  window.api.setSettings({ floatEnabled: e.target.checked });
});

$('testNotify').addEventListener('click', () => window.api.testNotify());

// ---------- 数据加载与刷新 ----------
function applyData(d) {
  tasks = d.tasks || [];
  settings = d.settings || settings;
  dataFile = d.dataFile || dataFile;
  render();
}

async function init() {
  const d = await window.api.getData();
  applyData(d);
  resetForm();
  $('fDate').value = viewDate;
  window.api.onDataChanged((payload) => applyData(payload));
}

init();
