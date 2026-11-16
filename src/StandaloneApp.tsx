import React, { useCallback, useEffect, useState } from 'react';
import {
    ExternalLink,
    Github,
    Lock,
    Menu,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    RefreshCw,
    ShieldCheck,
    Sparkles,
    Sun,
    Terminal,
    X,
} from 'lucide-react';
import { AdminPromptCoachSection } from './components/member/AdminPromptCoachSection';
import { ToastViewport, showToast } from './components/common/ToastContainer';
import { copyToClipboard } from './utils/clipboard';

interface HealthStatus {
    ok: boolean;
    version: string;
    zero_data_leak: boolean;
    pin_required: boolean;
    authenticated: boolean;
    data_dir?: string;
    watcher?: {
        running: boolean;
        last_sync_at: string;
        total_records: number;
        direct_sessions: number;
    };
}

export const StandaloneApp: React.FC = () => {
    const [dark, setDark] = useState<boolean>(() => {
        try {
            return localStorage.getItem('agpc_selfhost_dark') === '1';
        } catch {
            return false;
        }
    });
    const [fontScale, setFontScale] = useState<100 | 110 | 120>(() => {
        try {
            const v = Number(localStorage.getItem('agpc_selfhost_font') || '100');
            return v === 110 || v === 120 ? v : 100;
        } catch {
            return 100;
        }
    });
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
    const [mobileDrawer, setMobileDrawer] = useState<boolean>(false);
    const [health, setHealth] = useState<HealthStatus | null>(null);
    const [sessionToken, setSessionToken] = useState<string>(() => {
        try {
            return localStorage.getItem('abv_admin_api_key') || '';
        } catch {
            return '';
        }
    });
    const [pinInput, setPinInput] = useState<string>('');
    const [authErr, setAuthErr] = useState<string>('');
    const [submittingPin, setSubmittingPin] = useState<boolean>(false);
    const [syncingNow, setSyncingNow] = useState<boolean>(false);
    const [usagePeriod, setUsagePeriod] = useState<'day' | 'yesterday' | 'week' | 'month' | 'all' | 'date'>('day');
    const [filterDate, setFilterDate] = useState<string>('');

    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark);
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        try {
            localStorage.setItem('agpc_selfhost_dark', dark ? '1' : '0');
        } catch {}
    }, [dark]);

    useEffect(() => {
        document.documentElement.style.fontSize = `${(16 * fontScale) / 100}px`;
        try {
            localStorage.setItem('agpc_selfhost_font', String(fontScale));
        } catch {}
    }, [fontScale]);

    const fetchHealth = useCallback(async (tok?: string) => {
        try {
            const hdrs: Record<string, string> = {};
            const useTok = tok !== undefined ? tok : sessionToken;
            if (useTok) {
                hdrs['Authorization'] = `Bearer ${useTok}`;
                hdrs['x-api-key'] = useTok;
            }
            const res = await fetch('/api/prompt-coach/health', { headers: hdrs, cache: 'no-store' });
            const doc = (await res.json()) as HealthStatus;
            setHealth(doc);
        } catch {
            // ignore transient startup
        }
    }, [sessionToken]);

    useEffect(() => {
        void fetchHealth();
        const t = window.setInterval(() => void fetchHealth(), 10000);
        return () => window.clearInterval(t);
    }, [fetchHealth]);

    const handlePinSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pinInput.trim()) return;
        setSubmittingPin(true);
        setAuthErr('');
        try {
            const res = await fetch('/api/prompt-coach/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin: pinInput.trim() }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc?.ok || !doc?.session_token) {
                throw new Error(doc?.error || 'Mã PIN không đúng.');
            }
            const tok = String(doc.session_token);
            try {
                localStorage.setItem('abv_admin_api_key', tok);
            } catch {}
            setSessionToken(tok);
            setPinInput('');
            await fetchHealth(tok);
            showToast('Đã mở khóa phiên làm việc an toàn!', 'success');
        } catch (err: any) {
            setAuthErr(err?.message || 'Lỗi xác thực mã PIN.');
        } finally {
            setSubmittingPin(false);
        }
    };

    const handleManualSync = async () => {
        setSyncingNow(true);
        try {
            const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
            if (sessionToken) {
                hdrs['Authorization'] = `Bearer ${sessionToken}`;
                hdrs['x-api-key'] = sessionToken;
            }
            const res = await fetch('/api/ag-companion/prompt-coach/sync', {
                method: 'POST',
                headers: hdrs,
                body: JSON.stringify({ full: false }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc?.ok) throw new Error(doc?.error || 'Không thể đồng bộ.');
            await fetchHealth();
            showToast(
                `Đã đồng bộ ${doc.direct_sessions ?? 0} phiên trực tiếp (${doc.duration_s ?? 0}s)!`,
                'success'
            );
        } catch (err: any) {
            showToast(err?.message || 'Lỗi đồng bộ cục bộ.', 'error');
        } finally {
            setSyncingNow(false);
        }
    };

    const handleCopyDispatch = async (promptText: string) => {
        await copyToClipboard(promptText);
        showToast('Đã copy Prompt 1-Phát vào Clipboard — dán ngay vào Antigravity / Claude / Codex!', 'success');
    };

    if (health && health.pin_required && !health.authenticated) {
        return (
            <div className="min-h-dvh flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4">
                <form
                    onSubmit={handlePinSubmit}
                    className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl space-y-4"
                >
                    <div className="flex items-center gap-2.5">
                        <div className="p-2.5 rounded-xl bg-indigo-600 text-white">
                            <Lock className="w-5 h-5" />
                        </div>
                        <div>
                            <h1 className="text-base font-extrabold text-slate-900 dark:text-white">
                                Antigravity Prompt Coach
                            </h1>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Nhập mã PIN 6 số hiển thị trên cửa sổ Terminal PC
                            </p>
                        </div>
                    </div>
                    <input
                        type="password"
                        inputMode="numeric"
                        autoFocus
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value)}
                        placeholder="Nhập mã PIN..."
                        className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold text-center tracking-widest tabular-nums outline-none focus:border-indigo-500"
                    />
                    {authErr && <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{authErr}</p>}
                    <button
                        type="submit"
                        disabled={submittingPin}
                        className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
                    >
                        {submittingPin ? 'Đang kiểm tra...' : 'Mở khóa truy cập'}
                    </button>
                </form>
                <ToastViewport />
            </div>
        );
    }

    return (
        <div className="min-h-dvh flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
            {/* Mobile Drawer Backdrop */}
            {mobileDrawer && (
                <div
                    className="fixed inset-0 z-40 bg-slate-950/60 lg:hidden"
                    onClick={() => setMobileDrawer(false)}
                />
            )}

            {/* Left Navigation Sidebar */}
            <aside
                className={`bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col shrink-0 transition-all z-50 ${
                    sidebarCollapsed ? 'lg:w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-[264px]'
                } ${mobileDrawer ? 'fixed inset-y-0 left-0 w-[274px] shadow-2xl flex' : 'hidden lg:flex'}`}
            >
                <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <img src="/icons/dopamine-3d/quest_brain.png" alt="" className="w-7 h-7 object-contain shrink-0" />
                        <div className="min-w-0">
                            <div className="text-xs font-extrabold truncate">Antigravity Prompt Coach</div>
                            <div className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                <span>Self-Host · Zero-Data-Leak</span>
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => (mobileDrawer ? setMobileDrawer(false) : setSidebarCollapsed(true))}
                        title="Thu gọn thanh bên"
                        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                        {mobileDrawer ? <X className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                    </button>
                </div>

                {/* Theme + Font Scale Controls */}
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex items-center justify-between gap-1.5">
                        <button
                            type="button"
                            onClick={() => setDark(v => !v)}
                            className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer hover:border-indigo-400"
                        >
                            {dark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-600" />}
                            <span>{dark ? 'Sáng' : 'Tối'}</span>
                        </button>
                        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden tabular-nums">
                            {([100, 110, 120] as const).map(sc => (
                                <button
                                    key={sc}
                                    type="button"
                                    onClick={() => setFontScale(sc)}
                                    className={`px-2 py-1.5 text-xs font-bold cursor-pointer ${
                                        fontScale === sc
                                            ? 'bg-indigo-600 text-white'
                                            : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                                    }`}
                                >
                                    {sc}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Period Filter Sync */}
                    <div className="grid grid-cols-3 gap-1 text-xs font-bold">
                        {(
                            [
                                ['day', 'Hôm nay'],
                                ['yesterday', 'Hôm qua'],
                                ['week', '7 ngày'],
                                ['month', '30 ngày'],
                                ['all', 'Tất cả'],
                            ] as const
                        ).map(([pk, pl]) => (
                            <button
                                key={pk}
                                type="button"
                                onClick={() => setUsagePeriod(pk)}
                                className={`px-2 py-1 rounded-lg border cursor-pointer ${
                                    usagePeriod === pk
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                }`}
                            >
                                {pl}
                            </button>
                        ))}
                        <button
                            type="button"
                            disabled={syncingNow}
                            onClick={() => void handleManualSync()}
                            className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white inline-flex items-center justify-center gap-1 cursor-pointer"
                        >
                            <RefreshCw className={`w-3 h-3 ${syncingNow ? 'animate-spin' : ''}`} />
                            <span>Sync</span>
                        </button>
                    </div>
                </div>

                {/* Live Local Vault Telemetry */}
                <div className="p-3 flex-1 overflow-y-auto space-y-3 text-xs">
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 p-3 space-y-2 tabular-nums">
                        <div className="font-extrabold flex items-center gap-1.5 text-slate-800 dark:text-slate-100">
                            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>Kho SQLite Trên Máy Bạn</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Phiên trực tiếp:</span>
                            <span className="font-extrabold">{(health?.watcher?.direct_sessions ?? 0).toLocaleString('vi-VN')}</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Tổng bản ghi quét:</span>
                            <span className="font-extrabold">{(health?.watcher?.total_records ?? 0).toLocaleString('vi-VN')}</span>
                        </div>
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Watcher Realtime:</span>
                            <span className="font-extrabold text-emerald-600 dark:text-emerald-400">2.5 giây / nhịp</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed pt-1 border-t border-slate-200 dark:border-slate-700">
                            Tự động đọc lịch sử <strong>Antigravity PC</strong>, <strong>Claude Code</strong> &amp; <strong>Codex</strong> ngay trên ổ cứng máy tính. Không gửi dữ liệu hội thoại ra bên ngoài.
                        </p>
                    </div>

                    <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 space-y-1.5">
                        <div className="font-extrabold flex items-center gap-1.5 text-indigo-900 dark:text-indigo-200">
                            <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                            <span>Mẹo mở Full Màn Hình</span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                            Bấm tab <strong>2. Giao diện Antigravity PC</strong> để mở chế độ đối chiếu song song <strong>Thật ↔ 1-Phát</strong> khớp 1:1 thứ tự Realtime với ứng dụng Antigravity trên máy.
                        </p>
                    </div>

                    <div className="space-y-1 pt-1">
                        <div className="px-1 font-bold text-slate-400 uppercase tracking-wider text-xs">
                            Hệ sinh thái Cộng đồng
                        </div>
                        <a
                            href="https://aihot.vn"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                        >
                            <span className="inline-flex items-center gap-2">
                                <Terminal className="w-3.5 h-3.5 text-indigo-500" />
                                <span>Cổng Cộng đồng AIHOT.VN</span>
                            </span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                        </a>
                        <a
                            href="https://github.com/vudanhdu2/antigravity-prompt-coach"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                        >
                            <span className="inline-flex items-center gap-2">
                                <Github className="w-3.5 h-3.5" />
                                <span>GitHub Mã nguồn mở</span>
                            </span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                        </a>
                    </div>
                </div>
            </aside>

            {/* Main Content Area */}
            <div className="flex-1 min-w-0 flex flex-col">
                <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-3 sm:px-5 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (window.innerWidth < 1024) setMobileDrawer(true);
                                else setSidebarCollapsed(v => !v);
                            }}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="Đóng/Mở Menu bên trái"
                        >
                            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
                        </button>
                        <span className="text-xs sm:text-sm font-extrabold">
                            Antigravity Prompt Coach v{health?.version || '1.0.0'} — Chấm điểm 6×7 Rubric &amp; Tối ưu 1-Phát
                        </span>
                    </div>
                    <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>100% Dữ liệu nằm trên máy bạn</span>
                    </span>
                </header>

                <main className="p-3 sm:p-5 max-w-[1600px] w-full mx-auto">
                    <AdminPromptCoachSection
                        apiKey={sessionToken || 'local_selfhost'}
                        onDispatchToA1={txt => void handleCopyDispatch(txt)}
                        externalUsagePeriod={usagePeriod}
                        externalFilterDate={filterDate}
                        onSyncUsagePeriod={(p, d) => {
                            setUsagePeriod(p);
                            if (d !== undefined) setFilterDate(d);
                        }}
                    />
                </main>
            </div>

            <ToastViewport />
        </div>
    );
};
