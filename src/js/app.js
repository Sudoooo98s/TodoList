// 主窗口渲染逻辑（ymd/addDays/sortTasks/escapeHTML 等共享工具见 common.js）
let tasks = [];
let settings = { categories: [], floatEnabled: false, floatBounds: null, autoLaunch: false, autoCleanDays: 0 };
let dataFile = '';
let viewDate = ymd(new Date()); // 当前查看的日期
let editingId = null; // 正在编辑的任务 id
let doneOpen = false;
let searchQuery = ''; // 当前搜索关键词（小写）
let calendarMode = false;
let overdueOpen = true;
let draggingTaskId = null;
let suppressCalendarClick = false;
let filterMode = 'day';
let activeLabel = '';

const $ = (id) => document.getElementById(id);

// ---------- 工具 ----------
function fmtDateCN(dateStr) {
  const today = ymd(new Date());
  if (dateStr === null) return '无日期';
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

function addMonths(dateStr, n) {
  const [year, month] = dateStr.split('-').map(Number);
  return ymd(new Date(year, month - 1 + n, 1));
}

function monthGridDates() {
  const [year, month] = viewDate.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const offset = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;
  const startDate = new Date(year, month - 1, 1 - offset);
  const dates = [];
  for (let i = 0; i < 42; i++) {
    dates.push(ymd(new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i)));
  }
  return dates;
}

function monthLabel(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return `${year}年${month}月`;
}

function calendarTaskOrder(list) {
  return [...sortTasks(list.filter((t) => !t.done)), ...sortTasks(list.filter((t) => t.done))];
}

function parseLabels(value) {
  return [...new Set(
    value.split(/[,，]/).map((label) => label.trim().slice(0, 20)).filter(Boolean)
  )].slice(0, 10);
}

