#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bộ thu thập & đồng bộ Realtime cục bộ (100% Zero-Data-Leak) cho Antigravity Prompt Coach (Self-Host).
Quét trực tiếp trên máy tính của bạn:
  1. Antigravity Desktop (~/.gemini/antigravity/conversation_summaries.db + annotations + config/projects + transcript.jsonl)
  2. Claude Code (~/.claude/projects/**/*.jsonl)
  3. Codex CLI / ChatGPT PC (~/.codex/state_5.sqlite + ~/.codex/thread_history_1.sqlite)
Tự động loại bỏ boilerplate/tool_result, che sạch 100% API Key/Token/Mật khẩu và lưu trực tiếp vào SQLite cục bộ (~/.antigravity_prompt_coach/prompt_coach.db).
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

_REDACT_IMPORT_ERR: Exception | None = None
try:
    from coach_engine import DATA_DIR, VN_TZ, ingest_payload, redact_sensitive_text
except Exception as _imp_exc:
    _REDACT_IMPORT_ERR = _imp_exc
    VN_TZ = dt.timezone(dt.timedelta(hours=7))
    DATA_DIR = Path.home() / '.antigravity_prompt_coach'

    def redact_sensitive_text(text: Any, max_len: int = 0) -> str:  # noqa: ARG001
        raise RuntimeError(
            f'Fail-closed: Không nạp được redact_sensitive_text từ coach_engine.py ({_REDACT_IMPORT_ERR}); '
            'hủy quét để bảo vệ bí mật trên máy.'
        )

    def ingest_payload(body: dict[str, Any], owner_uname: str = 'local_member', db_path: str | None = None) -> dict[str, Any]:  # noqa: ARG001
        raise RuntimeError('coach_engine unavailable')


HOME = Path.home()
CACHE_DB_PATH = DATA_DIR / 'pc_cache_v4.sqlite'
LOCK_PATH = DATA_DIR / 'sync.lock'
LAST_SYNC_META_PATH = DATA_DIR / 'last_sync.json'
PUSHED_SIGS_PATH = DATA_DIR / 'pushed_sigs.json'

AG_BRAIN_DIR = HOME / '.gemini' / 'antigravity' / 'brain'
AG_SUMMARIES_DB = HOME / '.gemini' / 'antigravity' / 'conversation_summaries.db'
AG_ANNOTATIONS_DIR = HOME / '.gemini' / 'antigravity' / 'annotations'
AG_PROJECTS_CFG_DIR = HOME / '.gemini' / 'config' / 'projects'
CLAUDE_PROJECTS_DIR = HOME / '.claude' / 'projects'
CODEX_DIR = HOME / '.codex'
CODEX_STATE_DB = CODEX_DIR / 'state_5.sqlite'
CODEX_HISTORY_DB = CODEX_DIR / 'thread_history_1.sqlite'
CODEX_EXTERNAL_IMPORTS = CODEX_DIR / 'external_agent_session_imports.json'

# --- Classification Regexes ---
_SHORT_NUDGES_EXACT = {
    'ok', 'okie', 'oke', 'okay', 'tiếp', 'tiếp đi', 'làm tiếp', 'làm tiếp đi', 'tiếp tục', 'tiếp tục đi',
    'go', 'next', 'continue', 'done', 'yes', 'y', 'no', 'n', 'được', 'đồng ý', 'chốt', 'triển khai',
    'deploy', 'build', 'push', 'commit', 'chạy đi', 'kiểm tra đi', 'check', 'thử lại', 'retry', 'fix',
    'sửa đi', 'làm đi', 'ừ', 'uh', 'uhm', 'rồi', 'xong chưa', 'xong rồi',
}
_VAGUE_ERROR_RE = re.compile(
    r'^(?:vẫn\s*(?:bị\s*)?lỗi|chưa\s*(?:được|thấy|fix|chạy)|bị\s*lỗi|lỗi\s*rồi|không\s*(?:được|chạy|vào\s*được|hiện)|vẫn\s*thế|vẫn\s*như\s*cũ|sao\s*(?:vẫn|không)\s*chạy|check\s*lại|xem\s*lại)[.!?…\s]*$',
    re.I,
)
_CORR_KW_RE = re.compile(
    r'(?i)\b(?:sửa lại|làm lại|nhầm|sai rồi|chưa đúng|vẫn lỗi|vẫn sai|thiếu|không phải|đổi lại|quay lại|bỏ đi|xóa đi|gãy|vỡ giao diện|chưa được|bị mất)\b'
)
_QUESTION_REPLY_RE = re.compile(
    r'^(?:[1-5abcd]\b|phương án\s*\d|chọn\s*\d|recommended|cái\s*\d|hướng\s*\d|mục\s*\d)',
    re.I,
)
_AUTO_BOILERPLATE_RE = re.compile(
    r'^(?:<task-notification>|<local-command-caveat>|\[SCHEDULED\]|This session is being continued from a previous conversation that ran out of context|Base directory for this skill:|Request interrupted by user|<command-name>/|<command-message>|The prompt could not be submitted\.)',
    re.I,
)
_SLASH_CMD_ONLY_RE = re.compile(r'^/[a-z0-9_:\-/]{1,40}(?:\s+[^\n]{0,40})?$', re.I)

# Boilerplate stripping patterns
_XML_BLOCK_TAGS = (
    'system-reminder', 'environment_context', 'INSTRUCTIONS', 'user_instructions',
    'permissions instructions', 'collaboration_mode', 'turn_aborted', 'ADDITIONAL_METADATA',
    'attached_files', 'workspace_context', 'skills_context', 'rule', 'user_rules',
    'subagent_context', 'local-command-stdout', 'command-args', 'command-name', 'command-message',
)
_XML_BLOCK_RE = re.compile(
    r'<(?:' + '|'.join(re.escape(t) for t in _XML_BLOCK_TAGS) + r')(?:\s[^>]*)?>.*?</(?:' + '|'.join(re.escape(t) for t in _XML_BLOCK_TAGS) + r')>',
    re.S | re.I,
)
_USER_REQ_RE = re.compile(r'<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>', re.S | re.I)
_CODEX_MY_REQ_RE = re.compile(r'(?:^|\n)##\s*My request for Codex:\s*\n(.*)', re.S | re.I)
_CODEX_FILES_HDR_RE = re.compile(r'^#\s*Files mentioned by the user:\s*\n(?:##\s*[^\n]+\n?)*', re.M | re.I)
_IMG_TAG_RE = re.compile(r'\[Image:[^\]]+\]|codex-clipboard-[a-f0-9-]+\.png|media_\d+(?:_[a-f0-9]+)?\.png', re.I)


def _parse_iso_ts(val: Any) -> float | None:
    if val is None or val == '':
        return None
    if isinstance(val, (int, float)):
        v = float(val)
        return v / 1000.0 if v > 1e11 else v
    s = str(val).strip()
    if not s:
        return None
    try:
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        return dt.datetime.fromisoformat(s).timestamp()
    except Exception:
        return None


def _vn_day_of(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, tz=VN_TZ).strftime('%Y-%m-%d')


def _ts_to_vn_iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, tz=VN_TZ).strftime('%Y-%m-%dT%H:%M:%S+07:00')


def _norm_project_name(cwd: str, fallback: str = '') -> str:
    if fallback:
        return redact_sensitive_text(fallback, 80)
    c = str(cwd or '').strip().replace('\\', '/').rstrip('/')
    if not c:
        return ''
    parts = [p for p in c.split('/') if p]
    if not parts:
        return ''
    if parts[-1].lower() in ('ag', 'duan', 'business', 'projects') and len(parts) >= 2:
        return parts[-1]
    return parts[-1][:64]


def strip_prompt_boilerplate(raw_text: str) -> tuple[str, bool, bool]:
    """
    Làm sạch wrapper IDE/XML khỏi nội dung user prompt.
    Trả về: (clean_text, has_image, is_auto_boilerplate).
    """
    if not raw_text:
        return '', False, True
    s = str(raw_text).strip()
    if not s:
        return '', False, True

    has_image = bool(_IMG_TAG_RE.search(s))

    # Extract explicit Antigravity <USER_REQUEST> if present
    m_req = _USER_REQ_RE.search(s)
    if m_req:
        s = m_req.group(1).strip()

    # Auto system/cron/resume notifications
    if _AUTO_BOILERPLATE_RE.match(s):
        return '', has_image, True

    # Strip injected XML blocks
    s = _XML_BLOCK_RE.sub('', s).strip()

    # Codex "# Files mentioned by the user: ... ## My request for Codex: ..."
    m_codex = _CODEX_MY_REQ_RE.search(s)
    if m_codex:
        s = m_codex.group(1).strip()
    else:
        s = _CODEX_FILES_HDR_RE.sub('', s).strip()

    # Strip IDE attachment lines only if real text remains
    s_clean = _IMG_TAG_RE.sub('', s).strip()
    if not s_clean:
        if has_image:
            return '[Gửi ảnh chụp màn hình]', True, False
        return '', has_image, True

    # Ignore bare slash commands (/usage, /clear, /compact, /model, ...) unless paired with rich instruction
    first_line = s_clean.splitlines()[0].strip()
    if len(s_clean) < 60 and _SLASH_CMD_ONLY_RE.match(s_clean):
        if first_line.split()[0].lower() not in ('/grill-me', '/plan', '/goal', '/boost', '/teamwork'):
            return '', has_image, True

    return s_clean, has_image, False


_BOT_WORKER_PREFIX_RE = re.compile(
    r'^(?:Bạn là (?:chuyên gia\b|Kiểm toán viên|Hội đồng|Codex|Claude|Subagent|Agent|Trợ lý AI)|'
    r'This is a side question from the user\. You MUST|'
    r'ROLE\s*[:\n]|SYSTEM\s*[:\n]|\[(?:AUTO|CRON|BACKGROUND|WORKFLOW)\])',
    re.I,
)


def _is_automated_worker_session(first_text: str, n_human: int) -> bool:
    t = (first_text or '').strip()
    if not t:
        return False
    if n_human <= 2 and _BOT_WORKER_PREFIX_RE.match(t):
        return True
    return False


