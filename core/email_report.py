import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def _green(text): return f'<span style="color:#16a34a;font-weight:700">{text}</span>'
def _red(text):   return f'<span style="color:#dc2626;font-weight:700">{text}</span>'

def _fmt_pct(val):
    s = f"+{val:.2f}%" if val >= 0 else f"{val:.2f}%"
    return _green(s) if val >= 0 else _red(s)

def _fmt_dollar(val):
    s = f"+${abs(val):,.2f}" if val >= 0 else f"-${abs(val):,.2f}"
    return _green(s) if val >= 0 else _red(s)

def _narrative_html(narrative: str) -> str:
    """Convert newline-separated narrative into paragraph blocks."""
    paragraphs = [p.strip() for p in narrative.split('\n') if p.strip()]
    if not paragraphs:
        return '<p style="color:#6b7280">No analysis available.</p>'
    # First paragraph gets slightly larger treatment
    out = f'<p style="margin:0 0 12px;color:#374151;font-size:14px;line-height:1.65">{paragraphs[0]}</p>'
    for p in paragraphs[1:]:
        out += f'<p style="margin:0 0 10px;color:#4b5563;font-size:13px;line-height:1.6">{p}</p>'
    return out


def build_html_report(portfolio_state: dict, placed_orders: list,
                      narrative: str, mode: str, run_date: str) -> str:
    total      = portfolio_state.get("total_value", 0)
    cash       = portfolio_state.get("cash", 0)
    unrealized = portfolio_state.get("total_unrealized_pnl", 0)
    positions  = portfolio_state.get("positions", [])

    is_live = mode == "live"
    mode_color = "#991b1b" if is_live else "#92400e"
    mode_bg    = "#fee2e2" if is_live else "#fef3c7"
    mode_label = "LIVE" if is_live else "PAPER"

    # ── Top-line numbers ──────────────────────────────────────────────────
    cash_pct = (cash / total * 100) if total else 0
    invested = total - cash

    stats_html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr>
        <td style="background:#f9fafb;border-radius:8px;padding:16px 14px;width:33%">
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Portfolio Value</div>
          <div style="font-size:26px;font-weight:800;color:#111827">${total:,.2f}</div>
        </td>
        <td width="8"></td>
        <td style="background:#f9fafb;border-radius:8px;padding:16px 14px;width:33%">
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Unrealized P&amp;L</div>
          <div style="font-size:26px;font-weight:800">{_fmt_dollar(unrealized)}</div>
        </td>
        <td width="8"></td>
        <td style="background:#f9fafb;border-radius:8px;padding:16px 14px;width:33%">
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Cash</div>
          <div style="font-size:26px;font-weight:800;color:#111827">${cash:,.2f}</div>
          <div style="font-size:12px;color:#9ca3af;margin-top:3px">{cash_pct:.0f}% of portfolio</div>
        </td>
      </tr>
    </table>"""

    # ── Today's decision ──────────────────────────────────────────────────
    if placed_orders:
        trade_items = ""
        for o in placed_orders:
            side_color = "#16a34a" if o["side"] == "buy" else "#dc2626"
            side_bg    = "#f0fdf4" if o["side"] == "buy" else "#fef2f2"
            amount = f"${o['notional']:,.2f}" if o.get("notional") else f"{o.get('qty', '?')} shares"
            trade_items += f"""
            <tr>
              <td style="padding:10px 12px;vertical-align:top">
                <span style="background:{side_bg};color:{side_color};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:2px 7px;border-radius:4px">{o['side']}</span>
              </td>
              <td style="padding:10px 8px;font-weight:700;font-size:15px;vertical-align:top">{o['symbol']}</td>
              <td style="padding:10px 8px;color:#6b7280;font-size:13px;vertical-align:top">{amount}</td>
              <td style="padding:10px 8px 10px 12px;color:#374151;font-size:13px;font-style:italic;vertical-align:top">"{o['reason']}"</td>
            </tr>"""
        decision_html = f"""
        <div style="margin-bottom:28px">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;margin-bottom:10px">Today's Trades &nbsp;<span style="background:#e0e7ff;color:#3730a3;border-radius:10px;padding:1px 7px;font-size:11px">{len(placed_orders)}</span></div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px">
            {trade_items}
          </table>
        </div>"""
    else:
        decision_html = f"""
        <div style="margin-bottom:28px;background:#f0fdf4;border-radius:8px;padding:14px 16px;display:flex;align-items:center;gap:10px">
          <span style="font-size:18px">✓</span>
          <div>
            <div style="font-weight:700;color:#15803d;font-size:14px">Held — no trades today</div>
            <div style="color:#4b5563;font-size:13px;margin-top:2px">Claude reviewed positions and decided to hold.</div>
          </div>
        </div>"""

    # ── Positions table (compact) ─────────────────────────────────────────
    pos_rows = ""
    for p in sorted(positions, key=lambda x: x.get("market_value", 0), reverse=True):
        pnl      = p.get("unrealized_pnl", 0)
        pnl_pct  = p.get("unrealized_pnl_pct", 0)
        alloc    = (p.get("market_value", 0) / total * 100) if total else 0
        pos_rows += f"""
        <tr style="border-top:1px solid #f3f4f6">
          <td style="padding:9px 10px;font-weight:700;font-size:14px">{p['symbol']}</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px">${p.get('market_value',0):,.2f}</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px">{_fmt_dollar(pnl)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px">{_fmt_pct(pnl_pct)}</td>
          <td style="padding:9px 10px;text-align:right;font-size:13px;color:#9ca3af">{alloc:.0f}%</td>
        </tr>"""

    if not pos_rows:
        pos_rows = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#9ca3af">No open positions</td></tr>'

    positions_html = f"""
    <div style="margin-bottom:28px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;margin-bottom:10px">Positions &nbsp;<span style="color:#6b7280;font-weight:400;text-transform:none;letter-spacing:0">{len(positions)} held</span></div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Symbol</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Value</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">P&amp;L $</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">P&amp;L %</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Alloc</th>
          </tr>
        </thead>
        <tbody>{pos_rows}</tbody>
      </table>
    </div>"""

    # ── Claude's analysis ─────────────────────────────────────────────────
    analysis_html = f"""
    <div style="margin-bottom:28px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;margin-bottom:10px">Claude's Analysis</div>
      <div style="background:#f9fafb;border-radius:8px;padding:16px 18px">
        {_narrative_html(narrative)}
      </div>
    </div>"""

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;background:#fff;margin:0;padding:0">
<div style="max-width:620px;margin:0 auto;padding:28px 20px">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
    <div>
      <div style="font-size:20px;font-weight:800;color:#111827;letter-spacing:-.3px">Portfolio Report</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:3px">{run_date}</div>
    </div>
    <span style="background:{mode_bg};color:{mode_color};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.05em">{mode_label}</span>
  </div>

  {stats_html}
  {decision_html}
  {positions_html}
  {analysis_html}

  <div style="padding-top:16px;border-top:1px solid #f3f4f6;font-size:11px;color:#d1d5db;text-align:center">
    AI Portfolio Manager &nbsp;·&nbsp; {run_date}
  </div>

</div>
</body>
</html>"""
    return html


def build_close_report_html(portfolio_state: dict, narrative: str,
                            mode: str, run_date: str) -> str:
    total      = portfolio_state.get("total_value", 0)
    cash       = portfolio_state.get("cash", 0)
    unrealized = portfolio_state.get("total_unrealized_pnl", 0)
    positions  = portfolio_state.get("positions", [])

    is_live = mode == "live"
    mode_color = "#991b1b" if is_live else "#92400e"
    mode_bg    = "#fee2e2" if is_live else "#fef3c7"
    mode_label = "LIVE" if is_live else "PAPER"

    day_color = "#16a34a" if unrealized >= 0 else "#dc2626"
    day_sign  = "+" if unrealized >= 0 else ""

    # Top stats
    stats_html = f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr>
        <td style="background:#f9fafb;border-radius:8px;padding:16px 14px;width:50%">
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Portfolio Value</div>
          <div style="font-size:26px;font-weight:800;color:#111827">${total:,.2f}</div>
          <div style="font-size:13px;color:#9ca3af;margin-top:3px">${cash:,.2f} cash · {(cash/total*100) if total else 0:.0f}%</div>
        </td>
        <td width="8"></td>
        <td style="background:#f9fafb;border-radius:8px;padding:16px 14px;width:50%">
          <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:.07em;margin-bottom:5px">Today's P&amp;L</div>
          <div style="font-size:26px;font-weight:800;color:{day_color}">{day_sign}${abs(unrealized):,.2f}</div>
          <div style="font-size:13px;color:#9ca3af;margin-top:3px">{(unrealized/total*100) if total else 0:+.2f}% of portfolio</div>
        </td>
      </tr>
    </table>"""

    # Position breakdown
    pos_rows = ""
    for p in sorted(positions, key=lambda x: abs(x.get("change_today", 0) or 0) * (x.get("market_value", 0) or 0), reverse=True):
        chg = p.get("change_today", 0) or 0
        pnl = p.get("unrealized_pnl", 0) or 0
        day_dollar = (p.get("market_value", 0) or 0) * chg / (1 + chg) if chg else 0
        chg_color = "#16a34a" if chg >= 0 else "#dc2626"
        pnl_color = "#16a34a" if pnl >= 0 else "#dc2626"
        chg_sign  = "+" if chg >= 0 else ""
        day_sign2 = "+" if day_dollar >= 0 else ""
        pos_rows += f"""
        <tr style="border-top:1px solid #f3f4f6">
          <td style="padding:9px 10px;font-weight:700;font-size:14px">{p['symbol']}</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px">${p.get('market_value',0):,.2f}</td>
          <td style="padding:9px 10px;text-align:right;font-size:14px;color:{chg_color};font-weight:600">{chg_sign}{chg*100:.2f}% today</td>
          <td style="padding:9px 10px;text-align:right;font-size:13px;color:{chg_color}">{day_sign2}${abs(day_dollar):.2f}</td>
          <td style="padding:9px 10px;text-align:right;font-size:13px;color:{pnl_color}">{pnl:+,.2f}</td>
        </tr>"""

    if not pos_rows:
        pos_rows = '<tr><td colspan="5" style="padding:14px;text-align:center;color:#9ca3af">No open positions</td></tr>'

    positions_html = f"""
    <div style="margin-bottom:28px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;margin-bottom:10px">Positions &nbsp;<span style="color:#6b7280;font-weight:400;text-transform:none;letter-spacing:0">{len(positions)} held</span></div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:14px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Symbol</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Value</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Day %</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Day $</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;font-weight:600;color:#9ca3af;letter-spacing:.05em;text-transform:uppercase">Total P&amp;L</th>
          </tr>
        </thead>
        <tbody>{pos_rows}</tbody>
      </table>
    </div>"""

    analysis_html = f"""
    <div style="margin-bottom:28px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;margin-bottom:10px">Claude's Market Close Synthesis</div>
      <div style="background:#f9fafb;border-radius:8px;padding:16px 18px">
        {_narrative_html(narrative)}
      </div>
    </div>"""

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;background:#fff;margin:0;padding:0">
<div style="max-width:620px;margin:0 auto;padding:28px 20px">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px">
    <div>
      <div style="font-size:20px;font-weight:800;color:#111827;letter-spacing:-.3px">Market Close Summary</div>
      <div style="font-size:13px;color:#9ca3af;margin-top:3px">{run_date} &nbsp;·&nbsp; US markets closed at 4:00 PM ET</div>
    </div>
    <span style="background:{mode_bg};color:{mode_color};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.05em">{mode_label}</span>
  </div>

  {stats_html}
  {positions_html}
  {analysis_html}

  <div style="padding-top:16px;border-top:1px solid #f3f4f6;font-size:11px;color:#d1d5db;text-align:center">
    AI Portfolio Manager &nbsp;·&nbsp; Market Close &nbsp;·&nbsp; {run_date}
  </div>

</div>
</body>
</html>"""
    return html


def send_report(html: str, subject: str):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", 587))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    report_to = os.getenv("REPORT_TO", "")

    if not all([smtp_user, smtp_password, report_to]):
        print("Email not configured — skipping send.")
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = smtp_user
    msg["To"] = report_to
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.sendmail(smtp_user, report_to, msg.as_string())

    print(f"Report sent to {report_to}")
