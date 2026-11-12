"""
main.py
------------------------------------------------------------------
لایه وب و API برای وب‌اپلیکیشن My Planner (با FastAPI).

مسئولیت این فایل:
    - تعریف مسیرهای API (Endpoints) که فرانت‌اند با آن‌ها صحبت می‌کند
    - اعتبارسنجی (Validation) ورودی‌های کاربر
    - تبدیل درخواست‌های HTTP به فراخوانی توابع database.py
    - سرو کردن فایل‌های فرانت‌اند (HTML/CSS/JS) از همان سرور

نکته آموزشی:
    این فایل «مغز» سمت سرور است. مرورگر یک درخواست HTTP می‌فرستد،
    FastAPI آن را به تابع مناسب می‌رساند، تابع از database.py استفاده
    می‌کند و نتیجه به‌صورت JSON برمی‌گردد.

اجرا:
    python backend/main.py
    سپس در مرورگر: http://127.0.0.1:8000
"""

from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from datetime import date as date_cls
from pathlib import Path
from typing import Optional

# مسیر پوشه backend را به sys.path اضافه می‌کنیم تا import database
# از هر مسیری که برنامه اجرا شود، درست کار کند.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# در ویندوز، کنسول ممکن است از انکودینگ cp1252 استفاده کند و چاپ متن فارسی
# باعث خطای UnicodeEncodeError شود. این تنظیم خروجی را به UTF-8 تغییر می‌دهد.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


from fastapi import FastAPI, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402
from pydantic import BaseModel, Field, field_validator  # noqa: E402

import database  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """در شروع برنامه، دیتابیس و جدول‌ها آماده می‌شوند."""
    database.init_db()
    yield


app = FastAPI(
    title="My Planner API",
    description="API برنامه‌ریز شخصی My Planner",
    version="1.0.0",
    lifespan=lifespan,
)

# در حالت توسعه، اجازه دسترسی از مبدأهای محلی را می‌دهیم.
# چون فرانت‌اند از همان سرور سرو می‌شود، در عمل نیازی به این تنظیم نیست؛
# اما برای آزمایش‌های دستی (مثلاً باز کردن فرانت‌اند روی پورت دیگر) مفید است.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ------------------------------------------------------------------
# اعتبارسنجی مشترک
# ------------------------------------------------------------------
def _valid_date(value: str) -> str:
    try:
        date_cls.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(status_code=422, detail="قالب تاریخ نامعتبر است (باید YYYY-MM-DD باشد).")
    return value


def _valid_status(value: str) -> str:
    if value not in database.STATUSES:
        raise HTTPException(status_code=422, detail="وضعیت نامعتبر است.")
    return value


# ------------------------------------------------------------------
# مدل‌های ورودی (Pydantic)
# ------------------------------------------------------------------
class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: str = Field(default="#6366f1", max_length=20)
    icon: str = Field(default="📌", max_length=8)

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("نام دسته‌بندی نمی‌تواند خالی باشد.")
        return v


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=50)
    color: Optional[str] = Field(default=None, max_length=20)
    icon: Optional[str] = Field(default=None, max_length=8)


class TaskIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default="", max_length=2000)
    category_id: Optional[int] = None
    planned_date: str
    planned_start: Optional[str] = Field(default=None, max_length=5)
    planned_minutes: int = Field(default=0, ge=0, le=24 * 60)
    status: str = "todo"
    achievement: Optional[str] = Field(default="", max_length=4000)

    @field_validator("title")
    @classmethod
    def title_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("عنوان فعالیت نمی‌تواند خالی باشد.")
        return v

    @field_validator("planned_date")
    @classmethod
    def check_date(cls, v: str) -> str:
        return _valid_date(v)

    @field_validator("status")
    @classmethod
    def check_status(cls, v: str) -> str:
        return _valid_status(v)


class TaskUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    category_id: Optional[int] = None
    planned_date: Optional[str] = None
    planned_start: Optional[str] = Field(default=None, max_length=5)
    planned_minutes: Optional[int] = Field(default=None, ge=0, le=24 * 60)
    status: Optional[str] = None
    achievement: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("planned_date")
    @classmethod
    def check_date(cls, v: Optional[str]) -> Optional[str]:
        return _valid_date(v) if v else v

    @field_validator("status")
    @classmethod
    def check_status(cls, v: Optional[str]) -> Optional[str]:
        return _valid_status(v) if v else v