def _classify_prompt(text: str) -> tuple[bool, bool, bool, bool]:
    """(is_short_nudge, is_vague_error, is_corr_kw, is_question_reply)"""
    low = re.sub(r'[.!?,…\s]+$', '', text.strip().lower())
    is_short = (low in _SHORT_NUDGES_EXACT) or (len(low) <= 20 and not any(ch in low for ch in ('/', '\\', 'http', ':', '.')))
    is_vague = bool(_VAGUE_ERROR_RE.match(text.strip()))
    is_corr = bool(_CORR_KW_RE.search(text)) or is_vague
    is_q_reply = bool(_QUESTION_REPLY_RE.match(text.strip())) and len(text.strip()) <= 65
    return is_short, is_vague, is_corr, is_q_reply


def compute_active_hours(timestamps: list[float], gap_s: float = 600.0, pad_s: float = 180.0) -> float:
    """Tính số giờ thao tác thực (bỏ qua khoảng nghỉ dài > 10 phút, mỗi cụm tối thiểu ~3 phút)."""
    if not timestamps:
        return 0.0
    ts_sorted = sorted(timestamps)
    total_s = pad_s
    for i in range(1, len(ts_sorted)):
        delta = ts_sorted[i] - ts_sorted[i - 1]
        if 0.0 <= delta <= gap_s:
            total_s += delta
        else:
            total_s += pad_s
    return round(total_s / 3600.0, 3)


_CODE_FILE_EXTS = (
    'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'rs', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'h',
    'css', 'scss', 'html', 'vue', 'svelte', 'sql', 'sqlite', 'db', 'json', 'jsonl',
    'yaml', 'yml', 'toml', 'md', 'sh', 'ps1', 'bat', 'conf', 'service', 'lock',
)
_TEXT_FILE_REF_RE = re.compile(
    r'(?<![A-Za-z0-9_@:/])((?:[A-Za-z0-9_.\-]{1,60}[/\\]){0,8}[A-Za-z0-9_.\-]{1,64}\.(?:'
    + '|'.join(_CODE_FILE_EXTS)
    + r'))(?![A-Za-z0-9_.])',
    re.I,
)
_MD_CODE_FENCE_RE = re.compile(r'```.*?```', re.S)
_MD_LINK_RE = re.compile(r'\[([^\]]+)\]\([^)]+\)')
_AG_CORTEX_TOOL_RE = re.compile(r'\bcortex tool\s+([A-Za-z0-9_]+)\b')
_AG_HDR_TS_RE = re.compile(r'^(?:Created At:[^\n]*\n?|Completed At:[^\n]*\n?)+', re.I)
_AG_TAIL_CREATED_RE = re.compile(r'"created_at"\s*:\s*"([^"]{19,35})"')
_CLAUDE_TUID_RE = re.compile(r'"tool_use_id"\s*:\s*"([^"]{4,80})"')
_AG_WRITE_TOOLS = frozenset({
    'write_to_file', 'replace_file_content', 'multi_replace_file_content',
    'edit_file', 'write_file', 'delete_file',
})
_CLAUDE_WRITE_TOOLS = frozenset({'Edit', 'Write', 'MultiEdit', 'NotebookEdit'})
_NOISE_PATH_MARKERS = (
    '/.gemini/antigravity/brain/',
    '/.system_generated/',
    '/.claude/projects/',
    '/appdata/local/temp/',
    '/tmp/claude',
    'codex-clipboard-',
)


def _normalize_touched_file(raw_path: Any, cwd: str = '') -> str:
    """Chuẩn hóa đường dẫn file chạm tới về dạng rút gọn/basename sạch (<=60 ký tự, không lộ đường dẫn nhạy cảm)."""
    if not raw_path:
        return ''
    p = str(raw_path).strip().strip('`"\'()[]<>.,;:')
    if not p:
        return ''
    if p.lower().startswith('file:///'):
        p = urllib.parse.unquote(p[8:])
    elif p.lower().startswith(('http://', 'https://')):
        return ''
    p = p.replace('\\', '/').strip()
    while '//' in p:
        p = p.replace('//', '/')
    p_low = p.lower()
    if any(m in p_low for m in _NOISE_PATH_MARKERS):
        return ''
    if cwd:
        c_norm = str(cwd).replace('\\', '/').rstrip('/')
        if c_norm and p_low.startswith(c_norm.lower() + '/'):
            p = p[len(c_norm) + 1:]
    parts = [seg for seg in p.split('/') if seg and seg not in ('.', '..')]
    if not parts:
        return ''
    # Collapse absolute drive/root paths or overly long nested paths to compact 2-segment path / basename
    if ':' in parts[0] or p.startswith('/') or len('/'.join(parts)) > 56:
        compact = '/'.join(parts[-2:]) if len(parts) >= 2 else parts[-1]
        if len(compact) > 56:
            compact = parts[-1][:56]
    else:
        compact = '/'.join(parts)
    if '.' not in parts[-1] and len(parts) == 1:
        return ''
    cleaned = redact_sensitive_text(compact, 59)[:60].strip()
    if not cleaned or '[REDACTED]' in cleaned:
        return ''
    return cleaned


def _extract_files_from_text(text: str, cwd: str = '', limit: int = 4) -> list[str]:
    if not text:
        return []
    out: list[str] = []
    for m in _TEXT_FILE_REF_RE.finditer(text[:6000]):
        cand = _normalize_touched_file(m.group(1), cwd)
        if cand and cand not in out:
            out.append(cand)
            if len(out) >= limit:
                break
    return out


def _clean_assistant_summary(raw_text: Any) -> str:
    """Rút gọn kết luận cuối của Assistant <= 180 ký tự, loại bỏ code fence & che bí mật."""
    if not raw_text:
        return ''
    s = str(raw_text).strip()
    if not s:
        return ''
    s = _MD_CODE_FENCE_RE.sub(' ', s)
    s = _MD_LINK_RE.sub(r'\1', s)
    s = re.sub(r'(?m)^\s*#{1,6}\s*', '', s)
    s = s.replace('**', '').replace('__', '')
    s = re.sub(r'\s+', ' ', s).strip()
    if not s:
        return ''
    return redact_sensitive_text(s, 179)[:180].strip()


def _clean_ag_err_text(err_val: Any, content_val: Any = '') -> str:
    txt = str(err_val or '').strip()
    if not txt and content_val:
        txt = _AG_HDR_TS_RE.sub('', str(content_val)).strip()
    if not txt:
        return ''
    return redact_sensitive_text(txt, 219)[:220].replace('\n', ' ').strip()


def _record_turn_tools(
    human_events: list[dict[str, Any]],
    tool_names: list[str] | None = None,
    had_error: bool = False,
    err_text: str = '',
    *,
    failed_tools: list[str] | None = None,
    edit_files: list[str] | None = None,
    read_files: list[str] | None = None,
    assistant_text: str = '',
    step_ts: float | None = None,
) -> None:
    """Gắn trace tool calls, file chạm tới, kết luận AI & lỗi trợ lý vào đúng câu prompt kích hoạt lượt đó (HRPO Link)."""
    if not human_events:
        return
    ev = human_events[-1]
    if step_ts is not None and step_ts >= float(ev.get('ts') or 0.0):
        prev_end = float(ev.get('_end_step_ts') or 0.0)
        if step_ts > prev_end:
            ev['_end_step_ts'] = step_ts
    if tool_names:
        cur_tools = ev.setdefault('tools_triggered', [])
        for tn in tool_names:
            tname = str(tn or '').strip()[:48]
            if tname and tname not in cur_tools and len(cur_tools) < 6:
                cur_tools.append(tname)
        ev['tool_call_count'] = int(ev.get('tool_call_count') or 0) + len(tool_names)
    if edit_files:
        cur_ef = ev.setdefault('_edit_files', [])
        for fp in edit_files:
            if fp and fp not in cur_ef and len(cur_ef) < 6:
                cur_ef.append(fp)
    if read_files:
        cur_rf = ev.setdefault('_read_files', [])
        for fp in read_files:
            if fp and fp not in cur_rf and len(cur_rf) < 6:
                cur_rf.append(fp)
    if assistant_text:
        at_strip = str(assistant_text).strip()
        if at_strip:
            ev['_assistant_text'] = at_strip
    if had_error:
        ev['had_tool_error'] = True
        if err_text and not ev.get('assistant_err_snippet'):
            ev['assistant_err_snippet'] = redact_sensitive_text(err_text, 219)[:220].replace('\n', ' ').strip()
        if failed_tools:
            cur_ft = ev.setdefault('failed_tools', [])
            for ft in failed_tools:
                ft_clean = str(ft or '').strip()[:48]
                if ft_clean and ft_clean not in cur_ft and len(cur_ft) < 3:
                    cur_ft.append(ft_clean)


