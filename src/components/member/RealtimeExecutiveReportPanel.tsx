import React from 'react';
import {
    Activity,
    AlertTriangle,
    ArrowRight,
    Check,
    CheckCircle2,
    Clock,
    Copy,
    Folder,
    Flame,
    Target,
    TrendingUp,
    Wand2,
    Zap,
} from 'lucide-react';

export interface RealtimeRunningSessionItem {
    session_key: string;
    title: string;
    project: string;
    tool: string;
    n_human_prompts: number;
    clean_active_hours: number;
    avg_prompt_score: number;
    tool_error_count: number;
    last_activity_ts: number;
    needs_handoff: boolean;
    status_badge: string;
}

export interface RealtimeDimensionAvgItem {
    key: string;
    code: string;
    label: string;
    avg_score: number;
    fail_count: number;
    status: 'good' | 'warn' | 'weak' | string;
}

export interface RealtimeBottleneckItem {
    code: string;
    title: string;
    severity: 'red' | 'amber' | string;
    impact_prompts: number;
    impact_pct: number;
    why: string;
    fix_rule: string;
    quick_template: string;
    sample_session_key: string;
    sample_session_title: string;
    sample_idx: number;
}

export interface RealtimeProjectHealthItem {
    project: string;
    sessions_count: number;
    running_count: number;
    prompts_count: number;
    avg_prompt_score: number;
    one_shot_pct: number;
    weak_prompts_count: number;
    tool_error_count: number;
    savable_prompts: number;
    hottest_session_key: string;
    hottest_session_title: string;
}

export interface RealtimeActionableCaseItem {
    session_key: string;
    title: string;
    project: string;
    tool: string;
    is_running: boolean;
    last_activity_ts: number;
    n_human_prompts: number;
    clean_active_hours: number;
    avg_prompt_score: number;
    tool_error_count: number;
    weak_prompt_count: number;
    mergeable_count: number;
    savable_turns: number;
    reason_badge: string;
    diagnosis_1line: string;
    consolidated_1shot: string;
    worst_idx: number;
    worst_prompt_text: string;
}

export interface RealtimeRecentTurnItem {
    session_key: string;
    session_title: string;
    project: string;
    tool: string;
    is_session_running: boolean;
    idx: number;
    ts_iso: string;
    ts_epoch: number;
    score: number;
    level: string;
    stage_label: string;
    verdict: string;
    text_redacted: string;
    improved_prompt: string;
    turn_duration_s?: number | null;
    assistant_summary?: string;
    had_tool_error: boolean;
    failed_tools?: string[];
    is_one_shot: boolean;
}

export interface RealtimeExecutiveReport {
    generated_at_iso: string;
    period_label: string;
    headline: string;
    live_pulse: {
        running_sessions_count: number;
        running_sessions: RealtimeRunningSessionItem[];
        recent_2h_prompts: number;
        recent_2h_sessions: number;
        recent_2h_avg_score: number;
        recent_2h_tool_errors: number;
    };
    kpis: {
        evaluated_prompts: number;
        one_shot_count: number;
        one_shot_rate_pct: number;
        weak_count: number;
        rework_count: number;
        rework_rate_pct: number;
        est_savable_prompts: number;
        est_savable_hours: number;
        dimension_avgs: RealtimeDimensionAvgItem[];
        weakest_dimensions: RealtimeDimensionAvgItem[];
    };
    top_bottlenecks: RealtimeBottleneckItem[];
    by_project: RealtimeProjectHealthItem[];
    top_actionable_cases: RealtimeActionableCaseItem[];
    live_recent_turns: RealtimeRecentTurnItem[];
}

export interface RealtimeExecutiveReportPanelProps {
    report: RealtimeExecutiveReport;
    dark?: boolean;
    copiedId: string | null;
    onCopy: (text: string, id: string, toastMsg?: string) => void;
    onOpenSessionTurn: (sessionKey: string, turnIdx?: number) => void;
    onLoadTemplateToComposer?: (templateText: string) => void;
    onCloseReportView?: () => void;
}

const TOOL_BADGE_META: Record<string, { label: string; cls: string }> = {
    antigravity: {
        label: 'Antigravity',
        cls: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-400/40',
    },
    claude: {
        label: 'Claude Code',
        cls: 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-400/40',
    },
    codex: {
        label: 'Codex',
        cls: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-400/40',
    },
};

