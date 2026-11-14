'use strict';

const $ = (selector) => document.querySelector(selector);

const loginView = $('#loginView');
const dashboardView = $('#dashboardView');

let csrfToken = '';

const modeDescriptions = {
  vulnerable:
    'Защиты от CSRF нет: запрос с другого origin может выполнить действие, если браузер приложит сессию.',

  token:
    'Сервер требует секретный CSRF-токен из сессии. Форма на отдельном origin не может прочитать его из victim-сайта.',

  origin:
    'Сервер принимает изменяющий состояние запрос только с точным Origin victim-сайта.',

  both:
    'Одновременно требуются корректный CSRF-токен и ожидаемый Origin.'
};

function showMessage(text, type = 'success') {
  const box = $('#transferMessage');

  box.textContent = text;
  box.className = `message ${type}`;
}

// HTTP API
async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,

    headers: {
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || `HTTP ${response.status}`
    );
  }

  return data;
}

// Универсальный рендер списка
function renderList(
  selector,
  items,
  emptyText,
  renderer
) {
  const element = $(selector);

  element.replaceChildren();

  if (!items.length) {
    const empty = document.createElement('p');

    empty.className = 'muted';
    empty.textContent = emptyText;

    element.append(empty);
    return;
  }

  for (const item of items) {
    element.append(renderer(item));
  }
}

// История переводов
function renderTransfers(items) {
  renderList(
    '#transfersList',
    items,
    'Пока операций нет.',
    (item) => {
      const row = document.createElement('div');

      row.className = 'transfer-item';

      const left = document.createElement('div');

      const title = document.createElement('b');

      title.textContent =
        `${item.sender} → ${item.recipient}`;

      const date = document.createElement('small');

      date.textContent =
        new Date(item.createdAt).toLocaleString('ru-RU');

      left.append(title, date);

      const amount = document.createElement('span');

      amount.className = 'amount';

      amount.textContent =
        `${item.amount} CR`;

      row.append(left, amount);

      return row;
    }
  );
}

// Журнал безопасности
function renderEvents(items) {
  renderList(
    '#eventsList',
    items,
    'Событий пока нет.',
    (item) => {
      const row = document.createElement('div');

      row.className = 'event-item';

      const main = document.createElement('div');

      main.className = 'event-main';

      const reason = document.createElement('b');

      reason.textContent = item.reason;

      const detail = document.createElement('small');

      detail.textContent =
        `${item.mode.toUpperCase()} · ${item.origin} · ` +
        `${new Date(item.createdAt).toLocaleTimeString('ru-RU')}`;

      main.append(reason, detail);

      const tag = document.createElement('span');

      tag.className = `event-tag ${item.outcome}`;

      tag.textContent =
        item.outcome.toUpperCase();

      row.append(main, tag);

      return row;
    }
  );
}

// Получение состояния банка
async function refreshState() {
  const state = await api('/api/state');

  csrfToken = state.csrfToken;

  $('#balance').textContent =
    state.account.balance.toLocaleString('ru-RU');

  $('#modeSelect').value = state.mode;

  $('#modeDescription').textContent =
    modeDescriptions[state.mode];

  renderTransfers(state.transfers);
  renderEvents(state.events);
}

// Показ dashboard
async function showDashboard() {
  loginView.classList.add('hidden');

  dashboardView.classList.remove('hidden');

  await refreshState();
}

// Первоначальная загрузка
async function boot() {
  try {
    await showDashboard();
  } catch {
    dashboardView.classList.add('hidden');

    loginView.classList.remove('hidden');
  }
}

// Вход Alice
$('#loginButton').addEventListener(
  'click',
  async () => {
    const button = $('#loginButton');

    button.disabled = true;

    button.textContent =
      'Подключаем demo-аккаунт…';

    try {
      await api('/api/login', {
        method: 'POST',

        body: new URLSearchParams({
          username: 'alice'
        })
      });

      await showDashboard();

    } catch (error) {
      alert(error.message);

    } finally {
      button.disabled = false;

      button.innerHTML =
        'Войти как Alice <span>→</span>';
    }
  }
);

// Выход
$('#logoutButton').addEventListener(
  'click',
  async () => {
    try {
      await api('/api/logout', {
        method: 'POST'
      });

      csrfToken = '';

      dashboardView.classList.add('hidden');

      loginView.classList.remove('hidden');

    } catch (error) {
      alert(error.message);
    }
  }
);

// Переключение защиты
$('#modeSelect').addEventListener(
  'change',
  async (event) => {
    try {
      await api('/api/lab/mode', {
        method: 'POST',

        body: new URLSearchParams({
          mode: event.target.value
        })
      });

      await refreshState();

    } catch (error) {
      alert(error.message);

      await refreshState();
    }
  }
);

// Обычный перевод из интерфейса
$('#transferForm').addEventListener(
  'submit',
  async (event) => {
    event.preventDefault();

    try {
      const body = new URLSearchParams({
        recipientId: $('#recipient').value,

        amount: $('#amount').value,

        _csrf: csrfToken
      });

      const result = await api('/api/transfer', {
        method: 'POST',
        body
      });

      showMessage(result.message, 'success');

      await refreshState();

    } catch (error) {
      showMessage(error.message, 'error');

      await refreshState();
    }
  }
);

// Обновление журнала
$('#refreshButton').addEventListener(
  'click',
  async () => {
    try {
      await refreshState();

    } catch (error) {
      alert(error.message);
    }
  }
);

const resetAliceButton = document.getElementById('reset-alice-btn');
const resetAliceStatus = document.getElementById('reset-alice-status');

if (resetAliceButton && resetAliceStatus) {
    resetAliceButton.addEventListener('click', async () => {
        resetAliceButton.disabled = true;
        resetAliceStatus.textContent = 'Сбрасываем баланс...';

        try {
            const response = await fetch('/api/admin/reset-alice', {
                method: 'POST'
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Неизвестная ошибка');
            }

            resetAliceStatus.textContent =
                `Готово! Баланс Алисы: ${data.balance} CR`;

        } catch (error) {
            resetAliceStatus.textContent =
                `Ошибка: ${error.message}`;

        } finally {
            resetAliceButton.disabled = false;
        }
    });
}

boot();