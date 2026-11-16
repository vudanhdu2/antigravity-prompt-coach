#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Antigravity Prompt Coach v1.0 (Self-Host Server) — 100% Zero-Data-Leak, 0 phụ thuộc ngoài (Python 3.9+ stdlib).
- Chạy cục bộ tại http://127.0.0.1:8788 (hoặc --lan mở cho Điện thoại/Tablet cùng mạng Wi-Fi kèm khóa PIN 6 số).
- Tích hợp Watcher Realtime 2.5 giây: đồng bộ thứ tự 1:1 với ứng dụng Antigravity PC (Pinned -> Running 4 chấm -> Mới sửa gần nhất), Claude Code và Codex Desktop.
- Tích hợp giao diện Song song Thật ↔ 1-Phát Fullscreen, Bảng Chấm điểm 7 chiều (6×7 Stage-Aware Rubric), Giả lập Dry-Run A/B và Kho Prompt cá nhân.
"""
from __future__ import annotations

import argparse
import collections
import hmac
import http.server
import json
import mimetypes
import os
import secrets
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent
WEB_DIR = ROOT_DIR / 'web'
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import coach_collector  # noqa: E402
import coach_engine  # noqa: E402

VERSION = '1.0.0'
DEFAULT_PORT = int(os.environ.get('PROMPT_COACH_PORT', '8788'))

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('font/woff2', '.woff2')
mimetypes.add_type('font/woff', '.woff')
mimetypes.add_type('image/svg+xml', '.svg')

# Brute-force rate limiter when --lan / PIN is enabled (max 5 failed attempts -> 5 min lockout)
_AUTH_FAIL_LOCK = threading.Lock()
_AUTH_FAILS: dict[str, list[float]] = collections.defaultdict(list)
_WATCHER_STATE: dict[str, Any] = {
    'running': False,
    'last_sync_at': '',
    'total_records': 0,
    'direct_sessions': 0,
}


def get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(('8.8.8.8', 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith('127.'):
                return ip
        finally:
            s.close()
    except Exception:
        pass
    return '127.0.0.1'


def _fast_source_sig() -> tuple[Any, ...]:
    parts: list[Any] = []
    for p in (
        coach_collector.AG_SUMMARIES_DB,
        Path(str(coach_collector.AG_SUMMARIES_DB) + '-wal'),
        coach_collector.CODEX_STATE_DB,
        Path(str(coach_collector.CODEX_STATE_DB) + '-wal'),
    ):
        try:
            st = p.stat()
            parts.append((st.st_mtime_ns, st.st_size))
        except OSError:
            parts.append(None)
    return tuple(parts)


def start_realtime_watcher_thread() -> threading.Thread:
    def _loop() -> None:
        _WATCHER_STATE['running'] = True
        last_sig: tuple[Any, ...] | None = None
        last_full_scan = 0.0
        while True:
            try:
                cur_sig = _fast_source_sig()
                now_m = time.monotonic()
                if cur_sig != last_sig or (now_m - last_full_scan) >= 15.0:
                    res = coach_collector.sync_once(
                        force_full=False,
                        push=True,
                        min_interval_s=2,
                        quiet_if_unchanged=True,
                    )
                    if res.get('ok'):
                        _WATCHER_STATE['last_sync_at'] = str(res.get('synced_at') or _WATCHER_STATE['last_sync_at'])
                        if 'total_records' in res:
                            _WATCHER_STATE['total_records'] = int(res.get('total_records') or 0)
                        if 'direct_sessions' in res:
                            _WATCHER_STATE['direct_sessions'] = int(res.get('direct_sessions') or 0)
                    last_sig = cur_sig
                    last_full_scan = now_m
            except Exception:
                pass
            time.sleep(2.5)

    t = threading.Thread(target=_loop, daemon=True, name='prompt_coach_rt_watcher')
    t.start()
    return t


def _is_ip_locked(ip: str) -> bool:
    now = time.time()
    with _AUTH_FAIL_LOCK:
        arr = [ts for ts in _AUTH_FAILS.get(ip, []) if (now - ts) < 300.0]
        _AUTH_FAILS[ip] = arr
        return len(arr) >= 5


def _record_auth_fail(ip: str) -> None:
    with _AUTH_FAIL_LOCK:
        _AUTH_FAILS[ip].append(time.time())


def _clear_auth_fail(ip: str) -> None:
    with _AUTH_FAIL_LOCK:
        _AUTH_FAILS.pop(ip, None)


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class PromptCoachRequestHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: ARG002
        return

    def _send_json(self, payload: dict[str, Any], status: int = 200, extra_headers: dict[str, str] | None = None) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _merged_headers(self) -> dict[str, str]:
        hdrs = {k: v for k, v in self.headers.items()}
        hdrs['X-Prompt-Coach-Client-IP'] = str(self.client_address[0] or '')
        return hdrs

    def _read_body(self, max_bytes: int = 4 * 1024 * 1024) -> bytes | None:
        try:
            clen = int(self.headers.get('Content-Length') or '0')
        except ValueError:
            clen = 0
        if clen < 0 or clen > max_bytes:
            return None
        return self.rfile.read(clen) if clen > 0 else b''

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path or '/'
        query = parsed.query or ''

        if path == '/api/prompt-coach/health':
            req_pin = bool(str(os.environ.get('PROMPT_COACH_PIN') or '').strip())
            authed, _ = coach_engine.verify_true_owner(self._merged_headers())
            self._send_json({
                'ok': True,
                'version': VERSION,
                'zero_data_leak': True,
                'pin_required': req_pin,
                'authenticated': authed,
                'watcher': dict(_WATCHER_STATE),
                'data_dir': str(coach_engine.DATA_DIR),
            })
            return

        if path.startswith('/api/owner/prompt-coach/'):
            status, payload = coach_engine.handle_prompt_coach_request(
                'GET', path, query, self._merged_headers(), b''
            )
            self._send_json(payload, status=status)
            return

        self._serve_static(path)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path or '/'
        query = parsed.query or ''
        client_ip = str(self.client_address[0] or '')

        body_bytes = self._read_body()
        if body_bytes is None:
            self._send_json({'ok': False, 'error': 'Payload quá lớn.'}, status=413)
            return

        if path == '/api/prompt-coach/auth':
            if _is_ip_locked(client_ip):
                self._send_json(
                    {'ok': False, 'error': 'Nhập sai mã PIN quá 5 lần. Vui lòng thử lại sau 5 phút.'},
                    status=429,
                )
                return
            try:
                body = json.loads((body_bytes or b'{}').decode('utf-8'))
            except Exception:
                body = {}
            pin_in = str((body or {}).get('pin') or '').strip()
            req_pin = str(os.environ.get('PROMPT_COACH_PIN') or '').strip()
            if not req_pin:
                tok = coach_engine.issue_local_session_token()
                self._send_json({'ok': True, 'session_token': tok})
                return
            if pin_in and hmac.compare_digest(pin_in.encode('utf-8'), req_pin.encode('utf-8')):
                _clear_auth_fail(client_ip)
                tok = coach_engine.issue_local_session_token()
                cookie = f'pcs_session={tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800'
                self._send_json({'ok': True, 'session_token': tok}, extra_headers={'Set-Cookie': cookie})
                return
            _record_auth_fail(client_ip)
            self._send_json({'ok': False, 'error': 'Mã PIN không đúng.'}, status=401)
            return

        if path == '/api/ag-companion/prompt-coach/sync':
            authed, _ = coach_engine.verify_true_owner(self._merged_headers())
            if not authed:
                self._send_json({'ok': False, 'error': 'Unauthorized'}, status=403)
                return
            try:
                body = json.loads((body_bytes or b'{}').decode('utf-8'))
            except Exception:
                body = {}
            force_full = bool(body.get('full')) if isinstance(body, dict) else False
            res = coach_collector.sync_once(
                force_full=force_full,
                push=True,
                min_interval_s=0 if force_full else 1,
                quiet_if_unchanged=not force_full,
            )
            self._send_json(res, status=200 if res.get('ok') else 500)
            return

        if path.startswith('/api/owner/prompt-coach/'):
            status, payload = coach_engine.handle_prompt_coach_request(
                'POST', path, query, self._merged_headers(), body_bytes
            )
            self._send_json(payload, status=status)
            return

        self._send_json({'ok': False, 'error': 'Not found'}, status=404)

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path or '/'
        query = parsed.query or ''
        if path.startswith('/api/owner/prompt-coach/'):
            status, payload = coach_engine.handle_prompt_coach_request(
                'DELETE', path, query, self._merged_headers(), b''
            )
            self._send_json(payload, status=status)
            return
        self._send_json({'ok': False, 'error': 'Not found'}, status=404)

    def _serve_static(self, req_path: str) -> None:
        if not WEB_DIR.is_dir():
            self._send_json({'ok': False, 'error': 'Thư mục web/ chưa được khởi tạo.'}, status=503)
            return
        rel = req_path.lstrip('/') or 'index.html'
        target = (WEB_DIR / rel).resolve()
        web_root = WEB_DIR.resolve()
        try:
            target.relative_to(web_root)
        except ValueError:
            self._send_json({'ok': False, 'error': 'Forbidden path'}, status=403)
            return

        if not target.is_file():
            # SPA fallback to index.html for non-asset routes
            if '.' not in Path(rel).name:
                target = web_root / 'index.html'
            if not target.is_file():
                self._send_json({'ok': False, 'error': 'Not found'}, status=404)
                return

        data = target.read_bytes()
        ctype, _ = mimetypes.guess_type(str(target))
        if not ctype:
            ctype = 'application/octet-stream'
        if ctype.startswith('text/') or ctype == 'application/javascript':
            ctype = f'{ctype}; charset=utf-8'
        cache_hdr = 'public, max-age=86400' if '/assets/' in req_path or '/fonts/' in req_path else 'no-cache'

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', cache_hdr)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)


def _spawn_detached_windows(args_list: list[str]) -> int:
    py_exe = sys.executable
    pyw = Path(py_exe).with_name('pythonw.exe')
    exe = str(pyw if pyw.is_file() else py_exe)
    cmd_args = [exe, str(Path(__file__).resolve()), *args_list]
    flags = 0x00000008 | 0x00000200 | 0x08000000  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
    proc = subprocess.Popen(
        cmd_args,
        cwd=str(ROOT_DIR),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags if os.name == 'nt' else 0,
        start_new_session=(os.name != 'nt'),
    )
    return int(proc.pid)


def main() -> int:
    parser = argparse.ArgumentParser(description='Antigravity Prompt Coach v1.0 (Self-Host Local Server)')
    parser.add_argument('--host', default='', help='Địa chỉ bind (mặc định: 127.0.0.1; hoặc 0.0.0.0 khi bật --lan)')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT, help='Cổng HTTP (mặc định: 8788)')
    parser.add_argument('--lan', action='store_true', help='Mở truy cập qua mạng Wi-Fi LAN cho điện thoại/tablet (tự bật khóa PIN 6 số)')
    parser.add_argument('--pin', default='', help='Đặt mã PIN bảo mật tùy chọn (mặc định tự sinh 6 số khi bật --lan)')
    parser.add_argument('--detach', action='store_true', help='Chạy ngầm tách tiến trình độc lập')
    parser.add_argument('--no-browser', action='store_true', help='Không tự động mở trình duyệt khi khởi động')
    parser.add_argument('--skip-initial-sync', action='store_true', help='Bỏ qua bước đồng bộ đầu tiên trước khi mở cổng')
    args = parser.parse_args()

    bind_host = args.host.strip() or ('0.0.0.0' if args.lan else '127.0.0.1')
    pin_code = str(args.pin or os.environ.get('PROMPT_COACH_PIN') or '').strip()
    if (args.lan or bind_host == '0.0.0.0') and not pin_code:
        pin_code = f'{secrets.randbelow(900000) + 100000}'
    if pin_code:
        os.environ['PROMPT_COACH_PIN'] = pin_code

    if args.detach:
        fwd = ['--host', bind_host, '--port', str(args.port), '--no-browser']
        if pin_code:
            fwd.extend(['--pin', pin_code])
        pid = _spawn_detached_windows(fwd)
        local_url = f'http://127.0.0.1:{args.port}'
        print(f'[+] Antigravity Prompt Coach đang chạy nền (PID {pid}) tại: {local_url}')
        if pin_code:
            print(f'[+] Mã PIN bảo mật: {pin_code} | LAN URL: http://{get_lan_ip()}:{args.port}')
        if not args.no_browser:
            time.sleep(1.2)
            webbrowser.open(local_url)
        return 0

    print('========================================================================')
    print(f'  Antigravity Prompt Coach v{VERSION} (Self-Host · 100% Zero-Data-Leak)')
    print('========================================================================')
    print(f'[*] Thư mục dữ liệu cục bộ : {coach_engine.DATA_DIR}')

    if not args.skip_initial_sync:
        print('[*] Đang quét nhanh lịch sử Antigravity PC / Claude Code / Codex trên máy...')
        sync_res = coach_collector.sync_once(force_full=False, push=True)
        _WATCHER_STATE['last_sync_at'] = str(sync_res.get('synced_at') or '')
        _WATCHER_STATE['total_records'] = int(sync_res.get('total_records') or 0)
        _WATCHER_STATE['direct_sessions'] = int(sync_res.get('direct_sessions') or 0)
        print(
            f"[+] Đã nạp {_WATCHER_STATE['direct_sessions']} phiên trực tiếp "
            f"({_WATCHER_STATE['total_records']} tổng bản ghi) trong {sync_res.get('duration_s', 0)}s!"
        )

    start_realtime_watcher_thread()
    coach_engine._start_ai_workers_once()

    srv = ThreadedHTTPServer((bind_host, args.port), PromptCoachRequestHandler)
    local_url = f'http://127.0.0.1:{args.port}'
    print(f'[+] Mở ngay trên máy tính   : {local_url}')
    if bind_host == '0.0.0.0':
        print(f'[+] Mở từ Điện thoại (LAN)  : http://{get_lan_ip()}:{args.port}')
    if pin_code:
        print(f'[+] Mã PIN bảo mật          : {pin_code}')
    print('[*] Watcher Realtime 2.5s đang chạy (Nhấn Ctrl+C để dừng).')

    if not args.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(local_url)).start()

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\n[*] Đã dừng Antigravity Prompt Coach.')
    finally:
        srv.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
