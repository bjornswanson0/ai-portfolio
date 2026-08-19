import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "portfolio.db")


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    c = conn.cursor()
    c.executescript("""
        CREATE TABLE IF NOT EXISTS decisions (
            id INTEGER PRIMARY KEY,
            run_date TEXT NOT NULL,
            claude_narrative TEXT,
            tokens_used INTEGER,
            run_duration_sec REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY,
            decision_id INTEGER REFERENCES decisions(id),
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            notional REAL,
            qty REAL,
            reason TEXT NOT NULL,
            alpaca_order_id TEXT,
            status TEXT,
            filled_avg_price REAL,
            filled_qty REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY,
            snapshot_date TEXT NOT NULL,
            total_value REAL,
            cash REAL,
            positions_json TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS close_syntheses (
            id INTEGER PRIMARY KEY,
            run_date TEXT NOT NULL,
            narrative TEXT,
            tokens_used INTEGER,
            run_duration_sec REAL,
            created_at TEXT DEFAULT (datetime('now'))
        );
    """)
    conn.commit()
    conn.close()


def insert_decision(run_date, claude_narrative, tokens_used, run_duration_sec):
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO decisions (run_date, claude_narrative, tokens_used, run_duration_sec) VALUES (?,?,?,?)",
        (run_date, claude_narrative, tokens_used, run_duration_sec),
    )
    decision_id = c.lastrowid
    conn.commit()
    conn.close()
    return decision_id


def insert_order(decision_id, symbol, side, notional, qty, reason,
                 alpaca_order_id, status, filled_avg_price, filled_qty):
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        """INSERT INTO orders
           (decision_id, symbol, side, notional, qty, reason,
            alpaca_order_id, status, filled_avg_price, filled_qty)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        (decision_id, symbol, side, notional, qty, reason,
         alpaca_order_id, status, filled_avg_price, filled_qty),
    )
    conn.commit()
    conn.close()


def insert_snapshot(snapshot_date, total_value, cash, positions):
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO snapshots (snapshot_date, total_value, cash, positions_json) VALUES (?,?,?,?)",
        (snapshot_date, total_value, cash, json.dumps(positions)),
    )
    conn.commit()
    conn.close()


def get_decisions(limit=30, offset=0):
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute(
        """SELECT d.*, GROUP_CONCAT(o.symbol || ':' || o.side, ',') as symbols
           FROM decisions d
           LEFT JOIN orders o ON o.decision_id = d.id
           GROUP BY d.id
           ORDER BY d.created_at DESC
           LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_decision_orders(decision_id):
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute(
        "SELECT * FROM orders WHERE decision_id = ? ORDER BY created_at",
        (decision_id,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_recent_decisions_for_agent(days=7):
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute(
        """SELECT o.symbol, o.side, o.reason, o.filled_avg_price, o.filled_qty,
                  o.created_at as trade_date, d.run_date
           FROM orders o
           JOIN decisions d ON d.id = o.decision_id
           WHERE d.run_date >= date('now', ?)
           ORDER BY o.created_at DESC""",
        (f"-{days} days",),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def insert_close_synthesis(run_date, narrative, tokens_used, run_duration_sec):
    conn = get_conn()
    c = conn.cursor()
    c.execute(
        "INSERT INTO close_syntheses (run_date, narrative, tokens_used, run_duration_sec) VALUES (?,?,?,?)",
        (run_date, narrative, tokens_used, run_duration_sec),
    )
    conn.commit()
    conn.close()


def get_latest_close_synthesis():
    conn = get_conn()
    c = conn.cursor()
    row = c.execute(
        "SELECT * FROM close_syntheses ORDER BY created_at DESC LIMIT 1"
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def get_snapshots(limit=30):
    conn = get_conn()
    c = conn.cursor()
    rows = c.execute(
        "SELECT * FROM snapshots ORDER BY snapshot_date DESC LIMIT ?",
        (limit,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
