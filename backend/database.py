"""
database.py
------------------------------------------------------------------
لایه دسترسی به داده (Data Access Layer) برای وب‌اپلیکیشن My Planner.

مسئولیت این فایل:
    - ساخت و آماده‌سازی دیتابیس SQLite در اولین اجرا
    - تعریف جدول‌ها (categories و tasks)
    - انجام تمام عملیات خواندن/نوشتن (CRUD) روی دیتابیس
    - محاسبه گزارش‌های روزانه و هفتگی

نکته آموزشی:
    این فایل هیچ ارتباطی با HTTP و وب ندارد. فقط «داده» را مدیریت می‌کند.
    فایل main.py از توابع همین فایل استفاده می‌کند تا به داده دسترسی پیدا کند.
    این جداسازی باعث می‌شود منطق دیتابیس و منطق وب با هم قاطی نشوند.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta, date as date_cls
from pathlib import Path
from typing import Any, Iterator, Optional

# ------------------------------------------------------------------
# مسیر دیتابیس
# ------------------------------------------------------------------
# از __file__ استفاده می‌کنیم تا مسیر دیتابیس نسبت به محل خود فایل محاسبه شود،
# نه نسبت به پوشه‌ای که دستور اجرا از آن زده شده است. این کار باعث می‌شود
# پروژه از هر مسیری که اجرا شود، دیتابیس درست را پیدا کند.
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "planner.db"

# وضعیت‌های مجاز یک فعالیت
STATUSES = ("todo", "in_progress", "done")

# دسته‌بندی‌های پیش‌فرض که فقط بار اول (وقتی جدول خالی است) ساخته می‌شوند
DEFAULT_CATEGORIES = [
    ("برنامه‌نویسی", "#6366f1", "💻"),
    ("زبان انگلیسی", "#06b6d4", "🗣️"),
    ("هوش مصنوعی", "#a855f7", "🤖"),
    ("مطالعه", "#f59e0b", "📚"),
    ("ورزش", "#22c55e", "🏃"),
    ("کارهای شخصی", "#ef4444", "🏠"),
    ("دوره آموزشی", "#ec4899", "🎓"),
]


# ------------------------------------------------------------------
# ابزارهای کمکی زمان
# ------------------------------------------------------------------
def utcnow() -> datetime:
    """زمان فعلی به وقت جهانی (UTC). همه زمان‌ها در دیتابیس به UTC ذخیره می‌شوند."""
    return datetime.now(timezone.utc)


def now_iso() -> str:
    """زمان فعلی به صورت متن استاندارد ISO (قابل ذخیره در دیتابیس)."""
    return utcnow().isoformat()


def _parse_iso(value: str) -> datetime:
    """تبدیل متن ISO ذخیره‌شده به شیء datetime."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


# ------------------------------------------------------------------
# اتصال به دیتابیس
# ------------------------------------------------------------------
@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """
    یک اتصال تازه به دیتابیس می‌سازد و در پایان به‌صورت خودکار می‌بندد.
    از context manager (with) استفاده می‌کنیم تا اتصال‌ها قطعاً بسته شوند.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # نتیجه‌ها مثل دیکشنری خوانده می‌شوند
    conn.execute("PRAGMA foreign_keys = ON")  # فعال‌کردن کلیدهای خارجی
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ------------------------------------------------------------------
# ساخت جدول‌ها
# ------------------------------------------------------------------
def init_db() -> None:
    """
    جدول‌ها را در صورت نبودن می‌سازد و دسته‌بندی‌های پیش‌فرض را اضافه می‌کند.
    این تابع در شروع برنامه فراخوانی می‌شود؛ بنابراین کاربر نیازی به
    ساختن دستی دیتابیس ندارد.
    """
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT    NOT NULL UNIQUE,
                color      TEXT    NOT NULL DEFAULT '#6366f1',
                icon       TEXT    NOT NULL DEFAULT '📌',
                created_at TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tasks (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                title             TEXT    NOT NULL,
                description       TEXT    DEFAULT '',
                category_id       INTEGER,
                planned_date      TEXT    NOT NULL,
                planned_start     TEXT,
                planned_minutes   INTEGER NOT NULL DEFAULT 0,
                status            TEXT    NOT NULL DEFAULT 'todo',
                actual_seconds    INTEGER NOT NULL DEFAULT 0,
                timer_started_at  TEXT,
                achievement       TEXT    DEFAULT '',
                created_at        TEXT    NOT NULL,
                updated_at        TEXT    NOT NULL,
                completed_at      TEXT,
                FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks (planned_date);
            CREATE INDEX IF NOT EXISTS idx_tasks_category     ON tasks (category_id);
            """
        )

        # اگر هیچ دسته‌بندی‌ای وجود نداشت، دسته‌بندی‌های پیش‌فرض را اضافه کن
        count = conn.execute("SELECT COUNT(*) AS n FROM categories").fetchone()["n"]
        if count == 0:
            stamp = now_iso()
            conn.executemany(
                "INSERT INTO categories (name, color, icon, created_at) VALUES (?, ?, ?, ?)",
                [(name, color, icon, stamp) for name, color, icon in DEFAULT_CATEGORIES],
            )


