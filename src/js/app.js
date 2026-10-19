// 主窗口渲染逻辑（ymd/addDays/sortTasks/escapeHTML 等共享工具见 common.js）
let tasks = [];
let settings = { categories: [], floatEnabled: false, floatBounds: null, autoLaunch: false, autoCleanDays: 0 };
let dataFile = '';
let viewDate = ymd(new Date()); // 当前查看的日期
let editingId = null; // 正在编辑的任务 id
let doneOpen = false;
let searchQuery = ''; // 当前搜索关键词（小写）

const $ = (id) => document.getElementById(id);

// ---------- 工具 ----------
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

const CHECK_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const BELL_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 1 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/></svg>';
const REPEAT_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const PRI_LABEL = { high: '高', medium: '中', low: '低' };

// ---------- 渲染 ----------
function render() {
  renderHeader();
  renderWeekChart();
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

function taskItemHTML(t, opts = {}) {
  const chips = [];
  if (opts.showDate) {
    chips.push(`<span class="chip date-chip">${fmtDateCN(t.date) || '今天'}</span>`);
  }
  chips.push(`<span class="chip pri-${t.priority}">${PRI_LABEL[t.priority] || '中'}优先级</span>`);
  if (t.category) chips.push(`<span class="chip">${escapeHTML(t.category)}</span>`);
  if (t.time) chips.push(`<span class="chip time-chip">${CLOCK_SVG}${t.time}</span>`);
  if (t.time && t.remindLead != null) {
    const label = t.remindLead === 0 ? '到点提醒' : `提前 ${t.remindLead} 分钟提醒`;
    chips.push(`<span class="chip remind-chip">${BELL_SVG}${label}</span>`);
  }
  if (t.repeat) {
    chips.push(`<span class="chip repeat-chip">${REPEAT_SVG}${REPEAT_LABEL[t.repeat] || ''}</span>`);
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
  const ul = $('taskList');
  ul.innerHTML = '';

  // 搜索模式：跨日期匹配标题/备注/分类，未完成与已完成混排并显示日期
  if (searchQuery) {
    const matches = sortTasks(
      tasks.filter((t) =>
        `${t.title} ${t.note || ''} ${t.category || ''}`.toLowerCase().includes(searchQuery)
      )
    ).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of matches) {
      const li = document.createElement('li');
      li.className = `task p-${t.priority}` + (t.done ? ' done-item' : '');
      li.dataset.id = t.id;
      li.innerHTML = taskItemHTML(t, { showDate: true });
      ul.appendChild(li);
    }
    $('emptyState').classList.toggle('hidden', matches.length > 0);
    $('emptyText').textContent = '没有找到匹配的任务';
    $('doneSection').classList.add('hidden');
    return;
  }

  const dayTasks = tasks.filter((t) => t.date === viewDate);
  const unfinished = sortTasks(dayTasks.filter((t) => !t.done));
  const done = sortTasks(dayTasks.filter((t) => t.done));

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

// 近 7 天完成趋势（纯 CSS 条形图）
function renderWeekChart() {
  const host = $('weekChart');
  host.innerHTML = '';
  const today = ymd(new Date());
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    const n = tasks.filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) === d).length;
    days.push({ d, n, isToday: d === today });
  }
  const max = Math.max(1, ...days.map((c) => c.n));
  for (const c of days) {
    const col = document.createElement('div');
    col.className = 'wc-col' + (c.isToday ? ' today' : '');
    const [y, m, dd] = c.d.split('-').map(Number);
    col.title = `${m}月${dd}日 · 完成 ${c.n} 件`;
    const wd = '日一二三四五六'[new Date(y, m - 1, dd).getDay()];
    const barH = c.n === 0 ? 0 : Math.max(8, Math.round((c.n / max) * 40));
    col.innerHTML = `
      <div class="wc-bar-wrap"><div class="wc-bar" style="height:${barH}px"></div></div>
      <span class="wc-day">${wd}</span>`;
    if (c.n > 0) {
      const num = document.createElement('span');
      num.className = 'wc-num';
      num.textContent = c.n;
      col.querySelector('.wc-bar').appendChild(num);
    }
    host.appendChild(col);
  }
}

// ---------- 表单 ----------
function syncRemindField() {
  // 未设定时间时提醒不可用（提醒依赖具体时间点）
  const hasTime = !!$('fTime').value;
  const sel = $('fRemind');
  sel.disabled = !hasTime;
  if (!hasTime) sel.value = '';
}

function formValues() {
  return {
    title: $('quickInput').value.trim(),
    date: $('fDate').value || viewDate,
    time: $('fTime').value || null,
    remindLead: $('fTime').value ? $('fRemind').value : '',
    repeat: $('fRepeat').value || null,
    priority: $('fPriority').value,
    category: $('fCategory').value,
    note: $('fNote').value.trim(),
  };
}

