/* =====================================================================
   My Planner - script.js
   منطق سمت کاربر: ارتباط با API، رندر رابط کاربری و مدیریت تایمر
   ---------------------------------------------------------------------
   این فایل «مغز» فرانت‌اند است. مرورگر آن را اجرا می‌کند و از طریق
   fetch() با API بک‌اند (FastAPI) صحبت می‌کند.
   ===================================================================== */

'use strict';

/* ------------------------------------------------------------------
   بخش ۱: تنظیمات و وضعیت برنامه (State)
   ------------------------------------------------------------------ */

// آدرس API. چون فرانت‌اند از همان سرور سرو می‌شود، مسیر نسبی کافی است.
const API_BASE = '/api';

// وضعیت برنامه در حافظه مرورگر
const state = {
    view: 'dashboard',
    categories: [],
    tasks: [],
    running: {},          // فعالیت‌هایی که تایمرشان روشن است: { id: {base, startedMs} }
    reportDate: todayISO(),
    weekStart: null,      // ابتدای هفته جاری (شنبه)
    editingTaskId: null,
    editingCategoryId: null,
    confirmCallback: null,
};

const STATUS_LABELS = {
    todo: 'انجام‌نشده',
    in_progress: 'در حال انجام',
    done: 'انجام‌شده',
};

const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

/* ------------------------------------------------------------------
   بخش ۲: ابزارهای کمکی (Utilities)
   ------------------------------------------------------------------ */

/** تاریخ امروز به شکل YYYY-MM-DD بر اساس ساعت محلی سیستم */
function todayISO() {
    return localISO(new Date());
}

function localISO(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** افزودن تعداد روز به یک تاریخ ISO */
function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return localISO(d);
}

/** تبدیل ارقام انگلیسی به فارسی */
function fa(value) {
    return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/** نمایش تاریخ به شکل فارسی (مثلاً: چهارشنبه ۲۱ آبان ۱۴۰۵) */
function persianDate(iso) {
    const d = iso ? new Date(iso + 'T00:00:00') : new Date();
    return new Intl.DateTimeFormat('fa-IR', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }).format(d);
}

/** نمایش کوتاه تاریخ فارسی (روز + ماه) */
function persianShort(iso) {
    const d = new Date(iso + 'T00:00:00');
    return new Intl.DateTimeFormat('fa-IR', { day: 'numeric', month: 'long' }).format(d);
}

/** تبدیل ثانیه به قالب ساعت:دقیقه:ثانیه */
function clock(totalSeconds) {
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const s = String(totalSeconds % 60).padStart(2, '0');
    return fa(`${h}:${m}:${s}`);
}

/** تبدیل دقیقه به متن خوانا (مثلاً: ۱ ساعت و ۳۰ دقیقه) */
function minutesText(minutes) {
    minutes = Math.round(minutes);
    if (!minutes) return '۰ دقیقه';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const parts = [];
    if (h) parts.push(`${fa(h)} ساعت`);
    if (m) parts.push(`${fa(m)} دقیقه`);
    return parts.join(' و ');
}

/** تبدیل ثانیه به متن خوانا */
function secondsText(seconds) {
    return minutesText(Math.round(seconds / 60)) || '۰ دقیقه';
}

/** پیدا کردن نام روز هفته (شنبه = ۰) */
function weekdayIndex(iso) {
    const d = new Date(iso + 'T00:00:00').getDay(); // یکشنبه = ۰ ... شنبه = ۶
    return (d + 1) % 7; // شنبه = ۰
}

/** فرار دادن متن برای جلوگیری از تزریق HTML (امنیت) */
function escapeHTML(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** نمایش پیام شناور (Toast) */
function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transition = 'opacity .3s';
        setTimeout(() => el.remove(), 300);
    }, 2800);
}

/* ------------------------------------------------------------------
   بخش ۳: لایه ارتباط با API
   ------------------------------------------------------------------ */