function allLabels() {
  return [...new Set(tasks.flatMap((task) => task.labels || []))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

function unscheduledTasks() {
  return tasks.filter((task) => task.date === null);
}

function matchesActiveLabel(task) {
  return !activeLabel || (task.labels || []).includes(activeLabel);
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';
const EDIT_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
const DEL_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
const BELL_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5a6 6 0 0 0-5-5.91V4a1 1 0 1 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>';
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7-.8 1.3z"/></svg>';
const REPEAT_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
const PRI_LABEL = { high: '高', medium: '中', low: '低' };

// ---------- 渲染 ----------
function render() {
  renderFilterBar();
  renderHeader();
  renderWeekChart();
  renderCategoryOptions();
  renderList();
  renderFloatBtnState();
}

function renderHeader() {
  const today = ymd(new Date());
  const titleEl = $('viewTitle');
  if (calendarMode) {
    titleEl.textContent = `${monthLabel(viewDate)} · 月历`;
  } else if (activeLabel) {
    titleEl.textContent = `标签：${activeLabel}`;
  } else if (filterMode === 'overdue') {
    titleEl.textContent = '逾期未完成任务';
  } else if (filterMode === 'unscheduled') {
    titleEl.textContent = '无日期收件箱';
  } else if (viewDate === today) {
    titleEl.textContent = '今天要做的事';
  } else {
    titleEl.textContent = `${fmtDateCN(viewDate)}要做的事`;
  }
  $('todayBtn').classList.toggle('active', viewDate === today);
  $('dayViewBtn').classList.toggle('active', !calendarMode);
  $('monthViewBtn').classList.toggle('active', calendarMode);
  $('prevDay').title = calendarMode ? '上一月' : '前一天';
  $('prevDay').setAttribute('aria-label', calendarMode ? '查看上一月' : '查看前一天');
  $('nextDay').title = calendarMode ? '下一月' : '后一天';
  $('nextDay').setAttribute('aria-label', calendarMode ? '查看下一月' : '查看后一天');

  const weekDone = tasks.filter(
    (t) => t.done && t.doneAt && t.doneAt >= weekStart().getTime()
  ).length;
  if (calendarMode) {
    const monthPrefix = viewDate.slice(0, 7);
    const monthTasks = tasks.filter((t) => t.date && t.date.startsWith(monthPrefix));
    const monthRemain = monthTasks.filter((t) => !t.done).length;
    $('heroSub').textContent = `本月共 ${monthTasks.length} 件 · 未完成 ${monthRemain} 件 · 本周已完成 ${weekDone} 件`;
  } else if (activeLabel) {
    const labelTasks = tasks.filter(matchesActiveLabel);
    $('heroSub').textContent = `#${activeLabel} 共 ${labelTasks.length} 件 · 本周已完成 ${weekDone} 件`;
  } else if (filterMode === 'overdue') {
    const overdue = getOverdueTasks();
    $('heroSub').textContent = `逾期未完成 ${overdue.length} 件 · 本周已完成 ${weekDone} 件`;
  } else if (filterMode === 'unscheduled') {
    const inbox = unscheduledTasks();
    $('heroSub').textContent = `无日期任务 ${inbox.length} 件 · 本周已完成 ${weekDone} 件`;
  } else {
    const dayTasks = tasks.filter((t) => t.date === viewDate);
    const remain = dayTasks.filter((t) => !t.done).length;
    const dateLabel = viewDate === today ? '今天' : fmtDateCN(viewDate);
    $('heroSub').textContent = `${dateLabel}还剩 ${remain} 件 · 本周已完成 ${weekDone} 件`;
  }
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
  for (const label of t.labels || []) {
    chips.push(`<span class="chip label-chip">#${escapeHTML(label)}</span>`);
  }
  if (t.time) chips.push(`<span class="chip time-chip">${CLOCK_SVG}${t.time}</span>`);
  if (t.time && t.remindLead != null) {
    const label = t.remindLead === 0 ? '到点提醒' : `提前 ${t.remindLead} 分钟提醒`;
    chips.push(`<span class="chip remind-chip">${BELL_SVG}${label}</span>`);
  }
  if (t.repeat) {
    chips.push(`<span class="chip repeat-chip">${REPEAT_SVG}${REPEAT_LABEL[t.repeat] || ''}</span>`);
  }
  if (opts.showOverdue) {
    chips.push('<span class="chip overdue-chip">逾期</span>');
  }
  const noteHTML = t.note
    ? `<div class="task-note">${escapeHTML(t.note)}</div>`
    : '';
  return `
    <button class="check" data-act="toggle" title="完成/取消完成" aria-label="完成或取消完成任务">${CHECK_SVG}</button>
    <div class="task-body">
      <div class="task-title">${escapeHTML(t.title)}</div>
      ${noteHTML}
      <div class="task-meta">${chips.join('')}</div>
    </div>
    <div class="task-actions">
      <button class="icon-btn edit" data-act="edit" title="编辑" aria-label="编辑任务">${EDIT_SVG}</button>
      <button class="icon-btn del" data-act="delete" title="删除" aria-label="删除任务">${DEL_SVG}</button>
    </div>`;
}

function renderList() {
  const ul = $('taskList');
  ul.innerHTML = '';
  const searchStatus = $('searchStatus');
  const specialFilter = !searchQuery && (filterMode === 'overdue' || filterMode === 'unscheduled' || !!activeLabel);
  const calendarVisible = calendarMode && !searchQuery;
  $('calendarSection').classList.toggle('hidden', !calendarVisible);
  ul.classList.toggle('hidden', calendarVisible || (!calendarMode && filterMode === 'unscheduled'));
  $('emptyState').classList.toggle('hidden', calendarVisible || (!calendarMode && filterMode === 'unscheduled'));
  $('doneSection').classList.add('hidden');

  if (calendarVisible) {
    renderCalendar(tasks.filter((task) => task.date && matchesActiveLabel(task)));
    renderInbox(tasks.filter((task) => task.date === null && matchesActiveLabel(task)));
    renderOverdueSection();
    searchStatus.textContent = '';
    searchStatus.classList.add('hidden');
    return;
  }

  // 搜索模式：跨日期匹配标题/备注/分类，未完成与已完成混排并显示日期
  if (searchQuery) {
    const matches = sortTasks(
      tasks.filter((t) =>
        `${t.title} ${t.note || ''} ${t.category || ''} ${(t.labels || []).join(' ')}`.toLowerCase().includes(searchQuery)
      )
    ).sort((a, b) => {
      const da = a.date || '9999-12-31';
      const db = b.date || '9999-12-31';
      return da < db ? -1 : da > db ? 1 : 0;
    });
    for (const t of matches) {
      const li = document.createElement('li');
      li.className = `task p-${t.priority}` + (t.done ? ' done-item' : '');
      li.dataset.id = t.id;
      li.innerHTML = taskItemHTML(t, { showDate: true });
      ul.appendChild(li);
    }
    $('emptyState').classList.toggle('hidden', matches.length > 0);
    $('emptyText').textContent = '没有找到匹配的任务';
    renderOverdueSection();
    searchStatus.textContent = `找到 ${matches.length} 项`;
    searchStatus.classList.remove('hidden');
    return;
  }

  searchStatus.textContent = '';
  searchStatus.classList.add('hidden');

  if (specialFilter) {
    let matches = [];
    let emptyText = '';
    if (filterMode === 'overdue') {
      matches = getOverdueTasks().filter(matchesActiveLabel);
      emptyText = '没有逾期未完成任务';
    } else if (filterMode === 'unscheduled') {
      matches = sortTasks(unscheduledTasks()).filter(matchesActiveLabel);
      emptyText = '无日期收件箱是空的';
      renderInbox(matches);
    } else if (activeLabel) {
      matches = sortTasks(tasks.filter(matchesActiveLabel)).sort((a, b) => {
        const da = a.date || '9999-12-31';
        const db = b.date || '9999-12-31';
        return da < db ? -1 : da > db ? 1 : 0;
      });
      emptyText = `没有 #${activeLabel} 标签的任务`;
    }
    for (const t of matches) {
      const li = document.createElement('li');
      li.className = `task p-${t.priority}` + (t.done ? ' done-item' : '');
      li.dataset.id = t.id;
      li.innerHTML = taskItemHTML(t, { showDate: filterMode !== 'unscheduled' });
      ul.appendChild(li);
    }
    $('emptyState').classList.toggle('hidden', matches.length > 0);
    $('emptyText').textContent = emptyText;
    return;
  }

  $('inboxSection').classList.add('hidden');
  $('inboxList').innerHTML = '';

  const dayTasks = tasks.filter((t) => t.date === viewDate);
  const unfinished = sortTasks(dayTasks.filter((t) => !t.done));
  const done = sortTasks(dayTasks.filter((t) => t.done));
  renderOverdueSection();

  for (const t of unfinished) {
    const li = document.createElement('li');
    li.className = `task p-${t.priority}`;
    li.dataset.id = t.id;
    li.innerHTML = taskItemHTML(t);
    ul.appendChild(li);
  }

  $('emptyState').classList.toggle('hidden', dayTasks.length > 0 || getOverdueTasks().length > 0);
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

function getOverdueTasks() {
  const today = ymd(new Date());
  return sortTasks(tasks.filter((t) => !t.done && t.date && t.date < today)).sort((a, b) => (
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  ));
}

function renderOverdueSection() {
  const overdue = !searchQuery && !activeLabel && (filterMode === 'day' || filterMode === 'today')
    ? getOverdueTasks()
    : [];
  const section = $('overdueSection');
  const list = $('overdueList');
  list.innerHTML = '';
  section.classList.toggle('hidden', overdue.length === 0);
  $('overdueCount').textContent = `逾期未完成 (${overdue.length})`;
  $('overdueToggle').classList.toggle('open', overdueOpen);
  list.classList.toggle('hidden', !overdueOpen);
  for (const task of overdue) {
    const li = document.createElement('li');
    li.className = `task overdue-item p-${task.priority}`;
    li.dataset.id = task.id;
    li.innerHTML = taskItemHTML(task, { showDate: true, showOverdue: true });
    list.appendChild(li);
  }
}

function renderFilterBar() {
  const labels = allLabels();
  if (activeLabel && !labels.includes(activeLabel)) activeLabel = '';
  const modes = { day: $('filterDay'), today: $('filterToday'), overdue: $('filterOverdue'), unscheduled: $('filterUnscheduled') };
  for (const [mode, button] of Object.entries(modes)) {
    button.classList.toggle('active', !activeLabel && filterMode === mode);
  }
  const host = $('labelFilters');
  host.innerHTML = '';
  for (const label of labels) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filter-btn label-filter';
    button.textContent = `#${label}`;
    button.setAttribute('aria-label', `筛选标签 ${label}`);
    button.classList.toggle('active', activeLabel === label);
    button.dataset.label = label;
    host.appendChild(button);
  }
}

function renderInbox(list) {
  const section = $('inboxSection');
  const inboxList = $('inboxList');
  inboxList.innerHTML = '';
  section.classList.toggle('hidden', list.length === 0);
  $('inboxCount').textContent = `无日期收件箱 (${list.length})`;
  for (const task of list) {
    const li = document.createElement('li');
    li.className = `task inbox-item p-${task.priority}` + (task.done ? ' done-item' : '');
    li.dataset.id = task.id;
    li.innerHTML = taskItemHTML(task);
    li.draggable = true;
    inboxList.appendChild(li);
  }
}

function renderCalendar(visibleTasks) {
  const grid = $('calendarGrid');
  grid.innerHTML = '';
  const [currentYear, currentMonth] = viewDate.split('-').map(Number);
  const today = ymd(new Date());
  const tasksByDate = new Map();
  for (const task of visibleTasks) {
    if (!tasksByDate.has(task.date)) tasksByDate.set(task.date, []);
    tasksByDate.get(task.date).push(task);
  }

  for (const date of monthGridDates()) {
    const [year, month, day] = date.split('-').map(Number);
    const cell = document.createElement('li');
    cell.className = 'cal-cell';
    cell.dataset.date = date;
    if (year !== currentYear || month !== currentMonth) cell.classList.add('other-month');
    if (date === today) cell.classList.add('today');
    if (date === viewDate) cell.classList.add('selected');

    const dayButton = document.createElement('button');
    dayButton.type = 'button';
    dayButton.className = 'cal-day';
    dayButton.textContent = day;
    dayButton.setAttribute('aria-label', `${month}月${day}日`);
    cell.appendChild(dayButton);

    const taskHost = document.createElement('div');
    taskHost.className = 'cal-tasks';
    const dayTasks = calendarTaskOrder(tasksByDate.get(date) || []);
    for (const task of dayTasks.slice(0, 3)) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `cal-task p-${task.priority}` + (task.done ? ' done' : '') + (date < today && !task.done ? ' overdue' : '');
      item.draggable = true;
      item.dataset.id = task.id;
      item.dataset.date = date;
      item.textContent = task.time ? `${task.time} ${task.title}` : task.title;
      item.title = `${month}月${day}日 · ${task.title}`;
      item.setAttribute('aria-label', `${date} ${task.time || ''} ${task.title}`);
      taskHost.appendChild(item);
    }
    if (dayTasks.length > 3) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'cal-more';
      more.textContent = `还有 ${dayTasks.length - 3} 件`;
      more.dataset.date = date;
      taskHost.appendChild(more);
    }
    cell.appendChild(taskHost);
    grid.appendChild(cell);
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
function syncScheduleFields() {
  const hasDate = !!$('fDate').value;
  const hasTime = hasDate && !!$('fTime').value;
  $('fTime').disabled = !hasDate;
  $('fRepeat').disabled = !hasDate;
  const sel = $('fRemind');
  sel.disabled = !hasTime;
  if (!hasTime) sel.value = '';
  if (!hasDate) {
    $('fTime').value = '';
    $('fRepeat').value = '';
  }
}

function formValues() {
  return {
    title: $('quickInput').value.trim(),
    date: $('fDate').value || null,
    time: $('fDate').value && $('fTime').value ? $('fTime').value : null,
    remindLead: $('fTime').value ? $('fRemind').value : '',
    repeat: $('fDate').value && $('fRepeat').value ? $('fRepeat').value : null,
    priority: $('fPriority').value,
    category: $('fCategory').value,
    labels: parseLabels($('fLabels').value),
    note: $('fNote').value.trim(),
  };
}

function resetForm() {
  $('quickInput').value = '';
  $('fDate').value = viewDate;
  $('fTime').value = '';
  syncScheduleFields();
  $('fRemind').value = '15';
  $('fRepeat').value = '';
  $('fPriority').value = 'medium';
  $('fCategory').value = '';
  $('fLabels').value = '';
  $('fNote').value = '';
  editingId = null;
  $('addBtn').textContent = '添加';
  $('cancelEdit').classList.add('hidden');
}

function startEdit(t) {
  editingId = t.id;
  $('quickInput').value = t.title;
  $('fDate').value = t.date || '';
  $('fTime').value = t.time || '';
  syncScheduleFields();
  $('fRemind').value = t.remindLead == null ? '' : String(t.remindLead);
  $('fRepeat').value = t.repeat || '';
  $('fPriority').value = t.priority;
  $('fCategory').value = t.category || '';
  $('fLabels').value = (t.labels || []).join('，');
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
$('fDate').addEventListener('input', syncScheduleFields);
$('fDate').addEventListener('change', syncScheduleFields);
$('fTime').addEventListener('input', syncScheduleFields);
$('fTime').addEventListener('change', syncScheduleFields);

$('clearDate').addEventListener('click', () => {
  $('fDate').value = '';
  syncScheduleFields();
});

$('toggleDetail').addEventListener('click', () => {
  const p = $('detailPanel');
  const hidden = p.classList.toggle('hidden');
  $('toggleDetail').classList.toggle('open', !hidden);
});

$('cancelEdit').addEventListener('click', resetForm);

// 任务列表事件（事件委托）
for (const listId of ['taskList', 'doneList', 'overdueList', 'inboxList']) {
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

$('filterBar').addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (!button) return;
  exitSearch();
  if (button.dataset.label) {
    activeLabel = activeLabel === button.dataset.label ? '' : button.dataset.label;
    filterMode = activeLabel ? 'label' : 'day';
  } else {
    activeLabel = '';
    filterMode = button.dataset.filter;
  }
  if (filterMode === 'today') viewDate = ymd(new Date());
  if (filterMode === 'unscheduled') calendarMode = true;
  else if (filterMode !== 'label') calendarMode = false;
  render();
});

// 逾期折叠
$('overdueToggle').addEventListener('click', () => {
  overdueOpen = !overdueOpen;
  renderOverdueSection();
});

// 月历视图切换
$('dayViewBtn').addEventListener('click', () => {
  activeLabel = '';
  filterMode = 'day';
  calendarMode = false;
  render();
});

$('monthViewBtn').addEventListener('click', () => {
  exitSearch();
  activeLabel = '';
  filterMode = 'day';
  calendarMode = true;
  render();
});

$('calendarGrid').addEventListener('click', (e) => {
  if (suppressCalendarClick) return;
  const item = e.target.closest('.cal-task, .cal-more');
  const day = e.target.closest('.cal-day');
  const cell = (item || day)?.closest('.cal-cell');
  if (!cell?.dataset.date) return;
  viewDate = cell.dataset.date;
  calendarMode = false;
  exitSearch();
  render();
});

$('calendarGrid').addEventListener('dragstart', (e) => {
  const item = e.target.closest('.cal-task');
  if (!item?.dataset.id) return;
  draggingTaskId = item.dataset.id;
  item.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  }
});

$('calendarGrid').addEventListener('dragover', (e) => {
  if (!draggingTaskId) return;
  const cell = e.target.closest('.cal-cell');
  if (!cell?.dataset.date) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  cell.classList.add('drop-target');
});

$('calendarGrid').addEventListener('dragleave', (e) => {
  const cell = e.target.closest('.cal-cell');
  if (cell) cell.classList.remove('drop-target');
});

$('calendarGrid').addEventListener('drop', async (e) => {
  if (!draggingTaskId) return;
  const cell = e.target.closest('.cal-cell');
  if (!cell?.dataset.date) return;
  e.preventDefault();
  cell.classList.remove('drop-target');
  const task = tasks.find((item) => item.id === draggingTaskId);
  const date = cell.dataset.date;
  const draggedId = draggingTaskId;
  draggingTaskId = null;
  suppressCalendarClick = true;
  setTimeout(() => { suppressCalendarClick = false; }, 0);
  if (task && task.date !== date) {
    const result = await window.api.updateTask(draggedId, { date });
    if (!result.ok) showToast(result.error);
    else showToast(`已移动到 ${fmtDateCN(date) || '今天'}`);
  }
});

$('calendarGrid').addEventListener('dragend', (e) => {
  const item = e.target.closest('.cal-task');
  if (item) item.classList.remove('dragging');
  draggingTaskId = null;
  document.querySelectorAll('.cal-cell.drop-target').forEach((cell) => cell.classList.remove('drop-target'));
});

$('inboxList').addEventListener('dragstart', (e) => {
  const item = e.target.closest('li.task');
  if (!item?.dataset.id) return;
  draggingTaskId = item.dataset.id;
  item.classList.add('dragging');
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  }
});

$('inboxList').addEventListener('dragend', (e) => {
  const item = e.target.closest('li.task');
  if (item) item.classList.remove('dragging');
  draggingTaskId = null;
});

// 日期导航
$('prevDay').addEventListener('click', () => {
  exitSearch();
  viewDate = calendarMode ? addMonths(viewDate, -1) : addDays(viewDate, -1);
  render();
});
$('nextDay').addEventListener('click', () => {
  exitSearch();
  viewDate = calendarMode ? addMonths(viewDate, 1) : addDays(viewDate, 1);
  render();
});
$('todayBtn').addEventListener('click', () => {
  exitSearch();
  activeLabel = '';
  filterMode = 'today';
  calendarMode = false;
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
    item.innerHTML = `${escapeHTML(c)}<button title="删除分类" aria-label="删除分类 ${escapeHTML(c)}">&times;</button>`;
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
