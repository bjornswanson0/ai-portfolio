import json
import os
from datetime import date

import anthropic

from core import alpaca_client, db

MODEL = "claude-opus-4-5"
MAX_ITERATIONS = 10

TOOL_DEFINITIONS = [
    {
        "name": "get_portfolio_state",
        "description": "Get current portfolio: cash, total value, all open positions with P&L.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_market_data",
        "description": "Get price, momentum, and volume data for a list of ticker symbols.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}, "description": "Ticker symbols"},
                "lookback_days": {"type": "integer", "default": 30, "description": "Days of history"},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "get_news",
        "description": "Get recent news headlines for a list of ticker symbols.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "max_articles": {"type": "integer", "default": 5},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "get_watchlist",
        "description": "Get user's watchlist, sector preferences, risk tolerance, and position limits.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_recent_decisions",
        "description": "Get the last N days of trades placed, including Claude's reasoning and outcome.",
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "default": 7}},
            "required": [],
        },
    },
    {
        "name": "get_market_context",
        "description": "Get broad market conditions: VIX fear index (level + regime), S&P 500 trend (above/below 20-day SMA), QQQ momentum, and an overall regime summary (favorable/cautious/mixed/defensive).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "search_web",
        "description": "Search the web for breaking news, earnings reactions, analyst upgrades/downgrades, CEO changes, or any real-time information about a stock or market event.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query, e.g. 'NVDA earnings reaction August 2026' or 'Fed rate decision today'"},
                "max_results": {"type": "integer", "default": 5},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_fundamentals",
        "description": "Get fundamentals for a list of tickers: P/E ratio, analyst price target, recommendation, revenue growth, next earnings date, sector, and more.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["symbols"],
        },
    },
    {
        "name": "place_order",
        "description": "Place a market buy or sell order. Requires a plain-English reason.",
        "input_schema": {
            "type": "object",
            "properties": {
                "symbol": {"type": "string"},
                "side": {"type": "string", "enum": ["buy", "sell"]},
                "reason": {"type": "string", "description": "Plain-English rationale. Required."},
                "notional": {"type": "number", "description": "Dollar amount (preferred for buys)"},
                "qty": {"type": "number", "description": "Share count (use for full sells)"},
            },
            "required": ["symbol", "side", "reason"],
        },
    },
]


def _load_config():
    cfg_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
    if not os.path.exists(cfg_path):
        return {}
    with open(cfg_path) as f:
        return json.load(f)


def _dispatch_tool(name: str, inputs: dict, placed_orders: list):
    if name == "get_portfolio_state":
        return alpaca_client.get_portfolio_state()

    if name == "get_market_data":
        return alpaca_client.get_market_data(
            inputs["symbols"],
            inputs.get("lookback_days", 30),
        )

    if name == "get_news":
        return alpaca_client.get_news(
            inputs["symbols"],
            inputs.get("max_articles", 5),
        )

    if name == "get_watchlist":
        cfg = _load_config()
        return {
            "symbols": cfg.get("watchlist", []),
            "sectors": cfg.get("sectors", []),
            "risk_tolerance": cfg.get("risk_tolerance", "moderate"),
            "max_position_pct": cfg.get("max_position_pct", 20) / 100,
            "max_positions": cfg.get("max_positions", 8),
            "max_portfolio_value": cfg.get("max_portfolio_value", 10000),
        }

    if name == "get_recent_decisions":
        days = inputs.get("days", 7)
        rows = db.get_recent_decisions_for_agent(days)
        return rows

    if name == "get_market_context":
        return alpaca_client.get_market_context()

    if name == "search_web":
        return alpaca_client.search_web(
            inputs["query"],
            inputs.get("max_results", 5),
        )

    if name == "get_fundamentals":
        return alpaca_client.get_fundamentals(inputs["symbols"])

    if name == "place_order":
        result = alpaca_client.place_order(
            symbol=inputs["symbol"],
            side=inputs["side"],
            reason=inputs["reason"],
            notional=inputs.get("notional"),
            qty=inputs.get("qty"),
        )
        placed_orders.append({**inputs, **result})
        return result

    return {"error": f"Unknown tool: {name}"}