const api = {
    async request(method, path, body) {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body !== undefined) options.body = JSON.stringify(body);

        let response;
        try {
            response = await fetch(API_BASE + path, options);
        } catch (err) {
            throw new Error('ارتباط با سرور برقرار نشد. مطمئن شوید بک‌اند در حال اجراست.');
        }

        if (!response.ok) {
            let detail = `خطا (${response.status})`;
            try {
                const data = await response.json();
                if (data && data.detail) {
                    detail = typeof data.detail === 'string'
                        ? data.detail
                        : 'اطلاعات ورودی نامعتبر است.';
                }
            } catch (_) { /* پاسخ JSON نبود */ }
            throw new Error(detail);
        }
        if (response.status === 204) return null;
        return response.json();
    },
    get(path) { return this.request('GET', path); },
    post(path, body) { return this.request('POST', path, body); },
    put(path, body) { return this.request('PUT', path, body); },
    del(path) { return this.request('DELETE', path); },
};

/* ------------------------------------------------------------------
   بخش ۴: مدیریت تایمر (نمایش زنده)
   ------------------------------------------------------------------ */

/** ثبت فعالیت‌های دارای تایمر روشن در state برای نمایش زنده */
function syncRunningTimers(tasks) {
    const running = {};
    for (const task of tasks) {
        if (task.is_running && task.timer_started_at) {
            running[task.id] = {
                base: task.actual_seconds || 0,
                startedMs: Date.parse(task.timer_started_at),
            };
        }
    }
    state.running = running;
}

/** محاسبه ثانیه سپری‌شده برای یک فعالیت در حال اجرا */
function elapsedFor(taskId) {
    const info = state.running[taskId];
    if (!info) return null;
    return info.base + (Date.now() - info.startedMs) / 1000;
}

/** به‌روزرسانی همه نمایشگرهای تایمر (هر ثانیه) */
function tick() {
    document.querySelectorAll('[data-timer-id]').forEach((el) => {
        const id = Number(el.dataset.timerId);
        const elapsed = elapsedFor(id);
        if (elapsed !== null) el.textContent = clock(elapsed);
    });

    // بنر تایمر بالای داشبورد
    const banner = document.getElementById('timer-banner');
    const ids = Object.keys(state.running);
    if (ids.length > 0) {
        const id = Number(ids[0]);
        const task = state.tasks.find((t) => t.id === id);
        const elapsed = elapsedFor(id);
        banner.classList.remove('hidden');
        document.getElementById('timer-banner-time').textContent = clock(elapsed);
        if (task) document.getElementById('timer-banner-title').textContent = task.title;
    } else {
        banner.classList.add('hidden');
    }
}

/* ------------------------------------------------------------------
   بخش ۵: ساخت HTML اجزا
   ------------------------------------------------------------------ */

function statusPill(status) {
    return `<span class="status-pill status-${status}">${STATUS_LABELS[status] || status}</span>`;
}