function formatRelAgo(tsEpoch: number, nowEpoch: number): string {
    if (!tsEpoch || tsEpoch <= 0) return '—';
    const diff = Math.max(0, Math.floor(nowEpoch - tsEpoch));
    if (diff < 60) return 'vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)}p trước`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h trước`;
    return `${Math.floor(diff / 86400)} ngày trước`;
}

function cleanSessionName(rawTitle: string, fallbackKey: string): string {
    const t = (rawTitle || '').replace(/\s+/g, ' ').trim();
    if (!t) return fallbackKey;
    return t.length > 78 ? `${t.slice(0, 76)}…` : t;
}

function buildMarkdownBrief(report: RealtimeExecutiveReport): string {
    const lp = report.live_pulse;
    const k = report.kpis;
    const lines: string[] = [
        `# ⚡ Báo cáo Nhịp Realtime 30s — A12 Tối ưu Prompt (${report.period_label})`,
        `- **Tóm tắt điều hành**: ${report.headline}`,
        `- **Phiên đang chạy Live**: ${lp.running_sessions_count} phiên · **Nhịp 2h gần nhất**: ${lp.recent_2h_prompts} lượt (${lp.recent_2h_sessions} phiên, TB ${lp.recent_2h_avg_score}đ, ${lp.recent_2h_tool_errors} lỗi tool)`,
        `- **Tỷ lệ Ăn ngay 1-Phát**: ${k.one_shot_rate_pct}% (${k.one_shot_count}/${k.evaluated_prompts} lượt) · **Tỷ lệ phải sửa/nhắc vòng**: ${k.rework_rate_pct}%`,
        `- **Tiềm năng tiết kiệm**: ~${k.est_savable_prompts} lượt (~${k.est_savable_hours} giờ chờ AI)`,
        '',
        '## 1. Top Điểm nghẽn Pareto 80/20 cần khắc phục ngay',
    ];
    for (const b of report.top_bottlenecks.slice(0, 3)) {
        lines.push(`- **${b.title}** (${b.impact_prompts} lượt · ${b.impact_pct}%): ${b.fix_rule}`);
        lines.push(`  - *Mẫu 1-Phát*: \`${b.quick_template}\``);
    }
    if (report.top_actionable_cases.length > 0) {
        lines.push('', '## 2. Top Ca Nóng Cần Xem Ngay');
        for (const c of report.top_actionable_cases.slice(0, 5)) {
            lines.push(
                `- **[${c.project}] ${cleanSessionName(c.title, c.session_key)}** (${c.reason_badge} · TB ${Math.round(c.avg_prompt_score)}đ): ${c.diagnosis_1line}`
            );
        }
    }
    return lines.join('\n');
}