# ------------------------------------------------------------------
# دسته‌بندی‌ها (Categories)
# ------------------------------------------------------------------
def list_categories() -> list[dict[str, Any]]:
    """فهرست همه دسته‌بندی‌ها به‌همراه تعداد فعالیت‌های هر کدام."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT c.*, COUNT(t.id) AS task_count
            FROM categories c
            LEFT JOIN tasks t ON t.category_id = c.id
            GROUP BY c.id
            ORDER BY c.name COLLATE NOCASE
            """
        ).fetchall()
        return [dict(r) for r in rows]


def create_category(name: str, color: str, icon: str) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO categories (name, color, icon, created_at) VALUES (?, ?, ?, ?)",
            (name.strip(), color, icon, now_iso()),
        )
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)


def update_category(category_id: int, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    allowed = {"name", "color", "icon"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return get_category(category_id)
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM categories WHERE id = ?", (category_id,)).fetchone()
        if not exists:
            return None
        columns = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE categories SET {columns} WHERE id = ?",
            (*updates.values(), category_id),
        )
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        return dict(row)


def get_category(category_id: int) -> Optional[dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
        return dict(row) if row else None


def delete_category(category_id: int) -> bool:
    """حذف دسته‌بندی. فعالیت‌های آن حذف نمی‌شوند و بدون دسته باقی می‌مانند."""
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM categories WHERE id = ?", (category_id,))
        return cur.rowcount > 0


# ------------------------------------------------------------------
# فعالیت‌ها (Tasks)
# ------------------------------------------------------------------
TASK_SELECT = """
    SELECT
        t.*,
        c.name  AS category_name,
        c.color AS category_color,
        c.icon  AS category_icon
    FROM tasks t
    LEFT JOIN categories c ON c.id = t.category_id
"""


def serialize_task(row: sqlite3.Row, now: Optional[datetime] = None) -> dict[str, Any]:
    """
    یک ردیف دیتابیس را به دیکشنری قابل ارسال به فرانت‌اند تبدیل می‌کند و
    مقادیر محاسباتی (زمان سپری‌شده و وضعیت تایمر) را اضافه می‌کند.
    """
    now = now or utcnow()
    data = dict(row)
    elapsed = data.get("actual_seconds") or 0
    running = bool(data.get("timer_started_at"))
    if running:
        elapsed += max(0, int((now - _parse_iso(data["timer_started_at"])).total_seconds()))
    data["is_running"] = running
    data["elapsed_seconds"] = elapsed
    data["planned_seconds"] = (data.get("planned_minutes") or 0) * 60
    return data


def list_tasks(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    category_id: Optional[int] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
) -> list[dict[str, Any]]:
    """فهرست فعالیت‌ها با امکان فیلتر بر اساس بازه تاریخ، دسته‌بندی، وضعیت و جستجو."""
    clauses: list[str] = []
    params: list[Any] = []

    if date_from:
        clauses.append("t.planned_date >= ?")
        params.append(date_from)
    if date_to:
        clauses.append("t.planned_date <= ?")
        params.append(date_to)
    if category_id:
        clauses.append("t.category_id = ?")
        params.append(category_id)
    if status:
        clauses.append("t.status = ?")
        params.append(status)
    if search:
        clauses.append("(t.title LIKE ? OR t.description LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    sql = f"{TASK_SELECT} {where} ORDER BY t.planned_date DESC, t.planned_start IS NULL, t.planned_start ASC, t.id DESC"

    now = utcnow()
    with get_connection() as conn:
        rows = conn.execute(sql, params).fetchall()
        return [serialize_task(r, now) for r in rows]


def get_task(task_id: int) -> Optional[dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(f"{TASK_SELECT} WHERE t.id = ?", (task_id,)).fetchone()
        return serialize_task(row) if row else None


def get_running_task() -> Optional[dict[str, Any]]:
    """فعالیتی که در این لحظه تایمرش روشن است (اگر وجود داشته باشد)."""
    with get_connection() as conn:
        row = conn.execute(
            f"{TASK_SELECT} WHERE t.timer_started_at IS NOT NULL LIMIT 1"
        ).fetchone()
        return serialize_task(row) if row else None


def create_task(fields: dict[str, Any]) -> dict[str, Any]:
    stamp = now_iso()
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO tasks
                (title, description, category_id, planned_date, planned_start,
                 planned_minutes, status, achievement, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                fields["title"].strip(),
                (fields.get("description") or "").strip(),
                fields.get("category_id"),
                fields["planned_date"],
                fields.get("planned_start"),
                int(fields.get("planned_minutes") or 0),
                fields.get("status") or "todo",
                (fields.get("achievement") or "").strip(),
                stamp,
                stamp,
            ),
        )
        task_id = cur.lastrowid
    return get_task(task_id)  # type: ignore[return-value]


def update_task(task_id: int, fields: dict[str, Any]) -> Optional[dict[str, Any]]:
    allowed = {
        "title", "description", "category_id", "planned_date",
        "planned_start", "planned_minutes", "status", "achievement",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_task(task_id)

    if "title" in updates and updates["title"] is not None:
        updates["title"] = updates["title"].strip()
    if "planned_minutes" in updates and updates["planned_minutes"] is not None:
        updates["planned_minutes"] = int(updates["planned_minutes"])

    # اگر وضعیت به «انجام‌شده» تغییر کند، زمان اتمام را ثبت می‌کنیم
    if updates.get("status") == "done":
        updates["completed_at"] = now_iso()
    elif "status" in updates:
        updates["completed_at"] = None

    updates["updated_at"] = now_iso()

    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not exists:
            return None
        columns = ", ".join(f"{k} = ?" for k in updates)
        conn.execute(
            f"UPDATE tasks SET {columns} WHERE id = ?",
            (*updates.values(), task_id),
        )
    return get_task(task_id)


def delete_task(task_id: int) -> bool:
    with get_connection() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return cur.rowcount > 0


# ------------------------------------------------------------------
# وضعیت و تایمر
# ------------------------------------------------------------------
def set_status(task_id: int, status: str) -> Optional[dict[str, Any]]:
    if status not in STATUSES:
        raise ValueError("وضعیت نامعتبر است")
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        if status == "done":
            # اگر تایمر روشن بود، ابتدا آن را متوقف کن
            if row["timer_started_at"]:
                elapsed = int((utcnow() - _parse_iso(row["timer_started_at"])).total_seconds())
                conn.execute(
                    "UPDATE tasks SET actual_seconds = actual_seconds + ?, timer_started_at = NULL WHERE id = ?",
                    (max(0, elapsed), task_id),
                )
            conn.execute(
                "UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?",
                (status, now_iso(), now_iso(), task_id),
            )
        else:
            conn.execute(
                "UPDATE tasks SET status = ?, completed_at = NULL, updated_at = ? WHERE id = ?",
                (status, now_iso(), task_id),
            )
    return get_task(task_id)


def start_timer(task_id: int) -> Optional[dict[str, Any]]:
    """
    تایمر یک فعالیت را روشن می‌کند.
    برای جلوگیری از ثبت هم‌زمان و اشتباه، هر تایمر دیگری که روشن باشد
    ابتدا متوقف می‌شود (فقط یک تایمر فعال در هر لحظه).
    """
    now = utcnow()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None

        # متوقف‌کردن تایمرهای دیگر
        running = conn.execute(
            "SELECT id, timer_started_at FROM tasks WHERE timer_started_at IS NOT NULL"
        ).fetchall()
        for r in running:
            if r["id"] == task_id:
                continue
            elapsed = int((now - _parse_iso(r["timer_started_at"])).total_seconds())
            conn.execute(
                "UPDATE tasks SET actual_seconds = actual_seconds + ?, timer_started_at = NULL, updated_at = ? WHERE id = ?",
                (max(0, elapsed), now_iso(), r["id"]),
            )

        conn.execute(
            "UPDATE tasks SET timer_started_at = ?, status = 'in_progress', updated_at = ? WHERE id = ?",
            (now.isoformat(), now_iso(), task_id),
        )
    return get_task(task_id)


def stop_timer(task_id: int) -> Optional[dict[str, Any]]:
    """تایمر را متوقف و زمان سپری‌شده را به زمان واقعی فعالیت اضافه می‌کند."""
    now = utcnow()
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            return None
        if row["timer_started_at"]:
            elapsed = int((now - _parse_iso(row["timer_started_at"])).total_seconds())
            conn.execute(
                "UPDATE tasks SET actual_seconds = actual_seconds + ?, timer_started_at = NULL, updated_at = ? WHERE id = ?",
                (max(0, elapsed), now_iso(), task_id),
            )
    return get_task(task_id)


def reset_timer(task_id: int) -> Optional[dict[str, Any]]:
    """زمان واقعی ثبت‌شده را صفر می‌کند و تایمر را خاموش می‌کند."""
    with get_connection() as conn:
        exists = conn.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not exists:
            return None
        conn.execute(
            "UPDATE tasks SET actual_seconds = 0, timer_started_at = NULL, updated_at = ? WHERE id = ?",
            (now_iso(), task_id),
        )
    return get_task(task_id)


# ------------------------------------------------------------------
# گزارش‌ها (Reports)
# ------------------------------------------------------------------
def _summary_for_date(conn: sqlite3.Connection, day: str) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT
            COUNT(*)                                   AS total,
            COALESCE(SUM(status = 'done'), 0)          AS done,
            COALESCE(SUM(status = 'in_progress'), 0)   AS in_progress,
            COALESCE(SUM(status = 'todo'), 0)          AS todo,
            COALESCE(SUM(planned_minutes), 0)          AS planned_minutes,
            COALESCE(SUM(actual_seconds), 0)           AS actual_seconds
        FROM tasks
        WHERE planned_date = ?
        """,
        (day,),
    ).fetchone()
    data = dict(row)
    data["date"] = day
    data["completion_rate"] = round((data["done"] / data["total"] * 100), 1) if data["total"] else 0.0
    return data


def daily_summary(day: str) -> dict[str, Any]:
    with get_connection() as conn:
        return _summary_for_date(conn, day)


def week_start(day: str) -> str:
    """اول هفته (شنبه) را برای یک تاریخ برمی‌گرداند. هفته ایرانی از شنبه شروع می‌شود."""
    d = date_cls.fromisoformat(day)
    # weekday(): دوشنبه = 0 ... یکشنبه = 6 ; شنبه = 5
    days_since_saturday = (d.weekday() - 5) % 7
    return (d - timedelta(days=days_since_saturday)).isoformat()


def weekly_report(start: str) -> dict[str, Any]:
    """گزارش هفت‌روزه از تاریخ شروع داده‌شده (شامل ۷ روز)."""
    start_date = date_cls.fromisoformat(start)
    days = [(start_date + timedelta(days=i)).isoformat() for i in range(7)]
    with get_connection() as conn:
        items = [_summary_for_date(conn, d) for d in days]

    totals = {
        "total": sum(i["total"] for i in items),
        "done": sum(i["done"] for i in items),
        "planned_minutes": sum(i["planned_minutes"] for i in items),
        "actual_seconds": sum(i["actual_seconds"] for i in items),
    }
    totals["completion_rate"] = (
        round(totals["done"] / totals["total"] * 100, 1) if totals["total"] else 0.0
    )
    return {"start": start, "days": items, "totals": totals}


def category_report(date_from: str, date_to: str) -> list[dict[str, Any]]:
    """گزارش تفکیک‌شده بر اساس دسته‌بندی در یک بازه تاریخی."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                c.id          AS category_id,
                c.name        AS name,
                c.color       AS color,
                c.icon        AS icon,
                COUNT(t.id)                              AS total,
                COALESCE(SUM(t.status = 'done'), 0)      AS done,
                COALESCE(SUM(t.planned_minutes), 0)      AS planned_minutes,
                COALESCE(SUM(t.actual_seconds), 0)       AS actual_seconds
            FROM categories c
            LEFT JOIN tasks t
                ON t.category_id = c.id
               AND t.planned_date BETWEEN ? AND ?
            GROUP BY c.id
            ORDER BY actual_seconds DESC, total DESC
            """,
            (date_from, date_to),
        ).fetchall()
        result = [dict(r) for r in rows]

        # فعالیت‌های بدون دسته‌بندی
        uncategorized = conn.execute(
            """
            SELECT
                COUNT(*)                                 AS total,
                COALESCE(SUM(status = 'done'), 0)        AS done,
                COALESCE(SUM(planned_minutes), 0)        AS planned_minutes,
                COALESCE(SUM(actual_seconds), 0)         AS actual_seconds
            FROM tasks
            WHERE category_id IS NULL AND planned_date BETWEEN ? AND ?
            """,
            (date_from, date_to),
        ).fetchone()
        if uncategorized["total"]:
            result.append(
                {
                    "category_id": None,
                    "name": "بدون دسته‌بندی",
                    "color": "#94a3b8",
                    "icon": "📌",
                    **dict(uncategorized),
                }
            )
        return result


def overview(day: str) -> dict[str, Any]:
    """خلاصه‌ای کلی برای صفحه داشبورد: امروز، هفته جاری و تفکیک دسته‌ها."""
    start = week_start(day)
    week = weekly_report(start)
    today = daily_summary(day)
    end = (date_cls.fromisoformat(start) + timedelta(days=6)).isoformat()
    categories = category_report(start, end)
    running = get_running_task()
    return {
        "today": today,
        "week": week,
        "categories": categories,
        "running_task": running,
    }