def _build_system_prompt(cfg: dict) -> str:
    today = date.today().strftime("%A, %B %d, %Y")
    risk = cfg.get("risk_tolerance", "moderate")
    sectors = ", ".join(cfg.get("sectors", [])) or "any"
    max_pos_pct = cfg.get("max_position_pct", 20)
    max_positions = cfg.get("max_positions", 8)
    max_value = cfg.get("max_portfolio_value", 10000)
    mode = cfg.get("mode", "paper")

    return f"""You are an AI portfolio manager running a thematic equity portfolio.

Today is {today}. Mode: {mode.upper()}.

INVESTMENT MANDATE:
- Style: Thematic buy-and-hold. Hold positions for days to weeks, not hours.
- Risk tolerance: {risk}
- Preferred sectors: {sectors}
- Max single position: {max_pos_pct}% of portfolio
- Max open positions: {max_positions}
- Target portfolio size: up to ${max_value:,}

RULES:
1. Only buy from the watchlist. Never buy a symbol not on the watchlist.
2. Every order requires a written reason — be specific about WHY now, not just what.
3. Do not trade for small intraday price moves. You are not a day trader.
4. If the thesis for a position has changed, sell. Otherwise, hold.
5. If unsure, hold. Do not churn.
6. Check recent decisions first — avoid repeating a trade you made in the last week.
7. Respect position size limits. Do not over-concentrate.

PROCESS:
1. Call get_market_context FIRST. If the regime is DEFENSIVE, do not place any new buys — hold cash and report why.
2. Call get_watchlist to understand your constraints.
3. Call get_portfolio_state to see current holdings and cash.
4. Call get_recent_decisions to avoid repeating last week's trades.
5. For each held position: call get_market_data, get_news, and get_fundamentals to evaluate hold/sell.
6. Identify watchlist symbols NOT currently held — screen for opportunities using get_market_data, get_fundamentals, and get_news.
7. Use get_fundamentals to check valuation (P/E vs peers), analyst consensus, and whether earnings are imminent before buying.
8. Use search_web to look up breaking news, earnings reactions, or anything that moved a stock recently. Search before buying any new position.
9. Place orders only when market context, momentum, fundamentals, and news all point in the same direction.
10. When done, provide a concise narrative summary of today's decisions.

Be disciplined. Think like a fund manager, not a gambler.""" + _directive_block(cfg)


def _directive_block(cfg: dict) -> str:
    directive = (cfg.get("user_directive") or "").strip()
    if not directive:
        return ""
    return f"""

OWNER DIRECTIVE (treat with high priority — the portfolio owner left this instruction):
{directive}

Acknowledge this directive in your narrative summary and act on it if market conditions permit."""


CLOSE_TOOL_DEFINITIONS = [t for t in TOOL_DEFINITIONS if t["name"] != "place_order"]


def _build_close_prompt(cfg: dict) -> str:
    today = date.today().strftime("%A, %B %d, %Y")
    risk = cfg.get("risk_tolerance", "moderate")

    return f"""You are an AI portfolio analyst delivering a market-close synthesis.

Today is {today}. The US market has just closed. You are NOT placing any trades.

YOUR JOB — produce a clear, readable synthesis covering exactly these three sections:

1. TODAY'S HIGHLIGHTS
   - Summarize the day's P&L across portfolio positions (use get_portfolio_state)
   - Call out which positions moved the most today and why (use get_news + get_market_data)
   - Note any significant market events or regime shifts (use get_market_context)

2. WATCHLIST OPPORTUNITIES
   - Scan the watchlist for stocks with compelling setups for the NEXT session (use get_watchlist, get_market_data, get_fundamentals, get_news)
   - For each candidate, say specifically what you're watching: a support level, earnings catalyst, oversold bounce, etc.
   - Flag any watchlist names that are currently overextended or should be avoided near-term

3. PORTFOLIO OUTLOOK
   - Any positions worth monitoring overnight (earnings, FDA dates, geopolitical risk)
   - One or two sentences on the overall market posture (risk-on vs defensive)

Risk tolerance: {risk}

Be direct and specific. This is an email digest — every sentence should be useful.
Do not include any "I will now call..." narration. Just call your tools, then write the synthesis."""


def run_close_loop(cfg: dict) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    system_prompt = _build_close_prompt(cfg)
    messages = [{"role": "user", "content": "Please produce today's market-close synthesis."}]
    total_tokens = 0
    iterations = 0

    while iterations < MAX_ITERATIONS:
        iterations += 1
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=system_prompt,
            tools=CLOSE_TOOL_DEFINITIONS,
            messages=messages,
        )
        total_tokens += response.usage.input_tokens + response.usage.output_tokens
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            narrative = " ".join(
                block.text for block in response.content
                if hasattr(block, "text")
            )
            return {"narrative": narrative, "tokens_used": total_tokens}

        if response.stop_reason != "tool_use":
            break

        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                result = _dispatch_tool(block.name, block.input, [])
            except Exception as e:
                result = {"error": str(e)}
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result),
            })

        messages.append({"role": "user", "content": tool_results})

    return {"narrative": "Close synthesis ended without a clean conclusion.", "tokens_used": total_tokens}


def run_agent_loop(cfg: dict) -> dict:
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    system_prompt = _build_system_prompt(cfg)
    messages = [{"role": "user", "content": "Please review the portfolio and make today's trading decisions."}]
    placed_orders = []
    total_tokens = 0
    iterations = 0

    while iterations < MAX_ITERATIONS:
        iterations += 1
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=system_prompt,
            tools=TOOL_DEFINITIONS,
            messages=messages,
        )
        total_tokens += response.usage.input_tokens + response.usage.output_tokens

        # Append assistant turn
        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            # Extract final narrative text
            narrative = " ".join(
                block.text for block in response.content
                if hasattr(block, "text")
            )
            return {
                "narrative": narrative,
                "placed_orders": placed_orders,
                "tokens_used": total_tokens,
            }

        if response.stop_reason != "tool_use":
            break

        # Dispatch all tool calls in this turn
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                result = _dispatch_tool(block.name, block.input, placed_orders)
            except Exception as e:
                result = {"error": str(e)}
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": json.dumps(result),
            })

        messages.append({"role": "user", "content": tool_results})

    return {
        "narrative": "Session ended without a clean conclusion.",
        "placed_orders": placed_orders,
        "tokens_used": total_tokens,
    }
