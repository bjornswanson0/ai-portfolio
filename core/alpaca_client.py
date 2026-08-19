import os
import json
from datetime import datetime, timedelta, timezone
from statistics import mean

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, NewsRequest
from alpaca.data.timeframe import TimeFrame


def _get_keys():
    cfg_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
    mode = "paper"
    if os.path.exists(cfg_path):
        with open(cfg_path) as f:
            mode = json.load(f).get("mode", "paper")
    if mode == "live":
        return os.getenv("ALPACA_LIVE_KEY"), os.getenv("ALPACA_LIVE_SECRET"), False
    return os.getenv("ALPACA_PAPER_KEY"), os.getenv("ALPACA_PAPER_SECRET"), True


def _trading_client():
    key, secret, paper = _get_keys()
    return TradingClient(key, secret, paper=paper)


def _data_client():
    key, secret, _ = _get_keys()
    return StockHistoricalDataClient(key, secret)


def get_portfolio_state():
    tc = _trading_client()
    account = tc.get_account()
    positions = tc.get_all_positions()

    pos_list = []
    for p in positions:
        pos_list.append({
            "symbol": p.symbol,
            "qty": float(p.qty),
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price),
            "market_value": float(p.market_value),
            "unrealized_pnl": float(p.unrealized_pl),
            "unrealized_pnl_pct": float(p.unrealized_plpc) * 100,
            "days_held": 0,
        })

    return {
        "cash": float(account.cash),
        "total_value": float(account.portfolio_value),
        "total_unrealized_pnl": sum(p["unrealized_pnl"] for p in pos_list),
        "positions": pos_list,
    }


def get_market_data(symbols: list, lookback_days: int = 30):
    if not symbols:
        return {}

    dc = _data_client()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=lookback_days + 10)  # buffer for weekends

    req = StockBarsRequest(
        symbol_or_symbols=symbols,
        timeframe=TimeFrame.Day,
        start=start,
        end=end,
        limit=lookback_days + 10,
    )
    bars_resp = dc.get_stock_bars(req)

    result = {}
    for symbol in symbols:
        try:
            bars = bars_resp[symbol]
            if not bars:
                continue
            closes = [float(b.close) for b in bars]
            volumes = [float(b.volume) for b in bars]

            current = closes[-1]
            avg_vol = mean(volumes) if volumes else 0
            sma_20 = mean(closes[-20:]) if len(closes) >= 20 else mean(closes)
            sma_50 = mean(closes[-50:]) if len(closes) >= 50 else mean(closes)

            result[symbol] = {
                "current_price": current,
                "pct_change_1d": ((current - closes[-2]) / closes[-2] * 100) if len(closes) >= 2 else 0,
                "pct_change_5d": ((current - closes[-6]) / closes[-6] * 100) if len(closes) >= 6 else 0,
                "pct_change_30d": ((current - closes[0]) / closes[0] * 100) if closes else 0,
                "volume_today": volumes[-1] if volumes else 0,
                "avg_volume_30d": avg_vol,
                "sma_20": round(sma_20, 2),
                "sma_50": round(sma_50, 2),
                "52w_high": max(closes),
                "52w_low": min(closes),
            }
        except Exception:
            continue

    return result


def get_news(symbols: list, max_articles: int = 5):
    if not symbols:
        return []

    dc = _data_client()
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=3)

    req = NewsRequest(
        symbols=symbols,
        start=start,
        end=end,
        limit=max_articles * len(symbols),
    )
    news_resp = dc.get_news(req)

    articles = []
    for item in news_resp:
        for sym in (item.symbols or []):
            if sym in symbols:
                articles.append({
                    "symbol": sym,
                    "headline": item.headline,
                    "summary": item.summary or "",
                    "published_at": item.created_at.isoformat() if item.created_at else "",
                    "source": getattr(item, "source", "") or "",
                    "url": getattr(item, "url", "") or "",
                })
                break

    return articles[:max_articles * len(symbols)]


def place_order(symbol: str, side: str, reason: str,
                notional: float = None, qty: float = None):
    tc = _trading_client()
    order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL

    req_kwargs = dict(
        symbol=symbol,
        side=order_side,
        time_in_force=TimeInForce.DAY,
        type="market",
    )
    if notional is not None:
        req_kwargs["notional"] = round(notional, 2)
    elif qty is not None:
        req_kwargs["qty"] = qty
    else:
        raise ValueError("Either notional or qty must be provided")

    req = MarketOrderRequest(**req_kwargs)
    order = tc.submit_order(req)

    return {
        "order_id": str(order.id),
        "status": str(order.status),
        "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None,
        "filled_qty": float(order.filled_qty) if order.filled_qty else None,
    }


