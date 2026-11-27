import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    Clock,
    Copy,
    Download,
    Eye,
    Filter,
    FolderOpen,
    GitCompare,
    Lightbulb,
    Link2,
    RefreshCw,
    Save,
    Search,
    Send,
    Settings,
    ShieldCheck,
    Sparkles,
    Table2,
    Trash2,
    Wand2,
    Wrench,
    X,
} from 'lucide-react';
import { showToast } from '../common/ToastContainer';
import { copyToClipboard } from '../../utils/clipboard';
import HighlightText from '../../utils/HighlightText';
import { matchesAllVnTokens, scoreVnSearchFields, tokenizeVnSearch } from '../../utils/vnSearch';
import type { PortalTab } from './MemberPortalHelpers';
import { AntigravityPcCoachTab } from './AntigravityPcCoachTab';
import {
    RealtimeExecutiveReportPanel,
    type RealtimeExecutiveReport,
} from './RealtimeExecutiveReportPanel';

function readPersistedAdminToken(): string {
    if (typeof window === 'undefined') return '';
    try {
        return (
            localStorage.getItem('abv_admin_api_key') ||
            sessionStorage.getItem('abv_admin_api_key') ||
            ''
        ).trim();
    } catch {
        return '';
    }
}

interface CoachSettings {
    max_prompts_per_session: number;
    max_hours_per_session: number;
    max_correction_pct: number;
    auto_analyze_ai: boolean;
    updated_at?: string;
}

interface RuleFlag {
    code: string;
    label: string;
    severity: 'red' | 'amber' | 'green';
    tip: string;
}

interface DayBreakdownRow {
    day: string;
    direct_prompts: number;
    bg_prompts: number;
    auto_ignored: number;
    direct_sessions: number;
    bg_sessions: number;
    active_hours: number;
    over_limit_sessions: number;
    avg_prompts_per_session: number;
    efficiency_score: number;
    short_nudges: number;
    vague_errors: number;
    corr_kw: number;
    by_tool: Record<string, { prompts: number; sessions: number; hours: number }>;
}

interface PromptCheckItem {
    key: string;
    label: string;
    ok: boolean;
    applicable?: boolean;
}

interface FocusHabitItem {
    code?: string;
    title: string;
    why?: string;
    action_tip: string;
    fail_count?: number;
    hit_rate_pct?: number;
}

interface PromptScoreMiniItem {
    idx: number;
    score: number;
    level: 'green' | 'amber' | 'red' | string;
    verdict: string;
    stage?: string;
    stage_label?: string;
    had_tool_error?: boolean;
    merge_with?: number[];
    ai_scored?: boolean;
}

interface ScoredPromptPreviewItem {
    idx: number;
    chars: number;
    score: number;
    level: string;
    stage?: string;
    stage_label?: string;
    had_tool_error?: boolean;
    tools_triggered?: string[];
    verdict: string;
    text_redacted: string;
    lesson: string;
    improved_prompt: string;
    merge_with?: number[];
    ai_scored?: boolean;
    checks?: PromptCheckItem[];
}

interface PromptLessonSpotlightItem {
    session_key: string;
    session_title: string;
    tool: string;
    project?: string;
    idx: number;
    score: number;
    level: string;
    stage?: string;
    stage_label?: string;
    had_tool_error?: boolean;
    verdict: string;
    original_text: string;
    lesson: string;
    improved_prompt: string;
    merge_with?: number[];
    ai_scored?: boolean;
}

interface CoachSessionSummary {
    session_key: string;
    tool: 'antigravity' | 'claude' | 'codex' | string;
    title: string;
    project: string;
    start_day: string;
    end_day: string;
    start_ts: number;
    end_ts: number;
    last_activity_ts?: number;
    is_running?: boolean;
    is_pinned?: boolean;
    day_human_prompts: number;
    day_active_hours: number;
    period_human_prompts?: number;
    period_active_hours?: number;
    period_short_nudges?: number;
    period_vague_errors?: number;
    period_corr_kw?: number;
    active_days_in_period?: number;
    n_human_prompts: number;
    clean_active_hours: number;
    n_short_nudges: number;
    n_vague_errors: number;
    n_corr_kw: number;
    total_tool_calls?: number;
    max_consecutive_tool_calls?: number;
    tool_error_count?: number;
    redirection_count?: number;
    first_human_preview: string;
    first_human_len: number;
    rule_score: number;
    severity: 'red' | 'amber' | 'green';
    flags: RuleFlag[];
    has_ai_analysis: boolean;
    ai_is_fresh?: boolean;
    ai_analyzing?: boolean;
    ai_summary?: string;
    ai_takeaway?: string;
    ai_analyzed_at?: string;
    avg_prompt_score?: number;
    weak_prompt_count?: number;
    mergeable_count?: number;
    ai_scored_count?: number;
    prompt_scores_mini?: PromptScoreMiniItem[];
    scored_prompts_preview?: ScoredPromptPreviewItem[];
    top_prompt_lesson?: string;
    focus_habit?: FocusHabitItem;
    matched_in?: string;
    matched_turn_idx?: number | null;
    match_count?: number;
    matched_snippet?: string;
    match_score?: number;
}

interface PromptSampleItem {
    idx: number;
    ts_iso: string;
    day: string;
    chars: number;
    words?: number;
    gap_min?: number;
    is_short_nudge?: boolean;
    is_vague_error?: boolean;
    is_corr_kw?: boolean;
    is_question_reply?: boolean;
    has_image?: boolean;
    tools_triggered?: string[];
    tool_call_count?: number;
    had_tool_error?: boolean;
    assistant_err_snippet?: string;
    turn_duration_s?: number | null;
    assistant_summary?: string;
    files_touched?: string[];
    failed_tools?: string[];
    root_cause_type?: string;
    stage?: string;
    stage_label?: string;
    dimension_scores?: Record<string, number>;
    text_redacted: string;
    score?: number;
    level?: 'green' | 'amber' | 'red' | string;
    verdict?: string;
    checks?: PromptCheckItem[];
    lesson?: string;
    improved_prompt?: string;
    merge_with?: number[];
    ai_scored?: boolean;
}

interface SessionDayBreakdownItem {
    day: string;
    human_prompts: number;
    raw_msgs: number;
    auto_msgs: number;
    active_hours: number;
    short_nudges: number;
    vague_errors: number;
    corr_kw: number;
}

interface AiRewritePair {
    weak_original: string;
    upgraded_prompt: string;
    why_better: string;
}

interface AiPromptReviewItem {
    idx: number;
    score: number;
    verdict: string;
    root_cause_type?: string;
    lesson: string;
    improved_prompt: string;
    merge_with?: number[];
}

interface AiSessionAnalysis {
    schema_v?: number;
    diagnosis?: string;
    split_strategy?: string;
    ideal_session_count?: number;
    est_prompts_after?: number;
    key_takeaway?: string;
    consolidated_prompt?: string;
    focus_habit?: { title: string; action_tip: string } | null;
    rewrite_pairs?: AiRewritePair[];
    prompt_reviews?: AiPromptReviewItem[];
    model?: string;
    analyzed_at?: string;
}

interface CoachSessionDetail extends CoachSessionSummary {
    session_id: string;
    cwd: string;
    is_sub?: boolean;
    days: string[];
    day_breakdown?: SessionDayBreakdownItem[];
    n_raw_msgs: number;
    n_auto_msgs: number;
    auto_breakdown?: Record<string, number>;
    wall_hours: number;
    busy_hours?: number;
    avg_human_len: number;
    prompts_sample: PromptSampleItem[];
    prompt_eval_summary?: {
        avg_prompt_score: number;
        weak_prompt_count: number;
        mergeable_count: number;
        ai_scored_count: number;
        top_prompt_lesson?: string;
        focus_habit?: FocusHabitItem;
        stage_counts?: Record<string, number>;
    };
    ai_analysis: AiSessionAnalysis;
    updated_at: string;
}

interface DayDetailSessionItem extends CoachSessionSummary {
    session_id: string;
    cwd: string;
    is_sub: boolean;
    day_raw_msgs: number;
    day_auto_msgs: number;
    day_short_nudges: number;
    day_vague_errors: number;
    day_corr_kw: number;
    wall_hours: number;
    n_raw_msgs: number;
    n_auto_msgs: number;
    prompts_on_day: PromptSampleItem[];
}

interface DayDetailResponse {
    ok: boolean;
    day: string;
    summary: {
        day: string;
        direct_prompts: number;
        bg_prompts: number;
        auto_ignored: number;
        direct_sessions: number;
        bg_sessions: number;
        active_hours: number;
        over_limit_sessions: number;
        compliant_sessions: number;
        short_nudges: number;
        vague_errors: number;
        corr_kw: number;
        efficiency_score: number;
        avg_prompts_per_session: number;
    };
    by_tool: Record<
        string,
        {
            direct_prompts: number;
            bg_prompts: number;
            direct_sessions: number;
            bg_sessions: number;
            active_hours: number;
        }
    >;
    daily_ai?: Record<string, any> | null;
    sessions: DayDetailSessionItem[];
}

interface PatternRecItem {
    code: string;
    label: string;
    tip: string;
    severity: string;
    count: number;
    prompts_impacted: number;
}

interface SavedPromptItem {
    id: number;
    title: string;
    category: string;
    tool: string;
    weak_example: string;
    prompt_template: string;
    notes: string;
    use_count: number;
    created_at: string;
}

interface TodayAlertItem {
    session_key: string;
    tool: string;
    title: string;
    n_human_prompts: number;
    clean_active_hours: number;
    level: 'red' | 'amber';
}

interface CoachDashboardResponse {
    ok: boolean;
    period: string;
    period_label: string;
    today: string;
    tool: string;
    settings: CoachSettings;
    totals: {
        direct_prompts: number;
        bg_prompts: number;
        auto_ignored: number;
        direct_sessions: number;
        bg_sessions: number;
        active_hours: number;
        avg_prompts_per_session: number;
        compliance_pct: number;
        avg_score: number;
        avg_prompt_score?: number;
        weak_prompts_count?: number;
        over_limit_sessions: number;
        compliant_sessions: number;
        est_savable_prompts: number;
        short_nudges: number;
        vague_errors: number;
        corr_kw: number;
        total_tool_calls?: number;
        tool_error_count?: number;
        redirection_count?: number;
        by_tool?: Record<string, { prompts: number; sessions: number; hours: number }>;
    };
    focus_habit?: FocusHabitItem;
    stage_breakdown?: Array<{ stage: string; label: string; count: number }>;
    days: DayBreakdownRow[];
    sessions: CoachSessionSummary[];
    total_matching_sessions: number;
    pattern_recommendations: PatternRecItem[];
    prompt_lesson_spotlight?: PromptLessonSpotlightItem[];
    today_alerts: TodayAlertItem[];
    saved_prompts: SavedPromptItem[];
    realtime_report?: RealtimeExecutiveReport;
    ai_realtime?: {
        enabled: boolean;
        eligible_total: number;
        analyzed_fresh: number;
        analyzed_any: number;
        pending: number;
        queued: number;
        inflight: number;
    };
    sync_status: {
        last_pc_sync_at: string;
        last_pc_duration_s: string;
        min_day: string | null;
        max_day: string | null;
        total_days_tracked: number;
    };
}

interface ClarifyingQuestionItem {
    id: string;
    question: string;
    placeholder?: string;
    suggestions?: string[];
}

interface DraftOptimizeResult {
    ok: boolean;
    ai_used: boolean;
    ai_note?: string;
    model?: string;
    stage?: string;
    stage_label?: string;
    score_before: number;
    checklist: PromptCheckItem[];
    dimension_scores?: Record<string, number>;
    safety_warning?: boolean;
    clarifying_questions?: ClarifyingQuestionItem[];
    refine_mode?: string;
    variables?: string[];
    weaknesses: string[];
    compact_prompt: string;
    full_spec_prompt: string;
    estimated_prompts_saved: string;
}

interface DraftCompareResult {
    ok: boolean;
    ai_used: boolean;
    ai_note?: string;
    model?: string;
    score_a: number;
    score_b: number;
    a_plan: {
        est_turns: string;
        ambiguities: string[];
        predicted_questions_or_errors: string[];
        plan_steps: string[];
    };
    b_plan: {
        est_turns: string;
        advantages: string[];
        predicted_tool_flow: string[];
        plan_steps: string[];
    };
    winner_summary: string;
}

interface PromptTableRowItem {
    session_key: string;
    session_title: string;
    project: string;
    tool: 'antigravity' | 'claude' | 'codex' | string;
    is_sub: boolean;
    session_rule_score: number;
    has_ai_analysis: boolean;
    idx: number;
    ts_iso: string;
    day: string;
    chars: number;
    gap_min: number;
    stage: string;
    stage_label: string;
    score: number;
    level: 'green' | 'amber' | 'red' | string;
    verdict: string;
    ai_scored: boolean;
    dimension_scores: Record<string, number>;
    checks: PromptCheckItem[];
    tools_triggered: string[];
    tool_call_count: number;
    had_tool_error: boolean;
    assistant_err_snippet?: string;
    turn_duration_s?: number | null;
    assistant_summary?: string;
    files_touched?: string[];
    failed_tools?: string[];
    root_cause_type?: string;
    merge_with?: number[];
    is_short_nudge?: boolean;
    is_vague_error?: boolean;
    is_corr_kw?: boolean;
    is_question_reply?: boolean;
    has_image?: boolean;
    text_redacted: string;
    lesson: string;
    improved_prompt: string;
}

interface PromptTableResponse {
    ok: boolean;
    period: string;
    period_label: string;
    start_day?: string | null;
    end_day?: string | null;
    tool: string;
    total: number;
    page: number;
    limit: number;
    total_pages: number;
    summary: {
        total_prompts: number;
        avg_score: number;
        green_count: number;
        amber_count: number;
        red_count: number;
        tool_error_count: number;
        ai_scored_count: number;
        mergeable_count: number;
        dimension_avgs: Record<string, number>;
    };
    facets: {
        total_unfiltered: number;
        green_count: number;
        amber_count: number;
        red_count: number;
        tool_error_count: number;
        stage_counts: Array<{ stage: string; label: string; count: number }>;
        dim_weak_counts: Record<string, number>;
    };
    items: PromptTableRowItem[];
}

export type ExternalUsagePeriod = 'day' | 'yesterday' | 'week' | 'month' | 'all' | 'date';

export interface AdminPromptCoachSectionProps {
    apiKey?: string;
    onNavigateTab?: (tab: PortalTab) => void;
    onDispatchToA1?: (promptText: string) => void;
    externalUsagePeriod?: ExternalUsagePeriod;
    externalFilterDate?: string;
    onSyncUsagePeriod?: (period: ExternalUsagePeriod, dateStr?: string) => void;
}

type PeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'date';
type SubViewKey = 'realtime' | 'overview' | 'ag_pc' | 'prompts' | 'sessions' | 'optimizer' | 'library';
type SortByKey = 'priority' | 'period_prompts' | 'recent' | 'total_prompts' | 'hours_waste';
type PromptTableSortKey = 'newest' | 'score_asc' | 'score_desc' | 'chars_desc' | 'errors_first';
type KpiFilterKey = 'all' | 'over_limit' | 'savable';

const RUBRIC_DIMENSIONS: Array<{
    key: string;
    short: string;
    label: string;
    hint: string;
}> = [
    { key: 'goal', short: 'MT', label: 'Mục tiêu', hint: 'Nêu rõ kết quả hoặc đầu việc cần đạt' },
    { key: 'context', short: 'NC', label: 'Ngữ cảnh/File', hint: 'Chỉ rõ file, route, URL, log hoặc bảng' },
    { key: 'boundaries', short: 'RG', label: 'Ranh giới', hint: 'Khoanh vùng phần được phép / không được sửa' },
    { key: 'constraints', short: 'RB', label: 'Ràng buộc', hint: 'Điều kiện kỹ thuật, bảo mật, git, style' },
    { key: 'output_format', short: 'ĐR', label: 'Định dạng', hint: 'Cấu trúc kết quả đầu ra mong muốn' },
    { key: 'verification', short: 'KC', label: 'Kiểm chứng', hint: 'Tiêu chí Done: test, build, đo thật' },
    { key: 'safety', short: 'AT', label: 'An toàn', hint: 'Rào backup/dry-run khi đụng DB/Deploy' },
];

const FLAG_CODE_LABELS: Record<string, string> = {
    VUOT_NGUONG_PROMPT: 'Vượt ngưỡng > 12 prompt',
    PHIEN_KEO_DAI_GIO: 'Kéo dài >= 2 giờ thực',
    PHIEN_KEO_QUA_NGAY: 'Phiên kéo qua nhiều ngày',
    NHAC_NGAN_ROI_RAC: 'Nhắc ngắn rời rạc',
    BAO_LOI_THIEU_LOG: 'Báo lỗi thiếu log',
    MO_DAU_QUA_NGAN: 'Mở đầu quá ngắn',
    SUA_LAI_NHIEU_LAN: 'Sửa lại nhiều lần',
    SUA_CHUYEN_HUONG: 'Chuyển hướng giữa phiên',
    TOOL_LOI_LAP: 'Lỗi Tool lặp lại',
    AI_TU_CHU_CAO: 'AI tự chủ cao',
};

const ROOT_CAUSE_LABELS: Record<string, string> = {
    prompt_ambiguous: 'Nguyên nhân HRPO: Prompt mơ hồ',
    missing_safety: 'Nguyên nhân HRPO: Thiếu rào an toàn',
    environment_error: 'Nguyên nhân HRPO: Lỗi môi trường / Tool',
    context_drift: 'Nguyên nhân HRPO: Trôi ngữ cảnh phiên dài',
};

const STAGE_PILL_CLS: Record<string, string> = {
    exploration: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800/60',
    diagnosis: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60',
    execution: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800/60',
    verification: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60',
    reusable_workflow: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800/60',
    action: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60',
};

function extractTemplateVariables(template: string): string[] {
    const vars: string[] = [];
    const re = /\{\{([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF -]{1,40})\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(template || '')) !== null) {
        const v = m[1].trim();
        if (v && !vars.includes(v)) vars.push(v);
    }
    return vars.slice(0, 10);
}

function substituteTemplateVariables(template: string, values: Record<string, string>): string {
    return (template || '').replace(
        /\{\{([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF -]{1,40})\}\}/g,
        (full, rawKey) => {
            const k = String(rawKey || '').trim();
            const val = (values[k] || '').trim();
            return val ? val : full;
        }
    );
}

function usageToCoachPeriod(u?: ExternalUsagePeriod): PeriodKey {
    if (u === 'day') return 'today';
    if (u === 'yesterday') return 'yesterday';
    if (u === 'week') return '7d';
    if (u === 'month') return '30d';
    if (u === 'all') return 'all';
    if (u === 'date') return 'date';
    return 'today';
}

function coachToUsagePeriod(p: PeriodKey): ExternalUsagePeriod {
    if (p === 'today') return 'day';
    if (p === 'yesterday') return 'yesterday';
    if (p === '7d') return 'week';
    if (p === '30d') return 'month';
    if (p === 'all') return 'all';
    return 'date';
}

function formatCleanSessionTitle(title?: string, preview?: string, sessionKey?: string): string {
    let raw = (title || preview || sessionKey || '').replace(/\s+/g, ' ').trim();
    if (!raw) return 'Phiên chưa đặt tên';
    raw = raw
        .replace(
            /The prompt could not be submitted\.\s*This conversation has reached its maximum length[^.!?\n]*[.!?]?/gi,
            ''
        )
        .trim();
    if (!raw && preview) {
        raw = preview.replace(/\s+/g, ' ').trim();
    }
    raw = raw.replace(/https?:\/\/[^\s)>\]"']+/gi, matchedUrl => {
        try {
            const host = new URL(matchedUrl).hostname.replace(/^www\./i, '');
            return `[link ${host}]`;
        } catch {
            return '[link]';
        }
    });
    raw = raw.replace(/\s+/g, ' ').trim();
    if (!raw) return sessionKey || 'Phiên chưa đặt tên';
    return raw.length > 110 ? `${raw.slice(0, 108)}…` : raw;
}

const TOOL_LABELS: Record<string, { label: string; badgeCls: string }> = {
    antigravity: {
        label: 'Antigravity',
        badgeCls: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800/60',
    },
    claude: {
        label: 'Claude Code',
        badgeCls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60',
    },
    codex: {
        label: 'Codex',
        badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60',
    },
};

function genUuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = (Math.random() * 16) | 0;
        const v = ch === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function formatSyncTime(isoStr: string): string {
    if (!isoStr) return 'Chưa có dữ liệu đồng bộ PC';
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    });
}

function severityPill(sev: string): { cls: string; text: string } {
    if (sev === 'red') {
        return {
            cls: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60',
            text: 'Vượt ngưỡng',
        };
    }
    if (sev === 'amber') {
        return {
            cls: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60',
            text: 'Cần lưu ý',
        };
    }
    return {
        cls: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60',
        text: 'Đạt chuẩn',
    };
}

function promptScoreBadgeCls(score: number): string {
    if (score >= 80) {
        return 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800/60';
    }
    if (score >= 55) {
        return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800/60';
    }
    return 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800/60';
}

