import GoogleDriveService from './GoogleDriveService.js';

const GOOGLE_CONFIG = {
  CLIENT_ID: '1083922017545-gmt6evnv6kn3bfv7m3f7hu7oufeij2b8.apps.googleusercontent.com',
  SCOPE: 'https://www.googleapis.com/auth/drive.file',
};

const APP_VERSION = '0.0';
const APP_VERSION_STORAGE_KEY = 'kakeibo_app_version';

const STORAGE_KEYS = {
  fixedCosts: 'kakeibo_fixed_costs',
  expenses: 'kakeibo_expenses',
  categories: 'kakeibo_categories',
  paymentMethods: 'kakeibo_payment_methods',
};

const DRIVE_FILE_NAME = 'kakeibo_data.json';
const DEFAULT_CATEGORIES = ['内食', '外食', '生活用品', '趣味', '交際費'];
const DEFAULT_PAYMENT_METHODS = ['現金', 'カード', 'PayPay', '楽天ペイ', '楽天キャッシュ'];

const screens = {
  dashboard: document.getElementById('screen-dashboard'),
  expense: document.getElementById('screen-expense'),
  fixed: document.getElementById('screen-fixed'),
  analysis: document.getElementById('screen-analysis'),
};

const expenseForm = document.getElementById('expense-form');
const fixedForm = document.getElementById('fixed-form');
const fixedModal = document.getElementById('fixed-modal');
const expenseScreenTitle = document.getElementById('expense-screen-title');
const googleSignInButton = document.getElementById('google-signin');
const googleSignOutButton = document.getElementById('google-signout');
const syncStatusLabel = document.getElementById('sync-status-text');
const fixedSubmitButton = fixedForm.querySelector('button[type="submit"]');

const formatter = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
let selectedMonth = startOfMonth(new Date());
let isSubmittingFixedCost = false;
let editingExpenseId = null;
let isSyncingNow = false;

const driveService = new GoogleDriveService({
  clientId: GOOGLE_CONFIG.CLIENT_ID,
  scope: GOOGLE_CONFIG.SCOPE,
  fileName: DRIVE_FILE_NAME,
  onStatusChange: (status) => updateSyncStatus(status),
});

async function loadLocalData(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]');
  } catch {
    return [];
  }
}

async function saveLocalData(key, data, options = {}) {
  localStorage.setItem(key, JSON.stringify(data));

  if (options.skipCloudSync) return;

  await syncSnapshotToDrive();
}

async function getLocalSnapshot() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    fixedCosts: await loadLocalData(STORAGE_KEYS.fixedCosts),
    expenses: await loadLocalData(STORAGE_KEYS.expenses),
    categories: await loadLocalData(STORAGE_KEYS.categories),
    paymentMethods: await loadLocalData(STORAGE_KEYS.paymentMethods),
  };
}

async function applySnapshotToLocal(snapshot) {
  await saveLocalData(STORAGE_KEYS.fixedCosts, Array.isArray(snapshot.fixedCosts) ? snapshot.fixedCosts : [], { skipCloudSync: true });
  await saveLocalData(STORAGE_KEYS.expenses, Array.isArray(snapshot.expenses) ? snapshot.expenses : [], { skipCloudSync: true });
  await saveLocalData(STORAGE_KEYS.categories, Array.isArray(snapshot.categories) ? snapshot.categories : [], { skipCloudSync: true });
  await saveLocalData(STORAGE_KEYS.paymentMethods, Array.isArray(snapshot.paymentMethods) ? snapshot.paymentMethods : [], { skipCloudSync: true });
}



async function syncSnapshotToDrive() {
  if (!driveService.isSignedIn()) return;

  try {
    const snapshot = await getLocalSnapshot();
    await driveService.saveData(snapshot);
  } catch (error) {
    updateSyncStatus('error');
    console.error(error);
  }
}

async function tryAutoLoginAndLoadDriveData() {
  const authorized = await driveService.ensureAuthorized();
  updateAuthButtons();

  if (!authorized) return;

  const cloudSnapshot = await driveService.loadData();
  if (cloudSnapshot && typeof cloudSnapshot === 'object') {
    await applySnapshotToLocal(cloudSnapshot);
  }
}

function updateAuthButtons() {
  const signedIn = driveService.isSignedIn();
  googleSignInButton.classList.toggle('hidden', signedIn);
  googleSignOutButton.classList.toggle('hidden', !signedIn);
}