/** ساخت HTML یک فعالیت */
function taskItemHTML(task) {
    const catColor = task.category_color || '#94a3b8';
    const elapsed = task.is_running ? (elapsedFor(task.id) ?? task.elapsed_seconds) : task.elapsed_seconds;

    const meta = [];
    if (task.category_name) {
        meta.push(`<span class="chip">${escapeHTML(task.category_icon || '')} ${escapeHTML(task.category_name)}</span>`);
    }
    meta.push(`<span class="chip">📅 ${fa(persianShort(task.planned_date))}</span>`);
    if (task.planned_start) meta.push(`<span class="chip">🕐 ${fa(task.planned_start)}</span>`);
    if (task.planned_minutes) meta.push(`<span class="chip">⏳ برنامه: ${minutesText(task.planned_minutes)}</span>`);
    if (elapsed > 0) meta.push(`<span class="chip timer-badge" data-timer-id="${task.id}">⏱️ ${clock(elapsed)}</span>`);

    const actions = [];
    if (task.is_running) {
        actions.push(`<button class="btn btn-ghost btn-sm" data-action="stop" data-id="${task.id}">⏸ توقف</button>`);
    } else if (task.status !== 'done') {
        actions.push(`<button class="btn btn-ghost btn-sm" data-action="start" data-id="${task.id}">▶ شروع</button>`);
    }
    if (task.status !== 'done') {
        actions.push(`<button class="btn btn-ghost btn-sm" data-action="done" data-id="${task.id}">✓ انجام شد</button>`);
    } else {
        actions.push(`<button class="btn btn-ghost btn-sm" data-action="reopen" data-id="${task.id}">↩ بازگرداندن</button>`);
    }
    actions.push(`<button class="icon-btn" data-action="edit" data-id="${task.id}" title="ویرایش">✏️</button>`);
    actions.push(`<button class="icon-btn" data-action="delete" data-id="${task.id}" title="حذف">🗑️</button>`);

    const achievement = task.achievement
        ? `<div class="task-achievement">🏆 ${escapeHTML(task.achievement)}</div>` : '';

    return `
        <div class="task-item ${task.status === 'done' ? 'is-done' : ''} ${task.is_running ? 'is-running' : ''}"
             style="--cat:${catColor}">
            <div class="task-main">
                <div class="task-title">${escapeHTML(task.title)}</div>
                ${task.description ? `<div class="task-desc">${escapeHTML(task.description)}</div>` : ''}
                <div class="task-meta">${statusPill(task.status)}${meta.join('')}</div>
                ${achievement}
            </div>
            <div class="task-actions">${actions.join('')}</div>
        </div>`;
}

function emptyState(emoji, text) {
    return `<div class="empty-state"><span class="emoji">${emoji}</span>${text}</div>`;
}

/* ------------------------------------------------------------------
   بخش ۶: رندر صفحه داشبورد
   ------------------------------------------------------------------ */

async function loadDashboard() {
    const day = todayISO();
    document.getElementById('greeting').textContent = greetingText();
    document.getElementById('today-date').textContent = persianDate(day);

    const [overview, tasks] = await Promise.all([
        api.get(`/reports/overview?day=${day}`),
        api.get(`/tasks?date=${day}`),
    ]);

    state.tasks = tasks;
    syncRunningTimers(tasks);

    const today = overview.today;
    document.getElementById('stat-total').textContent = fa(today.total);
    document.getElementById('stat-done').textContent = fa(today.done);
    document.getElementById('stat-planned').textContent = minutesText(today.planned_minutes);
    document.getElementById('stat-actual').textContent = secondsText(today.actual_seconds);

    // حلقه پیشرفت
    const rate = today.completion_rate || 0;
    const circumference = 327;
    document.getElementById('ring-fg').style.strokeDashoffset = String(circumference * (1 - rate / 100));
    document.getElementById('ring-percent').textContent = `${fa(Math.round(rate))}٪`;
    document.getElementById('progress-caption').textContent = today.total
        ? `${fa(today.done)} از ${fa(today.total)} فعالیت انجام شده است.`
        : 'هنوز فعالیتی برای امروز ثبت نشده است.';

    // مقایسه برنامه و عملکرد
    renderCompare(document.getElementById('compare-today'), today.planned_minutes, today.actual_seconds);

    // فهرست فعالیت‌های امروز
    const container = document.getElementById('today-tasks');
    container.innerHTML = tasks.length
        ? tasks.map(taskItemHTML).join('')
        : emptyState('🌱', 'امروز هنوز فعالیتی ثبت نشده. با دکمه «فعالیت جدید» شروع کن!');
}

function greetingText() {
    const h = new Date().getHours();
    if (h < 12) return 'صبح بخیر 👋';
    if (h < 17) return 'ظهر بخیر 👋';
    if (h < 20) return 'عصر بخیر 👋';
    return 'شب بخیر 👋';
}

