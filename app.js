const STORAGE_KEYS = {
  fixedCosts: 'kakeibo_fixed_costs',
  expenses: 'kakeibo_expenses',
};

const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  expense: document.getElementById('screen-expense'),
  fixed: document.getElementById('screen-fixed'),
};

const expenseForm = document.getElementById('expense-form');
const fixedForm = document.getElementById('fixed-form');
const fixedModal = document.getElementById('fixed-modal');

const formatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });

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

function isCurrentMonth(dateText) {
  const date = new Date(dateText);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function showScreen(screenName) {
  Object.entries(screens).forEach(([name, element]) => {
    element.classList.toggle('hidden', name !== screenName);
  });
  if (screenName === 'dashboard') renderDashboard();
  if (screenName === 'fixed') renderFixedCosts();
  if (screenName === 'expense') setExpenseDefaultDate();
}

function setExpenseDefaultDate() {
  if (!expenseForm.date.value) {
    expenseForm.date.value = todayString();
  }
}

function deleteExpense(expenseId) {
  const expenses = loadData(STORAGE_KEYS.expenses);
  const updated = expenses.filter((expense) => expense.id !== expenseId);
  saveData(STORAGE_KEYS.expenses, updated);
  renderDashboard();
}

function renderDashboard() {
  const fixedCosts = loadData(STORAGE_KEYS.fixedCosts);
  const expenses = loadData(STORAGE_KEYS.expenses);
  const monthlyExpenses = expenses.filter((entry) => isCurrentMonth(entry.date));

  const fixedTotal = fixedCosts.reduce((sum, item) => sum + Number(item.amount), 0);
  const expenseTotal = monthlyExpenses.reduce((sum, item) => sum + Number(item.amount), 0);

  document.getElementById('monthly-total').textContent = formatAmount(fixedTotal + expenseTotal);
  document.getElementById('monthly-breakdown').textContent = `固定費 ${formatAmount(fixedTotal)} + 当月支出 ${formatAmount(expenseTotal)}`;

  const expenseList = document.getElementById('expense-list');
  const expenseEmpty = document.getElementById('expense-empty');
  const expenseCount = document.getElementById('expense-count');

  expenseList.innerHTML = '';
  const sorted = [...monthlyExpenses].sort((a, b) => new Date(b.date) - new Date(a.date));

  sorted.forEach((expense) => {
    const li = document.createElement('li');
    li.className = 'list-item';

    const main = document.createElement('div');
    main.className = 'item-main';
    main.innerHTML = `
      <strong>${escapeHtml(expense.itemName)}</strong>
      <span class="item-sub">${expense.date} / ${expense.category} / ${expense.paymentMethod}</span>
    `;

    const right = document.createElement('div');
    right.className = 'item-actions';

    const amount = document.createElement('span');
    amount.className = 'item-amount';
    amount.textContent = formatAmount(expense.amount);

    const del = document.createElement('button');
    del.className = 'btn btn-danger';
    del.textContent = '削除';
    del.addEventListener('click', () => deleteExpense(expense.id));

    right.append(amount, del);
    li.append(main, right);
    expenseList.appendChild(li);
  });

  expenseCount.textContent = `${monthlyExpenses.length}件`;
  expenseEmpty.classList.toggle('hidden', monthlyExpenses.length > 0);
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
    right.className = 'item-actions';

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
    showScreen('expense');
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
    });
  }
}

document.getElementById('go-expense').addEventListener('click', () => showScreen('expense'));
document.getElementById('go-fixed').addEventListener('click', () => showScreen('fixed'));

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
  renderFixedCosts();
});

initializeRoute();
registerServiceWorker();