function updateSyncStatus(status) {
  const statusMap = {
    idle: 'Ready',
    offline: 'Offline',
    connecting: 'Connecting...',
    connected: 'Connected',
    syncing: 'Syncing...',
    synced: 'Synced',
    error: 'Error',
  };
  syncStatusLabel.textContent = statusMap[status] || 'Offline';
  syncStatusLabel.dataset.state = status;
  setSyncButtonLock(status === 'syncing');
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

async function moveMonth(offset) {
  selectedMonth = startOfMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + offset, 1));
  await renderAll();
}

function renderMonthLabels() {
  const label = monthLabel(selectedMonth);
  document.getElementById('selected-month-label').textContent = label;
  document.getElementById('analysis-month-label').textContent = label;
}

async function showScreen(screenName) {
  Object.entries(screens).forEach(([name, element]) => {
    element.classList.toggle('hidden', name !== screenName);
  });
  const activeTabByScreen = {
    dashboard: 'home',
    expense: 'expense',
    fixed: 'fixed',
    analysis: 'analysis',
  };
  setActiveTab(activeTabByScreen[screenName] || 'home');
  if (screenName === 'fixed') await renderFixedCosts();
  if (screenName === 'analysis') await renderAnalysis();
  if (screenName === 'dashboard') await renderDashboard();
  if (screenName === 'expense') {
    await renderExpenseOptions();
    setExpenseDefaultDate();
    setExpenseScreenTitle();
  }
}

function setExpenseDefaultDate() {
  if (!expenseForm.date.value) {
    expenseForm.date.value = todayString();
  }
}

function resetExpenseEditor() {
  editingExpenseId = null;
  setExpenseScreenTitle();
}

function setExpenseScreenTitle() {
  expenseScreenTitle.textContent = editingExpenseId ? '編集' : '支出入力';
}

function setSyncButtonLock(locked) {
  isSyncingNow = locked;
  document.querySelectorAll('button').forEach((button) => {
    if (locked) {
      button.dataset.syncWasDisabled = button.disabled ? '1' : '0';
      button.disabled = true;
      return;
    }

    if (button.dataset.syncWasDisabled === '0') {
      button.disabled = false;
    }
    delete button.dataset.syncWasDisabled;
  });
}

function clearAppStorageByPrefix(prefix) {
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key && key.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => localStorage.removeItem(key));
}

async function resetWebCaches() {
  if ('caches' in window) {
    const cacheKeys = await caches.keys();
    await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
}

async function ensureAppVersion() {
  const savedVersion = localStorage.getItem(APP_VERSION_STORAGE_KEY);
  if (savedVersion === APP_VERSION) return;

  clearAppStorageByPrefix('kakeibo_');
  await resetWebCaches();
  localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION);
}

async function renderDashboard() {
  renderMonthLabels();
  const fixedCosts = await loadLocalData(STORAGE_KEYS.fixedCosts);
  const expenses = await loadLocalData(STORAGE_KEYS.expenses);
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
    li.setAttribute('role', 'button');
    li.setAttribute('tabindex', '0');
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
    li.addEventListener('click', async () => {
      const targetExpense = (await loadLocalData(STORAGE_KEYS.expenses)).find((entry) => entry.id === expense.id);
      if (!targetExpense) return;
      await showScreen('expense');
      editingExpenseId = targetExpense.id;
      setExpenseScreenTitle();
      expenseForm.amount.value = targetExpense.amount;
      expenseForm.itemName.value = targetExpense.itemName;
      expenseForm.date.value = targetExpense.date;
      expenseForm.category.value = targetExpense.category;
      expenseForm.paymentMethod.value = targetExpense.paymentMethod;
    });
    li.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        li.click();
      }
    });
    expenseList.appendChild(li);
  });

  expenseList.querySelectorAll('.expense-delete').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const expenseId = button.dataset.expenseId;
      const updated = (await loadLocalData(STORAGE_KEYS.expenses)).filter((expense) => expense.id !== expenseId);
      await saveLocalData(STORAGE_KEYS.expenses, updated);
      await renderAll();
    });
  });

  expenseCount.textContent = `${monthlyExpenses.length}件`;
  expenseEmpty.classList.toggle('hidden', monthlyExpenses.length > 0);
}