def build_session_record(
    tool: str,
    session_id: str,
    title: str,
    project: str,
    cwd: str,
    is_sub: bool,
    human_events: list[dict[str, Any]],
    n_raw_msgs: int,
    n_auto_msgs: int,
    auto_breakdown: dict[str, int] | None = None,
    nhip_labels: dict[str, dict[str, Any]] | None = None,
    fallback_start_ts: float = 0.0,
    fallback_end_ts: float = 0.0,
    total_tool_calls: int = 0,
    max_consecutive_tool_calls: int = 0,
    tool_error_count: int = 0,
    redirection_count: int | None = None,
    last_activity_ts: float = 0.0,
    is_running: bool = False,
    is_pinned: bool = False,
) -> dict[str, Any] | None:
    """Tổng hợp 1 session từ danh sách human_events đã lọc."""
    if not human_events and n_auto_msgs == 0:
        return None
    human_events.sort(key=lambda e: e['ts'])
    all_ts = [e['ts'] for e in human_events]
    start_ts = all_ts[0] if all_ts else fallback_start_ts
    end_ts = all_ts[-1] if all_ts else fallback_end_ts
    if start_ts <= 0:
        return None
    if end_ts < start_ts:
        end_ts = start_ts

    start_day = _vn_day_of(start_ts)
    end_day = _vn_day_of(end_ts)

    n_human = len(human_events)
    n_short = sum(1 for e in human_events if e['is_short_nudge'])
    n_vague = sum(1 for e in human_events if e['is_vague_error'])
    n_corr = sum(1 for e in human_events if e['is_corr_kw'])
    n_q = sum(1 for e in human_events if e['is_question_reply'])
    n_img = sum(1 for e in human_events if e['has_image'])

    lengths = [len(e['text']) for e in human_events]
    first_len = lengths[0] if lengths else 0
    avg_len = round(sum(lengths) / max(1, len(lengths)), 1) if lengths else 0.0
    first_preview = redact_sensitive_text(human_events[0]['text'], 220).replace('\n', ' ') if human_events else ''

    # Day breakdown in +07:00
    by_day: dict[str, dict[str, Any]] = {}
    for e in human_events:
        d = _vn_day_of(e['ts'])
        slot = by_day.setdefault(d, {
            'day': d,
            'ts_list': [],
            'human_prompts': 0,
            'short_nudges': 0,
            'vague_errors': 0,
            'corr_kw': 0,
        })
        slot['ts_list'].append(e['ts'])
        slot['human_prompts'] += 1
        if e['is_short_nudge']:
            slot['short_nudges'] += 1
        if e['is_vague_error']:
            slot['vague_errors'] += 1
        if e['is_corr_kw']:
            slot['corr_kw'] += 1

    # Distribute n_auto_msgs onto end_day (or proportionally across days)
    day_breakdown = []
    days_sorted = sorted(by_day.keys()) or [start_day]
    for idx_d, d in enumerate(days_sorted):
        sl = by_day.get(d) or {'ts_list': [start_ts], 'human_prompts': 0, 'short_nudges': 0, 'vague_errors': 0, 'corr_kw': 0}
        share_auto = n_auto_msgs if idx_d == len(days_sorted) - 1 else 0
        day_breakdown.append({
            'day': d,
            'human_prompts': sl['human_prompts'],
            'raw_msgs': sl['human_prompts'] + share_auto,
            'auto_msgs': share_auto,
            'active_hours': compute_active_hours(sl['ts_list']),
            'short_nudges': sl['short_nudges'],
            'vague_errors': sl['vague_errors'],
            'corr_kw': sl['corr_kw'],
        })

    clean_hours = round(sum(x['active_hours'] for x in day_breakdown), 3) if human_events else 0.0
    wall_hours = round(max(0.0, (end_ts - start_ts) / 3600.0), 2)

    # Historical nhip-v1 label enrichment if available
    corr_rate = None
    if nhip_labels and human_events:
        labeled = []
        for e in human_events:
            pid = e.get('prompt_id')
            if pid and pid in nhip_labels:
                labeled.append(nhip_labels[pid])
        if len(labeled) >= 2:
            corr_cnt = sum(1 for x in labeled if (x.get('kind') == 'correction') or (x.get('correction_cause')))
            corr_rate = round(corr_cnt / len(labeled), 4)

    # Full chronological prompt history (up to 200 prompts per session, 1200 chars redacted each)
    if n_human <= 200:
        selected_idx = list(range(n_human))
    else:
        selected_idx = []
        seen_i: set[int] = set()
        for i in range(140):
            seen_i.add(i)
            selected_idx.append(i)
        for i, e in enumerate(human_events):
            if len(selected_idx) >= 160:
                break
            if i not in seen_i and (e['is_short_nudge'] or e['is_vague_error'] or e['is_corr_kw']):
                seen_i.add(i)
                selected_idx.append(i)
        for i in range(max(0, n_human - 40), n_human):
            if i not in seen_i and len(selected_idx) < 200:
                seen_i.add(i)
                selected_idx.append(i)
        selected_idx.sort()

    prompts_sample = []
    for i in selected_idx:
        e = human_events[i]
        prev_ts = human_events[i - 1]['ts'] if i > 0 else e['ts']
        gap_min = round(max(0.0, (e['ts'] - prev_ts) / 60.0), 1) if i > 0 else 0.0

        # Compute authentic turn_duration_s (float | None)
        turn_dur: float | None = None
        explicit_dur = e.get('turn_duration_s')
        if explicit_dur is not None:
            try:
                dv = float(explicit_dur)
                if 0.0 < dv <= 14400.0:
                    turn_dur = round(max(0.1, dv), 1)
            except Exception:
                turn_dur = None
        elif e.get('_end_step_ts') is not None:
            end_st = float(e['_end_step_ts'] or 0.0)
            next_u_ts = float(human_events[i + 1]['ts']) if (i + 1) < n_human else 0.0
            if next_u_ts > 0.0 and end_st > next_u_ts + 5.0:
                end_st = next_u_ts
            delta_s = end_st - float(e['ts'])
            if 0.0 < delta_s <= 14400.0:
                turn_dur = round(max(0.1, delta_s), 1)

        # Normalize files_touched[:4] (prioritizing edited/written files over read files)
        files_touched: list[str] = []
        pre_files = e.get('files_touched')
        if isinstance(pre_files, list) and pre_files:
            for pf in pre_files:
                nf = _normalize_touched_file(pf, cwd)
                if nf and nf not in files_touched:
                    files_touched.append(nf)
                    if len(files_touched) >= 4:
                        break
        else:
            for raw_fp in [*(e.get('_edit_files') or []), *(e.get('_read_files') or [])]:
                nf = _normalize_touched_file(raw_fp, cwd)
                if nf and nf not in files_touched:
                    files_touched.append(nf)
                    if len(files_touched) >= 4:
                        break

        # Clean assistant_summary (<=180 chars redacted, "" if none)
        if 'assistant_summary' in e and isinstance(e.get('assistant_summary'), str):
            asst_sum = _clean_assistant_summary(e.get('assistant_summary'))
        else:
            asst_sum = _clean_assistant_summary(e.get('_assistant_text') or '')

        failed_tools_out: list[str] = []
        for ft in (e.get('failed_tools') or []):
            fts = str(ft or '').strip()[:48]
            if fts and fts not in failed_tools_out:
                failed_tools_out.append(fts)
                if len(failed_tools_out) >= 3:
                    break

        prompts_sample.append({
            'idx': i + 1,
            'ts_iso': _ts_to_vn_iso(e['ts']),
            'day': _vn_day_of(e['ts']),
            'chars': len(e['text']),
            'words': len(e['text'].split()),
            'gap_min': gap_min,
            'is_short_nudge': e['is_short_nudge'],
            'is_vague_error': e['is_vague_error'],
            'is_corr_kw': e['is_corr_kw'],
            'is_question_reply': e['is_question_reply'],
            'has_image': e['has_image'],
            'tools_triggered': list(e.get('tools_triggered') or [])[:6],
            'tool_call_count': int(e.get('tool_call_count') or 0),
            'had_tool_error': bool(e.get('had_tool_error')),
            'assistant_err_snippet': str(e.get('assistant_err_snippet') or '')[:220],
            'turn_duration_s': turn_dur,
            'assistant_summary': asst_sum,
            'files_touched': files_touched,
            'failed_tools': failed_tools_out,
            'text_redacted': redact_sensitive_text(e['text'], 1200),
        })

    clean_title = redact_sensitive_text(title or first_preview or session_id, 160).replace('\n', ' ').strip()
    effective_is_sub = bool(is_sub) or _is_automated_worker_session(
        human_events[0]['text'] if human_events else title, n_human
    )
    eff_total_tools = max(int(total_tool_calls or 0), sum(int(e.get('tool_call_count') or 0) for e in human_events))
    eff_redir = int(redirection_count) if redirection_count is not None else n_corr
    max_step_ts = max((float(e.get('_end_step_ts') or 0.0) for e in human_events), default=0.0)
    eff_last_act = round(max(end_ts, float(fallback_end_ts or 0.0), float(last_activity_ts or 0.0), max_step_ts), 3)
    return {
        'tool': tool,
        'session_id': session_id,
        'title': clean_title,
        'project': _norm_project_name(cwd, project),
        'cwd': redact_sensitive_text(cwd, 160),
        'is_sub': effective_is_sub,
        'is_fork_clone': False,
        'start_ts': round(start_ts, 3),
        'end_ts': round(end_ts, 3),
        'last_activity_ts': eff_last_act,
        'is_running': bool(is_running),
        'is_pinned': bool(is_pinned),
        'start_day': start_day,
        'end_day': end_day,
        'n_raw_msgs': max(n_raw_msgs, n_human + n_auto_msgs),
        'n_human_prompts': n_human,
        'n_auto_msgs': n_auto_msgs,
        'auto_breakdown': auto_breakdown or {},
        'clean_active_hours': clean_hours,
        'wall_hours': wall_hours,
        'busy_hours': clean_hours,
        'n_short_nudges': n_short,
        'n_vague_errors': n_vague,
        'n_corr_kw': n_corr,
        'n_question_replies': n_q,
        'n_with_image': n_img,
        'first_human_len': first_len,
        'avg_human_len': avg_len,
        'first_human_preview': first_preview,
        'correction_rate': corr_rate,
        'total_tool_calls': eff_total_tools,
        'max_consecutive_tool_calls': int(max_consecutive_tool_calls or 0),
        'tool_error_count': int(tool_error_count or 0),
        'redirection_count': eff_redir,
        'day_breakdown': day_breakdown,
        'prompts_sample': prompts_sample,
        '_dedup_sig': [
            [int(round(e['ts'], 0)), hashlib.sha256(e['text'][:120].encode('utf-8', errors='replace')).hexdigest()[:16]]
            for e in human_events[:3]
        ],
    }


