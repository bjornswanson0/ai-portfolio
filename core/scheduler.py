import json
import os
import time
from datetime import date

from core import agent, db, alpaca_client, email_report


def _load_config():
    cfg_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
    if not os.path.exists(cfg_path):
        return {}
    with open(cfg_path) as f:
        return json.load(f)


def run_daily_session() -> dict:
    start_time = time.time()
    cfg = _load_config()
    today = date.today().isoformat()
    mode = cfg.get("mode", "paper")

    print(f"[{today}] Starting daily session (mode={mode})")

    # Run Claude agent loop
    result = agent.run_agent_loop(cfg)
    narrative = result["narrative"]
    placed_orders = result["placed_orders"]
    tokens_used = result["tokens_used"]
    duration = round(time.time() - start_time, 1)

    # Persist decision
    decision_id = db.insert_decision(today, narrative, tokens_used, duration)

    # Persist orders
    for o in placed_orders:
        db.insert_order(
            decision_id=decision_id,
            symbol=o["symbol"],
            side=o["side"],
            notional=o.get("notional"),
            qty=o.get("qty"),
            reason=o["reason"],
            alpaca_order_id=o.get("order_id"),
            status=o.get("status"),
            filled_avg_price=o.get("filled_avg_price"),
            filled_qty=o.get("filled_qty"),
        )

    # Take portfolio snapshot
    try:
        portfolio_state = alpaca_client.get_portfolio_state()
        db.insert_snapshot(
            today,
            portfolio_state["total_value"],
            portfolio_state["cash"],
            portfolio_state["positions"],
        )
    except Exception as e:
        print(f"Snapshot failed: {e}")
        portfolio_state = {"total_value": 0, "cash": 0, "total_unrealized_pnl": 0, "positions": []}

    # Build and send email
    try:
        html = email_report.build_html_report(
            portfolio_state=portfolio_state,
            placed_orders=placed_orders,
            narrative=narrative,
            mode=mode,
            run_date=today,
        )
        subject = f"Portfolio Report — {today} ({len(placed_orders)} trade{'s' if len(placed_orders) != 1 else ''})"
        email_report.send_report(html, subject)
    except Exception as e:
        print(f"Email failed: {e}")

    print(f"[{today}] Session complete — {len(placed_orders)} orders, {tokens_used} tokens, {duration}s")

    return {
        "run_date": today,
        "orders_placed": len(placed_orders),
        "tokens_used": tokens_used,
        "duration_sec": duration,
        "narrative": narrative,
        "orders": placed_orders,
        "portfolio": portfolio_state,
    }


def run_close_session() -> dict:
    start_time = time.time()
    cfg = _load_config()
    today = date.today().isoformat()
    mode = cfg.get("mode", "paper")

    print(f"[{today}] Starting market-close synthesis (mode={mode})")

    result = agent.run_close_loop(cfg)
    narrative = result["narrative"]
    tokens_used = result["tokens_used"]
    duration = round(time.time() - start_time, 1)

    db.insert_close_synthesis(today, narrative, tokens_used, duration)

    try:
        portfolio_state = alpaca_client.get_portfolio_state()
    except Exception as e:
        print(f"Portfolio fetch failed: {e}")
        portfolio_state = {"total_value": 0, "cash": 0, "total_unrealized_pnl": 0, "positions": []}

    try:
        html = email_report.build_close_report_html(
            portfolio_state=portfolio_state,
            narrative=narrative,
            mode=mode,
            run_date=today,
        )
        total = portfolio_state.get("total_value", 0)
        unrealized = portfolio_state.get("total_unrealized_pnl", 0)
        sign = "+" if unrealized >= 0 else ""
        subject = f"Market Close — {today} · ${total:,.0f} ({sign}{unrealized:+,.0f})"
        email_report.send_report(html, subject)
    except Exception as e:
        print(f"Close email failed: {e}")

    print(f"[{today}] Close synthesis complete — {tokens_used} tokens, {duration}s")

    return {
        "run_date": today,
        "tokens_used": tokens_used,
        "duration_sec": duration,
        "narrative": narrative,
    }