function resetForm() {
  $('quickInput').value = '';
  $('fDate').value = viewDate;
  $('fTime').value = '';
  syncRemindField();
  $('fRemind').value = '15';
  $('fRepeat').value = '';
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
  syncRemindField();
  $('fRemind').value = t.remindLead == null ? '' : String(t.remindLead);
  $('fRepeat').value = t.repeat || '';
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

// ---------- 底部提示条 ----------
let toastTimer = null;
function showToast(text, actionLabel, onAction) {
  const toast = $('toast');
  $('toastText').textContent = text;
  const btn = $('toastAction');
  btn.textContent = actionLabel || '';
  btn.classList.toggle('hidden', !actionLabel);
  btn.onclick = actionLabel
    ? () => {
        hideToast();
        onAction();
      }
    : null;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 6000);
}

function hideToast() {
  $('toast').classList.add('hidden');
}

// ---------- 事件绑定 ----------
$('addBtn').addEventListener('click', submitForm);
$('quickInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitForm();
});

// 时间变化时联动提醒下拉框
$('fTime').addEventListener('input', syncRemindField);
$('fTime').addEventListener('change', syncRemindField);

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
      const t = tasks.find((x) => x.id === id);
      await window.api.deleteTask(id);
      if (editingId === id) resetForm();
      if (t) showToast('已删除任务', '撤销', async () => {
        const res = await window.api.restoreTask(t);
        if (!res.ok && res.error) showToast(res.error);
      });
    } else if (act === 'edit') {
      const t = tasks.find((x) => x.id === id);
      if (t) startEdit(t);
    }
  });
}

// 日期导航
$('prevDay').addEventListener('click', () => {
  exitSearch();
  viewDate = addDays(viewDate, -1);
  render();
});
$('nextDay').addEventListener('click', () => {
  exitSearch();
  viewDate = addDays(viewDate, 1);
  render();
});
$('todayBtn').addEventListener('click', () => {
  exitSearch();
  viewDate = ymd(new Date());
  render();
});

function exitSearch() {
  $('searchInput').value = '';
  searchQuery = '';
}

// 已完成折叠
$('doneToggle').addEventListener('click', () => {
  doneOpen = !doneOpen;
  renderList();
});

// 悬浮窗开关
$('btnFloat').addEventListener('click', () => {
  window.api.setSettings({ floatEnabled: !settings.floatEnabled });
});

// 搜索（跨日期匹配，Ctrl+F 聚焦，Esc 清空）
$('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase();
  renderList();
});
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    exitSearch();
    renderList();
    e.target.blur();
  }
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
  $('autoLaunchToggle').checked = !!settings.autoLaunch;
  const cleanVal = String(Number(settings.autoCleanDays) || 0);
  $('autoCleanSelect').value = [...$('autoCleanSelect').options].some((o) => o.value === cleanVal)
    ? cleanVal
    : '0';
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

$('autoLaunchToggle').addEventListener('change', (e) => {
  window.api.setSettings({ autoLaunch: e.target.checked });
});

$('autoCleanSelect').addEventListener('change', (e) => {
  window.api.setSettings({ autoCleanDays: Number(e.target.value) || 0 });
});

// 数据导出 / 导入
$('btnExport').addEventListener('click', async () => {
  const res = await window.api.exportData();
  if (res.ok) showToast('已导出到 ' + res.path);
  else if (!res.canceled && res.error) showToast(res.error);
});

$('btnImport').addEventListener('click', async () => {
  if (!confirm('导入备份文件将覆盖当前全部任务与设置，是否继续？')) return;
  const res = await window.api.importData();
  if (res.ok) showToast(`导入成功，共 ${res.count} 项任务`);
  else if (!res.canceled && res.error) showToast(res.error);
  $('settingsModal').classList.add('hidden');
});

$('testNotify').addEventListener('click', () => window.api.testNotify());

// ---------- 快捷键 ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    $('quickInput').focus();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    $('searchInput').focus();
  } else if (e.key === 'Escape') {
    if (!$('settingsModal').classList.contains('hidden')) {
      $('settingsModal').classList.add('hidden');
    } else if (editingId) {
      resetForm(); // Esc 退出编辑模式
    }
  }
});

// ---------- 数据加载与刷新 ----------
function applyData(d) {
  tasks = d.tasks || [];
  settings = d.settings || settings;
  dataFile = d.dataFile || dataFile;
  render();
  if (d.saveError) showToast(d.saveError);
}

async function init() {
  const d = await window.api.getData();
  applyData(d);
  resetForm();
  $('fDate').value = viewDate;
  window.api.onDataChanged((payload) => applyData(payload));
}

init();