def _open_pc_cache() -> sqlite3.Connection:
    CACHE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(str(CACHE_DB_PATH), timeout=15.0)
    con.execute('PRAGMA journal_mode=WAL')
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS file_cache (
            source_key TEXT PRIMARY KEY,
            mtime_ns INTEGER NOT NULL,
            size_bytes INTEGER NOT NULL,
            record_json TEXT NOT NULL
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS cache_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    row = con.execute("SELECT value FROM cache_meta WHERE key = 'schema_v'").fetchone()
    if not row or str(row[0] or '') != 'v4':
        con.execute('DELETE FROM file_cache')
        con.execute("INSERT OR REPLACE INTO cache_meta (key, value) VALUES ('schema_v', 'v4')")
    con.commit()
    return con


def _load_nhip_labels() -> dict[str, dict[str, Any]]:
    return {}


def _load_legacy_jsonl_baseline(tool: str, nhip_labels: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:  # noqa: ARG001
    return {}


def _extract_claude_live(
    cache_con: sqlite3.Connection,
    force_full: bool,
    nhip_labels: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not CLAUDE_PROJECTS_DIR.is_dir():
        return {}
    out: dict[str, dict[str, Any]] = {}
    cached_rows = {}
    if not force_full:
        for row in cache_con.execute("SELECT source_key, mtime_ns, size_bytes, record_json FROM file_cache WHERE source_key LIKE 'claude:%'").fetchall():
            cached_rows[row[0]] = (row[1], row[2], row[3])

    updates: list[tuple[str, int, int, str]] = []
    for fp in CLAUDE_PROJECTS_DIR.rglob('*.jsonl'):
        try:
            st = fp.stat()
        except OSError:
            continue
        if st.st_size < 40:
            continue
        sid = fp.stem
        ckey = f'claude:{fp}'
        if not force_full and ckey in cached_rows:
            cm, cs, rj = cached_rows[ckey]
            if cm == st.st_mtime_ns and cs == st.st_size:
                if rj != '{}':
                    rec = json.loads(rj)
                    out[sid] = rec
                continue

        is_sub = ('subagents' in str(fp).lower()) or sid.startswith('agent-')
        cwd = ''
        title = ''
        human_events: list[dict[str, Any]] = []
        n_raw = 0
        n_auto = 0
        auto_bd: dict[str, int] = collections.Counter()
        total_tool_calls = 0
        cur_consec_tools = 0
        max_consec_tools = 0
        tool_error_count = 0
        last_act_ts = 0.0
        tool_id_map: dict[str, str] = {}

        try:
            with open(fp, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    has_u = ('"type":"user"' in line) or ('"type": "user"' in line)
                    has_a = ('"type":"assistant"' in line) or ('"type": "assistant"' in line)
                    has_s = (not title) and (('"type":"summary"' in line) or ('"type": "summary"' in line))
                    if not has_u and not has_a and not has_s:
                        continue
                    # Fast-path skip giant base64 screenshot / blob tool_result lines without JSON decode (check for error first)
                    if has_u and len(line) > 262144 and '"tool_result"' in line and '"type":"text"' not in line[:4096]:
                        n_raw += 1
                        n_auto += 1
                        auto_bd['tool_result_blob'] += 1
                        if '"is_error":true' in line[:8192] or '"is_error": true' in line[:8192]:
                            tool_error_count += 1
                            m_tu = _CLAUDE_TUID_RE.search(line[:4096])
                            ft_blob = tool_id_map.get(m_tu.group(1), '') if m_tu else ''
                            _record_turn_tools(
                                human_events,
                                had_error=True,
                                err_text='Tool result error (large output)',
                                failed_tools=[ft_blob] if ft_blob else None,
                            )
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    otype = obj.get('type')
                    if otype == 'summary' and not title:
                        title = str(obj.get('summary') or '')[:160]
                        continue
                    if otype == 'assistant':
                        a_ts = _parse_iso_ts(obj.get('timestamp'))
                        if a_ts is not None and a_ts > last_act_ts:
                            last_act_ts = a_ts
                        content_a = (obj.get('message') or {}).get('content')
                        t_names: list[str] = []
                        edit_f: list[str] = []
                        read_f: list[str] = []
                        last_txt_a = ''
                        if isinstance(content_a, list):
                            for b in content_a:
                                if not isinstance(b, dict):
                                    continue
                                bt_a = b.get('type')
                                if bt_a == 'tool_use':
                                    tname = str(b.get('name') or '').strip()
                                    tu_id = str(b.get('id') or '').strip()
                                    if tname:
                                        t_names.append(tname)
                                        if tu_id:
                                            tool_id_map[tu_id] = tname
                                    inp = b.get('input')
                                    if isinstance(inp, dict):
                                        fp_val = inp.get('file_path') or inp.get('notebook_path') or inp.get('path')
                                        if fp_val:
                                            if tname in _CLAUDE_WRITE_TOOLS:
                                                edit_f.append(str(fp_val))
                                            else:
                                                read_f.append(str(fp_val))
                                elif bt_a == 'text' and b.get('text'):
                                    txt_cand = str(b.get('text') or '').strip()
                                    if txt_cand:
                                        last_txt_a = txt_cand
                        elif isinstance(content_a, str) and content_a.strip():
                            last_txt_a = content_a.strip()

                        if t_names:
                            total_tool_calls += len(t_names)
                            cur_consec_tools += len(t_names)
                            if cur_consec_tools > max_consec_tools:
                                max_consec_tools = cur_consec_tools
                        if t_names or edit_f or read_f or last_txt_a or a_ts is not None:
                            _record_turn_tools(
                                human_events,
                                tool_names=t_names or None,
                                edit_files=edit_f or None,
                                read_files=read_f or None,
                                assistant_text=last_txt_a,
                                step_ts=a_ts,
                            )
                        continue
                    if otype != 'user':
                        continue
                    n_raw += 1
                    if obj.get('isSidechain'):
                        is_sub = True
                    if not cwd and obj.get('cwd'):
                        cwd = str(obj.get('cwd') or '')
                    if obj.get('isMeta'):
                        n_auto += 1
                        auto_bd['isMeta'] += 1
                        continue
                    ts = _parse_iso_ts(obj.get('timestamp'))
                    if ts is None:
                        continue
                    if ts > last_act_ts:
                        last_act_ts = ts
                    msg = obj.get('message') or {}
                    content = msg.get('content')
                    raw_text = ''
                    has_img = False
                    only_tool_res = False
                    if isinstance(content, str):
                        raw_text = content
                    elif isinstance(content, list):
                        text_parts = []
                        has_tool_res = False
                        for blk in content:
                            if not isinstance(blk, dict):
                                continue
                            btype = blk.get('type')
                            if btype == 'tool_result':
                                has_tool_res = True
                                if blk.get('is_error'):
                                    tool_error_count += 1
                                    bc = blk.get('content')
                                    err_txt = ''
                                    if isinstance(bc, str):
                                        err_txt = bc
                                    elif isinstance(bc, list):
                                        err_txt = ' '.join(str(x.get('text') or '') for x in bc if isinstance(x, dict))
                                    tuid = str(blk.get('tool_use_id') or '').strip()
                                    ft_name = tool_id_map.get(tuid, '')
                                    _record_turn_tools(
                                        human_events,
                                        had_error=True,
                                        err_text=err_txt or 'Claude tool_result is_error',
                                        failed_tools=[ft_name] if ft_name else None,
                                        step_ts=ts,
                                    )
                                else:
                                    _record_turn_tools(human_events, step_ts=ts)
                            elif btype == 'image':
                                has_img = True
                            elif btype == 'text' and blk.get('text'):
                                text_parts.append(str(blk['text']))
                        raw_text = '\n'.join(text_parts).strip()
                        if has_tool_res and not raw_text:
                            only_tool_res = True
                    if only_tool_res:
                        n_auto += 1
                        auto_bd['tool_result'] += 1
                        continue

                    clean_t, img2, is_auto = strip_prompt_boilerplate(raw_text)
                    has_img = has_img or img2
                    if is_auto or not clean_t:
                        n_auto += 1
                        auto_bd['boilerplate'] += 1
                        continue

                    sn, ve, ck, qr = _classify_prompt(clean_t)
                    pid = f"claude:{sid}:{obj.get('uuid') or len(human_events)}"
                    cur_consec_tools = 0
                    human_events.append({
                        'ts': ts,
                        'text': clean_t,
                        'has_image': has_img,
                        'is_short_nudge': sn,
                        'is_vague_error': ve,
                        'is_corr_kw': ck,
                        'is_question_reply': qr,
                        'prompt_id': pid,
                    })
        except Exception:
            continue

        rec = build_session_record(
            tool='claude',
            session_id=sid,
            title=title,
            project='',
            cwd=cwd,
            is_sub=is_sub,
            human_events=human_events,
            n_raw_msgs=n_raw,
            n_auto_msgs=n_auto,
            auto_breakdown=dict(auto_bd),
            nhip_labels=nhip_labels,
            total_tool_calls=total_tool_calls,
            max_consecutive_tool_calls=max_consec_tools,
            tool_error_count=tool_error_count,
            last_activity_ts=last_act_ts,
        )
        if rec:
            # Prefer full non-subagent if same sid somehow collides
            if sid not in out or len(rec.get('prompts_sample') or []) >= len(out[sid].get('prompts_sample') or []):
                out[sid] = rec
            updates.append((ckey, st.st_mtime_ns, st.st_size, json.dumps(rec, ensure_ascii=False)))
        else:
            updates.append((ckey, st.st_mtime_ns, st.st_size, '{}'))
        if len(updates) >= 250:
            cache_con.executemany('INSERT OR REPLACE INTO file_cache (source_key, mtime_ns, size_bytes, record_json) VALUES (?, ?, ?, ?)', updates)
            cache_con.commit()
            updates.clear()

    if updates:
        cache_con.executemany('INSERT OR REPLACE INTO file_cache (source_key, mtime_ns, size_bytes, record_json) VALUES (?, ?, ?, ?)', updates)
        cache_con.commit()
    return out


_AG_PROJECTS_CACHE: dict[str, Any] = {'at': 0.0, 'data': {}}
_AG_ANNOT_CACHE: dict[str, Any] = {'at': 0.0, 'dir_mtime_ns': 0, 'files': {}}


def _load_ag_projects_cfg() -> dict[str, tuple[str, str]]:
    """Đọc ~/.gemini/config/projects/*.json -> {project_id: (project_name, folder_path)}."""
    now = time.time()
    if _AG_PROJECTS_CACHE['data'] and (now - float(_AG_PROJECTS_CACHE['at'])) < 30.0:
        return _AG_PROJECTS_CACHE['data']
    out: dict[str, tuple[str, str]] = {}
    if AG_PROJECTS_CFG_DIR.is_dir():
        for p in AG_PROJECTS_CFG_DIR.glob('*.json'):
            try:
                d = json.loads(p.read_text(encoding='utf-8', errors='replace'))
            except Exception:
                continue
            pid = str(d.get('id') or p.stem).strip()
            pname = str(d.get('name') or pid).strip()
            folder_path = ''
            resources = (d.get('projectResources') or {}).get('resources') or []
            if resources and isinstance(resources[0], dict):
                r0 = resources[0]
                f_uri = str(r0.get('folderUri') or (r0.get('gitFolder') or {}).get('folderUri') or '')
                if f_uri.startswith('file:///'):
                    folder_path = urllib.parse.unquote(f_uri[8:])
                else:
                    folder_path = f_uri
            if pid:
                out[pid] = (pname, folder_path)
    _AG_PROJECTS_CACHE['at'] = now
    _AG_PROJECTS_CACHE['data'] = out
    return out


def _load_ag_annotations_meta() -> dict[str, dict[str, Any]]:
    """Đọc nhanh ~/.gemini/antigravity/annotations/*.pbtxt (có cache theo mtime từng file)."""
    now = time.time()
    if _AG_ANNOT_CACHE['files'] and (now - float(_AG_ANNOT_CACHE['at'])) < 2.5:
        return {k: v[1] for k, v in _AG_ANNOT_CACHE['files'].items()}
    if not AG_ANNOTATIONS_DIR.is_dir():
        return {}
    cached_files: dict[str, tuple[int, dict[str, Any]]] = _AG_ANNOT_CACHE['files']
    seen: set[str] = set()
    for p in AG_ANNOTATIONS_DIR.glob('*.pbtxt'):
        cid = p.stem
        seen.add(cid)
        try:
            st_m = p.stat().st_mtime_ns
        except OSError:
            continue
        prev = cached_files.get(cid)
        if prev and prev[0] == st_m:
            continue
        try:
            txt = p.read_text(encoding='utf-8', errors='replace')
        except OSError:
            continue
        pinned = bool(re.search(r'pinned:\s*true', txt))
        m_title = re.search(r'title:\s*"((?:[^"\\]|\\.)*)"', txt)
        title = m_title.group(1).replace('\\"', '"').strip() if m_title else ''
        cached_files[cid] = (st_m, {'pinned': pinned, 'title': title})
    for stale_k in list(cached_files.keys()):
        if stale_k not in seen:
            cached_files.pop(stale_k, None)
    _AG_ANNOT_CACHE['at'] = now
    return {k: v[1] for k, v in cached_files.items()}


def _load_ag_summaries_meta() -> dict[str, dict[str, Any]]:
    """Đọc trực tiếp ~/.gemini/antigravity/conversation_summaries.db + annotations + projects để đồng bộ 1:1 thứ tự realtime với Antigravity PC."""
    if not AG_SUMMARIES_DB.is_file():
        return {}
    out: dict[str, dict[str, Any]] = {}
    now_ts = time.time()
    proj_cfg = _load_ag_projects_cfg()
    ann_map = _load_ag_annotations_meta()
    try:
        con = sqlite3.connect(f'file:{AG_SUMMARIES_DB.as_posix()}?mode=ro', uri=True, timeout=5.0)
        try:
            cols = {str(r[1]) for r in con.execute('PRAGMA table_info(conversation_summaries)').fetchall()}
            has_rt = {'last_modified_time', 'status', 'not_fully_idle', 'killed', 'project_id'}.issubset(cols)
            if has_rt:
                rows = con.execute(
                    """
                    SELECT conversation_id, title, workspace_uris, parent_conversation_id,
                           nesting_depth, agent_name, last_modified_time, status,
                           not_fully_idle, killed, project_id
                    FROM conversation_summaries
                    """
                ).fetchall()
            else:
                rows = [
                    (*r, '', '', 0, 0, '')
                    for r in con.execute(
                        """
                        SELECT conversation_id, title, workspace_uris, parent_conversation_id, nesting_depth, agent_name
                        FROM conversation_summaries
                        """
                    ).fetchall()
                ]
        finally:
            con.close()
        for (
            cid, title, ws_json, parent_cid, depth, agent_name,
            last_mod_str, status_raw, not_fully_idle, killed_raw, project_id_raw
        ) in rows:
            cid_s = str(cid or '').strip()
            if not cid_s:
                continue
            cwd_s = ''
            if ws_json:
                try:
                    uris = json.loads(ws_json)
                    if isinstance(uris, list) and uris:
                        u0 = str(uris[0] or '')
                        if u0.startswith('file:///'):
                            cwd_s = urllib.parse.unquote(u0[8:])
                        else:
                            cwd_s = u0
                except Exception:
                    pass
            pid_s = str(project_id_raw or '').strip()
            proj_name = ''
            if pid_s and pid_s in proj_cfg:
                proj_name, cfg_folder = proj_cfg[pid_s]
                if not cwd_s and cfg_folder:
                    cwd_s = cfg_folder
            if not proj_name:
                proj_name = _norm_project_name(cwd_s, '')
            ag_name = str(agent_name or '').strip().lower()
            is_sub = bool(str(parent_cid or '').strip()) or int(depth or 0) > 0 or ag_name in (
                'browser', 'research', 'self', 'image-generator', 'worker'
            )
            ann = ann_map.get(cid_s) or {}
            clean_sm_title = str(ann.get('title') or title or '').strip()
            if clean_sm_title.lower().startswith('the prompt could not be submitted'):
                clean_sm_title = ''
            mod_ts = _parse_iso_ts(last_mod_str) or 0.0
            st_str = str(status_raw or 'CASCADE_RUN_STATUS_IDLE')
            is_running = (
                ('RUNNING' in st_str and (now_ts - mod_ts) < 900.0)
                or (bool(int(not_fully_idle or 0)) and (now_ts - mod_ts) < 45.0)
            )
            out[cid_s] = {
                'title': clean_sm_title,
                'cwd': cwd_s,
                'project': proj_name,
                'is_sub': is_sub,
                'last_modified_ts': mod_ts,
                'status': st_str,
                'is_running': is_running,
                'is_pinned': bool(ann.get('pinned')),
                'is_killed': bool(int(killed_raw or 0)),
            }
    except Exception:
        pass
    return out


def _extract_ag_live(
    cache_con: sqlite3.Connection,
    force_full: bool,
    ph_ag: dict[str, dict[str, Any]],
    nhip_labels: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not AG_BRAIN_DIR.is_dir():
        return {}
    out: dict[str, dict[str, Any]] = {}
    cached_rows = {}
    if not force_full:
        for row in cache_con.execute("SELECT source_key, mtime_ns, size_bytes, record_json FROM file_cache WHERE source_key LIKE 'ag:%'").fetchall():
            cached_rows[row[0]] = (row[1], row[2], row[3])

    live_summaries = _load_ag_summaries_meta()
    sub_child_ids: set[str] = (
        {sid for sid, rec in ph_ag.items() if rec.get('is_sub')}
        | {sid for sid, sm in live_summaries.items() if sm.get('is_sub')}
    )
    conv_id_re = re.compile(r'conversationId["\':\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', re.I)

    t_files = list(AG_BRAIN_DIR.glob('*/.system_generated/logs/transcript.jsonl'))
    tf_mtimes: dict[str, float] = {}
    now_ts = time.time()
    # First pass / cache read
    updates: list[tuple[str, int, int, str]] = []
    for tf in t_files:
        try:
            st = tf.stat()
        except OSError:
            continue
        cid = tf.parent.parent.parent.name
        tf_mtimes[cid] = float(st.st_mtime)
        ckey = f'ag:{cid}'
        if not force_full and ckey in cached_rows:
            cm, cs, rj = cached_rows[ckey]
            if cm == st.st_mtime_ns and cs == st.st_size:
                if rj != '{}':
                    rec = json.loads(rj)
                    out[cid] = rec
                    if rec.get('_spawned_subs'):
                        sub_child_ids.update(rec['_spawned_subs'])
                continue

        human_events: list[dict[str, Any]] = []
        n_raw = 0
        n_auto = 0
        auto_bd: dict[str, int] = collections.Counter()
        spawned: list[str] = []
        is_sub = cid in sub_child_ids
        total_tool_calls = 0
        cur_consec_tools = 0
        max_consec_tools = 0
        tool_error_count = 0
        last_act_ts = 0.0
        pending_tcs: list[str] = []
        gen_idx = 0

        try:
            with open(tf, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    if 'invoke_subagent' in line:
                        for m in conv_id_re.finditer(line):
                            spawned.append(m.group(1))
                    is_user_line = '"USER_INPUT"' in line
                    is_planner_line = '"PLANNER_RESPONSE"' in line
                    has_err = ('"ERROR"' in line) or ('"ERROR_MESSAGE"' in line)
                    if not is_user_line and not is_planner_line and not has_err:
                        if ('"type":"GENERIC"' in line or '"type": "GENERIC"' in line) and not (
                            '"status":"RUNNING"' in line or '"status": "RUNNING"' in line
                        ):
                            gen_idx += 1
                            tail_s = line[-320:] if len(line) > 320 else line
                            m_ts = _AG_TAIL_CREATED_RE.search(tail_s)
                            if m_ts:
                                fast_ts = _parse_iso_ts(m_ts.group(1))
                                if fast_ts is not None:
                                    if fast_ts > last_act_ts:
                                        last_act_ts = fast_ts
                                    _record_turn_tools(human_events, step_ts=fast_ts)
                        continue
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue
                    otype = obj.get('type')
                    s_ts = _parse_iso_ts(obj.get('created_at'))
                    if s_ts is not None and s_ts > last_act_ts:
                        last_act_ts = s_ts
                    if otype != 'USER_INPUT':
                        st_val = str(obj.get('status') or '')
                        if otype == 'PLANNER_RESPONSE':
                            tcs = obj.get('tool_calls')
                            t_names: list[str] = []
                            edit_f: list[str] = []
                            read_f: list[str] = []
                            if isinstance(tcs, list) and tcs:
                                for tc in tcs:
                                    if not isinstance(tc, dict):
                                        continue
                                    tname = str(tc.get('name') or '').strip()
                                    if tname:
                                        t_names.append(tname)
                                    args = tc.get('args') if tc.get('args') is not None else tc.get('arguments')
                                    if isinstance(args, str) and args.lstrip().startswith('{'):
                                        try:
                                            args = json.loads(args)
                                        except Exception:
                                            args = None
                                    if isinstance(args, dict):
                                        fp_arg = args.get('TargetFile') or args.get('Path') or args.get('AbsolutePath')
                                        if fp_arg:
                                            if tname in _AG_WRITE_TOOLS:
                                                edit_f.append(str(fp_arg))
                                            else:
                                                read_f.append(str(fp_arg))
                            pending_tcs = list(t_names)
                            gen_idx = 0
                            if t_names:
                                total_tool_calls += len(t_names)
                                cur_consec_tools += len(t_names)
                                if cur_consec_tools > max_consec_tools:
                                    max_consec_tools = cur_consec_tools
                            c_txt = str(obj.get('content') or '').strip()
                            if t_names or edit_f or read_f or c_txt or s_ts is not None:
                                _record_turn_tools(
                                    human_events,
                                    tool_names=t_names or None,
                                    edit_files=edit_f or None,
                                    read_files=read_f or None,
                                    assistant_text=c_txt,
                                    step_ts=s_ts,
                                )
                            if st_val == 'ERROR':
                                tool_error_count += 1
                                err_txt = _clean_ag_err_text(obj.get('error'), obj.get('content'))
                                _record_turn_tools(
                                    human_events,
                                    had_error=True,
                                    err_text=err_txt or 'Antigravity planner error',
                                    step_ts=s_ts,
                                )
                        elif otype == 'GENERIC':
                            cur_tool = (
                                pending_tcs[gen_idx]
                                if gen_idx < len(pending_tcs)
                                else (pending_tcs[-1] if pending_tcs else '')
                            )
                            if st_val != 'RUNNING':
                                gen_idx += 1
                            if st_val == 'ERROR':
                                m_ct = _AG_CORTEX_TOOL_RE.search(str(obj.get('error') or ''))
                                ft_name = m_ct.group(1) if m_ct else cur_tool
                                tool_error_count += 1
                                err_txt = _clean_ag_err_text(obj.get('error'), obj.get('content'))
                                _record_turn_tools(
                                    human_events,
                                    had_error=True,
                                    err_text=err_txt or 'Antigravity tool error',
                                    failed_tools=[ft_name] if ft_name else None,
                                    step_ts=s_ts,
                                )
                            elif s_ts is not None:
                                _record_turn_tools(human_events, step_ts=s_ts)
                        elif otype == 'ERROR_MESSAGE' or st_val == 'ERROR':
                            tool_error_count += 1
                            err_txt = _clean_ag_err_text(obj.get('error'), obj.get('content'))
                            _record_turn_tools(
                                human_events,
                                had_error=True,
                                err_text=err_txt or 'Antigravity system error',
                                step_ts=s_ts,
                            )
                        continue
                    n_raw += 1
                    src = str(obj.get('source') or '')
                    if src and src != 'USER_EXPLICIT':
                        n_auto += 1
                        auto_bd[f'source:{src}'] += 1
                        continue
                    ts = s_ts
                    if ts is None:
                        continue
                    raw_c = str(obj.get('content') or '')
                    if '<subagent_context>' in raw_c or 'SUBAGENT TASK' in raw_c[:200]:
                        is_sub = True
                    has_media = bool(obj.get('media'))
                    clean_t, img2, is_auto = strip_prompt_boilerplate(raw_c)
                    has_media = has_media or img2
                    if is_auto or not clean_t:
                        n_auto += 1
                        auto_bd['boilerplate'] += 1
                        continue
                    sn, ve, ck, qr = _classify_prompt(clean_t)
                    cur_consec_tools = 0
                    pending_tcs = []
                    gen_idx = 0
                    human_events.append({
                        'ts': ts,
                        'text': clean_t,
                        'has_image': has_media,
                        'is_short_nudge': sn,
                        'is_vague_error': ve,
                        'is_corr_kw': ck,
                        'is_question_reply': qr,
                        'prompt_id': f'ag:{cid}:{obj.get("step_index", len(human_events))}',
                    })
        except Exception:
            continue

        if spawned:
            sub_child_ids.update(spawned)
        ph_meta = ph_ag.get(cid) or {}
        sm_meta = live_summaries.get(cid) or {}
        eff_title = str(sm_meta.get('title') or ph_meta.get('title') or '')
        eff_cwd = str(sm_meta.get('cwd') or ph_meta.get('cwd') or '')
        eff_proj = str(sm_meta.get('project') or ph_meta.get('project') or '')
        rec = build_session_record(
            tool='antigravity',
            session_id=cid,
            title=eff_title,
            project=eff_proj,
            cwd=eff_cwd,
            is_sub=is_sub or bool(sm_meta.get('is_sub')) or bool(ph_meta.get('is_sub')),
            human_events=human_events,
            n_raw_msgs=n_raw,
            n_auto_msgs=n_auto,
            auto_breakdown=dict(auto_bd),
            nhip_labels=nhip_labels,
            total_tool_calls=total_tool_calls,
            max_consecutive_tool_calls=max_consec_tools,
            tool_error_count=tool_error_count,
            last_activity_ts=last_act_ts,
        )
        if rec:
            if spawned:
                rec['_spawned_subs'] = spawned
            out[cid] = rec
            updates.append((ckey, st.st_mtime_ns, st.st_size, json.dumps(rec, ensure_ascii=False)))
        else:
            updates.append((ckey, st.st_mtime_ns, st.st_size, '{}'))

    # Apply sub_child_ids & live conversation_summaries.db titles/projects/running/last_modified_time across all files (including cached ones)
    for cid in list(out.keys()):
        rec = out[cid]
        sm_meta = live_summaries.get(cid)
        tf_mt = float(tf_mtimes.get(cid) or 0.0)
        if sm_meta:
            if sm_meta.get('is_killed'):
                out.pop(cid, None)
                continue
            if sm_meta.get('title'):
                rec['title'] = redact_sensitive_text(sm_meta['title'], 160).replace('\n', ' ').strip()
            if sm_meta.get('cwd') and not rec.get('cwd'):
                rec['cwd'] = redact_sensitive_text(sm_meta['cwd'], 160)
            if sm_meta.get('project'):
                rec['project'] = redact_sensitive_text(sm_meta['project'], 80)
            if sm_meta.get('is_sub'):
                rec['is_sub'] = True
            sm_mod = float(sm_meta.get('last_modified_ts') or 0.0)
            if sm_mod > 0.0:
                mod_epoch = max(sm_mod, tf_mt) if (now_ts - sm_mod) < 7200.0 else sm_mod
                rec['last_activity_ts'] = round(max(float(rec.get('end_ts') or 0.0), mod_epoch), 3)
            is_run = bool(sm_meta.get('is_running'))
            if not is_run and tf_mt > 0.0 and (now_ts - tf_mt) < 6.0 and 'RUNNING' in str(sm_meta.get('status') or ''):
                is_run = True
            rec['is_running'] = is_run
            rec['is_pinned'] = bool(sm_meta.get('is_pinned'))
        else:
            rec.setdefault('is_running', False)
            rec.setdefault('is_pinned', False)
        if cid in sub_child_ids:
            rec['is_sub'] = True
        rec.pop('_spawned_subs', None)

    if updates:
        cache_con.executemany('INSERT OR REPLACE INTO file_cache (source_key, mtime_ns, size_bytes, record_json) VALUES (?, ?, ?, ?)', updates)
        cache_con.commit()
    return out


def _dedup_ag_forks(sessions_map: dict[str, dict[str, Any]]) -> None:
    """Đánh dấu bản sao fork Antigravity (giữ bản dài nhất/mới nhất, gắn is_fork_clone=True cho bản trùng)."""
    buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = collections.defaultdict(list)
    for rec in sessions_map.values():
        if rec.get('is_sub'):
            continue
        sig = rec.get('_dedup_sig') or []
        if len(sig) >= 3:
            key = tuple(tuple(x) for x in sig[:3])
            buckets[key].append(rec)
    for grp in buckets.values():
        if len(grp) <= 1:
            continue
        grp.sort(key=lambda r: (-int(r.get('n_human_prompts') or 0), -float(r.get('end_ts') or 0.0)))
        for clone in grp[1:]:
            clone['is_fork_clone'] = True


def _extract_codex_sqlite(cache_con: sqlite3.Connection, force_full: bool) -> dict[str, dict[str, Any]]:
    if not CODEX_STATE_DB.is_file() or not CODEX_HISTORY_DB.is_file():
        return {}

    imported_ids: set[str] = set()
    if CODEX_EXTERNAL_IMPORTS.is_file():
        try:
            imp_obj = json.loads(CODEX_EXTERNAL_IMPORTS.read_text('utf-8', errors='replace'))
            if isinstance(imp_obj, dict):
                for v in imp_obj.values():
                    if isinstance(v, list):
                        imported_ids.update(str(x) for x in v)
                    elif isinstance(v, str):
                        imported_ids.add(v)
            elif isinstance(imp_obj, list):
                for item in imp_obj:
                    if isinstance(item, dict) and item.get('thread_id'):
                        imported_ids.add(str(item['thread_id']))
        except Exception:
            pass

    cached_rows = {}
    if not force_full:
        for row in cache_con.execute("SELECT source_key, mtime_ns, size_bytes, record_json FROM file_cache WHERE source_key LIKE 'codex:%'").fetchall():
            cached_rows[row[0]] = (row[1], row[2], row[3])

    out: dict[str, dict[str, Any]] = {}
    updates: list[tuple[str, int, int, str]] = []

    st5_con = sqlite3.connect(f'file:{CODEX_STATE_DB}?mode=ro', uri=True, timeout=10.0)
    th_con = sqlite3.connect(f'file:{CODEX_HISTORY_DB}?mode=ro', uri=True, timeout=15.0)
    try:
        threads = st5_con.execute(
            """
            SELECT id, title, cwd, created_at, updated_at, updated_at_ms,
                   thread_source, originator, source, first_user_message, agent_role
            FROM threads
            """
        ).fetchall()

        for row in threads:
            tid = str(row[0] or '').strip()
            if not tid or tid in imported_ids:
                continue
            title_raw = str(row[1] or '')
            cwd = str(row[2] or '')
            created_ts = _parse_iso_ts(row[3]) or 0.0
            updated_ts = _parse_iso_ts(row[4]) or created_ts
            upd_ms = int(row[5] or (updated_ts * 1000))
            thread_src = str(row[6] or '').strip().lower()
            originator = str(row[7] or '').strip().lower()
            src_col = str(row[8] or '').strip().lower()
            first_msg_db = str(row[9] or '')

            ckey = f'codex:{tid}'
            if not force_full and ckey in cached_rows:
                cm, _, rj = cached_rows[ckey]
                if cm == upd_ms:
                    if rj != '{}':
                        out[tid] = json.loads(rj)
                    continue

            is_sub = (
                thread_src in ('subagent', 'automation', 'agent_created_thread')
                or ('subagent' in src_col)
                or (
                    originator == 'codex_exec'
                    and (
                        len(first_msg_db) > 260
                        or first_msg_db.lstrip().startswith(('Bạn là ', 'ROLE', 'NHIỆM VỤ', 'You are '))
                        or title_raw.lstrip().startswith(('Bạn là ', 'ROLE', 'You are '))
                    )
                )
            )

            # Uses covering partial index idx_thread_items_user_messages + idx_thread_turns_page (NO item_json read for tool rows!)
            msg_rows = th_con.execute(
                """
                SELECT created_at_ms, item_json, turn_id
                FROM thread_items
                WHERE thread_id = ? AND item_type = 'userMessage'
                ORDER BY rollout_ordinal ASC
                """,
                (tid,),
            ).fetchall()

            # O(1) PK join on (thread_id, turn_id, item_id) for final_agent_item_id; NO item_json read for tool_rows!
            turn_rows = th_con.execute(
                """
                SELECT tt.turn_id, tt.status, tt.error_json, tt.duration_ms, tt.started_at, tt.completed_at,
                       fi.item_json
                FROM thread_turns tt
                LEFT JOIN thread_items fi
                  ON fi.thread_id = tt.thread_id
                 AND fi.turn_id = tt.turn_id
                 AND fi.item_id = tt.final_agent_item_id
                WHERE tt.thread_id = ?
                ORDER BY tt.rollout_ordinal ASC
                """,
                (tid,),
            ).fetchall()
            tool_rows = th_con.execute(
                """
                SELECT turn_id, item_type
                FROM thread_items
                WHERE thread_id = ?
                  AND item_type IN (
                    'commandExecution', 'mcpToolCall', 'fileChange',
                    'webSearch', 'dynamicToolCall', 'collabAgentToolCall', 'imageGeneration'
                  )
                ORDER BY rollout_ordinal ASC
                """,
                (tid,),
            ).fetchall()

            tools_by_turn: dict[str, list[str]] = collections.defaultdict(list)
            for tr_id, tr_type in tool_rows:
                if tr_id and tr_type:
                    tools_by_turn[str(tr_id)].append(str(tr_type))

            turn_meta: dict[str, dict[str, Any]] = {}
            interrupted_turns = 0
            tool_error_count = 0
            last_act_ts = updated_ts
            for tr_id, tr_status, tr_err, tr_dur_ms, tr_start_at, tr_comp_at, tr_final_json in turn_rows:
                st_str = str(tr_status or '')
                err_raw = str(tr_err or '').strip()
                if err_raw == 'null':
                    err_raw = ''
                err_clean = ''
                if err_raw:
                    if err_raw.startswith('{'):
                        try:
                            eo = json.loads(err_raw)
                            if isinstance(eo, dict):
                                err_clean = str(eo.get('message') or eo.get('additionalDetails') or err_raw).strip()
                            else:
                                err_clean = err_raw
                        except Exception:
                            err_clean = err_raw
                    else:
                        err_clean = err_raw
                if st_str == 'interrupted':
                    interrupted_turns += 1
                if st_str == 'failed' or bool(err_clean):
                    tool_error_count += 1

                st_f = _parse_iso_ts(tr_start_at)
                cp_f = _parse_iso_ts(tr_comp_at)
                if cp_f is not None and cp_f > last_act_ts:
                    last_act_ts = cp_f
                elif st_f is not None and st_f > last_act_ts:
                    last_act_ts = st_f

                dur_s: float | None = None
                if tr_dur_ms is not None:
                    try:
                        dms = int(tr_dur_ms)
                        if dms > 0:
                            dur_s = round(dms / 1000.0, 1)
                    except Exception:
                        dur_s = None
                if dur_s is None and st_f is not None and cp_f is not None and cp_f > st_f:
                    dur_s = round(cp_f - st_f, 1)

                final_txt = ''
                if tr_final_json:
                    try:
                        fo = json.loads(tr_final_json)
                        if isinstance(fo, dict) and fo.get('text'):
                            final_txt = str(fo.get('text') or '').strip()
                    except Exception:
                        final_txt = ''

                if tr_id:
                    turn_meta[str(tr_id)] = {
                        'status': st_str,
                        'err': err_clean,
                        'dur_s': dur_s,
                        'final_txt': final_txt,
                    }

            total_tool_calls = sum(len(v) for v in tools_by_turn.values())
            max_consec_tools = max((len(v) for v in tools_by_turn.values()), default=0)

            human_events: list[dict[str, Any]] = []
            n_raw = len(msg_rows)
            n_auto = 0
            auto_bd: dict[str, int] = collections.Counter()

            for c_ms, ij_str, m_turn_id in msg_rows:
                ts = _parse_iso_ts(c_ms) or updated_ts or created_ts
                if ts > last_act_ts:
                    last_act_ts = ts
                try:
                    obj = json.loads(ij_str)
                except Exception:
                    continue
                content = obj.get('content')
                parts: list[str] = []
                has_img = False
                if isinstance(content, list):
                    for blk in content:
                        if not isinstance(blk, dict):
                            continue
                        bt = blk.get('type')
                        if bt in ('localImage', 'image'):
                            has_img = True
                        elif blk.get('text'):
                            parts.append(str(blk['text']))
                elif isinstance(content, str):
                    parts.append(content)

                raw_text = '\n'.join(parts).strip()
                clean_t, img2, is_auto = strip_prompt_boilerplate(raw_text)
                has_img = has_img or img2
                if is_auto or not clean_t:
                    n_auto += 1
                    auto_bd['boilerplate'] += 1
                    continue
                sn, ve, ck, qr = _classify_prompt(clean_t)
                tid_key = str(m_turn_id or '')
                t_tools = tools_by_turn.get(tid_key, [])
                t_info = turn_meta.get(tid_key) or {}
                t_stat = str(t_info.get('status') or '')
                t_err = str(t_info.get('err') or '')
                t_dur = t_info.get('dur_s')
                t_final_txt = str(t_info.get('final_txt') or '')

                # Extract file paths cleanly from assistant final summary + user prompt (zero tool item_json blob reads)
                turn_files = _extract_files_from_text(t_final_txt, cwd, limit=4)
                if len(turn_files) < 4 and ('fileChange' in t_tools or 'commandExecution' in t_tools):
                    for uf in _extract_files_from_text(clean_t, cwd, limit=4):
                        if uf not in turn_files:
                            turn_files.append(uf)
                            if len(turn_files) >= 4:
                                break

                ev_obj: dict[str, Any] = {
                    'ts': ts,
                    'text': clean_t,
                    'has_image': has_img,
                    'is_short_nudge': sn,
                    'is_vague_error': ve,
                    'is_corr_kw': ck,
                    'is_question_reply': qr,
                    'prompt_id': f'codex:{tid}:{len(human_events)}',
                    'turn_duration_s': t_dur,
                    '_assistant_text': t_final_txt,
                    'files_touched': turn_files,
                }
                if t_tools:
                    uniq_t: list[str] = []
                    for xt in t_tools:
                        if xt not in uniq_t and len(uniq_t) < 6:
                            uniq_t.append(xt)
                    ev_obj['tools_triggered'] = uniq_t
                    ev_obj['tool_call_count'] = len(t_tools)
                if t_stat == 'failed' or t_err:
                    ev_obj['had_tool_error'] = True
                    ev_obj['assistant_err_snippet'] = redact_sensitive_text(t_err or f'Codex turn {t_stat}', 219)[:220]
                    if t_tools:
                        ev_obj['failed_tools'] = [str(t_tools[-1])[:48]]
                human_events.append(ev_obj)

            # Fallback if thread_items hadn't projected first_user_message yet on fresh thread
            if not human_events and first_msg_db:
                clean_t, img2, is_auto = strip_prompt_boilerplate(first_msg_db)
                if not is_auto and clean_t:
                    sn, ve, ck, qr = _classify_prompt(clean_t)
                    human_events.append({
                        'ts': created_ts or updated_ts,
                        'text': clean_t,
                        'has_image': img2,
                        'is_short_nudge': sn,
                        'is_vague_error': ve,
                        'is_corr_kw': ck,
                        'is_question_reply': qr,
                        'prompt_id': f'codex:{tid}:0',
                    })

            n_corr_codex = sum(1 for e in human_events if e['is_corr_kw'])
            rec = build_session_record(
                tool='codex',
                session_id=tid,
                title=title_raw,
                project='',
                cwd=cwd,
                is_sub=is_sub,
                human_events=human_events,
                n_raw_msgs=n_raw,
                n_auto_msgs=n_auto,
                auto_breakdown=dict(auto_bd),
                fallback_start_ts=created_ts,
                fallback_end_ts=updated_ts,
                total_tool_calls=total_tool_calls,
                max_consecutive_tool_calls=max_consec_tools,
                tool_error_count=tool_error_count,
                redirection_count=n_corr_codex + interrupted_turns,
                last_activity_ts=last_act_ts,
            )
            if rec:
                out[tid] = rec
                updates.append((ckey, upd_ms, 0, json.dumps(rec, ensure_ascii=False)))
            else:
                updates.append((ckey, upd_ms, 0, '{}'))
    finally:
        st5_con.close()
        th_con.close()

    if updates:
        cache_con.executemany('INSERT OR REPLACE INTO file_cache (source_key, mtime_ns, size_bytes, record_json) VALUES (?, ?, ?, ?)', updates)
        cache_con.commit()
    return out


def collect_all_sessions(force_full: bool = False) -> list[dict[str, Any]]:
    if _REDACT_IMPORT_ERR is not None:
        raise RuntimeError(
            f'Fail-closed: Không nạp được redact_sensitive_text từ coach_engine.py ({_REDACT_IMPORT_ERR}); '
            'hủy quét để không lưu dữ liệu chưa che bí mật vào cache.'
        )
    cache_con = _open_pc_cache()
    try:
        nhip_labels = _load_nhip_labels()
        ph_ag = _load_legacy_jsonl_baseline('antigravity', nhip_labels)
        ph_cl = _load_legacy_jsonl_baseline('claude', nhip_labels)

        ag_live = _extract_ag_live(cache_con, force_full=force_full, ph_ag=ph_ag, nhip_labels=nhip_labels)
        claude_live = _extract_claude_live(cache_con, force_full=force_full, nhip_labels=nhip_labels)
        codex_live = _extract_codex_sqlite(cache_con, force_full=force_full)

        # Always prefer live transcripts (rich HRPO tool/summary/duration/error trace) over baseline
        ag_merged = dict(ph_ag)
        ag_merged.update(ag_live)
        _dedup_ag_forks(ag_merged)

        cl_merged = dict(ph_cl)
        cl_merged.update(claude_live)

        all_recs = [*ag_merged.values(), *cl_merged.values(), *codex_live.values()]
        # Detect batch script calls: >=4 sessions sharing exact same >=80-char opening prompt with n_human == 1
        batch_sig_counts: collections.Counter[str] = collections.Counter()
        for r in all_recs:
            if not r.get('is_sub') and not r.get('is_fork_clone') and int(r.get('n_human_prompts') or 0) == 1:
                fp_txt = (r.get('first_human_preview') or '').strip()
                if len(fp_txt) >= 80:
                    batch_sig_counts[fp_txt[:100]] += 1
        for r in all_recs:
            if not r.get('is_sub') and not r.get('is_fork_clone') and int(r.get('n_human_prompts') or 0) == 1:
                fp_txt = (r.get('first_human_preview') or '').strip()
                if len(fp_txt) >= 80 and batch_sig_counts[fp_txt[:100]] >= 4:
                    r['is_sub'] = True
            r.pop('_dedup_sig', None)
        return all_recs
    finally:
        cache_con.close()


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == 'nt':
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            h = kernel32.OpenProcess(0x1000, False, pid)
            if not h:
                return False
            try:
                exit_code = ctypes.c_uint()
                if kernel32.GetExitCodeProcess(h, ctypes.byref(exit_code)):
                    return exit_code.value == 259
            finally:
                kernel32.CloseHandle(h)
        except Exception:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _acquire_lock() -> bool:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    if LOCK_PATH.is_file():
        try:
            age = time.time() - LOCK_PATH.stat().st_mtime
            raw = LOCK_PATH.read_text('utf-8', errors='replace').strip()
            old_pid = int(raw.split('|', 1)[0]) if '|' in raw else 0
            if age < 300 and _pid_alive(old_pid):
                return False
        except Exception:
            pass
    try:
        LOCK_PATH.write_text(f'{os.getpid()}|{int(time.time())}', encoding='utf-8')
        return True
    except OSError:
        return False


def _release_lock() -> None:
    try:
        if LOCK_PATH.is_file():
            LOCK_PATH.unlink()
    except OSError:
        pass


def _session_push_sig(r: dict[str, Any]) -> str:
    samples = r.get('prompts_sample') or []
    tail_sum_len = len(str((samples[-1].get('assistant_summary') if samples else '') or ''))
    last_act = int(round(float(r.get('last_activity_ts') or r.get('end_ts') or 0.0), 0))
    return (
        f"v5|{int(r.get('n_human_prompts') or 0)}|{int(r.get('n_raw_msgs') or 0)}|"
        f"{round(float(r.get('end_ts') or 0.0), 3)}|{last_act}|"
        f"{int(bool(r.get('is_running')))}|{int(bool(r.get('is_pinned')))}|"
        f"{int(r.get('total_tool_calls') or 0)}|{int(r.get('tool_error_count') or 0)}|"
        f"{tail_sum_len}|{int(bool(r.get('is_sub')))}|"
        f"{int(bool(r.get('is_fork_clone')))}|{len(samples)}|{r.get('title') or ''}|{r.get('project') or ''}"
    )


def sync_once(
    force_full: bool = False,
    push: bool = True,
    min_interval_s: int = 0,
    quiet_if_unchanged: bool = False,
    db_path: str | None = None,
) -> dict[str, Any]:
    """Quét và nạp trực tiếp vào SQLite cục bộ (~/.antigravity_prompt_coach/prompt_coach.db) — 100% Zero-Data-Leak."""
    if _REDACT_IMPORT_ERR is not None:
        raise RuntimeError(
            f'Fail-closed: Không nạp được redact_sensitive_text từ coach_engine.py ({_REDACT_IMPORT_ERR}).'
        )
    if min_interval_s > 0 and not force_full and LAST_SYNC_META_PATH.is_file():
        try:
            meta = json.loads(LAST_SYNC_META_PATH.read_text('utf-8'))
            last_ts = float(meta.get('ts') or 0.0)
            if (time.time() - last_ts) < min_interval_s:
                return {'ok': True, 'skipped': True, 'reason': 'cooldown', 'last_sync': meta}
        except Exception:
            pass

    if not _acquire_lock():
        return {'ok': True, 'skipped': True, 'reason': 'locked'}

    t0 = time.monotonic()
    try:
        records = collect_all_sessions(force_full=force_full)
        elapsed = round(time.monotonic() - t0, 2)

        by_tool = collections.Counter()
        by_sub = collections.Counter()
        total_direct_p = 0
        total_bg_p = 0
        for r in records:
            if r.get('is_fork_clone'):
                continue
            by_tool[r['tool']] += 1
            if r.get('is_sub'):
                by_sub['bg'] += 1
                total_bg_p += int(r.get('n_human_prompts') or 0)
            else:
                by_sub['direct'] += 1
                total_direct_p += int(r.get('n_human_prompts') or 0)

        summary = {
            'ok': True,
            'skipped': False,
            'duration_s': elapsed,
            'total_records': len(records),
            'direct_sessions': by_sub['direct'],
            'bg_sessions': by_sub['bg'],
            'direct_prompts': total_direct_p,
            'bg_prompts': total_bg_p,
            'by_tool': dict(by_tool),
        }

        if not push:
            return summary

        records_sorted = sorted(records, key=lambda r: float(r.get('last_activity_ts') or r.get('end_ts') or 0.0))
        current_sigs = {
            f"{r.get('tool') or ''}:{r.get('session_id') or ''}": _session_push_sig(r)
            for r in records_sorted
            if r.get('tool') and r.get('session_id')
        }

        prev_sigs: dict[str, str] = {}
        if not force_full and PUSHED_SIGS_PATH.is_file():
            try:
                loaded = json.loads(PUSHED_SIGS_PATH.read_text('utf-8'))
                if isinstance(loaded, dict):
                    prev_sigs = loaded
            except Exception:
                prev_sigs = {}

        if not force_full and prev_sigs:
            to_push = [
                r for r in records_sorted
                if current_sigs.get(f"{r.get('tool') or ''}:{r.get('session_id') or ''}") != prev_sigs.get(f"{r.get('tool') or ''}:{r.get('session_id') or ''}")
            ]
        else:
            to_push = records_sorted

        if quiet_if_unchanged and not force_full and len(to_push) == 0 and LAST_SYNC_META_PATH.is_file():
            try:
                prev_meta = json.loads(LAST_SYNC_META_PATH.read_text('utf-8'))
                if (time.time() - float(prev_meta.get('ts') or 0.0)) < 60.0:
                    return {
                        'ok': True,
                        'skipped': False,
                        'unchanged': True,
                        'upserted': 0,
                        'day_rows': 0,
                        'pushed_count': 0,
                        'synced_at': prev_meta.get('synced_at') or '',
                        **summary,
                    }
            except Exception:
                pass

        now_iso = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        sync_meta_payload = {
            'synced_at': now_iso,
            'duration_s': elapsed,
            'hygiene': {
                'by_tool': dict(by_tool),
                'direct_sessions': by_sub['direct'],
                'bg_sessions': by_sub['bg'],
            },
        }

        upserted_total = 0
        day_rows_total = 0
        batch_size = 500
        batches = [to_push[i:i + batch_size] for i in range(0, len(to_push), batch_size)] or [[]]
        for chunk in batches:
            res = ingest_payload(
                {'sessions': chunk, 'sync_meta': sync_meta_payload},
                owner_uname='local_member',
                db_path=db_path,
            )
            upserted_total += int(res.get('upserted') or 0)
            day_rows_total += int(res.get('day_rows') or 0)

        PUSHED_SIGS_PATH.parent.mkdir(parents=True, exist_ok=True)
        sigs_tmp = PUSHED_SIGS_PATH.with_name(PUSHED_SIGS_PATH.name + f'.tmp.{os.getpid()}')
        sigs_tmp.write_text(json.dumps(current_sigs, ensure_ascii=False), encoding='utf-8')
        sigs_tmp.replace(PUSHED_SIGS_PATH)

        meta_out = {
            'ts': time.time(),
            'synced_at': now_iso,
            'duration_s': elapsed,
            'upserted': upserted_total,
            'day_rows': day_rows_total,
            'delta_mode': not force_full and len(to_push) < len(records_sorted),
            'pushed_count': len(to_push),
            **summary,
        }
        LAST_SYNC_META_PATH.parent.mkdir(parents=True, exist_ok=True)
        LAST_SYNC_META_PATH.write_text(json.dumps(meta_out, ensure_ascii=False, indent=2), encoding='utf-8')
        return meta_out
    finally:
        _release_lock()


def main() -> int:
    parser = argparse.ArgumentParser(description='Quét và nạp lịch sử Prompt/Phiên cục bộ cho Antigravity Prompt Coach')
    parser.add_argument('--full', action='store_true', help='Bỏ qua cache, quét lại toàn bộ file gốc')
    parser.add_argument('--dry-run', action='store_true', help='Chỉ quét cục bộ & in thống kê, không ghi DB')
    parser.add_argument('--min-interval', type=int, default=0, help='Cooldown giây khi chạy nền')
    args = parser.parse_args()

    res = sync_once(
        force_full=args.full,
        push=not args.dry_run,
        min_interval_s=args.min_interval,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())
