#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Antigravity Prompt Coach (Self-Host Edition) — Bộ chấm điểm 6×7 Rubric, HRPO Root-Cause & Tối ưu Prompt 1-Phát.
- 100% Zero-Data-Leak: Toàn bộ dữ liệu SQLite lưu cục bộ tại ~/.antigravity_prompt_coach/prompt_coach.db trên máy của bạn.
- Hoạt động 0đ Offline bằng bộ chấm 6×7 Stage-Aware Rubric + Context-Aware 1-Shot Rewriter.
- Tự động kết nối AI nâng cao (tùy chọn) qua Antigravity Tools Proxy (127.0.0.1:8045), GEMINI_API_KEY, OPENAI_API_KEY hoặc Ollama/OpenAI-compatible URL.
"""
from __future__ import annotations

import datetime as dt
import difflib
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict, deque
from pathlib import Path
from typing import Any, Callable

VN_TZ = dt.timezone(dt.timedelta(hours=7))
AI_SCHEMA_VERSION = 3

HOME_DIR = Path.home()
DATA_DIR = Path(os.environ.get('PROMPT_COACH_DATA_DIR', str(HOME_DIR / '.antigravity_prompt_coach')))
COACH_DB_PATH = os.environ.get('AG_PROMPT_COACH_DB', str(DATA_DIR / 'prompt_coach.db'))
GUI_CONFIG_PATH = os.environ.get('AG_GUI_CONFIG_PATH', str(HOME_DIR / '.antigravity_tools' / 'gui_config.json'))
LOCAL_PROXY_URL = os.environ.get('PROMPT_COACH_LLM_URL', 'http://127.0.0.1:8045/v1/chat/completions')
LOCAL_PROXY_MODEL = os.environ.get('PROMPT_COACH_LLM_MODEL', 'gemini-2.5-flash')

VALID_TOOLS = ('antigravity', 'claude', 'codex')

_WRITE_LOCK = threading.Lock()
_PROXY_CACHE: dict[str, Any] = {'ts': 0.0, 'proxy_key': ''}
_ACTIVE_SESSIONS_LOCK = threading.Lock()
_ACTIVE_SESSION_TOKENS: dict[str, float] = {}

_INITIALIZED_DBS: set[str] = set()
_INIT_LOCK = threading.Lock()

# --- Realtime AI Background Worker Pool ---
_AI_BG_LOCK = threading.Lock()
_AI_BG_COND = threading.Condition(_AI_BG_LOCK)
_AI_QUEUE: deque[str] = deque()
_AI_QUEUED_SET: set[str] = set()
_AI_INFLIGHT: set[str] = set()
_AI_FAIL_UNTIL: dict[str, float] = {}
_AI_WORKERS_STARTED = False
_AI_COOLDOWN_UNTIL = 0.0
_MAX_AI_WORKERS = max(1, min(4, int(os.environ.get('AG_PROMPT_COACH_AI_WORKERS', '2'))))

# --- Secret Redaction (Layer 2 Defense-in-Depth) ---
_SECRET_PATTERNS = [
    re.compile(r'-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----.*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----', re.S | re.I),
    re.compile(r'(?i)\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{14,}'),
    re.compile(r'(?i)\bgh[pousr]_[A-Za-z0-9]{18,}'),
    re.compile(r'(?i)\bgithub_pat_[A-Za-z0-9_]{18,}'),
    re.compile(r'(?i)\bEAA[A-Za-z0-9]{18,}'),
    re.compile(r'(?i)\bAIza[0-9A-Za-z_\-]{28,}'),
    re.compile(r'(?i)\bxox[abposr]-[A-Za-z0-9\-]{10,}'),
    re.compile(r'(?i)\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}'),
    re.compile(r'(?i)\bBearer\s+[A-Za-z0-9._\-+/=]{12,}'),
    re.compile(r'(?i)\b(?:(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{12,}|(?:AKIA|ASIA)[0-9A-Z]{16}|(?:npm|hf)_[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9._\-]{20,})\b'),
    re.compile(r'(?i)\b\d{8,12}:AA[A-Za-z0-9_\-]{30,}\b'),
    re.compile(r'\b[0-9a-fA-F]{41,}\b'),
]
# URI credentials strictly before the first '/' after '://' (never touches @scope/pkg or path segments)
_DSN_CRED_RE = re.compile(r'(?i)\b([a-z][a-z0-9+.\-]{1,24}://[^/\s"\'@]*?:)([^@/\s"\']+)(@[^/\s"\']+)')
_CLI_CRED_RE = re.compile(r'(?i)(\bcurl\b[^\n]*?\s(?:-u|--user)\s+["\']?[^:\s"\']+:|\bsshpass\s+-p\s*["\']?)([^\s"\']+)')
_B64_RE = re.compile(r'[A-Za-z0-9+/]{41,}={0,2}')

_KEY_NAME_PAT = (
    r'["\']?\b(?:'
    r'password|passwd|pwd|pass|mật\s*khẩu|mat\s*khau|khóa\s*bí\s*mật|khoa\s*bi\s*mat|mk|'
    r'(?:aws[_\- ]?)?(?:access|refresh|auth|id|bot|bearer|client|api|session|sync|master|admin|private|secret)[_\- ]?(?:access[_\- ]?)?(?:token|key|secret|password|pwd)|'
    r'token|secret|api[_\- ]?key|apikey|cookie|session[_\- ]?id'
    r')(?:[_\- ]?(?:id|val|value|secret|token))?\b["\']?'
)
_KEYED_QUOTED_RE = re.compile(
    rf'(?i)({_KEY_NAME_PAT})(\s*(?:[:=]|là|is)\s*)(["\'])([^"\'\r\n]{{3,160}})(\3)'
)
_KEYED_UNQUOTED_RE = re.compile(
    rf'(?i)({_KEY_NAME_PAT})(\s*(?:[:=]|là|is)\s*)([^\s"\',;}}\]\r\n]{{3,160}})'
)
_KEYED2_RE = re.compile(
    r'(?i)(password|passwd|mật\s*khẩu|mat\s*khau|khóa\s*bí\s*mật|khoa\s*bi\s*mat|token|secret|api[_\- ]?key|apikey|cookie)'
    r'(\s+["\']?)([A-Za-z0-9._\-+/=@#$%!]{8,})'
)
_HARMLESS_KEY_VALS = {'true', 'false', 'null', 'none', 'undefined', '[redacted]', 'redacted', '***'}

_SECRET_CHECK_GATES = (
    lambda s, low: '-----begin ' in low,
    lambda s, low: 'sk-' in low,
    lambda s, low: 'gh' in low and '_' in s,
    lambda s, low: 'github_pat_' in low,
    lambda s, low: 'eaa' in low,
    lambda s, low: 'aiza' in low,
    lambda s, low: 'xox' in low,
    lambda s, low: 'eyj' in low,
    lambda s, low: 'bearer' in low,
    lambda s, low: ('_live_' in low or '_test_' in low or 'akia' in low or 'asia' in low or 'npm_' in low or 'hf_' in low or 'ya29.' in low),
    lambda s, low: ':aa' in low,
    lambda s, low: len(s) >= 41,
)
_KEYED_TRIGGER_WORDS = ('pass', 'pwd', 'mật', 'mat', 'khóa', 'khoa', 'mk', 'token', 'secret', 'key', 'cookie', 'session', 'auth')


def _is_harmless_val(val: str) -> bool:
    v = val.strip()
    if not v or v.lower() in _HARMLESS_KEY_VALS:
        return True
    if v.startswith('{{') and v.endswith('}}'):
        return True
    return False


def _trunc_only(text: Any, max_len: int = 0) -> str:
    """Cắt nhanh chuỗi đã được redact 2 lớp từ SQLite (chỉ dùng cho đường đọc nội bộ)."""
    if not text:
        return ''
    s = str(text)
    if max_len > 0 and len(s) > max_len:
        return s[:max_len].rstrip() + '…'
    return s


def redact_sensitive_text(text: Any, max_len: int = 0) -> str:
    """Che toàn bộ token/API key/mật khẩu/DSN/JSON secret/JWT/private key trước khi lưu hoặc gửi AI."""
    if not text:
        return ''
    s = str(text)
    low = s.lower()
    if '://' in s and '@' in s:
        s = _DSN_CRED_RE.sub(r'\1[REDACTED]\3', s)
        low = s.lower()
    if 'curl' in low or 'sshpass' in low:
        s = _CLI_CRED_RE.sub(r'\1[REDACTED]', s)
        low = s.lower()
    for pat, gate in zip(_SECRET_PATTERNS, _SECRET_CHECK_GATES):
        if gate(s, low):
            s = pat.sub('[REDACTED]', s)
            low = s.lower()
    if any(w in low for w in _KEYED_TRIGGER_WORDS):
        s = _KEYED_QUOTED_RE.sub(
            lambda m: m.group(0) if _is_harmless_val(m.group(4)) else f'{m.group(1)}{m.group(2)}{m.group(3)}[REDACTED]{m.group(5)}',
            s,
        )
        s = _KEYED_UNQUOTED_RE.sub(
            lambda m: m.group(0) if _is_harmless_val(m.group(3)) else f'{m.group(1)}{m.group(2)}[REDACTED]',
            s,
        )
        s = _KEYED2_RE.sub(
            lambda m: (
                f'{m.group(1)}{m.group(2)}[REDACTED]'
                if (not _is_harmless_val(m.group(3))) and any(c.isdigit() for c in m.group(3)) and any(c.isalpha() for c in m.group(3))
                else m.group(0)
            ),
            s,
        )
    if len(s) >= 41:
        s = _B64_RE.sub(
            lambda m: '[REDACTED]'
            if (
                sum(c.isdigit() for c in m.group(0)) >= 3
                and sum(c.isupper() for c in m.group(0)) >= 2
                and sum(c.islower() for c in m.group(0)) >= 2
            )
            else m.group(0),
            s,
        )
    if max_len > 0 and len(s) > max_len:
        s = s[:max_len].rstrip() + '…'
    return s


def _utc_iso() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace('+00:00', 'Z')
    )


def _vn_today() -> str:
    return dt.datetime.now(VN_TZ).strftime('%Y-%m-%d')


def _shift_vn_day(day_str: str, delta_days: int) -> str:
    try:
        d = dt.date.fromisoformat(day_str) + dt.timedelta(days=delta_days)
        return d.isoformat()
    except Exception:
        return day_str


def _get_proxy_api_key() -> str:
    """Đọc API key của Antigravity Tools Proxy cục bộ (127.0.0.1:8045) nếu thành viên có cài đặt trên máy."""
    env_key = str(os.environ.get('PROMPT_COACH_LLM_KEY') or '').strip()
    if env_key:
        return env_key
    now = time.time()
    if (now - float(_PROXY_CACHE['ts'])) < 20.0 and _PROXY_CACHE['proxy_key']:
        return str(_PROXY_CACHE['proxy_key'])
    chosen = ''
    cfg_path = os.environ.get('AG_GUI_CONFIG_PATH', GUI_CONFIG_PATH)
    if cfg_path and os.path.isfile(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            pk = str((cfg.get('proxy') or {}).get('api_key') or '').strip()
            if len(pk) >= 8:
                chosen = pk
        except Exception:
            pass
    _PROXY_CACHE['ts'] = now
    _PROXY_CACHE['proxy_key'] = chosen
    return chosen


def issue_local_session_token(ttl_s: float = 86400.0 * 7) -> str:
    tok = 'pcs_' + secrets.token_urlsafe(32)
    with _ACTIVE_SESSIONS_LOCK:
        now = time.time()
        expired = [k for k, exp in _ACTIVE_SESSION_TOKENS.items() if exp <= now]
        for k in expired:
            _ACTIVE_SESSIONS_TOKENS_POP = _ACTIVE_SESSION_TOKENS.pop(k, None)
        _ACTIVE_SESSION_TOKENS[tok] = now + ttl_s
    return tok


def _extract_token(headers: Any) -> str:
    if not headers:
        return ''
    auth = str(headers.get('Authorization') or headers.get('authorization') or '').strip()
    if auth.lower().startswith('bearer '):
        tok = auth[7:].strip()
        if tok:
            return tok
    api_key = str(headers.get('x-api-key') or headers.get('X-Api-Key') or '').strip()
    if api_key:
        return api_key
    cookie_hdr = str(headers.get('Cookie') or headers.get('cookie') or '')
    if cookie_hdr:
        m = re.search(r'(?:^|;\s*)(?:pcs_session|abv_admin_api_key)=([^;]+)', cookie_hdr)
        if m:
            return urllib.parse.unquote(m.group(1)).strip()
    return ''


def verify_true_owner(headers: Any) -> tuple[bool, str]:
    """
    Xác thực truy cập cho bản Self-Host:
    - Nếu không bật mã PIN (chạy mặc định 127.0.0.1 chỉ trên máy cá nhân): cho phép truy cập trực tiếp từ trình duyệt nội bộ.
    - Nếu bật PROMPT_COACH_PIN (ví dụ khi mở --lan cho điện thoại cùng Wi-Fi): bắt buộc khớp mã PIN hoặc Session Token pcs_... hợp lệ.
    """
    required_pin = str(os.environ.get('PROMPT_COACH_PIN') or '').strip()
    client_ip = str((headers or {}).get('X-Prompt-Coach-Client-IP') or '127.0.0.1').strip()
    is_loopback = client_ip in ('127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1')
    if not required_pin and is_loopback:
        return (True, 'local_member')

    token = _extract_token(headers)
    if not token or len(token) < 4 or len(token) > 256:
        return (False, '')

    if required_pin and hmac.compare_digest(token.encode('utf-8'), required_pin.encode('utf-8')):
        return (True, 'local_member')

    now = time.time()
    with _ACTIVE_SESSIONS_LOCK:
        for active_tok, exp_ts in list(_ACTIVE_SESSION_TOKENS.items()):
            if exp_ts <= now:
                _ACTIVE_SESSION_TOKENS.pop(active_tok, None)
                continue
            if hmac.compare_digest(token.encode('utf-8'), active_tok.encode('utf-8')):
                return (True, 'local_member')

    return (False, '')


def _ensure_coach_db(db_path: str | None = None) -> sqlite3.Connection:
    target = db_path or os.environ.get('AG_PROMPT_COACH_DB', COACH_DB_PATH)
    Path(target).parent.mkdir(parents=True, exist_ok=True)
    db_key = os.path.abspath(target)
    if db_key in _INITIALIZED_DBS and os.path.isfile(target) and os.path.getsize(target) > 0:
        con = sqlite3.connect(target, timeout=15.0)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA busy_timeout=15000')
        con.execute('PRAGMA synchronous=NORMAL')
        return con
    with _INIT_LOCK:
        if db_key in _INITIALIZED_DBS and os.path.isfile(target) and os.path.getsize(target) > 0:
            con = sqlite3.connect(target, timeout=15.0)
            con.row_factory = sqlite3.Row
            con.execute('PRAGMA busy_timeout=15000')
            con.execute('PRAGMA synchronous=NORMAL')
            return con

        Path(target).parent.mkdir(parents=True, exist_ok=True)
        con = sqlite3.connect(target, timeout=15.0)
        con.row_factory = sqlite3.Row
        con.execute('PRAGMA busy_timeout=15000')
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('PRAGMA synchronous=NORMAL')
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS coach_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                max_prompts_per_session INTEGER NOT NULL DEFAULT 12,
                max_hours_per_session REAL NOT NULL DEFAULT 2.0,
                max_correction_pct REAL NOT NULL DEFAULT 10.0,
                auto_analyze_ai INTEGER NOT NULL DEFAULT 1,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS coach_sessions (
                session_key TEXT PRIMARY KEY,
                tool TEXT NOT NULL,
                session_id TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                project TEXT NOT NULL DEFAULT '',
                cwd TEXT NOT NULL DEFAULT '',
                is_sub INTEGER NOT NULL DEFAULT 0,
                is_fork_clone INTEGER NOT NULL DEFAULT 0,
                start_ts REAL NOT NULL DEFAULT 0,
                end_ts REAL NOT NULL DEFAULT 0,
                start_day TEXT NOT NULL,
                end_day TEXT NOT NULL,
                days_json TEXT NOT NULL DEFAULT '[]',
                n_raw_msgs INTEGER NOT NULL DEFAULT 0,
                n_human_prompts INTEGER NOT NULL DEFAULT 0,
                n_auto_msgs INTEGER NOT NULL DEFAULT 0,
                auto_breakdown_json TEXT NOT NULL DEFAULT '{}',
                clean_active_hours REAL NOT NULL DEFAULT 0.0,
                wall_hours REAL NOT NULL DEFAULT 0.0,
                busy_hours REAL NOT NULL DEFAULT 0.0,
                n_short_nudges INTEGER NOT NULL DEFAULT 0,
                n_vague_errors INTEGER NOT NULL DEFAULT 0,
                n_corr_kw INTEGER NOT NULL DEFAULT 0,
                n_question_replies INTEGER NOT NULL DEFAULT 0,
                n_with_image INTEGER NOT NULL DEFAULT 0,
                first_human_len INTEGER NOT NULL DEFAULT 0,
                avg_human_len REAL NOT NULL DEFAULT 0.0,
                first_human_preview TEXT NOT NULL DEFAULT '',
                correction_rate REAL,
                rule_score INTEGER NOT NULL DEFAULT 100,
                severity TEXT NOT NULL DEFAULT 'green',
                flags_json TEXT NOT NULL DEFAULT '[]',
                prompts_sample_json TEXT NOT NULL DEFAULT '[]',
                content_hash TEXT NOT NULL DEFAULT '',
                ai_hash TEXT NOT NULL DEFAULT '',
                ai_analysis_json TEXT NOT NULL DEFAULT '{}',
                total_tool_calls INTEGER NOT NULL DEFAULT 0,
                max_consecutive_tool_calls INTEGER NOT NULL DEFAULT 0,
                tool_error_count INTEGER NOT NULL DEFAULT 0,
                redirection_count INTEGER NOT NULL DEFAULT 0,
                last_activity_ts REAL NOT NULL DEFAULT 0.0,
                is_running INTEGER NOT NULL DEFAULT 0,
                is_pinned INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_coach_sessions_start_day ON coach_sessions(start_day DESC, tool);
            CREATE INDEX IF NOT EXISTS idx_coach_sessions_end_day ON coach_sessions(end_day DESC, n_human_prompts DESC);

            CREATE TABLE IF NOT EXISTS coach_day_sessions (
                day TEXT NOT NULL,
                session_key TEXT NOT NULL,
                tool TEXT NOT NULL,
                is_sub INTEGER NOT NULL DEFAULT 0,
                day_human_prompts INTEGER NOT NULL DEFAULT 0,
                day_raw_msgs INTEGER NOT NULL DEFAULT 0,
                day_auto_msgs INTEGER NOT NULL DEFAULT 0,
                day_active_hours REAL NOT NULL DEFAULT 0.0,
                day_short_nudges INTEGER NOT NULL DEFAULT 0,
                day_vague_errors INTEGER NOT NULL DEFAULT 0,
                day_corr_kw INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (day, session_key)
            );
            CREATE INDEX IF NOT EXISTS idx_coach_day_sess_day ON coach_day_sessions(day DESC, tool, is_sub);

            CREATE TABLE IF NOT EXISTS coach_daily_ai (
                day TEXT PRIMARY KEY,
                summary_json TEXT NOT NULL DEFAULT '{}',
                rollup_sig TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS coach_saved_prompts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '1-shot',
                tool TEXT NOT NULL DEFAULT 'all',
                weak_example TEXT NOT NULL DEFAULT '',
                prompt_template TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                use_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS coach_sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        now_iso = _utc_iso()
        con.execute(
            """
            INSERT OR IGNORE INTO coach_settings
            (id, max_prompts_per_session, max_hours_per_session, max_correction_pct, auto_analyze_ai, updated_at)
            VALUES (1, 12, 2.0, 10.0, 1, ?)
            """,
            (now_iso,),
        )
        _migrate_coach_schema(con)
        _seed_default_saved_prompts(con, now_iso)
        ver_row = con.execute("SELECT value FROM coach_sync_meta WHERE key = 'rule_engine_version'").fetchone()
        if not ver_row or str(ver_row['value'] or '') != 'v3':
            _recompute_all_rule_scores(con, get_settings(con))
            con.execute("INSERT OR REPLACE INTO coach_sync_meta (key, value) VALUES ('rule_engine_version', 'v3')")
        con.commit()
        _INITIALIZED_DBS.add(db_key)
        return con


def _migrate_coach_schema(con: sqlite3.Connection) -> None:
    """Bổ sung cột Assistant/Tool Metrics & Realtime Activity an toàn cho DB hiện có."""
    cols = {str(r[1]) for r in con.execute('PRAGMA table_info(coach_sessions)').fetchall()}
    needed = (
        ('total_tool_calls', 'INTEGER NOT NULL DEFAULT 0'),
        ('max_consecutive_tool_calls', 'INTEGER NOT NULL DEFAULT 0'),
        ('tool_error_count', 'INTEGER NOT NULL DEFAULT 0'),
        ('redirection_count', 'INTEGER NOT NULL DEFAULT 0'),
        ('last_activity_ts', 'REAL NOT NULL DEFAULT 0.0'),
        ('is_running', 'INTEGER NOT NULL DEFAULT 0'),
        ('is_pinned', 'INTEGER NOT NULL DEFAULT 0'),
    )
    added_last_act = False
    for col_name, col_def in needed:
        if col_name not in cols:
            con.execute(f'ALTER TABLE coach_sessions ADD COLUMN {col_name} {col_def}')
            if col_name == 'last_activity_ts':
                added_last_act = True
    if added_last_act:
        con.execute('UPDATE coach_sessions SET last_activity_ts = end_ts WHERE last_activity_ts <= 0 AND end_ts > 0')
    con.execute('CREATE INDEX IF NOT EXISTS idx_coach_sessions_last_act ON coach_sessions(last_activity_ts DESC)')


def _seed_default_saved_prompts(con: sqlite3.Connection, now_iso: str) -> None:
    cnt = int((con.execute('SELECT COUNT(*) FROM coach_saved_prompts').fetchone() or [0])[0])
    if cnt > 0:
        return
    defaults = [
        (
            '1-Shot Spec Sửa lỗi UI / API không vòng vo',
            'bugfix',
            'all',
            'xem lại đi vẫn lỗi rồi',
            'Mục tiêu: Sửa dứt điểm lỗi [MÔ TẢ HIỆN TƯỢNG] tại [ĐƯỜNG DẪN FILE / ROUTE].\n'
            'Triệu chứng & Log thật: [DÁN ĐOẠN LỖI / SCREENSHOT / HTTP STATUS].\n'
            'Phạm vi giới hạn: Chỉ sửa file liên quan, giữ nguyên các phần đang chạy tốt.\n'
            'Điều kiện Xong (Done): Tự chạy kiểm thử / Playwright kiểm tra 0 lỗi console, HTTP 200 ở [URL], rồi báo đúng kết quả đo được.',
            'Giảm trung bình từ 12–20 prompt sửa lắt nhắt xuống 1–3 prompt.',
        ),
        (
            'Mở phiên mới + Đóng gói HANDOFF chống tràn context >12 prompt',
            'handoff',
            'all',
            'tiếp đi làm nốt phần kia',
            'Dừng triển khai thêm ở phiên này để tránh phình ngữ cảnh. Hãy tóm tắt trạng thái thật thành HANDOFF ngắn gọn gồm:\n'
            '1) File đã sửa & diff chính\n'
            '2) Việc đã kiểm chứng đạt PASS\n'
            '3) Đúng việc tiếp theo cần làm ở phiên mới + lệnh test kiểm chứng.',
            'Dùng ngay khi thấy phiên chạm 10–12 prompt hoặc >1.5 giờ.',
        ),
        (
            'Giao tính năng mới 1-Phát (Rõ Giao diện + Backend + Kiểm thử)',
            'feature',
            'all',
            'làm giúp tôi tính năng X trên aihot.vn',
            'Tính năng cần làm: [TÊN TÍNH NĂNG] đặt tại [TRANG / TAB].\n'
            'Ai được xem / Phân quyền: [CHỈ ADMIN / THÀNH VIÊN / CÔNG KHAI].\n'
            'Luồng dữ liệu: Đọc từ [NGUỒN], xử lý ở [API / SCRIPT], lưu tại [DB/JSON].\n'
            'Ràng buộc giao diện: Dùng Google Sans >= 12px, tabular-nums, hỗ trợ Light/Dark và Mobile 390px.\n'
            'Kiểm chứng bắt buộc: Chạy typecheck, build, test API quyền 403/200 và chụp Playwright 1440px + 390px.',
            'Hạn chế AI đoán mò yêu cầu khiến bạn phải nhắc sửa 5–10 lượt.',
        ),
    ]
    for title, cat, tool, weak, tpl, notes in defaults:
        con.execute(
            """
            INSERT INTO coach_saved_prompts
            (title, category, tool, weak_example, prompt_template, notes, use_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
            """,
            (title, cat, tool, weak, tpl, notes, now_iso, now_iso),
        )


def get_settings(con: sqlite3.Connection) -> dict[str, Any]:
    row = con.execute('SELECT * FROM coach_settings WHERE id = 1').fetchone()
    if not row:
        return {
            'max_prompts_per_session': 12,
            'max_hours_per_session': 2.0,
            'max_correction_pct': 10.0,
            'auto_analyze_ai': True,
            'updated_at': _utc_iso(),
        }
    return {
        'max_prompts_per_session': int(row['max_prompts_per_session'] or 12),
        'max_hours_per_session': float(row['max_hours_per_session'] or 2.0),
        'max_correction_pct': float(row['max_correction_pct'] or 10.0),
        'auto_analyze_ai': bool(int(row['auto_analyze_ai'] or 0)),
        'updated_at': str(row['updated_at'] or ''),
    }


def evaluate_session_rules(sess: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    """Động cơ chấm điểm Rule Engine 0 đồng cho 100% hội thoại dựa trên ngưỡng chủ hệ thống đặt."""
    max_p = max(3, int(settings.get('max_prompts_per_session') or 12))
    max_h = max(0.25, float(settings.get('max_hours_per_session') or 2.0))
    max_corr = max(1.0, float(settings.get('max_correction_pct') or 10.0))

    n_p = int(sess.get('n_human_prompts') or 0)
    act_h = float(sess.get('clean_active_hours') or 0.0)
    n_nudges = int(sess.get('n_short_nudges') or 0)
    n_vague = int(sess.get('n_vague_errors') or 0)
    n_corr = int(sess.get('n_corr_kw') or 0)
    corr_rate = sess.get('correction_rate')
    effective_corr_pct = (
        float(corr_rate) * 100.0
        if corr_rate is not None
        else (n_corr * 100.0 / max(1, n_p)) if n_p >= 2 else 0.0
    )
    first_len = int(sess.get('first_human_len') or 0)
    days_cnt = len(sess.get('days') or []) or (1 if sess.get('start_day') == sess.get('end_day') else 2)

    flags: list[dict[str, str]] = []
    penalty = 0

    if n_p > max_p:
        over = n_p - max_p
        sev = 'red' if n_p >= max(max_p * 2, 20) else 'amber'
        flags.append({
            'code': 'VUOT_NGUONG_PROMPT',
            'label': f'Vượt {max_p} prompt ({n_p}p)',
            'severity': sev,
            'tip': f'Nên tách phiên / chốt HANDOFF sau prompt thứ {max_p} để tránh context nở to.',
        })
        penalty += min(35, 14 + over * 2)

    if act_h >= max_h:
        sev = 'red' if act_h >= max_h * 1.6 else 'amber'
        flags.append({
            'code': 'KEO_DAI_GIO',
            'label': f'Kéo dài {act_h:.1f}h (mốc <{max_h:.1f}h)',
            'severity': sev,
            'tip': 'Đóng gói việc dở thành HANDOFF, mở phiên sạch cho chặng sau.',
        })
        penalty += 22 if sev == 'red' else 12

    if days_cnt >= 2:
        flags.append({
            'code': 'KEO_NHIEU_NGAY',
            'label': f'Kéo qua {days_cnt} ngày',
            'severity': 'amber' if n_p <= max_p else 'red',
            'tip': 'Không giữ mãi 1 hội thoại qua nhiều ngày; mỗi ngày mở phiên mới gắn mục tiêu rõ.',
        })
        penalty += 10

    if n_nudges >= 2 and (n_nudges / max(1, n_p)) >= 0.25:
        flags.append({
            'code': 'NHAC_MAY_MOC',
            'label': f'{n_nudges} lượt nhắc ngắn ("tiếp/ok")',
            'severity': 'amber',
            'tip': 'Gộp điều kiện kiểm chứng cuối prompt đầu tiên thay vì phải giục từng bước.',
        })
        penalty += min(18, n_nudges * 4)

    if n_vague >= 2:
        flags.append({
            'code': 'BAO_LOI_MO_HO',
            'label': f'{n_vague} câu báo lỗi thiếu log',
            'severity': 'red' if n_vague >= 4 else 'amber',
            'tip': 'Dán kèm exact lỗi console / HTTP code / file path thay vì nói "vẫn lỗi/chưa được".',
        })
        penalty += min(20, n_vague * 5)

    if n_p >= 3 and effective_corr_pct > max_corr and n_corr >= 2:
        flags.append({
            'code': 'TY_LE_SUA_CAO',
            'label': f'Sửa lại ~{effective_corr_pct:.0f}% ({n_corr} lượt)',
            'severity': 'red' if effective_corr_pct >= max_corr * 2.5 else 'amber',
            'tip': 'Yêu cầu AI hỏi rõ phạm vi & điều kiện Done trước khi code để cắt lượt sửa.',
        })
        penalty += min(20, int((effective_corr_pct - max_corr) * 0.6) + 5)

    if n_p >= 5 and 0 < first_len < 60:
        flags.append({
            'code': 'MO_DAU_MONG',
            'label': f'Câu mở đầu ngắn ({first_len} ký tự)',
            'severity': 'amber',
            'tip': 'Câu mở đầu dài tối thiểu 120–250 ký tự có File + Done giúp giảm 35–50% lượt hỏi lại.',
        })
        penalty += 10

    total_tools = int(sess.get('total_tool_calls') or 0)
    max_consec = int(sess.get('max_consecutive_tool_calls') or 0)
    tool_errs = int(sess.get('tool_error_count') or 0)
    redir_cnt = int(sess.get('redirection_count') or 0)

    if redir_cnt >= 2 and n_p >= 3 and (redir_cnt / max(1, n_p)) >= 0.22 and n_corr < 2:
        flags.append({
            'code': 'SUA_CHUYEN_HUONG',
            'label': f'Chuyển hướng {redir_cnt} lần giữa phiên',
            'severity': 'amber',
            'tip': 'Phiên bị cắt ngang/đổi hướng nhiều lần — nên chốt rõ tiêu chí Done trước khi cho chạy.',
        })
        penalty += min(16, redir_cnt * 4)

    if tool_errs >= 3:
        sev_te = 'red' if tool_errs >= 6 else 'amber'
        flags.append({
            'code': 'TOOL_LOI_LAP',
            'label': f'{tool_errs} lỗi Tool/Lệnh phát sinh',
            'severity': sev_te,
            'tip': 'Xem chẩn đoán HRPO bên dưới để gắn log/đường dẫn/rào an toàn ngay ở câu kích hoạt.',
        })
        penalty += min(18, tool_errs * 2)

    autonomy_bonus = 0
    if max_consec >= 6 and tool_errs == 0 and n_corr == 0 and n_vague == 0 and total_tools >= 6:
        autonomy_bonus = min(8, 3 + max_consec // 4)
        flags.append({
            'code': 'AI_TU_CHU_CAO',
            'label': f'AI tự chủ {max_consec} bước liên tiếp · 0 lỗi tool',
            'severity': 'green',
            'tip': 'Prompt rõ ràng giúp AI tự xử lý chuỗi tool dài mà không cần nhắc từng bước.',
        })

    score = max(12, min(100, 100 - penalty + autonomy_bonus))
    if n_p > max_p or act_h >= max_h or any(f['severity'] == 'red' for f in flags):
        severity = 'red'
    elif any(f['severity'] == 'amber' for f in flags) or score < 85:
        severity = 'amber'
    else:
        severity = 'green'

    if not any(f['severity'] != 'green' for f in flags) and n_p >= 2 and not any(f['code'] == 'DAT_CHUAN' for f in flags):
        flags.append({
            'code': 'DAT_CHUAN',
            'label': 'Gọn trong chuẩn Playbook',
            'severity': 'green',
            'tip': 'Phiên gọn dưới ngưỡng — nên giữ nhịp đóng phiên kiểu này.',
        })

    return {
        'rule_score': int(score),
        'severity': severity,
        'flags': flags,
    }


_PROMPT_DRIP_PREFIX_RE = re.compile(
    r'^(?:và\s+|cộng\s*thêm\s+|nhớ\s+|tiện\s+thể\s+)?'
    r'(?:thêm|cho\s+thêm|làm\s+thêm|bổ\s+sung|phải|gửi\s+thêm|sửa\s+thêm|đổi\s+lại|gắn\s+thêm|tối\s+ưu\s+thêm|cập\s+nhật\s+thêm|cho\s+ai)\b',
    re.I,
)
_PROMPT_CTX_RE = re.compile(
    r'[/\\][A-Za-z0-9_.\-]+|\.[a-z]{1,5}\b|https?://|\b(?:http|status|error|traceback|line|dòng|lỗi|api|db|tab|trang|file|port|sql|service|nginx)\b',
    re.I,
)
_PROMPT_SCOPE_RE = re.compile(
    r'(?i)(không\s+sửa|giữ\s+nguyên|chỉ\s+(?:sửa|tìm|đọc|thêm|làm|chỉnh|xem)|phạm\s+vi|không\s+chạm|tối\s+đa|đừng|riêng|tách|cô\s+lập|ngoài\s+ra\s+không)'
)
_PROMPT_CONSTR_RE = re.compile(
    r'(?i)(google\s+sans|tabular-nums|12px|390px|mobile|dark\s*mode|light/dark|offline|không\s+mock|tương\s+thích|backward|timeout|port\s*\d+|latency|ràng\s+buộc|chuẩn|layout|responsive|cache)'
)
_PROMPT_FMT_RE = re.compile(
    r'(?i)(json|markdown|bảng|table|checklist|diff|tóm\s+tắt|ngắn\s+gọn|link\s+bấm|từng\s+bước|bullet|báo\s+cáo|artifact|file\s+\.md|format|định\s+dạng|song\s+song|trực\s+tiếp)'
)
_PROMPT_DONE_RE = re.compile(
    r'(?i)(done|xong|test|pytest|tsc|verify|kiểm\s*(?:thử|chứng|tra)|nghiệm\s*thu|playwright|http\s*200|0\s*lỗi|build|chụp|bằng\s+chứng|output|trả\s*(?:về|ra)|hiển\s+thị|kết\s+quả|báo\s+cáo|xác\s+nhận)'
)
_RISKY_OP_RE = re.compile(
    r'(?i)(?:\b(?:deploy|push(?!\s*notification)|force[\-\s]?push|sync_vps\d*|drop\s+table|truncate\s+table|alter\s+table|migrations?|systemctl|nginx\s+-s)\b'
    r'|\brm\s+-[rfA-Za-z]+\b'
    r'|\brestart\s+(?:nginx|service|server|vps|systemd|backend|db|docker)\b'
    r'|\b(?:xóa|delete)\s+(?:bảng|table|db|database|sqlite|dữ\s+liệu|data|production|prod|file|thư\s+mục)\b'
    r'|\b(?:ghi|sửa|chạy|cập\s+nhật|update|execute)\b[^\n]{0,45}\b(?:production|prod|\.env\b))'
)
_SAFETY_GUARD_RE = re.compile(
    r'(?i)(backup|sao\s*lưu|dry-?run|kiểm\s*(?:tra|kê)\s*trước|không\s*(?:xóa|chạm|push|deploy|tự|sửa\s+dữ\s+liệu)|giữ\s*nguyên|an\s*toàn|rollback|test\s*(?:trước|local)|cô\s*lập|staging|xác\s*nhận|confirm|chưa\s+deploy|không\s+mất)'
)
_NON_BUG_ZERO_ERR_RE = re.compile(r'(?i)\b(?:0|không(?:\s+có|\s+còn)?)\s+lỗi\b')
_MEANINGFUL_ACTION_RE = re.compile(
    r'(?i)^(?:ok\s+|oke\s+|vâng\s+|ừ\s+)?(?:'
    r'(?:chốt|đồng\s+ý|chọn|duyệt)\s+(?:phương\s+án|hướng|cách|làm|theo|mục|bản|kế\s+hoạch|\d+)\b'
    r'|git\s+commit\b|commit\s+\S+'
    r'|chạy\s+(?:unit\s+test|test|pytest|build|kiểm\s+thử|tsc|playwright|nghiệm\s+thu)\b'
    r')'
)
_EXTRACT_FILE_RE = re.compile(
    r'(?:[A-Za-z]:[/\\]|[/\\]?[A-Za-z0-9_.\-]+[/\\])[A-Za-z0-9_.\-/\\]+\.[A-Za-z0-9]{1,8}\b'
    r'|\b[A-Za-z0-9_\-]{2,80}\.(?:tsx?|jsx?|py|rs|go|sql|json|jsonl|ya?ml|md|html?|css|scss|sh|ps1|toml|db|sqlite)\b'
)

PROMPT_STAGE_LABELS: dict[str, str] = {
    'exploration': 'Khám phá / Đọc hiểu',
    'diagnosis': 'Chẩn đoán lỗi',
    'execution': 'Thực thi làm / sửa',
    'verification': 'Kiểm chứng & Test',
    'reusable_workflow': 'Quy trình / Mẫu chuẩn',
    'action': 'Chốt / Lệnh nhanh',
}

_STAGE_VERIFICATION_RE = re.compile(
    r'(?i)\b(test|pytest|verify|kiểm\s*(?:thử|chứng|tra)|audit|check|playwright|tsc|build|status|chụp\s+màn|đo\s+lại|nghiệm\s+thu)\b'
)
_STAGE_WORKFLOW_RE = re.compile(
    r'(?i)\b(quy\s+trình|workflow|skill|template|mẫu\s+prompt|agents\.md|chuẩn\s+hóa|cron|hook|tự\s+động\s+hóa|playbook|biến\s+\{\{)\b'
)
_STAGE_DIAG_RE = re.compile(
    r'(?i)\b(lỗi|bug|traceback|crash|exception|timeout|rớt|treo|chậm|hỏng|không\s+(?:chạy|hiện|lên|vào|ăn)|403|404|500|502|504|debug|tại\s+sao)\b'
)
_STAGE_EXPLORE_RE = re.compile(
    r'(?i)\b(tìm\s+hiểu|đọc\s+(?:code|file|hàm)|liệt\s+kê|giải\s+thích|tóm\s+tắt|kiến\s+trúc|nằm\s+ở\s+đâu|so\s+sánh|gợi\s+ý|repo\s+trên\s+github)\b'
)
_STAGE_ACTION_RE = re.compile(
    r'(?i)^(?:chốt|đồng\s+ý|ok|yes|làm\s+luôn|triển\s+khai|deploy|push|commit|restart|chạy\s+(?:đi|luôn|lại|thử)|tiếp\s+tục|\d{1,2}|cả\s+\d+)\b'
)
_STAGE_DIAG_EXCLUDE_RE = re.compile(r'(?i)\b(nâng\s+cấp|thêm\s+tính\s+năng|tạo\s+mới|thiết\s+kế)\b')
_STAGE_VERIF_EXCLUDE_RE = re.compile(r'(?i)\b(tạo|thêm|viết|nâng\s+cấp|dựng|sửa|cập\s+nhật|chỉnh)\b')
_STAGE_EXPLORE_EXCLUDE_RE = re.compile(r'(?i)\b(sửa|viết\s+code|implement|làm\s+luôn|tạo)\b')
_STAGE_ACTION_SHORT_RE = re.compile(r'(?i)\b(chạy|deploy|commit|push|restart|test)\b')

# Weights sum cleanly to 100 across 6 core dimensions (safety adjusts dynamically when risky ops detected)
_STAGE_DIM_WEIGHTS: dict[str, dict[str, int]] = {
    'exploration': {'goal': 28, 'context': 28, 'boundaries': 10, 'constraints': 10, 'output_format': 16, 'verification': 8},
    'diagnosis': {'goal': 20, 'context': 32, 'boundaries': 12, 'constraints': 12, 'output_format': 8, 'verification': 16},
    'execution': {'goal': 22, 'context': 22, 'boundaries': 18, 'constraints': 14, 'output_format': 6, 'verification': 18},
    'verification': {'goal': 22, 'context': 22, 'boundaries': 12, 'constraints': 12, 'output_format': 10, 'verification': 22},
    'reusable_workflow': {'goal': 22, 'context': 16, 'boundaries': 16, 'constraints': 16, 'output_format': 16, 'verification': 14},
    'action': {'goal': 34, 'context': 22, 'boundaries': 14, 'constraints': 10, 'output_format': 6, 'verification': 14},
}


_STAGE_EARNED_FULL: dict[str, dict[str, int]] = {
    st: {dk: int(round(w * 0.64)) for dk, w in wmap.items()}
    for st, wmap in _STAGE_DIM_WEIGHTS.items()
}
_STAGE_EARNED_PARTIAL: dict[str, dict[str, int]] = {
    st: {
        'output_format': int(round(wmap['output_format'] * 0.35)) if st in ('execution', 'diagnosis', 'action') else 0,
        'constraints': int(round(wmap['constraints'] * 0.35)) if st in ('exploration', 'action') else 0,
    }
    for st, wmap in _STAGE_DIM_WEIGHTS.items()
}
_WORKFLOW_HINTS = ('quy trình', 'workflow', 'skill', 'template', 'mẫu prompt', 'agents.md', 'chuẩn hóa', 'cron', 'hook', 'tự động hóa', 'playbook', '{{')
_RISKY_HINTS = ('deploy', 'push', 'force', 'sync_vps', 'drop ', 'truncate', 'alter ', 'migrat', 'systemctl', 'nginx', 'rm -', 'xóa ', 'delete ', 'restart ', 'production', 'prod', '.env')


def detect_prompt_stage(
    text: str,
    idx: int = 1,
    is_short_nudge: bool = False,
    is_vague_error: bool = False,
    is_question_reply: bool = False,
    goal_type: str = '',
    *,
    _low: str | None = None,
) -> str:
    """Phân loại 1 trong 6 giai đoạn Prompt để áp trọng số 6×7 Rubric phù hợp ngữ cảnh."""
    stripped = text if _low is not None else (text or '').strip()
    low = _low if _low is not None else stripped.lower()
    chars = len(stripped)
    gt = (goal_type or '').strip().lower() if goal_type else ''
    if is_vague_error or gt == 'bugfix':
        return 'diagnosis'
    if gt == 'audit':
        return 'verification'
    if gt == 'deploy':
        return 'action' if chars < 120 else 'execution'
    if any(h in low for h in _WORKFLOW_HINTS) and _STAGE_WORKFLOW_RE.search(stripped):
        return 'reusable_workflow'
    diag_probe = _NON_BUG_ZERO_ERR_RE.sub(' ', stripped) if 'lỗi' in low else stripped
    if _STAGE_DIAG_RE.search(diag_probe) and not _STAGE_DIAG_EXCLUDE_RE.search(stripped):
        return 'diagnosis'
    if is_question_reply or (not is_short_nudge and chars <= 95 and _STAGE_ACTION_RE.search(stripped)):
        return 'action'
    if chars < 180 and _STAGE_VERIFICATION_RE.search(stripped) and not _STAGE_VERIF_EXCLUDE_RE.search(stripped):
        return 'verification'
    if _STAGE_EXPLORE_RE.search(stripped) and not _STAGE_EXPLORE_EXCLUDE_RE.search(stripped):
        return 'exploration'
    if idx > 1 and not is_short_nudge and chars <= 55 and _STAGE_ACTION_SHORT_RE.search(stripped):
        return 'action'
    return 'execution'


def _score_prompt_rubric(
    text: str,
    *,
    idx: int = 1,
    is_short_nudge: bool = False,
    is_vague_error: bool = False,
    is_corr_kw: bool = False,
    is_question_reply: bool = False,
    has_image: bool = False,
    had_tool_error: bool = False,
    goal_type: str = '',
    target_files: str = '',
) -> dict[str, Any]:
    """Động cơ 6×7 Rubric dùng chung cho cả chấm lịch sử phiên lẫn Xưởng Sửa Nháp."""
    stripped = (text or '').strip()
    low = stripped.lower()
    chars = len(stripped)

    effective_nudge = is_short_nudge
    if effective_nudge and (is_question_reply or (idx > 1 and chars >= 12 and _MEANINGFUL_ACTION_RE.search(stripped))):
        effective_nudge = False

    stage = detect_prompt_stage(
        stripped,
        idx=idx,
        is_short_nudge=effective_nudge,
        is_vague_error=is_vague_error,
        is_question_reply=is_question_reply,
        goal_type=goal_type,
        _low=low,
    )
    stage_label = PROMPT_STAGE_LABELS.get(stage, stage)

    has_goal = (
        chars >= 28
        or 'http' in low
        or (stage == 'action' and (is_question_reply or not effective_nudge))
    ) and not effective_nudge
    has_context = (
        bool(target_files and target_files.strip())
        or has_image
        or (idx > 1 and (chars >= 85 or is_question_reply))
        or bool(_PROMPT_CTX_RE.search(stripped))
    )
    has_boundaries = chars >= 170 or bool(_PROMPT_SCOPE_RE.search(stripped))
    has_constraints = chars >= 210 or bool(_PROMPT_CONSTR_RE.search(stripped))
    has_output_fmt = ('{{' in stripped and '}}' in stripped) or bool(_PROMPT_FMT_RE.search(stripped))
    has_verification = bool(_PROMPT_DONE_RE.search(stripped))

    is_risky = (goal_type.lower() == 'deploy' if goal_type else False) or (
        any(h in low for h in _RISKY_HINTS) and bool(_RISKY_OP_RE.search(stripped))
    )
    has_safety_guard = bool(_SAFETY_GUARD_RE.search(stripped))
    safety_ok = (not is_risky) or has_safety_guard

    dim_flags = {
        'goal': has_goal,
        'context': has_context,
        'boundaries': has_boundaries,
        'constraints': has_constraints,
        'output_format': has_output_fmt,
        'verification': has_verification,
        'safety': safety_ok,
    }
    app_constraints = stage in ('execution', 'reusable_workflow', 'verification') or has_constraints
    app_output_fmt = stage in ('exploration', 'reusable_workflow') or has_output_fmt
    app_verification = stage != 'exploration' or has_verification
    app_safety = is_risky or has_safety_guard
    app_map = {
        'goal': True,
        'context': True,
        'boundaries': True,
        'constraints': app_constraints,
        'output_format': app_output_fmt,
        'verification': app_verification,
        'safety': app_safety,
    }

    checks = [
        {'key': 'goal', 'label': 'Mục tiêu', 'ok': has_goal, 'applicable': True},
        {'key': 'context', 'label': 'File/Ngữ cảnh', 'ok': has_context, 'applicable': True},
        {'key': 'boundaries', 'label': 'Ranh giới', 'ok': has_boundaries, 'applicable': True},
        {'key': 'constraints', 'label': 'Ràng buộc', 'ok': has_constraints, 'applicable': app_constraints},
        {'key': 'output_format', 'label': 'Định dạng trả lời', 'ok': has_output_fmt, 'applicable': app_output_fmt},
        {'key': 'verification', 'label': 'Tiêu chí Done', 'ok': has_verification, 'applicable': app_verification},
        {'key': 'safety', 'label': 'An toàn DB/Deploy', 'ok': safety_ok, 'applicable': app_safety},
    ]

    full_pts = _STAGE_EARNED_FULL.get(stage, _STAGE_EARNED_FULL['execution'])
    part_pts = _STAGE_EARNED_PARTIAL.get(stage, _STAGE_EARNED_PARTIAL['execution'])
    earned = (
        36
        + (full_pts['goal'] if has_goal else 0)
        + (full_pts['context'] if has_context else 0)
        + (full_pts['boundaries'] if has_boundaries else 0)
        + (full_pts['constraints'] if has_constraints else part_pts['constraints'])
        + (full_pts['output_format'] if has_output_fmt else part_pts['output_format'])
        + (full_pts['verification'] if has_verification else 0)
    )

    if effective_nudge:
        earned = min(earned, 32)
    else:
        if stage == 'action' and not is_vague_error and idx > 1:
            earned = max(earned, 78)
        if idx > 1 and not is_vague_error:
            if is_question_reply or (has_goal and has_context and not is_corr_kw and not had_tool_error and chars >= 48):
                earned += 9
            elif chars >= 65:
                earned += 6
    if is_risky and not has_safety_guard:
        earned -= 16
    if is_risky and has_safety_guard:
        earned += 6
    if had_tool_error and not has_context:
        earned -= 6

    score = max(12, min(98, int(earned)))
    dimension_scores = {
        k: (100 if v else (70 if not app_map[k] else 25))
        for k, v in dim_flags.items()
    }
    missing_parts = [
        c['label']
        for c in checks
        if not c['ok'] and (c['applicable'] or c['key'] in ('goal', 'context', 'boundaries', 'verification', 'safety'))
    ]

    return {
        'stage': stage,
        'stage_label': stage_label,
        'score': score,
        'checks': checks,
        'dimension_scores': dimension_scores,
        'missing_parts': missing_parts,
        'safety_risk': bool(is_risky and not has_safety_guard),
        'is_risky': is_risky,
        'has_safety': safety_ok,
        'effective_nudge': effective_nudge,
    }


def synthesize_focus_habit(
    prompts_list: list[dict[str, Any]],
    *,
    tool_error_count: int = 0,
    redirection_count: int = 0,
) -> dict[str, Any]:
    """Rút ra ĐÚNG 1 Thói quen ưu tiên cần rèn (Prompt-sensei style) dựa trên điểm yếu lặp lại nhiều nhất."""
    total = len(prompts_list)
    if total == 0:
        return {
            'code': 'ON_DINH',
            'title': 'Duy trì Spec 1-Phát ở câu mở đầu',
            'why': 'Chưa có đủ câu prompt lỗi để cảnh báo.',
            'action_tip': 'Tiếp tục chốt File + Ranh giới + Tiêu chí Done ngay câu #1.',
            'fail_count': 0,
            'hit_rate_pct': 0.0,
        }

    counters: dict[str, int] = {
        'safety': 0,
        'verification': 0,
        'context': 0,
        'boundaries': 0,
        'nudge_drip': 0,
        'vague_error': 0,
    }
    for p in prompts_list:
        if p.get('is_short_nudge'):
            counters['nudge_drip'] += 1
        if p.get('is_vague_error'):
            counters['vague_error'] += 1
        for chk in (p.get('checks') or []):
            k = str(chk.get('key') or '')
            if not chk.get('ok') and chk.get('applicable', True) and k in counters:
                counters[k] += 1

    # Priority weight multiplier so safety & vague bugs surface strongly
    weighted = {
        'safety': counters['safety'] * 3.0,
        'vague_error': (counters['vague_error'] + (1 if tool_error_count >= 3 and counters['vague_error'] else 0)) * 2.2,
        'verification': counters['verification'] * 1.35,
        'context': counters['context'] * 1.3,
        'boundaries': counters['boundaries'] * 1.15,
        'nudge_drip': counters['nudge_drip'] * 1.8,
    }
    top_key = max(weighted.keys(), key=lambda k: weighted[k])
    top_cnt = counters[top_key]
    if top_cnt == 0 and redirection_count < 2:
        return {
            'code': 'CHUAN_SPEC',
            'title': 'Giữ phong độ Spec 1-Phát & kiểm chứng định lượng',
            'why': 'Các câu prompt đạt tỷ lệ rõ mục tiêu & ngữ cảnh rất cao.',
            'action_tip': 'Khi phiên vượt >10 câu, nhớ chốt HANDOFF để mở phiên sạch.',
            'fail_count': 0,
            'hit_rate_pct': 0.0,
        }

    meta_map = {
        'safety': (
            'CHOT_RAO_AN_TOAN',
            'Gắn rào an toàn trước mọi lệnh DB / Deploy / Xóa',
            'Phát hiện câu lệnh chạm database, deploy VPS hoặc xóa dữ liệu nhưng chưa nhắc backup/dry-run/scope.',
            'Thêm 1 dòng cố định: "Kiểm tra dry-run/backup trước khi ghi; không tự push hoặc xóa ngoài phạm vi."',
        ),
        'vague_error': (
            'BAO_LOI_KEM_LOG',
            'Dán kèm đường dẫn + lỗi thật khi báo bug',
            'Câu báo lỗi ngắn khiến AI phải đoán mò qua nhiều lượt hoặc làm vấp lỗi tool.',
            'Dùng mẫu: [FILE/URL] + [MÃ LỖI/HTTP STATUS/SCREENSHOT] + [KẾT QUẢ ĐÚNG].',
        ),
        'verification': (
            'CHOT_DIEU_KIEN_DONE',
            'Luôn khóa Tiêu chí Done (Test/Playwright) cuối câu',
            'Nhiều câu thiếu cách kiểm chứng nên phải nhắn thêm lượt để rà lại kết quả.',
            'Chốt thêm câu cuối: "Done: chạy tsc/build + verify kết quả thật rồi mới báo."',
        ),
        'context': (
            'DINH_KEM_FILE_NGU_CANH',
            'Chỉ rõ tên File / Route / Bảng ngay ở câu giao việc',
            'AI mất lượt đầu để dò tìm file thay vì đi thẳng vào xử lý.',
            'Ghi tên file hoặc URL cụ thể ngay dòng 1 trước khi mô tả yêu cầu.',
        ),
        'boundaries': (
            'RAO_RANH_GIOI_CODE',
            'Nêu rõ phần KHÔNG ĐƯỢC SỬA (Ranh giới)',
            'Thiếu ranh giới dễ khiến AI sửa lan sang file khác hoặc đổi hành vi cũ.',
            'Thêm cụm: "Chỉ sửa trong [MODULE X], giữ nguyên dữ liệu/logic cũ."',
        ),
        'nudge_drip': (
            'GOM_SPEC_BO_NHAC_NGAN',
            'Thay câu nhắc "tiếp/ok" bằng 1 câu chốt tự hoàn tất',
            'Gửi nhiều câu nhắc ngắn làm tăng tổng prompt và phình context sớm.',
            'Cuối câu đầu ghi rõ: "Tự làm trọn quy trình cho đến khi test PASS rồi báo kết quả."',
        ),
    }
    code, title, why, tip = meta_map.get(top_key, meta_map['verification'])
    return {
        'code': code,
        'title': title,
        'why': f'{why} ({top_cnt}/{total} câu).',
        'action_tip': tip,
        'fail_count': top_cnt,
        'hit_rate_pct': round(top_cnt * 100.0 / max(1, total), 1),
    }


def _is_ai_analysis_fresh(ai_parsed: Any, content_hash: str, ai_hash: str) -> bool:
    return bool(
        isinstance(ai_parsed, dict)
        and ai_parsed.get('diagnosis')
        and int(ai_parsed.get('schema_v') or 0) >= AI_SCHEMA_VERSION
        and content_hash
        and ai_hash == content_hash
    )


def _prompt_level(score: int) -> str:
    if score >= 80:
        return 'green'
    if score >= 55:
        return 'amber'
    return 'red'


def _build_improved_prompt_fallback(
    txt: str,
    project_hint: str,
    is_short_nudge: bool,
    is_vague_error: bool,
    is_duplicate: bool,
    merge_with: list[int],
    missing_parts: list[str],
    safety_risk: bool = False,
    *,
    stage: str = 'execution',
    score: int = 0,
    recent_files: list[str] | None = None,
    tools_triggered: list[str] | None = None,
    failed_tools: list[str] | None = None,
    assistant_err_snippet: str = '',
    already_redacted: bool = False,
) -> str:
    clean_fn = _trunc_only if already_redacted else redact_sensitive_text
    clean = clean_fn(txt, 380).replace('\n', ' ').strip()
    proj_tag = f' ({project_hint})' if project_hint else ''
    file_ctx = [f for f in (recent_files or []) if f][:3]
    file_str = ', '.join(file_ctx)
    err_clean = clean_fn(assistant_err_snippet, 140).replace('\n', ' ').strip()
    failed_str = ', '.join((failed_tools or [])[:3])
    err_ctx = f'{err_clean} (tool: {failed_str})' if (err_clean and failed_str) else (err_clean or (f'lỗi tại tool {failed_str}' if failed_str else ''))

    if is_duplicate and merge_with:
        return f'[Không cần gửi lại] Đã trùng nội dung với Prompt #{merge_with[0]} — chờ AI xử lý xong #{merge_with[0]} trước khi điều phối tiếp.'
    if is_short_nudge:
        anchor = merge_with[0] if merge_with else 1
        where_note = f' trên {file_str}' if file_str else proj_tag
        return (
            f'[Gộp vào Prompt #{anchor}] Bỏ lượt nhắc lẻ "{clean[:32] or "tiếp"}"; '
            f'chốt sẵn cuối câu #{anchor}: "Tự thực hiện trọn quy trình{where_note}, chạy test xác nhận PASS rồi báo kết quả thật."'
        )
    if is_vague_error:
        where_target = file_str or (f'module vừa sửa{proj_tag}' if proj_tag else 'file/route vừa tác động')
        log_line = err_ctx if err_ctx else 'dán kèm mã lỗi console / HTTP status / dòng traceback cụ thể'
        return (
            f'Mục tiêu: Sửa dứt điểm lỗi tại {where_target} ({clean or "hiện tượng lỗi"}).\n'
            f'Triệu chứng & Log thật: {log_line}.\n'
            f'Phạm vi & Done: Chỉ sửa nguyên nhân gây lỗi trên {where_target}, chạy kiểm thử xác nhận 0 lỗi rồi báo bằng chứng.'
        )
    if merge_with and len(clean) < 120:
        where_note = f' ({file_str})' if file_str else proj_tag
        return (
            f'[Nên gộp ngay vào Prompt #{merge_with[0]}] Bổ sung hạng mục{where_note}: "{clean}" — '
            f'thực hiện đồng bộ cùng lượt sửa & kiểm thử của câu #{merge_with[0]}, giữ nguyên phần khác.'
        )

    if score >= 80 and not safety_risk and not err_ctx:
        if stage == 'action':
            return f'Lượt chốt điều phối gọn rõ ("{clean[:140]}") — giữ nguyên nhịp xác nhận ngắn gọn này.'
        if 'Tiêu chí Done' not in missing_parts:
            return clean

    need_ctx = 'File/Ngữ cảnh' in missing_parts
    need_scope = 'Ranh giới' in missing_parts or 'Phạm vi' in missing_parts
    need_done = 'Tiêu chí Done' in missing_parts
    goal_prefix = '' if clean.lower().startswith('mục tiêu:') else 'Mục tiêu: '
    lines = [f'{goal_prefix}{clean or "[Nêu rõ kết quả mong muốn]"}']
    if need_ctx:
        if file_str:
            lines.append(f'Ngữ cảnh & File{proj_tag}: Tác động đúng {file_str}, giữ nguyên các phần đang chạy ổn.')
        else:
            lines.append(f'Ngữ cảnh & File{proj_tag}: Chỉ rõ đường dẫn file, route hoặc hàm mục tiêu trước khi sửa.')
    elif need_scope:
        scope_target = f' trong {file_str}' if file_str else ''
        lines.append(f'Ranh giới{proj_tag}: Chỉ sửa đúng module liên quan{scope_target}, không đổi logic/dữ liệu ngoài nhiệm vụ.')
    if err_ctx:
        lines.append(f'Log lỗi cần xử lý: {err_ctx}.')
    if safety_risk or 'An toàn DB/Deploy' in missing_parts:
        lines.append('Rào an toàn: Backup/dry-run trước khi ghi DB hoặc thay đổi dịch vụ; không tự push/xóa ngoài phạm vi.')
    if need_done or len(lines) == 1:
        if stage == 'exploration':
            lines.append('Đầu ra kỳ vọng: Tóm tắt cấu trúc kèm đường dẫn file:dòng chính xác.')
        else:
            lines.append('Điều kiện Xong (Done): Chạy build/test/kiểm chứng thực tế đạt 0 lỗi và báo ngắn gọn kết quả đo được.')
    return '\n'.join(lines)


def _push_recent_files(acc: list[str], candidates: list[str]) -> None:
    for raw_f in candidates:
        f = str(raw_f or '').strip().strip('`\'".,;:()[]{}')
        if not f or len(f) < 3:
            continue
        base = f.replace('\\', '/').split('/')[-1]
        if any((x == f or x.replace('\\', '/').split('/')[-1] == base) for x in acc):
            continue
        acc.append(f[:80])
        if len(acc) > 8:
            del acc[0]


def evaluate_prompt_items(
    samples: list[dict[str, Any]] | None,
    settings: dict[str, Any] | None = None,
    ai_analysis: dict[str, Any] | None = None,
    session_ctx: dict[str, Any] | None = None,
    *,
    already_redacted: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Chấm điểm từng câu prompt theo Stage-aware 6×7 Rubric & HRPO Trace (0ms tức thì + merge prompt_reviews từ AI)."""
    items = samples if isinstance(samples, list) else []
    max_p = max(3, int((settings or {}).get('max_prompts_per_session') or 12))
    clean_fn = _trunc_only if already_redacted else redact_sensitive_text
    project_hint = clean_fn((session_ctx or {}).get('project') or '', 80).strip()

    ai_rev_map: dict[int, dict[str, Any]] = {}
    if isinstance(ai_analysis, dict):
        for pr in (ai_analysis.get('prompt_reviews') or []):
            if not isinstance(pr, dict):
                continue
            try:
                p_idx = int(pr.get('idx') or 0)
            except Exception:
                continue
            if p_idx > 0:
                ai_rev_map[p_idx] = pr

    enriched: list[dict[str, Any]] = []
    prev_norm = ''
    prev_words: set[str] = set()
    prev_idx = 0
    stage_counts: dict[str, int] = {}
    recent_files: list[str] = []
    title_str = clean_fn((session_ctx or {}).get('title') or '', 180)
    if title_str and ('.' in title_str or '/' in title_str or '\\' in title_str):
        _push_recent_files(recent_files, _EXTRACT_FILE_RE.findall(title_str))

    for pos, raw in enumerate(items):
        if not isinstance(raw, dict):
            continue
        smp = dict(raw)
        idx = int(smp.get('idx') or (pos + 1))
        smp['idx'] = idx
        txt = clean_fn(smp.get('text_redacted') or '', 1200)
        smp['text_redacted'] = txt
        chars = int(smp.get('chars') or len(txt))
        smp['chars'] = chars
        stripped = txt.strip()
        low = stripped.lower()
        cur_word_list = low.split()
        norm_txt = ' '.join(cur_word_list)

        raw_is_nudge = bool(smp.get('is_short_nudge'))
        is_vague = bool(smp.get('is_vague_error'))
        is_corr = bool(smp.get('is_corr_kw'))
        is_q_reply = bool(smp.get('is_question_reply'))
        has_img = bool(smp.get('has_image'))
        gap_min = float(smp.get('gap_min') or 0.0)
        had_tool_err = bool(smp.get('had_tool_error'))
        tools_trig = [str(t)[:48] for t in (smp.get('tools_triggered') or [])[:6] if t]
        err_snip = clean_fn(smp.get('assistant_err_snippet') or '', 220)
        tool_call_cnt = int(smp.get('tool_call_count') or len(tools_trig))

        # New v4 optional schema fields (100% backward-compatible with older SQLite rows)
        raw_dur = smp.get('turn_duration_s')
        turn_dur: float | None = None
        if raw_dur is not None and raw_dur != '':
            try:
                dv = round(float(raw_dur), 1)
                if dv > 0:
                    turn_dur = dv
            except Exception:
                turn_dur = None
        asst_sum = clean_fn(smp.get('assistant_summary') or '', 180).replace('\n', ' ').strip()
        files_touched = [
            clean_fn(str(f), 80).strip()
            for f in (smp.get('files_touched') or [])[:4]
            if str(f or '').strip()
        ]
        failed_tools = [
            str(t)[:48].strip()
            for t in (smp.get('failed_tools') or [])[:3]
            if str(t or '').strip()
        ]

        # Inherit real files from earlier turns in the same session ONLY for idx > 1 (never spoof idx=1 with project name)
        inherited_files = ', '.join(recent_files[-3:]) if (idx > 1 and recent_files and not raw_is_nudge and not is_vague) else ''

        rubric = _score_prompt_rubric(
            stripped,
            idx=idx,
            is_short_nudge=raw_is_nudge,
            is_vague_error=is_vague,
            is_corr_kw=is_corr,
            is_question_reply=is_q_reply,
            has_image=has_img,
            had_tool_error=had_tool_err,
            target_files=inherited_files,
        )
        is_nudge = bool(rubric.get('effective_nudge', raw_is_nudge))
        smp['is_short_nudge'] = is_nudge
        stage = rubric['stage']
        stage_label = rubric['stage_label']
        stage_counts[stage] = stage_counts.get(stage, 0) + 1
        checks = rubric['checks']
        dim_scores = rubric['dimension_scores']
        missing_parts = rubric['missing_parts']
        safety_risk = rubric['safety_risk']
        score = rubric['score']

        omitted_before = max(0, idx - prev_idx - 1) if prev_idx > 0 else 0
        is_adjacent = prev_idx > 0 and idx == prev_idx + 1
        cur_words = set(cur_word_list) if cur_word_list else set()

        is_dup = False
        if is_adjacent and prev_norm and len(norm_txt) >= 10:
            if norm_txt == prev_norm:
                is_dup = True
            elif abs(len(norm_txt) - len(prev_norm)) <= 40 and cur_words and prev_words:
                if len(cur_words & prev_words) * 2 >= (len(cur_words) + len(prev_words)) * 0.76:
                    sm = difflib.SequenceMatcher(None, norm_txt[:220], prev_norm[:220])
                    if sm.real_quick_ratio() >= 0.86 and sm.quick_ratio() >= 0.86 and sm.ratio() >= 0.86:
                        is_dup = True

        is_drip = bool(
            is_adjacent
            and idx >= 2
            and not is_dup
            and not is_nudge
            and not is_vague
            and not is_q_reply
            and stage != 'action'
            and chars < 140
            and _PROMPT_DRIP_PREFIX_RE.search(stripped)
        )

        merge_with: list[int] = []
        verdict = ''
        lesson = ''

        if is_dup and prev_idx > 0:
            score = min(score, 24)
            merge_with = [prev_idx]
            verdict = f'Trùng câu #{prev_idx}'
            lesson = (
                f'Câu #{idx} lặp lại gần như nguyên văn câu #{prev_idx}. '
                'Chờ AI trả lời xong hoặc bấm dừng/thử lại thay vì gửi đúp làm phình ngữ cảnh.'
            )
        elif is_nudge:
            score = min(score, 32)
            if is_adjacent:
                merge_with = [prev_idx]
            elif prev_idx > 0 and omitted_before == 0:
                merge_with = [prev_idx]
            verdict = 'Nhắc ngắn tốn lượt'
            lesson = (
                f'Câu nhắc "{stripped[:45]}" tốn thêm 1 lượt token vô ích. '
                'Hãy gắn sẵn điều kiện "tự chạy hết quy trình & verify PASS" từ câu giao việc đầu.'
            )
        elif is_vague:
            score = min(score, 38)
            verdict = 'Báo lỗi thiếu log'
            lesson = (
                f'Câu #{idx} báo lỗi nhưng thiếu file/route, thông báo lỗi thật và kỳ vọng đúng, '
                'khiến AI phải đoán mò qua nhiều vòng sửa.'
            )
        elif safety_risk:
            score = min(score, 54)
            verdict = 'Thiếu rào an toàn DB/Deploy'
            lesson = (
                f'Câu #{idx} chạm vùng nhạy cảm (DB/Deploy/Xóa) nhưng chưa nêu backup, dry-run hoặc giới hạn phạm vi an toàn.'
            )
        elif idx == 1 and chars < 60:
            score = min(score, 52)
            verdict = 'Mở đầu mỏng, thiếu Spec'
            lesson = (
                f'Câu mở đầu chỉ có {chars} ký tự — thiếu Ranh giới & Tiêu chí Done nên dễ nở hội thoại. '
                'Nên viết Spec 1-Phát ngay câu #1 (Mục tiêu + File + Ranh giới + Cách test Done).'
            )
        elif is_drip:
            score = min(max(36, score - 18), 64)
            target_m = 1 if idx <= 3 else (prev_idx or 1)
            if target_m != idx:
                merge_with = [target_m]
            verdict = 'Bổ sung nhỏ giọt'
            lesson = (
                f'Yêu cầu nhỏ lẻ "{stripped[:55]}" ở câu #{idx} tách rời khiến AI phải sửa thêm vòng. '
                f'Lẽ ra gộp thẳng vào câu #{target_m} ngay từ đầu.'
            )
        elif is_corr:
            score = max(35, score - 14)
            verdict = 'Phát sinh sửa lại'
            lesson = (
                f'Câu #{idx} phải yêu cầu chỉnh/sửa lại — dấu hiệu câu trước chưa khóa đủ tiêu chí đầu ra hoặc ranh giới.'
            )

        if had_tool_err and err_snip:
            err_note = f'Lượt này phát sinh lỗi tool ({err_snip[:110]}).'
            lesson = f'{lesson} {err_note}'.strip() if lesson else err_note

        # Session length bloat is scored at session level (evaluate_session_rules); only attach non-punitive milestone note
        if idx == max_p + 1:
            over_msg = f'Phiên bắt đầu vượt mốc {max_p}p/phiên — cân nhắc chốt HANDOFF sang phiên mới khi xong chặng này.'
            lesson = f'{lesson} {over_msg}'.strip() if lesson else over_msg

        if not verdict:
            if stage == 'action' and score >= 75:
                verdict = 'Chốt hành động gọn'
            elif score >= 85:
                verdict = 'Gọn rõ chuẩn 1-Phát'
            elif score >= 75:
                verdict = 'Điều phối rõ ràng'
            elif score >= 65:
                verdict = 'Khá rõ, thêm Done là chuẩn'
            elif score >= 55:
                verdict = 'Thiếu ngữ cảnh / Done'
            else:
                verdict = 'Quá ngắn, AI dễ đoán sai'

        if not lesson:
            if score >= 80:
                lesson = 'Câu lệnh rõ mục tiêu và ngữ cảnh, giúp AI đi thẳng vào việc không cần hỏi vòng.'
            elif missing_parts:
                lesson = f'Câu #{idx} ({stage_label}) thiếu {", ".join(missing_parts[:2])}. Bổ sung ngắn 1 dòng để AI không phải hỏi lại hoặc làm sai ý.'
            else:
                lesson = 'Nên nêu rõ file tác động và tiêu chí kiểm chứng cuối câu để chốt gọn trong 1 lượt.'

        score = max(10, min(98, int(score)))

        # Update session-level active file memory AFTER scoring current prompt (so thin #1 stays un-spoofed)
        prompt_files = (
            _EXTRACT_FILE_RE.findall(stripped)
            if ('.' in stripped or '/' in stripped or '\\' in stripped)
            else []
        )
        if prompt_files or files_touched:
            _push_recent_files(recent_files, prompt_files + files_touched)

        turn_file_hints = list(dict.fromkeys(files_touched + prompt_files + recent_files[-3:]))

        ai_scored = False
        root_cause_type = ''
        improved_prompt = ''
        ai_pr = ai_rev_map.get(idx)
        if ai_pr:
            try:
                ai_s = int(ai_pr.get('score') or score)
            except Exception:
                ai_s = score
            score = max(10, min(100, ai_s))
            ai_verdict = redact_sensitive_text(ai_pr.get('verdict') or '', 80).strip()
            ai_lesson = redact_sensitive_text(ai_pr.get('lesson') or '', 400).strip()
            ai_imp = redact_sensitive_text(ai_pr.get('improved_prompt') or '', 1200).strip()
            root_cause_type = str(ai_pr.get('root_cause_type') or '')[:40]
            raw_mw = ai_pr.get('merge_with')
            if isinstance(raw_mw, list):
                cleaned_mw: list[int] = []
                for m_val in raw_mw:
                    try:
                        mi = int(m_val)
                    except Exception:
                        continue
                    if mi > 0 and mi != idx and mi not in cleaned_mw:
                        cleaned_mw.append(mi)
                merge_with = cleaned_mw[:4]
            if ai_verdict:
                verdict = ai_verdict[:80]
            if ai_lesson:
                lesson = ai_lesson
            if ai_imp:
                improved_prompt = ai_imp
            ai_scored = True

        if not improved_prompt:
            improved_prompt = _build_improved_prompt_fallback(
                stripped,
                project_hint=project_hint,
                is_short_nudge=is_nudge,
                is_vague_error=is_vague,
                is_duplicate=is_dup,
                merge_with=merge_with,
                missing_parts=missing_parts,
                safety_risk=safety_risk,
                stage=stage,
                score=score,
                recent_files=turn_file_hints,
                tools_triggered=tools_trig,
                failed_tools=failed_tools,
                assistant_err_snippet=err_snip,
                already_redacted=already_redacted,
            )

        smp['stage'] = stage
        smp['stage_label'] = stage_label
        smp['dimension_scores'] = dim_scores
        smp['tools_triggered'] = tools_trig
        smp['tool_call_count'] = tool_call_cnt
        smp['had_tool_error'] = had_tool_err
        smp['assistant_err_snippet'] = err_snip
        smp['turn_duration_s'] = turn_dur
        smp['assistant_summary'] = asst_sum
        smp['files_touched'] = files_touched
        smp['failed_tools'] = failed_tools
        smp['omitted_before'] = omitted_before
        smp['root_cause_type'] = root_cause_type
        smp['score'] = score
        smp['level'] = _prompt_level(score)
        smp['verdict'] = verdict
        smp['checks'] = checks
        smp['lesson'] = lesson
        smp['improved_prompt'] = improved_prompt
        smp['merge_with'] = merge_with
        smp['ai_scored'] = ai_scored
        enriched.append(smp)

        if norm_txt:
            prev_norm = norm_txt
            prev_words = cur_words
            prev_idx = idx

    if not enriched:
        return [], {
            'avg_prompt_score': 100.0,
            'weak_prompt_count': 0,
            'mergeable_count': 0,
            'ai_scored_count': 0,
            'prompt_scores_mini': [],
            'scored_prompts_preview': [],
            'top_prompt_lesson': '',
            'stage_counts': {},
            'focus_habit': synthesize_focus_habit([]),
        }

    avg_s = round(sum(x['score'] for x in enriched) / len(enriched), 1)
    weak_cnt = sum(1 for x in enriched if x['score'] < 75)
    merge_cnt = sum(1 for x in enriched if x.get('merge_with'))
    ai_cnt = sum(1 for x in enriched if x.get('ai_scored'))

    if len(enriched) <= 24:
        mini_src = enriched
    else:
        head_m = enriched[:12]
        picked_idx = {x['idx'] for x in head_m}
        weak_m = sorted([x for x in enriched[12:-3] if x['idx'] not in picked_idx], key=lambda x: x['score'])[:9]
        for x in weak_m:
            picked_idx.add(x['idx'])
        tail_m = [x for x in enriched[-3:] if x['idx'] not in picked_idx]
        mini_src = sorted(head_m + weak_m + tail_m, key=lambda x: x['idx'])

    mini_pills = [
        {
            'idx': x['idx'],
            'score': x['score'],
            'level': x['level'],
            'verdict': x['verdict'],
            'stage': x['stage'],
            'stage_label': x['stage_label'],
            'had_tool_error': x['had_tool_error'],
            'merge_with': x['merge_with'],
            'ai_scored': x['ai_scored'],
        }
        for x in mini_src
    ]

    if len(enriched) <= 14:
        prev_src = enriched
    else:
        head_p = enriched[:6]
        picked_p = {x['idx'] for x in head_p}
        weak_p = sorted([x for x in enriched[6:-2] if x['idx'] not in picked_p], key=lambda x: x['score'])[:6]
        for x in weak_p:
            picked_p.add(x['idx'])
        tail_p = [x for x in enriched[-2:] if x['idx'] not in picked_p]
        prev_src = sorted(head_p + weak_p + tail_p, key=lambda x: x['idx'])

    scored_preview = [
        {
            'idx': x['idx'],
            'chars': x['chars'],
            'score': x['score'],
            'level': x['level'],
            'stage': x['stage'],
            'stage_label': x['stage_label'],
            'had_tool_error': x['had_tool_error'],
            'tools_triggered': x['tools_triggered'],
            'failed_tools': x['failed_tools'],
            'turn_duration_s': x['turn_duration_s'],
            'assistant_summary': x['assistant_summary'],
            'files_touched': x['files_touched'],
            'verdict': x['verdict'],
            'text_redacted': clean_fn(x['text_redacted'], 260),
            'lesson': x['lesson'],
            'improved_prompt': x['improved_prompt'],
            'merge_with': x['merge_with'],
            'ai_scored': x['ai_scored'],
            'checks': x['checks'],
        }
        for x in prev_src
    ]

    weakest_item = min(enriched, key=lambda x: (x['score'], x['idx']))
    top_lesson = (
        f"Câu #{weakest_item['idx']} ({weakest_item['score']}đ · {weakest_item['verdict']}): {weakest_item['lesson']}"
        if weakest_item['score'] < 85
        else f"Câu #{enriched[0]['idx']} ({enriched[0]['score']}đ): {enriched[0]['lesson']}"
    )
    focus_habit = synthesize_focus_habit(
        enriched,
        tool_error_count=int((session_ctx or {}).get('tool_error_count') or 0),
        redirection_count=int((session_ctx or {}).get('redirection_count') or 0),
    )

    return enriched, {
        'avg_prompt_score': avg_s,
        'weak_prompt_count': weak_cnt,
        'mergeable_count': merge_cnt,
        'ai_scored_count': ai_cnt,
        'prompt_scores_mini': mini_pills,
        'scored_prompts_preview': scored_preview,
        'top_prompt_lesson': top_lesson,
        'stage_counts': stage_counts,
        'focus_habit': focus_habit,
    }


def _extract_json_object(raw_text: str) -> dict[str, Any] | None:
    if not raw_text:
        return None
    s = raw_text.strip()
    if s.startswith('```'):
        s = re.sub(r'^```(?:json)?\s*', '', s, flags=re.I)
        s = re.sub(r'\s*```$', '', s)
    try:
        parsed = json.loads(s)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass
    m = re.search(r'\{.*\}', s, re.S)
    if m:
        try:
            parsed = json.loads(m.group(0))
            return parsed if isinstance(parsed, dict) else None
        except Exception:
            return None
    return None


def _call_llm_json(system_prompt: str, user_prompt: str, max_tokens: int = 1400, timeout_s: int = 25) -> tuple[dict[str, Any] | None, str]:
    """
    Gọi LLM nâng cao (tùy chọn) trên máy thành viên theo thứ tự ưu tiên:
      1. PROMPT_COACH_LLM_URL + PROMPT_COACH_LLM_KEY (OpenAI-compatible / Ollama / LM Studio / OpenRouter)
      2. Antigravity Tools Proxy cục bộ (http://127.0.0.1:8045/v1/chat/completions + proxy.api_key trong ~/.antigravity_tools/gui_config.json)
      3. GEMINI_API_KEY (Google Gemini OpenAI-compatible endpoint)
      4. OPENAI_API_KEY (OpenAI API)
    Nếu chưa cấu hình khóa nào, tự động trả về (None, 'no-ai-key') để chạy bộ chấm 6×7 Rubric Offline 0đ.
    """
    endpoints: list[tuple[str, str, str, int]] = []
    proxy_key = _get_proxy_api_key()
    custom_url = str(os.environ.get('PROMPT_COACH_LLM_URL') or '').strip()
    custom_model = str(os.environ.get('PROMPT_COACH_LLM_MODEL') or '').strip()
    if custom_url:
        endpoints.append((custom_url, proxy_key or 'local', custom_model or 'gemini-2.5-flash', min(timeout_s, 25)))
    elif proxy_key:
        endpoints.append((LOCAL_PROXY_URL, proxy_key, LOCAL_PROXY_MODEL, min(timeout_s, 25)))

    gem_key = str(os.environ.get('GEMINI_API_KEY') or '').strip()
    if gem_key:
        endpoints.append((
            'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
            gem_key,
            custom_model or 'gemini-2.5-flash',
            min(timeout_s, 25),
        ))

    oai_key = str(os.environ.get('OPENAI_API_KEY') or '').strip()
    if oai_key:
        endpoints.append((
            'https://api.openai.com/v1/chat/completions',
            oai_key,
            custom_model or 'gpt-4o-mini',
            min(timeout_s, 25),
        ))

    if not endpoints:
        return None, 'no-ai-key'

    last_err = 'ai-call-failed'
    for url, bearer, model, ep_timeout in endpoints:
        for use_json_fmt in (True, False):
            body_dict: dict[str, Any] = {
                'model': model,
                'temperature': 0.25,
                'max_tokens': max_tokens,
                'messages': [
                    {'role': 'system', 'content': system_prompt},
                    {'role': 'user', 'content': user_prompt},
                ],
            }
            if use_json_fmt:
                body_dict['response_format'] = {'type': 'json_object'}
            payload = json.dumps(body_dict, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                url,
                data=payload,
                method='POST',
                headers={
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': f'Bearer {bearer}',
                    'User-Agent': 'antigravity-prompt-coach-selfhost/1.0',
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=ep_timeout) as resp:
                    raw = json.loads(resp.read().decode('utf-8', errors='replace'))
                content = (
                    (((raw.get('choices') or [{}])[0]).get('message') or {}).get('content')
                    or ''
                )
                parsed = _extract_json_object(content)
                if parsed:
                    return parsed, model
                last_err = f'invalid-json-from-{model}'
                break
            except urllib.error.HTTPError as exc:
                last_err = f'HTTPError {exc.code}: {str(exc.reason)[:100]}'
                if exc.code == 400 and use_json_fmt:
                    continue
                break
            except Exception as exc:
                last_err = f'{type(exc).__name__}: {str(exc)[:120]}'
                break
    return None, last_err


LLMCaller = Callable[[str, str, int, int], tuple[dict[str, Any] | None, str]]


def _select_stratified_ai_samples(samples: list[dict[str, Any]], max_items: int = 18) -> list[dict[str, Any]]:
    """Chọn mẫu phân tầng rải đều toàn phiên, ưu tiên câu lỗi tool -> báo lỗi mơ hồ -> sửa lại -> nhắc ngắn."""
    if len(samples) <= max_items:
        return list(samples)
    head = list(samples[:6])
    seen_idx = {int(x.get('idx') or 0) for x in head}
    tail = [x for x in samples[-2:] if int(x.get('idx') or 0) not in seen_idx]
    for x in tail:
        seen_idx.add(int(x.get('idx') or 0))

    mid_pool = [x for x in samples[6:-2] if int(x.get('idx') or 0) not in seen_idx]
    budget = max(1, max_items - len(head) - len(tail))
    if len(mid_pool) <= budget:
        return sorted(head + mid_pool + tail, key=lambda x: int(x.get('idx') or 0))

    def _hot_rank(item: dict[str, Any]) -> tuple[int, int, int, int, int]:
        return (
            1 if item.get('had_tool_error') else 0,
            1 if item.get('is_vague_error') else 0,
            1 if item.get('is_corr_kw') else 0,
            1 if item.get('is_short_nudge') else 0,
            -int(item.get('chars') or 0),
        )

    n_buckets = min(4, budget, len(mid_pool))
    picked_mid: list[dict[str, Any]] = []
    per_bucket = max(1, budget // n_buckets)
    step = len(mid_pool) / n_buckets
    for b_idx in range(n_buckets):
        start_i = int(round(b_idx * step))
        end_i = int(round((b_idx + 1) * step))
        chunk = mid_pool[start_i:end_i]
        ranked = sorted(chunk, key=_hot_rank, reverse=True)
        for cand in ranked[:per_bucket]:
            c_idx = int(cand.get('idx') or 0)
            if c_idx not in seen_idx:
                seen_idx.add(c_idx)
                picked_mid.append(cand)

    if len(picked_mid) < budget:
        rem = [x for x in mid_pool if int(x.get('idx') or 0) not in seen_idx]
        rem.sort(key=_hot_rank, reverse=True)
        for cand in rem[: budget - len(picked_mid)]:
            seen_idx.add(int(cand.get('idx') or 0))
            picked_mid.append(cand)

    return sorted(head + picked_mid + tail, key=lambda x: int(x.get('idx') or 0))


def analyze_session_with_ai(
    sess_row: dict[str, Any],
    settings: dict[str, Any],
    llm_caller: LLMCaller | None = None,
) -> tuple[dict[str, Any] | None, str]:
    """Phân tích sâu 1 phiên + chấm điểm từng câu Prompt trong mạch hội thoại, rút bài học ngay & đề xuất viết lại."""
    samples = sess_row.get('prompts_sample') or []
    if not samples:
        return None, 'Phiên này chưa có mẫu prompt để AI đọc.'
    caller = llm_caller or _call_llm_json
    max_p = int(settings.get('max_prompts_per_session') or 12)
    max_h = float(settings.get('max_hours_per_session') or 2.0)

    selected_samples = _select_stratified_ai_samples(samples, max_items=18)

    lines = []
    for pos, item in enumerate(selected_samples):
        idx_val = int(item.get('idx') or (pos + 1))
        txt = redact_sensitive_text(item.get('text_redacted') or '', 320).replace('\n', ' ')
        tag = f"#{idx_val} [{item.get('day', '')}]"
        if item.get('is_short_nudge'):
            tag += ' [nhắc ngắn]'
        if item.get('is_vague_error'):
            tag += ' [báo lỗi ngắn]'
        if item.get('is_corr_kw'):
            tag += ' [yêu cầu sửa]'
        trigs = item.get('tools_triggered') or []
        if trigs:
            tag += f" [tools: {','.join(str(x) for x in trigs[:4])}]"
        ftouched = item.get('files_touched') or []
        if ftouched:
            tag += f" [files: {','.join(redact_sensitive_text(str(x), 48) for x in ftouched[:3])}]"
        if item.get('had_tool_error'):
            ftools = item.get('failed_tools') or []
            es = redact_sensitive_text(item.get('assistant_err_snippet') or '', 120).replace('\n', ' ')
            ft_prefix = f"{','.join(str(x) for x in ftools[:2])}: " if ftools else ''
            tag += f" [TOOL ERROR: {ft_prefix}{es or 'error'}]"
        asum = redact_sensitive_text(item.get('assistant_summary') or '', 120).replace('\n', ' ').strip()
        suffix_ai = f' -> AI: {asum}' if asum else ''
        lines.append(f'{tag}: {txt}{suffix_ai}')

    sys_p = (
        'Bạn là Chuyên gia Tối ưu Quy trình Làm việc AI (Prompt & Session Coach) riêng cho Chủ dự án.\n'
        'Nhiệm vụ: đọc mạch hội thoại + trace Assistant/Tool kèm theo để phân tích nguyên nhân gốc kiểu HRPO (lỗi tool/lặp phát sinh từ câu prompt nào) và chấm điểm TỪNG CÂU PROMPT theo Stage-aware 6×7 Rubric (tiếng Việt có dấu, thực tế, không sáo rỗng).\n'
        'Quy tắc chấm mạch hội thoại:\n'
        '- Câu mở đầu (#1) ngắn, thiếu File/Ranh giới/Done -> trừ điểm nặng (35-62đ) và viết lại Spec 1-Phát.\n'
        '- Câu bổ sung nhỏ giọt ("làm thêm...", "cho thêm...") hoặc trùng lặp câu trước -> chỉ rõ merge_with=[số câu nên gộp], điểm <= 60.\n'
        '- Câu nhắc ngắn ("tiếp/ok") hoặc báo lỗi thiếu log -> điểm 20-45, chỉ rõ cách phòng tránh.\n'
        '- Câu chốt hành động ngắn hợp lý sau khi đã bàn rõ -> không trừ oan (75-92đ), trừ khi chạm DB/Deploy mà thiếu rào an toàn.\n'
        '- Khi thấy [TOOL ERROR], liên kết rõ vì sao câu prompt gây lỗi tool (root_cause_type: prompt_ambiguous | missing_safety | environment_error | context_drift).\n'
        'Trả về DUY NHẤT 1 JSON object hợp lệ với cấu trúc:\n'
        '{\n'
        '  "diagnosis": "1-2 câu chỉ rõ nguyên nhân gốc khiến phiên dài, vấp tool hoặc điểm hiệu quả nổi bật",\n'
        '  "split_strategy": "Đề xuất nên chia thành mấy phiên và chốt HANDOFF tại bước nào (hoặc giữ 1 phiên nếu đã gọn)",\n'
        '  "ideal_session_count": 2,\n'
        '  "est_prompts_after": 6,\n'
        '  "key_takeaway": "1 bài học đắt giá nhất nhớ ngay cho lần sau",\n'
        '  "consolidated_prompt": "Bản Gộp Spec 1-Phát tổng hợp mục tiêu mở đầu + các file thật + ràng buộc/sửa hướng phát sinh trong chặng đầu của phiên",\n'
        '  "focus_habit": {"title": "Đúng 1 thói quen ưu tiên cần sửa nhất", "action_tip": "Hành động cụ thể áp dụng ở phiên tới"},\n'
        '  "rewrite_pairs": [\n'
        '    {"weak_original": "Câu gốc trích ngắn", "upgraded_prompt": "Prompt chuẩn 1-Phát viết lại", "why_better": "Lý do cắt được số prompt"}\n'
        '  ],\n'
        '  "prompt_reviews": [\n'
        '    {"idx": 1, "score": 58, "verdict": "Mở đầu thiếu Spec Done", "root_cause_type": "prompt_ambiguous", "lesson": "Bài học cụ thể rút ra ngay từ câu này", "improved_prompt": "Câu viết lại chuẩn 1-Phát bám đúng tên file thật", "merge_with": []}\n'
        '  ]\n'
        '}\n'
        'Chấm đủ toàn bộ các #idx được gửi trong prompt_reviews (tối đa 18 mục), rewrite_pairs tối đa 3 mục. Tuyệt đối không chèn markdown ngoài JSON.'
    )
    user_p = (
        f"Công cụ: {sess_row.get('tool')} | Dự án: {sess_row.get('project') or 'chung'} | Tiêu đề: {sess_row.get('title')}\n"
        f"Số prompt thực: {sess_row.get('n_human_prompts')} (ngưỡng <= {max_p}) | Giờ thực: {sess_row.get('clean_active_hours')}h (ngưỡng < {max_h}h)\n"
        f"Nhắc ngắn: {sess_row.get('n_short_nudges', 0)} | Báo lỗi mơ hồ: {sess_row.get('n_vague_errors', 0)} | Sửa lại: {sess_row.get('n_corr_kw', 0)}\n"
        f"Tool metrics: Tổng tool={sess_row.get('total_tool_calls', 0)} | Tự chủ tối đa={sess_row.get('max_consecutive_tool_calls', 0)} bước/lượt | Lỗi tool={sess_row.get('tool_error_count', 0)} | Chuyển hướng={sess_row.get('redirection_count', 0)}\n"
        'Danh sách từng câu prompt người dùng & trace tool theo thứ tự thời gian (đã che bí mật):\n' + '\n'.join(lines)
    )
    parsed, meta = caller(sys_p, user_p, 4096, 25)
    if not parsed:
        return None, meta
    pairs = []
    for p in (parsed.get('rewrite_pairs') or [])[:3]:
        if isinstance(p, dict) and (p.get('upgraded_prompt') or p.get('weak_original')):
            pairs.append({
                'weak_original': redact_sensitive_text(p.get('weak_original') or '', 260),
                'upgraded_prompt': redact_sensitive_text(p.get('upgraded_prompt') or '', 1200),
                'why_better': redact_sensitive_text(p.get('why_better') or '', 260),
            })
    prompt_reviews: list[dict[str, Any]] = []
    seen_rev_idx: set[int] = set()
    for pr in (parsed.get('prompt_reviews') or [])[:24]:
        if not isinstance(pr, dict):
            continue
        try:
            p_idx = int(pr.get('idx') or 0)
        except Exception:
            continue
        if p_idx <= 0 or p_idx in seen_rev_idx:
            continue
        seen_rev_idx.add(p_idx)
        try:
            p_score = max(10, min(100, int(pr.get('score') or 65)))
        except Exception:
            p_score = 65
        mw_clean: list[int] = []
        raw_mw = pr.get('merge_with')
        if isinstance(raw_mw, list):
            for mv in raw_mw:
                try:
                    mi = int(mv)
                except Exception:
                    continue
                if mi > 0 and mi != p_idx and mi not in mw_clean:
                    mw_clean.append(mi)
        prompt_reviews.append({
            'idx': p_idx,
            'score': p_score,
            'verdict': redact_sensitive_text(pr.get('verdict') or '', 90),
            'root_cause_type': str(pr.get('root_cause_type') or '')[:40],
            'lesson': redact_sensitive_text(pr.get('lesson') or '', 400),
            'improved_prompt': redact_sensitive_text(pr.get('improved_prompt') or '', 1200),
            'merge_with': mw_clean[:4],
        })

    raw_fh = parsed.get('focus_habit')
    focus_habit_ai = None
    if isinstance(raw_fh, dict) and raw_fh.get('title'):
        focus_habit_ai = {
            'title': redact_sensitive_text(raw_fh.get('title') or '', 140),
            'action_tip': redact_sensitive_text(raw_fh.get('action_tip') or '', 220),
        }

    consolidated_prompt = redact_sensitive_text(parsed.get('consolidated_prompt') or '', 1800).strip()
    if not consolidated_prompt and int(sess_row.get('n_human_prompts') or 0) <= max_p and pairs:
        consolidated_prompt = pairs[0].get('upgraded_prompt') or ''

    out = {
        'schema_v': AI_SCHEMA_VERSION,
        'diagnosis': redact_sensitive_text(parsed.get('diagnosis') or '', 500),
        'split_strategy': redact_sensitive_text(parsed.get('split_strategy') or '', 500),
        'ideal_session_count': max(1, min(10, int(parsed.get('ideal_session_count') or 2))),
        'est_prompts_after': max(1, min(50, int(parsed.get('est_prompts_after') or max(3, min(max_p, int(sess_row.get('n_human_prompts') or 6) // 2))))),
        'key_takeaway': redact_sensitive_text(parsed.get('key_takeaway') or '', 300),
        'consolidated_prompt': consolidated_prompt,
        'focus_habit': focus_habit_ai,
        'rewrite_pairs': pairs,
        'prompt_reviews': prompt_reviews,
        'model': meta,
        'analyzed_at': _utc_iso(),
    }
    return out, ''


def _bg_ai_disabled() -> bool:
    return os.environ.get('AG_PROMPT_COACH_DISABLE_BG_AI', '').strip().lower() in ('1', 'true', 'yes')


def get_ai_queue_snapshot() -> dict[str, Any]:
    with _AI_BG_LOCK:
        return {
            'queued': len(_AI_QUEUE),
            'inflight': len(_AI_INFLIGHT),
            'inflight_keys': list(_AI_INFLIGHT),
            'queued_keys': list(_AI_QUEUED_SET),
        }


def analyze_and_persist_session(
    session_key: str,
    force: bool = False,
    llm_caller: LLMCaller | None = None,
    db_path: str | None = None,
) -> tuple[bool, bool, dict[str, Any] | None, str]:
    """Phân tích AI và lưu cache gắn đúng content_hash lúc đọc (tránh ghi đè hash mới nếu phiên vừa thêm prompt)."""
    detail = get_session_detail(session_key, db_path=db_path)
    if not detail:
        return (False, False, None, 'Không tìm thấy phiên.')

    existing_ai = detail.get('ai_analysis') or {}
    analyzed_content_hash = str(detail.get('content_hash') or '')
    if not force and existing_ai.get('diagnosis') and detail.get('ai_is_fresh'):
        return (True, True, existing_ai, '')

    if not detail.get('prompts_sample'):
        return (False, False, None, 'Phiên này chưa có mẫu prompt để AI đọc.')

    con_r = _ensure_coach_db(db_path)
    try:
        settings = get_settings(con_r)
    finally:
        con_r.close()

    ai_res, err = analyze_session_with_ai(detail, settings, llm_caller=llm_caller)
    if not ai_res:
        return (False, False, None, err or 'ai-call-failed')

    with _WRITE_LOCK:
        con = _ensure_coach_db(db_path)
        try:
            con.execute(
                'UPDATE coach_sessions SET ai_hash = ?, ai_analysis_json = ?, updated_at = ? WHERE session_key = ?',
                (analyzed_content_hash, json.dumps(ai_res, ensure_ascii=False), _utc_iso(), session_key),
            )
            con.commit()
        finally:
            con.close()
    return (True, False, ai_res, '')


def _ai_worker_loop(db_path: str | None = None) -> None:
    global _AI_COOLDOWN_UNTIL
    while True:
        skey = ''
        wait_cooldown = 0.0
        with _AI_BG_COND:
            while not _AI_QUEUE:
                _AI_BG_COND.wait(timeout=5.0)
            now_t = time.time()
            if now_t < _AI_COOLDOWN_UNTIL:
                wait_cooldown = min(5.0, _AI_COOLDOWN_UNTIL - now_t)
            else:
                skey = _AI_QUEUE.popleft()
                _AI_QUEUED_SET.discard(skey)
                if skey in _AI_INFLIGHT:
                    skey = ''
                else:
                    _AI_INFLIGHT.add(skey)

        if wait_cooldown > 0.0:
            time.sleep(wait_cooldown)
            continue
        if not skey:
            continue

        ok = False
        err_msg = ''
        try:
            ok, _, _, err_msg = analyze_and_persist_session(skey, force=False, db_path=db_path)
        except Exception as exc:
            err_msg = str(exc)
        finally:
            with _AI_BG_COND:
                _AI_INFLIGHT.discard(skey)
                if not ok:
                    _AI_FAIL_UNTIL[skey] = time.time() + 90.0
                    low = err_msg.lower()
                    if '429' in low or 'rate' in low:
                        _AI_COOLDOWN_UNTIL = time.time() + 10.0
                else:
                    _AI_FAIL_UNTIL.pop(skey, None)
                _AI_BG_COND.notify_all()
        time.sleep(0.15)


def _start_ai_workers_if_needed(db_path: str | None = None) -> None:
    global _AI_WORKERS_STARTED
    if _bg_ai_disabled() or _AI_WORKERS_STARTED:
        return
    with _AI_BG_LOCK:
        if _AI_WORKERS_STARTED:
            return
        _AI_WORKERS_STARTED = True
        for idx in range(_MAX_AI_WORKERS):
            t = threading.Thread(
                target=_ai_worker_loop,
                args=(db_path,),
                name=f'coach-ai-worker-{idx + 1}',
                daemon=True,
            )
            t.start()


def enqueue_realtime_ai(
    session_keys: list[str],
    priority: bool = False,
    db_path: str | None = None,
) -> int:
    """Đưa các phiên chưa phân tích/cũ hash vào hàng đợi AI realtime (chống trùng & backoff lỗi)."""
    if _bg_ai_disabled() or not session_keys:
        return 0
    _start_ai_workers_if_needed(db_path)
    added = 0
    now_t = time.time()
    with _AI_BG_COND:
        for raw_k in session_keys:
            skey = str(raw_k or '').strip()
            if not skey or skey in _AI_INFLIGHT:
                continue
            if priority:
                _AI_FAIL_UNTIL.pop(skey, None)
            elif _AI_FAIL_UNTIL.get(skey, 0.0) > now_t:
                continue
            if skey in _AI_QUEUED_SET:
                if priority:
                    try:
                        _AI_QUEUE.remove(skey)
                        _AI_QUEUE.appendleft(skey)
                    except ValueError:
                        pass
                continue
            if len(_AI_QUEUE) >= 80 and not priority:
                break
            if priority:
                _AI_QUEUE.appendleft(skey)
            else:
                _AI_QUEUE.append(skey)
            _AI_QUEUED_SET.add(skey)
            added += 1
        if added > 0:
            _AI_BG_COND.notify_all()
    return added


def process_realtime_ai_batch(
    period: str = 'today',
    target_date: str | None = None,
    tool_filter: str = 'all',
    limit: int = 8,
    force: bool = False,
    enqueue_remaining: bool = True,
    llm_caller: LLMCaller | None = None,
    db_path: str | None = None,
) -> dict[str, Any]:
    """Chạy đồng bộ trong ngân sách <12s (chống Nginx 504) và đẩy toàn bộ phần còn lại sang worker nền."""
    lim = max(1, min(20, int(limit or 8)))
    sync_cap = min(lim, 2 if (llm_caller is None and enqueue_remaining) else 8)
    start_d, end_d, _ = _resolve_date_window(period, target_date)
    tool_f = (tool_filter or 'all').strip().lower()
    if tool_f not in (*VALID_TOOLS, 'all'):
        tool_f = 'all'

    where_parts = [
        's.is_sub = 0',
        's.is_fork_clone = 0',
        's.n_human_prompts >= 2',
        'LENGTH(s.prompts_sample_json) > 5',
    ]
    params: list[Any] = []
    if start_d and end_d:
        where_parts.append('ds.day >= ? AND ds.day <= ?')
        params.extend([start_d, end_d])
    if tool_f != 'all':
        where_parts.append('ds.tool = ?')
        params.append(tool_f)

    con = _ensure_coach_db(db_path)
    try:
        rows = con.execute(
            f"""
            SELECT s.session_key, s.severity, s.end_ts, s.n_human_prompts,
                   s.content_hash, s.ai_hash, s.ai_analysis_json
            FROM coach_day_sessions ds
            JOIN coach_sessions s ON s.session_key = ds.session_key
            WHERE {' AND '.join(where_parts)}
            GROUP BY s.session_key
            ORDER BY
                CASE s.severity WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END ASC,
                s.end_ts DESC,
                s.n_human_prompts DESC
            """,
            params,
        ).fetchall()
    finally:
        con.close()

    targets: list[str] = []
    for r in rows:
        if force:
            targets.append(str(r['session_key']))
            continue
        c_hash = str(r['content_hash'] or '')
        a_hash = str(r['ai_hash'] or '')
        try:
            parsed_ai = json.loads(r['ai_analysis_json'] or '{}')
        except Exception:
            parsed_ai = {}
        if not _is_ai_analysis_fresh(parsed_ai, c_hash, a_hash):
            targets.append(str(r['session_key']))

    analyzed_now = 0
    failed = 0
    processed_slots = 0
    analyzed_keys: list[str] = []
    errors: list[str] = []
    batch_t0 = time.monotonic()
    for skey in targets[:sync_cap]:
        if processed_slots >= 1 and (time.monotonic() - batch_t0) >= 12.0:
            break
        processed_slots += 1
        ok, _, _, err = analyze_and_persist_session(
            skey,
            force=force,
            llm_caller=llm_caller,
            db_path=db_path,
        )
        if ok:
            analyzed_now += 1
            analyzed_keys.append(skey)
        else:
            failed += 1
            if err:
                errors.append(f'{skey}: {err[:120]}')

    rem_keys = targets[processed_slots:]
    enqueued_rem = 0
    if enqueue_remaining and rem_keys:
        enqueued_rem = enqueue_realtime_ai(rem_keys[:50], priority=True, db_path=db_path)

    return {
        'ok': True,
        'matched_pending': len(targets),
        'analyzed_now': analyzed_now,
        'analyzed_keys': analyzed_keys,
        'failed': failed,
        'remaining_enqueued': enqueued_rem,
        'remaining_pending': max(0, len(targets) - analyzed_now),
        'errors': errors[:5],
    }


_VAR_PLACEHOLDER_RE = re.compile(r'\{\{([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF -]{1,40})\}\}')


def _extract_prompt_variables(*texts: str) -> list[str]:
    seen: list[str] = []
    for txt in texts:
        for m in _VAR_PLACEHOLDER_RE.finditer(txt or ''):
            name = m.group(1).strip()
            if name and name not in seen:
                seen.append(name)
    return seen[:12]


def _build_clarifying_questions(
    rubric: dict[str, Any],
    clarifications: dict[str, str],
    goal_type: str,
) -> list[dict[str, Any]]:
    """Tạo tối đa 3 câu hỏi làm rõ thông minh khi nháp thiếu ngữ cảnh/Done/an toàn."""
    dim = rubric.get('dimension_scores') or {}
    qs: list[dict[str, Any]] = []
    if dim.get('context', 100) < 70 and not (clarifications.get('target_scope') or '').strip():
        qs.append({
            'id': 'target_scope',
            'question': 'Nhiệm vụ này tác động đúng file, route hay bảng dữ liệu nào?',
            'placeholder': 'Ví dụ: scripts/ag_owner_prompt_coach.py hoặc /admin',
            'suggestions': [
                'Frontend UI (React/Tailwind)',
                'Backend Python API + SQLite',
                'Chưa rõ — để AI đọc code dò file trước khi sửa',
            ],
        })
    if dim.get('verification', 100) < 70 and not (clarifications.get('done_criteria') or '').strip():
        qs.append({
            'id': 'done_criteria',
            'question': 'Điều kiện Xong (Done) anh muốn AI bắt buộc tự kiểm chứng?',
            'placeholder': 'Ví dụ: Chạy tsc + build + unit test PASS',
            'suggestions': [
                'Chạy tsc + vite build + unit test PASS 100%',
                'Test HTTP API thật (403/200) & 0 lỗi console',
                'Chụp Playwright Desktop 1440px & Mobile 390px',
            ],
        })
    if (rubric.get('safety_risk') or (goal_type or '').lower() == 'deploy') and not (clarifications.get('safety_guard') or '').strip():
        qs.append({
            'id': 'safety_guard',
            'question': 'Rào an toàn cho DB / Production / Deploy?',
            'placeholder': 'Ví dụ: Backup DB trước, không tự push production',
            'suggestions': [
                'Backup / dry-run trước khi ghi; chỉ test local',
                'Giữ nguyên dữ liệu cũ, tương thích ngược schema',
            ],
        })
    elif dim.get('boundaries', 100) < 70 and len(qs) < 3 and not (clarifications.get('boundaries') or '').strip():
        qs.append({
            'id': 'boundaries',
            'question': 'Phần nào TUYỆT ĐỐI giữ nguyên không được sửa?',
            'placeholder': 'Ví dụ: Không chạm các tab khác, giữ auth owner-only',
            'suggestions': [
                'Chỉ sửa đúng phần liên quan, không chạm module khác',
                'Giữ nguyên API & auth 403/200 hiện tại',
            ],
        })
    return qs[:3]


def optimize_draft_prompt(
    draft: str,
    tool: str = 'all',
    goal_type: str = 'feature',
    target_files: str = '',
    clarifications: dict[str, Any] | None = None,
    refine_mode: str = '',
    llm_caller: LLMCaller | None = None,
) -> dict[str, Any]:
    """Chấm điểm 6×7 Rubric & viết lại nháp Prompt tương tác (hỗ trợ Clarifying + Tinh chỉnh 1-bấm)."""
    clean_draft = redact_sensitive_text(draft, 3500).strip()
    if len(clean_draft) < 4:
        raise ValueError('Vui lòng nhập nội dung nháp Prompt ít nhất 4 ký tự.')

    clean_files = redact_sensitive_text(target_files, 300).strip()
    clean_clar: dict[str, str] = {}
    if isinstance(clarifications, dict):
        for k, v in list(clarifications.items())[:8]:
            ks = str(k or '')[:40].strip()
            vs = redact_sensitive_text(v or '', 300).strip()
            if ks and vs:
                clean_clar[ks] = vs
    rmode = str(refine_mode or '').strip().lower()
    if rmode not in ('', 'shorter', 'safer', 'stricter_done'):
        rmode = ''

    # Merge clarifications into synthetic evaluation preview if provided so score reflects enriched draft
    clar_notes = '\n'.join(f'- {k}: {v}' for k, v in clean_clar.items())
    rubric = _score_prompt_rubric(
        clean_draft if not clar_notes else f'{clean_draft}\n{clar_notes}',
        idx=1,
        goal_type=goal_type,
        target_files=clean_files,
    )
    checklist = rubric['checks']
    rule_score = rubric['score']
    missing_labels = rubric['missing_parts']
    clarifying_qs = _build_clarifying_questions(rubric, clean_clar, goal_type)

    target_file_txt = clean_files or clean_clar.get('target_scope') or '{{ten_file_hoac_route}}'
    done_txt = clean_clar.get('done_criteria') or 'Chạy build/typecheck/unit test thực tế PASS (0 lỗi console) và báo kết quả đo thật.'
    bound_txt = clean_clar.get('boundaries') or 'Chỉ sửa đúng module liên quan; giữ nguyên phần đang ổn và dữ liệu hiện có.'
    safety_line = clean_clar.get('safety_guard') or (
        'Backup / dry-run trước khi ghi DB hoặc chạy lệnh thay đổi dịch vụ; không tự push khi chưa nghiệm thu.'
        if (rubric['safety_risk'] or rmode == 'safer' or goal_type == 'deploy')
        else ''
    )

    if rmode == 'stricter_done':
        done_txt = f'{done_txt} Bắt buộc ghi rõ file đã sửa, lệnh kiểm chứng và kết quả từng ca.'

    if rmode == 'shorter':
        fallback_compact = (
            f"Mục tiêu: {clean_draft}\n"
            f"File/Phạm vi: {target_file_txt} ({bound_txt})\n"
            + (f"An toàn: {safety_line}\n" if safety_line else '')
            + f"Done: {done_txt}"
        )
    else:
        fallback_compact = (
            f"Mục tiêu: {clean_draft}\n"
            f"Phạm vi file: {target_file_txt} — {bound_txt}\n"
            + (f"Rào an toàn: {safety_line}\n" if safety_line else '')
            + f"Nghiệm thu Done: {done_txt}"
        )

    fallback_full = (
        f"### 1. Mục tiêu cần đạt ({rubric['stage_label']})\n{clean_draft}\n\n"
        f"### 2. Ngữ cảnh & Ranh giới cho phép ({tool.upper()})\n"
        f"- Đường dẫn / Route mục tiêu: {target_file_txt}\n"
        f"- Ranh giới không chạm: {bound_txt}\n"
        + (f"- Rào an toàn bắt buộc: {safety_line}\n" if safety_line else '')
        + "\n### 3. Tiêu chí Xong (Definition of Done)\n"
        f"- {done_txt}\n"
        "- Trả lời ngắn gọn: nguyên nhân/cấu trúc, file đã sửa, lệnh kiểm chứng vừa chạy và bằng chứng thật."
    )

    refine_hint = {
        '': 'Viết tự nhiên, súc tích, chuẩn 1-Shot Spec.',
        'shorter': 'TINH CHỈNH NGẮN GỌN HƠN (~40% chữ ngắn hơn) nhưng giữ đủ File + Ranh giới + Done.',
        'safer': 'BỔ SUNG RÀO AN TOÀN CHẶT CHẼ (backup, dry-run, không xóa dữ liệu, không tự push/deploy).',
        'stricter_done': 'SIẾT TIÊU CHÍ NGHIỆM THU DONE ĐỊNH LƯỢNG (lệnh test, 403/200, Mobile/Desktop 0 lỗi, bằng chứng thật).',
    }[rmode]

    caller = llm_caller or _call_llm_json
    sys_p = (
        'Bạn là trợ lý tối ưu câu lệnh AI (Prompt Optimizer) cho kỹ sư & chủ dự án.\n'
        'Nhận nháp prompt tiếng Việt thô, hãy chấm theo Stage-aware 6×7 Rubric và viết lại thành Prompt 1-Phát cực rõ ràng để AI làm xong trong 1–3 lượt, không phải nhắc lại.\n'
        f'Yêu cầu chế độ: {refine_hint}\n'
        'Nếu người dùng chưa điền tên file/tham số cụ thể, dùng placeholder dạng {{ten_bien}} để có thể lưu tái sử dụng vào Kho Prompt.\n'
        'Trả về DUY NHẤT JSON object:\n'
        '{\n'
        '  "score": 45,\n'
        '  "weaknesses": ["Điểm yếu 1", "Điểm yếu 2"],\n'
        '  "compact_prompt": "Bản Gọn 1-Phát (3-5 dòng sắc nét, giữ đúng ý anh)",\n'
        '  "full_spec_prompt": "Bản Kỹ 1-Shot Spec (đủ Mục tiêu, File, Ranh giới, An toàn nếu có, Tiêu chí Test Done)",\n'
        '  "estimated_prompts_saved": "Giảm khoảng từ 10-15 prompt xuống 2-4 prompt"\n'
        '}'
    )
    user_p = (
        f"Công cụ đích: {tool} | Giai đoạn: {rubric['stage_label']} | Loại việc: {goal_type} | File/Route gợi ý: {clean_files or 'không ghi'}\n"
        + (f"Thông tin làm rõ chủ dự án vừa bổ sung:\n{clar_notes}\n" if clar_notes else '')
        + f'Nháp gốc của anh:\n{clean_draft}'
    )
    parsed, model_or_err = caller(sys_p, user_p, 1600, 35)
    if parsed and (parsed.get('compact_prompt') or parsed.get('full_spec_prompt')):
        compact_out = redact_sensitive_text(parsed.get('compact_prompt') or fallback_compact, 2400)
        full_out = redact_sensitive_text(parsed.get('full_spec_prompt') or fallback_full, 3600)
        return {
            'ok': True,
            'ai_used': True,
            'model': model_or_err,
            'stage': rubric['stage'],
            'stage_label': rubric['stage_label'],
            'score_before': max(10, min(98, int(parsed.get('score') or rule_score))),
            'checklist': checklist,
            'dimension_scores': rubric['dimension_scores'],
            'safety_warning': rubric['safety_risk'],
            'clarifying_questions': clarifying_qs,
            'refine_mode': rmode,
            'variables': _extract_prompt_variables(compact_out, full_out),
            'weaknesses': [str(x)[:200] for x in (parsed.get('weaknesses') or missing_labels)[:4]],
            'compact_prompt': compact_out,
            'full_spec_prompt': full_out,
            'estimated_prompts_saved': str(parsed.get('estimated_prompts_saved') or 'Giảm trung bình 40–65% số lượt hỏi qua lại')[:160],
        }

    return {
        'ok': True,
        'ai_used': False,
        'ai_note': f'Đang dùng mẫu chuẩn 1-Shot nội bộ ({model_or_err}).',
        'stage': rubric['stage'],
        'stage_label': rubric['stage_label'],
        'score_before': rule_score,
        'checklist': checklist,
        'dimension_scores': rubric['dimension_scores'],
        'safety_warning': rubric['safety_risk'],
        'clarifying_questions': clarifying_qs,
        'refine_mode': rmode,
        'variables': _extract_prompt_variables(fallback_compact, fallback_full),
        'weaknesses': missing_labels or ['Có thể bổ sung thêm tiêu chí kiểm thử định lượng để AI tự verify trước khi trả lời.'],
        'compact_prompt': fallback_compact,
        'full_spec_prompt': fallback_full,
        'estimated_prompts_saved': 'Đủ Mục tiêu + Ranh giới + Done giúp giảm 2x–3x lượt sửa qua lại.',
    }


def compare_draft_ab(
    original_draft: str,
    optimized_prompt: str,
    tool: str = 'all',
    goal_type: str = 'feature',
    llm_caller: LLMCaller | None = None,
) -> dict[str, Any]:
    """Dry-Run so sánh song song A (Nháp gốc) vs B (Prompt 1-Phát) xem AI sẽ hành xử khác nhau thế nào."""
    clean_a = redact_sensitive_text(original_draft, 2500).strip()
    clean_b = redact_sensitive_text(optimized_prompt, 3500).strip()
    if len(clean_a) < 4 or len(clean_b) < 4:
        raise ValueError('Cần cả Nháp gốc (A) và Prompt tối ưu (B) tối thiểu 4 ký tự để so sánh.')

    rub_a = _score_prompt_rubric(clean_a, idx=1, goal_type=goal_type)
    rub_b = _score_prompt_rubric(clean_b, idx=1, goal_type=goal_type)

    fallback_a = {
        'est_turns': f"{max(4, 10 - rub_a['score'] // 14)}–{max(7, 15 - rub_a['score'] // 10)} lượt",
        'ambiguities': rub_a['missing_parts'] or ['Thiếu rào phạm vi rõ ràng'],
        'predicted_questions_or_errors': [
            'AI phải hỏi lại file/route mục tiêu hoặc tự dò rộng gây tốn lượt.',
            'Nguy cơ bỏ sót kiểm chứng tự động (build/test) -> bạn phải nhắc sửa tiếp.',
        ],
        'plan_steps': [
            'Đoán vùng mã nguồn liên quan từ mô tả ngắn',
            'Sửa thử phần chính nhưng chưa rõ tiêu chí nghiệm thu',
            'Chờ người dùng phản hồi lỗi hoặc bổ sung yêu cầu nhỏ giọt',
        ],
    }
    fallback_b = {
        'est_turns': '1–3 lượt',
        'advantages': [
            f"Rõ giai đoạn ({rub_b['stage_label']}) · Đạt {rub_b['score']}/100đ Rubric",
            'Khóa sẵn ranh giới + tiêu chí Done để AI tự chạy test trước khi báo',
        ],
        'predicted_tool_flow': ['Đọc đúng file mục tiêu', 'Sửa code gọn theo ranh giới', 'Chạy kiểm chứng Done PASS'],
        'plan_steps': [
            'Đọc chính xác file/route được chỉ định',
            'Triển khai trọn vẹn 1 lần theo ràng buộc & rào an toàn',
            'Tự chạy build/test xác nhận PASS và trả báo cáo ngắn gọn',
        ],
    }
    fallback_summary = (
        f"Bản B tăng điểm Rubric từ {rub_a['score']}đ lên {rub_b['score']}đ (+{max(0, rub_b['score'] - rub_a['score'])}đ), "
        f"giúp giảm khoảng 50%–70% số lượt hỏi-đáp và tránh lỗi đoán mò."
    )

    caller = llm_caller or _call_llm_json
    sys_p = (
        'Bạn là bộ giả lập Dry-Run lập kế hoạch thực thi của AI Agent (KHÔNG thực thi thật, chỉ dự đoán kế hoạch phản ứng).\n'
        'Nhận Prompt A (nháp thô) và Prompt B (bản 1-Phát tối ưu), hãy so sánh song song cách AI sẽ hiểu & triển khai cho A vs B.\n'
        'Trả về DUY NHẤT JSON:\n'
        '{\n'
        '  "a_plan": {"est_turns": "6-10 lượt", "ambiguities": ["..."], "predicted_questions_or_errors": ["..."], "plan_steps": ["..."]},\n'
        '  "b_plan": {"est_turns": "1-3 lượt", "advantages": ["..."], "predicted_tool_flow": ["..."], "plan_steps": ["..."]},\n'
        '  "winner_summary": "1-2 câu kết luận súc tích vì sao B cắt được lượt hỏi & rủi ro"\n'
        '}'
    )
    user_p = f'Công cụ: {tool} | Loại việc: {goal_type}\n\n[PROMPT A - GỐC]:\n{clean_a}\n\n[PROMPT B - 1-PHÁT]:\n{clean_b}'
    parsed, model_or_err = caller(sys_p, user_p, 1500, 35)
    if parsed and isinstance(parsed.get('a_plan'), dict) and isinstance(parsed.get('b_plan'), dict):
        ap = parsed['a_plan']
        bp = parsed['b_plan']
        return {
            'ok': True,
            'ai_used': True,
            'model': model_or_err,
            'score_a': rub_a['score'],
            'score_b': rub_b['score'],
            'a_plan': {
                'est_turns': str(ap.get('est_turns') or fallback_a['est_turns'])[:40],
                'ambiguities': [redact_sensitive_text(x, 140) for x in (ap.get('ambiguities') or fallback_a['ambiguities'])[:4]],
                'predicted_questions_or_errors': [redact_sensitive_text(x, 180) for x in (ap.get('predicted_questions_or_errors') or fallback_a['predicted_questions_or_errors'])[:4]],
                'plan_steps': [redact_sensitive_text(x, 180) for x in (ap.get('plan_steps') or fallback_a['plan_steps'])[:5]],
            },
            'b_plan': {
                'est_turns': str(bp.get('est_turns') or fallback_b['est_turns'])[:40],
                'advantages': [redact_sensitive_text(x, 140) for x in (bp.get('advantages') or fallback_b['advantages'])[:4]],
                'predicted_tool_flow': [redact_sensitive_text(x, 60) for x in (bp.get('predicted_tool_flow') or fallback_b['predicted_tool_flow'])[:5]],
                'plan_steps': [redact_sensitive_text(x, 180) for x in (bp.get('plan_steps') or fallback_b['plan_steps'])[:5]],
            },
            'winner_summary': redact_sensitive_text(parsed.get('winner_summary') or fallback_summary, 320),
        }

    return {
        'ok': True,
        'ai_used': False,
        'ai_note': f'Dry-Run giả lập nhanh bằng Rubric nội bộ ({model_or_err}).',
        'score_a': rub_a['score'],
        'score_b': rub_b['score'],
        'a_plan': fallback_a,
        'b_plan': fallback_b,
        'winner_summary': fallback_summary,
    }


def _sanitize_incoming_ai_analysis(inc_ai: dict[str, Any], now_iso: str) -> dict[str, Any]:
    """Làm sạch & redact toàn bộ trường AI analysis gửi từ PC sync trước khi lưu DB."""
    clean_pairs: list[dict[str, str]] = []
    for p in (inc_ai.get('rewrite_pairs') or [])[:3]:
        if isinstance(p, dict) and (p.get('upgraded_prompt') or p.get('weak_original')):
            clean_pairs.append({
                'weak_original': redact_sensitive_text(p.get('weak_original') or '', 260),
                'upgraded_prompt': redact_sensitive_text(p.get('upgraded_prompt') or '', 1200),
                'why_better': redact_sensitive_text(p.get('why_better') or '', 260),
            })

    clean_reviews: list[dict[str, Any]] = []
    seen_ridx: set[int] = set()
    for pr in (inc_ai.get('prompt_reviews') or [])[:24]:
        if not isinstance(pr, dict):
            continue
        try:
            p_idx = int(pr.get('idx') or 0)
        except Exception:
            continue
        if p_idx <= 0 or p_idx in seen_ridx:
            continue
        seen_ridx.add(p_idx)
        try:
            p_score = max(10, min(100, int(pr.get('score') or 65)))
        except Exception:
            p_score = 65
        mw_clean: list[int] = []
        raw_mw = pr.get('merge_with')
        if isinstance(raw_mw, list):
            for mv in raw_mw:
                try:
                    mi = int(mv)
                except Exception:
                    continue
                if mi > 0 and mi != p_idx and mi not in mw_clean:
                    mw_clean.append(mi)
        clean_reviews.append({
            'idx': p_idx,
            'score': p_score,
            'verdict': redact_sensitive_text(pr.get('verdict') or '', 90),
            'root_cause_type': str(pr.get('root_cause_type') or '')[:40],
            'lesson': redact_sensitive_text(pr.get('lesson') or '', 400),
            'improved_prompt': redact_sensitive_text(pr.get('improved_prompt') or '', 1200),
            'merge_with': mw_clean[:4],
        })

    raw_fh = inc_ai.get('focus_habit')
    focus_habit_clean = None
    if isinstance(raw_fh, dict) and raw_fh.get('title'):
        focus_habit_clean = {
            'title': redact_sensitive_text(raw_fh.get('title') or '', 140),
            'action_tip': redact_sensitive_text(raw_fh.get('action_tip') or '', 220),
        }

    return {
        'schema_v': int(inc_ai.get('schema_v') or (AI_SCHEMA_VERSION if clean_reviews else 1)),
        'diagnosis': redact_sensitive_text(inc_ai.get('diagnosis') or '', 500),
        'split_strategy': redact_sensitive_text(inc_ai.get('split_strategy') or '', 500),
        'ideal_session_count': max(1, min(10, int(inc_ai.get('ideal_session_count') or 2))),
        'est_prompts_after': max(1, min(50, int(inc_ai.get('est_prompts_after') or 6))),
        'key_takeaway': redact_sensitive_text(inc_ai.get('key_takeaway') or '', 300),
        'consolidated_prompt': redact_sensitive_text(inc_ai.get('consolidated_prompt') or '', 1800).strip(),
        'focus_habit': focus_habit_clean,
        'rewrite_pairs': clean_pairs,
        'prompt_reviews': clean_reviews,
        'model': str(inc_ai.get('model') or 'pc-sync')[:80],
        'analyzed_at': str(inc_ai.get('analyzed_at') or now_iso)[:32],
    }


def ingest_payload(body: dict[str, Any], owner_uname: str = 'local_member', db_path: str | None = None) -> dict[str, Any]:
    """Nhận batch phiên làm việc đã che bí mật từ PC collector và cập nhật coach_sessions + coach_day_sessions."""
    sessions_in = body.get('sessions')
    if not isinstance(sessions_in, list):
        raise ValueError('Trường sessions phải là mảng.')
    now_iso = _utc_iso()
    today_vn = _vn_today()
    recent_cutoff_day = _shift_vn_day(today_vn, -2)

    # Bước 1: Đọc nhanh settings rồi thực hiện 100% khâu CPU nặng (redact, chuẩn hóa, băm, JSON) NGOÀI _WRITE_LOCK
    con_r = _ensure_coach_db(db_path)
    try:
        initial_settings = get_settings(con_r)
    finally:
        con_r.close()

    prepared_items: list[dict[str, Any]] = []
    for raw in sessions_in[:2500]:
        if not isinstance(raw, dict):
            continue
        tool = str(raw.get('tool') or '').strip().lower()
        sid = str(raw.get('session_id') or '').strip()
        if tool not in VALID_TOOLS or not sid or len(sid) > 160:
            continue
        skey = f'{tool}:{sid}'
        title = redact_sensitive_text(raw.get('title') or '', 180).replace('\n', ' ')
        project = redact_sensitive_text(raw.get('project') or '', 120)
        cwd = redact_sensitive_text(raw.get('cwd') or '', 180)
        first_prev = redact_sensitive_text(raw.get('first_human_preview') or '', 240).replace('\n', ' ')

        raw_samples = raw.get('prompts_sample') or []
        clean_samples: list[dict[str, Any]] = []
        if isinstance(raw_samples, list):
            for smp in raw_samples[:200]:
                if not isinstance(smp, dict):
                    continue
                txt_red = redact_sensitive_text(smp.get('text_redacted') or '', 1200)
                raw_dur = smp.get('turn_duration_s')
                turn_dur: float | None = None
                if raw_dur is not None and raw_dur != '':
                    try:
                        dv = round(float(raw_dur), 1)
                        if dv > 0:
                            turn_dur = dv
                    except Exception:
                        turn_dur = None
                asst_sum = redact_sensitive_text(smp.get('assistant_summary') or '', 180).replace('\n', ' ').strip()
                files_touched = [
                    redact_sensitive_text(str(f), 80).strip()
                    for f in (smp.get('files_touched') or [])[:4]
                    if str(f or '').strip()
                ]
                failed_tools = [
                    str(t)[:48].strip()
                    for t in (smp.get('failed_tools') or [])[:3]
                    if str(t or '').strip()
                ]
                clean_samples.append({
                    'idx': int(smp.get('idx') or 0),
                    'ts_iso': str(smp.get('ts_iso') or '')[:32],
                    'day': str(smp.get('day') or '')[:10],
                    'chars': int(smp.get('chars') or len(txt_red)),
                    'words': int(smp.get('words') or len(txt_red.split())),
                    'gap_min': round(float(smp.get('gap_min') or 0.0), 1),
                    'is_short_nudge': bool(smp.get('is_short_nudge')),
                    'is_vague_error': bool(smp.get('is_vague_error')),
                    'is_corr_kw': bool(smp.get('is_corr_kw')),
                    'is_question_reply': bool(smp.get('is_question_reply')),
                    'has_image': bool(smp.get('has_image')),
                    'tools_triggered': [str(t)[:48] for t in (smp.get('tools_triggered') or [])[:6] if t],
                    'tool_call_count': int(smp.get('tool_call_count') or 0),
                    'had_tool_error': bool(smp.get('had_tool_error')),
                    'assistant_err_snippet': redact_sensitive_text(smp.get('assistant_err_snippet') or '', 220),
                    'turn_duration_s': turn_dur,
                    'assistant_summary': asst_sum,
                    'files_touched': files_touched,
                    'failed_tools': failed_tools,
                    'text_redacted': txt_red,
                })

        start_day = str(raw.get('start_day') or '')[:10] or today_vn
        end_day = str(raw.get('end_day') or start_day)[:10]
        day_breakdown = raw.get('day_breakdown')
        if not isinstance(day_breakdown, list) or not day_breakdown:
            day_breakdown = [{
                'day': start_day,
                'human_prompts': int(raw.get('n_human_prompts') or 0),
                'raw_msgs': int(raw.get('n_raw_msgs') or 0),
                'auto_msgs': int(raw.get('n_auto_msgs') or 0),
                'active_hours': float(raw.get('clean_active_hours') or 0.0),
                'short_nudges': int(raw.get('n_short_nudges') or 0),
                'vague_errors': int(raw.get('n_vague_errors') or 0),
                'corr_kw': int(raw.get('n_corr_kw') or 0),
            }]
        days_list = sorted({str(d.get('day') or '')[:10] for d in day_breakdown if d.get('day')}) or [start_day]

        sess_obj = {
            'n_human_prompts': int(raw.get('n_human_prompts') or 0),
            'clean_active_hours': round(float(raw.get('clean_active_hours') or 0.0), 3),
            'n_short_nudges': int(raw.get('n_short_nudges') or 0),
            'n_vague_errors': int(raw.get('n_vague_errors') or 0),
            'n_corr_kw': int(raw.get('n_corr_kw') or 0),
            'correction_rate': raw.get('correction_rate'),
            'first_human_len': int(raw.get('first_human_len') or 0),
            'total_tool_calls': int(raw.get('total_tool_calls') or 0),
            'max_consecutive_tool_calls': int(raw.get('max_consecutive_tool_calls') or 0),
            'tool_error_count': int(raw.get('tool_error_count') or 0),
            'redirection_count': int(raw.get('redirection_count') or 0),
            'start_day': start_day,
            'end_day': end_day,
            'days': days_list,
        }
        eval_res = evaluate_session_rules(sess_obj, initial_settings)

        hash_basis_obj: dict[str, Any] = {
            'n': sess_obj['n_human_prompts'],
            'head': [x.get('text_redacted', '')[:120] for x in clean_samples[:8]],
            'tail': [x.get('text_redacted', '')[:120] for x in clean_samples[-4:]],
        }
        if sess_obj['tool_error_count'] or sess_obj['redirection_count']:
            hash_basis_obj['te'] = sess_obj['tool_error_count']
            hash_basis_obj['rd'] = sess_obj['redirection_count']
        if len(clean_samples) > 12:
            hash_basis_obj['mid'] = [
                f"{x['idx']}:{x['chars']}:{int(x['had_tool_error'])}"
                for x in clean_samples[8:-4]
            ]
        asst_trace_len = sum(len(x.get('assistant_summary') or '') for x in clean_samples)
        failed_trace_cnt = sum(len(x.get('failed_tools') or ()) for x in clean_samples)
        if asst_trace_len or failed_trace_cnt:
            hash_basis_obj['tr'] = f'{asst_trace_len}:{failed_trace_cnt}'

        hash_basis = json.dumps(hash_basis_obj, ensure_ascii=False, sort_keys=True)
        content_hash = hashlib.sha256(hash_basis.encode('utf-8')).hexdigest()[:16]

        inc_ai = raw.get('ai_analysis')
        clean_inc_ai_obj: dict[str, Any] | None = None
        clean_inc_ai_json = ''
        if isinstance(inc_ai, dict) and inc_ai.get('diagnosis'):
            clean_inc_ai_obj = _sanitize_incoming_ai_analysis(inc_ai, now_iso)
            clean_inc_ai_json = json.dumps(clean_inc_ai_obj, ensure_ascii=False)

        is_sub = 1 if raw.get('is_sub') else 0
        is_fork = 1 if raw.get('is_fork_clone') else 0
        day_tuples: list[tuple[Any, ...]] = []
        if not is_fork:
            for db_row in day_breakdown:
                d_key = str(db_row.get('day') or '')[:10]
                if not d_key:
                    continue
                day_tuples.append((
                    d_key, skey, tool, is_sub,
                    int(db_row.get('human_prompts') or 0),
                    int(db_row.get('raw_msgs') or 0),
                    int(db_row.get('auto_msgs') or 0),
                    round(float(db_row.get('active_hours') or 0.0), 3),
                    int(db_row.get('short_nudges') or 0),
                    int(db_row.get('vague_errors') or 0),
                    int(db_row.get('corr_kw') or 0),
                ))

        start_ts_val = float(raw.get('start_ts') or 0.0)
        end_ts_val = float(raw.get('end_ts') or 0.0)
        last_act_val = max(end_ts_val, float(raw.get('last_activity_ts') or 0.0))
        is_running_val = 1 if raw.get('is_running') else 0
        is_pinned_val = 1 if raw.get('is_pinned') else 0

        prepared_items.append({
            'skey': skey,
            'tool': tool,
            'sid': sid,
            'title': title,
            'project': project,
            'cwd': cwd,
            'is_sub': is_sub,
            'is_fork': is_fork,
            'start_ts': start_ts_val,
            'end_ts': end_ts_val,
            'last_activity_ts': last_act_val,
            'is_running': is_running_val,
            'is_pinned': is_pinned_val,
            'start_day': start_day,
            'end_day': end_day,
            'days_json': json.dumps(days_list),
            'n_raw_msgs': int(raw.get('n_raw_msgs') or 0),
            'n_auto_msgs': int(raw.get('n_auto_msgs') or 0),
            'auto_breakdown_json': json.dumps(raw.get('auto_breakdown') or {}, ensure_ascii=False),
            'wall_hours': round(float(raw.get('wall_hours') or 0.0), 2),
            'busy_hours': round(float(raw.get('busy_hours') or 0.0), 3),
            'n_question_replies': int(raw.get('n_question_replies') or 0),
            'n_with_image': int(raw.get('n_with_image') or 0),
            'avg_human_len': round(float(raw.get('avg_human_len') or 0.0), 1),
            'first_prev': first_prev,
            'correction_rate': raw.get('correction_rate'),
            'sess_obj': sess_obj,
            'eval_res': eval_res,
            'flags_json': json.dumps(eval_res['flags'], ensure_ascii=False),
            'samples_json': json.dumps(clean_samples, ensure_ascii=False),
            'has_samples': bool(clean_samples),
            'content_hash': content_hash,
            'inc_ai_obj': clean_inc_ai_obj,
            'inc_ai_json': clean_inc_ai_json,
            'day_tuples': day_tuples,
        })

    meta_in = body.get('sync_meta') or {}
    meta_rows = [
        ('last_pc_sync_at', str(meta_in.get('synced_at') or now_iso)),
        ('last_pc_sync_owner', owner_uname),
        ('last_pc_duration_s', str(meta_in.get('duration_s') or '')),
        ('hygiene_json', json.dumps(meta_in.get('hygiene') or {}, ensure_ascii=False)),
    ]

    # Bước 2: Giữ _WRITE_LOCK cực ngắn chỉ cho truy vấn batch SQLite thuần túy
    enqueue_keys: list[str] = []
    upserted = 0
    day_rows_written = 0
    with _WRITE_LOCK:
        con = _ensure_coach_db(db_path)
        try:
            settings = get_settings(con)
            settings_changed = (
                settings['max_prompts_per_session'] != initial_settings['max_prompts_per_session']
                or settings['max_hours_per_session'] != initial_settings['max_hours_per_session']
                or settings['max_correction_pct'] != initial_settings['max_correction_pct']
            )
            stale_recent_direct: list[tuple[float, str]] = []
            con.execute('BEGIN IMMEDIATE')

            prev_map: dict[str, tuple[str, str]] = {}
            all_skeys = [it['skey'] for it in prepared_items]
            for i in range(0, len(all_skeys), 900):
                chunk_k = all_skeys[i : i + 900]
                q_marks = ','.join('?' for _ in chunk_k)
                for pr in con.execute(
                    f'SELECT session_key, ai_hash, ai_analysis_json FROM coach_sessions WHERE session_key IN ({q_marks})',
                    chunk_k,
                ).fetchall():
                    prev_map[str(pr['session_key'])] = (str(pr['ai_hash'] or ''), str(pr['ai_analysis_json'] or '{}'))

            session_upsert_params: list[tuple[Any, ...]] = []
            all_day_tuples: list[tuple[Any, ...]] = []

            for it in prepared_items:
                skey = it['skey']
                sess_obj = it['sess_obj']
                if settings_changed:
                    eval_res = evaluate_session_rules(sess_obj, settings)
                    flags_json = json.dumps(eval_res['flags'], ensure_ascii=False)
                else:
                    eval_res = it['eval_res']
                    flags_json = it['flags_json']

                content_hash = it['content_hash']
                prev_pair = prev_map.get(skey)
                ai_hash = prev_pair[0] if prev_pair else ''
                ai_json_str = prev_pair[1] if prev_pair else '{}'

                if it['inc_ai_obj'] is not None:
                    ai_hash = content_hash
                    ai_json_str = it['inc_ai_json']
                    prev_ai_obj = it['inc_ai_obj']
                else:
                    try:
                        prev_ai_obj = json.loads(ai_json_str or '{}')
                    except Exception:
                        prev_ai_obj = {}

                if (
                    not it['is_sub']
                    and not it['is_fork']
                    and it['end_day'] >= recent_cutoff_day
                    and sess_obj['n_human_prompts'] >= 2
                    and it['has_samples']
                    and not _is_ai_analysis_fresh(prev_ai_obj, content_hash, ai_hash)
                ):
                    stale_recent_direct.append((it['last_activity_ts'], skey))

                session_upsert_params.append((
                    skey, it['tool'], it['sid'], it['title'], it['project'], it['cwd'], it['is_sub'], it['is_fork'],
                    it['start_ts'], it['end_ts'],
                    it['start_day'], it['end_day'], it['days_json'],
                    it['n_raw_msgs'], sess_obj['n_human_prompts'], it['n_auto_msgs'],
                    it['auto_breakdown_json'],
                    sess_obj['clean_active_hours'], it['wall_hours'], it['busy_hours'],
                    sess_obj['n_short_nudges'], sess_obj['n_vague_errors'], sess_obj['n_corr_kw'],
                    it['n_question_replies'], it['n_with_image'],
                    sess_obj['first_human_len'], it['avg_human_len'],
                    it['first_prev'], it['correction_rate'],
                    eval_res['rule_score'], eval_res['severity'],
                    flags_json,
                    it['samples_json'],
                    content_hash, ai_hash, ai_json_str,
                    sess_obj['total_tool_calls'], sess_obj['max_consecutive_tool_calls'],
                    sess_obj['tool_error_count'], sess_obj['redirection_count'],
                    it['last_activity_ts'], it['is_running'], it['is_pinned'],
                    now_iso,
                    ai_hash, ai_json_str,
                ))
                all_day_tuples.extend(it['day_tuples'])

            if session_upsert_params:
                con.executemany(
                    """
                    INSERT INTO coach_sessions (
                        session_key, tool, session_id, title, project, cwd, is_sub, is_fork_clone,
                        start_ts, end_ts, start_day, end_day, days_json,
                        n_raw_msgs, n_human_prompts, n_auto_msgs, auto_breakdown_json,
                        clean_active_hours, wall_hours, busy_hours,
                        n_short_nudges, n_vague_errors, n_corr_kw, n_question_replies, n_with_image,
                        first_human_len, avg_human_len, first_human_preview, correction_rate,
                        rule_score, severity, flags_json, prompts_sample_json,
                        content_hash, ai_hash, ai_analysis_json,
                        total_tool_calls, max_consecutive_tool_calls, tool_error_count, redirection_count,
                        last_activity_ts, is_running, is_pinned,
                        updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_key) DO UPDATE SET
                        title = excluded.title,
                        project = excluded.project,
                        cwd = excluded.cwd,
                        is_sub = excluded.is_sub,
                        is_fork_clone = excluded.is_fork_clone,
                        start_ts = excluded.start_ts,
                        end_ts = excluded.end_ts,
                        start_day = excluded.start_day,
                        end_day = excluded.end_day,
                        days_json = excluded.days_json,
                        n_raw_msgs = excluded.n_raw_msgs,
                        n_human_prompts = excluded.n_human_prompts,
                        n_auto_msgs = excluded.n_auto_msgs,
                        auto_breakdown_json = excluded.auto_breakdown_json,
                        clean_active_hours = excluded.clean_active_hours,
                        wall_hours = excluded.wall_hours,
                        busy_hours = excluded.busy_hours,
                        n_short_nudges = excluded.n_short_nudges,
                        n_vague_errors = excluded.n_vague_errors,
                        n_corr_kw = excluded.n_corr_kw,
                        n_question_replies = excluded.n_question_replies,
                        n_with_image = excluded.n_with_image,
                        first_human_len = excluded.first_human_len,
                        avg_human_len = excluded.avg_human_len,
                        first_human_preview = excluded.first_human_preview,
                        correction_rate = excluded.correction_rate,
                        rule_score = excluded.rule_score,
                        severity = excluded.severity,
                        flags_json = excluded.flags_json,
                        prompts_sample_json = excluded.prompts_sample_json,
                        content_hash = excluded.content_hash,
                        ai_hash = ?,
                        ai_analysis_json = ?,
                        total_tool_calls = excluded.total_tool_calls,
                        max_consecutive_tool_calls = excluded.max_consecutive_tool_calls,
                        tool_error_count = excluded.tool_error_count,
                        redirection_count = excluded.redirection_count,
                        last_activity_ts = MAX(coach_sessions.last_activity_ts, excluded.last_activity_ts),
                        is_running = excluded.is_running,
                        is_pinned = excluded.is_pinned,
                        updated_at = excluded.updated_at
                    """,
                    session_upsert_params,
                )
                for i in range(0, len(all_skeys), 900):
                    chunk_k = all_skeys[i : i + 900]
                    q_marks = ','.join('?' for _ in chunk_k)
                    con.execute(f'DELETE FROM coach_day_sessions WHERE session_key IN ({q_marks})', chunk_k)
                if all_day_tuples:
                    con.executemany(
                        """
                        INSERT OR REPLACE INTO coach_day_sessions (
                            day, session_key, tool, is_sub,
                            day_human_prompts, day_raw_msgs, day_auto_msgs, day_active_hours,
                            day_short_nudges, day_vague_errors, day_corr_kw
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        all_day_tuples,
                    )
                upserted = len(session_upsert_params)
                day_rows_written = len(all_day_tuples)

            con.executemany('INSERT OR REPLACE INTO coach_sync_meta (key, value) VALUES (?, ?)', meta_rows)
            con.commit()
            if settings.get('auto_analyze_ai', True) and stale_recent_direct:
                stale_recent_direct.sort(key=lambda x: -x[0])
                enqueue_keys = [k for _, k in stale_recent_direct[:25]]
        except Exception:
            try:
                con.rollback()
            except Exception:
                pass
            raise
        finally:
            con.close()

    enqueued_ai = enqueue_realtime_ai(enqueue_keys, priority=True, db_path=db_path) if enqueue_keys else 0
    return {
        'ok': True,
        'upserted': upserted,
        'day_rows': day_rows_written,
        'enqueued_ai': enqueued_ai,
        'synced_at': now_iso,
    }


def _recompute_all_rule_scores(con: sqlite3.Connection, settings: dict[str, Any]) -> None:
    rows = con.execute(
        """
        SELECT session_key, days_json, start_day, end_day, n_human_prompts, clean_active_hours,
               n_short_nudges, n_vague_errors, n_corr_kw, correction_rate, first_human_len,
               total_tool_calls, max_consecutive_tool_calls, tool_error_count, redirection_count
        FROM coach_sessions
        """
    ).fetchall()
    updates: list[tuple[int, str, str, str]] = []
    for r in rows:
        days = []
        try:
            days = json.loads(r['days_json'] or '[]')
        except Exception:
            pass
        res = evaluate_session_rules({
            'n_human_prompts': r['n_human_prompts'],
            'clean_active_hours': r['clean_active_hours'],
            'n_short_nudges': r['n_short_nudges'],
            'n_vague_errors': r['n_vague_errors'],
            'n_corr_kw': r['n_corr_kw'],
            'correction_rate': r['correction_rate'],
            'first_human_len': r['first_human_len'],
            'total_tool_calls': r['total_tool_calls'],
            'max_consecutive_tool_calls': r['max_consecutive_tool_calls'],
            'tool_error_count': r['tool_error_count'],
            'redirection_count': r['redirection_count'],
            'start_day': r['start_day'],
            'end_day': r['end_day'],
            'days': days,
        }, settings)
        updates.append((
            res['rule_score'],
            res['severity'],
            json.dumps(res['flags'], ensure_ascii=False),
            str(r['session_key']),
        ))
    if updates:
        con.executemany(
            'UPDATE coach_sessions SET rule_score = ?, severity = ?, flags_json = ? WHERE session_key = ?',
            updates,
        )


def _resolve_date_window(period: str, target_date: str | None) -> tuple[str | None, str | None, str]:
    today = _vn_today()
    p = (period or 'today').strip().lower()
    if p == 'date' and target_date and re.fullmatch(r'\d{4}-\d{2}-\d{2}', target_date):
        return target_date, target_date, f'Ngày {target_date}'
    if p == 'today':
        return today, today, f'Hôm nay ({today})'
    if p == 'yesterday':
        y = _shift_vn_day(today, -1)
        return y, y, f'Hôm qua ({y})'
    if p == '7d':
        return _shift_vn_day(today, -6), today, '7 ngày gần đây'
    if p == '30d':
        return _shift_vn_day(today, -29), today, '30 ngày gần đây'
    return None, None, 'Toàn bộ lịch sử'


_RUBRIC_DIM_KEYS = (
    'goal',
    'context',
    'boundaries',
    'constraints',
    'output_format',
    'verification',
    'safety',
)


def _parse_ts_sort(ts_iso: str, fallback_ts: float, idx: int) -> float:
    if ts_iso:
        try:
            clean = ts_iso.strip()
            if clean.endswith('Z'):
                clean = clean[:-1] + '+00:00'
            return dt.datetime.fromisoformat(clean).timestamp()
        except Exception:
            pass
    return float(fallback_ts or 0.0) + idx * 0.001


def _settings_cache_sig(settings: dict[str, Any]) -> tuple[Any, ...]:
    return (
        int(settings.get('max_prompts_per_session') or 12),
        float(settings.get('max_hours_per_session') or 2.0),
        float(settings.get('max_correction_pct') or 10.0),
        AI_SCHEMA_VERSION,
    )


def _empty_prompt_eval_summary() -> dict[str, Any]:
    return {
        'avg_prompt_score': 100.0,
        'weak_prompt_count': 0,
        'mergeable_count': 0,
        'ai_scored_count': 0,
        'prompt_scores_mini': [],
        'scored_prompts_preview': [],
        'top_prompt_lesson': '',
        'stage_counts': {},
        'focus_habit': synthesize_focus_habit([]),
    }


_EVAL_CACHE_LOCK = threading.Lock()
_SESSION_PROMPT_CACHE: OrderedDict[
    tuple[str, str],
    tuple[str, str, tuple[int, int], tuple[Any, ...], bool, dict[str, Any], list[dict[str, Any]], dict[str, Any]],
] = OrderedDict()
_MAX_SESSION_PROMPT_CACHE = 8000


def _peek_cached_session_prompts(
    db_key: str,
    skey: str,
    c_hash: str,
    a_hash: str,
    ai_len: int,
    samples_len: int,
    settings_sig: tuple[Any, ...],
    *,
    shallow_copy: bool = True,
) -> tuple[bool, bool, dict[str, Any], list[dict[str, Any]], dict[str, Any]] | None:
    """Kiểm tra nhanh LRU cache bằng độ dài chuỗi SQLite mà KHÔNG cần đọc cột JSON lớn."""
    cache_key = (db_key, skey)
    with _EVAL_CACHE_LOCK:
        cached = _SESSION_PROMPT_CACHE.get(cache_key)
        if (
            cached
            and cached[0] == c_hash
            and cached[1] == a_hash
            and cached[2] == (ai_len, samples_len)
            and cached[3] == settings_sig
        ):
            _SESSION_PROMPT_CACHE.move_to_end(cache_key)
            ai_obj = dict(cached[5]) if shallow_copy else cached[5]
            ai_fresh = _is_ai_analysis_fresh(ai_obj, c_hash, a_hash)
            prompts_out = [dict(x) for x in cached[6]] if shallow_copy else cached[6]
            stats_out = dict(cached[7]) if shallow_copy else cached[7]
            return (cached[4], ai_fresh, ai_obj, prompts_out, stats_out)
    return None


def _get_or_eval_session_prompts(
    db_key: str,
    r: sqlite3.Row | dict[str, Any],
    settings: dict[str, Any],
    settings_sig: tuple[Any, ...],
    *,
    cache_insert: bool = True,
    shallow_copy: bool = True,
) -> tuple[bool, bool, dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Lấy kết quả chấm 6×7 Rubric từ LRU cache dùng chung (/dashboard, /prompts, /session, /day)."""
    skey = str(r['session_key'])
    c_hash = str(r['content_hash'] or '')
    a_hash = str(r['ai_hash'] or '')
    ai_raw = r['ai_analysis_json'] or '{}'
    samples_raw = r['prompts_sample_json'] or '[]'
    ai_len = len(ai_raw)
    samples_len = len(samples_raw)

    hit = _peek_cached_session_prompts(
        db_key,
        skey,
        c_hash,
        a_hash,
        ai_len,
        samples_len,
        settings_sig,
        shallow_copy=shallow_copy,
    )
    if hit is not None:
        return hit

    cache_key = (db_key, skey)
    try:
        ai_parsed_raw = json.loads(ai_raw)
    except Exception:
        ai_parsed_raw = {}
    ai_parsed = ai_parsed_raw if isinstance(ai_parsed_raw, dict) else {}
    has_ai = bool(ai_parsed.get('diagnosis'))
    ai_fresh = _is_ai_analysis_fresh(ai_parsed, c_hash, a_hash)

    try:
        samples_parsed = json.loads(samples_raw)
    except Exception:
        samples_parsed = []
    if not samples_parsed:
        empty_stats = _empty_prompt_eval_summary()
        return has_ai, ai_fresh, (dict(ai_parsed) if shallow_copy else ai_parsed), [], empty_stats

    enriched_prompts, p_stats = evaluate_prompt_items(
        samples_parsed,
        settings,
        ai_analysis=ai_parsed,
        session_ctx={
            'project': str(r['project'] or ''),
            'title': str(r['title'] or ''),
            'tool_error_count': int(r['tool_error_count'] or 0),
            'redirection_count': int(r['redirection_count'] or 0),
        },
        already_redacted=True,
    )
    sess_end_ts = float(r['end_ts'] or 0.0)
    for ep in enriched_prompts:
        ts_iso = str(ep.get('ts_iso') or '')
        ep['_ts_sort'] = _parse_ts_sort(ts_iso, sess_end_ts, int(ep.get('idx') or 0))

    if cache_insert:
        with _EVAL_CACHE_LOCK:
            if cache_key in _SESSION_PROMPT_CACHE:
                _SESSION_PROMPT_CACHE.move_to_end(cache_key)
            else:
                while len(_SESSION_PROMPT_CACHE) >= _MAX_SESSION_PROMPT_CACHE:
                    _SESSION_PROMPT_CACHE.popitem(last=False)
            _SESSION_PROMPT_CACHE[cache_key] = (
                c_hash,
                a_hash,
                (ai_len, samples_len),
                settings_sig,
                has_ai,
                ai_parsed,
                enriched_prompts,
                p_stats,
            )

    return (
        has_ai,
        ai_fresh,
        dict(ai_parsed) if shallow_copy else ai_parsed,
        [dict(x) for x in enriched_prompts] if shallow_copy else enriched_prompts,
        dict(p_stats) if shallow_copy else p_stats,
    )


def build_dashboard_payload(
    period: str = '7d',
    target_date: str | None = None,
    tool_filter: str = 'all',
    include_sub: bool = True,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db = os.path.abspath(str(db_path or os.environ.get('AG_PROMPT_COACH_DB', COACH_DB_PATH)))
    con = _ensure_coach_db(db_path)
    try:
        settings = get_settings(con)
        settings_sig = _settings_cache_sig(settings)
        start_d, end_d, period_label = _resolve_date_window(period, target_date)
        tool_f = tool_filter.strip().lower() if tool_filter else 'all'
        if tool_f not in (*VALID_TOOLS, 'all'):
            tool_f = 'all'

        where_parts = ['s.is_fork_clone = 0']
        params: list[Any] = []
        if start_d and end_d:
            where_parts.append('ds.day >= ? AND ds.day <= ?')
            params.extend([start_d, end_d])
        if tool_f != 'all':
            where_parts.append('ds.tool = ?')
            params.append(tool_f)
        if not include_sub:
            where_parts.append('ds.is_sub = 0')
        where_sql = ' AND '.join(where_parts)

        # Bước 1: Chỉ đọc các cột số liệu nhẹ theo ngày + độ dài BLOB (0 byte JSON lặp khi warm cache)
        day_rows = con.execute(
            f"""
            SELECT
                ds.day,
                ds.session_key,
                ds.tool,
                ds.is_sub,
                ds.day_human_prompts,
                ds.day_raw_msgs,
                ds.day_auto_msgs,
                ds.day_active_hours,
                ds.day_short_nudges,
                ds.day_vague_errors,
                ds.day_corr_kw,
                s.title,
                s.project,
                s.n_human_prompts AS sess_total_prompts,
                s.clean_active_hours AS sess_total_hours,
                s.rule_score,
                s.severity,
                s.flags_json,
                s.first_human_preview,
                s.first_human_len,
                s.start_day,
                s.end_day,
                s.start_ts,
                s.end_ts,
                s.content_hash AS sess_content_hash,
                s.ai_hash AS sess_ai_hash,
                COALESCE(LENGTH(s.prompts_sample_json), 2) AS samples_len,
                COALESCE(LENGTH(s.ai_analysis_json), 2) AS ai_len,
                s.total_tool_calls,
                s.max_consecutive_tool_calls,
                s.tool_error_count,
                s.redirection_count,
                s.last_activity_ts,
                s.is_running,
                s.is_pinned
            FROM coach_day_sessions ds
            JOIN coach_sessions s ON s.session_key = ds.session_key
            WHERE {where_sql}
            ORDER BY ds.day DESC, COALESCE(NULLIF(s.last_activity_ts, 0), s.end_ts) DESC
            """,
            params,
        ).fetchall()

        max_p = settings['max_prompts_per_session']
        max_h = settings['max_hours_per_session']

        by_day: dict[str, dict[str, Any]] = {}
        seen_sessions: OrderedDict[str, dict[str, Any]] = OrderedDict()
        flag_counter: dict[str, dict[str, Any]] = {}
        totals = {
            'direct_prompts': 0,
            'bg_prompts': 0,
            'auto_ignored': 0,
            'direct_sessions': 0,
            'bg_sessions': 0,
            'active_hours': 0.0,
            'over_limit_sessions': 0,
            'compliant_sessions': 0,
            'short_nudges': 0,
            'vague_errors': 0,
            'corr_kw': 0,
            'total_tool_calls': 0,
            'tool_error_count': 0,
            'redirection_count': 0,
            'weighted_score_sum': 0.0,
            'by_tool': {t: {'prompts': 0, 'sessions': 0, 'hours': 0.0} for t in VALID_TOOLS},
        }
        direct_sess_keys: set[str] = set()
        bg_sess_keys: set[str] = set()
        tool_sess_sets: dict[str, set[str]] = {t: set() for t in VALID_TOOLS}
        spotlight_candidates: list[dict[str, Any]] = []
        all_enriched_prompts: list[dict[str, Any]] = []
        stage_totals: dict[str, int] = {}
        prompt_score_sum = 0.0
        prompt_score_cnt = 0
        weak_prompts_total = 0

        for r in day_rows:
            d = str(r['day'])
            skey = str(r['session_key'])
            tool = str(r['tool'])
            is_sub = int(r['is_sub'] or 0) == 1
            dp = int(r['day_human_prompts'] or 0)
            da = int(r['day_auto_msgs'] or 0)
            dh = float(r['day_active_hours'] or 0.0)
            dn = int(r['day_short_nudges'] or 0)
            dv = int(r['day_vague_errors'] or 0)
            dc = int(r['day_corr_kw'] or 0)
            rscore = int(r['rule_score'] or 100)
            sev = str(r['severity'] or 'green')
            sess_p = int(r['sess_total_prompts'] or 0)
            sess_h = float(r['sess_total_hours'] or 0.0)

            d_entry = by_day.setdefault(d, {
                'day': d,
                'direct_prompts': 0,
                'bg_prompts': 0,
                'auto_ignored': 0,
                'direct_sessions': 0,
                'bg_sessions': 0,
                'active_hours': 0.0,
                'over_limit_sessions': 0,
                'short_nudges': 0,
                'vague_errors': 0,
                'corr_kw': 0,
                'score_sum': 0.0,
                'score_cnt': 0,
                'by_tool': {t: {'prompts': 0, 'sessions': 0, 'hours': 0.0} for t in VALID_TOOLS},
                '_dir_keys': set(),
                '_bg_keys': set(),
                '_over_keys': set(),
            })

            d_entry['auto_ignored'] += da
            totals['auto_ignored'] += da
            if is_sub:
                d_entry['bg_prompts'] += dp
                totals['bg_prompts'] += dp
                d_entry['_bg_keys'].add(skey)
                bg_sess_keys.add(skey)
            else:
                d_entry['direct_prompts'] += dp
                d_entry['active_hours'] = round(d_entry['active_hours'] + dh, 2)
                d_entry['short_nudges'] += dn
                d_entry['vague_errors'] += dv
                d_entry['corr_kw'] += dc
                d_entry['score_sum'] += rscore
                d_entry['score_cnt'] += 1
                d_entry['_dir_keys'].add(skey)
                t_b = d_entry['by_tool'].setdefault(tool, {'prompts': 0, 'sessions': 0, 'hours': 0.0})
                t_b['prompts'] += dp
                t_b['sessions'] += 1
                t_b['hours'] = round(t_b['hours'] + dh, 2)
                if sess_p > max_p or sess_h >= max_h:
                    d_entry['_over_keys'].add(skey)

                totals['direct_prompts'] += dp
                totals['active_hours'] = round(totals['active_hours'] + dh, 2)
                totals['short_nudges'] += dn
                totals['vague_errors'] += dv
                totals['corr_kw'] += dc
                tt = totals['by_tool'].setdefault(tool, {'prompts': 0, 'sessions': 0, 'hours': 0.0})
                tt['prompts'] += dp
                tt['hours'] = round(tt['hours'] + dh, 2)
                tool_sess_sets.setdefault(tool, set()).add(skey)
                direct_sess_keys.add(skey)

                if skey not in seen_sessions:
                    try:
                        flags_parsed = json.loads(r['flags_json'] or '[]')
                    except Exception:
                        flags_parsed = []
                    sess_tools = int(r['total_tool_calls'] or 0)
                    sess_consec = int(r['max_consecutive_tool_calls'] or 0)
                    sess_terrs = int(r['tool_error_count'] or 0)
                    sess_redir = int(r['redirection_count'] or 0)
                    totals['total_tool_calls'] += sess_tools
                    totals['tool_error_count'] += sess_terrs
                    totals['redirection_count'] += sess_redir
                    empty_st = _empty_prompt_eval_summary()
                    raw_end_ts = float(r['end_ts'] or 0.0)
                    raw_act_ts = max(raw_end_ts, float(r['last_activity_ts'] or 0.0))
                    seen_sessions[skey] = {
                        'session_key': skey,
                        'tool': tool,
                        'title': str(r['title'] or ''),
                        'project': str(r['project'] or ''),
                        'start_day': str(r['start_day'] or ''),
                        'end_day': str(r['end_day'] or ''),
                        'start_ts': float(r['start_ts'] or 0.0),
                        'end_ts': raw_end_ts,
                        'last_activity_ts': raw_act_ts,
                        'is_running': bool(int(r['is_running'] or 0)),
                        'is_pinned': bool(int(r['is_pinned'] or 0)),
                        'day_human_prompts': dp,
                        'day_active_hours': round(dh, 2),
                        'period_human_prompts': dp,
                        'period_active_hours': round(dh, 2),
                        'period_short_nudges': dn,
                        'period_vague_errors': dv,
                        'period_corr_kw': dc,
                        'active_days_in_period': 1,
                        'n_human_prompts': sess_p,
                        'clean_active_hours': round(sess_h, 2),
                        'n_short_nudges': dn,
                        'n_vague_errors': dv,
                        'n_corr_kw': dc,
                        'total_tool_calls': sess_tools,
                        'max_consecutive_tool_calls': sess_consec,
                        'tool_error_count': sess_terrs,
                        'redirection_count': sess_redir,
                        'first_human_preview': str(r['first_human_preview'] or ''),
                        'first_human_len': int(r['first_human_len'] or 0),
                        'rule_score': rscore,
                        'severity': sev,
                        'flags': flags_parsed,
                        'has_ai_analysis': False,
                        'ai_is_fresh': False,
                        'ai_analyzing': False,
                        'ai_summary': '',
                        'ai_takeaway': '',
                        'ai_analyzed_at': '',
                        'avg_prompt_score': empty_st['avg_prompt_score'],
                        'weak_prompt_count': empty_st['weak_prompt_count'],
                        'mergeable_count': empty_st['mergeable_count'],
                        'ai_scored_count': empty_st['ai_scored_count'],
                        'prompt_scores_mini': empty_st['prompt_scores_mini'],
                        'scored_prompts_preview': empty_st['scored_prompts_preview'],
                        'top_prompt_lesson': empty_st['top_prompt_lesson'],
                        'focus_habit': empty_st['focus_habit'],
                        'stage_counts': empty_st['stage_counts'],
                        '_has_samples': int(r['samples_len'] or 0) > 5,
                        '_samples_len': int(r['samples_len'] or 0),
                        '_ai_len': int(r['ai_len'] or 0),
                        '_c_hash': str(r['sess_content_hash'] or ''),
                        '_a_hash': str(r['sess_ai_hash'] or ''),
                    }
                    totals['weighted_score_sum'] += rscore
                    if sess_p > max_p or sess_h >= max_h:
                        totals['over_limit_sessions'] += 1
                    else:
                        totals['compliant_sessions'] += 1
                    for fobj in flags_parsed:
                        fc = str(fobj.get('code') or '')
                        if not fc or fc == 'DAT_CHUAN':
                            continue
                        fe = flag_counter.setdefault(fc, {
                            'code': fc,
                            'label': str(fobj.get('label') or fc),
                            'tip': str(fobj.get('tip') or ''),
                            'severity': str(fobj.get('severity') or 'amber'),
                            'count': 0,
                            'prompts_impacted': 0,
                        })
                        fe['count'] += 1
                        fe['prompts_impacted'] += sess_p
                else:
                    s_acc = seen_sessions[skey]
                    s_acc['period_human_prompts'] += dp
                    s_acc['period_active_hours'] = round(s_acc['period_active_hours'] + dh, 2)
                    s_acc['period_short_nudges'] += dn
                    s_acc['period_vague_errors'] += dv
                    s_acc['period_corr_kw'] += dc
                    s_acc['active_days_in_period'] += 1
                    s_acc['day_human_prompts'] = s_acc['period_human_prompts']
                    s_acc['day_active_hours'] = s_acc['period_active_hours']
                    s_acc['n_short_nudges'] = s_acc['period_short_nudges']
                    s_acc['n_vague_errors'] = s_acc['period_vague_errors']
                    s_acc['n_corr_kw'] = s_acc['period_corr_kw']

        # Bổ sung các phiên có hoạt động/chạy vắt qua nửa đêm vào cửa sổ ngày đang xem (giữ nguyên bộ đếm prompt ngày)
        today_str = _vn_today()
        now_epoch = time.time()
        if start_d and end_d:
            try:
                win_start_ts = dt.datetime.strptime(start_d, '%Y-%m-%d').replace(tzinfo=VN_TZ).timestamp()
                win_end_ts = dt.datetime.strptime(end_d, '%Y-%m-%d').replace(tzinfo=VN_TZ).timestamp() + 86400.0
            except Exception:
                win_start_ts, win_end_ts = 0.0, 0.0
            if win_start_ts > 0:
                extra_where = ['s.is_fork_clone = 0', 's.is_sub = 0']
                extra_params: list[Any] = []
                if end_d >= today_str:
                    extra_where.append('((s.last_activity_ts >= ? AND s.last_activity_ts < ?) OR s.is_running = 1)')
                else:
                    extra_where.append('(s.last_activity_ts >= ? AND s.last_activity_ts < ?)')
                extra_params.extend([win_start_ts, win_end_ts])
                if tool_f != 'all':
                    extra_where.append('s.tool = ?')
                    extra_params.append(tool_f)
                extra_rows = con.execute(
                    f"""
                    SELECT
                        s.session_key, s.tool, s.title, s.project,
                        s.n_human_prompts AS sess_total_prompts,
                        s.clean_active_hours AS sess_total_hours,
                        s.rule_score, s.severity, s.flags_json,
                        s.first_human_preview, s.first_human_len,
                        s.start_day, s.end_day, s.start_ts, s.end_ts,
                        s.content_hash AS sess_content_hash,
                        s.ai_hash AS sess_ai_hash,
                        COALESCE(LENGTH(s.prompts_sample_json), 2) AS samples_len,
                        COALESCE(LENGTH(s.ai_analysis_json), 2) AS ai_len,
                        s.total_tool_calls, s.max_consecutive_tool_calls,
                        s.tool_error_count, s.redirection_count,
                        s.last_activity_ts, s.is_running, s.is_pinned
                    FROM coach_sessions s
                    WHERE {' AND '.join(extra_where)}
                    ORDER BY s.last_activity_ts DESC
                    LIMIT 60
                    """,
                    extra_params,
                ).fetchall()
                for er in extra_rows:
                    eskey = str(er['session_key'])
                    if eskey in seen_sessions:
                        continue
                    try:
                        eflags = json.loads(er['flags_json'] or '[]')
                    except Exception:
                        eflags = []
                    empty_st = _empty_prompt_eval_summary()
                    raw_end_ts = float(er['end_ts'] or 0.0)
                    raw_act_ts = max(raw_end_ts, float(er['last_activity_ts'] or 0.0))
                    seen_sessions[eskey] = {
                        'session_key': eskey,
                        'tool': str(er['tool']),
                        'title': str(er['title'] or ''),
                        'project': str(er['project'] or ''),
                        'start_day': str(er['start_day'] or ''),
                        'end_day': str(er['end_day'] or ''),
                        'start_ts': float(er['start_ts'] or 0.0),
                        'end_ts': raw_end_ts,
                        'last_activity_ts': raw_act_ts,
                        'is_running': bool(int(er['is_running'] or 0)),
                        'is_pinned': bool(int(er['is_pinned'] or 0)),
                        'day_human_prompts': 0,
                        'day_active_hours': 0.0,
                        'period_human_prompts': 0,
                        'period_active_hours': 0.0,
                        'period_short_nudges': 0,
                        'period_vague_errors': 0,
                        'period_corr_kw': 0,
                        'active_days_in_period': 1,
                        'n_human_prompts': int(er['sess_total_prompts'] or 0),
                        'clean_active_hours': round(float(er['sess_total_hours'] or 0.0), 2),
                        'n_short_nudges': 0,
                        'n_vague_errors': 0,
                        'n_corr_kw': 0,
                        'total_tool_calls': int(er['total_tool_calls'] or 0),
                        'max_consecutive_tool_calls': int(er['max_consecutive_tool_calls'] or 0),
                        'tool_error_count': int(er['tool_error_count'] or 0),
                        'redirection_count': int(er['redirection_count'] or 0),
                        'first_human_preview': str(er['first_human_preview'] or ''),
                        'first_human_len': int(er['first_human_len'] or 0),
                        'rule_score': int(er['rule_score'] or 100),
                        'severity': str(er['severity'] or 'green'),
                        'flags': eflags,
                        'has_ai_analysis': False,
                        'ai_is_fresh': False,
                        'ai_analyzing': False,
                        'ai_summary': '',
                        'ai_takeaway': '',
                        'ai_analyzed_at': '',
                        'avg_prompt_score': empty_st['avg_prompt_score'],
                        'weak_prompt_count': empty_st['weak_prompt_count'],
                        'mergeable_count': empty_st['mergeable_count'],
                        'ai_scored_count': empty_st['ai_scored_count'],
                        'prompt_scores_mini': empty_st['prompt_scores_mini'],
                        'scored_prompts_preview': empty_st['scored_prompts_preview'],
                        'top_prompt_lesson': empty_st['top_prompt_lesson'],
                        'focus_habit': empty_st['focus_habit'],
                        'stage_counts': empty_st['stage_counts'],
                        '_has_samples': int(er['samples_len'] or 0) > 5,
                        '_samples_len': int(er['samples_len'] or 0),
                        '_ai_len': int(er['ai_len'] or 0),
                        '_c_hash': str(er['sess_content_hash'] or ''),
                        '_a_hash': str(er['sess_ai_hash'] or ''),
                    }

        def _apply_eval_to_session(
            s_item: dict[str, Any],
            has_ai: bool,
            ai_fresh: bool,
            ai_parsed: dict[str, Any],
            enriched_prompts: list[dict[str, Any]],
            p_stats: dict[str, Any],
        ) -> None:
            nonlocal prompt_score_sum, prompt_score_cnt, weak_prompts_total
            skey_local = s_item['session_key']
            s_item['has_ai_analysis'] = has_ai
            s_item['ai_is_fresh'] = ai_fresh
            s_item['ai_summary'] = str(ai_parsed.get('diagnosis') or '')
            s_item['ai_takeaway'] = str(ai_parsed.get('key_takeaway') or '')
            s_item['ai_analyzed_at'] = str(ai_parsed.get('analyzed_at') or '')
            s_item['avg_prompt_score'] = p_stats['avg_prompt_score']
            s_item['weak_prompt_count'] = p_stats['weak_prompt_count']
            s_item['mergeable_count'] = p_stats['mergeable_count']
            s_item['ai_scored_count'] = p_stats['ai_scored_count']
            s_item['prompt_scores_mini'] = p_stats['prompt_scores_mini']
            s_item['scored_prompts_preview'] = p_stats['scored_prompts_preview']
            s_item['top_prompt_lesson'] = p_stats['top_prompt_lesson']
            s_item['focus_habit'] = p_stats.get('focus_habit')
            s_item['stage_counts'] = p_stats.get('stage_counts', {})

            if enriched_prompts:
                all_enriched_prompts.extend(enriched_prompts)
                for st_k, st_v in (p_stats.get('stage_counts') or {}).items():
                    stage_totals[st_k] = stage_totals.get(st_k, 0) + int(st_v or 0)
                prompt_score_sum += float(p_stats['avg_prompt_score'])
                prompt_score_cnt += 1
                weak_prompts_total += int(p_stats['weak_prompt_count'])
                weak_items = sorted(
                    [p for p in enriched_prompts if p['score'] < 75 or p.get('merge_with')],
                    key=lambda x: (x['score'], x['idx']),
                )[:2]
                for wi in weak_items:
                    spotlight_candidates.append({
                        'session_key': skey_local,
                        'session_title': s_item['title'] or s_item['first_human_preview'] or skey_local,
                        'tool': s_item['tool'],
                        'project': s_item['project'],
                        'end_ts': s_item['end_ts'],
                        'idx': wi['idx'],
                        'score': wi['score'],
                        'level': wi['level'],
                        'verdict': wi['verdict'],
                        'stage': wi.get('stage', ''),
                        'stage_label': wi.get('stage_label', ''),
                        'had_tool_error': wi.get('had_tool_error', False),
                        'original_text': _trunc_only(wi['text_redacted'], 240),
                        'lesson': wi['lesson'],
                        'improved_prompt': wi['improved_prompt'],
                        'merge_with': wi['merge_with'],
                        'ai_scored': wi['ai_scored'],
                    })

        # Bước 2: Tra nhanh LRU cache (0 byte đọc BLOB khi warm); chỉ truy vấn cột JSON cho các phiên miss cache
        miss_keys: list[str] = []
        for skey, s_item in seen_sessions.items():
            s_len = int(s_item.pop('_samples_len', 0))
            a_len = int(s_item.pop('_ai_len', 0))
            c_h = str(s_item.pop('_c_hash', ''))
            a_h = str(s_item.pop('_a_hash', ''))
            if s_len <= 5 and a_len <= 5:
                continue
            hit = _peek_cached_session_prompts(
                resolved_db,
                skey,
                c_h,
                a_h,
                a_len,
                s_len,
                settings_sig,
                shallow_copy=False,
            )
            if hit is not None:
                _apply_eval_to_session(s_item, *hit)
            else:
                miss_keys.append(skey)

        for c_pos in range(0, len(miss_keys), 900):
            chunk_k = miss_keys[c_pos : c_pos + 900]
            q_marks = ','.join('?' for _ in chunk_k)
            blob_rows = con.execute(
                f"""
                SELECT session_key, project, title, end_ts, content_hash, ai_hash,
                       prompts_sample_json, ai_analysis_json, tool_error_count, redirection_count
                FROM coach_sessions
                WHERE session_key IN ({q_marks})
                """,
                chunk_k,
            ).fetchall()
            for br in blob_rows:
                skey = str(br['session_key'])
                s_item = seen_sessions.get(skey)
                if not s_item:
                    continue
                eval_tuple = _get_or_eval_session_prompts(
                    resolved_db,
                    br,
                    settings,
                    settings_sig,
                    cache_insert=(c_pos < _MAX_SESSION_PROMPT_CACHE),
                    shallow_copy=False,
                )
                _apply_eval_to_session(s_item, *eval_tuple)

        for t_key, t_set in tool_sess_sets.items():
            totals['by_tool'].setdefault(t_key, {'prompts': 0, 'sessions': 0, 'hours': 0.0})['sessions'] = len(t_set)

        totals['direct_sessions'] = len(direct_sess_keys)
        totals['bg_sessions'] = len(bg_sess_keys)
        n_dir_s = max(1, totals['direct_sessions'])
        totals['avg_prompts_per_session'] = round(totals['direct_prompts'] / n_dir_s, 2) if totals['direct_sessions'] else 0.0
        totals['compliance_pct'] = round(totals['compliant_sessions'] * 100.0 / n_dir_s, 1) if totals['direct_sessions'] else 100.0
        totals['avg_score'] = round(totals['weighted_score_sum'] / n_dir_s, 1) if totals['direct_sessions'] else 100.0
        totals['avg_prompt_score'] = round(prompt_score_sum / prompt_score_cnt, 1) if prompt_score_cnt else 100.0
        totals['weak_prompts_count'] = weak_prompts_total
        totals['est_savable_prompts'] = max(0, sum(max(0, s['n_human_prompts'] - max_p) for s in seen_sessions.values()))

        # Synthesize immediate top lessons across individual weak prompts (diverse sessions, max 2 per session)
        spotlight_candidates.sort(key=lambda c: (-int(bool(c.get('ai_scored'))), int(c.get('score') or 100), -float(c.get('end_ts') or 0.0), int(c.get('idx') or 0)))
        spotlight_final: list[dict[str, Any]] = []
        per_sess_spot: dict[str, int] = {}
        for sc in spotlight_candidates:
            sk = sc['session_key']
            if per_sess_spot.get(sk, 0) >= 2:
                continue
            per_sess_spot[sk] = per_sess_spot.get(sk, 0) + 1
            spotlight_final.append({k: v for k, v in sc.items() if k != 'end_ts'})
            if len(spotlight_final) >= 6:
                break

        # Daily list formatted cleanly
        daily_ai_map = {
            str(r['day']): json.loads(r['summary_json'] or '{}')
            for r in con.execute('SELECT day, summary_json FROM coach_daily_ai').fetchall()
        }
        days_list = []
        for d in sorted(by_day.keys(), reverse=True):
            de = by_day[d]
            dc_cnt = len(de.pop('_dir_keys'))
            bg_cnt = len(de.pop('_bg_keys'))
            ov_cnt = len(de.pop('_over_keys'))
            sc_cnt = de.pop('score_cnt')
            sc_sum = de.pop('score_sum')
            de['direct_sessions'] = dc_cnt
            de['bg_sessions'] = bg_cnt
            de['over_limit_sessions'] = ov_cnt
            de['avg_prompts_per_session'] = round(de['direct_prompts'] / max(1, dc_cnt), 1) if dc_cnt else 0.0
            de['efficiency_score'] = round(sc_sum / max(1, sc_cnt), 1) if sc_cnt else 100.0
            de['daily_ai'] = daily_ai_map.get(d) or None
            days_list.append(de)

        # Live today early-warning alert (sessions active today near or over threshold)
        today_alerts = []
        near_p = max(4, max_p - 2)
        for s in seen_sessions.values():
            act_ts = max(float(s.get('last_activity_ts') or 0.0), float(s.get('end_ts') or 0.0))
            s['last_activity_ts'] = act_ts
            s['is_running'] = bool(s.get('is_running')) and ((now_epoch - act_ts) < 900.0)
            if s['end_day'] == today_str and (s['n_human_prompts'] >= near_p or s['clean_active_hours'] >= max_h * 0.75):
                today_alerts.append({
                    'session_key': s['session_key'],
                    'tool': s['tool'],
                    'title': s['title'] or s['first_human_preview'] or s['session_key'],
                    'n_human_prompts': s['n_human_prompts'],
                    'clean_active_hours': s['clean_active_hours'],
                    'level': 'red' if (s['n_human_prompts'] > max_p or s['clean_active_hours'] >= max_h) else 'amber',
                })
        today_alerts.sort(key=lambda x: (-x['n_human_prompts'], -x['clean_active_hours']))

        # Order sessions by optimization opportunity (severity weight, prompts desc) AND merge top 180 realtime recent sessions so green/1-prompt sessions are never truncated
        sev_rank = {'red': 0, 'amber': 1, 'green': 2}
        sessions_sorted = sorted(
            seen_sessions.values(),
            key=lambda s: (sev_rank.get(s['severity'], 2), -s['n_human_prompts'], -s['clean_active_hours'], -s['last_activity_ts']),
        )
        recent_sorted = sorted(
            seen_sessions.values(),
            key=lambda s: (-int(bool(s.get('is_pinned'))), -int(bool(s.get('is_running'))), -float(s.get('last_activity_ts') or s.get('end_ts') or 0.0)),
        )
        returned_sessions: list[dict[str, Any]] = []
        returned_keys: set[str] = set()
        for s_cand in (*sessions_sorted[:120], *recent_sorted[:200]):
            ck = s_cand['session_key']
            if ck not in returned_keys:
                returned_keys.add(ck)
                returned_sessions.append(s_cand)

        eligible_sessions = [
            s for s in sessions_sorted
            if s['n_human_prompts'] >= 2 and s.get('_has_samples')
        ]
        if settings.get('auto_analyze_ai', True):
            candidate_keys = [s['session_key'] for s in eligible_sessions if not s['ai_is_fresh']][:50]
            if candidate_keys:
                enqueue_realtime_ai(candidate_keys, priority=False, db_path=db_path)

        q_snap = get_ai_queue_snapshot()
        active_q_keys = set(q_snap['inflight_keys']) | set(q_snap['queued_keys'])
        for s in seen_sessions.values():
            s['ai_analyzing'] = (s['session_key'] in active_q_keys) and not s['ai_is_fresh']
            s.pop('_has_samples', None)

        eligible_total = len(eligible_sessions)
        analyzed_fresh = sum(1 for s in eligible_sessions if s['ai_is_fresh'])
        analyzed_any = sum(1 for s in eligible_sessions if s['has_ai_analysis'])

        # Saved private prompts
        saved_rows = con.execute(
            'SELECT * FROM coach_saved_prompts ORDER BY id DESC LIMIT 100'
        ).fetchall()
        saved_prompts = [dict(r) for r in saved_rows]

        # Sync metadata
        meta = {r['key']: r['value'] for r in con.execute('SELECT key, value FROM coach_sync_meta').fetchall()}
        all_days_row = con.execute('SELECT MIN(day) AS min_d, MAX(day) AS max_d, COUNT(DISTINCT day) AS n_d FROM coach_day_sessions').fetchone()

        return {
            'ok': True,
            'period': period,
            'period_label': period_label,
            'start_day': start_d,
            'end_day': end_d,
            'today': today_str,
            'tool': tool_f,
            'settings': settings,
            'totals': totals,
            'focus_habit': synthesize_focus_habit(
                all_enriched_prompts,
                tool_error_count=totals['tool_error_count'],
                redirection_count=totals['redirection_count'],
            ),
            'stage_breakdown': [
                {
                    'stage': k,
                    'label': PROMPT_STAGE_LABELS.get(k, k),
                    'count': v,
                }
                for k, v in sorted(stage_totals.items(), key=lambda kv: -kv[1])
            ],
            'days': days_list,
            'sessions': returned_sessions,
            'total_matching_sessions': len(sessions_sorted),
            'pattern_recommendations': sorted(flag_counter.values(), key=lambda x: (-x['prompts_impacted'], -x['count']))[:8],
            'prompt_lesson_spotlight': spotlight_final,
            'today_alerts': today_alerts[:5],
            'saved_prompts': saved_prompts,
            'ai_realtime': {
                'enabled': bool(settings.get('auto_analyze_ai', True)),
                'eligible_total': eligible_total,
                'analyzed_fresh': analyzed_fresh,
                'analyzed_any': analyzed_any,
                'pending': max(0, eligible_total - analyzed_fresh),
                'queued': q_snap['queued'],
                'inflight': q_snap['inflight'],
            },
            'sync_status': {
                'last_pc_sync_at': meta.get('last_pc_sync_at') or '',
                'last_pc_duration_s': meta.get('last_pc_duration_s') or '',
                'min_day': all_days_row['min_d'] if all_days_row else None,
                'max_day': all_days_row['max_d'] if all_days_row else None,
                'total_days_tracked': int(all_days_row['n_d'] or 0) if all_days_row else 0,
            },
        }
    finally:
        con.close()


def get_session_detail(session_key: str, db_path: str | None = None) -> dict[str, Any] | None:
    resolved_db = os.path.abspath(str(db_path or os.environ.get('AG_PROMPT_COACH_DB', COACH_DB_PATH)))
    con = _ensure_coach_db(db_path)
    try:
        r = con.execute('SELECT * FROM coach_sessions WHERE session_key = ?', (session_key,)).fetchone()
        if not r:
            return None
        day_rows = con.execute(
            """
            SELECT day, day_human_prompts, day_raw_msgs, day_auto_msgs, day_active_hours,
                   day_short_nudges, day_vague_errors, day_corr_kw
            FROM coach_day_sessions
            WHERE session_key = ?
            ORDER BY day ASC
            """,
            (session_key,),
        ).fetchall()
        day_breakdown = [
            {
                'day': str(dr['day']),
                'human_prompts': int(dr['day_human_prompts'] or 0),
                'raw_msgs': int(dr['day_raw_msgs'] or 0),
                'auto_msgs': int(dr['day_auto_msgs'] or 0),
                'active_hours': round(float(dr['day_active_hours'] or 0.0), 2),
                'short_nudges': int(dr['day_short_nudges'] or 0),
                'vague_errors': int(dr['day_vague_errors'] or 0),
                'corr_kw': int(dr['day_corr_kw'] or 0),
            }
            for dr in day_rows
        ]
        settings = get_settings(con)
        settings_sig = _settings_cache_sig(settings)
        c_hash = str(r['content_hash'] or '')
        _, ai_is_fresh, ai_parsed, enriched_raw, prompt_eval_summary = _get_or_eval_session_prompts(
            resolved_db,
            r,
            settings,
            settings_sig,
        )
        enriched_samples = [
            {k: v for k, v in p.items() if k != '_ts_sort'}
            for p in enriched_raw
        ]
        q_snap = get_ai_queue_snapshot()
        ai_analyzing = (session_key in q_snap['inflight_keys'] or session_key in q_snap['queued_keys']) and not ai_is_fresh
        raw_end_ts = float(r['end_ts'] or 0.0)
        raw_act_ts = max(raw_end_ts, float(r['last_activity_ts'] or 0.0))
        live_run = bool(int(r['is_running'] or 0)) and ((time.time() - raw_act_ts) < 900.0)
        return {
            'session_key': r['session_key'],
            'tool': r['tool'],
            'session_id': r['session_id'],
            'title': r['title'],
            'project': r['project'],
            'cwd': r['cwd'],
            'is_sub': bool(r['is_sub']),
            'start_ts': float(r['start_ts'] or 0.0),
            'end_ts': raw_end_ts,
            'last_activity_ts': raw_act_ts,
            'is_running': live_run,
            'is_pinned': bool(int(r['is_pinned'] or 0)),
            'start_day': r['start_day'],
            'end_day': r['end_day'],
            'days': json.loads(r['days_json'] or '[]'),
            'day_breakdown': day_breakdown,
            'n_raw_msgs': r['n_raw_msgs'],
            'n_human_prompts': r['n_human_prompts'],
            'n_auto_msgs': r['n_auto_msgs'],
            'auto_breakdown': json.loads(r['auto_breakdown_json'] or '{}'),
            'clean_active_hours': r['clean_active_hours'],
            'wall_hours': r['wall_hours'],
            'busy_hours': r['busy_hours'],
            'n_short_nudges': r['n_short_nudges'],
            'n_vague_errors': r['n_vague_errors'],
            'n_corr_kw': r['n_corr_kw'],
            'total_tool_calls': int(r['total_tool_calls'] or 0),
            'max_consecutive_tool_calls': int(r['max_consecutive_tool_calls'] or 0),
            'tool_error_count': int(r['tool_error_count'] or 0),
            'redirection_count': int(r['redirection_count'] or 0),
            'first_human_len': r['first_human_len'],
            'avg_human_len': r['avg_human_len'],
            'first_human_preview': r['first_human_preview'],
            'rule_score': r['rule_score'],
            'severity': r['severity'],
            'flags': json.loads(r['flags_json'] or '[]'),
            'prompts_sample': enriched_samples,
            'prompt_eval_summary': prompt_eval_summary,
            'content_hash': c_hash,
            'ai_is_fresh': ai_is_fresh,
            'ai_analyzing': ai_analyzing,
            'ai_analysis': ai_parsed,
            'updated_at': r['updated_at'],
        }
    finally:
        con.close()


def list_scored_prompts(
    period: str = '7d',
    target_date: str | None = None,
    tool_filter: str = 'all',
    include_sub: bool = True,
    q: str = '',
    stage: str = 'all',
    level: str = 'all',
    weak_dim: str = 'all',
    only_errors: bool = False,
    sort_by: str = 'newest',
    page: int = 1,
    limit: int = 30,
    db_path: str | None = None,
) -> dict[str, Any]:
    """Liệt kê toàn bộ câu prompt theo dạng bảng có phân trang, chấm điểm 7 chiều, đánh giá & gợi ý tối ưu."""
    resolved_db = os.path.abspath(str(db_path or os.environ.get('AG_PROMPT_COACH_DB', COACH_DB_PATH)))
    con = _ensure_coach_db(db_path)
    try:
        settings = get_settings(con)
        settings_sig = _settings_cache_sig(settings)
        start_d, end_d, period_label = _resolve_date_window(period, target_date)
        tool_f = (tool_filter or 'all').strip().lower()
        if tool_f not in (*VALID_TOOLS, 'all'):
            tool_f = 'all'

        where_parts = ['s.is_fork_clone = 0', 'LENGTH(s.prompts_sample_json) > 5']
        params: list[Any] = []
        if start_d and end_d:
            where_parts.append(
                's.session_key IN (SELECT DISTINCT ds.session_key FROM coach_day_sessions ds WHERE ds.day >= ? AND ds.day <= ?)'
            )
            params.extend([start_d, end_d])
        if tool_f != 'all':
            where_parts.append('s.tool = ?')
            params.append(tool_f)
        if not include_sub:
            where_parts.append('s.is_sub = 0')
        where_sql = ' AND '.join(where_parts)

        # Bước 1: Đọc metadata nhẹ + độ dài BLOB (tránh kéo hàng chục MB JSON khỏi SQLite khi đã warm cache)
        meta_rows = con.execute(
            f"""
            SELECT
                s.session_key, s.tool, s.title, s.project, s.is_sub,
                s.end_day, s.end_ts, s.rule_score, s.first_human_preview,
                s.content_hash, s.ai_hash,
                LENGTH(COALESCE(s.prompts_sample_json, '[]')) AS samples_len,
                LENGTH(COALESCE(s.ai_analysis_json, '{{}}')) AS ai_len,
                s.tool_error_count, s.redirection_count
            FROM coach_sessions s
            WHERE {where_sql}
            ORDER BY s.end_ts DESC
            """,
            params,
        ).fetchall()

        eval_by_key: dict[str, tuple[bool, list[dict[str, Any]]]] = {}
        miss_keys: list[tuple[int, str]] = []
        for row_idx, r in enumerate(meta_rows):
            skey = str(r['session_key'])
            hit = _peek_cached_session_prompts(
                resolved_db,
                skey,
                str(r['content_hash'] or ''),
                str(r['ai_hash'] or ''),
                int(r['ai_len'] or 0),
                int(r['samples_len'] or 0),
                settings_sig,
                shallow_copy=False,
            )
            if hit is not None:
                eval_by_key[skey] = (hit[0], hit[3])
            else:
                miss_keys.append((row_idx, skey))

        if miss_keys:
            rank_map = {sk: ridx for ridx, sk in miss_keys}
            just_keys = [sk for _, sk in miss_keys]
            for c_pos in range(0, len(just_keys), 900):
                chunk_k = just_keys[c_pos : c_pos + 900]
                q_marks = ','.join('?' for _ in chunk_k)
                blob_rows = con.execute(
                    f"""
                    SELECT session_key, project, title, end_ts, content_hash, ai_hash,
                           prompts_sample_json, ai_analysis_json, tool_error_count, redirection_count
                    FROM coach_sessions
                    WHERE session_key IN ({q_marks})
                    """,
                    chunk_k,
                ).fetchall()
                for br in blob_rows:
                    sk = str(br['session_key'])
                    has_ai_b, _, _, ep_b, _ = _get_or_eval_session_prompts(
                        resolved_db,
                        br,
                        settings,
                        settings_sig,
                        cache_insert=(rank_map.get(sk, 0) < _MAX_SESSION_PROMPT_CACHE),
                        shallow_copy=False,
                    )
                    eval_by_key[sk] = (has_ai_b, ep_b)

        q_low = (q or '').strip().lower()
        stage_f = (stage or 'all').strip().lower()
        level_f = (level or 'all').strip().lower()
        weak_f = (weak_dim or 'all').strip().lower()
        sort_f = (sort_by or 'newest').strip().lower()
        check_weak_dim = weak_f in _RUBRIC_DIM_KEYS

        total_unfiltered = 0
        facets_stage: dict[str, int] = {}
        facets_dim_weak: dict[str, int] = {k: 0 for k in _RUBRIC_DIM_KEYS}
        facets_green = 0
        facets_amber = 0
        facets_red = 0
        facets_err = 0

        # Lọc & tính tổng ngay trong 1 vòng quét nhẹ, CHỈ tạo dict đầy đủ cho đúng `limit` dòng trên trang hiện tại
        filtered_refs: list[tuple[int, float, int, int, bool, bool, dict[str, Any], tuple[Any, ...], str]] = []
        sum_score = 0
        sum_green = 0
        sum_amber = 0
        sum_red = 0
        sum_err = 0
        sum_ai = 0
        sum_merge = 0
        dim_sums = {k: 0.0 for k in _RUBRIC_DIM_KEYS}

        for r in meta_rows:
            skey = str(r['session_key'])
            ev = eval_by_key.get(skey)
            if not ev or not ev[1]:
                continue
            has_ai, enriched_prompts = ev
            sess_title = str(r['title'] or r['first_human_preview'] or skey)
            sess_project = str(r['project'] or '')
            sess_tool = str(r['tool'] or '')
            sess_sub = bool(r['is_sub'])
            sess_end_ts = float(r['end_ts'] or 0.0)
            sess_end_day = str(r['end_day'] or '')
            sess_rule_score = int(r['rule_score'] or 100)
            sess_meta = (skey, sess_title, sess_project, sess_tool, sess_sub, sess_rule_score, has_ai)

            for p in enriched_prompts:
                p_day = str(p.get('day') or sess_end_day)
                if start_d and end_d and p_day and not (start_d <= p_day <= end_d):
                    continue
                if q_low:
                    hay = ' '.join([
                        str(p.get('text_redacted') or ''),
                        str(p.get('improved_prompt') or ''),
                        str(p.get('lesson') or ''),
                        str(p.get('verdict') or ''),
                        str(p.get('stage_label') or ''),
                        str(p.get('assistant_err_snippet') or ''),
                        str(p.get('assistant_summary') or ''),
                        ' '.join(str(f) for f in (p.get('files_touched') or [])),
                        ' '.join(str(t) for t in (p.get('tools_triggered') or [])),
                        sess_title,
                        sess_project,
                    ]).lower()
                    if q_low not in hay:
                        continue

                total_unfiltered += 1
                ts_sort = float(p.get('_ts_sort') or sess_end_ts)
                had_te = bool(p.get('had_tool_error'))
                is_ve_or_corr = bool(p.get('is_vague_error') or p.get('is_corr_kw'))
                has_err = had_te or is_ve_or_corr
                lvl = str(p.get('level') or 'green')
                stg = str(p.get('stage') or 'execution')
                checks = p.get('checks') or []
                dim_scores = p.get('dimension_scores') or {}
                p_score = int(p.get('score') or 100)

                facets_stage[stg] = facets_stage.get(stg, 0) + 1
                if lvl == 'green':
                    facets_green += 1
                elif lvl == 'amber':
                    facets_amber += 1
                else:
                    facets_red += 1
                if has_err:
                    facets_err += 1
                for chk in checks:
                    ck = str(chk.get('key') or '')
                    if ck in facets_dim_weak and not chk.get('ok') and chk.get('applicable', True):
                        facets_dim_weak[ck] += 1

                if stage_f != 'all' and stg != stage_f:
                    continue
                if level_f != 'all' and lvl != level_f:
                    continue
                if only_errors and not has_err:
                    continue
                if check_weak_dim:
                    if not any(
                        str(c.get('key') or '') == weak_f and (not c.get('ok')) and c.get('applicable', True)
                        for c in checks
                    ):
                        continue

                sum_score += p_score
                if lvl == 'green':
                    sum_green += 1
                elif lvl == 'amber':
                    sum_amber += 1
                else:
                    sum_red += 1
                if has_err:
                    sum_err += 1
                if p.get('ai_scored'):
                    sum_ai += 1
                if p.get('merge_with'):
                    sum_merge += 1
                for k in _RUBRIC_DIM_KEYS:
                    dim_sums[k] += float(dim_scores.get(k, 100))

                filtered_refs.append((
                    p_score,
                    ts_sort,
                    int(p.get('chars') or 0),
                    int(p.get('idx') or 1),
                    had_te,
                    is_ve_or_corr,
                    p,
                    sess_meta,
                    p_day,
                ))

        total_filtered = len(filtered_refs)
        dimension_avgs = {
            k: round(dim_sums[k] / max(1, total_filtered), 1) if total_filtered else 100.0
            for k in _RUBRIC_DIM_KEYS
        }

        if sort_f == 'score_asc':
            filtered_refs.sort(key=lambda x: (x[0], -x[1], x[3]))
        elif sort_f == 'score_desc':
            filtered_refs.sort(key=lambda x: (-x[0], -x[1], x[3]))
        elif sort_f == 'chars_desc':
            filtered_refs.sort(key=lambda x: (-x[2], -x[1], x[3]))
        elif sort_f == 'errors_first':
            filtered_refs.sort(key=lambda x: (-(1 if x[4] else 0), -(1 if x[5] else 0), x[0], -x[1]))
        else:
            filtered_refs.sort(key=lambda x: (-x[1], -x[3]))

        lim = max(10, min(100, int(limit or 30)))
        total_pages = max(1, (total_filtered + lim - 1) // lim)
        pg = max(1, min(int(page or 1), total_pages))
        start_idx = (pg - 1) * lim

        page_items: list[dict[str, Any]] = []
        for p_score, _ts_s, p_chars, p_idx_v, had_te, _vc, p, smeta, p_day in filtered_refs[start_idx : start_idx + lim]:
            skey_m, stitle_m, sproj_m, stool_m, ssub_m, srule_m, has_ai_m = smeta
            stg = str(p.get('stage') or 'execution')
            page_items.append({
                'session_key': skey_m,
                'session_title': stitle_m,
                'project': sproj_m,
                'tool': stool_m,
                'is_sub': ssub_m,
                'session_rule_score': srule_m,
                'has_ai_analysis': has_ai_m,
                'idx': p_idx_v,
                'ts_iso': str(p.get('ts_iso') or ''),
                'day': p_day,
                'chars': p_chars,
                'gap_min': float(p.get('gap_min') or 0.0),
                'stage': stg,
                'stage_label': str(p.get('stage_label') or stg),
                'score': p_score,
                'level': str(p.get('level') or 'green'),
                'verdict': str(p.get('verdict') or ''),
                'ai_scored': bool(p.get('ai_scored')),
                'dimension_scores': p.get('dimension_scores') or {},
                'checks': p.get('checks') or [],
                'tools_triggered': p.get('tools_triggered') or [],
                'tool_call_count': int(p.get('tool_call_count') or 0),
                'had_tool_error': had_te,
                'assistant_err_snippet': str(p.get('assistant_err_snippet') or ''),
                'turn_duration_s': p.get('turn_duration_s'),
                'assistant_summary': str(p.get('assistant_summary') or ''),
                'files_touched': p.get('files_touched') or [],
                'failed_tools': p.get('failed_tools') or [],
                'root_cause_type': str(p.get('root_cause_type') or ''),
                'merge_with': p.get('merge_with') or [],
                'is_short_nudge': bool(p.get('is_short_nudge')),
                'is_vague_error': bool(p.get('is_vague_error')),
                'is_corr_kw': bool(p.get('is_corr_kw')),
                'is_question_reply': bool(p.get('is_question_reply')),
                'has_image': bool(p.get('has_image')),
                'text_redacted': str(p.get('text_redacted') or ''),
                'lesson': str(p.get('lesson') or ''),
                'improved_prompt': str(p.get('improved_prompt') or ''),
            })

        return {
            'ok': True,
            'period': period,
            'period_label': period_label,
            'start_day': start_d,
            'end_day': end_d,
            'tool': tool_f,
            'total': total_filtered,
            'page': pg,
            'limit': lim,
            'total_pages': total_pages,
            'summary': {
                'total_prompts': total_filtered,
                'avg_score': round(sum_score / max(1, total_filtered), 1) if total_filtered else 100.0,
                'green_count': sum_green,
                'amber_count': sum_amber,
                'red_count': sum_red,
                'tool_error_count': sum_err,
                'ai_scored_count': sum_ai,
                'mergeable_count': sum_merge,
                'dimension_avgs': dimension_avgs,
            },
            'facets': {
                'total_unfiltered': total_unfiltered,
                'green_count': facets_green,
                'amber_count': facets_amber,
                'red_count': facets_red,
                'tool_error_count': facets_err,
                'stage_counts': [
                    {'stage': k, 'label': PROMPT_STAGE_LABELS.get(k, k), 'count': v}
                    for k, v in sorted(facets_stage.items(), key=lambda kv: -kv[1])
                ],
                'dim_weak_counts': facets_dim_weak,
            },
            'items': page_items,
        }
    finally:
        con.close()


def get_day_detail(
    day_str: str,
    tool_filter: str = 'all',
    include_sub: bool = True,
    db_path: str | None = None,
) -> dict[str, Any]:
    resolved_db = os.path.abspath(str(db_path or os.environ.get('AG_PROMPT_COACH_DB', COACH_DB_PATH)))
    con = _ensure_coach_db(db_path)
    try:
        settings = get_settings(con)
        settings_sig = _settings_cache_sig(settings)
        max_p = settings['max_prompts_per_session']
        max_h = settings['max_hours_per_session']
        tool_f = (tool_filter or 'all').strip().lower()
        if tool_f not in (*VALID_TOOLS, 'all'):
            tool_f = 'all'

        where_parts = ['ds.day = ?', 's.is_fork_clone = 0']
        params: list[Any] = [day_str]
        if tool_f != 'all':
            where_parts.append('ds.tool = ?')
            params.append(tool_f)
        if not include_sub:
            where_parts.append('ds.is_sub = 0')

        rows = con.execute(
            f"""
            SELECT
                ds.day,
                ds.session_key,
                ds.tool,
                ds.is_sub,
                ds.day_human_prompts,
                ds.day_raw_msgs,
                ds.day_auto_msgs,
                ds.day_active_hours,
                ds.day_short_nudges,
                ds.day_vague_errors,
                ds.day_corr_kw,
                s.session_id,
                s.title,
                s.project,
                s.cwd,
                s.start_day,
                s.end_day,
                s.start_ts,
                s.end_ts,
                s.n_human_prompts AS sess_total_prompts,
                s.clean_active_hours AS sess_total_hours,
                s.wall_hours,
                s.n_raw_msgs AS sess_raw_msgs,
                s.n_auto_msgs AS sess_auto_msgs,
                s.rule_score,
                s.severity,
                s.flags_json,
                s.first_human_preview,
                s.first_human_len,
                s.content_hash,
                s.ai_hash,
                s.prompts_sample_json,
                s.ai_analysis_json,
                s.tool_error_count,
                s.redirection_count
            FROM coach_day_sessions ds
            JOIN coach_sessions s ON s.session_key = ds.session_key
            WHERE {' AND '.join(where_parts)}
            ORDER BY ds.is_sub ASC, ds.day_human_prompts DESC, ds.day_active_hours DESC
            """,
            params,
        ).fetchall()

        by_tool: dict[str, dict[str, Any]] = {
            t: {
                'direct_prompts': 0,
                'bg_prompts': 0,
                'direct_sessions': 0,
                'bg_sessions': 0,
                'active_hours': 0.0,
            }
            for t in VALID_TOOLS
        }
        summary = {
            'day': day_str,
            'direct_prompts': 0,
            'bg_prompts': 0,
            'auto_ignored': 0,
            'direct_sessions': 0,
            'bg_sessions': 0,
            'active_hours': 0.0,
            'over_limit_sessions': 0,
            'compliant_sessions': 0,
            'short_nudges': 0,
            'vague_errors': 0,
            'corr_kw': 0,
            'efficiency_score': 100.0,
            'avg_prompts_per_session': 0.0,
        }
        score_sum = 0.0
        score_cnt = 0
        sessions_out: list[dict[str, Any]] = []

        for r in rows:
            tool = str(r['tool'] or 'antigravity')
            is_sub = int(r['is_sub'] or 0) == 1
            dp = int(r['day_human_prompts'] or 0)
            dr = int(r['day_raw_msgs'] or 0)
            da = int(r['day_auto_msgs'] or 0)
            dh = round(float(r['day_active_hours'] or 0.0), 2)
            dn = int(r['day_short_nudges'] or 0)
            dv = int(r['day_vague_errors'] or 0)
            dc = int(r['day_corr_kw'] or 0)
            sess_p = int(r['sess_total_prompts'] or 0)
            sess_h = round(float(r['sess_total_hours'] or 0.0), 2)
            rscore = int(r['rule_score'] or 100)
            sev = str(r['severity'] or 'green')

            tb = by_tool.setdefault(tool, {
                'direct_prompts': 0,
                'bg_prompts': 0,
                'direct_sessions': 0,
                'bg_sessions': 0,
                'active_hours': 0.0,
            })
            summary['auto_ignored'] += da
            if is_sub:
                summary['bg_prompts'] += dp
                summary['bg_sessions'] += 1
                tb['bg_prompts'] += dp
                tb['bg_sessions'] += 1
            else:
                summary['direct_prompts'] += dp
                summary['direct_sessions'] += 1
                summary['active_hours'] = round(summary['active_hours'] + dh, 2)
                summary['short_nudges'] += dn
                summary['vague_errors'] += dv
                summary['corr_kw'] += dc
                score_sum += rscore
                score_cnt += 1
                if sess_p > max_p or sess_h >= max_h:
                    summary['over_limit_sessions'] += 1
                else:
                    summary['compliant_sessions'] += 1
                tb['direct_prompts'] += dp
                tb['direct_sessions'] += 1
                tb['active_hours'] = round(tb['active_hours'] + dh, 2)

            try:
                flags_parsed = json.loads(r['flags_json'] or '[]')
            except Exception:
                flags_parsed = []

            has_ai, _, ai_parsed, enriched_day_all, day_p_stats = _get_or_eval_session_prompts(
                resolved_db,
                r,
                settings,
                settings_sig,
            )
            prompts_on_day = [
                {k: v for k, v in p.items() if k != '_ts_sort'}
                for p in enriched_day_all
                if isinstance(p, dict) and (str(p.get('day') or '') == day_str or r['start_day'] == r['end_day'])
            ]
            sessions_out.append({
                'session_key': str(r['session_key']),
                'session_id': str(r['session_id'] or ''),
                'tool': tool,
                'title': str(r['title'] or ''),
                'project': str(r['project'] or ''),
                'cwd': str(r['cwd'] or ''),
                'is_sub': is_sub,
                'start_day': str(r['start_day'] or ''),
                'end_day': str(r['end_day'] or ''),
                'start_ts': float(r['start_ts'] or 0.0),
                'end_ts': float(r['end_ts'] or 0.0),
                'day_human_prompts': dp,
                'day_raw_msgs': dr,
                'day_auto_msgs': da,
                'day_active_hours': dh,
                'day_short_nudges': dn,
                'day_vague_errors': dv,
                'day_corr_kw': dc,
                'n_human_prompts': sess_p,
                'clean_active_hours': sess_h,
                'wall_hours': round(float(r['wall_hours'] or 0.0), 2),
                'n_raw_msgs': int(r['sess_raw_msgs'] or 0),
                'n_auto_msgs': int(r['sess_auto_msgs'] or 0),
                'first_human_preview': str(r['first_human_preview'] or ''),
                'first_human_len': int(r['first_human_len'] or 0),
                'rule_score': rscore,
                'severity': sev,
                'flags': flags_parsed,
                'avg_prompt_score': day_p_stats['avg_prompt_score'],
                'prompts_on_day': prompts_on_day,
                'has_ai_analysis': has_ai,
                'ai_summary': str(ai_parsed.get('diagnosis') or ''),
            })

        if score_cnt > 0:
            summary['efficiency_score'] = round(score_sum / score_cnt, 1)
            summary['avg_prompts_per_session'] = round(summary['direct_prompts'] / score_cnt, 1)

        ai_row = con.execute('SELECT summary_json FROM coach_daily_ai WHERE day = ?', (day_str,)).fetchone()
        daily_ai = None
        if ai_row and ai_row['summary_json']:
            try:
                daily_ai = json.loads(ai_row['summary_json'])
            except Exception:
                daily_ai = None

        return {
            'ok': True,
            'day': day_str,
            'summary': summary,
            'by_tool': by_tool,
            'daily_ai': daily_ai,
            'sessions': sessions_out,
        }
    finally:
        con.close()


def handle_prompt_coach_request(
    method: str,
    parsed_path: str,
    query_str: str,
    headers: Any,
    req_body: bytes,
    llm_caller: LLMCaller | None = None,
) -> tuple[int, dict[str, Any]]:
    """Router chuẩn /api/owner/prompt-coach/* gọi từ prompt_coach_server.py."""
    is_owner, owner_uname = verify_true_owner(headers)
    if not is_owner:
        return (
            403,
            {
                'ok': False,
                'error': '🔒 Yêu cầu mã PIN bảo mật hợp lệ để truy cập Antigravity Prompt Coach qua mạng LAN.',
            },
        )

    cmd = (method or 'GET').upper()
    qs = urllib.parse.parse_qs(query_str or '')

    # 1. GET /api/owner/prompt-coach/dashboard
    if parsed_path == '/api/owner/prompt-coach/dashboard' and cmd == 'GET':
        period = (qs.get('period') or ['7d'])[0]
        target_date = (qs.get('date') or [None])[0]
        tool = (qs.get('tool') or ['all'])[0]
        include_sub = ((qs.get('include_sub') or ['1'])[0]) != '0'
        try:
            payload = build_dashboard_payload(
                period=period,
                target_date=target_date,
                tool_filter=tool,
                include_sub=include_sub,
            )
            payload['owner'] = owner_uname
            return (200, payload)
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi đọc dữ liệu A12: {exc}'})

    # 1b. GET /api/owner/prompt-coach/prompts (Bảng chi tiết toàn bộ câu prompt + chấm điểm 7 chiều + gợi ý tối ưu)
    if parsed_path == '/api/owner/prompt-coach/prompts' and cmd == 'GET':
        period = (qs.get('period') or ['7d'])[0]
        target_date = (qs.get('date') or [None])[0]
        tool = (qs.get('tool') or ['all'])[0]
        include_sub = ((qs.get('include_sub') or ['1'])[0]) != '0'
        q_str = (qs.get('q') or [''])[0]
        stage_f = (qs.get('stage') or ['all'])[0]
        level_f = (qs.get('level') or ['all'])[0]
        weak_dim_f = (qs.get('weak_dim') or ['all'])[0]
        only_errors = ((qs.get('only_errors') or ['0'])[0]) == '1'
        sort_by = (qs.get('sort') or ['newest'])[0]
        try:
            page_num = int((qs.get('page') or ['1'])[0] or '1')
        except Exception:
            page_num = 1
        try:
            limit_num = int((qs.get('limit') or ['30'])[0] or '30')
        except Exception:
            limit_num = 30
        try:
            payload = list_scored_prompts(
                period=period,
                target_date=target_date,
                tool_filter=tool,
                include_sub=include_sub,
                q=q_str,
                stage=stage_f,
                level=level_f,
                weak_dim=weak_dim_f,
                only_errors=only_errors,
                sort_by=sort_by,
                page=page_num,
                limit=limit_num,
            )
            return (200, payload)
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi đọc bảng prompt A12: {exc}'})

    # 2. GET /api/owner/prompt-coach/session/<key>
    m_sess = re.fullmatch(r'/api/owner/prompt-coach/session/(.+)', parsed_path)
    if m_sess and cmd == 'GET':
        skey = urllib.parse.unquote(m_sess.group(1)).strip()
        detail = get_session_detail(skey)
        if not detail:
            return (404, {'ok': False, 'error': 'Không tìm thấy phiên làm việc này.'})
        return (200, {'ok': True, 'session': detail})

    # 2b. GET /api/owner/prompt-coach/day/<YYYY-MM-DD>
    m_day = re.fullmatch(r'/api/owner/prompt-coach/day/(\d{4}-\d{2}-\d{2})', parsed_path)
    if m_day and cmd == 'GET':
        day_str = m_day.group(1)
        tool = (qs.get('tool') or ['all'])[0]
        include_sub = ((qs.get('include_sub') or ['1'])[0]) != '0'
        try:
            payload = get_day_detail(day_str, tool_filter=tool, include_sub=include_sub)
            return (200, payload)
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi đọc chi tiết ngày {day_str}: {exc}'})

    # 3. GET /api/owner/prompt-coach/saved-prompts
    if parsed_path == '/api/owner/prompt-coach/saved-prompts' and cmd == 'GET':
        con = _ensure_coach_db()
        try:
            rows = con.execute('SELECT * FROM coach_saved_prompts ORDER BY id DESC LIMIT 100').fetchall()
            return (200, {'ok': True, 'items': [dict(r) for r in rows]})
        finally:
            con.close()

    # 4. DELETE /api/owner/prompt-coach/saved-prompts/<id>
    m_del = re.fullmatch(r'/api/owner/prompt-coach/saved-prompts/(\d+)', parsed_path)
    if m_del and cmd == 'DELETE':
        pid = int(m_del.group(1))
        with _WRITE_LOCK:
            con = _ensure_coach_db()
            try:
                cur = con.execute('DELETE FROM coach_saved_prompts WHERE id = ?', (pid,))
                con.commit()
                if cur.rowcount == 0:
                    return (404, {'ok': False, 'error': f'Không tìm thấy mẫu #{pid}.'})
                return (200, {'ok': True, 'deleted_id': pid})
            finally:
                con.close()

    # Parse JSON body for write endpoints
    max_body = 4 * 1024 * 1024 if parsed_path == '/api/owner/prompt-coach/ingest' else 131072
    if len(req_body or b'') > max_body:
        return (413, {'ok': False, 'error': 'Dữ liệu gửi lên vượt quá dung lượng cho phép.'})
    try:
        body = json.loads((req_body or b'{}').decode('utf-8'))
        if not isinstance(body, dict):
            return (400, {'ok': False, 'error': 'Body phải là JSON object.'})
    except Exception:
        return (400, {'ok': False, 'error': 'JSON không hợp lệ.'})

    # 5. POST /api/owner/prompt-coach/ingest (từ PC collector)
    if parsed_path == '/api/owner/prompt-coach/ingest' and cmd == 'POST':
        try:
            res = ingest_payload(body, owner_uname=owner_uname)
            return (200, res)
        except ValueError as exc:
            return (422, {'ok': False, 'error': str(exc)})
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi lưu ingest A12: {exc}'})

    # 6. POST /api/owner/prompt-coach/analyze-session (AI phân tích 1 phiên bất kỳ khi bấm nút)
    if parsed_path == '/api/owner/prompt-coach/analyze-session' and cmd == 'POST':
        skey = str(body.get('session_key') or '').strip()
        force = bool(body.get('force'))
        if not skey:
            return (422, {'ok': False, 'error': 'Thiếu session_key.'})
        ok, cached, ai_res, err = analyze_and_persist_session(skey, force=force, llm_caller=llm_caller)
        if not ok:
            if err == 'Không tìm thấy phiên.':
                return (404, {'ok': False, 'error': err})
            if err.startswith('Phiên này chưa có'):
                return (422, {'ok': False, 'error': err})
            return (502, {'ok': False, 'error': f'AI chưa phân tích được phiên này: {err}'})
        return (200, {'ok': True, 'cached': cached, 'ai_analysis': ai_res})

    # 6b. POST /api/owner/prompt-coach/analyze-batch (AI phân tích hàng loạt phiên chưa có/cũ theo thời gian thực)
    if parsed_path == '/api/owner/prompt-coach/analyze-batch' and cmd == 'POST':
        res = process_realtime_ai_batch(
            period=str(body.get('period') or 'today'),
            target_date=str(body.get('target_date') or '') or None,
            tool_filter=str(body.get('tool') or 'all'),
            limit=int(body.get('limit') or 5),
            force=bool(body.get('force')),
            enqueue_remaining=body.get('enqueue_remaining', True) is not False,
            llm_caller=llm_caller,
        )
        return (200, res)

    # 7. POST /api/owner/prompt-coach/optimize-draft
    if parsed_path == '/api/owner/prompt-coach/optimize-draft' and cmd == 'POST':
        try:
            clar_raw = body.get('clarifications')
            res = optimize_draft_prompt(
                draft=str(body.get('draft') or ''),
                tool=str(body.get('tool') or 'all'),
                goal_type=str(body.get('goal_type') or 'feature'),
                target_files=str(body.get('target_files') or ''),
                clarifications=clar_raw if isinstance(clar_raw, dict) else None,
                refine_mode=str(body.get('refine_mode') or ''),
                llm_caller=llm_caller,
            )
            return (200, res)
        except ValueError as exc:
            return (422, {'ok': False, 'error': str(exc)})
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi tối ưu nháp prompt: {exc}'})

    # 7b. POST /api/owner/prompt-coach/compare-draft (Dry-Run A/B kế hoạch AI)
    if parsed_path == '/api/owner/prompt-coach/compare-draft' and cmd == 'POST':
        try:
            res = compare_draft_ab(
                original_draft=str(body.get('original_draft') or ''),
                optimized_prompt=str(body.get('optimized_prompt') or ''),
                tool=str(body.get('tool') or 'all'),
                goal_type=str(body.get('goal_type') or 'feature'),
                llm_caller=llm_caller,
            )
            return (200, res)
        except ValueError as exc:
            return (422, {'ok': False, 'error': str(exc)})
        except Exception as exc:
            return (500, {'ok': False, 'error': f'Lỗi giả lập A/B prompt: {exc}'})

    # 8. POST /api/owner/prompt-coach/settings
    if parsed_path == '/api/owner/prompt-coach/settings' and cmd == 'POST':
        try:
            mp = max(3, min(60, int(body.get('max_prompts_per_session') or 12)))
            mh = round(max(0.25, min(12.0, float(body.get('max_hours_per_session') or 2.0))), 2)
            mc = round(max(1.0, min(80.0, float(body.get('max_correction_pct') or 10.0))), 1)
            auto_ai = 1 if body.get('auto_analyze_ai', True) else 0
        except Exception:
            return (422, {'ok': False, 'error': 'Thông số ngưỡng mục tiêu không hợp lệ.'})
        now_iso = _utc_iso()
        with _WRITE_LOCK:
            con = _ensure_coach_db()
            try:
                con.execute(
                    """
                    UPDATE coach_settings
                    SET max_prompts_per_session = ?, max_hours_per_session = ?,
                        max_correction_pct = ?, auto_analyze_ai = ?, updated_at = ?
                    WHERE id = 1
                    """,
                    (mp, mh, mc, auto_ai, now_iso),
                )
                settings = get_settings(con)
                _recompute_all_rule_scores(con, settings)
                con.commit()
                return (200, {'ok': True, 'settings': settings})
            finally:
                con.close()

    # 9. POST /api/owner/prompt-coach/saved-prompts
    if parsed_path == '/api/owner/prompt-coach/saved-prompts' and cmd == 'POST':
        title = redact_sensitive_text(body.get('title') or '', 160).strip()
        tpl = redact_sensitive_text(body.get('prompt_template') or '', 4000).strip()
        if not title or not tpl:
            return (422, {'ok': False, 'error': 'Cần nhập đủ Tiêu đề và Nội dung Prompt chuẩn.'})
        cat = str(body.get('category') or '1-shot')[:40]
        tool = str(body.get('tool') or 'all')[:24]
        weak = redact_sensitive_text(body.get('weak_example') or '', 300)
        notes = redact_sensitive_text(body.get('notes') or '', 300)
        now_iso = _utc_iso()
        with _WRITE_LOCK:
            con = _ensure_coach_db()
            try:
                cur = con.execute(
                    """
                    INSERT INTO coach_saved_prompts
                    (title, category, tool, weak_example, prompt_template, notes, use_count, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                    """,
                    (title, cat, tool, weak, tpl, notes, now_iso, now_iso),
                )
                con.commit()
                row = con.execute('SELECT * FROM coach_saved_prompts WHERE id = ?', (cur.lastrowid,)).fetchone()
                return (200, {'ok': True, 'item': dict(row) if row else None})
            finally:
                con.close()

    return (405, {'ok': False, 'error': 'Phương thức hoặc đường dẫn không được hỗ trợ.'})
