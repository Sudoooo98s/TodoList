// 悬浮窗渲染逻辑：只显示今天未完成的任务（共享工具见 common.js）
let tasks = [];

const $ = (id) => document.getElementById(id);
const CHECK_SVG = '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>';

function render() {
  const today = ymd(new Date());
  const list = sortTasks(tasks.filter((t) => t.date === today && !t.done));

  const countEl = $('count');
  countEl.textContent = list.length;
  countEl.classList.toggle('zero', list.length === 0);

  const ul = $('list');
  ul.innerHTML = '';
  for (const t of list) {
    const li = document.createElement('li');
    li.className = `float-item p-${t.priority}`;
    const meta = [];
    if (t.time) meta.push(`<span class="fi-time">${t.time}</span>`);
    if (t.category) meta.push(`<span>${escapeHTML(t.category)}</span>`);
    li.innerHTML = `
      <span class="fi-dot">${CHECK_SVG}</span>
      <div class="fi-body">
        <div class="fi-title">${escapeHTML(t.title)}</div>
        ${meta.length ? `<div class="fi-meta">${meta.join('')}</div>` : ''}
      </div>`;
    ul.appendChild(li);
  }

  $('empty').classList.toggle('hidden', list.length > 0);
  $('list').classList.toggle('hidden', list.length === 0);
}

$('closeFloat').addEventListener('click', () => window.api.closeFloat());

async function init() {
  const d = await window.api.getData();
  tasks = d.tasks || [];
  render();
  window.api.onDataChanged((payload) => {
    tasks = payload.tasks || [];
    render();
  });
}

init();
