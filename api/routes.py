import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from core import db, alpaca_client, scheduler

router = APIRouter()

BASE_DIR = Path(__file__).parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
CONFIG_PATH = BASE_DIR / "config.json"
ENV_PATH = BASE_DIR / ".env"


# ── Config ──────────────────────────────────────────────────────────────

class ConfigPayload(BaseModel):
    alpaca_paper_key: str = ""
    alpaca_paper_secret: str = ""
    alpaca_live_key: str = ""
    alpaca_live_secret: str = ""
    anthropic_api_key: str = ""
    smtp_host: str = "smtp.gmail.com"
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    report_to: str = ""
    mode: str = "paper"
    risk_tolerance: str = "moderate"
    sectors: list = []
    watchlist: list = []
    max_portfolio_value: float = 10000
    max_position_pct: float = 20
    max_positions: int = 8
    schedule_hour: int = 9
    schedule_minute: int = 35


@router.get("/")
def root():
    if not CONFIG_PATH.exists():
        return FileResponse(FRONTEND_DIR / "onboarding.html")
    return FileResponse(FRONTEND_DIR / "index.html")


@router.get("/api/config")
def get_config():
    if not CONFIG_PATH.exists():
        return {}
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    # Redact secrets
    for key in ["alpaca_paper_key", "alpaca_paper_secret", "alpaca_live_key",
                 "alpaca_live_secret", "anthropic_api_key", "smtp_password"]:
        if key in cfg:
            cfg[key] = "***"
    return cfg


@router.post("/api/config")
def save_config(payload: ConfigPayload):
    cfg_data = payload.model_dump()

    # Write secrets to .env
    env_lines = [
        f"ALPACA_PAPER_KEY={cfg_data.pop('alpaca_paper_key')}",
        f"ALPACA_PAPER_SECRET={cfg_data.pop('alpaca_paper_secret')}",
        f"ALPACA_LIVE_KEY={cfg_data.pop('alpaca_live_key')}",
        f"ALPACA_LIVE_SECRET={cfg_data.pop('alpaca_live_secret')}",
        f"ANTHROPIC_API_KEY={cfg_data.pop('anthropic_api_key')}",
        f"SMTP_HOST={cfg_data.pop('smtp_host')}",
        f"SMTP_PORT={cfg_data.pop('smtp_port')}",
        f"SMTP_USER={cfg_data.pop('smtp_user')}",
        f"SMTP_PASSWORD={cfg_data.pop('smtp_password')}",
        f"REPORT_TO={cfg_data.pop('report_to')}",
    ]
    ENV_PATH.write_text("\n".join(env_lines))

    # Reload env vars immediately
    from dotenv import load_dotenv
    load_dotenv(ENV_PATH, override=True)

    # Write non-secret config
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg_data, f, indent=2)

    return {"ok": True}


# ── Portfolio ────────────────────────────────────────────────────────────

@router.get("/api/portfolio")
def get_portfolio():
    try:
        return alpaca_client.get_live_positions()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Decisions ────────────────────────────────────────────────────────────

@router.get("/api/decisions")
def get_decisions(limit: int = 30, offset: int = 0):
    rows = db.get_decisions(limit=limit, offset=offset)
    # Attach orders to each decision
    for row in rows:
        row["orders"] = db.get_decision_orders(row["id"])
    return rows


# ── Snapshots ────────────────────────────────────────────────────────────

@router.get("/api/snapshots")
def get_snapshots(limit: int = 30):
    rows = db.get_snapshots(limit=limit)
    # Parse positions JSON
    for row in rows:
        if row.get("positions_json"):
            try:
                row["positions"] = json.loads(row["positions_json"])
            except Exception:
                row["positions"] = []
        del row["positions_json"]
    return rows


# ── Manual trigger ───────────────────────────────────────────────────────

@router.post("/api/run-now")
def run_now():
    import traceback
    try:
        result = scheduler.run_daily_session()
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/run-close-now")
def run_close_now():
    import traceback
    try:
        result = scheduler.run_close_session()
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/close-synthesis")
def get_close_synthesis():
    row = db.get_latest_close_synthesis()
    return row or {}


# ── User directive ───────────────────────────────────────────────────────

class DirectivePayload(BaseModel):
    text: str = ""

@router.post("/api/directive")
def set_directive(payload: DirectivePayload):
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="No config found")
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    cfg["user_directive"] = payload.text.strip()
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"user_directive": cfg["user_directive"]}

@router.delete("/api/directive")
def clear_directive():
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="No config found")
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    cfg.pop("user_directive", None)
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"user_directive": ""}

@router.get("/api/directive")
def get_directive():
    if not CONFIG_PATH.exists():
        return {"user_directive": ""}
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    return {"user_directive": cfg.get("user_directive", "") or ""}


# ── Watchlist management ─────────────────────────────────────────────────

class TickerPayload(BaseModel):
    symbol: str

@router.post("/api/watchlist/add")
def add_ticker(payload: TickerPayload):
    symbol = payload.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol required")
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="No config found")
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    watchlist = cfg.get("watchlist", [])
    if symbol not in watchlist:
        watchlist.append(symbol)
        cfg["watchlist"] = watchlist
        with open(CONFIG_PATH, "w") as f:
            json.dump(cfg, f, indent=2)
    return {"watchlist": watchlist}

