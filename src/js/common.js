// 主窗口与悬浮窗共享的工具函数（普通脚本，定义全局函数）
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

function priorityRank(p) {
  return { high: 0, medium: 1, low: 2 }[p] ?? 1;
}

// 排序规则：优先级 → 时间 → 创建时间
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

function escapeHTML(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const REPEAT_LABEL = { daily: '每天', weekly: '每周' };