export const AdminPromptCoachSection: React.FC<AdminPromptCoachSectionProps> = ({
    apiKey,
    onNavigateTab,
    onDispatchToA1,
    externalUsagePeriod,
    externalFilterDate,
    onSyncUsagePeriod,
}) => {
    const initialPeriod: PeriodKey = externalUsagePeriod ? usageToCoachPeriod(externalUsagePeriod) : '7d';
    const [subView, setSubView] = useState<SubViewKey>('overview');
    const [period, setPeriod] = useState<PeriodKey>(initialPeriod);
    const [customDate, setCustomDate] = useState<string>(() =>
        externalUsagePeriod === 'date' ? externalFilterDate || '' : ''
    );
    const [toolFilter, setToolFilter] = useState<string>('all');
    const [includeSub, setIncludeSub] = useState<boolean>(true);

    const [loading, setLoading] = useState<boolean>(true);
    const [refreshing, setRefreshing] = useState<boolean>(false);
    const [pcSyncing, setPcSyncing] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [dash, setDash] = useState<CoachDashboardResponse | null>(null);

    // Settings panel
    const [showSettings, setShowSettings] = useState<boolean>(false);
    const [maxPromptsInput, setMaxPromptsInput] = useState<number>(12);
    const [maxHoursInput, setMaxHoursInput] = useState<number>(2.0);
    const [maxCorrInput, setMaxCorrInput] = useState<number>(10);
    const [autoAnalyzeInput, setAutoAnalyzeInput] = useState<boolean>(true);
    const [savingSettings, setSavingSettings] = useState<boolean>(false);
    const [batchAnalyzing, setBatchAnalyzing] = useState<boolean>(false);

    // Session filters, sorting & inspector modal
    const [sessionQuery, setSessionQuery] = useState<string>('');
    const [sessionSearchScope, setSessionSearchScope] = useState<'all' | 'period'>('all');
    const [sessionServerItems, setSessionServerItems] = useState<CoachSessionSummary[]>([]);
    const [sessionServerTotal, setSessionServerTotal] = useState<number>(0);
    const [sessionServerLoading, setSessionServerLoading] = useState<boolean>(false);
    const [severityFilter, setSeverityFilter] = useState<'all' | 'red' | 'amber' | 'green'>('all');
    const [flagFilter, setFlagFilter] = useState<string>('all');
    const [kpiFilter, setKpiFilter] = useState<KpiFilterKey>('all');
    const [sortBy, setSortBy] = useState<SortByKey>(() =>
        initialPeriod === 'today' || initialPeriod === 'yesterday' || initialPeriod === 'date'
            ? 'period_prompts'
            : 'priority'
    );
    const [userPickedSort, setUserPickedSort] = useState<boolean>(false);
    const [kpiFocus, setKpiFocus] = useState<'none' | 'prompts' | 'compliance' | 'hours' | 'savable'>('none');
    const [inspectKey, setInspectKey] = useState<string | null>(null);
    const [inspectDetail, setInspectDetail] = useState<CoachSessionDetail | null>(null);
    const [inspectLoading, setInspectLoading] = useState<boolean>(false);
    const [analyzingAiKey, setAnalyzingAiKey] = useState<string | null>(null);
    const [promptFilterMode, setPromptFilterMode] = useState<'all' | 'weak' | 'merge' | 'flagged' | 'over_threshold' | 'good'>('all');
    const [returnSessionKey, setReturnSessionKey] = useState<string | null>(null);
    const [returnSubView, setReturnSubView] = useState<'sessions' | 'ag_pc'>('sessions');
    const [expandedCardSessions, setExpandedCardSessions] = useState<Record<string, boolean>>({});
    const [focusPromptIdx, setFocusPromptIdx] = useState<number | null>(null);
    const [highlightedPromptIdx, setHighlightedPromptIdx] = useState<number | null>(null);
    const [inlineOptLoadingKey, setInlineOptLoadingKey] = useState<string | null>(null);
    const [inlineOptResults, setInlineOptResults] = useState<Record<string, DraftOptimizeResult>>({});
    const [expandedFullRewrites, setExpandedFullRewrites] = useState<Record<string, boolean>>({});
    const [showSessionsSpotlight, setShowSessionsSpotlight] = useState<boolean>(true);
    const sessionsListRef = useRef<HTMLDivElement | null>(null);

    // Two-way sync with PortalSidebar period selector
    useEffect(() => {
        if (!externalUsagePeriod) return;
        const mapped = usageToCoachPeriod(externalUsagePeriod);
        setPeriod(prev => (prev === mapped ? prev : mapped));
        if (externalUsagePeriod === 'date' && externalFilterDate) {
            setCustomDate(prev => (prev === externalFilterDate ? prev : externalFilterDate));
        } else if (externalUsagePeriod !== 'date') {
            setCustomDate(prev => (prev === '' ? prev : ''));
        }
    }, [externalUsagePeriod, externalFilterDate]);

    useEffect(() => {
        if (userPickedSort) return;
        const defaultSort: SortByKey =
            period === 'today' || period === 'yesterday' || period === 'date' ? 'period_prompts' : 'priority';
        setSortBy(prev => (prev === defaultSort ? prev : defaultSort));
    }, [period, userPickedSort]);

    const handleChangePeriod = useCallback(
        (nextP: PeriodKey, nextDate?: string) => {
            setPeriod(nextP);
            setAgPcSessionKey(null);
            if (nextP === 'date' && typeof nextDate === 'string') {
                setCustomDate(nextDate);
            } else if (nextP !== 'date') {
                setCustomDate('');
            }
            if (onSyncUsagePeriod) {
                onSyncUsagePeriod(coachToUsagePeriod(nextP), nextP === 'date' ? nextDate : undefined);
            }
        },
        [onSyncUsagePeriod]
    );

    const scrollToSessionsList = useCallback(() => {
        setSubView('sessions');
        window.setTimeout(() => {
            sessionsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    }, []);
    const [promptDayFilter, setPromptDayFilter] = useState<string>('all');
    const [promptSearch, setPromptSearch] = useState<string>('');
    const [expandedPromptIdx, setExpandedPromptIdx] = useState<number | null>(null);

    // Day detail modal
    const [dayModalDate, setDayModalDate] = useState<string | null>(null);
    const [dayModalData, setDayModalData] = useState<DayDetailResponse | null>(null);
    const [dayModalLoading, setDayModalLoading] = useState<boolean>(false);
    const [dayModalTool, setDayModalTool] = useState<string>('all');
    const [dayModalSubTab, setDayModalSubTab] = useState<'direct' | 'bg' | 'all'>('direct');
    const [dayModalSearch, setDayModalSearch] = useState<string>('');
    const [expandedDaySessKey, setExpandedDaySessKey] = useState<string | null>(null);

    // Realtime auto-refresh state
    const [realtimeAuto, setRealtimeAuto] = useState<boolean>(true);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<number>(() => Date.now());
    const [secondsAgo, setSecondsAgo] = useState<number>(0);

    // Draft Prompt Optimizer
    const [draftText, setDraftText] = useState<string>('');
    const [draftTool, setDraftTool] = useState<string>('all');
    const [draftGoalType, setDraftGoalType] = useState<string>('feature');
    const [draftFiles, setDraftFiles] = useState<string>('');
    const [optimizingDraft, setOptimizingDraft] = useState<boolean>(false);
    const [draftResult, setDraftResult] = useState<DraftOptimizeResult | null>(null);
    const [clarifyAnswers, setClarifyAnswers] = useState<Record<string, string>>({});
    const [activeRefineMode, setActiveRefineMode] = useState<string>('');
    const [comparingDraft, setComparingDraft] = useState<boolean>(false);
    const [compareResult, setCompareResult] = useState<DraftCompareResult | null>(null);

    // Private Saved Library
    const [libSearch, setLibSearch] = useState<string>('');
    const [newPromptTitle, setNewPromptTitle] = useState<string>('');
    const [newPromptCat, setNewPromptCat] = useState<string>('feature');
    const [newPromptTool, setNewPromptTool] = useState<string>('all');
    const [newPromptBody, setNewPromptBody] = useState<string>('');
    const [savingLibPrompt, setSavingLibPrompt] = useState<boolean>(false);
    const [libVarValues, setLibVarValues] = useState<Record<number, Record<string, string>>>({});
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Prompts Table Explorer Tab & Side Drawer
    const [promptsData, setPromptsData] = useState<PromptTableResponse | null>(null);
    const [promptsLoading, setPromptsLoading] = useState<boolean>(false);
    const [promptsError, setPromptsError] = useState<string>('');
    const [tableSearch, setTableSearch] = useState<string>('');
    const [tableSearchDebounced, setTableSearchDebounced] = useState<string>('');
    const [tableStage, setTableStage] = useState<string>('all');
    const [tableLevel, setTableLevel] = useState<'all' | 'green' | 'amber' | 'red'>('all');
    const [tableWeakDim, setTableWeakDim] = useState<string>('all');
    const [tableOnlyErrors, setTableOnlyErrors] = useState<boolean>(false);
    const [tableSort, setTableSort] = useState<PromptTableSortKey>('newest');
    const [tablePage, setTablePage] = useState<number>(1);
    const [tableLimit, setTableLimit] = useState<number>(30);
    const [selectedPromptIdxInPage, setSelectedPromptIdxInPage] = useState<number | null>(null);
    const [drawerCompareLoadingKey, setDrawerCompareLoadingKey] = useState<string | null>(null);
    const [drawerCompareMap, setDrawerCompareMap] = useState<Record<string, DraftCompareResult>>({});
    const [exportingCsv, setExportingCsv] = useState<boolean>(false);
    const [agPcSessionKey, setAgPcSessionKey] = useState<string | null>(null);
    const [agPcFocusTurnIdx, setAgPcFocusTurnIdx] = useState<number | null>(null);

    const openInAntigravityPc = useCallback((skey?: string, turnIdx?: number | null) => {
        if (skey) setAgPcSessionKey(skey);
        setAgPcFocusTurnIdx(turnIdx ?? null);
        setInspectKey(null);
        setSelectedPromptIdxInPage(null);
        setDayModalDate(null);
        setSubView('ag_pc');
    }, []);

    const resolveAuthHeaders = useCallback((): Record<string, string> => {
        const persisted = readPersistedAdminToken();
        const tk = (apiKey || persisted || '').trim();
        if (!tk) return {};
        return {
            Authorization: `Bearer ${tk}`,
            'x-api-key': tk,
        };
    }, [apiKey]);

    const handleCopy = async (text: string, idTag: string, label = 'Đã copy nội dung!') => {
        await copyToClipboard(text);
        setCopiedId(idTag);
        showToast(label, 'success');
        setTimeout(() => setCopiedId(prev => (prev === idTag ? null : prev)), 1800);
    };

    const loadDashboard = useCallback(
        async (silent = false) => {
            if (silent) setRefreshing(true);
            else setLoading(true);
            setErrorMsg('');
            try {
                const params = new URLSearchParams({
                    period,
                    tool: toolFilter,
                    include_sub: includeSub ? '1' : '0',
                });
                if (period === 'date' && customDate) {
                    params.set('date', customDate);
                }
                const res = await fetch(`/api/owner/prompt-coach/dashboard?${params.toString()}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    cache: 'no-store',
                });
                const doc = (await res.json().catch(() => ({}))) as CoachDashboardResponse & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || `Không thể tải dữ liệu A12 (HTTP ${res.status}).`);
                }
                setDash(doc);
                setLastRefreshedAt(Date.now());
                setSecondsAgo(0);
                if (doc.settings) {
                    setMaxPromptsInput(doc.settings.max_prompts_per_session || 12);
                    setMaxHoursInput(doc.settings.max_hours_per_session || 2.0);
                    setMaxCorrInput(doc.settings.max_correction_pct || 10);
                    setAutoAnalyzeInput(doc.settings.auto_analyze_ai !== false);
                }
            } catch (err: any) {
                if (!silent) {
                    setErrorMsg(err?.message || 'Lỗi kết nối kho tối ưu Prompt.');
                }
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [period, customDate, toolFilter, includeSub, resolveAuthHeaders]
    );

    const openDayModal = useCallback(
        async (dayStr: string, silent = false) => {
            setDayModalDate(dayStr);
            if (!silent) {
                setDayModalLoading(true);
                setDayModalTool('all');
                setDayModalSubTab('direct');
                setDayModalSearch('');
                setExpandedDaySessKey(null);
            }
            try {
                const res = await fetch(
                    `/api/owner/prompt-coach/day/${encodeURIComponent(dayStr)}?tool=all&include_sub=1`,
                    {
                        headers: resolveAuthHeaders(),
                        credentials: 'same-origin',
                        cache: 'no-store',
                    }
                );
                const doc = (await res.json().catch(() => ({}))) as DayDetailResponse & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || `Không tải được chi tiết ngày ${dayStr}.`);
                }
                setDayModalData(doc);
            } catch (err: any) {
                if (!silent) {
                    showToast(err?.message || `Lỗi mở chi tiết ngày ${dayStr}.`, 'error');
                }
            } finally {
                if (!silent) setDayModalLoading(false);
            }
        },
        [resolveAuthHeaders]
    );

    useEffect(() => {
        const tm = window.setTimeout(() => {
            setTableSearchDebounced(prev => (prev === tableSearch ? prev : tableSearch));
        }, 280);
        return () => window.clearTimeout(tm);
    }, [tableSearch]);

    useEffect(() => {
        setTablePage(1);
        setSelectedPromptIdxInPage(null);
    }, [
        period,
        customDate,
        toolFilter,
        includeSub,
        tableSearchDebounced,
        tableStage,
        tableLevel,
        tableWeakDim,
        tableOnlyErrors,
        tableSort,
        tableLimit,
    ]);

    const buildPromptsQueryParams = useCallback(
        (pageOverride?: number, limitOverride?: number) => {
            const params = new URLSearchParams({
                period,
                tool: toolFilter,
                include_sub: includeSub ? '1' : '0',
                stage: tableStage,
                level: tableLevel,
                weak_dim: tableWeakDim,
                only_errors: tableOnlyErrors ? '1' : '0',
                sort: tableSort,
                page: String(pageOverride ?? tablePage),
                limit: String(limitOverride ?? tableLimit),
            });
            if (period === 'date' && customDate) {
                params.set('date', customDate);
            }
            if (tableSearchDebounced.trim()) {
                params.set('q', tableSearchDebounced.trim());
            }
            return params;
        },
        [
            period,
            customDate,
            toolFilter,
            includeSub,
            tableStage,
            tableLevel,
            tableWeakDim,
            tableOnlyErrors,
            tableSort,
            tablePage,
            tableLimit,
            tableSearchDebounced,
        ]
    );

    const loadPromptsTable = useCallback(
        async (silent = false) => {
            if (!silent) setPromptsLoading(true);
            setPromptsError('');
            try {
                const params = buildPromptsQueryParams();
                const res = await fetch(`/api/owner/prompt-coach/prompts?${params.toString()}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    cache: 'no-store',
                });
                const doc = (await res.json().catch(() => ({}))) as PromptTableResponse & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || `Không tải được bảng Prompt (HTTP ${res.status}).`);
                }
                setPromptsData(doc);
            } catch (err: any) {
                if (!silent) {
                    setPromptsError(err?.message || 'Lỗi tải bảng thống kê Prompt.');
                }
            } finally {
                if (!silent) setPromptsLoading(false);
            }
        },
        [buildPromptsQueryParams, resolveAuthHeaders]
    );

    useEffect(() => {
        if (subView === 'prompts') {
            void loadPromptsTable(false);
        }
    }, [subView, loadPromptsTable]);

    const handleDrawerCompareAB = useCallback(
        async (row: PromptTableRowItem, optimizedPrompt: string) => {
            const cKey = `${row.session_key}:${row.idx}`;
            if (drawerCompareLoadingKey === cKey) return;
            setDrawerCompareLoadingKey(cKey);
            try {
                const res = await fetch('/api/owner/prompt-coach/compare-draft', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveAuthHeaders(),
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        original_draft: row.text_redacted,
                        optimized_prompt: optimizedPrompt,
                        tool: row.tool || 'all',
                        goal_type: row.stage === 'diagnosis' ? 'bugfix' : 'feature',
                    }),
                });
                const doc = (await res.json().catch(() => ({}))) as DraftCompareResult & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || 'Không chạy được so sánh Dry-Run A/B.');
                }
                setDrawerCompareMap(prev => ({ ...prev, [cKey]: doc }));
                showToast(`Đã so sánh Dry-Run A/B cho Prompt #${row.idx}!`, 'success');
            } catch (err: any) {
                showToast(err?.message || 'Lỗi giả lập A/B cho câu prompt.', 'error');
            } finally {
                setDrawerCompareLoadingKey(prev => (prev === cKey ? null : prev));
            }
        },
        [drawerCompareLoadingKey, resolveAuthHeaders]
    );

    const handleExportPromptsCsv = useCallback(async () => {
        if (exportingCsv) return;
        setExportingCsv(true);
        try {
            const params = buildPromptsQueryParams(1, 100);
            const res = await fetch(`/api/owner/prompt-coach/prompts?${params.toString()}`, {
                headers: resolveAuthHeaders(),
                credentials: 'same-origin',
                cache: 'no-store',
            });
            const doc = (await res.json().catch(() => ({}))) as PromptTableResponse & { error?: string };
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'Không xuất được danh sách prompt.');
            }
            const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const headers = [
                'Ngày',
                'Thời gian',
                'Công cụ AI',
                'Dự án',
                'Phiên',
                'STT',
                'Giai đoạn',
                'Điểm',
                'Mức độ',
                'Nhận xét',
                'Điểm 7 Chiều (MT/NC/RG/RB/ĐR/KC/AT)',
                'Lỗi Tool',
                'Prompt Gốc',
                'Bài Học Đánh Giá',
                'Gợi Ý Tối Ưu 1-Phát',
            ];
            const rowsCsv = (doc.items || []).map(it => {
                const ds = it.dimension_scores || {};
                const dimStr = RUBRIC_DIMENSIONS.map(d => `${d.short}:${ds[d.key] ?? '-'}`).join(' | ');
                return [
                    it.day,
                    it.ts_iso ? it.ts_iso.replace('T', ' ').slice(0, 19) : '',
                    it.tool,
                    it.project,
                    it.session_title,
                    `#${it.idx}`,
                    it.stage_label,
                    it.score,
                    it.level,
                    it.verdict,
                    dimStr,
                    it.had_tool_error ? 'Có' : 'Không',
                    it.text_redacted,
                    it.lesson,
                    it.improved_prompt,
                ]
                    .map(esc)
                    .join(',');
            });
            const csvBody = '\uFEFF' + [headers.map(esc).join(','), ...rowsCsv].join('\r\n');
            const blob = new Blob([csvBody], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `aihot-prompt-table-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(`Đã xuất ${doc.items?.length || 0} dòng Prompt ra file CSV!`, 'success');
        } catch (err: any) {
            showToast(err?.message || 'Lỗi xuất CSV.', 'error');
        } finally {
            setExportingCsv(false);
        }
    }, [buildPromptsQueryParams, exportingCsv, period, resolveAuthHeaders]);

    useEffect(() => {
        loadDashboard(false);
    }, [loadDashboard]);

    useEffect(() => {
        if (!inspectKey && selectedPromptIdxInPage === null && !dayModalDate) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (inspectKey) setInspectKey(null);
                else if (selectedPromptIdxInPage !== null) setSelectedPromptIdxInPage(null);
                else if (dayModalDate) setDayModalDate(null);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [inspectKey, selectedPromptIdxInPage, dayModalDate]);

    const triggerSessionAiAnalysis = useCallback(
        async (
            skey: string,
            force = false,
            currentDetail?: CoachSessionDetail | null,
            quiet = false
        ) => {
            setAnalyzingAiKey(skey);
            try {
                const res = await fetch('/api/owner/prompt-coach/analyze-session', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveAuthHeaders(),
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({ session_key: skey, force }),
                });
                const doc = await res.json().catch(() => ({}));
                if (!res.ok || !doc.ok || !doc.ai_analysis) {
                    throw new Error(doc.error || 'AI chưa phân tích được phiên này.');
                }
                setInspectDetail(prev =>
                    prev && prev.session_key === skey
                        ? { ...prev, ai_analysis: doc.ai_analysis, ai_is_fresh: true, ai_analyzing: false }
                        : !prev && currentDetail && currentDetail.session_key === skey
                          ? { ...currentDetail, ai_analysis: doc.ai_analysis, ai_is_fresh: true, ai_analyzing: false }
                          : prev
                );
                setDash(prev =>
                    prev
                        ? {
                              ...prev,
                              sessions: prev.sessions.map(s =>
                                  s.session_key === skey
                                      ? {
                                            ...s,
                                            has_ai_analysis: true,
                                            ai_is_fresh: true,
                                            ai_analyzing: false,
                                            ai_summary: doc.ai_analysis.diagnosis || s.ai_summary,
                                            ai_takeaway: doc.ai_analysis.key_takeaway || s.ai_takeaway,
                                            ai_analyzed_at: doc.ai_analysis.analyzed_at || s.ai_analyzed_at,
                                        }
                                      : s
                              ),
                          }
                        : prev
                );
                if (!quiet) {
                    showToast(
                        doc.cached ? 'Đã nạp phân tích AI từ bộ nhớ đệm!' : 'AI đã chấm điểm xong từng câu trong phiên!',
                        'success'
                    );
                }
                // Re-fetch merged per-prompt scores from backend & refresh dashboard spotlight
                void fetch(`/api/owner/prompt-coach/session/${encodeURIComponent(skey)}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    cache: 'no-store',
                })
                    .then(r => r.json())
                    .then(d => {
                        if (d?.ok && d?.session) {
                            setInspectDetail(prev => (prev && prev.session_key === skey ? d.session : prev));
                        }
                    })
                    .catch(() => {});
                void loadDashboard(true);
            } catch (err: any) {
                if (!quiet) {
                    showToast(err?.message || 'Lỗi phân tích AI.', 'error');
                }
            } finally {
                setAnalyzingAiKey(prev => (prev === skey ? null : prev));
            }
        },
        [resolveAuthHeaders, loadDashboard]
    );

    const openSessionInspector = useCallback(
        async (
            skey: string,
            autoAnalyze = false,
            silent = false,
            initialDay = 'all',
            focusIdx: number | null = null
        ) => {
            setInspectKey(skey);
            if (!silent) {
                setInspectDetail(null);
                setInspectLoading(true);
                setPromptFilterMode('all');
                setPromptDayFilter(initialDay);
                setPromptSearch('');
                setExpandedPromptIdx(focusIdx);
                setFocusPromptIdx(focusIdx);
                setHighlightedPromptIdx(focusIdx);
            }
            try {
                const res = await fetch(`/api/owner/prompt-coach/session/${encodeURIComponent(skey)}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    cache: 'no-store',
                });
                const doc = await res.json().catch(() => ({}));
                if (!res.ok || !doc.ok || !doc.session) {
                    throw new Error(doc.error || 'Không tải được chi tiết phiên.');
                }
                setInspectDetail(doc.session);
                if (!silent) setInspectLoading(false);
                if (
                    autoAnalyze &&
                    (!doc.session.ai_analysis?.diagnosis || doc.session.ai_is_fresh === false) &&
                    (doc.session.prompts_sample?.length || 0) > 0
                ) {
                    void triggerSessionAiAnalysis(skey, false, doc.session, true);
                }
            } catch (err: any) {
                if (!silent) {
                    showToast(err?.message || 'Lỗi mở chi tiết phiên.', 'error');
                }
            } finally {
                if (!silent) setInspectLoading(false);
            }
        },
        [resolveAuthHeaders, triggerSessionAiAnalysis]
    );

    const handleInlineOptimizePrompt = useCallback(
        async (skey: string, idx: number, text: string, tool: string, _project?: string) => {
            const k = `${skey}:${idx}`;
            if (inlineOptLoadingKey === k) return;
            setInlineOptLoadingKey(k);
            try {
                const res = await fetch('/api/owner/prompt-coach/optimize-draft', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveAuthHeaders(),
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        draft: text,
                        tool: tool || 'all',
                        goal_type: 'feature',
                        target_files: '',
                    }),
                });
                const doc = (await res.json().catch(() => ({}))) as DraftOptimizeResult & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || 'Không viết lại được câu prompt này.');
                }
                setInlineOptResults(prev => ({ ...prev, [k]: doc }));
                showToast(`AI đã viết lại Spec 1-Phát cho Prompt #${idx}!`, 'success');
            } catch (err: any) {
                showToast(err?.message || 'Lỗi tối ưu câu prompt.', 'error');
            } finally {
                setInlineOptLoadingKey(prev => (prev === k ? null : prev));
            }
        },
        [inlineOptLoadingKey, resolveAuthHeaders]
    );

    useEffect(() => {
        if (!inspectDetail || focusPromptIdx === null) return;
        const timer = window.setTimeout(() => {
            const el = document.getElementById(`coach-prompt-row-${focusPromptIdx}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            setFocusPromptIdx(null);
        }, 90);
        const clearHi = window.setTimeout(() => {
            setHighlightedPromptIdx(null);
        }, 2800);
        return () => {
            window.clearTimeout(timer);
            window.clearTimeout(clearHi);
        };
    }, [inspectDetail, focusPromptIdx]);

    // Realtime 1s clock + 10s dashboard/modal auto-refresh + 20s silent PC Companion sync
    useEffect(() => {
        const secTimer = window.setInterval(() => {
            setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastRefreshedAt) / 1000)));
        }, 1000);
        return () => window.clearInterval(secTimer);
    }, [lastRefreshedAt]);

    const dashPollBusyRef = useRef<boolean>(false);
    const pcSyncPollBusyRef = useRef<boolean>(false);

    useEffect(() => {
        if (!realtimeAuto) return;
        const refreshAllSilent = async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            if (dashPollBusyRef.current) return;
            dashPollBusyRef.current = true;
            try {
                await loadDashboard(true);
                if (subView === 'prompts') {
                    void loadPromptsTable(true);
                }
                if (dayModalDate) {
                    openDayModal(dayModalDate, true);
                }
                if (inspectKey) {
                    openSessionInspector(inspectKey, false, true);
                }
            } finally {
                dashPollBusyRef.current = false;
            }
        };
        const dashIntervalMs = subView === 'ag_pc' ? 3500 : 10000;
        const pcSyncIntervalMs = subView === 'ag_pc' ? 6000 : 20000;
        const dashTimer = window.setInterval(() => {
            void refreshAllSilent();
        }, dashIntervalMs);
        const pcTimer = window.setInterval(async () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            if (pcSyncPollBusyRef.current) return;
            pcSyncPollBusyRef.current = true;
            try {
                const res = await fetch('/api/ag-companion/prompt-coach/sync', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveAuthHeaders(),
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({ full: false }),
                });
                const doc = await res.json().catch(() => ({}));
                if (res.ok && doc?.ok && Number(doc.upserted || 0) > 0) {
                    await refreshAllSilent();
                }
            } catch {
                // Silent ignore when PC bridge is offline
            } finally {
                pcSyncPollBusyRef.current = false;
            }
        }, pcSyncIntervalMs);

        const onVisOrFocus = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                void refreshAllSilent();
            }
        };
        window.addEventListener('focus', onVisOrFocus);
        document.addEventListener('visibilitychange', onVisOrFocus);
        return () => {
            window.clearInterval(dashTimer);
            window.clearInterval(pcTimer);
            window.removeEventListener('focus', onVisOrFocus);
            document.removeEventListener('visibilitychange', onVisOrFocus);
        };
    }, [realtimeAuto, subView, loadDashboard, loadPromptsTable, dayModalDate, openDayModal, inspectKey, openSessionInspector, resolveAuthHeaders]);

    // Adaptive 3s Realtime AI Coach streaming poll while background queue or open modal / Antigravity PC analysis is running
    const activeAgPcSummary =
        subView === 'ag_pc'
            ? (dash?.sessions || []).find(s => s.session_key === (agPcSessionKey || dash?.sessions?.[0]?.session_key))
            : undefined;
    const hasAiQueueWork =
        (dash?.ai_realtime?.inflight || 0) + (dash?.ai_realtime?.queued || 0) > 0 ||
        Boolean(inspectDetail?.ai_analyzing) ||
        Boolean(activeAgPcSummary?.ai_analyzing) ||
        Boolean(inspectKey && inspectDetail && inspectDetail.ai_is_fresh === false && (inspectDetail.prompts_sample?.length || 0) >= 2) ||
        Boolean(activeAgPcSummary && activeAgPcSummary.ai_is_fresh === false && activeAgPcSummary.n_human_prompts >= 2);

    useEffect(() => {
        if (!realtimeAuto || !hasAiQueueWork) return;
        const aiPollTimer = window.setInterval(() => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            void loadDashboard(true);
            if (inspectKey && (!inspectDetail?.ai_analysis?.diagnosis || inspectDetail?.ai_is_fresh === false)) {
                void openSessionInspector(inspectKey, false, true);
            }
        }, 3000);
        return () => window.clearInterval(aiPollTimer);
    }, [
        realtimeAuto,
        hasAiQueueWork,
        loadDashboard,
        inspectKey,
        inspectDetail?.ai_analysis?.diagnosis,
        inspectDetail?.ai_is_fresh,
        openSessionInspector,
    ]);

    const handleTriggerPcSync = async () => {
        setPcSyncing(true);
        try {
            const res = await fetch('/api/ag-companion/prompt-coach/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({ full: false }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || `PC Companion không phản hồi (HTTP ${res.status}).`);
            }
            showToast(
                `Đã đồng bộ ${doc.upserted ?? doc.total_records ?? 0} phiên từ PC (${doc.duration_s ?? '?'}s)!`,
                'success'
            );
            await loadDashboard(true);
        } catch (err: any) {
            showToast(
                err?.message ||
                    'Máy PC hiện đang ngoại tuyến hoặc cầu Companion tạm nghỉ — dữ liệu cũ trên VPS vẫn xem bình thường.',
                'info'
            );
        } finally {
            setPcSyncing(false);
        }
    };

    const handleSaveSettings = async () => {
        setSavingSettings(true);
        try {
            const res = await fetch('/api/owner/prompt-coach/settings', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    max_prompts_per_session: maxPromptsInput,
                    max_hours_per_session: maxHoursInput,
                    max_correction_pct: maxCorrInput,
                    auto_analyze_ai: autoAnalyzeInput,
                }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'Không lưu được cấu hình ngưỡng.');
            }
            showToast('Đã cập nhật ngưỡng mục tiêu & chấm điểm lại toàn bộ phiên!', 'success');
            setShowSettings(false);
            await loadDashboard(true);
        } catch (err: any) {
            showToast(err?.message || 'Lỗi lưu cấu hình.', 'error');
        } finally {
            setSavingSettings(false);
        }
    };

    const handleTriggerBatchAi = async () => {
        if (batchAnalyzing) return;
        setBatchAnalyzing(true);
        try {
            const res = await fetch('/api/owner/prompt-coach/analyze-batch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    period,
                    target_date: period === 'date' ? customDate : '',
                    tool: toolFilter,
                    limit: 4,
                    enqueue_remaining: true,
                }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'AI chưa quét hàng loạt được lúc này.');
            }
            const doneNow = Number(doc.analyzed_now || 0);
            const remEnq = Number(doc.remaining_enqueued || 0);
            if (doneNow > 0 || remEnq > 0) {
                showToast(
                    `AI Coach đã mổ xẻ xong ${doneNow} phiên${remEnq > 0 ? ` · đang chạy ngầm thêm ${remEnq} phiên realtime!` : '!'}`,
                    'success'
                );
            } else {
                showToast('Tất cả phiên đủ điều kiện trong kỳ đã có AI phân tích mới nhất!', 'info');
            }
            await loadDashboard(true);
        } catch (err: any) {
            showToast(err?.message || 'Lỗi chạy AI Realtime.', 'error');
        } finally {
            setBatchAnalyzing(false);
        }
    };

    const handleOptimizeDraft = useCallback(
        async (
            overrideDraft?: string | unknown,
            overrideTool?: string,
            refineModeOverride?: string,
            clarifyOverride?: Record<string, string>
        ) => {
            const textToUse = typeof overrideDraft === 'string' ? overrideDraft : draftText;
            const toolToUse = typeof overrideTool === 'string' ? overrideTool : draftTool;
            const rMode = typeof refineModeOverride === 'string' ? refineModeOverride : '';
            const clarMap = clarifyOverride !== undefined ? clarifyOverride : clarifyAnswers;
            if (textToUse.trim().length < 4) {
                showToast('Hãy nhập ít nhất 4 ký tự cho nháp Prompt.', 'error');
                return;
            }
            setOptimizingDraft(true);
            setActiveRefineMode(rMode);
            if (!rMode && clarifyOverride === undefined && typeof overrideDraft === 'string') {
                setCompareResult(null);
            }
            try {
                const res = await fetch('/api/owner/prompt-coach/optimize-draft', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...resolveAuthHeaders(),
                    },
                    credentials: 'same-origin',
                    body: JSON.stringify({
                        draft: textToUse,
                        tool: toolToUse,
                        goal_type: draftGoalType,
                        target_files: draftFiles,
                        clarifications: clarMap,
                        refine_mode: rMode,
                    }),
                });
                const doc = (await res.json().catch(() => ({}))) as DraftOptimizeResult & { error?: string };
                if (!res.ok || !doc.ok) {
                    throw new Error(doc.error || 'Không thể chấm điểm nháp Prompt.');
                }
                setDraftResult(doc);
                setCompareResult(null);
                showToast(
                    doc.ai_used ? 'AI đã chấm 6×7 Rubric & viết lại Prompt 1-Phát!' : 'Đã tạo bản Prompt chuẩn theo khung 6×7 Rubric!',
                    'success'
                );
            } catch (err: any) {
                showToast(err?.message || 'Lỗi tối ưu nháp prompt.', 'error');
            } finally {
                setOptimizingDraft(false);
            }
        },
        [draftText, draftTool, draftGoalType, draftFiles, clarifyAnswers, resolveAuthHeaders]
    );

    const handleCompareDraftAB = useCallback(async () => {
        if (!draftText.trim() || !draftResult?.compact_prompt) return;
        setComparingDraft(true);
        try {
            const res = await fetch('/api/owner/prompt-coach/compare-draft', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    original_draft: draftText,
                    optimized_prompt: draftResult.full_spec_prompt || draftResult.compact_prompt,
                    tool: draftTool,
                    goal_type: draftGoalType,
                }),
            });
            const doc = (await res.json().catch(() => ({}))) as DraftCompareResult & { error?: string };
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'Không chạy được so sánh Dry-Run A/B.');
            }
            setCompareResult(doc);
            showToast('Đã hoàn tất giả lập A/B Kế hoạch AI!', 'success');
        } catch (err: any) {
            showToast(err?.message || 'Lỗi chạy Dry-Run A/B.', 'error');
        } finally {
            setComparingDraft(false);
        }
    }, [draftText, draftResult, draftTool, draftGoalType, resolveAuthHeaders]);

    const navigateToOptimizerWithPrompt = useCallback(
        (promptText: string, tool: string, fromSessionKey?: string | null) => {
            const cleanText = promptText || '';
            const nextTool = tool || 'all';
            setDraftText(cleanText);
            setDraftTool(nextTool);
            setDraftResult(null);
            setReturnSessionKey(fromSessionKey || null);
            setReturnSubView(subView === 'ag_pc' ? 'ag_pc' : 'sessions');
            setInspectKey(null);
            setDayModalDate(null);
            setSubView('optimizer');
            if (cleanText.trim().length >= 4) {
                void handleOptimizeDraft(cleanText, nextTool);
            } else {
                showToast('Đã nạp câu vào Xưởng 1-Phát!', 'success');
            }
        },
        [handleOptimizeDraft, subView]
    );

    const handleSavePrivatePrompt = async (
        title: string,
        template: string,
        category = '1-shot',
        tool = 'all',
        weakExample = '',
        notes = ''
    ) => {
        try {
            const res = await fetch('/api/owner/prompt-coach/saved-prompts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    title,
                    prompt_template: template,
                    category,
                    tool,
                    weak_example: weakExample,
                    notes,
                }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'Không lưu được Prompt vào kho riêng.');
            }
            showToast('Đã lưu vào Bộ Prompt Chuẩn Riêng!', 'success');
            await loadDashboard(true);
            return true;
        } catch (err: any) {
            showToast(err?.message || 'Lỗi lưu Prompt chuẩn.', 'error');
            return false;
        }
    };

    const handleSaveToLessons = async (payload: {
        tieu_de: string;
        bai_hoc: string;
        cau_goc?: string;
        chuyen?: string;
        ap_dung?: string[];
    }) => {
        try {
            const res = await fetch('/api/owner/lessons', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    khoa: genUuid(),
                    nhom: 'Làm việc với AI',
                    tieu_de: payload.tieu_de.slice(0, 140),
                    bai_hoc: payload.bai_hoc.slice(0, 800),
                    cau_goc: (payload.cau_goc || '').slice(0, 500),
                    chuyen: (payload.chuyen || 'Rút ra từ A12 Tối ưu Prompt & Phiên trên aihot.vn.').slice(0, 500),
                    ap_dung: payload.ap_dung || [],
                    du_an: 'aihot.vn',
                    cong_cu: ['antigravity', 'codex', 'claude'],
                }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || `HTTP ${res.status}`);
            }
            showToast('Đã lưu thành công vào Sổ Bài Học Chủ Dự Án!', 'success');
        } catch (err: any) {
            showToast(err?.message || 'Chưa lưu được sang Sổ Bài Học.', 'error');
        }
    };

    const handleDeletePrivatePrompt = async (id: number) => {
        try {
            const res = await fetch(`/api/owner/prompt-coach/saved-prompts/${id}`, {
                method: 'DELETE',
                headers: resolveAuthHeaders(),
                credentials: 'same-origin',
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc.ok) {
                throw new Error(doc.error || 'Không xóa được mẫu.');
            }
            showToast('Đã xóa mẫu Prompt khỏi kho riêng.', 'success');
            setDash(prev =>
                prev
                    ? { ...prev, saved_prompts: prev.saved_prompts.filter(x => x.id !== id) }
                    : prev
            );
        } catch (err: any) {
            showToast(err?.message || 'Lỗi xóa mẫu Prompt.', 'error');
        }
    };

    const dispatchPromptToA1 = (promptText: string) => {
        if (onDispatchToA1) {
            onDispatchToA1(promptText);
        } else if (onNavigateTab) {
            handleCopy(promptText, 'a1-fallback', 'Đã copy & chuyển sang A1. Giao việc AI!');
            onNavigateTab('remote_agent');
        }
    };

    const settings = dash?.settings || {
        max_prompts_per_session: 12,
        max_hours_per_session: 2.0,
        max_correction_pct: 10,
        auto_analyze_ai: true,
    };

    useEffect(() => {
        const applyHandoff = (qStr: string, openPc = false) => {
            if (!qStr) return;
            setSessionQuery(qStr);
            setSubView(openPc ? 'ag_pc' : 'sessions');
        };
        try {
            const raw = sessionStorage.getItem('aihot_conv_handoff');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed?.target === 'a12' || parsed?.target === 'a12_pc') {
                    sessionStorage.removeItem('aihot_conv_handoff');
                    applyHandoff(String(parsed.query || ''), parsed.target === 'a12_pc');
                }
            }
        } catch {
            // ignore storage errors
        }
        const onHandoff = (ev: Event) => {
            const det = (ev as CustomEvent)?.detail;
            if (det && (det.target === 'a12' || det.target === 'a12_pc')) {
                applyHandoff(String(det.query || ''), det.target === 'a12_pc');
            }
        };
        window.addEventListener('aihot-conv-search-handoff', onHandoff);
        return () => window.removeEventListener('aihot-conv-search-handoff', onHandoff);
    }, []);

    useEffect(() => {
        const qTrim = sessionQuery.trim();
        if (qTrim.length < 2) {
            setSessionServerItems([]);
            setSessionServerTotal(0);
            setSessionServerLoading(false);
            return;
        }
        const ac = new AbortController();
        setSessionServerLoading(true);
        const tm = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({
                    q: qTrim,
                    period: sessionSearchScope === 'all' ? 'all' : period,
                    tool: toolFilter,
                    include_sub: includeSub ? '1' : '0',
                    severity: severityFilter,
                    limit: '80',
                });
                if (sessionSearchScope === 'period' && period === 'date' && customDate) {
                    params.set('date', customDate);
                }
                const res = await fetch(`/api/owner/prompt-coach/search?${params.toString()}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    signal: ac.signal,
                });
                const doc = await res.json().catch(() => null);
                if (!ac.signal.aborted && res.ok && doc?.ok && Array.isArray(doc.items)) {
                    setSessionServerItems(doc.items as CoachSessionSummary[]);
                    setSessionServerTotal(Number(doc.total_hits ?? doc.items.length));
                }
            } catch {
                // ignore abort/network error
            } finally {
                if (!ac.signal.aborted) setSessionServerLoading(false);
            }
        }, 240);
        return () => {
            ac.abort();
            window.clearTimeout(tm);
        };
    }, [sessionQuery, sessionSearchScope, period, customDate, toolFilter, includeSub, severityFilter, resolveAuthHeaders]);

    const filteredSessions = useMemo(() => {
        const list = dash?.sessions || [];
        const qTokens = tokenizeVnSearch(sessionQuery);
        const maxP = settings.max_prompts_per_session || 12;
        const maxH = settings.max_hours_per_session || 2.0;
        const sevRank: Record<string, number> = { red: 3, amber: 2, green: 1 };

        const passesFilters = (s: CoachSessionSummary): boolean => {
            if (severityFilter !== 'all' && s.severity !== severityFilter) return false;
            if (flagFilter !== 'all' && !(s.flags || []).some(f => f.code === flagFilter)) return false;
            if (kpiFilter === 'over_limit') {
                if (!(s.n_human_prompts > maxP || s.clean_active_hours >= maxH)) return false;
            } else if (kpiFilter === 'savable') {
                if (!(s.n_human_prompts > maxP)) return false;
            }
            return true;
        };

        if (qTokens.length === 0) {
            const matched = list.filter(passesFilters);
            return [...matched].sort((a, b) => {
                if (sortBy === 'period_prompts') {
                    const pa = a.period_human_prompts ?? a.day_human_prompts ?? a.n_human_prompts;
                    const pb = b.period_human_prompts ?? b.day_human_prompts ?? b.n_human_prompts;
                    if (pb !== pa) return pb - pa;
                    return (b.end_ts || 0) - (a.end_ts || 0);
                }
                if (sortBy === 'recent') {
                    const runDiff = Number(Boolean(b.is_running)) - Number(Boolean(a.is_running));
                    if (runDiff !== 0) return runDiff;
                    return Math.max(b.last_activity_ts || 0, b.end_ts || 0) - Math.max(a.last_activity_ts || 0, a.end_ts || 0);
                }
                if (sortBy === 'total_prompts') {
                    if (b.n_human_prompts !== a.n_human_prompts) return b.n_human_prompts - a.n_human_prompts;
                    return (b.clean_active_hours || 0) - (a.clean_active_hours || 0);
                }
                if (sortBy === 'hours_waste') {
                    const wa = (a.clean_active_hours || 0) + ((a.n_short_nudges || 0) + (a.n_vague_errors || 0) + (a.n_corr_kw || 0)) * 0.15;
                    const wb = (b.clean_active_hours || 0) + ((b.n_short_nudges || 0) + (b.n_vague_errors || 0) + (b.n_corr_kw || 0)) * 0.15;
                    if (wb !== wa) return wb - wa;
                    return b.n_human_prompts - a.n_human_prompts;
                }
                const ra = sevRank[a.severity] || 0;
                const rb = sevRank[b.severity] || 0;
                if (rb !== ra) return rb - ra;
                if (a.rule_score !== b.rule_score) return a.rule_score - b.rule_score;
                return b.n_human_prompts - a.n_human_prompts;
            });
        }

        const srvMap = new Map<string, CoachSessionSummary>();
        sessionServerItems.forEach(it => srvMap.set(it.session_key, it));
        const merged = new Map<string, { item: CoachSessionSummary; rank: number }>();

        list.forEach(s => {
            if (!passesFilters(s)) return;
            const srv = srvMap.get(s.session_key);
            const localScore = scoreVnSearchFields(
                {
                    title: s.title,
                    project: `${s.project} ${s.session_key}`,
                    preview: s.first_human_preview,
                    body: `${s.ai_summary || ''} ${s.ai_takeaway || ''} ${s.top_prompt_lesson || ''}`,
                },
                qTokens
            );
            if (localScore > 0 || srv) {
                const enriched: CoachSessionSummary = srv
                    ? {
                          ...s,
                          matched_in: srv.matched_in,
                          matched_turn_idx: srv.matched_turn_idx,
                          match_count: srv.match_count,
                          matched_snippet: srv.matched_snippet,
                          match_score: srv.match_score,
                      }
                    : s;
                merged.set(s.session_key, {
                    item: enriched,
                    rank: Math.max(localScore, Number(srv?.match_score || 0)),
                });
            }
        });

        sessionServerItems.forEach(srv => {
            if (!passesFilters(srv)) return;
            if (!merged.has(srv.session_key)) {
                merged.set(srv.session_key, { item: srv, rank: Number(srv.match_score || 50) });
            }
        });

        return Array.from(merged.values())
            .sort((a, b) => {
                if (b.rank !== a.rank) return b.rank - a.rank;
                return Math.max(b.item.last_activity_ts || 0, b.item.end_ts || 0) - Math.max(a.item.last_activity_ts || 0, a.item.end_ts || 0);
            })
            .map(x => x.item);
    }, [
        dash?.sessions,
        sessionServerItems,
        sessionQuery,
        severityFilter,
        flagFilter,
        kpiFilter,
        sortBy,
        settings.max_prompts_per_session,
        settings.max_hours_per_session,
    ]);

    const filteredLibrary = useMemo(() => {
        const list = dash?.saved_prompts || [];
        const qTokens = tokenizeVnSearch(libSearch);
        if (qTokens.length === 0) return list;
        return list.filter(x =>
            matchesAllVnTokens(`${x.title} ${x.category} ${x.prompt_template} ${x.notes}`, qTokens)
        );
    }, [dash?.saved_prompts, libSearch]);

    const handoffTemplate =
        'Dừng triển khai thêm ở phiên này để giữ context gọn dưới 12 prompt. Hãy xuất HANDOFF ngắn gồm:\n' +
        '1) File đã sửa & diff chính\n2) Việc đã test đạt PASS\n3) Đúng việc tiếp theo + lệnh kiểm chứng ở phiên mới.';

    const renderSpotlightSection = (compact = false) => {
        const items = (dash?.prompt_lesson_spotlight || []).slice(0, 4);
        if (items.length === 0) return null;

        if (compact) {
            return (
                <div className="rounded-xl bg-gradient-to-br from-amber-50/90 via-white to-indigo-50/70 dark:from-amber-950/30 dark:via-slate-900 dark:to-indigo-950/30 border border-amber-200 dark:border-amber-800/70 p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                            type="button"
                            onClick={() => setShowSessionsSpotlight(v => !v)}
                            className="inline-flex items-center gap-2 text-left text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white cursor-pointer"
                        >
                            <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>Bài học &amp; Đề xuất tối ưu từng câu ngay ({items.length} điểm nóng)</span>
                            {showSessionsSpotlight ? (
                                <ChevronUp className="w-4 h-4 text-slate-500" />
                            ) : (
                                <ChevronDown className="w-4 h-4 text-slate-500" />
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowSessionsSpotlight(v => !v)}
                            className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                            {showSessionsSpotlight ? 'Thu gọn' : 'Mở bài học ngay'}
                        </button>
                    </div>
                    {showSessionsSpotlight && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                            {items.map((item, sIdx) => {
                                const tMeta = TOOL_LABELS[item.tool] || {
                                    label: item.tool,
                                    badgeCls: 'bg-slate-100 text-slate-700 border-slate-200',
                                };
                                const cleanTitle = formatCleanSessionTitle(
                                    item.session_title,
                                    item.original_text,
                                    item.session_key
                                );
                                const copyKey = `spot-sess-${item.session_key}-${item.idx}-${sIdx}`;
                                return (
                                    <div
                                        key={`${item.session_key}-${item.idx}-${sIdx}`}
                                        className="rounded-xl bg-white dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 p-3 space-y-2 min-w-0"
                                    >
                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                                                <span className={`px-2 py-0.5 rounded-md border text-xs font-extrabold ${tMeta.badgeCls}`}>
                                                    {tMeta.label}
                                                </span>
                                                <span className={`px-2 py-0.5 rounded-full border text-xs font-extrabold tabular-nums ${promptScoreBadgeCls(item.score)}`}>
                                                    Câu #{item.idx} · {item.score}/100đ · {item.verdict}
                                                </span>
                                                {item.ai_scored && (
                                                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold">
                                                        AI chấm
                                                    </span>
                                                )}
                                                {item.merge_with && item.merge_with.length > 0 && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 border border-violet-200 dark:border-violet-800 text-xs font-bold tabular-nums">
                                                        <Link2 className="w-3 h-3" />
                                                        Gộp với #{item.merge_with.join(', #')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                            {cleanTitle}
                                        </div>
                                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 px-2.5 py-2 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-1.5">
                                            <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                            <div className="min-w-0 break-words">
                                                <strong>Bài học rút ngay:</strong> {item.lesson}
                                            </div>
                                        </div>
                                        <div className="rounded-lg bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 px-2.5 py-2 text-xs text-emerald-950 dark:text-emerald-100 space-y-1">
                                            <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                                Đề xuất tối ưu 1-Phát:
                                            </div>
                                            <div className="line-clamp-2 whitespace-pre-wrap break-words">
                                                {item.improved_prompt}
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleCopy(
                                                            item.improved_prompt,
                                                            copyKey,
                                                            `Đã copy bản tối ưu cho Câu #${item.idx}!`
                                                        )
                                                    }
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold cursor-pointer"
                                                >
                                                    {copiedId === copyKey ? (
                                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="w-3.5 h-3.5" />
                                                    )}
                                                    <span>Copy tối ưu</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        handleSaveToLessons({
                                                            tieu_de: `[${tMeta.label}] Câu #${item.idx}: ${item.verdict} (${item.score}đ)`,
                                                            bai_hoc: `${item.lesson} | Đề xuất 1-Phát: ${item.improved_prompt}`,
                                                            cau_goc: item.original_text,
                                                            chuyen: `Phiên: ${cleanTitle}`,
                                                        })
                                                    }
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
                                                >
                                                    <BookOpen className="w-3.5 h-3.5" />
                                                    <span>Lưu Sổ Bài Học</span>
                                                </button>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    openSessionInspector(item.session_key, false, false, 'all', item.idx)
                                                }
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer tabular-nums"
                                            >
                                                <span>Mở đúng câu #{item.idx} →</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div className="rounded-2xl bg-gradient-to-br from-amber-50/80 via-white to-indigo-50/60 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/35 border border-amber-200/90 dark:border-amber-800/60 p-4 space-y-3 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        <Lightbulb className="w-5 h-5 text-amber-500 shrink-0" />
                        <div>
                            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                Bài học &amp; Đề xuất tối ưu từng câu ngay
                            </h2>
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                Chấm từng prompt thô gây lặp vòng · Thấy ngay bài học và mẫu 1-Phát thay thế không cần mò từng phiên.
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setSubView('sessions')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-extrabold text-indigo-700 dark:text-indigo-300 hover:border-indigo-400 cursor-pointer"
                    >
                        <span>Xem toàn bộ hội thoại &amp; điểm từng câu</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {items.map((item, sIdx) => {
                        const tMeta = TOOL_LABELS[item.tool] || {
                            label: item.tool,
                            badgeCls: 'bg-slate-100 text-slate-700 border-slate-200',
                        };
                        const cleanTitle = formatCleanSessionTitle(
                            item.session_title,
                            item.original_text,
                            item.session_key
                        );
                        const copyKey = `spot-ov-${item.session_key}-${item.idx}-${sIdx}`;
                        return (
                            <div
                                key={`${item.session_key}-${item.idx}-${sIdx}`}
                                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/90 p-3.5 flex flex-col justify-between gap-2.5 min-w-0 shadow-xs"
                            >
                                <div className="space-y-2 min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className={`px-2 py-0.5 rounded-md border text-xs font-extrabold ${tMeta.badgeCls}`}>
                                            {tMeta.label}
                                        </span>
                                        <span className={`px-2 py-0.5 rounded-full border text-xs font-extrabold tabular-nums ${promptScoreBadgeCls(item.score)}`}>
                                            Câu #{item.idx} · {item.score}/100đ · {item.verdict}
                                        </span>
                                        {item.ai_scored && (
                                            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold">
                                                AI chấm
                                            </span>
                                        )}
                                        {item.merge_with && item.merge_with.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 border border-violet-200 dark:border-violet-800 text-xs font-bold tabular-nums">
                                                <Link2 className="w-3 h-3" />
                                                Gộp với #{item.merge_with.join(', #')}
                                            </span>
                                        )}
                                    </div>

                                    <div className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white break-words">
                                        {cleanTitle}
                                    </div>

                                    <div className="rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs text-slate-700 dark:text-slate-200">
                                        <div className="font-bold text-slate-500 dark:text-slate-400 mb-0.5">
                                            Câu gốc bạn đã gõ:
                                        </div>
                                        <div className="line-clamp-2 whitespace-pre-wrap break-words">
                                            {item.original_text}
                                        </div>
                                    </div>

                                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 px-3 py-2 text-xs text-amber-950 dark:text-amber-200 flex items-start gap-2">
                                        <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                        <div className="min-w-0 break-words leading-relaxed">
                                            <strong>Bài học rút ngay:</strong> {item.lesson}
                                        </div>
                                    </div>

                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 px-3 py-2 text-xs text-emerald-950 dark:text-emerald-100 space-y-1">
                                        <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                            Đề xuất tối ưu 1-Phát:
                                        </div>
                                        <div className="line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">
                                            {item.improved_prompt}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleCopy(
                                                    item.improved_prompt,
                                                    copyKey,
                                                    `Đã copy bản tối ưu cho Câu #${item.idx}!`
                                                )
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold cursor-pointer"
                                        >
                                            {copiedId === copyKey ? (
                                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                            ) : (
                                                <Copy className="w-3.5 h-3.5" />
                                            )}
                                            <span>Copy tối ưu</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                handleSaveToLessons({
                                                    tieu_de: `[${tMeta.label}] Câu #${item.idx}: ${item.verdict} (${item.score}đ)`,
                                                    bai_hoc: `${item.lesson} | Đề xuất 1-Phát: ${item.improved_prompt}`,
                                                    cau_goc: item.original_text,
                                                    chuyen: `Phiên: ${cleanTitle}`,
                                                })
                                            }
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
                                        >
                                            <BookOpen className="w-3.5 h-3.5" />
                                            <span>Lưu Sổ Bài Học</span>
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            openSessionInspector(item.session_key, false, false, 'all', item.idx)
                                        }
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer tabular-nums"
                                    >
                                        <span>Mở đúng câu #{item.idx} →</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const renderAbCompareCard = (res: DraftCompareResult) => (
        <div className="rounded-xl border border-violet-300 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/25 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold text-violet-900 dark:text-violet-200">
                    <GitCompare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    <span>Giả lập Dry-Run: AI phản ứng với Nháp A vs Prompt B</span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 text-xs font-extrabold tabular-nums">
                    Rubric: {res.score_a}đ → {res.score_b}đ
                </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-800/60 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="font-extrabold text-rose-700 dark:text-rose-300">Prompt A (Nháp gốc)</span>
                        <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-bold tabular-nums">
                            Dự kiến: {res.a_plan.est_turns}
                        </span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200">
                        <strong>Điểm mơ hồ / AI dễ hỏi lại:</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-0.5">
                            {(res.a_plan.predicted_questions_or_errors || []).map((x, idx) => (
                                <li key={idx}>{x}</li>
                            ))}
                        </ul>
                    </div>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                        <span className="font-extrabold text-emerald-700 dark:text-emerald-300">Prompt B (1-Phát tối ưu)</span>
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 font-bold tabular-nums">
                            Dự kiến: {res.b_plan.est_turns}
                        </span>
                    </div>
                    <div className="text-slate-700 dark:text-slate-200">
                        <strong>Luồng triển khai 1-Phát:</strong>
                        <ul className="list-disc pl-4 mt-1 space-y-0.5">
                            {(res.b_plan.plan_steps || []).map((x, idx) => (
                                <li key={idx}>{x}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
            {res.winner_summary && (
                <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200 bg-white/80 dark:bg-slate-900/80 rounded-lg px-3 py-2 border border-violet-200 dark:border-violet-800/50">
                    ✓ Kết luận A/B: {res.winner_summary}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4 pb-8 text-slate-900 dark:text-slate-100">
            {/* Header & Privacy Lock Banner */}
            <div className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white border border-amber-500/35 p-3.5 sm:p-4 shadow-md">
                <div className="flex flex-col gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <img
                            src="/icons/dopamine-3d/quest_brain.png"
                            alt=""
                            className="w-10 h-10 object-contain shrink-0 drop-shadow-md"
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <h1 className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                                    A12. Tối ưu Prompt & Phiên làm việc
                                </h1>
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-200 text-xs font-bold">
                                    <img src="/icons/dopamine-3d/fde_private_vault.png" alt="" className="w-3.5 h-3.5 object-contain" />
                                    Chỉ riêng Chủ dự án · Che bí mật 2 lớp
                                </span>
                            </div>
                            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                                Theo dõi số prompt & hội thoại thực chiến trên <strong className="text-white">Antigravity · Claude Code · Codex</strong>, phát hiện phiên phình to và chuyển câu lệnh thô thành <strong className="text-emerald-300">Prompt 1-Phát chuẩn</strong>.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-slate-800/80">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400 tabular-nums">
                            <span>
                                Đồng bộ PC gần nhất: <strong className="text-slate-200">{formatSyncTime(dash?.sync_status?.last_pc_sync_at || '')}</strong>
                            </span>
                            <span>
                                Dữ liệu đã lưu: <strong className="text-slate-200">{dash?.sync_status?.total_days_tracked ?? 0} ngày</strong>
                                {dash?.sync_status?.min_day && dash?.sync_status?.max_day
                                    ? ` (${dash.sync_status.min_day} → ${dash.sync_status.max_day})`
                                    : ''}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setRealtimeAuto(v => !v)}
                            title="Bật/tắt tự động làm mới Realtime mỗi 10 giây và đồng bộ ngầm từ PC mỗi 20 giây"
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-extrabold transition-colors cursor-pointer tabular-nums ${
                                realtimeAuto
                                    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-400/50 text-emerald-200'
                                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                            }`}
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    realtimeAuto ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                                }`}
                            />
                            <span>
                                {realtimeAuto
                                    ? `Realtime 10s · ${secondsAgo <= 2 ? 'vừa xong' : `${secondsAgo}s trước`}`
                                    : 'Realtime: Tạm dừng'}
                            </span>
                        </button>
                        {(() => {
                            const rt = dash?.ai_realtime;
                            const total = rt?.eligible_total ?? 0;
                            const fresh = rt?.analyzed_fresh ?? 0;
                            const pending = rt?.pending ?? 0;
                            const activeQ = (rt?.inflight ?? 0) + (rt?.queued ?? 0);
                            const isRunning = batchAnalyzing || activeQ > 0;
                            return (
                                <button
                                    type="button"
                                    onClick={handleTriggerBatchAi}
                                    disabled={batchAnalyzing}
                                    title="AI tự động đọc & mổ xẻ realtime các phiên (>= 2 prompt). Bấm để chạy ngay nhóm ưu tiên!"
                                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-extrabold transition-colors cursor-pointer tabular-nums disabled:opacity-60 ${
                                        isRunning
                                            ? 'bg-indigo-500/25 hover:bg-indigo-500/35 border-indigo-400/60 text-indigo-100'
                                            : pending > 0
                                              ? 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-400/50 text-amber-200'
                                              : 'bg-indigo-600/25 hover:bg-indigo-600/35 border-indigo-400/40 text-indigo-100'
                                    }`}
                                >
                                    {isRunning ? (
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-300" />
                                    ) : (
                                        <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
                                    )}
                                    <span>
                                        {isRunning
                                            ? `AI đang mổ xẻ · ${fresh}/${total} phiên`
                                            : pending > 0
                                              ? `AI Coach: ${fresh}/${total} phiên · Quét nốt`
                                              : total > 0
                                                ? `AI Realtime: Đủ ${total}/${total} phiên`
                                                : 'AI Realtime'}
                                    </span>
                                </button>
                            );
                        })()}
                        <button
                            type="button"
                            onClick={handleTriggerPcSync}
                            disabled={pcSyncing}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-slate-950 text-xs font-extrabold shadow-xs transition-colors cursor-pointer"
                        >
                            <RefreshCw className={`w-4 h-4 ${pcSyncing ? 'animate-spin' : ''}`} />
                            <span>{pcSyncing ? 'Đang quét PC...' : 'Quét & Đồng bộ PC'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowSettings(v => !v)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold transition-colors cursor-pointer"
                        >
                            <Settings className="w-4 h-4 text-amber-300" />
                            <span>Ngưỡng ({settings.max_prompts_per_session}p / {settings.max_hours_per_session}h)</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => loadDashboard(true)}
                            disabled={refreshing}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold transition-colors cursor-pointer"
                        >
                            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                            <span>Làm mới</span>
                        </button>
                        </div>
                    </div>
                </div>

                {/* Inline Editable Thresholds Drawer */}
                {showSettings && (
                    <div className="mt-4 pt-4 border-t border-slate-700/80 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-300">Max Prompt / 1 Phiên</span>
                            <input
                                type="number"
                                min={3}
                                max={60}
                                value={maxPromptsInput}
                                onChange={e => setMaxPromptsInput(Number(e.target.value) || 12)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white text-xs font-bold tabular-nums"
                            />
                        </label>
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-300">Max Giờ thực / 1 Phiên</span>
                            <input
                                type="number"
                                step={0.25}
                                min={0.25}
                                max={12}
                                value={maxHoursInput}
                                onChange={e => setMaxHoursInput(Number(e.target.value) || 2.0)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white text-xs font-bold tabular-nums"
                            />
                        </label>
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-300">Max Tỷ lệ sửa lại (%)</span>
                            <input
                                type="number"
                                min={1}
                                max={80}
                                value={maxCorrInput}
                                onChange={e => setMaxCorrInput(Number(e.target.value) || 10)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white text-xs font-bold tabular-nums"
                            />
                        </label>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSaveSettings}
                                disabled={savingSettings}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-extrabold cursor-pointer"
                            >
                                <Save className="w-4 h-4" />
                                <span>{savingSettings ? 'Đang lưu...' : 'Lưu & Chấm lại'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowSettings(false)}
                                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                            >
                                Đóng
                            </button>
                        </div>
                        <div className="sm:col-span-4 flex items-center justify-between gap-3 pt-1">
                            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={autoAnalyzeInput}
                                    onChange={e => setAutoAnalyzeInput(e.target.checked)}
                                    className="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
                                />
                                <span>Tự động AI Coach mổ xẻ Realtime mọi phiên (&gt;= 2 prompt)</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* Live Today Early Warning Alerts (Compact Pill Strip) */}
            {dash && dash.today_alerts && dash.today_alerts.length > 0 && (
                <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700/60 px-3.5 py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2 text-xs font-extrabold text-amber-900 dark:text-amber-200">
                            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                            <span>Cảnh báo sớm Hôm nay: {dash.today_alerts.length} hội thoại chạm/vượt ngưỡng</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleCopy(handoffTemplate, 'handoff-global', 'Đã copy lệnh tách phiên HANDOFF!')}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
                        >
                            {copiedId === 'handoff-global' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>Copy lệnh tách phiên HANDOFF</span>
                        </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                        {dash.today_alerts.slice(0, 6).map(al => {
                            const cleanAlTitle = formatCleanSessionTitle(al.title, '', al.session_key);
                            return (
                                <button
                                    key={al.session_key}
                                    type="button"
                                    onClick={() => openSessionInspector(al.session_key, false)}
                                    title={`${cleanAlTitle} — bấm xem hồ sơ chi tiết`}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900/90 border border-amber-200 dark:border-amber-800/60 hover:border-indigo-500 text-xs transition-colors cursor-pointer max-w-full"
                                >
                                    <span
                                        className={`px-1.5 py-0.5 rounded border text-xs font-extrabold shrink-0 ${
                                            (TOOL_LABELS[al.tool] || TOOL_LABELS.antigravity).badgeCls
                                        }`}
                                    >
                                        {(TOOL_LABELS[al.tool] || { label: al.tool }).label}
                                    </span>
                                    <span className="font-bold text-slate-900 dark:text-white truncate max-w-[220px] sm:max-w-[280px]">
                                        {cleanAlTitle}
                                    </span>
                                    <span
                                        className={`font-extrabold tabular-nums shrink-0 ${
                                            al.level === 'red'
                                                ? 'text-rose-600 dark:text-rose-400'
                                                : 'text-amber-600 dark:text-amber-400'
                                        }`}
                                    >
                                        {al.n_human_prompts}p · {al.clean_active_hours}h
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Error Alert */}
            {errorMsg && (
                <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 p-4 flex items-center justify-between gap-3">
                    <div className="text-xs sm:text-sm font-bold text-rose-800 dark:text-rose-200">{errorMsg}</div>
                    <button
                        type="button"
                        onClick={() => loadDashboard(false)}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shrink-0 cursor-pointer"
                    >
                        Thử lại
                    </button>
                </div>
            )}

            {/* Sub-Tabs & Global Period/Tool Filters */}
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 space-y-3 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                    {[
                        {
                            id: 'realtime' as SubViewKey,
                            label: '⚡ Báo cáo Nhịp Realtime 30s',
                            icon: '/icons/dopamine-3d/quest_lightning.png',
                        },
                        { id: 'overview' as SubViewKey, label: '1. Bảng theo Ngày & Tổng quan', icon: '/icons/dopamine-3d/ui_calendar_heatmap.png' },
                        {
                            id: 'ag_pc' as SubViewKey,
                            label: '2. Giao diện Antigravity PC (Thật ↔ 1-Phát)',
                            icon: '/icons/dopamine-3d/sb_pc_monitor.png',
                        },
                        {
                            id: 'prompts' as SubViewKey,
                            label: `3. Bảng Prompt & Tối ưu (${promptsData?.total ?? dash?.totals.direct_prompts ?? 0})`,
                            icon: '/icons/dopamine-3d/cat_prompt_scroll.png',
                        },
                        {
                            id: 'sessions' as SubViewKey,
                            label: `4. Hội thoại & Đề xuất (${dash?.total_matching_sessions ?? 0})`,
                            icon: '/icons/dopamine-3d/menu_4_chat.png',
                        },
                        { id: 'optimizer' as SubViewKey, label: '5. Xưởng Sửa Nháp Prompt', icon: '/icons/dopamine-3d/quest_lightning.png' },
                        {
                            id: 'library' as SubViewKey,
                            label: `6. Kho Prompt Chuẩn (${dash?.saved_prompts?.length ?? 0})`,
                            icon: '/icons/dopamine-3d/quest_target.png',
                        },
                    ].map(tab => {
                        const active = subView === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setSubView(tab.id)}
                                className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-extrabold border transition-all cursor-pointer ${
                                    active
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                        : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                }`}
                            >
                                <img src={tab.icon} alt="" className="w-4 h-4 object-contain" />
                                <span>{tab.label}</span>
                            </button>
                        );
                    })}
                </div>

                {subView !== 'optimizer' && subView !== 'library' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        {/* Period Switcher */}
                        <div className="flex flex-wrap items-center gap-1.5">
                            {(
                                [
                                    ['today', 'Hôm nay'],
                                    ['yesterday', 'Hôm qua'],
                                    ['7d', '7 ngày'],
                                    ['30d', '30 ngày'],
                                    ['all', 'Tất cả'],
                                ] as Array<[PeriodKey, string]>
                            ).map(([pk, plabel]) => (
                                <button
                                    key={pk}
                                    type="button"
                                    onClick={() => handleChangePeriod(pk)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
                                        period === pk
                                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {plabel}
                                </button>
                            ))}
                            <input
                                type="date"
                                value={customDate}
                                onChange={e => {
                                    const val = e.target.value;
                                    if (val) handleChangePeriod('date', val);
                                    else handleChangePeriod('today');
                                }}
                                aria-label="Chọn ngày cụ thể"
                                className="px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 tabular-nums"
                            />
                        </div>

                        {/* Tool Switcher + Subagent Toggle */}
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                {[
                                    ['all', 'Cả 3 AI'],
                                    ['antigravity', 'Antigravity'],
                                    ['claude', 'Claude Code'],
                                    ['codex', 'Codex'],
                                ].map(([tk, tl]) => (
                                    <button
                                        key={tk}
                                        type="button"
                                        onClick={() => {
                                            setToolFilter(tk);
                                            setAgPcSessionKey(null);
                                        }}
                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                            toolFilter === tk
                                                ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs'
                                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {tl}
                                    </button>
                                ))}
                            </div>

                            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={includeSub}
                                    onChange={e => {
                                        setIncludeSub(e.target.checked);
                                        setAgPcSessionKey(null);
                                    }}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span>Hiện ngầm/Subagent</span>
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* Loading State */}
            {loading && !dash && (
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center space-y-2">
                    <RefreshCw className="w-7 h-7 animate-spin text-indigo-500 mx-auto" />
                    <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                        Đang tải số liệu Prompt & Hội thoại từ kho riêng Chủ dự án...
                    </div>
                </div>
            )}

            {/* KPI Cards Row (Shown in Overview & Sessions views) — Click any card for detailed breakdown */}
            {dash && (subView === 'overview' || subView === 'sessions') && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        <div
                            onClick={() => setKpiFocus(prev => (prev === 'prompts' ? 'none' : 'prompts'))}
                            className={`rounded-2xl bg-white dark:bg-slate-900 border p-3.5 shadow-xs transition-all cursor-pointer ${
                                kpiFocus === 'prompts'
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400/70'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Prompt trực tiếp · Phiên</span>
                                <img src="/icons/dopamine-3d/cat_prompt_scroll.png" alt="" className="w-6 h-6 object-contain" />
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
                                <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                                    {dash.totals.direct_prompts.toLocaleString('vi-VN')}
                                </span>
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                    / {dash.totals.direct_sessions.toLocaleString('vi-VN')} phiên ({dash.totals.avg_prompts_per_session}p/phiên)
                                </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                +{dash.totals.bg_prompts.toLocaleString('vi-VN')} ngầm/subagent ({dash.totals.bg_sessions} phiên) · {dash.totals.auto_ignored.toLocaleString('vi-VN')} auto-lọc
                            </div>
                            <div className="mt-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                {kpiFocus === 'prompts' ? '▲ Ẩn phân bổ 3 công cụ AI' : '▼ Xem phân bổ theo từng AI'}
                            </div>
                        </div>

                        <div
                            onClick={() => {
                                setKpiFocus('none');
                                setKpiFilter(prev => (prev === 'over_limit' ? 'all' : 'over_limit'));
                                setSortBy('priority');
                                setUserPickedSort(true);
                                scrollToSessionsList();
                            }}
                            className={`rounded-2xl bg-white dark:bg-slate-900 border p-3.5 shadow-xs transition-all cursor-pointer ${
                                kpiFilter === 'over_limit' && subView === 'sessions'
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400/70'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Phiên gọn chuẩn ({`<= ${settings.max_prompts_per_session}p`})</span>
                                <img src="/icons/dopamine-3d/stat_check.png" alt="" className="w-6 h-6 object-contain" />
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
                                <span
                                    className={`text-2xl font-extrabold ${
                                        dash.totals.compliance_pct >= 80
                                            ? 'text-emerald-600 dark:text-emerald-400'
                                            : dash.totals.compliance_pct >= 60
                                              ? 'text-amber-600 dark:text-amber-400'
                                              : 'text-rose-600 dark:text-rose-400'
                                    }`}
                                >
                                    {dash.totals.compliance_pct}%
                                </span>
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                                    ({dash.totals.compliant_sessions} gọn · {dash.totals.over_limit_sessions} vượt)
                                </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                Mục tiêu phiên sạch &lt; {settings.max_hours_per_session}h và sửa &lt; {settings.max_correction_pct}%
                            </div>
                            <div className="mt-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                {kpiFilter === 'over_limit' && subView === 'sessions'
                                    ? '✓ Đang lọc phiên vượt ngưỡng (bấm bỏ)'
                                    : 'Lọc ngay phiên vượt ngưỡng →'}
                            </div>
                        </div>

                        <div
                            onClick={() => {
                                setKpiFocus('none');
                                setKpiFilter('all');
                                setSortBy('hours_waste');
                                setUserPickedSort(true);
                                scrollToSessionsList();
                            }}
                            className={`rounded-2xl bg-white dark:bg-slate-900 border p-3.5 shadow-xs transition-all cursor-pointer ${
                                sortBy === 'hours_waste' && subView === 'sessions'
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400/70'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Giờ làm thực · Điểm TB</span>
                                <img src="/icons/dopamine-3d/ui_crown_top1.png" alt="" className="w-6 h-6 object-contain" />
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-baseline gap-2 tabular-nums">
                                <span className="text-2xl font-extrabold text-slate-900 dark:text-white">
                                    {dash.totals.active_hours}h
                                </span>
                                <span className="text-xs font-extrabold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                                    Phiên {dash.totals.avg_score}/100
                                </span>
                                <span
                                    className={`text-xs font-extrabold px-2 py-0.5 rounded-full border ${promptScoreBadgeCls(
                                        dash.totals.avg_prompt_score ?? dash.totals.avg_score
                                    )}`}
                                >
                                    TB câu {dash.totals.avg_prompt_score ?? dash.totals.avg_score}/100
                                </span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {dash.totals.weak_prompts_count || 0} câu cần tối ưu · {dash.totals.short_nudges} nhắc ngắn · {dash.totals.vague_errors} lỗi thiếu log
                            </div>
                            <div className="mt-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                Xếp hạng phiên tốn giờ &amp; câu phí →
                            </div>
                        </div>

                        <div
                            onClick={() => {
                                setKpiFocus('none');
                                setKpiFilter(prev => (prev === 'savable' ? 'all' : 'savable'));
                                setSortBy('total_prompts');
                                setUserPickedSort(true);
                                scrollToSessionsList();
                            }}
                            className={`rounded-2xl bg-white dark:bg-slate-900 border p-3.5 shadow-xs transition-all cursor-pointer ${
                                kpiFilter === 'savable' && subView === 'sessions'
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-400/70'
                            }`}
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Cắt giảm được nếu tách &amp; 1-Phát</span>
                                <img src="/icons/dopamine-3d/quest_lightning.png" alt="" className="w-6 h-6 object-contain" />
                            </div>
                            <div className="mt-1.5 flex items-baseline gap-2 tabular-nums">
                                <span className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                                    ~{dash.totals.est_savable_prompts.toLocaleString('vi-VN')}p
                                </span>
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300">prompt dư thừa</span>
                            </div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                Quy đổi từ các phiên vượt mốc &gt; {settings.max_prompts_per_session}p
                            </div>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                    {kpiFilter === 'savable' && subView === 'sessions'
                                        ? '✓ Đang lọc top tiết kiệm'
                                        : 'Xem top phiên tiết kiệm →'}
                                </span>
                                <button
                                    type="button"
                                    onClick={e => {
                                        e.stopPropagation();
                                        setSubView('optimizer');
                                    }}
                                    className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                >
                                    <span>Xưởng 1-Phát</span>
                                    <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Compact 3-Tool Breakdown Strip when Card 1 is active (no duplicate session list) */}
                    {kpiFocus === 'prompts' && (
                        <div className="rounded-2xl bg-indigo-50/70 dark:bg-slate-900 border border-indigo-300 dark:border-indigo-800 p-3.5 space-y-2.5 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-xs sm:text-sm font-extrabold text-indigo-950 dark:text-indigo-200">
                                    Phân bổ Prompt &amp; Giờ thực theo từng Công cụ AI ({dash.period_label})
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setKpiFocus('none')}
                                    className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
                                >
                                    Đóng
                                </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 tabular-nums text-xs">
                                {(['antigravity', 'claude', 'codex'] as const).map(tk => {
                                    const bt = dash.totals.by_tool?.[tk];
                                    const tSessions = bt?.sessions ?? dash.sessions.filter(s => s.tool === tk).length;
                                    const tPrompts =
                                        bt?.prompts ?? dash.days.reduce((acc, d) => acc + (d.by_tool?.[tk]?.prompts || 0), 0);
                                    const tHours =
                                        bt?.hours ?? dash.days.reduce((acc, d) => acc + (d.by_tool?.[tk]?.hours || 0), 0);
                                    const isZero = tPrompts === 0 && tSessions === 0;
                                    const tMeta = TOOL_LABELS[tk];
                                    return (
                                        <div
                                            key={tk}
                                            onClick={() => {
                                                setToolFilter(prev => (prev === tk ? 'all' : tk));
                                                scrollToSessionsList();
                                            }}
                                            className={`rounded-xl bg-white dark:bg-slate-800/90 border p-3 transition-colors cursor-pointer space-y-1 ${
                                                toolFilter === tk
                                                    ? 'border-indigo-500 ring-1 ring-indigo-500/30'
                                                    : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                            } ${isZero ? 'opacity-65' : ''}`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <span className={`px-2 py-0.5 rounded-md border font-extrabold ${tMeta.badgeCls}`}>
                                                    {tMeta.label}
                                                </span>
                                                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                                    {toolFilter === tk ? 'Đang lọc (bấm bỏ)' : 'Lọc danh sách →'}
                                                </span>
                                            </div>
                                            <div className="text-sm font-extrabold text-slate-900 dark:text-white">
                                                {tPrompts.toLocaleString('vi-VN')} prompt · {tSessions} phiên
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400">
                                                Giờ thực: {Math.round(tHours * 10) / 10}h · TB{' '}
                                                {tSessions ? Math.round((tPrompts / tSessions) * 10) / 10 : 0}p/phiên
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* VIEW 0: REALTIME 30-SECOND EXECUTIVE REPORT */}
            {dash && dash.realtime_report && subView === 'realtime' && (
                <RealtimeExecutiveReportPanel
                    report={dash.realtime_report}
                    dark={typeof document !== 'undefined' && document.documentElement.classList.contains('dark')}
                    copiedId={copiedId}
                    onCopy={handleCopy}
                    onOpenSessionTurn={(skey, turnIdx) => openInAntigravityPc(skey, turnIdx)}
                    onLoadTemplateToComposer={tpl => navigateToOptimizerWithPrompt(tpl, 'all')}
                />
            )}

            {/* VIEW 1: DAILY BREAKDOWN & PATTERN INSIGHTS */}
            {dash && subView === 'overview' && (
                <div className="space-y-4">
                    {/* Single Priority Focus Habit + Stage Breakdown (Prompt-sensei 6x7) */}
                    {dash.focus_habit && (
                        <div className="rounded-2xl bg-gradient-to-r from-amber-50 via-white to-indigo-50/70 dark:from-amber-950/35 dark:via-slate-900 dark:to-indigo-950/30 border border-amber-300/80 dark:border-amber-800/60 p-4 shadow-xs space-y-2.5">
                            <div className="flex flex-wrap items-start justify-between gap-2.5">
                                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                    <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                    <div className="min-w-0 space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="px-2 py-0.5 rounded-full bg-amber-600 text-white text-xs font-extrabold">
                                                Thói quen #1 ưu tiên tuần này
                                            </span>
                                            <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                                                {dash.focus_habit.title}
                                            </span>
                                            {(dash.focus_habit.fail_count || 0) > 0 && (
                                                <span className="text-xs font-bold text-rose-700 dark:text-rose-300 tabular-nums">
                                                    ({dash.focus_habit.hit_rate_pct ?? 0}% câu gặp lỗi này)
                                                </span>
                                            )}
                                        </div>
                                        {dash.focus_habit.why && (
                                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                                {dash.focus_habit.why}
                                            </p>
                                        )}
                                        <div className="text-xs font-bold text-indigo-800 dark:text-indigo-200">
                                            → Hành động ngay: {dash.focus_habit.action_tip}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-xs tabular-nums shrink-0">
                                    {(dash.totals.total_tool_calls || 0) > 0 && (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200">
                                            <Wrench className="w-3.5 h-3.5 text-indigo-500" />
                                            <span>
                                                {(dash.totals.total_tool_calls || 0).toLocaleString('vi-VN')} lượt gọi tool
                                                {(dash.totals.tool_error_count || 0) > 0
                                                    ? ` · ${dash.totals.tool_error_count} lỗi tool`
                                                    : ' · 0 lỗi tool'}
                                            </span>
                                        </span>
                                    )}
                                </div>
                            </div>
                            {(dash.stage_breakdown || []).length > 0 && (
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-amber-200/60 dark:border-amber-800/40 text-xs tabular-nums">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <span className="font-bold text-slate-500 dark:text-slate-400">6 Giai đoạn Prompt:</span>
                                        {dash.stage_breakdown!.map(st => (
                                            <button
                                                key={st.stage}
                                                type="button"
                                                onClick={() => {
                                                    setTableStage(st.stage);
                                                    setSubView('prompts');
                                                }}
                                                title={`Mở Bảng Prompt lọc theo giai đoạn ${st.label}`}
                                                className={`px-2 py-0.5 rounded-full border font-bold cursor-pointer hover:opacity-85 transition-opacity ${
                                                    STAGE_PILL_CLS[st.stage] ||
                                                    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                }`}
                                            >
                                                {st.label}: {st.count}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                        <button
                                            type="button"
                                            onClick={() => openInAntigravityPc()}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer"
                                        >
                                            <GitCompare className="w-3.5 h-3.5" />
                                            <span>Mở Giao diện Antigravity PC ↔</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setTableStage('all');
                                                setTableSort('score_asc');
                                                setSubView('prompts');
                                            }}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                                        >
                                            <Table2 className="w-3.5 h-3.5" />
                                            <span>Mở Bảng Prompt →</span>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Immediate Prompt-Level Lesson Spotlight */}
                    {renderSpotlightSection(false)}

                    {/* Pattern Weaknesses Grid */}
                    {dash.pattern_recommendations.length > 0 && (
                        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2">
                                    <img src="/icons/dopamine-3d/quest_target.png" alt="" className="w-5 h-5 object-contain" />
                                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                        Điểm yếu thói quen đang làm phình Prompt & Cách cắt giảm ngay
                                    </h2>
                                </div>
                                <span className="text-xs text-slate-500 dark:text-slate-400">{dash.period_label}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                                {dash.pattern_recommendations.map(rec => (
                                    <div
                                        key={rec.code}
                                        onClick={() => {
                                            setFlagFilter(rec.code);
                                            setSubView('sessions');
                                        }}
                                        className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/80 hover:border-indigo-400 dark:hover:border-indigo-500 p-3.5 flex flex-col justify-between gap-2.5 transition-colors cursor-pointer"
                                    >
                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <span
                                                    className={`px-2 py-0.5 rounded-full border text-xs font-extrabold ${
                                                        rec.severity === 'red'
                                                            ? 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/70 dark:text-rose-200 dark:border-rose-800/60'
                                                            : 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800/60'
                                                    }`}
                                                >
                                                    {rec.label}
                                                </span>
                                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                                    Bấm xem {rec.count} phiên →
                                                </span>
                                            </div>
                                            <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">{rec.tip}</p>
                                        </div>
                                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400 tabular-nums">
                                                Ảnh hưởng {rec.prompts_impacted} prompt
                                            </span>
                                            <button
                                                type="button"
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    handleSaveToLessons({
                                                        tieu_de: `Khắc phục ${rec.label} để giữ phiên <= ${settings.max_prompts_per_session} prompt`,
                                                        bai_hoc: rec.tip,
                                                        ap_dung: [rec.tip],
                                                    });
                                                }}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:border-indigo-400 cursor-pointer"
                                            >
                                                <BookOpen className="w-3.5 h-3.5" />
                                                <span>Lưu Sổ Bài Học</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Daily Breakdown Table (Desktop) + Cards (Mobile) */}
                    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                                <img src="/icons/dopamine-3d/ui_calendar_heatmap.png" alt="" className="w-5 h-5 object-contain" />
                                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                    Nhật ký Prompt & Hội thoại từng Ngày ({dash.days.length} ngày)
                                </h2>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">Bấm vào 1 ngày để soi toàn bộ các phiên ngày đó</span>
                        </div>

                        {dash.days.length === 0 ? (
                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                                Chưa có phiên nào trong khoảng thời gian này. Hãy bấm <strong>Quét & Đồng bộ PC</strong> hoặc chọn <strong>30 ngày / Tất cả</strong>.
                            </div>
                        ) : (
                            <>
                                {/* Desktop Table */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead>
                                            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 font-bold">
                                                <th className="py-2.5 px-3">Ngày (+07:00)</th>
                                                <th className="py-2.5 px-3 text-right">Prompt trực tiếp</th>
                                                <th className="py-2.5 px-3 text-right">Phiên trực tiếp</th>
                                                <th className="py-2.5 px-3 text-right">TB / Phiên</th>
                                                <th className="py-2.5 px-3 text-right">Giờ thực</th>
                                                <th className="py-2.5 px-3">Phân bổ AG · CL · CX</th>
                                                <th className="py-2.5 px-3 text-right">Ngầm & Auto</th>
                                                <th className="py-2.5 px-3 text-right">Điểm TB</th>
                                                <th className="py-2.5 px-3 text-right">Soi ngày</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                                            {dash.days.map(row => (
                                                <tr
                                                    key={row.day}
                                                    onClick={() => openDayModal(row.day)}
                                                    className="hover:bg-indigo-50/70 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
                                                >
                                                    <td className="py-2.5 px-3 font-extrabold text-slate-900 dark:text-white whitespace-nowrap">
                                                        {row.day}
                                                        {row.day === dash.today && (
                                                            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-xs font-bold">
                                                                Hôm nay
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-extrabold text-slate-900 dark:text-white">
                                                        {row.direct_prompts.toLocaleString('vi-VN')}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right">
                                                        <span className="font-bold">{row.direct_sessions}</span>
                                                        {row.over_limit_sessions > 0 && (
                                                            <span className="ml-1 text-rose-600 dark:text-rose-400 font-bold">
                                                                ({row.over_limit_sessions} vượt)
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-bold">
                                                        <span
                                                            className={
                                                                row.avg_prompts_per_session > settings.max_prompts_per_session
                                                                    ? 'text-rose-600 dark:text-rose-400'
                                                                    : 'text-emerald-600 dark:text-emerald-400'
                                                            }
                                                        >
                                                            {row.avg_prompts_per_session}p
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                                                        {row.active_hours}h
                                                    </td>
                                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300">
                                                        <span className="text-indigo-600 dark:text-indigo-300 font-bold">
                                                            AG {row.by_tool?.antigravity?.prompts || 0}p
                                                        </span>
                                                        {' · '}
                                                        <span className="text-amber-600 dark:text-amber-300 font-bold">
                                                            CL {row.by_tool?.claude?.prompts || 0}p
                                                        </span>
                                                        {' · '}
                                                        <span className="text-emerald-600 dark:text-emerald-300 font-bold">
                                                            CX {row.by_tool?.codex?.prompts || 0}p
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400">
                                                        +{row.bg_prompts} ngầm · {row.auto_ignored} lọc
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right font-extrabold">
                                                        <span
                                                            className={
                                                                row.efficiency_score >= 82
                                                                    ? 'text-emerald-600 dark:text-emerald-400'
                                                                    : row.efficiency_score >= 60
                                                                      ? 'text-amber-600 dark:text-amber-400'
                                                                      : 'text-rose-600 dark:text-rose-400'
                                                            }
                                                        >
                                                            {row.efficiency_score}
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-3 text-right">
                                                        <button
                                                            type="button"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                openDayModal(row.day);
                                                            }}
                                                            className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 font-bold cursor-pointer"
                                                        >
                                                            Chi tiết
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Cards */}
                                <div className="md:hidden space-y-2.5 tabular-nums">
                                    {dash.days.map(row => (
                                        <div
                                            key={row.day}
                                            onClick={() => openDayModal(row.day)}
                                            className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 p-3 space-y-2 cursor-pointer"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-xs font-extrabold text-slate-900 dark:text-white">
                                                    {row.day}
                                                    {row.day === dash.today ? ' · Hôm nay' : ''}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        openDayModal(row.day);
                                                    }}
                                                    className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold cursor-pointer"
                                                >
                                                    Chi tiết ({row.direct_sessions} phiên)
                                                </button>
                                            </div>
                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div>
                                                    <div className="text-slate-500 dark:text-slate-400">Prompt</div>
                                                    <div className="font-extrabold">{row.direct_prompts}p</div>
                                                </div>
                                                <div>
                                                    <div className="text-slate-500 dark:text-slate-400">Giờ thực</div>
                                                    <div className="font-extrabold">{row.active_hours}h</div>
                                                </div>
                                                <div>
                                                    <div className="text-slate-500 dark:text-slate-400">Điểm TB</div>
                                                    <div className="font-extrabold">{row.efficiency_score}/100</div>
                                                </div>
                                            </div>
                                            <div className="text-xs text-slate-600 dark:text-slate-300">
                                                AG {row.by_tool?.antigravity?.prompts || 0}p · CL {row.by_tool?.claude?.prompts || 0}p · CX {row.by_tool?.codex?.prompts || 0}p · +{row.bg_prompts} ngầm
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* VIEW 2: ANTIGRAVITY PC PARALLEL COACH (PHƯƠNG ÁN 2: THẬT ↔ 1-PHÁT) */}
            {dash && subView === 'ag_pc' && (
                <AntigravityPcCoachTab
                    sessions={dash.sessions}
                    totalMatchingSessions={dash.total_matching_sessions}
                    selectedSessionKey={agPcSessionKey}
                    onSelectSessionKey={setAgPcSessionKey}
                    period={period}
                    customDate={customDate}
                    onChangePeriod={handleChangePeriod}
                    toolFilter={toolFilter}
                    onChangeToolFilter={nextTool => {
                        setToolFilter(nextTool);
                        setAgPcSessionKey(null);
                    }}
                    includeSub={includeSub}
                    onChangeIncludeSub={nextInc => {
                        setIncludeSub(nextInc);
                        setAgPcSessionKey(null);
                    }}
                    onExitToOverview={() => setSubView('overview')}
                    resolveAuthHeaders={resolveAuthHeaders}
                    onCopy={handleCopy}
                    copiedId={copiedId}
                    onDispatchToA1={dispatchPromptToA1}
                    onSavePrivatePrompt={handleSavePrivatePrompt}
                    onOpenFullOptimizer={navigateToOptimizerWithPrompt}
                    onRefreshDashboard={() => void loadDashboard(true)}
                    onTriggerPcSync={handleTriggerPcSync}
                    pcSyncing={pcSyncing}
                    realtimeAuto={realtimeAuto}
                    onToggleRealtimeAuto={() => setRealtimeAuto(v => !v)}
                    focusTurnIdx={agPcFocusTurnIdx}
                    onClearFocusTurnIdx={() => setAgPcFocusTurnIdx(null)}
                    realtimeReport={dash.realtime_report}
                />
            )}

            {/* VIEW 3: PROMPT EVALUATION & OPTIMIZATION TABLE */}
            {subView === 'prompts' && (
                <div className="space-y-4">
                    {/* Top Health Distribution + 7-Dim Rubric Interactive Heatmap */}
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3.5">
                        <div className="xl:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <img src="/icons/dopamine-3d/cat_prompt_scroll.png" alt="" className="w-6 h-6 object-contain" />
                                    <div>
                                        <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                            Bảng Chấm điểm &amp; Tối ưu từng Prompt
                                        </h2>
                                        <p className="text-xs text-slate-500 dark:text-slate-400">
                                            Bấm vào mức điểm hoặc 7 chiều bên phải để lọc ngay các câu cần cải thiện
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right shrink-0 tabular-nums">
                                    <div className="text-xl font-black text-indigo-600 dark:text-indigo-400">
                                        {promptsData?.summary?.avg_score ?? '—'}/100đ
                                    </div>
                                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        {(promptsData?.total ?? 0).toLocaleString('vi-VN')} câu khớp lọc
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-2 gap-2 text-xs tabular-nums">
                                {(
                                    [
                                        {
                                            key: 'green',
                                            label: 'Chuẩn (≥80đ)',
                                            cnt: promptsData?.facets?.green_count ?? 0,
                                            activeCls: 'bg-emerald-600 text-white border-emerald-600',
                                            idleCls: 'bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800/60 hover:border-emerald-400',
                                        },
                                        {
                                            key: 'amber',
                                            label: 'Cần chỉnh (55–79đ)',
                                            cnt: promptsData?.facets?.amber_count ?? 0,
                                            activeCls: 'bg-amber-600 text-white border-amber-600',
                                            idleCls: 'bg-amber-50/80 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800/60 hover:border-amber-400',
                                        },
                                        {
                                            key: 'red',
                                            label: 'Yếu / Rủi ro (<55đ)',
                                            cnt: promptsData?.facets?.red_count ?? 0,
                                            activeCls: 'bg-rose-600 text-white border-rose-600',
                                            idleCls: 'bg-rose-50/80 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 border-rose-200 dark:border-rose-800/60 hover:border-rose-400',
                                        },
                                    ] as const
                                ).map(lv => {
                                    const active = tableLevel === lv.key;
                                    return (
                                        <button
                                            key={lv.key}
                                            type="button"
                                            onClick={() => setTableLevel(prev => (prev === lv.key ? 'all' : lv.key))}
                                            className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border font-extrabold cursor-pointer transition-all ${
                                                active ? lv.activeCls : lv.idleCls
                                            }`}
                                        >
                                            <span>{lv.label}</span>
                                            <span>{lv.cnt.toLocaleString('vi-VN')}</span>
                                        </button>
                                    );
                                })}
                                <button
                                    type="button"
                                    onClick={() => setTableOnlyErrors(prev => !prev)}
                                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border font-extrabold cursor-pointer transition-all ${
                                        tableOnlyErrors
                                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                    }`}
                                >
                                    <span>Lỗi Tool / Sửa</span>
                                    <span>{(promptsData?.facets?.tool_error_count ?? 0).toLocaleString('vi-VN')}</span>
                                </button>
                            </div>
                        </div>

                        <div className="xl:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-2.5 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <img src="/icons/dopamine-3d/stat_check.png" alt="" className="w-5 h-5 object-contain" />
                                    <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                                        Sức khỏe 7 Chiều Rubric (Bấm vào chiều bất kỳ để lọc câu đang thiếu)
                                    </h3>
                                </div>
                                {tableWeakDim !== 'all' && (
                                    <button
                                        type="button"
                                        onClick={() => setTableWeakDim('all')}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 text-xs font-extrabold cursor-pointer"
                                    >
                                        <span>Bỏ lọc chiều</span>
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 gap-2 tabular-nums">
                                {RUBRIC_DIMENSIONS.map(dim => {
                                    const avgVal = Number(promptsData?.summary?.dimension_avgs?.[dim.key] ?? 100);
                                    const weakCnt = Number(promptsData?.facets?.dim_weak_counts?.[dim.key] ?? 0);
                                    const isActive = tableWeakDim === dim.key;
                                    const barCls =
                                        avgVal >= 80
                                            ? 'bg-emerald-500'
                                            : avgVal >= 55
                                              ? 'bg-amber-500'
                                              : 'bg-rose-500';
                                    return (
                                        <button
                                            key={dim.key}
                                            type="button"
                                            title={dim.hint}
                                            onClick={() => setTableWeakDim(prev => (prev === dim.key ? 'all' : dim.key))}
                                            className={`text-left rounded-xl p-2.5 border transition-all cursor-pointer space-y-1.5 ${
                                                isActive
                                                    ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500'
                                                    : 'bg-slate-50/80 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-1 text-xs">
                                                <span className="font-extrabold text-slate-800 dark:text-slate-100 truncate">
                                                    {dim.label}
                                                </span>
                                                <span
                                                    className={`font-black ${
                                                        avgVal >= 80
                                                            ? 'text-emerald-700 dark:text-emerald-400'
                                                            : avgVal >= 55
                                                              ? 'text-amber-700 dark:text-amber-400'
                                                              : 'text-rose-700 dark:text-rose-400'
                                                    }`}
                                                >
                                                    {avgVal}%
                                                </span>
                                            </div>
                                            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                                <div
                                                    className={`h-full rounded-full transition-all ${barCls}`}
                                                    style={{ width: `${Math.max(4, Math.min(100, avgVal))}%` }}
                                                />
                                            </div>
                                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                                {weakCnt > 0 ? `${weakCnt.toLocaleString('vi-VN')} câu thiếu` : 'Đạt chuẩn 100%'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Controls, Search, Stage Pills, Sort, CSV Export */}
                    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                            <div className="relative flex-1 min-w-0">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={tableSearch}
                                    onChange={e => setTableSearch(e.target.value)}
                                    placeholder="Tìm nội dung prompt gốc, gợi ý tối ưu, bài học, file, dự án, tool..."
                                    className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white"
                                />
                                {tableSearch && (
                                    <button
                                        type="button"
                                        onClick={() => setTableSearch('')}
                                        aria-label="Xóa từ khóa tìm kiếm"
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <div className="inline-flex items-center gap-1.5 text-xs">
                                    <Filter className="w-3.5 h-3.5 text-slate-500" />
                                    <select
                                        value={tableSort}
                                        onChange={e => setTableSort(e.target.value as PromptTableSortKey)}
                                        aria-label="Sắp xếp bảng Prompt"
                                        className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer"
                                    >
                                        <option value="newest">Mới nhất trước</option>
                                        <option value="score_asc">Điểm thấp nhất (Ưu tiên tối ưu)</option>
                                        <option value="score_desc">Điểm cao nhất (Tham khảo mẫu tốt)</option>
                                        <option value="errors_first">Lỗi Tool / Lỗi mơ hồ lên đầu</option>
                                        <option value="chars_desc">Prompt dài nhất</option>
                                    </select>
                                </div>

                                <select
                                    value={tableLimit}
                                    onChange={e => setTableLimit(Number(e.target.value) || 30)}
                                    aria-label="Số dòng mỗi trang"
                                    className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-800 dark:text-slate-100 cursor-pointer tabular-nums"
                                >
                                    <option value={20}>20 dòng</option>
                                    <option value={30}>30 dòng</option>
                                    <option value={50}>50 dòng</option>
                                </select>

                                <button
                                    type="button"
                                    onClick={() => void handleExportPromptsCsv()}
                                    disabled={exportingCsv || (promptsData?.total ?? 0) === 0}
                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-extrabold cursor-pointer disabled:opacity-50"
                                >
                                    <Download className="w-3.5 h-3.5" />
                                    <span>{exportingCsv ? 'Đang xuất...' : 'Xuất CSV'}</span>
                                </button>
                            </div>
                        </div>

                        {/* Stage Filter Pills */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
                            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                                <span className="font-bold text-slate-500 dark:text-slate-400 mr-1">Giai đoạn:</span>
                                <button
                                    type="button"
                                    onClick={() => setTableStage('all')}
                                    className={`px-2.5 py-1 rounded-lg font-bold border cursor-pointer ${
                                        tableStage === 'all'
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    Tất cả ({(promptsData?.facets?.total_unfiltered ?? 0).toLocaleString('vi-VN')})
                                </button>
                                {(promptsData?.facets?.stage_counts || []).map(st => {
                                    const active = tableStage === st.stage;
                                    return (
                                        <button
                                            key={st.stage}
                                            type="button"
                                            onClick={() => setTableStage(prev => (prev === st.stage ? 'all' : st.stage))}
                                            className={`px-2.5 py-1 rounded-lg font-bold border cursor-pointer transition-colors ${
                                                active
                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                    : STAGE_PILL_CLS[st.stage] ||
                                                      'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                            }`}
                                        >
                                            {st.label} ({st.count.toLocaleString('vi-VN')})
                                        </button>
                                    );
                                })}
                            </div>

                            {(tableStage !== 'all' || tableLevel !== 'all' || tableWeakDim !== 'all' || tableOnlyErrors || tableSearch) && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTableStage('all');
                                        setTableLevel('all');
                                        setTableWeakDim('all');
                                        setTableOnlyErrors(false);
                                        setTableSearch('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-extrabold cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                    <span>Xóa bộ lọc bảng</span>
                                </button>
                            )}
                        </div>

                        {promptsError && (
                            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 p-3 flex items-center justify-between gap-2 text-xs font-bold text-rose-800 dark:text-rose-200">
                                <span>{promptsError}</span>
                                <button
                                    type="button"
                                    onClick={() => void loadPromptsTable(false)}
                                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold cursor-pointer"
                                >
                                    Tải lại
                                </button>
                            </div>
                        )}

                        {promptsLoading && !promptsData ? (
                            <div className="py-10 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                                Đang chấm điểm và tổng hợp bảng Prompt…
                            </div>
                        ) : !promptsData || promptsData.items.length === 0 ? (
                            <div className="py-10 text-center space-y-2 text-xs text-slate-500 dark:text-slate-400">
                                <Table2 className="w-8 h-8 mx-auto text-slate-400" />
                                <div className="font-bold text-slate-700 dark:text-slate-200">
                                    Không có câu Prompt nào khớp bộ lọc hiện tại.
                                </div>
                                <div>Thử đổi khoảng thời gian sang 7 ngày / 30 ngày hoặc xóa bớt bộ lọc chiều Rubric.</div>
                            </div>
                        ) : (
                            <>
                                {/* DESKTOP VISUAL TABLE */}
                                <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                    <table className="w-full text-left border-collapse text-xs">
                                        <thead className="bg-slate-50 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                                            <tr>
                                                <th className="py-2.5 px-3 font-extrabold w-[155px]">Thời gian &amp; Nguồn</th>
                                                <th className="py-2.5 px-3 font-extrabold min-w-[230px]">Nội dung Prompt gốc</th>
                                                <th className="py-2.5 px-3 font-extrabold w-[210px]">Chấm điểm &amp; 7 Chiều</th>
                                                <th className="py-2.5 px-3 font-extrabold min-w-[220px]">Đánh giá &amp; Bài học</th>
                                                <th className="py-2.5 px-3 font-extrabold min-w-[270px]">Gợi ý Tối ưu 1-Phát</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {promptsData.items.map((row, rIdx) => {
                                                const tm = TOOL_LABELS[row.tool] || {
                                                    label: row.tool,
                                                    badgeCls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
                                                };
                                                const missingDims = RUBRIC_DIMENSIONS.filter(d => {
                                                    const chk = (row.checks || []).find(c => c.key === d.key);
                                                    return chk && !chk.ok && chk.applicable !== false;
                                                });
                                                const timeDisplay = row.ts_iso
                                                    ? row.ts_iso.replace('T', ' ').slice(5, 16)
                                                    : row.day;
                                                const rowCopyId = `tbl-opt-${row.session_key}-${row.idx}`;
                                                return (
                                                    <tr
                                                        key={`${row.session_key}-${row.idx}-${rIdx}`}
                                                        onClick={() => setSelectedPromptIdxInPage(rIdx)}
                                                        className="align-top hover:bg-indigo-50/45 dark:hover:bg-indigo-950/20 cursor-pointer transition-colors"
                                                    >
                                                        {/* Col 1: Source & Time */}
                                                        <td className="py-3 px-3 space-y-1.5">
                                                            <div className="flex flex-wrap items-center gap-1 tabular-nums">
                                                                <span className={`px-2 py-0.5 rounded-full border font-extrabold ${tm.badgeCls}`}>
                                                                    {tm.label}
                                                                </span>
                                                                <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 font-extrabold">
                                                                    #{row.idx}
                                                                </span>
                                                            </div>
                                                            <div>
                                                                <span
                                                                    className={`inline-block px-2 py-0.5 rounded-full border font-bold ${
                                                                        STAGE_PILL_CLS[row.stage] ||
                                                                        'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                                                                    }`}
                                                                >
                                                                    {row.stage_label}
                                                                </span>
                                                            </div>
                                                            <div className="text-slate-500 dark:text-slate-400 font-semibold tabular-nums">
                                                                {timeDisplay} · {row.chars} ký tự
                                                            </div>
                                                            <button
                                                                type="button"
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    void openSessionInspector(row.session_key, false, false, 'all', row.idx);
                                                                }}
                                                                className="text-left text-indigo-700 dark:text-indigo-300 font-bold hover:underline line-clamp-2 break-words cursor-pointer"
                                                            >
                                                                {row.project ? `[${row.project}] ` : ''}
                                                                <HighlightText
                                                                    text={formatCleanSessionTitle(row.session_title, row.text_redacted, row.session_key)}
                                                                    query={tableSearch}
                                                                />
                                                            </button>
                                                        </td>

                                                        {/* Col 2: Original Prompt */}
                                                        <td className="py-3 px-3 space-y-1.5 max-w-[300px]">
                                                            <div className="text-slate-900 dark:text-slate-100 font-medium whitespace-pre-wrap break-words line-clamp-4 leading-relaxed">
                                                                <HighlightText text={row.text_redacted} query={tableSearch} />
                                                            </div>
                                                            <div className="flex flex-wrap items-center gap-1">
                                                                {row.has_image && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-200 font-bold">
                                                                        Có ảnh
                                                                    </span>
                                                                )}
                                                                {row.is_question_reply && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 font-bold">
                                                                        Trả lời AI
                                                                    </span>
                                                                )}
                                                                {row.is_short_nudge && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 font-bold">
                                                                        Nhắc ngắn
                                                                    </span>
                                                                )}
                                                                {row.is_vague_error && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-200 font-bold">
                                                                        Báo lỗi thiếu log
                                                                    </span>
                                                                )}
                                                                {row.had_tool_error && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white font-extrabold">
                                                                        ⚠ Gây lỗi tool
                                                                    </span>
                                                                )}
                                                                {row.tool_call_count > 0 && (
                                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold tabular-nums">
                                                                        {row.tool_call_count} tool
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>

                                                        {/* Col 3: Score + 7-Dim Micro Matrix */}
                                                        <td className="py-3 px-3 space-y-2">
                                                            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                                                                <span className={`px-2.5 py-0.5 rounded-full border font-black ${promptScoreBadgeCls(row.score)}`}>
                                                                    {row.score}/100đ
                                                                </span>
                                                                {row.ai_scored && (
                                                                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-extrabold">
                                                                        AI chấm
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="grid grid-cols-7 gap-1 tabular-nums">
                                                                {RUBRIC_DIMENSIONS.map(d => {
                                                                    const chk = (row.checks || []).find(c => c.key === d.key);
                                                                    const dimVal = Number(row.dimension_scores?.[d.key] ?? (chk?.ok ? 100 : 25));
                                                                    const isApp = chk?.applicable !== false;
                                                                    const isOk = chk ? chk.ok : dimVal >= 75;
                                                                    const cellCls = !isApp
                                                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700'
                                                                        : isOk
                                                                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                                                                          : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700';
                                                                    return (
                                                                        <span
                                                                            key={d.key}
                                                                            title={`${d.label}: ${dimVal}/100 (${!isApp ? 'Không bắt buộc ở giai đoạn này' : isOk ? 'Đạt' : 'Thiếu'})`}
                                                                            className={`text-center py-0.5 rounded border font-extrabold text-xs ${cellCls}`}
                                                                        >
                                                                            {d.short}
                                                                        </span>
                                                                    );
                                                                })}
                                                            </div>
                                                            {missingDims.length > 0 && (
                                                                <div className="text-xs font-bold text-rose-700 dark:text-rose-300">
                                                                    Thiếu: {missingDims.map(m => m.label).join(', ')}
                                                                </div>
                                                            )}
                                                        </td>

                                                        {/* Col 4: Verdict, HRPO & Lesson */}
                                                        <td className="py-3 px-3 space-y-1.5 max-w-[270px]">
                                                            <div className="font-extrabold text-slate-900 dark:text-white">
                                                                {row.verdict}
                                                            </div>
                                                            {row.root_cause_type && (
                                                                <div className="inline-block px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 font-bold">
                                                                    {ROOT_CAUSE_LABELS[row.root_cause_type] || row.root_cause_type}
                                                                </div>
                                                            )}
                                                            {row.merge_with && row.merge_with.length > 0 && (
                                                                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/50 text-violet-800 dark:text-violet-200 font-bold">
                                                                    <Link2 className="w-3 h-3" />
                                                                    <span>Nên gộp câu #{row.merge_with.join(', #')}</span>
                                                                </div>
                                                            )}
                                                            <div className="text-slate-700 dark:text-slate-300 line-clamp-3 leading-relaxed">
                                                                <HighlightText text={row.lesson} query={tableSearch} />
                                                            </div>
                                                        </td>

                                                        {/* Col 5: Improved Prompt + Quick Actions */}
                                                        <td className="py-3 px-3 space-y-2 max-w-[340px]">
                                                            <div className="rounded-lg bg-emerald-50/90 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 p-2 text-emerald-950 dark:text-emerald-100 line-clamp-3 whitespace-pre-wrap break-words leading-relaxed">
                                                                <HighlightText
                                                                    text={row.improved_prompt || 'Prompt đã đạt chuẩn rõ ràng.'}
                                                                    query={tableSearch}
                                                                />
                                                            </div>
                                                            <div
                                                                onClick={e => e.stopPropagation()}
                                                                className="flex flex-wrap items-center gap-1.5"
                                                            >
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setSelectedPromptIdxInPage(rIdx)}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                                                                >
                                                                    <Eye className="w-3.5 h-3.5" />
                                                                    <span>So sánh</span>
                                                                </button>
                                                                {row.improved_prompt && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleCopy(
                                                                                row.improved_prompt,
                                                                                rowCopyId,
                                                                                `Đã copy gợi ý tối ưu Prompt #${row.idx}!`
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                                    >
                                                                        {copiedId === rowCopyId ? (
                                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                                        ) : (
                                                                            <Copy className="w-3.5 h-3.5" />
                                                                        )}
                                                                        <span>Copy</span>
                                                                    </button>
                                                                )}
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        navigateToOptimizerWithPrompt(
                                                                            row.text_redacted,
                                                                            row.tool || 'all',
                                                                            row.session_key
                                                                        )
                                                                    }
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-bold cursor-pointer"
                                                                >
                                                                    <Wand2 className="w-3.5 h-3.5" />
                                                                    <span>Sửa AI</span>
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                {/* MOBILE CARD STACK (< 768px) */}
                                <div className="md:hidden space-y-3">
                                    {promptsData.items.map((row, rIdx) => {
                                        const tm = TOOL_LABELS[row.tool] || {
                                            label: row.tool,
                                            badgeCls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
                                        };
                                        const rowCopyId = `mob-opt-${row.session_key}-${row.idx}`;
                                        return (
                                            <div
                                                key={`mob-${row.session_key}-${row.idx}-${rIdx}`}
                                                onClick={() => setSelectedPromptIdxInPage(rIdx)}
                                                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/60 p-3 space-y-2 text-xs cursor-pointer"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-1.5 tabular-nums">
                                                    <div className="flex flex-wrap items-center gap-1">
                                                        <span className={`px-2 py-0.5 rounded-full border font-extrabold ${tm.badgeCls}`}>
                                                            {tm.label}
                                                        </span>
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-extrabold text-slate-800 dark:text-slate-100">
                                                            #{row.idx}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded-full border font-bold ${STAGE_PILL_CLS[row.stage] || ''}`}>
                                                            {row.stage_label}
                                                        </span>
                                                    </div>
                                                    <span className={`px-2.5 py-0.5 rounded-full border font-black ${promptScoreBadgeCls(row.score)}`}>
                                                        {row.score}/100đ
                                                    </span>
                                                </div>

                                                <div className="text-slate-900 dark:text-white font-medium whitespace-pre-wrap break-words line-clamp-3">
                                                    {row.text_redacted}
                                                </div>

                                                <div className="grid grid-cols-7 gap-1 tabular-nums">
                                                    {RUBRIC_DIMENSIONS.map(d => {
                                                        const chk = (row.checks || []).find(c => c.key === d.key);
                                                        const isApp = chk?.applicable !== false;
                                                        const isOk = chk ? chk.ok : true;
                                                        const cellCls = !isApp
                                                            ? 'bg-slate-100 dark:bg-slate-900 text-slate-400 border-slate-200 dark:border-slate-700'
                                                            : isOk
                                                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                                                              : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 border-rose-300 dark:border-rose-700';
                                                        return (
                                                            <span
                                                                key={d.key}
                                                                className={`text-center py-0.5 rounded border font-extrabold text-xs ${cellCls}`}
                                                            >
                                                                {d.short}
                                                            </span>
                                                        );
                                                    })}
                                                </div>

                                                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-2.5 py-1.5 text-amber-950 dark:text-amber-200">
                                                    <strong>{row.verdict}:</strong> {row.lesson}
                                                </div>

                                                {row.improved_prompt && (
                                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1.5 text-emerald-950 dark:text-emerald-100 line-clamp-2">
                                                        <strong>✨ Gợi ý:</strong> {row.improved_prompt}
                                                    </div>
                                                )}

                                                <div
                                                    onClick={e => e.stopPropagation()}
                                                    className="flex flex-wrap items-center justify-between gap-2 pt-1"
                                                >
                                                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                                                        {row.day} · {row.chars} ký tự
                                                    </span>
                                                    <div className="flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={() => setSelectedPromptIdxInPage(rIdx)}
                                                            className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-extrabold cursor-pointer"
                                                        >
                                                            So sánh
                                                        </button>
                                                        {row.improved_prompt && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(row.improved_prompt, rowCopyId)}
                                                                className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                            >
                                                                Copy
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Pagination Footer */}
                                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs tabular-nums">
                                    <div className="text-slate-600 dark:text-slate-300 font-semibold">
                                        Đang xem{' '}
                                        <strong>
                                            {((promptsData.page - 1) * promptsData.limit + 1).toLocaleString('vi-VN')}–
                                            {Math.min(promptsData.total, promptsData.page * promptsData.limit).toLocaleString('vi-VN')}
                                        </strong>{' '}
                                        trên tổng <strong>{promptsData.total.toLocaleString('vi-VN')}</strong> câu Prompt
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <button
                                            type="button"
                                            disabled={promptsData.page <= 1}
                                            onClick={() => setTablePage(p => Math.max(1, p - 1))}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                                        >
                                            <ChevronLeft className="w-3.5 h-3.5" />
                                            <span>Trước</span>
                                        </button>
                                        <span className="px-2.5 py-1 font-extrabold text-slate-800 dark:text-slate-100">
                                            Trang {promptsData.page} / {promptsData.total_pages}
                                        </span>
                                        <button
                                            type="button"
                                            disabled={promptsData.page >= promptsData.total_pages}
                                            onClick={() => setTablePage(p => Math.min(promptsData.total_pages, p + 1))}
                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                                        >
                                            <span>Sau</span>
                                            <ChevronRight className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* VIEW 3: SESSIONS & SMART AI DIAGNOSIS */}
            {dash && subView === 'sessions' && (
                <div
                    ref={sessionsListRef}
                    className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3.5 shadow-xs scroll-mt-4"
                >
                    {renderSpotlightSection(true)}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <div className="relative flex-1">
                            <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${sessionServerLoading ? 'text-indigo-500 animate-pulse' : 'text-slate-400'}`} />
                            <input
                                type="text"
                                value={sessionQuery}
                                onChange={e => setSessionQuery(e.target.value)}
                                placeholder="Tìm không dấu theo tiêu đề, prompt bên trong, AI chẩn đoán, file..."
                                className="w-full pl-9 pr-9 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-900 dark:text-white"
                            />
                            {sessionQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSessionQuery('')}
                                    aria-label="Xóa từ khóa tìm hội thoại"
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {sessionQuery.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setSessionSearchScope(s => (s === 'all' ? 'period' : 'all'))}
                                    className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold cursor-pointer tabular-nums ${
                                        sessionSearchScope === 'all'
                                            ? 'bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    {sessionSearchScope === 'all'
                                        ? `Toàn lịch sử · ${filteredSessions.length}${sessionServerTotal > filteredSessions.length ? `/${sessionServerTotal}` : ''}`
                                        : `Kỳ đang xem · ${filteredSessions.length}`}
                                </button>
                            )}
                            {kpiFilter !== 'all' && (
                                <button
                                    type="button"
                                    onClick={() => setKpiFilter('all')}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-100 dark:bg-indigo-950/70 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 text-xs font-extrabold cursor-pointer"
                                >
                                    <span>
                                        {kpiFilter === 'over_limit' ? 'Đang lọc: Phiên vượt ngưỡng' : 'Đang lọc: Phiên tiết kiệm nhiều'}
                                    </span>
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {flagFilter !== 'all' && (
                                <button
                                    type="button"
                                    onClick={() => setFlagFilter('all')}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-xs font-extrabold cursor-pointer"
                                >
                                    <span>Đang lọc lỗi: {FLAG_CODE_LABELS[flagFilter] || flagFilter}</span>
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {toolFilter !== 'all' && (
                                <button
                                    type="button"
                                    onClick={() => setToolFilter('all')}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-xs font-extrabold cursor-pointer"
                                >
                                    <span>AI: {(TOOL_LABELS[toolFilter] || { label: toolFilter }).label}</span>
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                            {(
                                [
                                    ['all', 'Tất cả'],
                                    ['red', 'Vượt nặng (Đỏ)'],
                                    ['amber', 'Lưu ý (Vàng)'],
                                    ['green', 'Gọn chuẩn'],
                                ] as const
                            ).map(([sk, sl]) => (
                                <button
                                    key={sk}
                                    type="button"
                                    onClick={() => setSeverityFilter(sk)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                                        severityFilter === sk
                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                    }`}
                                >
                                    {sl}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Smart Sort Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold text-slate-500 dark:text-slate-400 mr-1">Sắp xếp:</span>
                            {(
                                [
                                    ...(period !== 'all'
                                        ? ([
                                              [
                                                  'period_prompts',
                                                  period === 'today' ? 'Nhiều nhất hôm nay' : 'Nhiều nhất trong kỳ',
                                              ],
                                          ] as Array<[SortByKey, string]>)
                                        : []),
                                    ['priority', 'Ưu tiên tối ưu'],
                                    ['recent', 'Mới hoạt động'],
                                    ['total_prompts', period === 'all' ? 'Nhiều prompt nhất' : 'Tổng tích lũy phiên'],
                                    ['hours_waste', 'Giờ thực & câu phí'],
                                ] as Array<[SortByKey, string]>
                            ).map(([sk, slabel]) => (
                                <button
                                    key={sk}
                                    type="button"
                                    onClick={() => {
                                        setSortBy(sk);
                                        setUserPickedSort(true);
                                    }}
                                    className={`px-2.5 py-1 rounded-lg font-bold border cursor-pointer transition-colors ${
                                        sortBy === sk
                                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    {slabel}
                                </button>
                            ))}
                        </div>
                        <span className="text-slate-500 dark:text-slate-400 font-bold tabular-nums">
                            Hiển thị {filteredSessions.length}/{dash.sessions.length} phiên
                        </span>
                    </div>

                    {filteredSessions.length === 0 ? (
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-8 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            Không có hội thoại nào khớp bộ lọc hiện tại.
                        </div>
                    ) : (
                        <div className="space-y-2.5">
                            {filteredSessions.map(s => {
                                const tMeta = TOOL_LABELS[s.tool] || {
                                    label: s.tool,
                                    badgeCls: 'bg-slate-100 text-slate-700 border-slate-200',
                                };
                                const sPill = severityPill(s.severity);
                                const cleanTitle = formatCleanSessionTitle(s.title, s.first_human_preview, s.session_key);
                                const pPrompts = s.period_human_prompts ?? s.day_human_prompts ?? s.n_human_prompts;
                                const pHours = s.period_active_hours ?? s.day_active_hours ?? s.clean_active_hours;
                                const isMultiDayInPeriod =
                                    period !== 'all' && (s.start_day !== s.end_day || pPrompts < s.n_human_prompts);
                                const isOverLimit = s.n_human_prompts > settings.max_prompts_per_session;
                                const savableP = isOverLimit ? s.n_human_prompts - settings.max_prompts_per_session : 0;
                                return (
                                    <div
                                        key={s.session_key}
                                        onClick={() => openSessionInspector(s.session_key, false)}
                                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 p-3.5 hover:border-indigo-400/80 transition-colors space-y-2 cursor-pointer"
                                    >
                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2.5">
                                            <div className="min-w-0 space-y-1">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className={`px-2 py-0.5 rounded-md border text-xs font-extrabold ${tMeta.badgeCls}`}>
                                                        {tMeta.label}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded-full border text-xs font-extrabold ${sPill.cls}`}>
                                                        {sPill.text} · {s.rule_score}đ
                                                    </span>
                                                    {typeof s.avg_prompt_score === 'number' && (
                                                        <span
                                                            className={`px-2 py-0.5 rounded-full border text-xs font-extrabold tabular-nums ${promptScoreBadgeCls(
                                                                s.avg_prompt_score
                                                            )}`}
                                                        >
                                                            TB câu: {s.avg_prompt_score}đ
                                                            {(s.weak_prompt_count || 0) > 0
                                                                ? ` · ${s.weak_prompt_count} câu cần sửa`
                                                                : ''}
                                                        </span>
                                                    )}
                                                    {isMultiDayInPeriod && (
                                                        <span className="px-2 py-0.5 rounded-full border bg-violet-50 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/60 text-xs font-bold">
                                                            Phiên cũ kéo dài
                                                        </span>
                                                    )}
                                                    {s.project && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 text-xs font-bold">
                                                            <FolderOpen className="w-3 h-3" />
                                                            {s.project}
                                                        </span>
                                                    )}
                                                    <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                                        {s.start_day === s.end_day ? s.start_day : `${s.start_day} → ${s.end_day}`}
                                                    </span>
                                                </div>
                                                <h3 className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white break-words">
                                                    <HighlightText text={cleanTitle} query={sessionQuery} />
                                                </h3>
                                                {sessionQuery.trim().length > 0 && s.matched_snippet && (
                                                    <div className="rounded-lg bg-indigo-50/70 dark:bg-indigo-950/35 border border-indigo-200/70 dark:border-indigo-800/60 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 flex flex-wrap items-center justify-between gap-2">
                                                        <span className="line-clamp-2 break-words flex-1 min-w-0">
                                                            <HighlightText text={s.matched_snippet} query={sessionQuery} />
                                                        </span>
                                                        {s.matched_turn_idx && s.matched_turn_idx > 0 && (
                                                            <button
                                                                type="button"
                                                                onClick={e => {
                                                                    e.stopPropagation();
                                                                    void openSessionInspector(s.session_key, false, false, 'all', s.matched_turn_idx ?? null);
                                                                }}
                                                                className="shrink-0 px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer tabular-nums"
                                                            >
                                                                Khớp Lượt #{s.matched_turn_idx} →
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 shrink-0 tabular-nums">
                                                <div className="text-left sm:text-right">
                                                    <div className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white">
                                                        {isMultiDayInPeriod
                                                            ? `+${pPrompts} prompt ${period === 'today' ? 'hôm nay' : 'trong kỳ'} · ${pHours}h`
                                                            : `${s.n_human_prompts} prompt · ${s.clean_active_hours}h`}
                                                    </div>
                                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                                        {isMultiDayInPeriod
                                                            ? `Tích lũy phiên: ${s.n_human_prompts}p · ${s.clean_active_hours}h · ${s.n_corr_kw} sửa`
                                                            : `Mở đầu ${s.first_human_len} ký tự · ${s.n_corr_kw} sửa`}
                                                        {(s.total_tool_calls || 0) > 0 && (
                                                            <span className="ml-1.5 text-indigo-700 dark:text-indigo-300 font-bold">
                                                                · {s.total_tool_calls} tool (tự chủ {s.max_consecutive_tool_calls || 0})
                                                                {(s.tool_error_count || 0) > 0 ? ` · ${s.tool_error_count} lỗi` : ''}
                                                            </span>
                                                        )}
                                                        {savableP > 0 && (
                                                            <span className="ml-1.5 text-emerald-700 dark:text-emerald-400 font-bold">
                                                                · Tiết kiệm ~{savableP}p
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                {isOverLimit && (
                                                    <button
                                                        type="button"
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            handleCopy(
                                                                handoffTemplate,
                                                                `handoff-${s.session_key}`,
                                                                'Đã copy lệnh tách phiên HANDOFF!'
                                                            );
                                                        }}
                                                        title="Copy lệnh yêu cầu AI xuất HANDOFF để tách phiên mới gọn nhẹ"
                                                        className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 dark:bg-amber-950/60 dark:hover:bg-amber-900/70 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 text-xs font-extrabold cursor-pointer"
                                                    >
                                                        {copiedId === `handoff-${s.session_key}` ? (
                                                            <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                        <span>Copy tách phiên</span>
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        openInAntigravityPc(s.session_key);
                                                    }}
                                                    title="Mở phiên này trong giao diện mô phỏng Antigravity PC (Song song Thật ↔ 1-Phát)"
                                                    className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold cursor-pointer"
                                                >
                                                    <GitCompare className="w-3.5 h-3.5" />
                                                    <span>Antigravity PC ↔</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        openSessionInspector(s.session_key, true);
                                                    }}
                                                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer"
                                                >
                                                    <Sparkles className="w-3.5 h-3.5" />
                                                    <span>
                                                        {s.has_ai_analysis
                                                            ? s.ai_is_fresh === false
                                                                ? 'Xem & Cập nhật AI'
                                                                : 'Xem chi tiết & AI'
                                                            : 'Mổ xẻ AI'}
                                                    </span>
                                                </button>
                                            </div>
                                        </div>

                                        {s.flags && s.flags.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                {s.flags.map((f, i) => (
                                                    <span
                                                        key={`${f.code}-${i}`}
                                                        title={f.tip}
                                                        className={`px-2 py-0.5 rounded-lg border text-xs font-bold ${
                                                            f.severity === 'red'
                                                                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
                                                                : f.severity === 'amber'
                                                                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800/60'
                                                                  : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                                                        }`}
                                                    >
                                                        {f.label}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {s.ai_summary ? (
                                            <div className="rounded-lg bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/60 px-3 py-2 text-xs text-indigo-950 dark:text-indigo-200 space-y-1">
                                                <div className="flex flex-wrap items-start justify-between gap-2">
                                                    <div>
                                                        <strong>AI Coach:</strong> {s.ai_summary}
                                                    </div>
                                                    {s.ai_is_fresh === false && s.ai_analyzing && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-200 text-xs font-bold shrink-0">
                                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                                            <span>Có prompt mới · đang cập nhật AI...</span>
                                                        </span>
                                                    )}
                                                </div>
                                                {s.ai_takeaway && (
                                                    <div className="text-amber-800 dark:text-amber-300 font-semibold">
                                                        💡 Đề xuất nhớ nhanh: {s.ai_takeaway}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (s.ai_analyzing || analyzingAiKey === s.session_key) ? (
                                            <div className="rounded-lg bg-indigo-50/70 dark:bg-indigo-950/25 border border-indigo-200/70 dark:border-indigo-800/50 px-3 py-2 text-xs font-semibold text-indigo-800 dark:text-indigo-200 flex items-center gap-2">
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                <span>AI Coach đang tự động phân tích phiên này theo thời gian thực...</span>
                                            </div>
                                        ) : null}

                                        {(s.prompt_scores_mini && s.prompt_scores_mini.length > 0) && (
                                            <div
                                                onClick={e => e.stopPropagation()}
                                                className="flex flex-wrap items-center gap-1.5 pt-0.5"
                                            >
                                                <span className="text-xs font-bold text-slate-500 dark:text-slate-400 mr-0.5">
                                                    Điểm từng câu:
                                                </span>
                                                {s.prompt_scores_mini.map(pm => (
                                                    <button
                                                        key={`${s.session_key}-pm-${pm.idx}`}
                                                        type="button"
                                                        title={`Câu #${pm.idx}: ${pm.score}/100đ (${pm.verdict})${pm.merge_with && pm.merge_with.length > 0 ? ` · Nên gộp với #${pm.merge_with.join(', #')}` : ''} — Bấm mở đúng câu này`}
                                                        onClick={e => {
                                                            e.stopPropagation();
                                                            openSessionInspector(s.session_key, false, false, 'all', pm.idx);
                                                        }}
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-extrabold tabular-nums cursor-pointer hover:ring-2 hover:ring-indigo-400/40 ${promptScoreBadgeCls(
                                                            pm.score
                                                        )}`}
                                                    >
                                                        <span>
                                                            #{pm.idx} · {pm.score}đ
                                                        </span>
                                                        {pm.merge_with && pm.merge_with.length > 0 && (
                                                            <Link2 className="w-3 h-3 shrink-0" />
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        )}

                                        {(s.top_prompt_lesson || (s.scored_prompts_preview && s.scored_prompts_preview.length > 0)) && (
                                            <div
                                                onClick={e => e.stopPropagation()}
                                                className="rounded-lg bg-amber-50/75 dark:bg-amber-950/25 border border-amber-200/80 dark:border-amber-800/60 px-3 py-2 space-y-2 text-xs"
                                            >
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    {s.top_prompt_lesson ? (
                                                        <div className="flex items-start gap-1.5 text-amber-950 dark:text-amber-200 min-w-0 flex-1">
                                                            <Lightbulb className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                                            <span className="break-words">
                                                                <strong>Bài học sát sườn:</strong> {s.top_prompt_lesson}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="font-bold text-slate-700 dark:text-slate-200">
                                                            Chấm điểm &amp; đề xuất tối ưu từng câu ngay trên thẻ
                                                        </span>
                                                    )}
                                                    {s.scored_prompts_preview && s.scored_prompts_preview.length > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={e => {
                                                                e.stopPropagation();
                                                                setExpandedCardSessions(prev => ({
                                                                    ...prev,
                                                                    [s.session_key]: !prev[s.session_key],
                                                                }));
                                                            }}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 text-indigo-700 dark:text-indigo-300 font-extrabold cursor-pointer shrink-0 tabular-nums"
                                                        >
                                                            {expandedCardSessions[s.session_key] ? (
                                                                <>
                                                                    <ChevronUp className="w-3.5 h-3.5" />
                                                                    <span>Ẩn điểm &amp; bài học từng câu</span>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <ChevronDown className="w-3.5 h-3.5" />
                                                                    <span>
                                                                        Xem điểm &amp; bài học từng câu ({s.scored_prompts_preview.length}/
                                                                        {s.n_human_prompts})
                                                                    </span>
                                                                </>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>

                                                {expandedCardSessions[s.session_key] &&
                                                    s.scored_prompts_preview &&
                                                    s.scored_prompts_preview.length > 0 && (
                                                        <div className="space-y-2 pt-2 border-t border-amber-200/70 dark:border-amber-800/60">
                                                            {s.scored_prompts_preview.map(p => {
                                                                const cardCopyId = `card-opt-${s.session_key}-${p.idx}`;
                                                                return (
                                                                    <div
                                                                        key={`${s.session_key}-prev-${p.idx}`}
                                                                        className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 space-y-1.5"
                                                                    >
                                                                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                                                                            <div className="flex flex-wrap items-center gap-1.5 tabular-nums">
                                                                                <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-extrabold text-slate-800 dark:text-slate-100">
                                                                                    #{p.idx}
                                                                                </span>
                                                                                <span
                                                                                    className={`px-2 py-0.5 rounded-full border font-extrabold ${promptScoreBadgeCls(
                                                                                        p.score
                                                                                    )}`}
                                                                                >
                                                                                    {p.score}/100đ · {p.verdict}
                                                                                </span>
                                                                                {p.ai_scored && (
                                                                                    <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold">
                                                                                        AI chấm
                                                                                    </span>
                                                                                )}
                                                                                {p.merge_with && p.merge_with.length > 0 && (
                                                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 font-bold">
                                                                                        <Link2 className="w-3 h-3" />
                                                                                        Gộp với #{p.merge_with.join(', #')}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                                                                                {p.chars} ký tự
                                                                            </span>
                                                                        </div>
                                                                        <div className="text-slate-800 dark:text-slate-200 line-clamp-2 whitespace-pre-wrap break-words">
                                                                            {p.text_redacted}
                                                                        </div>
                                                                        {p.lesson && (
                                                                            <div className="rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 px-2.5 py-1.5 text-amber-950 dark:text-amber-200">
                                                                                <strong>💡 Bài học:</strong> {p.lesson}
                                                                            </div>
                                                                        )}
                                                                        {p.improved_prompt && (
                                                                            <div className="rounded bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 px-2.5 py-1.5 text-emerald-950 dark:text-emerald-100 space-y-1">
                                                                                <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                                                                    ✨ Đề xuất tối ưu 1-Phát:
                                                                                </div>
                                                                                <div className="line-clamp-2 whitespace-pre-wrap break-words">
                                                                                    {p.improved_prompt}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                                                                            {p.improved_prompt ? (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        handleCopy(
                                                                                            p.improved_prompt,
                                                                                            cardCopyId,
                                                                                            `Đã copy bản tối ưu câu #${p.idx}!`
                                                                                        )
                                                                                    }
                                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                                                >
                                                                                    {copiedId === cardCopyId ? (
                                                                                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                                                    ) : (
                                                                                        <Copy className="w-3.5 h-3.5" />
                                                                                    )}
                                                                                    <span>Copy tối ưu</span>
                                                                                </button>
                                                                            ) : (
                                                                                <span />
                                                                            )}
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    openSessionInspector(
                                                                                        s.session_key,
                                                                                        false,
                                                                                        false,
                                                                                        'all',
                                                                                        p.idx
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer tabular-nums"
                                                                            >
                                                                                <span>Mở chi tiết câu #{p.idx} →</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* VIEW 4: DRAFT PROMPT OPTIMIZER WORKBENCH */}
            {subView === 'optimizer' && (
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-4 shadow-xs">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                            <img src="/icons/dopamine-3d/quest_lightning.png" alt="" className="w-8 h-8 object-contain shrink-0" />
                            <div>
                                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                                    Xưởng Sửa Nháp Prompt trước khi gửi (Biến câu ngắn thành Spec 1-Phát)
                                </h2>
                                <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                                    Dán câu anh định gõ vào IDE hoặc A1 — hệ thống tự che bí mật, chấm theo Stage-aware 6×7 Rubric, hỏi làm rõ phần thiếu, tinh chỉnh 1-bấm & giả lập so sánh A/B trước khi gửi.
                                </p>
                            </div>
                        </div>
                        {returnSessionKey && (
                            <button
                                type="button"
                                onClick={() => {
                                    const backKey = returnSessionKey;
                                    setReturnSessionKey(null);
                                    if (returnSubView === 'ag_pc') {
                                        openInAntigravityPc(backKey);
                                    } else {
                                        setSubView('sessions');
                                        openSessionInspector(backKey, false);
                                    }
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 text-xs font-extrabold text-indigo-700 dark:text-indigo-300 cursor-pointer shrink-0"
                            >
                                <ArrowLeft className="w-3.5 h-3.5" />
                                <span>
                                    {returnSubView === 'ag_pc'
                                        ? 'Quay lại Giao diện Antigravity PC'
                                        : 'Quay lại Hồ sơ Phiên vừa xem'}
                                </span>
                            </button>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Thử nhanh mẫu thô:</span>
                        {[
                            'sửa giùm tôi lỗi trang báo cáo không hiện số liệu hôm nay',
                            'làm thêm bảng thống kê chi phí token ở admin chỉ tôi xem được',
                            'kiểm tra sao bot fanpage hôm nay chậm và hay rớt webhook',
                        ].map(ex => (
                            <button
                                key={ex}
                                type="button"
                                onClick={() => setDraftText(ex)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                                "{ex}"
                            </button>
                        ))}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Công cụ đích</span>
                            <select
                                value={draftTool}
                                onChange={e => setDraftTool(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                            >
                                <option value="all">Tất cả (Antigravity / Claude / Codex)</option>
                                <option value="antigravity">Antigravity</option>
                                <option value="claude">Claude Code</option>
                                <option value="codex">Codex CLI / Desktop</option>
                            </select>
                        </label>
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-600 dark:text-slate-300">Loại công việc</span>
                            <select
                                value={draftGoalType}
                                onChange={e => setDraftGoalType(e.target.value)}
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                            >
                                <option value="feature">Tính năng mới / UI</option>
                                <option value="bugfix">Sửa lỗi / Debug</option>
                                <option value="audit">Kiểm toán / Review</option>
                                <option value="deploy">Deploy / Hạ tầng VPS</option>
                            </select>
                        </label>
                        <label className="block space-y-1 text-xs">
                            <span className="font-bold text-slate-600 dark:text-slate-300">File / Route gợi ý (không bắt buộc)</span>
                            <input
                                type="text"
                                value={draftFiles}
                                onChange={e => setDraftFiles(e.target.value)}
                                placeholder="Ví dụ: MemberPortal.tsx, https://aihot.vn"
                                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                            />
                        </label>
                    </div>

                    <textarea
                        rows={4}
                        value={draftText}
                        onChange={e => setDraftText(e.target.value)}
                        placeholder="Nhập câu lệnh thô bạn đang định gửi..."
                        className="w-full p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                            Bí mật / API key / mật khẩu trong nháp sẽ được tự động che trước khi gọi AI nội bộ.
                        </span>
                        <button
                            type="button"
                            onClick={() => void handleOptimizeDraft()}
                            disabled={optimizingDraft || draftText.trim().length < 4}
                            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs sm:text-sm font-extrabold shadow-xs cursor-pointer"
                        >
                            <Wand2 className={`w-4 h-4 ${optimizingDraft ? 'animate-spin' : ''}`} />
                            <span>{optimizingDraft ? 'AI đang chấm & viết lại...' : 'Chấm điểm & Viết lại 1-Phát'}</span>
                        </button>
                    </div>

                    {draftResult && (
                        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                            {draftResult.safety_warning && (
                                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-900 dark:text-rose-200 font-semibold">
                                    <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                                    <span>
                                        <strong>Cảnh báo An toàn Dữ liệu / Deploy:</strong> Câu nháp chạm DB, xóa dữ liệu hoặc deploy VPS nhưng chưa có rào an toàn (backup / dry-run / không chạm file khác). Bản viết lại bên dưới đã tự chèn rào bảo vệ.
                                    </span>
                                </div>
                            )}

                            {/* Score + 7-Dim Rubric Checklist + Weaknesses */}
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-bold">
                                        <span className="text-slate-600 dark:text-slate-300">Điểm Rubric nháp gốc</span>
                                        <div className="flex items-center gap-1.5">
                                            {draftResult.stage_label && (
                                                <span
                                                    className={`px-2 py-0.5 rounded-full border text-xs font-extrabold ${
                                                        STAGE_PILL_CLS[draftResult.stage || ''] ||
                                                        'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200'
                                                    }`}
                                                >
                                                    {draftResult.stage_label}
                                                </span>
                                            )}
                                            <span className="text-base font-extrabold tabular-nums text-indigo-600 dark:text-indigo-400">
                                                {draftResult.score_before}/100
                                            </span>
                                        </div>
                                    </div>
                                    <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                                        <div
                                            className={`h-full rounded-full ${
                                                draftResult.score_before >= 75
                                                    ? 'bg-emerald-500'
                                                    : draftResult.score_before >= 50
                                                      ? 'bg-amber-500'
                                                      : 'bg-rose-500'
                                            }`}
                                            style={{ width: `${Math.max(8, Math.min(100, draftResult.score_before))}%` }}
                                        />
                                    </div>
                                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                                        {draftResult.estimated_prompts_saved}
                                    </div>
                                    {draftResult.variables && draftResult.variables.length > 0 && (
                                        <div className="flex flex-wrap items-center gap-1 pt-1">
                                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Biến động:</span>
                                            {draftResult.variables.map(v => (
                                                <span
                                                    key={v}
                                                    className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 text-xs font-bold"
                                                >
                                                    {`{{${v}}}`}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {draftResult.ai_note && (
                                        <div className="text-xs text-slate-500 dark:text-slate-400">{draftResult.ai_note}</div>
                                    )}
                                </div>

                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-1.5">
                                    <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                        Rubric 7 Tiêu chí ({draftResult.stage_label || 'Prompt 1-Phát'})
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-1">
                                        {draftResult.checklist
                                            .filter(c => c.applicable !== false || !c.ok)
                                            .map(c => (
                                                <div key={c.key} className="flex items-center gap-2 text-xs">
                                                    {c.ok ? (
                                                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                                    ) : (
                                                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                                    )}
                                                    <span className={c.ok ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-amber-700 dark:text-amber-300 font-bold'}>
                                                        {c.label}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                </div>

                                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-1.5">
                                    <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">Lý do nháp gốc dễ tốn nhiều lượt</div>
                                    <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                        {draftResult.weaknesses.map((w, idx) => (
                                            <li key={idx}>{w}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            {/* Interactive Clarifying Questions Panel */}
                            {draftResult.clarifying_questions && draftResult.clarifying_questions.length > 0 && (
                                <div className="rounded-xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/60 p-3.5 space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="text-xs font-extrabold text-amber-900 dark:text-amber-200">
                                            🎯 Làm rõ nhanh phần nháp còn thiếu để chốt Prompt sát ý 100%
                                        </div>
                                        <button
                                            type="button"
                                            disabled={optimizingDraft}
                                            onClick={() => void handleOptimizeDraft(draftText, draftTool, activeRefineMode, clarifyAnswers)}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold cursor-pointer disabled:opacity-60"
                                        >
                                            <Wand2 className="w-3.5 h-3.5" />
                                            <span>Áp dụng làm rõ & Viết lại</span>
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                        {draftResult.clarifying_questions.map(q => (
                                            <div
                                                key={q.id}
                                                className="rounded-lg bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-800/50 p-2.5 space-y-1.5"
                                            >
                                                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                                                    {q.question}
                                                </div>
                                                <input
                                                    type="text"
                                                    value={clarifyAnswers[q.id] || ''}
                                                    onChange={e =>
                                                        setClarifyAnswers(prev => ({ ...prev, [q.id]: e.target.value }))
                                                    }
                                                    placeholder={q.placeholder || 'Nhập nhanh hoặc bấm gợi ý...'}
                                                    className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                                                />
                                                {q.suggestions && q.suggestions.length > 0 && (
                                                    <div className="flex flex-wrap gap-1">
                                                        {q.suggestions.map(sg => (
                                                            <button
                                                                key={sg}
                                                                type="button"
                                                                onClick={() =>
                                                                    setClarifyAnswers(prev => ({ ...prev, [q.id]: sg }))
                                                                }
                                                                className={`px-2 py-0.5 rounded-md border text-xs font-semibold cursor-pointer ${
                                                                    clarifyAnswers[q.id] === sg
                                                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                                                }`}
                                                            >
                                                                {sg}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 1-Click Refine & Dry-Run A/B Toolbar */}
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="font-bold text-slate-600 dark:text-slate-300">Tinh chỉnh 1-bấm:</span>
                                    {[
                                        ['shorter', 'Gọn hơn 40%'],
                                        ['safer', 'Thêm rào an toàn DB/Deploy'],
                                        ['stricter_done', 'Siết chặt Tiêu chí Done'],
                                    ].map(([modeKey, modeLabel]) => (
                                        <button
                                            key={modeKey}
                                            type="button"
                                            disabled={optimizingDraft}
                                            onClick={() => void handleOptimizeDraft(draftText, draftTool, modeKey, clarifyAnswers)}
                                            className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-colors disabled:opacity-60 ${
                                                activeRefineMode === modeKey
                                                    ? 'bg-indigo-600 text-white border-indigo-600'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                            }`}
                                        >
                                            {modeLabel}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    type="button"
                                    disabled={comparingDraft}
                                    onClick={() => void handleCompareDraftAB()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
                                >
                                    <GitCompare className={`w-3.5 h-3.5 ${comparingDraft ? 'animate-spin' : ''}`} />
                                    <span>{comparingDraft ? 'Đang giả lập A/B...' : 'So sánh Dry-Run A vs B'}</span>
                                </button>
                            </div>

                            {compareResult && renderAbCompareCard(compareResult)}

                            {/* Compact & Full Spec Outputs */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
                                {[
                                    { key: 'compact', title: 'Bản Gọn 1-Phát (Gửi nhanh hằng ngày)', text: draftResult.compact_prompt },
                                    { key: 'full', title: 'Bản Kỹ 1-Shot Spec (Cho việc nhiều file / nhạy cảm)', text: draftResult.full_spec_prompt },
                                ].map(out => (
                                    <div
                                        key={out.key}
                                        className="rounded-xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/40 dark:bg-indigo-950/20 p-3.5 flex flex-col justify-between gap-3"
                                    >
                                        <div className="space-y-2">
                                            <div className="text-xs sm:text-sm font-extrabold text-indigo-900 dark:text-indigo-200">
                                                {out.title}
                                            </div>
                                            <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 leading-relaxed">
                                                {out.text}
                                            </pre>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(out.text, `opt-${out.key}`)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold cursor-pointer"
                                            >
                                                {copiedId === `opt-${out.key}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                <span>Copy</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => dispatchPromptToA1(out.text)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                                            >
                                                <Send className="w-3.5 h-3.5" />
                                                <span>Đẩy sang A1</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleSavePrivatePrompt(
                                                        `Mẫu ${draftGoalType}: ${draftText.slice(0, 55)}`,
                                                        out.text,
                                                        draftGoalType,
                                                        draftTool,
                                                        draftText
                                                    )
                                                }
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                                            >
                                                <Save className="w-3.5 h-3.5" />
                                                <span>Lưu Kho Riêng</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleSaveToLessons({
                                                        tieu_de: `Mẫu viết Prompt 1-Phát: ${draftText.slice(0, 60)}`,
                                                        bai_hoc: out.text,
                                                        cau_goc: draftText,
                                                    })
                                                }
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-800 text-xs font-bold cursor-pointer"
                                            >
                                                <BookOpen className="w-3.5 h-3.5" />
                                                <span>Lưu Sổ Bài Học</span>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* VIEW 5: PRIVATE SAVED PROMPTS LIBRARY */}
            {subView === 'library' && (
                <div className="space-y-4">
                    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                        <div className="flex items-center gap-2">
                            <img src="/icons/dopamine-3d/quest_target.png" alt="" className="w-6 h-6 object-contain" />
                            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                Thêm Mẫu Prompt Chuẩn mới vào Kho Riêng Chủ Dự Án
                            </h2>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                            <input
                                type="text"
                                value={newPromptTitle}
                                onChange={e => setNewPromptTitle(e.target.value)}
                                placeholder="Tên mẫu prompt (ví dụ: Fix UI Responsive)"
                                className="sm:col-span-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                            />
                            <select
                                value={newPromptCat}
                                onChange={e => setNewPromptCat(e.target.value)}
                                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                            >
                                <option value="feature">Tính năng mới</option>
                                <option value="bugfix">Sửa lỗi</option>
                                <option value="handoff">Chốt HANDOFF</option>
                                <option value="audit">Kiểm toán</option>
                            </select>
                            <select
                                value={newPromptTool}
                                onChange={e => setNewPromptTool(e.target.value)}
                                className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                            >
                                <option value="all">Mọi AI</option>
                                <option value="antigravity">Antigravity</option>
                                <option value="claude">Claude Code</option>
                                <option value="codex">Codex</option>
                            </select>
                        </div>
                        <textarea
                            rows={3}
                            value={newPromptBody}
                            onChange={e => setNewPromptBody(e.target.value)}
                            placeholder="Nội dung Prompt chuẩn (Mục tiêu / File / Ràng buộc / Tiêu chí Done — dùng {{ten_bien}} để điền nhanh)..."
                            className="w-full p-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="font-bold text-slate-500 dark:text-slate-400">Chèn biến động:</span>
                                {['{{ten_file}}', '{{trieu_chung}}', '{{ranh_gioi}}', '{{tieu_chi_done}}'].map(vTok => (
                                    <button
                                        key={vTok}
                                        type="button"
                                        onClick={() =>
                                            setNewPromptBody(prev => (prev ? `${prev} ${vTok}` : vTok))
                                        }
                                        className="px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-bold cursor-pointer hover:bg-violet-100"
                                    >
                                        + {vTok}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                disabled={savingLibPrompt || !newPromptTitle.trim() || !newPromptBody.trim()}
                                onClick={async () => {
                                    setSavingLibPrompt(true);
                                    const ok = await handleSavePrivatePrompt(
                                        newPromptTitle.trim(),
                                        newPromptBody.trim(),
                                        newPromptCat,
                                        newPromptTool
                                    );
                                    if (ok) {
                                        setNewPromptTitle('');
                                        setNewPromptBody('');
                                    }
                                    setSavingLibPrompt(false);
                                }}
                                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
                            >
                                <Save className="w-4 h-4" />
                                <span>{savingLibPrompt ? 'Đang lưu...' : 'Lưu mẫu chuẩn'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 space-y-3 shadow-xs">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">
                                Danh sách Mẫu Prompt Chuẩn Riêng ({filteredLibrary.length})
                            </h3>
                            <div className="relative sm:w-72">
                                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={libSearch}
                                    onChange={e => setLibSearch(e.target.value)}
                                    placeholder="Lọc mẫu prompt..."
                                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {filteredLibrary.map(item => {
                                const tplVars = extractTemplateVariables(item.prompt_template);
                                const varValues = libVarValues[item.id] || {};
                                const resolvedTemplate =
                                    tplVars.length > 0
                                        ? substituteTemplateVariables(item.prompt_template, varValues)
                                        : item.prompt_template;
                                return (
                                <div
                                    key={item.id}
                                    className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 flex flex-col justify-between gap-2.5"
                                >
                                    <div className="space-y-2">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white">
                                                {item.title}
                                            </div>
                                            <div className="flex items-center gap-1 shrink-0">
                                                {tplVars.length > 0 && (
                                                    <span className="px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 text-xs font-bold tabular-nums">
                                                        {tplVars.length} biến
                                                    </span>
                                                )}
                                                <span className="px-2 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800 dark:text-indigo-200 text-xs font-bold">
                                                    {item.category}
                                                </span>
                                            </div>
                                        </div>
                                        {item.weak_example && (
                                            <div className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1.5 rounded-lg border border-rose-200/70 dark:border-rose-800/50">
                                                <strong>Tránh gõ kiểu cũ:</strong> "{item.weak_example}"
                                            </div>
                                        )}
                                        {tplVars.length > 0 && (
                                            <div className="rounded-xl bg-violet-50/70 dark:bg-violet-950/25 border border-violet-200 dark:border-violet-800/60 p-2.5 space-y-2">
                                                <div className="text-xs font-extrabold text-violet-900 dark:text-violet-200">
                                                    Điền nhanh biến động trước khi Copy / Đẩy A1:
                                                </div>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                                    {tplVars.map(vName => (
                                                        <input
                                                            key={vName}
                                                            type="text"
                                                            value={varValues[vName] || ''}
                                                            onChange={e =>
                                                                setLibVarValues(prev => ({
                                                                    ...prev,
                                                                    [item.id]: {
                                                                        ...(prev[item.id] || {}),
                                                                        [vName]: e.target.value,
                                                                    },
                                                                }))
                                                            }
                                                            placeholder={`{{${vName}}}`}
                                                            className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 text-xs text-slate-900 dark:text-white"
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        <pre className="whitespace-pre-wrap font-sans text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-2.5 leading-relaxed">
                                            {resolvedTemplate}
                                        </pre>
                                        {item.notes && (
                                            <div className="text-xs text-slate-500 dark:text-slate-400">{item.notes}</div>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(resolvedTemplate, `lib-${item.id}`)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-bold cursor-pointer"
                                            >
                                                {copiedId === `lib-${item.id}` ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                <span>{tplVars.length > 0 ? 'Copy bản đã điền' : 'Copy'}</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => dispatchPromptToA1(resolvedTemplate)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
                                            >
                                                <Send className="w-3.5 h-3.5" />
                                                <span>Đẩy sang A1</span>
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleDeletePrivatePrompt(item.id)}
                                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-xs font-bold cursor-pointer"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                            <span>Xóa</span>
                                        </button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* PROMPT ROW SIDE-OVER COMPARISON DRAWER */}
            {selectedPromptIdxInPage !== null && promptsData && promptsData.items[selectedPromptIdxInPage] && (() => {
                const row = promptsData.items[selectedPromptIdxInPage];
                const tm = TOOL_LABELS[row.tool] || {
                    label: row.tool,
                    badgeCls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300',
                };
                const rowKey = `${row.session_key}:${row.idx}`;
                const deepOpt = inlineOptResults[rowKey];
                const isDeepOptLoading = inlineOptLoadingKey === rowKey;
                const activeOptText = deepOpt
                    ? deepOpt.full_spec_prompt || deepOpt.compact_prompt
                    : row.improved_prompt || row.text_redacted;
                const abRes = drawerCompareMap[rowKey];
                const isAbLoading = drawerCompareLoadingKey === rowKey;
                return (
                    <div
                        className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex justify-end"
                        onClick={e => {
                            if (e.target === e.currentTarget) setSelectedPromptIdxInPage(null);
                        }}
                    >
                        <div className="w-full max-w-4xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden">
                            {/* Drawer Header */}
                            <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/95">
                                <div className="flex items-center gap-2 min-w-0">
                                    <img src="/icons/dopamine-3d/cat_prompt_scroll.png" alt="" className="w-6 h-6 object-contain shrink-0" />
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                                            <span className={`px-2 py-0.5 rounded-full border font-extrabold ${tm.badgeCls}`}>
                                                {tm.label}
                                            </span>
                                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 font-extrabold text-slate-800 dark:text-slate-100">
                                                Prompt #{row.idx}
                                            </span>
                                            <span className={`px-2.5 py-0.5 rounded-full border font-black ${promptScoreBadgeCls(row.score)}`}>
                                                {row.score}/100đ · {row.verdict}
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-full border font-bold ${STAGE_PILL_CLS[row.stage] || ''}`}>
                                                {row.stage_label}
                                            </span>
                                        </div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1">
                                            {row.project ? `[${row.project}] ` : ''}
                                            {formatCleanSessionTitle(row.session_title, row.text_redacted, row.session_key)} · {row.ts_iso ? row.ts_iso.replace('T', ' ').slice(0, 19) : row.day}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0 text-xs tabular-nums">
                                    <button
                                        type="button"
                                        disabled={selectedPromptIdxInPage <= 0}
                                        onClick={() => setSelectedPromptIdxInPage(i => (i !== null && i > 0 ? i - 1 : i))}
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                                    >
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                        <span>Trước</span>
                                    </button>
                                    <button
                                        type="button"
                                        disabled={selectedPromptIdxInPage >= promptsData.items.length - 1}
                                        onClick={() =>
                                            setSelectedPromptIdxInPage(i =>
                                                i !== null && i < promptsData.items.length - 1 ? i + 1 : i
                                            )
                                        }
                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold disabled:opacity-40 cursor-pointer"
                                    >
                                        <span>Sau</span>
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedPromptIdxInPage(null)}
                                        aria-label="Đóng cửa sổ so sánh"
                                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 cursor-pointer"
                                    >
                                        <X className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>

                            {/* Drawer Body */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {/* 7-Dimension Breakdown Cards */}
                                <div className="space-y-2">
                                    <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                        Chấm điểm chi tiết theo 7 Chiều Rubric
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 tabular-nums">
                                        {RUBRIC_DIMENSIONS.map(d => {
                                            const chk = (row.checks || []).find(c => c.key === d.key);
                                            const dimVal = Number(row.dimension_scores?.[d.key] ?? (chk?.ok ? 100 : 25));
                                            const isApp = chk?.applicable !== false;
                                            const isOk = chk ? chk.ok : dimVal >= 75;
                                            const cardCls = !isApp
                                                ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                                                : isOk
                                                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                                                  : 'bg-rose-50 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/70 text-rose-900 dark:text-rose-200';
                                            return (
                                                <div key={d.key} title={d.hint} className={`rounded-xl border p-2.5 space-y-1 ${cardCls}`}>
                                                    <div className="text-xs font-extrabold">{d.label}</div>
                                                    <div className="text-sm font-black">{dimVal}/100</div>
                                                    <div className="text-xs font-semibold">
                                                        {!isApp ? 'Không bắt buộc' : isOk ? '✓ Đạt' : '✕ Thiếu'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Verdict & HRPO Execution Trace */}
                                <div className="rounded-xl bg-amber-50/85 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 p-3.5 space-y-2 text-xs">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-extrabold text-amber-900 dark:text-amber-200">
                                            💡 Đánh giá &amp; Bài học: {row.verdict}
                                        </span>
                                        {row.root_cause_type && (
                                            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-200 font-bold">
                                                {ROOT_CAUSE_LABELS[row.root_cause_type] || row.root_cause_type}
                                            </span>
                                        )}
                                        {row.merge_with && row.merge_with.length > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 font-bold">
                                                <Link2 className="w-3 h-3" />
                                                Gộp với #{row.merge_with.join(', #')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-amber-950 dark:text-amber-100 leading-relaxed">{row.lesson}</div>
                                    {(row.tools_triggered.length > 0 || row.assistant_err_snippet) && (
                                        <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/50 space-y-1.5">
                                            {row.tools_triggered.length > 0 && (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <span className="font-bold text-slate-600 dark:text-slate-300">Tool AI đã gọi:</span>
                                                    {row.tools_triggered.map((tn, ti) => (
                                                        <span
                                                            key={`${tn}-${ti}`}
                                                            className="px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200"
                                                        >
                                                            {tn}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {row.assistant_err_snippet && (
                                                <div className="rounded-lg bg-rose-100/90 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 px-2.5 py-1.5 text-rose-900 dark:text-rose-200 break-words">
                                                    <strong>⚠ Lỗi Assistant phát sinh:</strong> {row.assistant_err_snippet}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Side-by-Side Original vs Optimized */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 text-xs">
                                    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 p-3.5 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-extrabold text-slate-800 dark:text-slate-100">
                                                Trước (Prompt gốc · {row.chars} ký tự)
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => handleCopy(row.text_redacted, `drw-orig-${rowKey}`)}
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold cursor-pointer"
                                            >
                                                <Copy className="w-3 h-3" />
                                                <span>Copy gốc</span>
                                            </button>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words font-sans text-slate-800 dark:text-slate-100 leading-relaxed">
                                            {row.text_redacted}
                                        </pre>
                                    </div>

                                    <div className="rounded-xl bg-emerald-50/85 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 p-3.5 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-extrabold text-emerald-800 dark:text-emerald-300">
                                                {deepOpt
                                                    ? `✨ Sau (AI Spec chuyên sâu · ${deepOpt.estimated_prompts_saved})`
                                                    : '✨ Sau (Gợi ý tối ưu 1-Phát)'}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleCopy(
                                                        activeOptText,
                                                        `drw-opt-${rowKey}`,
                                                        `Đã copy gợi ý tối ưu Prompt #${row.idx}!`
                                                    )
                                                }
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                            >
                                                {copiedId === `drw-opt-${rowKey}` ? (
                                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                ) : (
                                                    <Copy className="w-3.5 h-3.5" />
                                                )}
                                                <span>Copy tối ưu</span>
                                            </button>
                                        </div>
                                        <pre className="whitespace-pre-wrap break-words font-sans text-slate-900 dark:text-white font-medium leading-relaxed">
                                            {activeOptText}
                                        </pre>
                                    </div>
                                </div>

                                {/* Optional Dry-Run A/B Comparison Result inside Drawer */}
                                {abRes && renderAbCompareCard(abRes)}
                            </div>

                            {/* Drawer Footer Actions */}
                            <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/95 flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                        type="button"
                                        disabled={isDeepOptLoading}
                                        onClick={() =>
                                            void handleInlineOptimizePrompt(
                                                row.session_key,
                                                row.idx,
                                                row.text_redacted,
                                                row.tool,
                                                row.project
                                            )
                                        }
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                    >
                                        {isDeepOptLoading ? (
                                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                        ) : (
                                            <Sparkles className="w-3.5 h-3.5" />
                                        )}
                                        <span>{isDeepOptLoading ? 'AI đang viết Spec...' : 'AI viết Spec sâu'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        disabled={isAbLoading}
                                        onClick={() => void handleDrawerCompareAB(row, activeOptText)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                    >
                                        <GitCompare className="w-3.5 h-3.5" />
                                        <span>{isAbLoading ? 'Đang giả lập A/B...' : 'So sánh A/B'}</span>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedPromptIdxInPage(null);
                                            navigateToOptimizerWithPrompt(row.text_redacted, row.tool || 'all', row.session_key);
                                        }}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold cursor-pointer hover:border-indigo-400"
                                    >
                                        <Wand2 className="w-3.5 h-3.5" />
                                        <span>Đưa vào Xưởng Nháp</span>
                                    </button>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() =>
                                            handleSavePrivatePrompt(
                                                `Tối ưu #${row.idx}: ${formatCleanSessionTitle(row.session_title, row.text_redacted, row.session_key).slice(0, 42)}`,
                                                activeOptText,
                                                '1-shot',
                                                row.tool,
                                                row.text_redacted,
                                                row.lesson
                                            )
                                        }
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                    >
                                        <Save className="w-3.5 h-3.5" />
                                        <span>Lưu Kho</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => dispatchPromptToA1(activeOptText)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                    >
                                        <Send className="w-3.5 h-3.5" />
                                        <span>Đẩy sang A1</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => openInAntigravityPc(row.session_key)}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                                    >
                                        <GitCompare className="w-3.5 h-3.5" />
                                        <span>Antigravity PC ↔</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedPromptIdxInPage(null);
                                            void openSessionInspector(row.session_key, false, false, 'all', row.idx);
                                        }}
                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-extrabold cursor-pointer"
                                    >
                                        <FolderOpen className="w-3.5 h-3.5" />
                                        <span>Mở cả Hội thoại</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* SESSION INSPECTOR MODAL / DRAWER */}
            {inspectKey && (
                <div
                    className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
                    onClick={e => {
                        if (e.target === e.currentTarget) setInspectKey(null);
                    }}
                >
                    <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden">
                        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/95">
                            <div className="flex items-center gap-2 min-w-0">
                                <img src="/icons/dopamine-3d/quest_brain.png" alt="" className="w-6 h-6 object-contain shrink-0" />
                                <div className="min-w-0">
                                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                                        {inspectDetail
                                            ? formatCleanSessionTitle(
                                                  inspectDetail.title,
                                                  inspectDetail.first_human_preview,
                                                  inspectDetail.session_key
                                              )
                                            : 'Mổ xẻ Phiên & Viết lại Prompt'}
                                    </h3>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 truncate tabular-nums">
                                        {inspectKey}
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setInspectKey(null)}
                                aria-label="Đóng chi tiết phiên"
                                className="p-2 rounded-xl bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                            {inspectLoading || !inspectDetail ? (
                                <div className="py-10 text-center space-y-2">
                                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        Đang tải lịch sử prompt đã che bí mật...
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Metrics Summary Strip + Full Session Metadata */}
                                    <div className="space-y-2.5">
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums">
                                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                                <div className="text-xs text-slate-500 dark:text-slate-400">Prompt thực / Tổng raw</div>
                                                <div className="text-base font-extrabold text-slate-900 dark:text-white">
                                                    {inspectDetail.n_human_prompts}p{' '}
                                                    <span className="text-xs font-medium text-slate-500">
                                                        / {inspectDetail.n_raw_msgs} raw ({inspectDetail.n_auto_msgs} auto-lọc)
                                                    </span>
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                                <div className="text-xs text-slate-500 dark:text-slate-400">Giờ thực / Kéo dài</div>
                                                <div className="text-base font-extrabold text-slate-900 dark:text-white">
                                                    {inspectDetail.clean_active_hours}h{' '}
                                                    <span className="text-xs font-medium text-slate-500">({inspectDetail.wall_hours}h lịch)</span>
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                                <div className="text-xs text-slate-500 dark:text-slate-400">Nhắc ngắn / Báo lỗi / Sửa</div>
                                                <div className="text-base font-extrabold text-amber-600 dark:text-amber-400">
                                                    {inspectDetail.n_short_nudges} / {inspectDetail.n_vague_errors} / {inspectDetail.n_corr_kw}
                                                </div>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                                <div className="text-xs text-slate-500 dark:text-slate-400">Điểm Rule Engine</div>
                                                <div className="text-base font-extrabold text-indigo-600 dark:text-indigo-400">
                                                    {inspectDetail.rule_score}/100{' '}
                                                    <span className="text-xs font-medium text-slate-500">
                                                        (Mở đầu {inspectDetail.first_human_len} ký tự)
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300 tabular-nums">
                                            <span>
                                                <strong>Công cụ:</strong>{' '}
                                                {(TOOL_LABELS[inspectDetail.tool] || { label: inspectDetail.tool }).label}
                                                {inspectDetail.is_sub ? ' (Subagent / Tác vụ nền)' : ' (Hội thoại trực tiếp)'}
                                            </span>
                                            {inspectDetail.project && (
                                                <span>
                                                    <strong>Dự án:</strong> {inspectDetail.project}
                                                </span>
                                            )}
                                            {inspectDetail.cwd && (
                                                <span className="break-all">
                                                    <strong>Thư mục:</strong> {inspectDetail.cwd}
                                                </span>
                                            )}
                                            <span>
                                                <strong>Độ dài TB:</strong> {inspectDetail.avg_human_len} ký tự/prompt
                                            </span>
                                            <span>
                                                <strong>Tool Calls:</strong> {inspectDetail.total_tool_calls || 0} lượt (tự chủ max{' '}
                                                {inspectDetail.max_consecutive_tool_calls || 0} · lỗi tool {inspectDetail.tool_error_count || 0} · chuyển hướng{' '}
                                                {inspectDetail.redirection_count || 0})
                                            </span>
                                        </div>

                                        {(inspectDetail.ai_analysis?.focus_habit || inspectDetail.prompt_eval_summary?.focus_habit) && (
                                            <div className="rounded-xl bg-amber-50/90 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-800/60 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2 text-amber-950 dark:text-amber-200">
                                                <div>
                                                    <strong>🎯 Thói quen #1 của phiên này:</strong>{' '}
                                                    {inspectDetail.ai_analysis?.focus_habit?.title ||
                                                        inspectDetail.prompt_eval_summary?.focus_habit?.title}{' '}
                                                    —{' '}
                                                    <span className="font-semibold">
                                                        {inspectDetail.ai_analysis?.focus_habit?.action_tip ||
                                                            inspectDetail.prompt_eval_summary?.focus_habit?.action_tip}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        {/* Per-day breakdown pills inside session modal */}
                                        {inspectDetail.day_breakdown && inspectDetail.day_breakdown.length > 0 && (
                                            <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                                                <span className="font-bold text-slate-500 dark:text-slate-400">Phân bổ theo ngày:</span>
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptDayFilter('all')}
                                                    className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${
                                                        promptDayFilter === 'all'
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    Tất cả ({inspectDetail.n_human_prompts}p)
                                                </button>
                                                {inspectDetail.day_breakdown.map(db => (
                                                    <button
                                                        key={db.day}
                                                        type="button"
                                                        onClick={() => setPromptDayFilter(db.day)}
                                                        className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${
                                                            promptDayFilter === db.day
                                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                        }`}
                                                    >
                                                        {db.day}: {db.human_prompts}p · {db.active_hours}h
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* AI Deep Diagnosis Block */}
                                    <div className="rounded-2xl border border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/60 dark:bg-indigo-950/25 p-4 space-y-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm font-extrabold text-indigo-900 dark:text-indigo-200">
                                                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                                                <span>Đề xuất Thông minh từ AI Coach (Gemini Flash Nội bộ)</span>
                                                {inspectDetail.ai_analysis?.diagnosis &&
                                                    inspectDetail.ai_is_fresh === false &&
                                                    (inspectDetail.ai_analyzing || analyzingAiKey === inspectDetail.session_key) && (
                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-700 dark:text-indigo-200 text-xs font-bold">
                                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                                            <span>Đang cập nhật theo prompt mới nhất...</span>
                                                        </span>
                                                    )}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => triggerSessionAiAnalysis(inspectDetail.session_key, true, inspectDetail)}
                                                disabled={analyzingAiKey === inspectDetail.session_key}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
                                            >
                                                <RefreshCw
                                                    className={`w-3.5 h-3.5 ${analyzingAiKey === inspectDetail.session_key ? 'animate-spin' : ''}`}
                                                />
                                                <span>
                                                    {analyzingAiKey === inspectDetail.session_key
                                                        ? 'Đang phân tích...'
                                                        : inspectDetail.ai_analysis?.diagnosis
                                                          ? 'Phân tích lại'
                                                          : 'Chạy AI phân tích ngay'}
                                                </span>
                                            </button>
                                        </div>

                                        {inspectDetail.ai_analysis?.diagnosis ? (
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                                    <div className="rounded-xl bg-white dark:bg-slate-900 p-3 border border-indigo-100 dark:border-indigo-900 space-y-1">
                                                        <div
                                                            className={`font-extrabold ${
                                                                inspectDetail.severity === 'green'
                                                                    ? 'text-emerald-700 dark:text-emerald-300'
                                                                    : 'text-rose-700 dark:text-rose-300'
                                                            }`}
                                                        >
                                                            {inspectDetail.severity === 'green'
                                                                ? 'Điểm hiệu quả & Nhận xét từ AI:'
                                                                : 'Nguyên nhân gốc khiến phiên dài:'}
                                                        </div>
                                                        <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                                                            {inspectDetail.ai_analysis.diagnosis}
                                                        </p>
                                                    </div>
                                                    <div className="rounded-xl bg-white dark:bg-slate-900 p-3 border border-indigo-100 dark:border-indigo-900 space-y-1">
                                                        <div className="font-extrabold text-emerald-700 dark:text-emerald-300">
                                                            Chiến lược tách phiên (còn ~{inspectDetail.ai_analysis.est_prompts_after}p / {inspectDetail.ai_analysis.ideal_session_count} phiên):
                                                        </div>
                                                        <p className="text-slate-700 dark:text-slate-200 leading-relaxed">
                                                            {inspectDetail.ai_analysis.split_strategy}
                                                        </p>
                                                    </div>
                                                </div>

                                                {inspectDetail.ai_analysis.key_takeaway && (
                                                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-3 py-2 text-xs text-amber-950 dark:text-amber-200">
                                                        <span>
                                                            <strong>Bài học rút ra:</strong> {inspectDetail.ai_analysis.key_takeaway}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleSaveToLessons({
                                                                    tieu_de: inspectDetail.ai_analysis.key_takeaway || inspectDetail.title,
                                                                    bai_hoc: `${inspectDetail.ai_analysis.diagnosis || ''} -> ${inspectDetail.ai_analysis.split_strategy || ''}`,
                                                                    cau_goc: inspectDetail.first_human_preview,
                                                                })
                                                            }
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 text-white font-bold cursor-pointer"
                                                        >
                                                            <BookOpen className="w-3.5 h-3.5" />
                                                            <span>Lưu Sổ Bài Học</span>
                                                        </button>
                                                    </div>
                                                )}

                                                {(inspectDetail.ai_analysis.rewrite_pairs || []).length > 0 && (
                                                    <div className="space-y-2.5">
                                                        <div className="text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                                            So sánh Trực tiếp: Câu gốc yếu → Prompt 1-Phát chuẩn
                                                        </div>
                                                        {inspectDetail.ai_analysis.rewrite_pairs!.map((pair, idx) => (
                                                            <div
                                                                key={idx}
                                                                className="rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-3 space-y-2"
                                                            >
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                                                                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/50 p-2.5">
                                                                        <div className="font-extrabold text-rose-700 dark:text-rose-300 mb-1">
                                                                            Trước (Câu gốc yếu):
                                                                        </div>
                                                                        <div className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                                                                            {pair.weak_original}
                                                                        </div>
                                                                    </div>
                                                                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 p-2.5">
                                                                        <div className="font-extrabold text-emerald-700 dark:text-emerald-300 mb-1">
                                                                            Sau (Prompt 1-Phát chuẩn):
                                                                        </div>
                                                                        <div className="text-slate-900 dark:text-white whitespace-pre-wrap font-medium">
                                                                            {pair.upgraded_prompt}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                                                    <span className="text-slate-600 dark:text-slate-300">
                                                                        <strong>Vì sao nhanh hơn:</strong> {pair.why_better}
                                                                    </span>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => handleCopy(pair.upgraded_prompt, `rw-${idx}`)}
                                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                                        >
                                                                            <Copy className="w-3.5 h-3.5" />
                                                                            <span>Copy</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => dispatchPromptToA1(pair.upgraded_prompt)}
                                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold cursor-pointer"
                                                                        >
                                                                            <Send className="w-3.5 h-3.5" />
                                                                            <span>Đẩy A1</span>
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                handleSavePrivatePrompt(
                                                                                    `Từ phiên: ${inspectDetail.title.slice(0, 50)}`,
                                                                                    pair.upgraded_prompt,
                                                                                    '1-shot',
                                                                                    inspectDetail.tool,
                                                                                    pair.weak_original,
                                                                                    pair.why_better
                                                                                )
                                                                            }
                                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                                                                        >
                                                                            <Save className="w-3.5 h-3.5" />
                                                                            <span>Lưu Kho</span>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ) : (analyzingAiKey === inspectDetail.session_key || inspectDetail.ai_analyzing) ? (
                                            <div className="flex items-center gap-2.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-indigo-200 dark:border-indigo-800 px-3.5 py-2.5 text-xs font-semibold text-indigo-800 dark:text-indigo-200">
                                                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600 dark:text-indigo-400 shrink-0" />
                                                <span>
                                                    Gemini Flash đang đọc lịch sử prompt &amp; mổ xẻ realtime (~2–4 giây) — bạn có thể xem ngay từng câu bên dưới...
                                                </span>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-indigo-800 dark:text-indigo-200">
                                                Bấm <strong>Chạy AI phân tích ngay</strong> để Gemini Flash nội bộ chỉ ra điểm gãy ngữ cảnh và viết lại bộ câu lệnh 1-Phát cho phiên này.
                                            </div>
                                        )}
                                    </div>

                                    {/* Prompts Timeline — Direct per-prompt scoring, immediate lessons & inline 1-Shot optimizer */}
                                    <div className="space-y-3">
                                        <div className="flex flex-col gap-2.5">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800 dark:text-slate-100">
                                                    <Clock className="w-4 h-4 text-indigo-500" />
                                                    <span>
                                                        Chấm điểm &amp; Tối ưu từng Prompt trong phiên ({inspectDetail.prompts_sample.length} câu)
                                                    </span>
                                                </div>
                                                {inspectDetail.prompt_eval_summary && (
                                                    <div className="flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
                                                        <span
                                                            className={`px-2 py-0.5 rounded-full border font-extrabold ${promptScoreBadgeCls(
                                                                inspectDetail.prompt_eval_summary.avg_prompt_score
                                                            )}`}
                                                        >
                                                            TB câu: {inspectDetail.prompt_eval_summary.avg_prompt_score}/100đ
                                                        </span>
                                                        <span className="px-2 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 font-bold">
                                                            {inspectDetail.prompt_eval_summary.weak_prompt_count} câu cần sửa
                                                        </span>
                                                        {inspectDetail.prompt_eval_summary.mergeable_count > 0 && (
                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-bold">
                                                                <Link2 className="w-3 h-3" />
                                                                {inspectDetail.prompt_eval_summary.mergeable_count} câu nên gộp
                                                            </span>
                                                        )}
                                                        {inspectDetail.prompt_eval_summary.ai_scored_count > 0 && (
                                                            <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold">
                                                                {inspectDetail.prompt_eval_summary.ai_scored_count} câu AI chấm sâu
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptFilterMode('all')}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                        promptFilterMode === 'all'
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    Tất cả ({inspectDetail.prompts_sample.length})
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptFilterMode('weak')}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                        promptFilterMode === 'weak'
                                                            ? 'bg-rose-600 text-white border-rose-600'
                                                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                                    }`}
                                                >
                                                    Cần tối ưu &lt;75đ (
                                                    {inspectDetail.prompts_sample.filter(p => (p.score ?? 100) < 75).length}
                                                    )
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptFilterMode('merge')}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                        promptFilterMode === 'merge'
                                                            ? 'bg-violet-600 text-white border-violet-600'
                                                            : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800'
                                                    }`}
                                                >
                                                    Nên gộp (
                                                    {
                                                        inspectDetail.prompts_sample.filter(
                                                            p => (p.merge_with?.length || 0) > 0
                                                        ).length
                                                    }
                                                    )
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptFilterMode('flagged')}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                        promptFilterMode === 'flagged'
                                                            ? 'bg-amber-600 text-white border-amber-600'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    Lỗi/nhắc ngắn (
                                                    {
                                                        inspectDetail.prompts_sample.filter(
                                                            p => p.is_short_nudge || p.is_vague_error || p.is_corr_kw
                                                        ).length
                                                    }
                                                    )
                                                </button>
                                                {inspectDetail.prompts_sample.some(
                                                    p => p.idx > settings.max_prompts_per_session
                                                ) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPromptFilterMode('over_threshold')}
                                                        className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                            promptFilterMode === 'over_threshold'
                                                                ? 'bg-rose-600 text-white border-rose-600'
                                                                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                                        }`}
                                                    >
                                                        Mốc vượt #{settings.max_prompts_per_session + 1} (
                                                        {
                                                            inspectDetail.prompts_sample.filter(
                                                                p => p.idx > settings.max_prompts_per_session
                                                            ).length
                                                        }
                                                        )
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setPromptFilterMode('good')}
                                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border cursor-pointer tabular-nums ${
                                                        promptFilterMode === 'good'
                                                            ? 'bg-emerald-600 text-white border-emerald-600'
                                                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                                                    }`}
                                                >
                                                    Đạt chuẩn &gt;=80đ (
                                                    {inspectDetail.prompts_sample.filter(p => (p.score ?? 0) >= 80).length}
                                                    )
                                                </button>
                                                <div className="relative flex items-center">
                                                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                                                    <input
                                                        type="text"
                                                        value={promptSearch}
                                                        onChange={e => setPromptSearch(e.target.value)}
                                                        placeholder="Tìm không dấu trong prompt, bài học, file..."
                                                        className="pl-8 pr-7 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                                                    />
                                                    {promptSearch && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setPromptSearch('')}
                                                            aria-label="Xóa tìm prompt"
                                                            className="absolute right-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                                        >
                                                            <X className="w-3.5 h-3.5" />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-2.5">
                                            {inspectDetail.prompts_sample
                                                .filter(smp => {
                                                    if (promptDayFilter !== 'all' && smp.day !== promptDayFilter) return false;
                                                    if (promptFilterMode === 'weak' && (smp.score ?? 100) >= 75) return false;
                                                    if (
                                                        promptFilterMode === 'merge' &&
                                                        (smp.merge_with?.length || 0) === 0
                                                    ) {
                                                        return false;
                                                    }
                                                    if (promptFilterMode === 'good' && (smp.score ?? 0) < 80) return false;
                                                    if (
                                                        promptFilterMode === 'flagged' &&
                                                        !(smp.is_short_nudge || smp.is_vague_error || smp.is_corr_kw)
                                                    ) {
                                                        return false;
                                                    }
                                                    if (
                                                        promptFilterMode === 'over_threshold' &&
                                                        smp.idx <= settings.max_prompts_per_session
                                                    ) {
                                                        return false;
                                                    }
                                                    if (
                                                        promptSearch.trim() &&
                                                        !matchesAllVnTokens(
                                                            `${smp.text_redacted} ${smp.lesson || ''} ${smp.improved_prompt || ''} ${smp.assistant_summary || ''} ${(smp.files_touched || []).join(' ')}`,
                                                            promptSearch
                                                        )
                                                    ) {
                                                        return false;
                                                    }
                                                    return true;
                                                })
                                                .map((smp, idx, arr) => {
                                                    const isExp = expandedPromptIdx === smp.idx;
                                                    const isHighlighted = highlightedPromptIdx === smp.idx;
                                                    const wordCnt =
                                                        smp.words ??
                                                        (smp.text_redacted ? smp.text_redacted.trim().split(/\s+/).length : 0);
                                                    const pScore =
                                                        typeof smp.score === 'number'
                                                            ? smp.score
                                                            : smp.is_short_nudge || smp.is_vague_error
                                                              ? 45
                                                              : 80;
                                                    const pVerdict =
                                                        smp.verdict ||
                                                        (pScore >= 80
                                                            ? 'Đạt chuẩn'
                                                            : pScore >= 55
                                                              ? 'Cần bổ sung'
                                                              : 'Yếu');
                                                    const isWeakOrMerge =
                                                        pScore < 85 || Boolean(smp.merge_with && smp.merge_with.length > 0);
                                                    const optKey = `${inspectDetail.session_key}:${smp.idx}`;
                                                    const inlineOpt = inlineOptResults[optKey];
                                                    const isInlineOptLoading = inlineOptLoadingKey === optKey;
                                                    const cleanSessTitle = formatCleanSessionTitle(
                                                        inspectDetail.title,
                                                        inspectDetail.first_human_preview,
                                                        inspectDetail.session_key
                                                    );
                                                    const showThresholdDivider =
                                                        smp.idx > settings.max_prompts_per_session &&
                                                        idx === arr.findIndex(p => p.idx > settings.max_prompts_per_session);
                                                    return (
                                                        <React.Fragment key={`${smp.idx}-${idx}`}>
                                                            {showThresholdDivider && (
                                                                <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-dashed border-rose-400 dark:border-rose-700 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                                                                    <div className="font-extrabold text-rose-800 dark:text-rose-200">
                                                                        ⚡ Chạm ngưỡng {settings.max_prompts_per_session} prompt tại đây — Từ câu #{smp.idx} trở đi context phình to, nên tách sang phiên mới bằng HANDOFF
                                                                    </div>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleCopy(
                                                                                handoffTemplate,
                                                                                `handoff-divider-${inspectDetail.session_key}`,
                                                                                'Đã copy lệnh tách phiên HANDOFF!'
                                                                            )
                                                                        }
                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer shrink-0"
                                                                    >
                                                                        {copiedId === `handoff-divider-${inspectDetail.session_key}` ? (
                                                                            <Check className="w-3.5 h-3.5" />
                                                                        ) : (
                                                                            <Copy className="w-3.5 h-3.5" />
                                                                        )}
                                                                        <span>Copy HANDOFF</span>
                                                                    </button>
                                                                </div>
                                                            )}
                                                            <div
                                                                id={`coach-prompt-row-${smp.idx}`}
                                                                onClick={() =>
                                                                    setExpandedPromptIdx(prev => (prev === smp.idx ? null : smp.idx))
                                                                }
                                                                className={`rounded-xl border px-3.5 py-3 text-xs space-y-2.5 transition-all cursor-pointer scroll-mt-4 ${
                                                                    isHighlighted
                                                                        ? 'bg-amber-50/70 dark:bg-slate-800 border-amber-500 ring-2 ring-amber-400/70 shadow-md'
                                                                        : isExp
                                                                          ? 'bg-indigo-50/60 dark:bg-slate-800 border-indigo-400 dark:border-indigo-500'
                                                                          : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:border-indigo-300'
                                                                }`}
                                                            >
                                                                <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400 tabular-nums">
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 font-extrabold text-slate-800 dark:text-slate-100">
                                                                            Prompt #{smp.idx}
                                                                        </span>
                                                                        <span
                                                                            className={`px-2 py-0.5 rounded-full border font-extrabold ${promptScoreBadgeCls(
                                                                                pScore
                                                                            )}`}
                                                                        >
                                                                            {pScore}/100đ · {pVerdict}
                                                                        </span>
                                                                        {smp.stage_label && (
                                                                            <span
                                                                                className={`px-2 py-0.5 rounded-full border font-bold ${
                                                                                    STAGE_PILL_CLS[smp.stage || ''] ||
                                                                                    'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300'
                                                                                }`}
                                                                            >
                                                                                {smp.stage_label}
                                                                            </span>
                                                                        )}
                                                                        {smp.had_tool_error && (
                                                                            <span className="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950/70 text-rose-800 dark:text-rose-200 border border-rose-300 dark:border-rose-700 font-extrabold">
                                                                                ⚠ Gây lỗi tool
                                                                            </span>
                                                                        )}
                                                                        {smp.root_cause_type && ROOT_CAUSE_LABELS[smp.root_cause_type] && (
                                                                            <span className="px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 border border-violet-200 dark:border-violet-800 font-bold">
                                                                                {ROOT_CAUSE_LABELS[smp.root_cause_type]}
                                                                            </span>
                                                                        )}
                                                                        {smp.ai_scored && (
                                                                            <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold">
                                                                                AI chấm
                                                                            </span>
                                                                        )}
                                                                        {smp.merge_with && smp.merge_with.length > 0 && (
                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 border border-violet-200 dark:border-violet-800 font-bold">
                                                                                <Link2 className="w-3 h-3" />
                                                                                Gộp với #{smp.merge_with.join(', #')}
                                                                            </span>
                                                                        )}
                                                                        <span>{smp.ts_iso.replace('T', ' ').slice(0, 19)}</span>
                                                                        {typeof smp.gap_min === 'number' && smp.gap_min > 0 && (
                                                                            <span className="text-indigo-600 dark:text-indigo-300 font-bold">
                                                                                +{smp.gap_min} phút
                                                                            </span>
                                                                        )}
                                                                        <span>
                                                                            {smp.chars} ký tự · {wordCnt} từ
                                                                        </span>
                                                                        {smp.idx === 1 && smp.chars < 80 && (
                                                                            <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
                                                                                Mở đầu ngắn (&lt;80 ký tự)
                                                                            </span>
                                                                        )}
                                                                        {smp.is_short_nudge && (
                                                                            <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold">
                                                                                Nhắc ngắn
                                                                            </span>
                                                                        )}
                                                                        {smp.is_vague_error && (
                                                                            <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
                                                                                Báo lỗi thiếu log
                                                                            </span>
                                                                        )}
                                                                        {smp.is_corr_kw && !smp.is_vague_error && (
                                                                            <span className="px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-300 font-bold">
                                                                                Yêu cầu sửa lại
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                                                                        {isExp ? '▲ Thu gọn toàn văn' : '▼ Xem toàn văn & công cụ'}
                                                                    </span>
                                                                </div>

                                                                <div
                                                                    className={`text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words leading-relaxed ${
                                                                        isExp ? '' : 'line-clamp-3'
                                                                    }`}
                                                                >
                                                                    <HighlightText text={smp.text_redacted} query={promptSearch} />
                                                                </div>

                                                                {/* 7-Dimension Stage-aware Rubric Pills & HRPO Tool Trace */}
                                                                {smp.checks && smp.checks.length > 0 && (
                                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                                        {smp.checks
                                                                            .filter(chk => chk.applicable !== false || !chk.ok)
                                                                            .map(chk => (
                                                                                <span
                                                                                    key={`${smp.idx}-${chk.key}`}
                                                                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-bold ${
                                                                                        chk.ok
                                                                                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60'
                                                                                            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/60'
                                                                                    }`}
                                                                                >
                                                                                    <span>{chk.ok ? '✓' : '✗'}</span>
                                                                                    <span>{chk.label}</span>
                                                                                </span>
                                                                            ))}
                                                                        {smp.tools_triggered && smp.tools_triggered.length > 0 && (
                                                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300">
                                                                                <Wrench className="w-3 h-3 text-indigo-500" />
                                                                                <span>
                                                                                    {smp.tool_call_count || smp.tools_triggered.length} tool:{' '}
                                                                                    {smp.tools_triggered.slice(0, 4).join(', ')}
                                                                                </span>
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {smp.had_tool_error && smp.assistant_err_snippet && (
                                                                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 px-3 py-1.5 text-xs text-rose-900 dark:text-rose-200 break-words">
                                                                        <strong>⚠ Lỗi Tool/Assistant phát sinh ngay lượt này (HRPO):</strong>{' '}
                                                                        {smp.assistant_err_snippet}
                                                                    </div>
                                                                )}

                                                                {/* Always-visible Immediate Lesson Box */}
                                                                {smp.lesson && (
                                                                    <div
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 px-3 py-2 text-amber-950 dark:text-amber-200 flex flex-wrap items-start justify-between gap-2"
                                                                    >
                                                                        <div className="flex items-start gap-2 min-w-0 flex-1">
                                                                            <Lightbulb className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                                                                            <div className="min-w-0 break-words leading-relaxed">
                                                                                <strong>Bài học rút ngay:</strong> {smp.lesson}
                                                                            </div>
                                                                        </div>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() =>
                                                                                handleSaveToLessons({
                                                                                    tieu_de: `Prompt #${smp.idx}: ${pVerdict} (${pScore}đ)`,
                                                                                    bai_hoc: `${smp.lesson || ''}${smp.improved_prompt ? ` | Đề xuất 1-Phát: ${smp.improved_prompt}` : ''}`,
                                                                                    cau_goc: smp.text_redacted,
                                                                                    chuyen: `Phiên: ${cleanSessTitle}`,
                                                                                })
                                                                            }
                                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer shrink-0"
                                                                        >
                                                                            <BookOpen className="w-3.5 h-3.5" />
                                                                            <span>Lưu Sổ Bài Học</span>
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                {/* Always-open 1-Shot Upgrade for <85đ or mergeable prompts (toggleable on >=85đ via expand) */}
                                                                {smp.improved_prompt && (isWeakOrMerge || isExp) && (
                                                                    <div
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="rounded-xl bg-emerald-50/90 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 p-3 space-y-2"
                                                                    >
                                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                                            <div className="font-extrabold text-emerald-800 dark:text-emerald-300">
                                                                                ✨ Đề xuất tối ưu 1-Phát cho Câu #{smp.idx}
                                                                            </div>
                                                                            {smp.merge_with && smp.merge_with.length > 0 && (
                                                                                <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
                                                                                    Gợi ý gộp luôn cùng câu #{smp.merge_with.join(', #')} thành 1 lượt
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="text-slate-900 dark:text-white whitespace-pre-wrap break-words leading-relaxed font-medium">
                                                                            {smp.improved_prompt}
                                                                        </div>
                                                                        <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleCopy(
                                                                                        smp.improved_prompt || '',
                                                                                        `smp-opt-${inspectDetail.session_key}-${smp.idx}`,
                                                                                        `Đã copy Đề xuất 1-Phát cho Prompt #${smp.idx}!`
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                                            >
                                                                                {copiedId ===
                                                                                `smp-opt-${inspectDetail.session_key}-${smp.idx}` ? (
                                                                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                                                ) : (
                                                                                    <Copy className="w-3.5 h-3.5" />
                                                                                )}
                                                                                <span>Copy câu tối ưu</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    dispatchPromptToA1(smp.improved_prompt || '')
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                                                                            >
                                                                                <Send className="w-3.5 h-3.5" />
                                                                                <span>Đẩy sang A1</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleSavePrivatePrompt(
                                                                                        `Tối ưu #${smp.idx}: ${cleanSessTitle.slice(0, 42)}`,
                                                                                        smp.improved_prompt || '',
                                                                                        '1-shot',
                                                                                        inspectDetail.tool,
                                                                                        smp.text_redacted,
                                                                                        smp.lesson || ''
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                                                            >
                                                                                <Save className="w-3.5 h-3.5" />
                                                                                <span>Lưu Kho</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleInlineOptimizePrompt(
                                                                                        inspectDetail.session_key,
                                                                                        smp.idx,
                                                                                        smp.text_redacted,
                                                                                        inspectDetail.tool,
                                                                                        inspectDetail.project
                                                                                    )
                                                                                }
                                                                                disabled={isInlineOptLoading}
                                                                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                                                            >
                                                                                {isInlineOptLoading ? (
                                                                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                                ) : (
                                                                                    <Sparkles className="w-3.5 h-3.5" />
                                                                                )}
                                                                                <span>
                                                                                    {isInlineOptLoading
                                                                                        ? 'AI đang viết Spec...'
                                                                                        : 'AI viết Spec sâu tại chỗ'}
                                                                                </span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {/* Inline AI Deep Spec Optimizer Result (Right inside Modal Card) */}
                                                                {inlineOpt && (
                                                                    <div
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="rounded-xl bg-violet-50/90 dark:bg-violet-950/35 border border-violet-300 dark:border-violet-700 p-3 space-y-2"
                                                                    >
                                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                                            <div className="font-extrabold text-violet-900 dark:text-violet-200 flex items-center gap-1.5">
                                                                                <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                                                                                <span>
                                                                                    Bản AI Spec 1-Phát chuyên sâu · {inlineOpt.estimated_prompts_saved}
                                                                                </span>
                                                                            </div>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    setExpandedFullRewrites(prev => ({
                                                                                        ...prev,
                                                                                        [optKey]: !prev[optKey],
                                                                                    }))
                                                                                }
                                                                                className="text-xs font-extrabold text-violet-700 dark:text-violet-300 hover:underline cursor-pointer"
                                                                            >
                                                                                {expandedFullRewrites[optKey]
                                                                                    ? '▲ Hiện bản gọn'
                                                                                    : '▼ Xem Full Spec đầy đủ'}
                                                                            </button>
                                                                        </div>
                                                                        <div className="rounded-lg bg-white dark:bg-slate-900 border border-violet-200 dark:border-violet-800 p-2.5 text-slate-900 dark:text-white whitespace-pre-wrap break-words leading-relaxed">
                                                                            {expandedFullRewrites[optKey]
                                                                                ? inlineOpt.full_spec_prompt
                                                                                : inlineOpt.compact_prompt}
                                                                        </div>
                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleCopy(
                                                                                        expandedFullRewrites[optKey]
                                                                                            ? inlineOpt.full_spec_prompt
                                                                                            : inlineOpt.compact_prompt,
                                                                                        `inl-copy-${optKey}`,
                                                                                        'Đã copy Spec AI tại chỗ!'
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold cursor-pointer"
                                                                            >
                                                                                <Copy className="w-3.5 h-3.5" />
                                                                                <span>Copy Spec</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    dispatchPromptToA1(
                                                                                        expandedFullRewrites[optKey]
                                                                                            ? inlineOpt.full_spec_prompt
                                                                                            : inlineOpt.compact_prompt
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 text-white font-bold cursor-pointer"
                                                                            >
                                                                                <Send className="w-3.5 h-3.5" />
                                                                                <span>Đẩy A1</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleSavePrivatePrompt(
                                                                                        `Spec AI #${smp.idx}: ${cleanSessTitle.slice(0, 40)}`,
                                                                                        expandedFullRewrites[optKey]
                                                                                            ? inlineOpt.full_spec_prompt
                                                                                            : inlineOpt.compact_prompt,
                                                                                        '1-shot',
                                                                                        inspectDetail.tool,
                                                                                        smp.text_redacted,
                                                                                        smp.lesson || ''
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold cursor-pointer"
                                                                            >
                                                                                <Save className="w-3.5 h-3.5" />
                                                                                <span>Lưu Kho</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}

                                                                {isExp && (
                                                                    <div
                                                                        onClick={e => e.stopPropagation()}
                                                                        className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2"
                                                                    >
                                                                        {(smp.is_short_nudge ||
                                                                            smp.is_vague_error ||
                                                                            smp.is_corr_kw ||
                                                                            (smp.idx === 1 && smp.chars < 80)) && (
                                                                            <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-2.5 text-amber-900 dark:text-amber-200 space-y-1">
                                                                                <div className="font-extrabold">
                                                                                    Chẩn đoán kỹ thuật câu #{smp.idx}:
                                                                                </div>
                                                                                <ul className="list-disc pl-4 space-y-0.5">
                                                                                    {smp.idx === 1 && smp.chars < 80 && (
                                                                                        <li>
                                                                                            Câu mở đầu quá ngắn ({smp.chars} ký tự), thiếu đường dẫn file và tiêu chí nghiệm thu khiến AI phải dò hỏi nhiều vòng.
                                                                                        </li>
                                                                                    )}
                                                                                    {smp.is_short_nudge && (
                                                                                        <li>
                                                                                            Câu nhắc ngắn rời rạc ({smp.chars} ký tự) — nên gộp điều kiện tự chạy đến khi pass test ngay từ câu giao việc đầu.
                                                                                        </li>
                                                                                    )}
                                                                                    {smp.is_vague_error && (
                                                                                        <li>
                                                                                            Báo lỗi nhưng chưa đính kèm mã thoát / dòng traceback / bước tái hiện nên AI phải đoán nguyên nhân.
                                                                                        </li>
                                                                                    )}
                                                                                    {smp.is_corr_kw && (
                                                                                        <li>
                                                                                            Phát sinh yêu cầu làm lại/sửa lại do chưa khóa rõ ràng buộc (Không phá vỡ...) từ đầu.
                                                                                        </li>
                                                                                    )}
                                                                                </ul>
                                                                            </div>
                                                                        )}

                                                                        <div className="flex flex-wrap items-center gap-2">
                                                                            {(!smp.improved_prompt || !isWeakOrMerge) && (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                        handleInlineOptimizePrompt(
                                                                                            inspectDetail.session_key,
                                                                                            smp.idx,
                                                                                            smp.text_redacted,
                                                                                            inspectDetail.tool,
                                                                                            inspectDetail.project
                                                                                        )
                                                                                    }
                                                                                    disabled={isInlineOptLoading}
                                                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                                                                >
                                                                                    {isInlineOptLoading ? (
                                                                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                                                                    ) : (
                                                                                        <Sparkles className="w-3.5 h-3.5" />
                                                                                    )}
                                                                                    <span>
                                                                                        {isInlineOptLoading
                                                                                            ? 'AI đang viết Spec...'
                                                                                            : 'AI viết Spec sâu tại chỗ'}
                                                                                    </span>
                                                                                </button>
                                                                            )}
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    navigateToOptimizerWithPrompt(
                                                                                        smp.text_redacted,
                                                                                        inspectDetail.tool || 'all',
                                                                                        inspectDetail.session_key
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                                                                            >
                                                                                <Wand2 className="w-3.5 h-3.5" />
                                                                                <span>Mở ở Xưởng 1-Phát</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    handleCopy(
                                                                                        smp.text_redacted,
                                                                                        `smp-${smp.idx}`,
                                                                                        `Đã copy Prompt #${smp.idx}!`
                                                                                    )
                                                                                }
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                                                                            >
                                                                                {copiedId === `smp-${smp.idx}` ? (
                                                                                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                                                                                ) : (
                                                                                    <Copy className="w-3.5 h-3.5" />
                                                                                )}
                                                                                <span>Copy câu gốc</span>
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => dispatchPromptToA1(smp.text_redacted)}
                                                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                                                            >
                                                                                <Send className="w-3.5 h-3.5" />
                                                                                <span>Đẩy sang A1</span>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </React.Fragment>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* DAY DETAIL MODAL / DRAWER (When clicking any Day row or card) */}
            {dayModalDate && (
                <div
                    className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
                    onClick={e => {
                        if (e.target === e.currentTarget) setDayModalDate(null);
                    }}
                >
                    <div className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden">
                        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/95">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <img
                                    src="/icons/dopamine-3d/ui_calendar_heatmap.png"
                                    alt=""
                                    className="w-6 h-6 object-contain shrink-0"
                                />
                                <div className="min-w-0">
                                    <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white truncate">
                                        Chi tiết Ngày {dayModalDate} (Toàn bộ Hội thoại & Prompt trong ngày)
                                    </h3>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                        Bấm vào bất kỳ hội thoại nào bên dưới để xem danh sách câu Prompt đã gõ trong ngày {dayModalDate} hoặc mở mổ xẻ AI
                                    </div>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDayModalDate(null)}
                                aria-label="Đóng chi tiết ngày"
                                className="p-2 rounded-xl bg-slate-200/70 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                            {dayModalLoading || !dayModalData ? (
                                <div className="py-10 text-center space-y-2">
                                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                                    <div className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                        Đang tải toàn bộ hội thoại & prompt của ngày {dayModalDate}...
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {/* Day Summary KPI Strip */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 tabular-nums text-xs">
                                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                            <div className="text-slate-500 dark:text-slate-400">Prompt trực tiếp trong ngày</div>
                                            <div className="text-lg font-extrabold text-slate-900 dark:text-white">
                                                {dayModalData.summary.direct_prompts}p{' '}
                                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                                    / {dayModalData.summary.direct_sessions} phiên
                                                </span>
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                                TB {dayModalData.summary.avg_prompts_per_session}p/phiên
                                            </div>
                                        </div>
                                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                            <div className="text-slate-500 dark:text-slate-400">Tác vụ nền Subagent & Auto</div>
                                            <div className="text-lg font-extrabold text-slate-900 dark:text-white">
                                                +{dayModalData.summary.bg_prompts}p ngầm
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                                {dayModalData.summary.bg_sessions} phiên nền · {dayModalData.summary.auto_ignored} auto-lọc
                                            </div>
                                        </div>
                                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                            <div className="text-slate-500 dark:text-slate-400">Giờ làm thực & Điểm ngày</div>
                                            <div className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400">
                                                {dayModalData.summary.active_hours}h · {dayModalData.summary.efficiency_score}đ
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                                {dayModalData.summary.compliant_sessions} gọn · {dayModalData.summary.over_limit_sessions} vượt
                                            </div>
                                        </div>
                                        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/70 p-3 border border-slate-200 dark:border-slate-700">
                                            <div className="text-slate-500 dark:text-slate-400">Câu nhắc ngắn / Báo lỗi / Sửa</div>
                                            <div className="text-lg font-extrabold text-amber-600 dark:text-amber-400">
                                                {dayModalData.summary.short_nudges} / {dayModalData.summary.vague_errors} /{' '}
                                                {dayModalData.summary.corr_kw}
                                            </div>
                                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                                                Các câu làm tăng vòng lặp hội thoại
                                            </div>
                                        </div>
                                    </div>

                                    {/* Tool Breakdown Cards (Clickable to filter day sessions) */}
                                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 tabular-nums text-xs">
                                        {(['antigravity', 'claude', 'codex'] as const).map(tk => {
                                            const tb = dayModalData.by_tool?.[tk] || {
                                                direct_prompts: 0,
                                                bg_prompts: 0,
                                                direct_sessions: 0,
                                                bg_sessions: 0,
                                                active_hours: 0,
                                            };
                                            const tMeta = TOOL_LABELS[tk];
                                            const active = dayModalTool === tk;
                                            return (
                                                <div
                                                    key={tk}
                                                    onClick={() => setDayModalTool(prev => (prev === tk ? 'all' : tk))}
                                                    className={`rounded-xl border p-3 cursor-pointer transition-colors ${
                                                        active
                                                            ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-500'
                                                            : 'bg-white dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <span className={`px-2 py-0.5 rounded border font-extrabold ${tMeta.badgeCls}`}>
                                                            {tMeta.label}
                                                        </span>
                                                        <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                                            {active ? 'Đang lọc ✓' : 'Bấm lọc'}
                                                        </span>
                                                    </div>
                                                    <div className="mt-1.5 font-extrabold text-sm text-slate-900 dark:text-white">
                                                        {tb.direct_prompts} prompt trực tiếp · {tb.direct_sessions} phiên ({tb.active_hours}h)
                                                    </div>
                                                    <div className="text-slate-500 dark:text-slate-400">
                                                        +{tb.bg_prompts}p ngầm ({tb.bg_sessions} phiên subagent)
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Filter Tabs: Direct vs Subagent */}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {(
                                                [
                                                    [
                                                        'direct',
                                                        `Hội thoại trực tiếp (${dayModalData.sessions.filter(s => !s.is_sub).length})`,
                                                    ],
                                                    [
                                                        'bg',
                                                        `Tác vụ nền / Subagent (${dayModalData.sessions.filter(s => s.is_sub).length})`,
                                                    ],
                                                    ['all', `Tất cả (${dayModalData.sessions.length})`],
                                                ] as const
                                            ).map(([k, lbl]) => (
                                                <button
                                                    key={k}
                                                    type="button"
                                                    onClick={() => setDayModalSubTab(k)}
                                                    className={`px-3 py-1.5 rounded-xl text-xs font-extrabold border cursor-pointer ${
                                                        dayModalSubTab === k
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                                                    }`}
                                                >
                                                    {lbl}
                                                </button>
                                            ))}
                                            {dayModalTool !== 'all' && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDayModalTool('all')}
                                                    className="px-2.5 py-1.5 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 text-xs font-bold cursor-pointer"
                                                >
                                                    Bỏ lọc công cụ ({dayModalTool}) ×
                                                </button>
                                            )}
                                        </div>
                                        <div className="relative flex items-center min-w-[210px] sm:min-w-[260px]">
                                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                                            <input
                                                type="text"
                                                value={dayModalSearch}
                                                onChange={e => setDayModalSearch(e.target.value)}
                                                placeholder="Tìm không dấu phiên trong ngày..."
                                                className="w-full pl-8 pr-7 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white"
                                            />
                                            {dayModalSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setDayModalSearch('')}
                                                    aria-label="Xóa tìm phiên trong ngày"
                                                    className="absolute right-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* Day Sessions List */}
                                    <div className="space-y-2.5">
                                        {dayModalData.sessions
                                            .filter(s => {
                                                if (dayModalTool !== 'all' && s.tool !== dayModalTool) return false;
                                                if (dayModalSubTab === 'direct' && s.is_sub) return false;
                                                if (dayModalSubTab === 'bg' && !s.is_sub) return false;
                                                if (
                                                    dayModalSearch.trim() &&
                                                    !matchesAllVnTokens(
                                                        `${s.title} ${s.project} ${s.first_human_preview} ${s.ai_summary || ''}`,
                                                        dayModalSearch
                                                    )
                                                ) {
                                                    return false;
                                                }
                                                return true;
                                            })
                                            .map(s => {
                                                const tMeta = TOOL_LABELS[s.tool] || TOOL_LABELS.antigravity;
                                                const sPill = severityPill(s.severity);
                                                const isRowExp = expandedDaySessKey === s.session_key;
                                                return (
                                                    <div
                                                        key={s.session_key}
                                                        onClick={() =>
                                                            setExpandedDaySessKey(prev =>
                                                                prev === s.session_key ? null : s.session_key
                                                            )
                                                        }
                                                        className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/60 hover:border-indigo-400 p-3.5 space-y-2.5 transition-colors cursor-pointer"
                                                    >
                                                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                                                            <div className="min-w-0 space-y-1">
                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                    <span
                                                                        className={`px-2 py-0.5 rounded-md border text-xs font-extrabold ${tMeta.badgeCls}`}
                                                                    >
                                                                        {tMeta.label}
                                                                    </span>
                                                                    {s.is_sub && (
                                                                        <span className="px-2 py-0.5 rounded-md bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold">
                                                                            Subagent / Nền
                                                                        </span>
                                                                    )}
                                                                    <span
                                                                        className={`px-2 py-0.5 rounded-full border text-xs font-extrabold ${sPill.cls}`}
                                                                    >
                                                                        {sPill.text} · {s.rule_score}đ
                                                                    </span>
                                                                    {s.project && (
                                                                        <span className="px-2 py-0.5 rounded-md bg-slate-200/70 dark:bg-slate-700/70 text-slate-700 dark:text-slate-200 text-xs font-bold">
                                                                            {s.project}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="text-xs sm:text-sm font-extrabold text-slate-900 dark:text-white break-words">
                                                                    <HighlightText
                                                                        text={formatCleanSessionTitle(s.title, s.first_human_preview, s.session_key)}
                                                                        query={dayModalSearch}
                                                                    />
                                                                </div>
                                                                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                                                    Trong ngày {dayModalDate}:{' '}
                                                                    <strong className="text-slate-800 dark:text-slate-200">
                                                                        {s.day_human_prompts} prompt
                                                                    </strong>{' '}
                                                                    ({s.day_active_hours}h thực · {s.day_short_nudges} nhắc ngắn ·{' '}
                                                                    {s.day_vague_errors} lỗi cụt) · Tổng toàn phiên: {s.n_human_prompts}p /{' '}
                                                                    {s.clean_active_hours}h
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                                                                    {isRowExp
                                                                        ? '▲ Ẩn prompt'
                                                                        : `▼ Xem ${s.prompts_on_day?.length || 0} prompt`}
                                                                </span>
                                                                <button
                                                                    type="button"
                                                                    onClick={e => {
                                                                        e.stopPropagation();
                                                                        openSessionInspector(
                                                                            s.session_key,
                                                                            false,
                                                                            false,
                                                                            dayModalDate
                                                                        );
                                                                    }}
                                                                    className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold cursor-pointer"
                                                                >
                                                                    Mở Hồ Sơ Phiên Đầy Đủ
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {isRowExp && (
                                                            <div
                                                                onClick={e => e.stopPropagation()}
                                                                className="pt-2.5 border-t border-slate-200 dark:border-slate-700 space-y-2"
                                                            >
                                                                <div className="text-xs font-extrabold text-slate-700 dark:text-slate-200">
                                                                    Các câu Prompt đã gửi trong phiên này ({s.prompts_on_day?.length || 0} câu):
                                                                </div>
                                                                {(s.prompts_on_day || []).map((p, pi) => {
                                                                    const dScore =
                                                                        typeof p.score === 'number'
                                                                            ? p.score
                                                                            : p.is_short_nudge || p.is_vague_error
                                                                              ? 45
                                                                              : 80;
                                                                    const dVerdict =
                                                                        p.verdict ||
                                                                        (dScore >= 80
                                                                            ? 'Đạt chuẩn'
                                                                            : dScore >= 55
                                                                              ? 'Cần bổ sung'
                                                                              : 'Yếu');
                                                                    return (
                                                                        <div
                                                                            key={`${p.idx}-${pi}`}
                                                                            className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 text-xs space-y-1.5"
                                                                        >
                                                                            <div className="flex flex-wrap items-center justify-between gap-2 text-slate-500 dark:text-slate-400 tabular-nums">
                                                                                <div className="flex flex-wrap items-center gap-1.5">
                                                                                    <span className="font-extrabold text-slate-800 dark:text-slate-100">
                                                                                        #{p.idx}
                                                                                    </span>
                                                                                    <span
                                                                                        className={`px-2 py-0.5 rounded-full border font-extrabold ${promptScoreBadgeCls(
                                                                                            dScore
                                                                                        )}`}
                                                                                    >
                                                                                        {dScore}/100đ · {dVerdict}
                                                                                    </span>
                                                                                    {p.merge_with && p.merge_with.length > 0 && (
                                                                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 font-bold">
                                                                                            <Link2 className="w-3 h-3" />
                                                                                            Gộp #{p.merge_with.join(', #')}
                                                                                        </span>
                                                                                    )}
                                                                                    <span>{p.ts_iso.replace('T', ' ').slice(0, 19)}</span>
                                                                                    {typeof p.gap_min === 'number' && p.gap_min > 0 && (
                                                                                        <span className="text-indigo-600 dark:text-indigo-300 font-bold">
                                                                                            +{p.gap_min}m
                                                                                        </span>
                                                                                    )}
                                                                                    <span>{p.chars} ký tự</span>
                                                                                    {p.is_short_nudge && (
                                                                                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold">
                                                                                            Nhắc ngắn
                                                                                        </span>
                                                                                    )}
                                                                                    {p.is_vague_error && (
                                                                                        <span className="px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold">
                                                                                            Báo lỗi thiếu log
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                                <div className="flex items-center gap-2.5">
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            openSessionInspector(
                                                                                                s.session_key,
                                                                                                false,
                                                                                                false,
                                                                                                dayModalDate,
                                                                                                p.idx
                                                                                            )
                                                                                        }
                                                                                        className="text-emerald-700 dark:text-emerald-400 font-extrabold hover:underline cursor-pointer"
                                                                                    >
                                                                                        Mở câu #{p.idx} →
                                                                                    </button>
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                            navigateToOptimizerWithPrompt(
                                                                                                p.text_redacted,
                                                                                                s.tool || 'all',
                                                                                                s.session_key
                                                                                            )
                                                                                        }
                                                                                        className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                                                                                    >
                                                                                        Sửa 1-Phát →
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-slate-900 dark:text-slate-100 whitespace-pre-wrap break-words">
                                                                                {p.text_redacted}
                                                                            </div>
                                                                            {p.lesson && (
                                                                                <div className="rounded bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 px-2.5 py-1.5 text-amber-950 dark:text-amber-200">
                                                                                    <strong>💡 Bài học:</strong> {p.lesson}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPromptCoachSection;