export const RealtimeExecutiveReportPanel: React.FC<RealtimeExecutiveReportPanelProps> = ({
    report,
    dark = false,
    copiedId,
    onCopy,
    onOpenSessionTurn,
    onLoadTemplateToComposer,
    onCloseReportView,
}) => {
    const nowEpoch = Math.floor(Date.now() / 1000);
    const lp = report.live_pulse;
    const kpis = report.kpis;

    const cardCls = dark
        ? 'bg-[#202022] border-[#333338] text-[#e8eaed]'
        : 'bg-white border-slate-200/90 text-slate-900';
    const subCardCls = dark
        ? 'bg-[#171719] border-[#2c2c31] text-[#e8eaed]'
        : 'bg-slate-50/90 border-slate-200/80 text-slate-900';
    const mutedCls = dark ? 'text-[#9aa0a6]' : 'text-slate-500';

    return (
        <div className="space-y-3.5 text-xs">
            {/* KHỐI 1: THANH ĐIỀU HÀNH 30 GIÂY & NHỊP SỐNG TỨC THỜI */}
            <div
                className={`rounded-2xl border p-3.5 sm:p-4 shadow-xs space-y-3 ${
                    dark
                        ? 'bg-gradient-to-br from-[#1d1f2b] via-[#19191c] to-[#172321] border-indigo-500/35 text-white'
                        : 'bg-gradient-to-br from-indigo-50/90 via-white to-emerald-50/70 border-indigo-200 text-slate-900'
                }`}
            >
                <div className="flex flex-wrap items-start justify-between gap-2.5">
                    <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-600 text-white font-extrabold text-xs shadow-2xs">
                                <Zap className="w-3.5 h-3.5 text-amber-300" />
                                <span>Báo cáo Nhịp Realtime 30 Giây</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 font-bold tabular-nums">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span>
                                    Đang chạy Live: {lp.running_sessions_count} phiên · 2h qua: {lp.recent_2h_prompts} lượt
                                </span>
                            </span>
                            {lp.recent_2h_tool_errors > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/40 text-rose-700 dark:text-rose-300 font-extrabold tabular-nums">
                                    <AlertTriangle className="w-3 h-3" />
                                    <span>{lp.recent_2h_tool_errors} lỗi Tool trong 2h qua</span>
                                </span>
                            )}
                        </div>
                        <p className="text-xs sm:text-sm font-extrabold leading-relaxed pt-0.5">
                            {report.headline}
                        </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() =>
                                onCopy(
                                    buildMarkdownBrief(report),
                                    'rt-exec-md',
                                    'Đã copy Báo cáo Tóm tắt Điều hành (Markdown)!'
                                )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-extrabold cursor-pointer shadow-2xs hover:opacity-90 transition-opacity"
                        >
                            {copiedId === 'rt-exec-md' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                            <span>Copy Báo cáo 30s</span>
                        </button>
                        {onCloseReportView && (
                            <button
                                type="button"
                                onClick={onCloseReportView}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                            >
                                <span>Quay lại Luồng Hội thoại Song song</span>
                                <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* Dải các phiên đang chạy ngay lúc này (nếu có) */}
                {lp.running_sessions.length > 0 && (
                    <div className="pt-2 border-t border-indigo-200/60 dark:border-slate-700/70 flex flex-wrap items-center gap-1.5">
                        <span className={`font-extrabold ${mutedCls} mr-1`}>
                            Phiên đang mở chạy trực tiếp:
                        </span>
                        {lp.running_sessions.map(rs => (
                            <button
                                key={rs.session_key}
                                type="button"
                                onClick={() => onOpenSessionTurn(rs.session_key)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl border font-bold transition-colors cursor-pointer tabular-nums ${
                                    rs.needs_handoff
                                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-900 dark:text-amber-200 hover:border-amber-500'
                                        : `${cardCls} hover:border-indigo-500`
                                }`}
                            >
                                <span className="inline-grid grid-cols-2 gap-[2px] w-3 h-3 shrink-0">
                                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                                </span>
                                <span className="font-extrabold truncate max-w-[200px]">
                                    [{rs.project}] {cleanSessionName(rs.title, rs.session_key)}
                                </span>
                                <span className={mutedCls}>
                                    · {rs.n_human_prompts}p · {Math.round(rs.avg_prompt_score)}đ
                                </span>
                                {rs.tool_error_count > 0 && (
                                    <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                        · {rs.tool_error_count} lỗi
                                    </span>
                                )}
                                {rs.needs_handoff && (
                                    <span className="px-1.5 py-0.5 rounded bg-amber-600 text-white font-extrabold">
                                        Cần HANDOFF
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* KHỐI 2: 4 CHỈ SỐ CỐT LÕI & THANH NHIỆT 7 CHIỀU RUBRIC */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-12 gap-3 tabular-nums">
                {/* KPI 1: Tỷ lệ Ăn ngay 1-Phát */}
                <div className={`xl:col-span-2 rounded-2xl border p-3.5 space-y-1.5 ${cardCls}`}>
                    <div className="flex items-center justify-between gap-1">
                        <span className={`font-bold ${mutedCls}`}>Ăn ngay 1-Phát</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    </div>
                    <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                        {kpis.one_shot_rate_pct}%
                    </div>
                    <div className={mutedCls}>
                        <strong>{kpis.one_shot_count}</strong>/{kpis.evaluated_prompts} lượt đạt &ge;78đ &amp; 0 lỗi Tool
                    </div>
                </div>

                {/* KPI 2: Tỷ lệ Hao phí / Phải sửa vòng */}
                <div className={`xl:col-span-2 rounded-2xl border p-3.5 space-y-1.5 ${cardCls}`}>
                    <div className="flex items-center justify-between gap-1">
                        <span className={`font-bold ${mutedCls}`}>Lượt nhắc / sửa vòng</span>
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    </div>
                    <div
                        className={`text-2xl font-black ${
                            kpis.rework_rate_pct <= 20
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : kpis.rework_rate_pct <= 40
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-rose-600 dark:text-rose-400'
                        }`}
                    >
                        {kpis.rework_rate_pct}%
                    </div>
                    <div className={mutedCls}>
                        <strong>{kpis.rework_count}</strong> lượt nhắc ngắn, gộp được hoặc vấp lỗi
                    </div>
                </div>

                {/* KPI 3: Tiềm năng tiết kiệm */}
                <div className={`xl:col-span-3 rounded-2xl border p-3.5 space-y-1.5 ${cardCls}`}>
                    <div className="flex items-center justify-between gap-1">
                        <span className={`font-bold ${mutedCls}`}>Quỹ lượt &amp; giờ tiết kiệm được</span>
                        <TrendingUp className="w-4 h-4 text-indigo-500 shrink-0" />
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                            ~{kpis.est_savable_prompts} lượt
                        </span>
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                            (~{kpis.est_savable_hours}h chờ AI)
                        </span>
                    </div>
                    <div className={mutedCls}>
                        Nếu gộp yêu cầu nhỏ giọt &amp; khóa Tiêu chí Done ngay câu #1
                    </div>
                </div>

                {/* KPI 4: Thanh nhiệt 7 Chiều Rubric */}
                <div className={` sm:col-span-2 xl:col-span-5 rounded-2xl border p-3.5 space-y-2 ${cardCls}`}>
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="font-extrabold">Sức khỏe 7 Chiều Rubric (6&times;7 Stage-Aware)</span>
                        {kpis.weakest_dimensions.length > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/35 text-rose-700 dark:text-rose-300 font-bold">
                                Yếu nhất: {kpis.weakest_dimensions.map(d => `${d.label} (${d.avg_score}đ)`).join(' · ')}
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-7 gap-1.5 pt-0.5">
                        {kpis.dimension_avgs.map(dim => {
                            const barCls =
                                dim.status === 'good'
                                    ? 'bg-emerald-500'
                                    : dim.status === 'warn'
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500';
                            return (
                                <div
                                    key={dim.key}
                                    title={`${dim.label}: TB ${dim.avg_score}/100đ (${dim.fail_count} câu thiếu)`}
                                    className={`rounded-xl border p-2 text-center space-y-1 ${subCardCls}`}
                                >
                                    <div className="font-black">{dim.code}</div>
                                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${barCls}`}
                                            style={{ width: `${Math.max(12, Math.min(100, Math.round(dim.avg_score)))}%` }}
                                        />
                                    </div>
                                    <div className={`font-extrabold ${mutedCls}`}>{Math.round(dim.avg_score)}đ</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* KHỐI 3: TOP ĐIỂM NGHẼN PARETO 80/20 (CHỈ CẦN SỬA ĐÚNG 3 THÓI QUEN NÀY) */}
            <div className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 ${cardCls}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Flame className="w-4 h-4 text-rose-500 shrink-0" />
                        <h3 className="text-sm font-extrabold">
                            Quy luật Pareto 80/20: Top Điểm Nghẽn Gây Tốn Lượt Nhất &amp; Mẫu Câu Khắc Phục 1-Chạm
                        </h3>
                    </div>
                    <span className={mutedCls}>
                        Thay vì đọc từng câu, chỉ cần áp dụng đúng các mẫu khung dưới đây
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    {report.top_bottlenecks.slice(0, 3).map((bn, idx) => {
                        const copyKey = `rt-bn-${bn.code}`;
                        return (
                            <div
                                key={bn.code}
                                className={`rounded-xl border p-3.5 flex flex-col justify-between gap-2.5 ${subCardCls}`}
                            >
                                <div className="space-y-2">
                                    <div className="flex items-start justify-between gap-2">
                                        <span
                                            className={`px-2 py-0.5 rounded-full border font-extrabold ${
                                                bn.severity === 'red'
                                                    ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40'
                                                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/40'
                                            }`}
                                        >
                                            Điểm nghẽn #{idx + 1}
                                        </span>
                                        <span className="font-extrabold tabular-nums text-rose-600 dark:text-rose-400">
                                            {bn.impact_prompts} lượt ({bn.impact_pct}%)
                                        </span>
                                    </div>
                                    <div className="text-xs sm:text-sm font-extrabold leading-snug">
                                        {bn.title}
                                    </div>
                                    <p className={`${mutedCls} leading-relaxed`}>{bn.why}</p>
                                    <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2.5 space-y-1">
                                        <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                            Mẫu 1-Phát khắc phục ngay:
                                        </div>
                                        <div className="leading-relaxed break-words font-medium">
                                            {bn.quick_template}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-1.5 pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onCopy(
                                                    bn.quick_template,
                                                    copyKey,
                                                    `Đã copy mẫu khắc phục "${bn.title}"!`
                                                )
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                        >
                                            {copiedId === copyKey ? (
                                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                            ) : (
                                                <Copy className="w-3.5 h-3.5" />
                                            )}
                                            <span>Copy mẫu</span>
                                        </button>
                                        {onLoadTemplateToComposer && (
                                            <button
                                                type="button"
                                                onClick={() => onLoadTemplateToComposer(bn.quick_template)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                                            >
                                                <Wand2 className="w-3.5 h-3.5" />
                                                <span>Nạp Composer</span>
                                            </button>
                                        )}
                                    </div>
                                    {bn.sample_session_key && (
                                        <button
                                            type="button"
                                            onClick={() => onOpenSessionTurn(bn.sample_session_key, bn.sample_idx)}
                                            className="inline-flex items-center gap-1 font-extrabold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer tabular-nums"
                                        >
                                            <span>Xem ca thật #{bn.sample_idx} →</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* KHỐI 4: TOP 5 CA NÓNG CẦN XEM NGAY (TRÁI) & MA TRẬN SỨC KHỎE DỰ ÁN (PHẢI) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
                {/* Cột Trái (7/12): Top 5 Ca Nóng Cần Xem Ngay */}
                <div className={`xl:col-span-7 rounded-2xl border p-3.5 sm:p-4 space-y-3 ${cardCls}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Target className="w-4 h-4 text-indigo-500 shrink-0" />
                            <div>
                                <h3 className="text-sm font-extrabold">
                                    Top {report.top_actionable_cases.length} Ca Nóng Cần Xem Ngay (Đáng chú ý nhất kỳ)
                                </h3>
                                <p className={mutedCls}>
                                    Chọn lọc tự động từ toàn bộ phiên theo mức độ đang chạy, lỗi Tool và số lượt có thể rút gọn
                                </p>
                            </div>
                        </div>
                    </div>

                    {report.top_actionable_cases.length === 0 ? (
                        <div className={`rounded-xl border p-6 text-center ${subCardCls} ${mutedCls}`}>
                            Tuyệt vời! Chưa có phiên nào bị phình hoặc vấp lỗi nặng trong kỳ này.
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {report.top_actionable_cases.map((ca, cIdx) => {
                                const tMeta = TOOL_BADGE_META[ca.tool] || TOOL_BADGE_META.antigravity;
                                const copyKey = `rt-case-1shot-${ca.session_key}`;
                                return (
                                    <div
                                        key={ca.session_key}
                                        className={`rounded-xl border p-3 space-y-2 transition-colors ${subCardCls} hover:border-indigo-400`}
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                <span className="px-2 py-0.5 rounded-md bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-black tabular-nums">
                                                    #{cIdx + 1}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-md border font-extrabold ${tMeta.cls}`}>
                                                    {tMeta.label}
                                                </span>
                                                <span className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 font-bold">
                                                    {ca.project}
                                                </span>
                                                <span className="font-extrabold text-xs sm:text-sm truncate max-w-[260px] sm:max-w-[360px]">
                                                    {cleanSessionName(ca.title, ca.session_key)}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                                                <span className="px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/35 text-rose-700 dark:text-rose-300 font-extrabold">
                                                    {ca.reason_badge}
                                                </span>
                                                {ca.savable_turns > 0 && (
                                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 font-extrabold">
                                                        Tiết kiệm ~{ca.savable_turns}p
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className={`${mutedCls} leading-relaxed`}>
                                            <strong className={dark ? 'text-white' : 'text-slate-900'}>Chẩn đoán nhanh:</strong>{' '}
                                            {ca.diagnosis_1line}
                                        </div>

                                        {ca.consolidated_1shot && (
                                            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-2 space-y-1">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                                        Bản Gộp / Viết lại 1-Phát đại diện:
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onCopy(
                                                                ca.consolidated_1shot,
                                                                copyKey,
                                                                'Đã copy Bản 1-Phát của phiên!'
                                                            )
                                                        }
                                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                    >
                                                        {copiedId === copyKey ? (
                                                            <Check className="w-3 h-3 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3 h-3" />
                                                        )}
                                                        <span>Copy 1-Phát</span>
                                                    </button>
                                                </div>
                                                <div className="line-clamp-2 whitespace-pre-wrap break-words">
                                                    {ca.consolidated_1shot}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                            <span className={`tabular-nums ${mutedCls}`}>
                                                Hoạt động: {formatRelAgo(ca.last_activity_ts, nowEpoch)} · Điểm TB:{' '}
                                                <strong>{Math.round(ca.avg_prompt_score)}/100đ</strong>
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenSessionTurn(ca.session_key, ca.worst_idx)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer tabular-nums"
                                                >
                                                    <span>Mở phiên &amp; nhảy tới Câu #{ca.worst_idx} →</span>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Cột Phải (5/12): Ma trận Sức khỏe theo Dự án / Workspace */}
                <div className={`xl:col-span-5 rounded-2xl border p-3.5 sm:p-4 space-y-3 ${cardCls}`}>
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                            <div>
                                <h3 className="text-sm font-extrabold">
                                    Ma trận Sức khỏe theo Dự án ({report.by_project.length})
                                </h3>
                                <p className={mutedCls}>
                                    Biết ngay dự án nào đang chạy mượt, dự án nào hao nhiều lượt &amp; lỗi Tool
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse tabular-nums">
                            <thead>
                                <tr className={`border-b border-slate-200 dark:border-slate-700/80 ${mutedCls} font-bold`}>
                                    <th className="py-2 pr-2">Dự án</th>
                                    <th className="py-2 px-2 text-right">Phiên / Prompt</th>
                                    <th className="py-2 px-2 text-right">TB / 1-Phát</th>
                                    <th className="py-2 px-2 text-right">Lỗi Tool</th>
                                    <th className="py-2 pl-2 text-right">Mở nhanh</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60 dark:divide-slate-800">
                                {report.by_project.map(pr => (
                                    <tr key={pr.project} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                                        <td className="py-2.5 pr-2 font-extrabold">
                                            <div className="flex items-center gap-1.5">
                                                <span className="truncate max-w-[130px]" title={pr.project}>
                                                    {pr.project}
                                                </span>
                                                {pr.running_count > 0 && (
                                                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-black">
                                                        {pr.running_count} live
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-2.5 px-2 text-right">
                                            <span className="font-extrabold">{pr.prompts_count}p</span>
                                            <span className={mutedCls}> / {pr.sessions_count} phiên</span>
                                        </td>
                                        <td className="py-2.5 px-2 text-right">
                                            <span className="font-extrabold">{pr.avg_prompt_score}đ</span>
                                            <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                                                {' '}
                                                ({pr.one_shot_pct}%)
                                            </span>
                                        </td>
                                        <td className="py-2.5 px-2 text-right">
                                            {pr.tool_error_count > 0 ? (
                                                <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                                    {pr.tool_error_count} lỗi
                                                </span>
                                            ) : (
                                                <span className="text-emerald-600 dark:text-emerald-400 font-bold">0</span>
                                            )}
                                        </td>
                                        <td className="py-2.5 pl-2 text-right">
                                            {pr.hottest_session_key && (
                                                <button
                                                    type="button"
                                                    onClick={() => onOpenSessionTurn(pr.hottest_session_key)}
                                                    className="px-2 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-700 dark:text-indigo-300 font-extrabold cursor-pointer"
                                                >
                                                    Soi →
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* KHỐI 5: DÒNG CHẢY 15 LƯỢT PROMPT VỪA GỬI (LIVE TICKER) */}
            <div className={`rounded-2xl border p-3.5 sm:p-4 space-y-3 ${cardCls}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                        <div>
                            <h3 className="text-sm font-extrabold">
                                Dòng chảy {report.live_recent_turns.length} Lượt Prompt Vừa Gửi (Live Ticker: Thật &leftrightarrow; 1-Phát)
                            </h3>
                            <p className={mutedCls}>
                                Lướt nhanh các câu vừa gõ gần nhất trên cả 3 công cụ kèm kết quả AI thực thi mà không cần mở từng phiên
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-2">
                    {report.live_recent_turns.map((turn, tIdx) => {
                        const tMeta = TOOL_BADGE_META[turn.tool] || TOOL_BADGE_META.antigravity;
                        const copyTurnKey = `rt-turn-${turn.session_key}-${turn.idx}-${tIdx}`;
                        return (
                            <div
                                key={`${turn.session_key}-${turn.idx}-${tIdx}`}
                                className={`rounded-xl border p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-start ${subCardCls}`}
                            >
                                {/* Cột Trái (6/12): Lượt thật + Phản hồi AI */}
                                <div className="lg:col-span-6 space-y-1.5 min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                                        <span className={`px-2 py-0.5 rounded border font-extrabold ${tMeta.cls}`}>
                                            {tMeta.label}
                                        </span>
                                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                            [{turn.project}]
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => onOpenSessionTurn(turn.session_key, turn.idx)}
                                            className="font-extrabold hover:underline truncate max-w-[210px] cursor-pointer"
                                        >
                                            {cleanSessionName(turn.session_title, turn.session_key)} · #{turn.idx}
                                        </button>
                                        <span className={mutedCls}>· {formatRelAgo(turn.ts_epoch, nowEpoch)}</span>
                                        {turn.turn_duration_s ? (
                                            <span className={`inline-flex items-center gap-0.5 ${mutedCls}`}>
                                                <Clock className="w-3 h-3" />
                                                <span>{turn.turn_duration_s}s</span>
                                            </span>
                                        ) : null}
                                        <span
                                            className={`px-2 py-0.5 rounded-full border font-extrabold ${
                                                turn.score >= 78
                                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/35'
                                                    : turn.score >= 55
                                                      ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300 border-amber-500/35'
                                                      : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/35'
                                            }`}
                                        >
                                            {turn.score}đ · {turn.verdict}
                                        </span>
                                        {turn.had_tool_error && (
                                            <span className="px-2 py-0.5 rounded-full bg-rose-600 text-white font-extrabold">
                                                Lỗi Tool {turn.failed_tools?.length ? `(${turn.failed_tools.join(',')})` : ''}
                                            </span>
                                        )}
                                    </div>

                                    <div className="line-clamp-2 whitespace-pre-wrap break-words font-semibold">
                                        {turn.text_redacted}
                                    </div>

                                    {turn.assistant_summary && (
                                        <div className={`${mutedCls} line-clamp-1`}>
                                            &rarr; <strong>AI:</strong> {turn.assistant_summary}
                                        </div>
                                    )}
                                </div>

                                {/* Cột Phải (6/12): Bản 1-Phát đối ứng */}
                                <div className="lg:col-span-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 p-2.5 min-w-0">
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                            {turn.is_one_shot ? '✓ Đã đạt chuẩn 1-Phát:' : '✨ Cách viết 1-Phát gọn hơn:'}
                                        </div>
                                        <div className="line-clamp-2 whitespace-pre-wrap break-words">
                                            {turn.improved_prompt}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                onCopy(
                                                    turn.improved_prompt,
                                                    copyTurnKey,
                                                    `Đã copy câu 1-Phát cho lượt #${turn.idx}!`
                                                )
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                        >
                                            {copiedId === copyTurnKey ? (
                                                <Check className="w-3 h-3 text-emerald-400" />
                                            ) : (
                                                <Copy className="w-3 h-3" />
                                            )}
                                            <span>Copy</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onOpenSessionTurn(turn.session_key, turn.idx)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer tabular-nums"
                                        >
                                            <span>Mở #{turn.idx} →</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