class StatusIn(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def check_status(cls, v: str) -> str:
        return _valid_status(v)


# ------------------------------------------------------------------
# سلامت سرویس
# ------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# ------------------------------------------------------------------
# دسته‌بندی‌ها
# ------------------------------------------------------------------
@app.get("/api/categories")
def get_categories() -> list[dict]:
    return database.list_categories()


@app.post("/api/categories", status_code=201)
def post_category(payload: CategoryIn) -> dict:
    try:
        return database.create_category(payload.name, payload.color, payload.icon)
    except Exception:
        raise HTTPException(status_code=409, detail="دسته‌بندی با این نام از قبل وجود دارد.")


@app.put("/api/categories/{category_id}")
def put_category(category_id: int, payload: CategoryUpdate) -> dict:
    result = database.update_category(category_id, payload.model_dump(exclude_unset=True))
    if result is None:
        raise HTTPException(status_code=404, detail="دسته‌بندی یافت نشد.")
    return result


@app.delete("/api/categories/{category_id}")
def remove_category(category_id: int) -> dict:
    if not database.delete_category(category_id):
        raise HTTPException(status_code=404, detail="دسته‌بندی یافت نشد.")
    return {"deleted": True}


# ------------------------------------------------------------------
# فعالیت‌ها
# ------------------------------------------------------------------
@app.get("/api/tasks")
def get_tasks(
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    date: Optional[str] = Query(default=None),
    category_id: Optional[int] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
) -> list[dict]:
    if date:
        _valid_date(date)
        date_from = date_to = date
    if status:
        _valid_status(status)
    return database.list_tasks(
        date_from=date_from,
        date_to=date_to,
        category_id=category_id,
        status=status,
        search=search,
    )


@app.get("/api/tasks/{task_id}")
def get_one_task(task_id: int) -> dict:
    task = database.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return task


@app.post("/api/tasks", status_code=201)
def post_task(payload: TaskIn) -> dict:
    if payload.category_id is not None and not database.get_category(payload.category_id):
        raise HTTPException(status_code=422, detail="دسته‌بندی انتخاب‌شده وجود ندارد.")
    return database.create_task(payload.model_dump())


@app.put("/api/tasks/{task_id}")
def put_task(task_id: int, payload: TaskUpdate) -> dict:
    data = payload.model_dump(exclude_unset=True)
    if data.get("category_id") is not None and not database.get_category(data["category_id"]):
        raise HTTPException(status_code=422, detail="دسته‌بندی انتخاب‌شده وجود ندارد.")
    result = database.update_task(task_id, data)
    if result is None:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return result


@app.delete("/api/tasks/{task_id}")
def remove_task(task_id: int) -> dict:
    if not database.delete_task(task_id):
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return {"deleted": True}


@app.post("/api/tasks/{task_id}/status")
def post_status(task_id: int, payload: StatusIn) -> dict:
    result = database.set_status(task_id, payload.status)
    if result is None:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return result


@app.post("/api/tasks/{task_id}/timer/start")
def post_timer_start(task_id: int) -> dict:
    result = database.start_timer(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return result


@app.post("/api/tasks/{task_id}/timer/stop")
def post_timer_stop(task_id: int) -> dict:
    result = database.stop_timer(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return result


@app.post("/api/tasks/{task_id}/timer/reset")
def post_timer_reset(task_id: int) -> dict:
    result = database.reset_timer(task_id)
    if result is None:
        raise HTTPException(status_code=404, detail="فعالیت یافت نشد.")
    return result


# ------------------------------------------------------------------
# گزارش‌ها
# ------------------------------------------------------------------
@app.get("/api/reports/overview")
def reports_overview(day: Optional[str] = Query(default=None)) -> dict:
    day = _valid_date(day) if day else date_cls.today().isoformat()
    return database.overview(day)


@app.get("/api/reports/daily")
def reports_daily(day: Optional[str] = Query(default=None)) -> dict:
    day = _valid_date(day) if day else date_cls.today().isoformat()
    return database.daily_summary(day)


@app.get("/api/reports/weekly")
def reports_weekly(start: Optional[str] = Query(default=None)) -> dict:
    if start:
        _valid_date(start)
    else:
        start = database.week_start(date_cls.today().isoformat())
    return database.weekly_report(start)


@app.get("/api/reports/categories")
def reports_categories(
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
) -> list[dict]:
    today = date_cls.today().isoformat()
    date_from = _valid_date(date_from) if date_from else database.week_start(today)
    date_to = _valid_date(date_to) if date_to else today
    return database.category_report(date_from, date_to)


# ------------------------------------------------------------------
# مدیریت خطاهای پیش‌بینی‌نشده
# ------------------------------------------------------------------
@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):  # pragma: no cover
    return JSONResponse(status_code=500, content={"detail": f"خطای داخلی سرور: {exc}"})


# ------------------------------------------------------------------
# سرو کردن فایل‌های فرانت‌اند
# ------------------------------------------------------------------
# این Mount باید آخرین مورد باشد تا مسیرهای /api بالاتر از آن بررسی شوند.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    print("My Planner در حال اجراست:  http://127.0.0.1:8000")
    print("برای توقف، کلیدهای Ctrl+C را بزنید.")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
