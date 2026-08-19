import os
import webbrowser
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

load_dotenv()

from core import db
from api.routes import router

BASE_DIR = Path(__file__).parent
CONFIG_PATH = BASE_DIR / "config.json"

scheduler = BackgroundScheduler(timezone="America/New_York")


def _get_schedule():
    """Read schedule time from config, default 9:35 AM ET."""
    if CONFIG_PATH.exists():
        import json
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
        return cfg.get("schedule_hour", 9), cfg.get("schedule_minute", 35)
    return 9, 35


def start_scheduler():
    from core.scheduler import run_daily_session, run_close_session
    hour, minute = _get_schedule()
    scheduler.add_job(
        run_daily_session,
        trigger=CronTrigger(day_of_week="mon-fri", hour=hour, minute=minute),
        id="daily_session",
        replace_existing=True,
    )
    scheduler.add_job(
        run_close_session,
        trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=5),
        id="close_session",
        replace_existing=True,
    )
    scheduler.start()
    print(f"Scheduler started — daily session at {hour:02d}:{minute:02d} ET, close synthesis at 16:05 ET (Mon-Fri)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    start_scheduler()
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(title="AI Portfolio Manager", lifespan=lifespan)

app.include_router(router)
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "frontend" / "static")), name="static")
app.mount("/frontend", StaticFiles(directory=str(BASE_DIR / "frontend")), name="frontend")


if __name__ == "__main__":
    import uvicorn
    port = 8000
    print(f"Starting AI Portfolio Manager at http://localhost:{port}")
    webbrowser.open(f"http://localhost:{port}")
    uvicorn.run("main:app", host="127.0.0.1", port=port, reload=False)