function renderCompare(container, plannedMinutes, actualSeconds) {
    const actualMinutes = actualSeconds / 60;
    const max = Math.max(plannedMinutes, actualMinutes, 1);
    const plannedPct = Math.min(100, (plannedMinutes / max) * 100);
    const actualPct = Math.min(100, (actualMinutes / max) * 100);

    const diff = actualMinutes - plannedMinutes;
    let diffText;
    if (!plannedMinutes && !actualMinutes) diffText = 'داده‌ای برای مقایسه نیست';
    else if (diff > 0) diffText = `بیشتر از برنامه: ${minutesText(diff)}`;
    else if (diff < 0) diffText = `کمتر از برنامه: ${minutesText(-diff)}`;
    else diffText = 'دقیقاً مطابق برنامه ✅';

    container.innerHTML = `
        <div class="compare-row">
            <div class="compare-row-head"><span>زمان برنامه‌ریزی‌شده</span><strong>${minutesText(plannedMinutes)}</strong></div>
            <div class="bar-track"><div class="bar-fill bar-planned" style="width:${plannedPct}%"></div></div>
        </div>
        <div class="compare-row">
            <div class="compare-row-head"><span>زمان واقعی صرف‌شده</span><strong>${secondsText(actualSeconds)}</strong></div>
            <div class="bar-track"><div class="bar-fill bar-actual" style="width:${actualPct}%"></div></div>
        </div>
        <p class="muted" style="font-size:.85rem;margin-top:4px">${diffText}</p>`;
}

/* ------------------------------------------------------------------
   بخش ۷: رندر صفحه فعالیت‌ها
   ------------------------------------------------------------------ */

function buildTaskQuery() {
    const params = new URLSearchParams();
    const search = document.getElementById('filter-search').value.trim();
    const category = document.getElementById('filter-category').value;
    const status = document.getElementById('filter-status').value;
    const from = document.getElementById('filter-date-from').value;
    const to = document.getElementById('filter-date-to').value;

    if (search) params.set('search', search);
    if (category) params.set('category_id', category);
    if (status) params.set('status', status);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
}

async function loadTasks() {
    const tasks = await api.get('/tasks' + buildTaskQuery());
    state.tasks = tasks;
    syncRunningTimers(tasks);

    const container = document.getElementById('all-tasks');
    document.getElementById('tasks-count').textContent = `${fa(tasks.length)} مورد`;
    container.innerHTML = tasks.length
        ? tasks.map(taskItemHTML).join('')
        : emptyState('🔍', 'فعالیتی با این فیلترها پیدا نشد.');
}

/* ------------------------------------------------------------------
   بخش ۸: رندر صفحه گزارش‌ها
   ------------------------------------------------------------------ */

async function loadReports() {
    const day = state.reportDate;
    if (!state.weekStart) state.weekStart = weekStartOf(day);

    const [daily, weekly, categories] = await Promise.all([
        api.get(`/reports/daily?day=${day}`),
        api.get(`/reports/weekly?start=${state.weekStart}`),
        api.get(`/reports/categories?date_from=${state.weekStart}&date_to=${addDays(state.weekStart, 6)}`),
    ]);

    // کارت‌های گزارش روزانه
    document.getElementById('r-total').textContent = fa(daily.total);
    document.getElementById('r-done').textContent = fa(daily.done);
    document.getElementById('r-planned').textContent = minutesText(daily.planned_minutes);
    document.getElementById('r-actual').textContent = secondsText(daily.actual_seconds);

    // برچسب هفته
    document.getElementById('week-label').textContent =
        `${persianShort(weekly.start)} تا ${persianShort(addDays(weekly.start, 6))}`;

    renderWeeklyChart(weekly);

    // جمع‌بندی هفته
    const totals = weekly.totals;
    document.getElementById('week-totals').innerHTML = `
        <div class="mini"><span>کل فعالیت‌ها</span><strong>${fa(totals.total)}</strong></div>
        <div class="mini"><span>انجام‌شده</span><strong>${fa(totals.done)}</strong></div>
        <div class="mini"><span>زمان برنامه</span><strong>${minutesText(totals.planned_minutes)}</strong></div>
        <div class="mini"><span>زمان واقعی</span><strong>${secondsText(totals.actual_seconds)}</strong></div>
        <div class="mini"><span>درصد تکمیل</span><strong>${fa(Math.round(totals.completion_rate))}٪</strong></div>`;

    renderCategoryReport(categories);
}

