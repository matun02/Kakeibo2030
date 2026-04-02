const STORAGE_KEYS = {
  fixedCosts: 'kakeibo_fixed_costs',
  expenses: 'kakeibo_expenses',
};

const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  expense: document.getElementById('screen-expense'),
  fixed: document.getElementById('screen-fixed'),
  analysis: document.getElementById('screen-analysis'),
};

const expenseForm = document.getElementById('expense-form');
const fixedForm = document.getElementById('fixed-form');
const fixedModal = document.getElementById('fixed-modal');

const formatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
let selectedMonth = startOfMonth(new Date());

function loadData(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function formatAmount(value) {
  return formatter.format(Number(value) || 0);
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function isSelectedMonth(dateText) {
  const date = new Date(dateText);
  return date.getFullYear() === selectedMonth.getFullYear() && date.getMonth() === selectedMonth.getMonth();
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(date) {
  return `${date.getFullYear()}年${String(date.getMonth() + 1).padStart(2, '0')}月`;
}

function moveMonth(offset) {
  selectedMonth = startOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + offset, 1));
  renderAll();
}

function renderMonthLabels() {
  const label = monthLabel(selectedMonth);
  document.getElementById('selected-month-label').textContent = label;
  document.getElementById('analysis-month-label').textContent = label;
}

function showScreen(screenName) {
  Object.entries(screens).forEach(([name, element]) => {
    element.classList.toggle('hidden', name !== screenName);
  });
  setActiveTab(screenName === 'analysis' ? 'analysis' : 'home');
  if (screenName === 'fixed') renderFixedCosts();
  if (screenName === 'analysis') renderAnalysis();
  if (screenName === 'dashboard') renderDashboard();
  if (screenName === 'expense') setExpenseDefaultDate();
}

function setExpenseDefaultDate() {
  if (!expenseForm.date.value) {
    expenseForm.date.value = todayString();
  }
}

function renderDashboard() {
  renderMonthLabels();
  const fixedCosts = loadData(STORAGE_KEYS.fixedCosts);
  const expenses = loadData(STORAGE_KEYS.expenses);
  const monthlyExpenses = expenses.filter((entry) => isSelectedMonth(entry.date));

  const fixedTotal = fixedCosts.reduce((sum, item) => sum + Number(item.amount), 0);
  const expenseTotal = monthlyExpenses.reduce((sum, item) => sum + Number(item.amount), 0);

  document.getElementById('monthly-total').textContent = formatAmount(fixedTotal + expenseTotal);
  document.getElementById('monthly-breakdown').textContent = `固定費 ${formatAmount(fixedTotal)} + 選択月支出 ${formatAmount(expenseTotal)}`;

  const expenseList = document.getElementById('expense-list');
  const expenseEmpty = document.getElementById('expense-empty');
  const expenseCount = document.getElementById('expense-count');

  expenseList.innerHTML = '';
  const sorted = [...monthlyExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

  sorted.slice(0, 12).forEach((expense) => {
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
      <div class="item-main">
        <strong>${escapeHtml(expense.itemName)}</strong>
        <span class="item-sub">${expense.date} / ${expense.category} / ${expense.paymentMethod}</span>
      </div>
      <div class="item-actions">
        <span class="item-amount">${formatAmount(expense.amount)}</span>
        <button class="btn btn-danger expense-delete" data-expense-id="${expense.id}">削除</button>
      </div>
    `;
    expenseList.appendChild(li);
  });

  expenseList.querySelectorAll('.expense-delete').forEach((button) => {
    button.addEventListener('click', () => {
      const expenseId = button.dataset.expenseId;
      const updated = loadData(STORAGE_KEYS.expenses).filter((expense) => expense.id !== expenseId);
      saveData(STORAGE_KEYS.expenses, updated);
      renderAll();
    });
  });

  expenseCount.textContent = `${monthlyExpenses.length}件`;
  expenseEmpty.classList.toggle('hidden', monthlyExpenses.length > 0);
}

function getPastDailyAverages(allExpenses) {
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = startOfMonth(selectedMonth);
  const totals = Array.from({ length: daysInMonth }, () => 0);
  const counts = Array.from({ length: daysInMonth }, () => 0);

  allExpenses.forEach((entry) => {
    const entryDate = new Date(entry.date);
    if (Number.isNaN(entryDate.getTime()) || entryDate >= monthStart) return;
    const day = entryDate.getDate();
    if (day > daysInMonth) return;
    totals[day - 1] += Number(entry.amount);
    counts[day - 1] += 1;
  });

  return totals.map((total, index) => (counts[index] > 0 ? total / counts[index] : 0));
}

function drawLineChart(canvas, expenses, pastAverages) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (expenses.length === 0 && pastAverages.every((value) => value === 0)) return;

  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalsByDay = Array.from({ length: daysInMonth }, () => 0);
  expenses.forEach((entry) => {
    const day = new Date(entry.date).getDate();
    totalsByDay[day - 1] += Number(entry.amount);
  });

  const yMax = 100000;
  const left = 44;
  const right = width - 14;
  const top = 16;
  const bottom = height - 34;
  const xStep = (right - left) / (daysInMonth - 1 || 1);

  const yForValue = (value) => bottom - ((bottom - top) * Math.min(Math.max(value, 0), yMax)) / yMax;

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#cbd5e1';
  [0, 50000, 100000].forEach((value) => {
    const y = yForValue(value);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  });

  ctx.strokeStyle = '#a5b4fc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  pastAverages.forEach((value, index) => {
    const x = left + xStep * index;
    const y = yForValue(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.strokeStyle = '#4f46e5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  totalsByDay.forEach((value, index) => {
    const x = left + xStep * index;
    const y = yForValue(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText('0万', 8, yForValue(0) + 4);
  ctx.fillText('5万', 8, yForValue(50000) + 4);
  ctx.fillText('10万', 8, yForValue(100000) + 4);
  ctx.fillText('1日', left, height - 10);
  ctx.fillText(`${daysInMonth}日`, right - 28, height - 10);

  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(width - 220, 14, 12, 2);
  ctx.fillStyle = '#1f2a44';
  ctx.fillText('当月日次支出', width - 202, 18);
  ctx.fillStyle = '#a5b4fc';
  ctx.fillRect(width - 220, 32, 12, 2);
  ctx.fillStyle = '#1f2a44';
  ctx.fillText('過去同日平均', width - 202, 36);
}

function drawPieChart(canvas, expenses) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  if (expenses.length === 0) return;

  const total = expenses.reduce((sum, item) => sum + Number(item.amount), 0);
  const byPayment = expenses.reduce((acc, item) => {
    acc[item.paymentMethod] = (acc[item.paymentMethod] || 0) + Number(item.amount);
    return acc;
  }, {});
  const entries = Object.entries(byPayment);

  const colors = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
  let startAngle = -Math.PI / 2;
  const radius = 88;
  const centerX = 130;
  const centerY = height / 2;

  entries.forEach(([_, value], index) => {
    const ratio = value / total;
    const endAngle = startAngle + ratio * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colors[index % colors.length];
    ctx.fill();
    startAngle = endAngle;
  });

  ctx.font = '13px sans-serif';
  entries.forEach(([name, value], index) => {
    const y = 48 + index * 24;
    const color = colors[index % colors.length];
    const ratioText = `${Math.round((value / total) * 100)}%`;
    ctx.fillStyle = color;
    ctx.fillRect(260, y - 11, 12, 12);
    ctx.fillStyle = '#1f2a44';
    ctx.fillText(`${name}: ${ratioText} (${formatAmount(value)})`, 280, y);
  });
}

function renderAnalysis() {
  renderMonthLabels();
  const allExpenses = loadData(STORAGE_KEYS.expenses);
  const expenses = allExpenses.filter((entry) => isSelectedMonth(entry.date));
  const variableTotal = expenses.reduce((sum, entry) => sum + Number(entry.amount), 0);
  document.getElementById('analysis-variable-total').textContent = `流動費合計: ${formatAmount(variableTotal)}`;

  const lineCanvas = document.getElementById('daily-line-chart');
  const pieCanvas = document.getElementById('payment-pie-chart');
  const lineEmpty = document.getElementById('line-empty');
  const pieEmpty = document.getElementById('pie-empty');
  const pastAverages = getPastDailyAverages(allExpenses);

  drawLineChart(lineCanvas, expenses, pastAverages);
  drawPieChart(pieCanvas, expenses);
  lineEmpty.classList.toggle('hidden', expenses.length > 0 || pastAverages.some((value) => value > 0));
  pieEmpty.classList.toggle('hidden', expenses.length > 0);
}

function setActiveTab(tab) {
  const home = document.getElementById('tab-home');
  const analysis = document.getElementById('tab-analysis');
  home.classList.toggle('is-active', tab === 'home');
  analysis.classList.toggle('is-active', tab === 'analysis');
  home.setAttribute('aria-current', tab === 'home' ? 'page' : 'false');
  analysis.setAttribute('aria-current', tab === 'analysis' ? 'page' : 'false');
}

function renderAll() {
  renderMonthLabels();
  if (!screens.dashboard.classList.contains('hidden')) renderDashboard();
  if (!screens.analysis.classList.contains('hidden')) renderAnalysis();
  if (!screens.fixed.classList.contains('hidden')) renderFixedCosts();
}

function renderFixedCosts() {
  const fixedCosts = loadData(STORAGE_KEYS.fixedCosts);
  const list = document.getElementById('fixed-cost-list');
  const empty = document.getElementById('fixed-empty');
  list.innerHTML = '';

  fixedCosts.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'list-item';

    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML = `<strong>${escapeHtml(item.itemName)}</strong><span class="item-sub">毎月固定</span>`;

    const right = document.createElement('div');
    right.className = 'item-main';

    const amount = document.createElement('span');
    amount.className = 'item-amount';
    amount.textContent = formatAmount(item.amount);

    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.textContent = '削除';
    del.addEventListener('click', () => {
      const updated = loadData(STORAGE_KEYS.fixedCosts).filter((cost) => cost.id !== item.id);
      saveData(STORAGE_KEYS.fixedCosts, updated);
      renderFixedCosts();
    });

    right.append(amount, del);
    li.append(main, right);
    list.appendChild(li);
  });

  empty.classList.toggle('hidden', fixedCosts.length > 0);
}

function openFixedModal() {
  fixedModal.classList.remove('hidden');
  fixedForm.itemName.focus();
}

function closeFixedModal() {
  fixedModal.classList.add('hidden');
  fixedForm.reset();
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (match) => map[match]);
}

function initializeRoute() {
  const fixedCosts = loadData(STORAGE_KEYS.fixedCosts);
  if (fixedCosts.length === 0) {
    showScreen('fixed');
  } else {
    showScreen('dashboard');
  }
}

document.getElementById('go-expense').addEventListener('click', () => showScreen('expense'));
document.getElementById('go-fixed').addEventListener('click', () => showScreen('fixed'));
document.getElementById('tab-home').addEventListener('click', () => showScreen('dashboard'));
document.getElementById('tab-analysis').addEventListener('click', () => showScreen('analysis'));
document.getElementById('month-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('month-next').addEventListener('click', () => moveMonth(1));
document.getElementById('analysis-month-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('analysis-month-next').addEventListener('click', () => moveMonth(1));

document.getElementById('expense-cancel').addEventListener('click', () => showScreen('dashboard'));
document.getElementById('fixed-back').addEventListener('click', () => showScreen('dashboard'));
document.getElementById('open-fixed-modal').addEventListener('click', openFixedModal);
document.getElementById('fixed-modal-cancel').addEventListener('click', closeFixedModal);

fixedModal.addEventListener('click', (event) => {
  if (event.target === fixedModal) closeFixedModal();
});

expenseForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const payload = {
    id: crypto.randomUUID(),
    amount: Number(expenseForm.amount.value),
    itemName: expenseForm.itemName.value.trim(),
    date: expenseForm.date.value,
    category: expenseForm.category.value,
    paymentMethod: expenseForm.paymentMethod.value,
  };

  const expenses = loadData(STORAGE_KEYS.expenses);
  expenses.push(payload);
  saveData(STORAGE_KEYS.expenses, expenses);

  expenseForm.reset();
  setExpenseDefaultDate();
  renderAll();
  showScreen('dashboard');
});

fixedForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const newFixedCost = {
    id: crypto.randomUUID(),
    itemName: fixedForm.itemName.value.trim(),
    amount: Number(fixedForm.amount.value),
  };

  const fixedCosts = loadData(STORAGE_KEYS.fixedCosts);
  fixedCosts.push(newFixedCost);
  saveData(STORAGE_KEYS.fixedCosts, fixedCosts);

  closeFixedModal();
  renderAll();
});

initializeRoute();