@router.delete("/api/watchlist/{symbol}")
def remove_ticker(symbol: str):
    symbol = symbol.strip().upper()
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="No config found")
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    watchlist = [s for s in cfg.get("watchlist", []) if s != symbol]
    cfg["watchlist"] = watchlist
    with open(CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    return {"watchlist": watchlist}

@router.get("/api/watchlist")
def get_watchlist():
    if not CONFIG_PATH.exists():
        return {"watchlist": []}
    with open(CONFIG_PATH) as f:
        cfg = json.load(f)
    return {"watchlist": cfg.get("watchlist", [])}


# ── Watchlist generation ─────────────────────────────────────────────────

class WatchlistProfilePayload(BaseModel):
    products_used: str = ""
    trends_excited: str = ""
    avoid: str = ""
    other: str = ""
    risk_tolerance: str = "moderate"
    sectors: list = []


@router.post("/api/generate-watchlist")
def generate_watchlist(payload: WatchlistProfilePayload):
    import traceback
    import anthropic

    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        # Try reading from .env file directly
        if ENV_PATH.exists():
            from dotenv import load_dotenv
            load_dotenv(ENV_PATH, override=True)
            api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=400, detail="Anthropic API key not configured")

    sectors_str = ", ".join(payload.sectors) if payload.sectors else "any"

    prompt = f"""You are a financial advisor building a personalized stock watchlist for a new investor.

Based on the investor's profile below, recommend exactly 20 stocks for their watchlist.

INVESTOR PROFILE:
- Products/services they use or love: {payload.products_used or "not specified"}
- Trends/themes that excite them: {payload.trends_excited or "not specified"}
- Things they want to avoid: {payload.avoid or "nothing specified"}
- Other notes: {payload.other or "none"}
- Risk tolerance: {payload.risk_tolerance}
- Preferred sectors: {sectors_str}

RULES:
- Only recommend real, publicly traded US stocks (NYSE or NASDAQ)
- Mix: ~12 "core" picks (established companies, lower risk) and ~8 "speculative" picks (higher growth potential, more volatile)
- Each pick must connect directly to something the investor said — don't add generic filler
- If they said to avoid something, honor it strictly
- Keep tickers to well-known names they can understand, not obscure micro-caps

Respond ONLY with a JSON array, no other text. Each item:
{{
  "symbol": "TICKER",
  "name": "Company Name",
  "tier": "core" or "speculative",
  "reason": "One sentence connecting this pick to something specific the investor said about themselves"
}}"""

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        picks = json.loads(raw.strip())
        return {"picks": picks}
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Market context ───────────────────────────────────────────────────────

@router.get("/api/market-context")
def get_market_context():
    try:
        return alpaca_client.get_market_context()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Sparklines ───────────────────────────────────────────────────────────

@router.get("/api/sparklines")
def get_sparklines(symbols: str = "", period: str = "7d"):
    import yfinance as yf
    import math
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        return {}
    allowed = {"1d", "5d", "7d", "1mo", "3mo", "6mo", "1y", "2y", "5y"}
    safe_period = period if period in allowed else "7d"
    result = {}
    try:
        raw = yf.download(syms, period=safe_period, interval="1d",
                          auto_adjust=True, progress=False, threads=True)
        close = raw["Close"] if "Close" in raw else raw
        if len(syms) == 1:
            vals = close.dropna().tolist()
            result[syms[0]] = [round(v, 4) for v in vals]
        else:
            for sym in syms:
                try:
                    vals = close[sym].dropna().tolist()
                    result[sym] = [round(v, 4) for v in vals if not math.isnan(v)]
                except Exception:
                    result[sym] = []
    except Exception:
        for sym in syms:
            result[sym] = []
    return result


# ── Fundamentals ─────────────────────────────────────────────────────────

@router.get("/api/fundamentals/{symbol}")
def get_fundamentals(symbol: str):
    try:
        data = alpaca_client.get_fundamentals([symbol.upper()])
        return data.get(symbol.upper(), {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── News ─────────────────────────────────────────────────────────────────

@router.get("/api/news")
def get_news_multi(symbols: str, limit: int = 3):
    """Fetch news for comma-separated symbols, e.g. ?symbols=AAPL,MSFT"""
    try:
        syms = [s.strip().upper() for s in symbols.split(',') if s.strip()]
        if not syms:
            return []
        articles = alpaca_client.get_news(syms, max_articles=limit * len(syms))
        return articles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/api/news/{symbol}")
def get_news(symbol: str, limit: int = 5):
    try:
        articles = alpaca_client.get_news([symbol.upper()], max_articles=limit)
        return articles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── PWA assets ───────────────────────────────────────────────────────────

@router.get("/sw.js")
def service_worker():
    return FileResponse(FRONTEND_DIR / "static/sw.js", media_type="application/javascript")

@router.get("/manifest.json")
def manifest():
    return FileResponse(FRONTEND_DIR / "static/manifest.json", media_type="application/manifest+json")


# ── Onboarding redirect helper ───────────────────────────────────────────

@router.get("/onboarding")
def onboarding():
    return FileResponse(FRONTEND_DIR / "onboarding.html")