function weekStartOf(iso) {
    const idx = weekdayIndex(iso); // شنبه = ۰
    return addDays(iso, -idx);
}

function renderWeeklyChart(weekly) {
    const container = document.getElementById('weekly-chart');
    const today = todayISO();

    const values = weekly.days.map((d) => ({
        planned: d.planned_minutes,
        actual: d.actual_seconds / 60,
    }));
    const max = Math.max(1, ...values.map((v) => Math.max(v.planned, v.actual)));

    container.innerHTML = weekly.days.map((d, i) => {
        const plannedPct = (values[i].planned / max) * 100;
        const actualPct = (values[i].actual / max) * 100;
        const isToday = d.date === today ? 'is-today' : '';
        return `
            <div class="chart-col ${isToday}">
                <div class="chart-bars">
                    <div class="chart-bar planned" style="height:${plannedPct}%" title="برنامه: ${minutesText(d.planned_minutes)}"></div>
                    <div class="chart-bar actual" style="height:${actualPct}%" title="واقعی: ${secondsText(d.actual_seconds)}"></div>
                </div>
                <span class="chart-label">${WEEKDAYS[weekdayIndex(d.date)]}</span>
            </div>`;
    }).join('');
}

function renderCategoryReport(categories) {
    const container = document.getElementById('category-report');
    const withData = categories.filter((c) => c.total > 0);

    if (!withData.length) {
        container.innerHTML = emptyState('📭', 'این هفته هنوز فعالیتی در هیچ دسته‌بندی ثبت نشده است.');
        return;
    }

    const maxMinutes = Math.max(1, ...withData.map((c) => Math.max(c.planned_minutes, c.actual_seconds / 60)));

    container.innerHTML = withData.map((c) => {
        const plannedPct = (c.planned_minutes / maxMinutes) * 100;
        const actualPct = (c.actual_seconds / 60 / maxMinutes) * 100;
        return `
            <div class="cat-report-row">
                <div class="cat-report-head">
                    <span class="name"><span>${escapeHTML(c.icon || '📌')}</span> ${escapeHTML(c.name)}</span>
                    <span class="muted">${fa(c.done)}/${fa(c.total)} انجام‌شده · ${secondsText(c.actual_seconds)}</span>
                </div>
                <div class="bar-track"><div class="bar-fill" style="width:${plannedPct}%;background:${c.color || '#f59e0b'}"></div></div>
                <div class="bar-track" style="height:7px"><div class="bar-fill" style="width:${actualPct}%;background:${c.color || '#06b6d4'};opacity:.55"></div></div>
            </div>`;
    }).join('');
}

/* ------------------------------------------------------------------
   بخش ۹: رندر صفحه دسته‌بندی‌ها
   ------------------------------------------------------------------ */

async function loadCategories() {
    const categories = await api.get('/categories');
    state.categories = categories;

    // پر کردن selectهای دسته‌بندی
    fillCategorySelects(categories);

    const grid = document.getElementById('categories-grid');
    grid.innerHTML = categories.length ? categories.map((c) => `
        <div class="category-card" style="--cat:${c.color}">
            <div class="cat-icon">${escapeHTML(c.icon || '📌')}</div>
            <div class="cat-info">
                <strong>${escapeHTML(c.name)}</strong>
                <small>${fa(c.task_count)} فعالیت</small>
            </div>
            <div class="cat-actions">
                <button class="icon-btn" data-cat-action="edit" data-id="${c.id}" title="ویرایش">✏️</button>
                <button class="icon-btn" data-cat-action="delete" data-id="${c.id}" title="حذف">🗑️</button>
            </div>
        </div>`).join('') : emptyState('🏷️', 'هنوز دسته‌بندی‌ای نساخته‌اید.');
}