def get_market_context() -> dict:
    import yfinance as yf
    from statistics import mean

    result = {}
    try:
        vix = yf.Ticker("^VIX")
        vix_hist = vix.history(period="5d")
        if not vix_hist.empty:
            vix_level = float(vix_hist["Close"].iloc[-1])
            if vix_level < 15:
                vix_regime = "low fear — market is calm and complacent"
            elif vix_level < 20:
                vix_regime = "normal — typical market conditions"
            elif vix_level < 30:
                vix_regime = "elevated fear — consider smaller position sizes"
            else:
                vix_regime = "high fear / panic — avoid new buys, protect capital"
            result["vix"] = {
                "level": round(vix_level, 2),
                "regime": vix_regime,
                "5d_ago": round(float(vix_hist["Close"].iloc[0]), 2),
                "trend": "rising" if vix_level > float(vix_hist["Close"].iloc[0]) else "falling",
            }
    except Exception as e:
        result["vix"] = {"error": str(e)}

    for ticker_sym, label in [("^GSPC", "sp500"), ("QQQ", "nasdaq_qqq")]:
        try:
            t = yf.Ticker(ticker_sym)
            hist = t.history(period="30d")
            if not hist.empty:
                closes = list(hist["Close"])
                current = closes[-1]
                sma20 = mean(closes[-20:]) if len(closes) >= 20 else mean(closes)
                ret_5d = (current - closes[-6]) / closes[-6] * 100 if len(closes) >= 6 else 0
                ret_20d = (current - closes[0]) / closes[0] * 100
                result[label] = {
                    "current": round(current, 2),
                    "sma_20": round(sma20, 2),
                    "above_sma20": current > sma20,
                    "trend": "uptrend" if current > sma20 else "downtrend",
                    "return_5d_pct": round(ret_5d, 2),
                    "return_20d_pct": round(ret_20d, 2),
                }
        except Exception as e:
            result[label] = {"error": str(e)}

    # Overall market regime summary
    try:
        vix_ok = result.get("vix", {}).get("level", 25) < 25
        sp_up = result.get("sp500", {}).get("above_sma20", False)
        if vix_ok and sp_up:
            result["regime_summary"] = "FAVORABLE — low fear, market in uptrend. Normal position sizing."
        elif vix_ok and not sp_up:
            result["regime_summary"] = "CAUTIOUS — fear is low but market is below trend. Reduce new buys."
        elif not vix_ok and sp_up:
            result["regime_summary"] = "MIXED — fear elevated but market holding. Smaller sizes, tight stops."
        else:
            result["regime_summary"] = "DEFENSIVE — high fear and downtrend. Sit on cash, do not buy."
    except Exception:
        pass

    return result


def search_web(query: str, max_results: int = 5) -> list:
    from duckduckgo_search import DDGS
    results = []
    with DDGS() as ddgs:
        for r in ddgs.text(query, max_results=max_results):
            results.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "snippet": r.get("body", ""),
            })
    return results


def get_fundamentals(symbols: list) -> dict:
    import yfinance as yf
    result = {}
    for symbol in symbols:
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.info
            cal = ticker.calendar

            next_earnings = None
            if cal is not None and not cal.empty:
                try:
                    next_earnings = str(cal.columns[0].date()) if hasattr(cal.columns[0], 'date') else str(cal.columns[0])
                except Exception:
                    pass

            result[symbol] = {
                "company_name": info.get("longName", symbol),
                "market_cap": info.get("marketCap"),
                "pe_trailing": info.get("trailingPE"),
                "pe_forward": info.get("forwardPE"),
                "analyst_target": info.get("targetMeanPrice"),
                "analyst_recommendation": info.get("recommendationKey", "n/a"),
                "analyst_count": info.get("numberOfAnalystOpinions"),
                "revenue_growth": info.get("revenueGrowth"),
                "earnings_growth": info.get("earningsGrowth"),
                "profit_margin": info.get("profitMargins"),
                "debt_to_equity": info.get("debtToEquity"),
                "next_earnings_date": next_earnings,
                "52w_high": info.get("fiftyTwoWeekHigh"),
                "52w_low": info.get("fiftyTwoWeekLow"),
                "sector": info.get("sector"),
                "industry": info.get("industry"),
            }
        except Exception as e:
            result[symbol] = {"error": str(e)}
    return result


def get_live_positions():
    """Returns positions formatted for the dashboard."""
    tc = _trading_client()
    account = tc.get_account()
    positions = tc.get_all_positions()

    pos_list = []
    for p in positions:
        pos_list.append({
            "symbol": p.symbol,
            "qty": float(p.qty),
            "avg_entry_price": float(p.avg_entry_price),
            "current_price": float(p.current_price),
            "market_value": float(p.market_value),
            "unrealized_pnl": float(p.unrealized_pl),
            "unrealized_pnl_pct": round(float(p.unrealized_plpc) * 100, 2),
            "change_today": float(p.change_today) if p.change_today else 0,
        })

    return {
        "cash": float(account.cash),
        "portfolio_value": float(account.portfolio_value),
        "last_equity": float(account.last_equity) if account.last_equity else float(account.portfolio_value),
        "positions": pos_list,
    }