function getPastCumulativeAverages(allExpenses) {
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthStart = startOfMonth(selectedMonth);
  const monthTotals = new Map();

  allExpenses.forEach((entry) => {
    const entryDate = new Date(entry.date);
    if (Number.isNaN(entryDate.getTime()) || entryDate >= monthStart) return;
    const day = entryDate.getDate();
    const entryMonthDays = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0).getDate();
    const monthKey = `${entryDate.getFullYear()}-${entryDate.getMonth()}`;
    if (!monthTotals.has(monthKey)) {
      monthTotals.set(monthKey, {
        daysInThisMonth: Math.min(entryMonthDays, daysInMonth),
        totalsByDay: Array.from({ length: daysInMonth }, () => 0),
      });
    }
    const monthData = monthTotals.get(monthKey);
    if (day > monthData.daysInThisMonth) return;
    monthData.totalsByDay[day - 1] += Number(entry.amount);
  });

  const totals = Array.from({ length: daysInMonth }, () => 0);
  const counts = Array.from({ length: daysInMonth }, () => 0);
  monthTotals.forEach(({ totalsByDay, daysInThisMonth }) => {
    let runningTotal = 0;
    for (let dayIndex = 0; dayIndex < daysInThisMonth; dayIndex += 1) {
      runningTotal += totalsByDay[dayIndex];
      totals[dayIndex] += runningTotal;
      counts[dayIndex] += 1;
    }
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
  const cumulativeTotalsByDay = totalsByDay.reduce((acc, value, index) => {
    const previous = index > 0 ? acc[index - 1] : 0;
    acc.push(previous + value);
    return acc;
  }, []);

  const yMax = Math.max(100000, ...cumulativeTotalsByDay, ...pastAverages);
  const left = 44;
  const right = width - 14;
  const top = 16;
  const bottom = height - 34;
  const xStep = (right - left) / (daysInMonth - 1 || 1);

  const yForValue = (value) => bottom - ((bottom - top) * Math.min(Math.max(value, 0), yMax)) / yMax;

  const yTickValues = [0, Math.round(yMax / 2), yMax];

  ctx.lineWidth = 1;
  ctx.strokeStyle = '#cbd5e1';
  yTickValues.forEach((value) => {
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
  cumulativeTotalsByDay.forEach((value, index) => {
    const x = left + xStep * index;
    const y = yForValue(value);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  yTickValues.forEach((value) => {
    const tickLabel = `${Math.round(value / 10000)}万`;
    ctx.fillText(tickLabel, 8, yForValue(value) + 4);
  });
  ctx.fillText('1日', left, height - 10);
  ctx.fillText(`${daysInMonth}日`, right - 28, height - 10);

  ctx.fillStyle = '#4f46e5';
  ctx.fillRect(width - 220, 14, 12, 2);
  ctx.fillStyle = '#1f2a44';
  ctx.fillText('当月累計支出', width - 202, 18);
  ctx.fillStyle = '#a5b4fc';
  ctx.fillRect(width - 220, 32, 12, 2);
  ctx.fillStyle = '#1f2a44';
  ctx.fillText('過去同日累計平均', width - 202, 36);
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

async function renderAnalysis() {
  renderMonthLabels();
  const allExpenses = await loadLocalData(STORAGE_KEYS.expenses);
  const expenses = allExpenses.filter((entry) => isSelectedMonth(entry.date));
  const variableTotal = expenses.reduce((sum, entry) => sum + Number(entry.amount), 0);
  document.getElementById('analysis-variable-total').textContent = `流動費合計: ${formatAmount(variableTotal)}`;

  const lineCanvas = document.getElementById('daily-line-chart');
  const pieCanvas = document.getElementById('payment-pie-chart');
  const lineEmpty = document.getElementById('line-empty');
  const pieEmpty = document.getElementById('pie-empty');
  const pastAverages = getPastCumulativeAverages(allExpenses);

  drawLineChart(lineCanvas, expenses, pastAverages);
  drawPieChart(pieCanvas, expenses);
  lineEmpty.classList.toggle('hidden', expenses.length > 0 || pastAverages.some((value) => value > 0));
  pieEmpty.classList.toggle('hidden', expenses.length > 0);
}

function setActiveTab(tab) {
  const home = document.getElementById('tab-home');
  const expense = document.getElementById('tab-expense');
  const fixed = document.getElementById('tab-fixed');
  const analysis = document.getElementById('tab-analysis');
  home.classList.toggle('is-active', tab === 'home');
  expense.classList.toggle('is-active', tab === 'expense');
  fixed.classList.toggle('is-active', tab === 'fixed');
  analysis.classList.toggle('is-active', tab === 'analysis');
  home.setAttribute('aria-current', tab === 'home' ? 'page' : 'false');
  expense.setAttribute('aria-current', tab === 'expense' ? 'page' : 'false');
  fixed.setAttribute('aria-current', tab === 'fixed' ? 'page' : 'false');
  analysis.setAttribute('aria-current', tab === 'analysis' ? 'page' : 'false');
}

async function renderAll() {
  renderMonthLabels();
  await renderExpenseOptions();
  if (!screens.dashboard.classList.contains('hidden')) await renderDashboard();
  if (!screens.analysis.classList.contains('hidden')) await renderAnalysis();
  if (!screens.fixed.classList.contains('hidden')) await renderFixedCosts();
  if (isSyncingNow) setSyncButtonLock(true);
}

async function getManagedOptions(storageKey, defaults) {
  const saved = await loadLocalData(storageKey);
  const base = Array.isArray(saved) ? saved : [];
  const merged = [...defaults, ...base]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return [...new Set(merged)];
}

function sortOptionsByUsage(options, usageMap) {
  return [...options].sort((a, b) => (usageMap.get(b) || 0) - (usageMap.get(a) || 0));
}

async function renderExpenseOptions() {
  const [expenses, categories, paymentMethods] = await Promise.all([
    loadLocalData(STORAGE_KEYS.expenses),
    getManagedOptions(STORAGE_KEYS.categories, DEFAULT_CATEGORIES),
    getManagedOptions(STORAGE_KEYS.paymentMethods, DEFAULT_PAYMENT_METHODS),
  ]);

  const categoryUsage = new Map();
  const paymentUsage = new Map();
  expenses.forEach((expense) => {
    categoryUsage.set(expense.category, (categoryUsage.get(expense.category) || 0) + 1);
    paymentUsage.set(expense.paymentMethod, (paymentUsage.get(expense.paymentMethod) || 0) + 1);
  });

  const categorySelect = expenseForm.category;
  const paymentSelect = expenseForm.paymentMethod;
  const selectedCategory = categorySelect.value;
  const selectedPayment = paymentSelect.value;

  categorySelect.innerHTML = '';
  sortOptionsByUsage(categories, categoryUsage).forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    categorySelect.appendChild(option);
  });

  paymentSelect.innerHTML = '';
  sortOptionsByUsage(paymentMethods, paymentUsage).forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    paymentSelect.appendChild(option);
  });

  if (selectedCategory && Array.from(categorySelect.options).some((option) => option.value === selectedCategory)) {
    categorySelect.value = selectedCategory;
  }
  if (selectedPayment && Array.from(paymentSelect.options).some((option) => option.value === selectedPayment)) {
    paymentSelect.value = selectedPayment;
  }
}

async function addManagedOption({ storageKey, defaults, inputId, selectName }) {
  const input = document.getElementById(inputId);
  const value = input.value.trim();
  if (!value) return;

  const options = await getManagedOptions(storageKey, defaults);
  if (!options.includes(value)) {
    const onlyCustom = options.filter((item) => !defaults.includes(item));
    onlyCustom.push(value);
    await saveLocalData(storageKey, onlyCustom);
  }

  input.value = '';
  await renderExpenseOptions();
  expenseForm[selectName].value = value;
}

async function renderFixedCosts() {
  const fixedCosts = await loadLocalData(STORAGE_KEYS.fixedCosts);
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
    del.addEventListener('click', async () => {
      const updated = (await loadLocalData(STORAGE_KEYS.fixedCosts)).filter((cost) => cost.id !== item.id);
      await saveLocalData(STORAGE_KEYS.fixedCosts, updated);
      await renderFixedCosts();
      await renderDashboard();
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

async function initializeRoute() {
  const fixedCosts = await loadLocalData(STORAGE_KEYS.fixedCosts);
  if (fixedCosts.length === 0) {
    await showScreen('fixed');
  } else {
    await showScreen('dashboard');
  }
}

async function handleGoogleSignIn() {
  if (googleSignInButton.disabled) return;

  try {
    await driveService.signIn();
    updateAuthButtons();

    const cloudSnapshot = await driveService.loadData();
    if (cloudSnapshot && typeof cloudSnapshot === 'object') {
      await applySnapshotToLocal(cloudSnapshot);
    } else {
      await syncSnapshotToDrive();
    }

    await renderAll();
  } catch (error) {
    updateSyncStatus('error');
    alert(`Google Drive同期に失敗しました: ${error.message || error}`);
    console.error(error);
  }
}

function handleGoogleSignOut() {
  driveService.signOut();
  updateAuthButtons();
}

function setSyncButtonLoading(isLoading, label = 'Sync with Google') {
  googleSignInButton.disabled = isLoading;
  googleSignInButton.textContent = label;
}

document.getElementById('go-expense').addEventListener('click', async () => {
  resetExpenseEditor();
  expenseForm.reset();
  setExpenseDefaultDate();
  await showScreen('expense');
});
document.getElementById('go-fixed').addEventListener('click', () => showScreen('fixed'));
document.getElementById('tab-home').addEventListener('click', () => showScreen('dashboard'));
document.getElementById('tab-expense').addEventListener('click', async () => {
  resetExpenseEditor();
  expenseForm.reset();
  setExpenseDefaultDate();
  await showScreen('expense');
});
document.getElementById('tab-fixed').addEventListener('click', () => showScreen('fixed'));
document.getElementById('tab-analysis').addEventListener('click', () => showScreen('analysis'));
document.getElementById('month-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('month-next').addEventListener('click', () => moveMonth(1));
document.getElementById('analysis-month-prev').addEventListener('click', () => moveMonth(-1));
document.getElementById('analysis-month-next').addEventListener('click', () => moveMonth(1));

document.getElementById('expense-cancel').addEventListener('click', async () => {
  resetExpenseEditor();
  expenseForm.reset();
  setExpenseDefaultDate();
  await showScreen('dashboard');
});
document.getElementById('fixed-back').addEventListener('click', () => showScreen('dashboard'));
document.getElementById('open-fixed-modal').addEventListener('click', openFixedModal);
document.getElementById('fixed-modal-cancel').addEventListener('click', closeFixedModal);
googleSignInButton.addEventListener('click', handleGoogleSignIn);
googleSignOutButton.addEventListener('click', handleGoogleSignOut);
document.getElementById('add-category-button').addEventListener('click', () =>
  addManagedOption({
    storageKey: STORAGE_KEYS.categories,
    defaults: DEFAULT_CATEGORIES,
    inputId: 'add-category-input',
    selectName: 'category',
  })
);
document.getElementById('add-payment-button').addEventListener('click', () =>
  addManagedOption({
    storageKey: STORAGE_KEYS.paymentMethods,
    defaults: DEFAULT_PAYMENT_METHODS,
    inputId: 'add-payment-input',
    selectName: 'paymentMethod',
  })
);

fixedModal.addEventListener('click', (event) => {
  if (event.target === fixedModal) closeFixedModal();
});

expenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const payload = {
    id: crypto.randomUUID(),
    amount: Number(expenseForm.amount.value),
    itemName: expenseForm.itemName.value.trim(),
    date: expenseForm.date.value,
    category: expenseForm.category.value,
    paymentMethod: expenseForm.paymentMethod.value,
  };

  const expenses = await loadLocalData(STORAGE_KEYS.expenses);
  if (editingExpenseId) {
    const filtered = expenses.filter((entry) => entry.id !== editingExpenseId);
    filtered.push(payload);
    await saveLocalData(STORAGE_KEYS.expenses, filtered);
  } else {
    expenses.push(payload);
    await saveLocalData(STORAGE_KEYS.expenses, expenses);
  }

  resetExpenseEditor();
  expenseForm.reset();
  setExpenseDefaultDate();
  await renderAll();
  await showScreen('dashboard');
});

fixedForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (isSubmittingFixedCost) return;
  isSubmittingFixedCost = true;
  fixedSubmitButton.disabled = true;

  try {
    const newFixedCost = {
      id: crypto.randomUUID(),
      itemName: fixedForm.itemName.value.trim(),
      amount: Number(fixedForm.amount.value),
    };

    const fixedCosts = await loadLocalData(STORAGE_KEYS.fixedCosts);
    fixedCosts.push(newFixedCost);
    await saveLocalData(STORAGE_KEYS.fixedCosts, fixedCosts);

    closeFixedModal();
    await renderAll();
  } finally {
    isSubmittingFixedCost = false;
    fixedSubmitButton.disabled = false;
  }
});

(async function bootstrap() {
  await ensureAppVersion();
  setSyncButtonLoading(true, 'Loading Google...');
  updateAuthButtons();
  updateSyncStatus('offline');

  try {
    await driveService.initializeDrive();
    setSyncButtonLoading(false, 'Sync with Google');
    updateSyncStatus('idle');
    await tryAutoLoginAndLoadDriveData();
    await renderAll();
  } catch (error) {
    updateSyncStatus('error');
    setSyncButtonLoading(true, 'Google unavailable');
    console.error(error);
  }

  await initializeRoute();
})();