function fillCategorySelects(categories) {
    const filterSelect = document.getElementById('filter-category');
    const taskSelect = document.getElementById('task-category');
    const currentFilter = filterSelect.value;

    filterSelect.innerHTML = '<option value="">همه</option>' +
        categories.map((c) => `<option value="${c.id}">${escapeHTML(c.icon)} ${escapeHTML(c.name)}</option>`).join('');

    taskSelect.innerHTML = '<option value="">بدون دسته‌بندی</option>' +
        categories.map((c) => `<option value="${c.id}">${escapeHTML(c.icon)} ${escapeHTML(c.name)}</option>`).join('');

    if (currentFilter) filterSelect.value = currentFilter;
}

/* ------------------------------------------------------------------
   بخش ۱۰: مودال فعالیت (افزودن/ویرایش)
   ------------------------------------------------------------------ */

function openTaskModal(task = null) {
    const modal = document.getElementById('task-modal');
    document.getElementById('task-form').reset();
    document.getElementById('task-id').value = '';

    if (task) {
        state.editingTaskId = task.id;
        document.getElementById('task-modal-title').textContent = 'ویرایش فعالیت';
        document.getElementById('task-title').value = task.title || '';
        document.getElementById('task-description').value = task.description || '';
        document.getElementById('task-category').value = task.category_id || '';
        document.getElementById('task-status').value = task.status || 'todo';
        document.getElementById('task-date').value = task.planned_date || todayISO();
        document.getElementById('task-start').value = task.planned_start || '';
        document.getElementById('task-minutes').value = task.planned_minutes || 0;
        document.getElementById('task-achievement').value = task.achievement || '';
    } else {
        state.editingTaskId = null;
        document.getElementById('task-modal-title').textContent = 'فعالیت جدید';
        document.getElementById('task-date').value = todayISO();
        document.getElementById('task-minutes').value = 0;
        document.getElementById('task-status').value = 'todo';
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('task-title').focus();
}

function closeTaskModal() {
    const modal = document.getElementById('task-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    state.editingTaskId = null;
}

async function submitTask(event) {
    event.preventDefault();
    const payload = {
        title: document.getElementById('task-title').value.trim(),
        description: document.getElementById('task-description').value.trim(),
        category_id: document.getElementById('task-category').value
            ? Number(document.getElementById('task-category').value) : null,
        planned_date: document.getElementById('task-date').value,
        planned_start: document.getElementById('task-start').value || null,
        planned_minutes: Number(document.getElementById('task-minutes').value) || 0,
        status: document.getElementById('task-status').value,
        achievement: document.getElementById('task-achievement').value.trim(),
    };

    if (!payload.title) { toast('عنوان فعالیت را وارد کنید.', 'error'); return; }
    if (!payload.planned_date) { toast('تاریخ برنامه‌ریزی را انتخاب کنید.', 'error'); return; }

    try {
        if (state.editingTaskId) {
            await api.put(`/tasks/${state.editingTaskId}`, payload);
            toast('فعالیت ویرایش شد.', 'success');
        } else {
            await api.post('/tasks', payload);
            toast('فعالیت جدید ثبت شد.', 'success');
        }
        closeTaskModal();
        await refreshCurrentView();
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ------------------------------------------------------------------
   بخش ۱۱: عملیات روی فعالیت‌ها (تایمر، وضعیت، حذف)
   ------------------------------------------------------------------ */

async function handleTaskAction(action, id) {
    try {
        if (action === 'start') {
            await api.post(`/tasks/${id}/timer/start`);
            toast('تایمر شروع شد.', 'success');
        } else if (action === 'stop') {
            await api.post(`/tasks/${id}/timer/stop`);
            toast('تایمر متوقف شد.', 'success');
        } else if (action === 'done') {
            await api.post(`/tasks/${id}/status`, { status: 'done' });
            toast('فعالیت انجام‌شده ثبت شد. 🎉', 'success');
        } else if (action === 'reopen') {
            await api.post(`/tasks/${id}/status`, { status: 'todo' });
            toast('فعالیت بازگردانده شد.', 'success');
        } else if (action === 'edit') {
            const task = await api.get(`/tasks/${id}`);
            openTaskModal(task);
            return;
        } else if (action === 'delete') {
            askConfirm('این فعالیت برای همیشه حذف شود؟', async () => {
                await api.del(`/tasks/${id}`);
                toast('فعالیت حذف شد.', 'success');
                await refreshCurrentView();
            });
            return;
        }
        await refreshCurrentView();
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ------------------------------------------------------------------
   بخش ۱۲: مودال تأیید
   ------------------------------------------------------------------ */

function askConfirm(text, callback) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-text').textContent = text;
    state.confirmCallback = callback;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function closeConfirm() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    state.confirmCallback = null;
}

/* ------------------------------------------------------------------
   بخش ۱۳: دسته‌بندی‌ها (افزودن/ویرایش/حذف)
   ------------------------------------------------------------------ */

async function submitCategory(event) {
    event.preventDefault();
    const name = document.getElementById('cat-name').value.trim();
    const icon = document.getElementById('cat-icon').value.trim() || '📌';
    const color = document.getElementById('cat-color').value;

    if (!name) { toast('نام دسته‌بندی را وارد کنید.', 'error'); return; }

    try {
        if (state.editingCategoryId) {
            await api.put(`/categories/${state.editingCategoryId}`, { name, icon, color });
            toast('دسته‌بندی ویرایش شد.', 'success');
        } else {
            await api.post('/categories', { name, icon, color });
            toast('دسته‌بندی افزوده شد.', 'success');
        }
        resetCategoryForm();
        await loadCategories();
    } catch (err) {
        toast(err.message, 'error');
    }
}

function editCategory(id) {
    const category = state.categories.find((c) => c.id === id);
    if (!category) return;
    state.editingCategoryId = id;
    document.getElementById('cat-name').value = category.name;
    document.getElementById('cat-icon').value = category.icon;
    document.getElementById('cat-color').value = category.color;
    document.getElementById('cat-cancel').classList.remove('hidden');
    document.getElementById('cat-submit').textContent = 'ذخیره تغییرات';
    document.getElementById('cat-name').focus();
}

function resetCategoryForm() {
    state.editingCategoryId = null;
    document.getElementById('category-form').reset();
    document.getElementById('cat-icon').value = '📌';
    document.getElementById('cat-color').value = '#6366f1';
    document.getElementById('cat-cancel').classList.add('hidden');
    document.getElementById('cat-submit').textContent = 'افزودن';
}

/* ------------------------------------------------------------------
   بخش ۱۴: ناوبری بین صفحه‌ها
   ------------------------------------------------------------------ */

async function switchView(view) {
    state.view = view;
    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((section) => {
        section.classList.toggle('active', section.id === `view-${view}`);
    });
    await refreshCurrentView();
}

async function refreshCurrentView() {
    try {
        if (state.view === 'dashboard') await loadDashboard();
        else if (state.view === 'tasks') await loadTasks();
        else if (state.view === 'reports') await loadReports();
        else if (state.view === 'categories') await loadCategories();
        tick();
    } catch (err) {
        toast(err.message, 'error');
    }
}

/* ------------------------------------------------------------------
   بخش ۱۵: حالت روشن/تاریک
   ------------------------------------------------------------------ */

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
    document.getElementById('theme-label').textContent = theme === 'dark' ? 'حالت روشن' : 'حالت تاریک';
    localStorage.setItem('planner-theme', theme);
}

/* ------------------------------------------------------------------
   بخش ۱۶: راه‌اندازی و اتصال رویدادها
   ------------------------------------------------------------------ */

function bindEvents() {
    // ناوبری
    document.querySelectorAll('.nav-item').forEach((btn) => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });
    document.querySelectorAll('[data-goto-view]').forEach((btn) => {
        btn.addEventListener('click', () => switchView(btn.dataset.gotoView));
    });

    // دکمه‌های باز کردن مودال فعالیت
    document.querySelectorAll('[data-open-task-modal]').forEach((btn) => {
        btn.addEventListener('click', () => openTaskModal());
    });
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
        btn.addEventListener('click', closeTaskModal);
    });
    document.querySelectorAll('[data-close-confirm]').forEach((btn) => {
        btn.addEventListener('click', closeConfirm);
    });

    // فرم فعالیت
    document.getElementById('task-form').addEventListener('submit', submitTask);

    // بستن مودال با کلیک روی پس‌زمینه یا کلید Escape
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.id === 'task-modal') closeTaskModal();
                else closeConfirm();
            }
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { closeTaskModal(); closeConfirm(); }
    });

    // دکمه تأیید حذف
    document.getElementById('confirm-yes').addEventListener('click', async () => {
        const callback = state.confirmCallback;
        closeConfirm();
        if (callback) {
            try { await callback(); } catch (err) { toast(err.message, 'error'); }
        }
    });

    // عملیات فعالیت‌ها (Event Delegation)
    ['today-tasks', 'all-tasks'].forEach((containerId) => {
        document.getElementById(containerId).addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (btn) handleTaskAction(btn.dataset.action, Number(btn.dataset.id));
        });
    });

    // بنر تایمر
    document.getElementById('timer-banner-stop').addEventListener('click', async () => {
        const id = Number(Object.keys(state.running)[0]);
        if (id) await handleTaskAction('stop', id);
    });
    document.getElementById('timer-banner-open').addEventListener('click', () => switchView('tasks'));

    // فیلترها
    const debounce = (fn, delay) => {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
    };
    document.getElementById('filter-search').addEventListener('input', debounce(loadTasks, 300));
    ['filter-category', 'filter-status', 'filter-date-from', 'filter-date-to'].forEach((id) => {
        document.getElementById(id).addEventListener('change', loadTasks);
    });
    document.getElementById('filter-clear').addEventListener('click', () => {
        document.getElementById('filter-search').value = '';
        document.getElementById('filter-category').value = '';
        document.getElementById('filter-status').value = '';
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        loadTasks();
    });

    // گزارش‌ها
    document.getElementById('report-date').addEventListener('change', (e) => {
        state.reportDate = e.target.value || todayISO();
        state.weekStart = weekStartOf(state.reportDate);
        loadReports();
    });
    document.getElementById('week-prev').addEventListener('click', () => {
        state.weekStart = addDays(state.weekStart, -7);
        loadReports();
    });
    document.getElementById('week-next').addEventListener('click', () => {
        state.weekStart = addDays(state.weekStart, 7);
        loadReports();
    });

    // دسته‌بندی‌ها
    document.getElementById('category-form').addEventListener('submit', submitCategory);
    document.getElementById('cat-cancel').addEventListener('click', resetCategoryForm);
    document.getElementById('categories-grid').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-cat-action]');
        if (!btn) return;
        const id = Number(btn.dataset.id);
        if (btn.dataset.catAction === 'edit') {
            editCategory(id);
        } else {
            const category = state.categories.find((c) => c.id === id);
            askConfirm(`دسته‌بندی «${category ? category.name : ''}» حذف شود؟ فعالیت‌های آن حذف نمی‌شوند و بدون دسته باقی می‌مانند.`, async () => {
                await api.del(`/categories/${id}`);
                toast('دسته‌بندی حذف شد.', 'success');
                await loadCategories();
            });
        }
    });

    // تغییر حالت روشن/تاریک
    document.getElementById('theme-toggle').addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });
}

/** نقطه شروع برنامه */
async function init() {
    // اعمال حالت رنگ ذخیره‌شده
    applyTheme(localStorage.getItem('planner-theme') || 'light');

    // مقدار اولیه فیلد تاریخ گزارش
    document.getElementById('report-date').value = state.reportDate;

    bindEvents();

    // بارگذاری دسته‌بندی‌ها (برای پر شدن selectها) و سپس داشبورد
    try {
        await loadCategories();
        await loadDashboard();
    } catch (err) {
        toast(err.message, 'error');
    }

    // حلقه نمایش زنده تایمر (هر یک ثانیه)
    setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', init);
