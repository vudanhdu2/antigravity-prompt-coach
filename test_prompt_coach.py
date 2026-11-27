#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Bộ kiểm thử tự động 10 hạng mục cho Antigravity Prompt Coach (Self-Host Edition)."""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class TestSelfHostPromptCoach(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['PROMPT_COACH_DATA_DIR'] = self.tmp.name
        os.environ['AG_PROMPT_COACH_DB'] = str(Path(self.tmp.name) / 'test_coach.db')
        os.environ['AG_GUI_CONFIG_PATH'] = str(Path(self.tmp.name) / 'nonexistent_gui.json')
        os.environ.pop('PROMPT_COACH_PIN', None)

        import coach_engine
        import prompt_coach_server

        self.engine = coach_engine
        self.srv_mod = prompt_coach_server
        self.engine._INITIALIZED_DBS.clear()
        self.engine._SESSION_PROMPT_CACHE.clear()
        self.srv_mod._AUTH_FAILS.clear()

    def tearDown(self) -> None:
        os.environ.pop('PROMPT_COACH_PIN', None)
        self.tmp.cleanup()

    def test_01_zero_owner_or_secret_leaks_in_repo(self) -> None:
        forbidden = re.compile(r'(vuuyd|vps111|/var/lib/antigravity|ProjectHub|9router|gho_[A-Za-z0-9]{10,}|sk-proj-[A-Za-z0-9]{20,})', re.I)
        for fp in ROOT.rglob('*'):
            if not fp.is_file() or any(part in ('.git', '__pycache__', 'node_modules') for part in fp.parts) or fp.name == 'test_prompt_coach.py':
                continue
            if fp.suffix.lower() in ('.png', '.jpg', '.webp', '.woff', '.woff2', '.ico'):
                continue
            txt = fp.read_text('utf-8', errors='replace')
            m = forbidden.search(txt)
            self.assertIsNone(m, f'Phát hiện chuỗi không hợp lệ trong {fp}: {m.group(0) if m else ""}')

    def test_02_prebuilt_web_assets_exist(self) -> None:
        self.assertTrue((ROOT / 'web' / 'index.html').is_file(), 'Thiếu web/index.html build sẵn')
        js_files = list((ROOT / 'web' / 'assets').glob('*.js'))
        css_files = list((ROOT / 'web' / 'assets').glob('*.css'))
        self.assertGreaterEqual(len(js_files), 1)
        self.assertGreaterEqual(len(css_files), 1)

    def test_03_two_layer_secret_redaction(self) -> None:
        raw = 'postgres://admin:SuperSecret999@db.example.com:5432/prod {"api_key": "MySecretToken12345"} sk-proj-1234567890abcdefghijklmnop'
        clean = self.engine.redact_sensitive_text(raw)
        self.assertNotIn('SuperSecret999', clean)
        self.assertNotIn('MySecretToken12345', clean)
        self.assertNotIn('1234567890abcdefghijklmnop', clean)

    def test_04_stage_aware_rubric_and_context_inheritance(self) -> None:
        samples = [
            {
                'idx': 1,
                'chars': 160,
                'text_redacted': 'Mục tiêu: Sửa file src/StandaloneApp.tsx thêm nút đổi cỡ chữ. Ranh giới: Chỉ sửa 1 file. Done: chạy npm run build đạt 0 lỗi.',
                'files_touched': ['src/StandaloneApp.tsx'],
            },
            {
                'idx': 2,
                'chars': 42,
                'is_question_reply': True,
                'text_redacted': 'ok chốt phương án 2 và chạy build kiểm tra',
            },
        ]
        items, summary = self.engine.evaluate_prompt_items(samples, {'max_prompts_per_session': 12})
        self.assertGreaterEqual(items[0]['score'], 80)
        self.assertGreaterEqual(items[1]['score'], 75)
        self.assertEqual(summary['weak_prompt_count'], 0)

    def test_05_realtime_order_and_pin_auth_and_path_traversal(self) -> None:
        os.environ['PROMPT_COACH_PIN'] = '654321'
        today = self.engine._vn_today()
        now_ts = time.time()
        self.engine.ingest_payload({
            'sessions': [
                {
                    'tool': 'antigravity',
                    'session_id': 's_run_1',
                    'title': 'Active Running Session',
                    'project': 'AG',
                    'start_day': today,
                    'end_day': today,
                    'start_ts': now_ts - 600,
                    'end_ts': now_ts - 300,
                    'last_activity_ts': now_ts - 2,
                    'is_running': True,
                    'is_pinned': False,
                    'n_human_prompts': 2,
                    'clean_active_hours': 0.2,
                    'day_breakdown': [{'day': today, 'human_prompts': 2, 'active_hours': 0.2}],
                    'prompts_sample': [{'idx': 1, 'day': today, 'chars': 80, 'text_redacted': 'Kiểm tra prompt_coach_server.py đạt 0 lỗi.'}],
                }
            ]
        })

        httpd = self.srv_mod.ThreadedHTTPServer(('127.0.0.1', 0), self.srv_mod.PromptCoachRequestHandler)
        port = httpd.server_address[1]
        t = threading.Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        try:
            # 1. Static index.html accessible, path traversal blocked
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/', timeout=5) as r_idx:
                self.assertEqual(r_idx.status, 200)
                self.assertIn(b'root', r_idx.read())

            with self.assertRaises(urllib.error.HTTPError) as ctx_trav:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/..%2fcoach_engine.py', timeout=5)
            self.assertIn(ctx_trav.exception.code, (403, 404))

            # 2. Protected API requires PIN when PROMPT_COACH_PIN is set
            with self.assertRaises(urllib.error.HTTPError) as ctx_403:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/api/owner/prompt-coach/dashboard?period=today', timeout=5)
            self.assertEqual(ctx_403.exception.code, 403)

            # 3. Exchange PIN -> session_token -> fetch dashboard -> verify is_running & last_activity_ts
            req_auth = urllib.request.Request(
                f'http://127.0.0.1:{port}/api/prompt-coach/auth',
                data=json.dumps({'pin': '654321'}).encode('utf-8'),
                headers={'Content-Type': 'application/json'},
                method='POST',
            )
            with urllib.request.urlopen(req_auth, timeout=5) as r_auth:
                tok = json.loads(r_auth.read().decode('utf-8'))['session_token']
                self.assertTrue(tok.startswith('pcs_'))

            req_dash = urllib.request.Request(
                f'http://127.0.0.1:{port}/api/owner/prompt-coach/dashboard?period=today',
                headers={'Authorization': f'Bearer {tok}'},
            )
            with urllib.request.urlopen(req_dash, timeout=5) as r_dash:
                dash = json.loads(r_dash.read().decode('utf-8'))
                self.assertTrue(dash['ok'])
                self.assertEqual(len(dash['sessions']), 1)
                self.assertTrue(dash['sessions'][0]['is_running'])

            # 4. FTS5 Vietnamese search endpoint works with session token
            req_search = urllib.request.Request(
                f'http://127.0.0.1:{port}/api/owner/prompt-coach/search?q=prompt_coach_server',
                headers={'Authorization': f'Bearer {tok}'},
            )
            with urllib.request.urlopen(req_search, timeout=5) as r_s:
                s_data = json.loads(r_s.read().decode('utf-8'))
                self.assertTrue(s_data.get('ok'))
                self.assertGreaterEqual(len(s_data.get('results') or s_data.get('items') or s_data.get('sessions') or []), 1)
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_06_collector_imports_and_version_parity(self) -> None:
        import coach_collector  # noqa: F401
        self.assertEqual(self.srv_mod.VERSION, '1.2.0')
        pkg = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))
        self.assertEqual(pkg.get('version'), '1.2.0')


if __name__ == '__main__':
    unittest.main(verbosity=2)
