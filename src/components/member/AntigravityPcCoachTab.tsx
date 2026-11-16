import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ChevronUp,
    Clock,
    Copy,
    FileCode,
    Folder,
    GitCompare,
    Link2,
    Maximize2,
    MessageSquare,
    Minimize2,
    Moon,
    PanelLeft,
    Pin,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Search,
    Send,
    Sparkles,
    Sun,
    Target,
    Terminal,
    Wand2,
    Wrench,
    X,
    Zap,
} from 'lucide-react';
import { showToast } from '../common/ToastContainer';
import {
    RealtimeExecutiveReportPanel,
    type RealtimeExecutiveReport,
} from './RealtimeExecutiveReportPanel';

export interface AgPcPromptCheck {
    key: string;
    label: string;
    ok: boolean;
    applicable?: boolean;
}

export interface AgPcFocusHabit {
    code?: string;
    title: string;
    why?: string;
    action_tip: string;
    fail_count?: number;
    hit_rate_pct?: number;
}

export interface AgPcSessionSummary {
    session_key: string;
    tool: string;
    title: string;
    project: string;
    start_day: string;
    end_day: string;
    start_ts: number;
    end_ts: number;
    last_activity_ts?: number;
    is_running?: boolean;
    is_pinned?: boolean;
    n_human_prompts: number;
    clean_active_hours: number;
    total_tool_calls?: number;
    tool_error_count?: number;
    redirection_count?: number;
    first_human_preview: string;
    rule_score: number;
    severity: 'red' | 'amber' | 'green';
    has_ai_analysis: boolean;
    ai_is_fresh?: boolean;
    ai_analyzing?: boolean;
    ai_summary?: string;
    ai_takeaway?: string;
    avg_prompt_score?: number;
    weak_prompt_count?: number;
    mergeable_count?: number;
    focus_habit?: AgPcFocusHabit;
}

export interface AgPcPromptSample {
    idx: number;
    ts_iso: string;
    day: string;
    chars: number;
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
    level?: string;
    verdict?: string;
    checks?: AgPcPromptCheck[];
    lesson?: string;
    improved_prompt?: string;
    merge_with?: number[];
    ai_scored?: boolean;
}

interface AgPcSessionDetail extends AgPcSessionSummary {
    content_hash?: string;
    prompts_sample: AgPcPromptSample[];
    prompt_eval_summary?: {
        avg_prompt_score: number;
        weak_prompt_count: number;
        mergeable_count: number;
        ai_scored_count: number;
        top_prompt_lesson?: string;
        focus_habit?: AgPcFocusHabit;
    };
    ai_analysis?: {
        diagnosis?: string;
        split_strategy?: string;
        ideal_session_count?: number;
        est_prompts_after?: number;
        key_takeaway?: string;
        consolidated_prompt?: string;
        focus_habit?: { title: string; action_tip: string } | null;
        rewrite_pairs?: Array<{
            weak_original: string;
            upgraded_prompt: string;
            why_better: string;
        }>;
    };
}

interface AgPcCompareResult {
    ok: boolean;
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

interface AgPcDraftOptResult {
    ok: boolean;
    compact_prompt: string;
    full_spec_prompt: string;
    estimated_prompts_saved: string;
}

interface CachedDetailEntry {
    detail: AgPcSessionDetail;
    sig: string;
}

export type AgPcPeriodKey = 'today' | 'yesterday' | '7d' | '30d' | 'all' | 'date';

export interface AntigravityPcCoachTabProps {
    sessions: AgPcSessionSummary[];
    totalMatchingSessions: number;
    selectedSessionKey: string | null;
    onSelectSessionKey: (key: string) => void;
    period: AgPcPeriodKey;
    customDate: string;
    onChangePeriod: (nextPeriod: AgPcPeriodKey, nextDate?: string) => void;
    toolFilter: string;
    onChangeToolFilter: (tool: string) => void;
    includeSub: boolean;
    onChangeIncludeSub: (include: boolean) => void;
    onExitToOverview: () => void;
    resolveAuthHeaders: () => Record<string, string>;
    onCopy: (text: string, idTag: string, label?: string) => void;
    copiedId: string | null;
    onDispatchToA1: (promptText: string) => void;
    onSavePrivatePrompt: (
        title: string,
        template: string,
        category?: string,
        tool?: string,
        weakExample?: string,
        notes?: string
    ) => Promise<boolean>;
    onOpenFullOptimizer: (promptText: string, tool: string, fromSessionKey?: string | null) => void;
    onRefreshDashboard: () => void;
    onTriggerPcSync?: () => Promise<void> | void;
    pcSyncing?: boolean;
    realtimeAuto?: boolean;
    onToggleRealtimeAuto?: () => void;
    focusTurnIdx?: number | null;
    onClearFocusTurnIdx?: () => void;
    realtimeReport?: RealtimeExecutiveReport | null;
}

const INITIAL_TURN_BATCH = 25;
const TURN_BATCH_STEP = 30;
const MAX_CACHE_ENTRIES = 60;
const WEAK_SCORE_THRESHOLD = 75;
const COMPOSER_STORAGE_KEY = 'aihot_agpc_composer_draft_v1';
const RAW_DRAFT_STORAGE_KEY = 'aihot_agpc_raw_draft_v1';

const RUBRIC_DIMS: Array<{ key: string; short: string; label: string; hint: string }> = [
    { key: 'goal', short: 'MT', label: 'Mục tiêu', hint: 'Nêu rõ kết quả hoặc đầu việc cần đạt' },
    { key: 'context', short: 'NC', label: 'File/Ngữ cảnh', hint: 'Chỉ rõ file, route, URL, log hoặc bảng' },
    { key: 'boundaries', short: 'RG', label: 'Ranh giới', hint: 'Khoanh vùng phần được sửa / không được sửa' },
    { key: 'constraints', short: 'RB', label: 'Ràng buộc', hint: 'Chuẩn UI, font, tốc độ, tương thích' },
    { key: 'output_format', short: 'ĐR', label: 'Định dạng trả lời', hint: 'Cấu trúc kết quả đầu ra mong muốn' },
    { key: 'verification', short: 'KC', label: 'Tiêu chí Done', hint: 'Tiêu chí Done: test, build, đo thật' },
    { key: 'safety', short: 'AT', label: 'An toàn DB/Deploy', hint: 'Rào backup/dry-run khi đụng DB/Deploy' },
];

const STAGE_LABELS: Record<string, string> = {
    exploration: 'Khám phá / Đọc hiểu',
    diagnosis: 'Chẩn đoán lỗi',
    execution: 'Thực thi làm / sửa',
    verification: 'Kiểm chứng & Test',
    reusable_workflow: 'Quy trình / Mẫu chuẩn',
    action: 'Chốt / Lệnh nhanh',
};

const ROOT_CAUSE_VI: Record<string, string> = {
    prompt_ambiguous: 'HRPO: Prompt mơ hồ',
    missing_safety: 'HRPO: Thiếu rào an toàn',
    environment_error: 'HRPO: Lỗi môi trường / Tool',
    context_drift: 'HRPO: Trôi ngữ cảnh phiên dài',
};

const TOOL_STYLE: Record<string, { label: string; shortLabel: string; dotCls: string }> = {
    antigravity: { label: 'Antigravity', shortLabel: 'AG', dotCls: 'bg-indigo-600' },
    claude: { label: 'Claude Code', shortLabel: 'Claude', dotCls: 'bg-amber-600' },
    codex: { label: 'Codex', shortLabel: 'Codex', dotCls: 'bg-emerald-600' },
};

const AntigravityRibbonIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
    <svg viewBox="0 0 36 36" fill="none" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path
            d="M7 29.5C9.5 21 13.8 7.5 18 7.5C22.2 7.5 26.5 21 29 29.5"
            stroke="currentColor"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        <path
            d="M11.5 23C14.5 19.5 21.5 19.5 24.5 23"
            stroke="currentColor"
            strokeWidth="3.8"
            strokeLinecap="round"
        />
    </svg>
);

function readSessionStorageSafe(key: string): string {
    if (typeof window === 'undefined') return '';
    try {
        return window.sessionStorage.getItem(key) || '';
    } catch {
        return '';
    }
}

function writeSessionStorageSafe(key: string, val: string): void {
    if (typeof window === 'undefined') return;
    try {
        if (val) window.sessionStorage.setItem(key, val);
        else window.sessionStorage.removeItem(key);
    } catch {
        // Ignore storage quota errors
    }
}

function cleanTitle(rawTitle?: string, fallbackPreview?: string, skey?: string): string {
    let t = (rawTitle || fallbackPreview || skey || '').trim();
    if (t.startsWith('# Files mentioned by the user:')) {
        const lines = t
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#'));
        t = lines.join(' ').trim() || fallbackPreview || skey || '';
    }
    t = t.replace(/^Image attachment:\s*true\s*/i, '').replace(/\s+/g, ' ').trim();
    if (!t) return skey || 'Phiên chưa đặt tên';
    return t.length > 96 ? `${t.slice(0, 94)}…` : t;
}

const AntigravityRunningGridIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
    <span
        className={`inline-grid grid-cols-2 gap-[2.5px] p-[1px] shrink-0 ${className}`}
        title="Phiên đang chạy Realtime trên Antigravity PC"
        aria-label="Đang chạy Realtime"
    >
        <span className="w-[4.5px] h-[4.5px] rounded-full bg-indigo-500 animate-pulse" />
        <span className="w-[4.5px] h-[4.5px] rounded-full bg-indigo-400 animate-pulse [animation-delay:180ms]" />
        <span className="w-[4.5px] h-[4.5px] rounded-full bg-indigo-400 animate-pulse [animation-delay:360ms]" />
        <span className="w-[4.5px] h-[4.5px] rounded-full bg-indigo-500 animate-pulse [animation-delay:540ms]" />
    </span>
);

function getSessionActivityTs(s?: Partial<AgPcSessionSummary> | null): number {
    if (!s) return 0;
    return Math.max(Number(s.last_activity_ts || 0), Number(s.end_ts || 0));
}

function formatRelTime(epochSec: number, nowSec?: number): string {
    if (!epochSec) return '';
    const refNow = nowSec || Date.now() / 1000;
    const diff = Math.max(0, Math.floor(refNow - epochSec));
    if (diff < 60) return 'Vừa xong';
    if (diff < 3600) return `${Math.floor(diff / 60)} phút`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} giờ`;
    return `${Math.floor(diff / 86400)} ngày`;
}

function formatTurnDuration(sec?: number | null): string {
    if (typeof sec !== 'number' || !Number.isFinite(sec) || sec <= 0) return '';
    if (sec >= 60) {
        const m = Math.floor(sec / 60);
        const rem = Math.round(sec % 60);
        return rem > 0 ? `${m}p${rem}s` : `${m}p`;
    }
    if (sec >= 10) return `${Math.round(sec)}s`;
    return `${Math.round(sec * 10) / 10}s`;
}

function scorePillClasses(score: number, isDark: boolean): string {
    if (score >= 80) {
        return isDark
            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/70'
            : 'bg-[#e6f4ea] text-[#137333] border-[#a8dab5]';
    }
    if (score >= 55) {
        return isDark
            ? 'bg-amber-950/70 text-amber-300 border-amber-700/70'
            : 'bg-[#fef7e0] text-[#b06000] border-[#fdd663]';
    }
    return isDark
        ? 'bg-rose-950/70 text-rose-300 border-rose-700/70'
        : 'bg-[#fce8e6] text-[#c5221f] border-[#f5c2c0]';
}

function buildSummaryCacheSig(s?: Partial<AgPcSessionSummary> | null): string {
    if (!s) return '';
    return [
        s.n_human_prompts ?? 0,
        s.total_tool_calls ?? 0,
        s.tool_error_count ?? 0,
        s.rule_score ?? 0,
        s.avg_prompt_score ?? 0,
        s.weak_prompt_count ?? 0,
        s.has_ai_analysis ? 1 : 0,
        s.ai_is_fresh ? 1 : 0,
        s.is_running ? 1 : 0,
        Math.round(getSessionActivityTs(s)),
    ].join(':');
}

// Synchronized 1:1 with Python _score_prompt_rubric (P0-1 & P0-4)
const RE_NON_BUG_ZERO_ERR = /\b(?:0|không(?:\s+có|\s+còn)?)\s+lỗi\b/gi;
const RE_STAGE_WORKFLOW = /\b(quy\s+trình|workflow|skill|template|mẫu\s+prompt|agents\.md|chuẩn\s+hóa|cron|hook|tự\s+động\s+hóa|playbook|biến\s+\{\{)/i;
const RE_STAGE_DIAG = /\b(lỗi|bug|traceback|crash|exception|timeout|rớt|treo|chậm|hỏng|không\s+(?:chạy|hiện|lên|vào|ăn)|403|404|500|502|504|debug|tại\s+sao)\b/i;
const RE_STAGE_DIAG_EXCL = /\b(nâng\s+cấp|thêm\s+tính\s+năng|tạo\s+mới|thiết\s+kế)\b/i;
const RE_STAGE_ACTION = /^(?:chốt|đồng\s+ý|ok|yes|làm\s+luôn|triển\s+khai|deploy|push|commit|restart|chạy\s+(?:đi|luôn|lại|thử)|tiếp\s+tục|\d{1,2}|cả\s+\d+)\b/i;
const RE_STAGE_VERIF = /\b(test|pytest|verify|kiểm\s*(?:thử|chứng|tra)|audit|check|playwright|tsc|build|status|chụp\s+màn|đo\s+lại|nghiệm\s+thu)\b/i;
const RE_STAGE_VERIF_EXCL = /\b(tạo|thêm|viết|nâng\s+cấp)\b/i;
const RE_STAGE_EXPLORE = /\b(tìm\s+hiểu|đọc\s+(?:code|file|hàm)|liệt\s+kê|giải\s+thích|tóm\s+tắt|kiến\s+trúc|nằm\s+ở\s+đâu|so\s+sánh|gợi\s+ý|repo\s+trên\s+github)\b/i;
const RE_STAGE_EXPLORE_EXCL = /\b(sửa|viết\s+code|implement|làm\s+luôn|tạo)\b/i;

const RE_EMPTY_NUDGE = /^(ok|okie|okay|yes|tiếp|tiếp\s+đi|tiếp\s+tục|làm\s+đi|làm\s+tiếp|fix|sửa\s+đi|chạy\s+đi|done|ừ|uh)[.!?\s]*$/i;
const RE_CTX = /[/\\][A-Za-z0-9_.\-]+|\.[a-z]{1,5}\b|https?:\/\/|\b(?:http|status|error|traceback|line|dòng|lỗi|api|db|tab|trang|file|port|sql|service|nginx)\b/i;
const RE_SCOPE = /(không\s+sửa|giữ\s+nguyên|chỉ\s+(?:sửa|tìm|đọc|thêm|làm|chỉnh|xem)|phạm\s+vi|không\s+chạm|tối\s+đa|đừng|riêng|tách|cô\s+lập|ngoài\s+ra\s+không)/i;
const RE_CONSTR = /(google\s+sans|tabular-nums|12px|390px|mobile|dark\s*mode|light\/dark|offline|không\s+mock|tương\s+thích|backward|timeout|port\s*\d+|latency|ràng\s+buộc|chuẩn|layout|responsive|cache)/i;
const RE_FMT = /(json|markdown|bảng|table|checklist|diff|tóm\s+tắt|ngắn\s+gọn|link\s+bấm|từng\s+bước|bullet|báo\s+cáo|artifact|file\s+\.md|format|định\s+dạng|song\s+song|trực\s+tiếp)/i;
const RE_DONE = /(done|xong|test|pytest|tsc|verify|kiểm\s*(?:thử|chứng|tra)|nghiệm\s*thu|playwright|http\s*200|0\s*lỗi|build|chụp|bằng\s+chứng|output|trả\s*(?:về|ra)|hiển\s+thị|kết\s+quả|báo\s+cáo|xác\s+nhận)/i;
const RE_RISKY = /(?:\b(?:deploy|push(?!\s*notification)|force[\-\s]?push|sync_vps\d*|drop\s+table|truncate\s+table|alter\s+table|migrations?|systemctl|nginx\s+-s)\b|\brm\s+-[rfA-Za-z]+\b|\brestart\s+(?:nginx|service|server|vps|systemd|backend|db|docker)\b|\b(?:xóa|delete)\s+(?:bảng|table|db|database|sqlite|dữ\s+liệu|data|production|prod|file|thư\s+mục)\b|\b(?:ghi|sửa|chạy|cập\s+nhật|update|execute)\b[^\n]{0,45}\b(?:production|prod|\.env\b))/i;
const RE_SAFETY = /(backup|sao\s*lưu|dry-?run|kiểm\s*(?:tra|kê)\s*trước|không\s*(?:xóa|chạm|push|deploy|tự|sửa\s+dữ\s+liệu)|giữ\s*nguyên|an\s*toàn|rollback|test\s*(?:trước|local)|cô\s*lập|staging|xác\s*nhận|confirm|chưa\s+deploy|không\s+mất)/i;

function scoreDraftClientSide(text: string, projectHint: string, sessionFileHints: string[] = []) {
    const stripped = (text || '').trim();
    const low = stripped.toLowerCase();
    const chars = stripped.length;

    const isShortNudge = chars <= 20 && RE_EMPTY_NUDGE.test(stripped);
    const diagProbe = low.includes('lỗi') ? stripped.replace(RE_NON_BUG_ZERO_ERR, ' ') : stripped;

    let stage = 'execution';
    if (RE_STAGE_WORKFLOW.test(stripped)) {
        stage = 'reusable_workflow';
    } else if (RE_STAGE_DIAG.test(diagProbe) && !RE_STAGE_DIAG_EXCL.test(stripped)) {
        stage = 'diagnosis';
    } else if (!isShortNudge && chars <= 95 && RE_STAGE_ACTION.test(stripped)) {
        stage = 'action';
    } else if (chars < 180 && RE_STAGE_VERIF.test(stripped) && !RE_STAGE_VERIF_EXCL.test(stripped)) {
        stage = 'verification';
    } else if (RE_STAGE_EXPLORE.test(stripped) && !RE_STAGE_EXPLORE_EXCL.test(stripped)) {
        stage = 'exploration';
    }

    const hasGoal = (chars >= 28 || low.includes('http') || (stage === 'action' && !isShortNudge)) && !isShortNudge;
    const hasContext = RE_CTX.test(stripped);
    const hasBoundaries = RE_SCOPE.test(stripped) || chars >= 170;
    const hasConstraints = RE_CONSTR.test(stripped) || chars >= 210;
    const hasFormat = RE_FMT.test(stripped) || (stripped.includes('{{') && stripped.includes('}}'));
    const hasVerification = RE_DONE.test(stripped);
    const isRisky = RE_RISKY.test(stripped);
    const hasSafety = RE_SAFETY.test(stripped);
    const safetyOk = !isRisky || hasSafety;

    const flags: Record<string, boolean> = {
        goal: hasGoal,
        context: hasContext,
        boundaries: hasBoundaries,
        constraints: hasConstraints,
        output_format: hasFormat,
        verification: hasVerification,
        safety: safetyOk,
    };

    const weightMap: Record<string, Record<string, number>> = {
        exploration: { goal: 28, context: 28, boundaries: 10, constraints: 10, output_format: 16, verification: 8 },
        diagnosis: { goal: 20, context: 32, boundaries: 12, constraints: 12, output_format: 8, verification: 16 },
        execution: { goal: 22, context: 22, boundaries: 18, constraints: 14, output_format: 6, verification: 18 },
        verification: { goal: 22, context: 22, boundaries: 12, constraints: 12, output_format: 10, verification: 22 },
        reusable_workflow: { goal: 22, context: 16, boundaries: 16, constraints: 16, output_format: 16, verification: 14 },
        action: { goal: 34, context: 22, boundaries: 14, constraints: 10, output_format: 6, verification: 14 },
    };
    const weights = weightMap[stage] || weightMap.execution;

    let earned = 36;
    Object.entries(weights).forEach(([k, w]) => {
        if (flags[k]) earned += Math.round(w * 0.64);
        else if (k === 'output_format' && ['execution', 'diagnosis', 'action'].includes(stage))
            earned += Math.round(w * 0.35);
        else if (k === 'constraints' && ['exploration', 'action'].includes(stage))
            earned += Math.round(w * 0.35);
    });
    if (isShortNudge) earned = Math.min(earned, 32);
    if (isRisky && !hasSafety) earned -= 16;
    if (isRisky && hasSafety) earned += 6;
    const score = stripped ? Math.max(12, Math.min(98, earned)) : 12;

    const checks: AgPcPromptCheck[] = [
        { key: 'goal', label: 'Mục tiêu', ok: hasGoal, applicable: true },
        { key: 'context', label: 'File/Ngữ cảnh', ok: hasContext, applicable: true },
        { key: 'boundaries', label: 'Ranh giới', ok: hasBoundaries, applicable: true },
        {
            key: 'constraints',
            label: 'Ràng buộc',
            ok: hasConstraints,
            applicable: ['execution', 'reusable_workflow', 'verification'].includes(stage) || hasConstraints,
        },
        {
            key: 'output_format',
            label: 'Định dạng trả lời',
            ok: hasFormat,
            applicable: ['exploration', 'reusable_workflow'].includes(stage) || hasFormat,
        },
        {
            key: 'verification',
            label: 'Tiêu chí Done',
            ok: hasVerification,
            applicable: stage !== 'exploration' || hasVerification,
        },
        { key: 'safety', label: 'An toàn DB/Deploy', ok: safetyOk, applicable: isRisky || hasSafety },
    ];

    const missingLabels = checks.filter(c => !c.ok && c.applicable !== false).map(c => c.label);
    const proj = projectHint || 'aihot.vn';
    const fileRef =
        sessionFileHints.length > 0
            ? sessionFileHints.slice(0, 3).join(', ')
            : `đúng file/route thuộc ${proj}`;
    const lines = [`Mục tiêu (${proj}): ${stripped || 'Nêu rõ đầu việc cụ thể cần hoàn tất'}`];
    if (!hasContext) {
        lines.push(`Ngữ cảnh & File: Kiểm tra tại ${fileRef}, kèm mã lỗi/log thực tế nếu sửa lỗi.`);
    }
    if (!hasBoundaries) {
        lines.push('Ranh giới: Chỉ sửa đúng module nhiệm vụ, bảo toàn dữ liệu và các luồng đang chạy ổn.');
    }
    if (isRisky && !hasSafety) {
        lines.push('Rào an toàn: Sao lưu DB & kiểm tra dry-run trên local trước khi ghi production hoặc push.');
    }
    if (!hasVerification) {
        lines.push('Điều kiện Xong (Done): Chạy typecheck/build/test thực tế đạt 0 lỗi rồi báo bằng chứng cụ thể.');
    }

    return {
        stage,
        stageLabel: STAGE_LABELS[stage] || stage,
        score,
        safetyWarning: isRisky && !hasSafety,
        checks,
        missingLabels,
        improved: lines.join('\n'),
    };
}

function collectSessionFileHints(detail: AgPcSessionDetail | null): string[] {
    if (!detail) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of detail.prompts_sample || []) {
        for (const f of p.files_touched || []) {
            const clean = (f || '').trim();
            if (clean && !seen.has(clean)) {
                seen.add(clean);
                out.push(clean);
                if (out.length >= 6) return out;
            }
        }
        const m = (p.text_redacted || '').match(
            /(?:[A-Za-z0-9_\-./\\]+\.(?:tsx?|jsx?|py|rs|sql|json|css|html|md))\b/g
        );
        if (m) {
            for (const cand of m) {
                const clean = cand.trim();
                if (clean.length >= 4 && !seen.has(clean)) {
                    seen.add(clean);
                    out.push(clean);
                    if (out.length >= 6) return out;
                }
            }
        }
    }
    return out;
}

function enrichPromptPlaceholder(rawImproved: string, turnFiles: string[], sessionFiles: string[], errSnippet?: string): string {
    let out = (rawImproved || '').trim();
    if (!out) return out;
    const files = turnFiles.length > 0 ? turnFiles : sessionFiles.slice(0, 3);
    if (files.length > 0) {
        const fileStr = files.slice(0, 3).join(', ');
        out = out
            .replace(/\[TÊN FILE\s*\/\s*ROUTE\s*\/\s*LOG\]/gi, fileStr)
            .replace(/\[FILE\/URL GÂY LỖI\]/gi, fileStr)
            .replace(/\{\{ten_file_hoac_route\}\}/gi, fileStr);
    }
    if (errSnippet && errSnippet.trim()) {
        out = out.replace(/\[MÃ LỖI\s*\/\s*TRACEBACK\s*\/\s*HTTP STATUS\]/gi, errSnippet.trim().slice(0, 140));
    }
    return out;
}

function buildUnifiedSessionSpec(detail: AgPcSessionDetail, sessionFiles: string[]): {
    specText: string;
    isLongMultiStage: boolean;
    idealSessions: number;
    estPromptsAfter: number;
    savedTurns: number;
    splitStrategyText: string;
} {
    const totalTurns = Math.max(detail.n_human_prompts || 0, (detail.prompts_sample || []).length);
    const ai = detail.ai_analysis;
    const isLongMultiStage = totalTurns > 12 || (ai?.ideal_session_count ?? 1) > 1;
    const idealSessions = ai?.ideal_session_count || (totalTurns > 12 ? Math.max(2, Math.ceil(totalTurns / 12)) : 1);
    const estPromptsAfter =
        ai?.est_prompts_after ||
        (totalTurns > 12 ? Math.min(totalTurns - 1, Math.max(3, idealSessions * 4)) : Math.min(totalTurns, 2));
    const savedTurns = Math.max(1, totalTurns - estPromptsAfter);
    const splitStrategyText =
        (ai?.split_strategy || '').trim() ||
        (isLongMultiStage
            ? `Phiên kéo dài ${totalTurns} lượt — nên chia thành ~${idealSessions} phiên độc lập (chốt HANDOFF mỗi <= 12 lượt để tránh trôi ngữ cảnh và lặp lỗi công cụ).`
            : '');

    if (ai?.consolidated_prompt && ai.consolidated_prompt.trim()) {
        return {
            specText: ai.consolidated_prompt.trim(),
            isLongMultiStage,
            idealSessions,
            estPromptsAfter,
            savedTurns,
            splitStrategyText,
        };
    }

    if (!isLongMultiStage && ai?.rewrite_pairs && ai.rewrite_pairs.length > 0 && ai.rewrite_pairs[0].upgraded_prompt) {
        return {
            specText: ai.rewrite_pairs[0].upgraded_prompt.trim(),
            isLongMultiStage,
            idealSessions,
            estPromptsAfter,
            savedTurns,
            splitStrategyText,
        };
    }

    const prompts = detail.prompts_sample || [];
    const proj = detail.project || 'AG';
    const fileScope =
        sessionFiles.length > 0
            ? `Tập trung đúng tại ${sessionFiles.slice(0, 4).join(', ')}; giữ nguyên các phần đang chạy ổn.`
            : 'Đọc đúng file/route liên quan trước khi sửa; chỉ sửa đúng module nhiệm vụ, giữ nguyên các phần đang ổn.';

    if (prompts.length === 0) {
        return {
            specText: `Mục tiêu (${proj}): ${detail.title}\nPhạm vi & Ranh giới: ${fileScope}\nDone: Chạy test/build xác nhận 0 lỗi.`,
            isLongMultiStage,
            idealSessions,
            estPromptsAfter,
            savedTurns,
            splitStrategyText,
        };
    }

    const firstGoal = (prompts[0].text_redacted || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const substantiveFollowUps = prompts
        .slice(1)
        .filter(
            p =>
                !p.is_short_nudge &&
                !p.is_question_reply &&
                !p.is_vague_error &&
                !p.is_corr_kw &&
                (p.text_redacted || '').trim().length >= 18
        )
        .slice(0, 4)
        .map(p => (p.text_redacted || '').replace(/\s+/g, ' ').trim().slice(0, 130))
        .filter(Boolean);

    const specLines = [
        isLongMultiStage
            ? `Mục tiêu Chặng #1 (${proj}): ${firstGoal}`
            : `Mục tiêu (${proj}): ${firstGoal}`,
        ...(substantiveFollowUps.length > 0
            ? [`Yêu cầu gộp rõ ngay từ đầu: ${substantiveFollowUps.join('; ')}`]
            : []),
        `Ngữ cảnh & Ranh giới: ${fileScope}`,
        isLongMultiStage
            ? `Kiểm chứng & HANDOFF: Tự chạy build/test đạt 0 lỗi cho chặng này; nếu vượt 12 lượt thì xuất HANDOFF 3 mục để sang phiên mới sạch ngữ cảnh.`
            : `An toàn & Done: Nếu chạm DB/Deploy phải backup & dry-run trước; tự chạy build/test đạt 0 lỗi rồi báo kết quả đo thật.`,
    ];

    return {
        specText: specLines.join('\n'),
        isLongMultiStage,
        idealSessions,
        estPromptsAfter,
        savedTurns,
        splitStrategyText,
    };
}

export const AntigravityPcCoachTab: React.FC<AntigravityPcCoachTabProps> = ({
    sessions,
    totalMatchingSessions,
    selectedSessionKey,
    onSelectSessionKey,
    period,
    customDate,
    onChangePeriod,
    toolFilter,
    onChangeToolFilter,
    includeSub,
    onChangeIncludeSub,
    onExitToOverview,
    resolveAuthHeaders,
    onCopy,
    copiedId,
    onDispatchToA1,
    onSavePrivatePrompt,
    onOpenFullOptimizer,
    onRefreshDashboard,
    onTriggerPcSync,
    pcSyncing = false,
    realtimeAuto = true,
    onToggleRealtimeAuto,
    focusTurnIdx,
    onClearFocusTurnIdx,
    realtimeReport,
}) => {
    const [isFullscreen, setIsFullscreen] = useState<boolean>(true);
    const [showRealtimeReport, setShowRealtimeReport] = useState<boolean>(false);
    const [pendingScrollIdx, setPendingScrollIdx] = useState<number | null>(null);
    const [sidebarSortMode, setSidebarSortMode] = useState<'realtime' | 'priority'>('realtime');
    const [nowEpochSec, setNowEpochSec] = useState<number>(() => Math.floor(Date.now() / 1000));
    const [turnFilter, setTurnFilter] = useState<'all' | 'weak' | 'err' | 'redundant'>('all');
    const [renderLimit, setRenderLimit] = useState<number>(INITIAL_TURN_BATCH);
    const [agDark, setAgDark] = useState<boolean>(() => {
        if (typeof document === 'undefined') return false;
        return document.documentElement.classList.contains('dark');
    });
    const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
    const [mobileDrawerOpen, setMobileDrawerOpen] = useState<boolean>(false);
    const [sidebarSearch, setSidebarSearch] = useState<string>('');
    const [onlyErrSessions, setOnlyErrSessions] = useState<boolean>(false);

    const [detail, setDetail] = useState<AgPcSessionDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState<boolean>(false);
    const [detailErr, setDetailErr] = useState<string>('');
    const [analyzingKeys, setAnalyzingKeys] = useState<Record<string, boolean>>({});
    const detailCacheRef = useRef<Record<string, CachedDetailEntry>>({});
    const latestKeyRef = useRef<string>('');
    const abortControllerRef = useRef<AbortController | null>(null);
    const canvasScrollRef = useRef<HTMLDivElement | null>(null);
    const problemCursorRef = useRef<number>(-1);

    const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
    const [expandedLongPrompts, setExpandedLongPrompts] = useState<Record<string, boolean>>({});
    const [highlightedTurnIdx, setHighlightedTurnIdx] = useState<number | null>(null);
    const [inlineDeepSpecs, setInlineDeepSpecs] = useState<Record<string, AgPcDraftOptResult>>({});
    const [inlineDeepLoadingKey, setInlineDeepLoadingKey] = useState<string | null>(null);

    // Bottom Antigravity Composer State (persisted in sessionStorage so Esc / tab switch never wipes user draft)
    const [composerText, setComposerTextState] = useState<string>(() => readSessionStorageSafe(COMPOSER_STORAGE_KEY));
    const [rawDraftBeforeUpgrade, setRawDraftState] = useState<string>(() =>
        readSessionStorageSafe(RAW_DRAFT_STORAGE_KEY)
    );
    const [lastUpgradedSpec, setLastUpgradedSpec] = useState<string>('');
    const [pendingAbOptimizedB, setPendingAbOptimizedB] = useState<string>('');
    const [composerUpgrading, setComposerUpgrading] = useState<boolean>(false);
    const [composerComparing, setComposerComparing] = useState<boolean>(false);
    const [composerAbResult, setComposerAbResult] = useState<AgPcCompareResult | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);

    const setComposerText = useCallback((val: string) => {
        setComposerTextState(val);
        writeSessionStorageSafe(COMPOSER_STORAGE_KEY, val);
    }, []);

    const setRawDraftBeforeUpgrade = useCallback((val: string) => {
        setRawDraftState(val);
        writeSessionStorageSafe(RAW_DRAFT_STORAGE_KEY, val);
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowEpochSec(Math.floor(Date.now() / 1000));
        }, 15000);
        return () => window.clearInterval(timer);
    }, []);

    const filteredSidebarSessions = useMemo(() => {
        const q = sidebarSearch.trim().toLowerCase();
        const sevRank: Record<string, number> = { red: 0, amber: 1, green: 2 };
        const matched = sessions.filter(s => {
            if (onlyErrSessions && !(Number(s.tool_error_count || 0) > 0)) return false;
            if (!q) return true;
            const hay = `${s.title} ${s.project} ${s.tool} ${s.first_human_preview}`.toLowerCase();
            return hay.includes(q);
        });
        return [...matched].sort((a, b) => {
            if (sidebarSortMode === 'priority') {
                const sa = sevRank[a.severity] ?? 2;
                const sb = sevRank[b.severity] ?? 2;
                if (sa !== sb) return sa - sb;
                if ((b.n_human_prompts || 0) !== (a.n_human_prompts || 0)) {
                    return (b.n_human_prompts || 0) - (a.n_human_prompts || 0);
                }
                return getSessionActivityTs(b) - getSessionActivityTs(a);
            }
            // Default 'realtime': 1:1 with Antigravity PC Desktop (Running first -> last_modified_time DESC)
            const runDiff = Number(Boolean(b.is_running)) - Number(Boolean(a.is_running));
            if (runDiff !== 0) return runDiff;
            const actDiff = getSessionActivityTs(b) - getSessionActivityTs(a);
            if (actDiff !== 0) return actDiff;
            return (b.n_human_prompts || 0) - (a.n_human_prompts || 0);
        });
    }, [sessions, sidebarSearch, onlyErrSessions, sidebarSortMode]);

    const effectiveSessionKey = useMemo(() => {
        if (selectedSessionKey) {
            // Honor explicit selection (including sessions outside slice jumped from Prompts Table),
            // unless sidebar error-only filter is active and excludes it.
            if (onlyErrSessions && !filteredSidebarSessions.some(s => s.session_key === selectedSessionKey)) {
                return filteredSidebarSessions[0]?.session_key || '';
            }
            return selectedSessionKey;
        }
        return filteredSidebarSessions[0]?.session_key || '';
    }, [selectedSessionKey, onlyErrSessions, filteredSidebarSessions]);

    // Pin initial auto-selected session so background realtime reordering never hijacks the open conversation
    useEffect(() => {
        if (!selectedSessionKey && filteredSidebarSessions[0]?.session_key) {
            onSelectSessionKey(filteredSidebarSessions[0].session_key);
        }
    }, [selectedSessionKey, filteredSidebarSessions, onSelectSessionKey]);

    latestKeyRef.current = effectiveSessionKey;

    const activeSummary = useMemo(
        () => sessions.find(s => s.session_key === effectiveSessionKey) || null,
        [sessions, effectiveSessionKey]
    );
    const activeSummarySig = useMemo(() => buildSummaryCacheSig(activeSummary), [activeSummary]);

    const pinnedSidebarSessions = useMemo(
        () => (sidebarSortMode === 'realtime' ? filteredSidebarSessions.filter(s => s.is_pinned) : []),
        [filteredSidebarSessions, sidebarSortMode]
    );

    const groupedByProject = useMemo(() => {
        const map = new Map<string, AgPcSessionSummary[]>();
        filteredSidebarSessions.forEach(s => {
            if (sidebarSortMode === 'realtime' && s.is_pinned) return;
            const p = (s.project || 'AG').trim() || 'AG';
            const list = map.get(p) || [];
            list.push(s);
            map.set(p, list);
        });
        const entries = Array.from(map.entries());
        if (sidebarSortMode === 'realtime') {
            entries.sort(([nameA, listA], [nameB, listB]) => {
                if (nameA === 'AG' && nameB !== 'AG') return -1;
                if (nameB === 'AG' && nameA !== 'AG') return 1;
                const runA = listA.some(x => x.is_running) ? 1 : 0;
                const runB = listB.some(x => x.is_running) ? 1 : 0;
                if (runB !== runA) return runB - runA;
                const topA = listA[0] ? getSessionActivityTs(listA[0]) : 0;
                const topB = listB[0] ? getSessionActivityTs(listB[0]) : 0;
                return topB - topA;
            });
        }
        return entries;
    }, [filteredSidebarSessions, sidebarSortMode]);

    const errSessionsCount = useMemo(
        () => sessions.filter(s => Number(s.tool_error_count || 0) > 0).length,
        [sessions]
    );

    const putDetailCache = useCallback((skey: string, sessionDoc: AgPcSessionDetail, sigHint?: string) => {
        const cache = detailCacheRef.current;
        if (!cache[skey] && Object.keys(cache).length >= MAX_CACHE_ENTRIES) {
            const oldestKey = Object.keys(cache)[0];
            if (oldestKey) delete cache[oldestKey];
        }
        const computedSig =
            sigHint ||
            buildSummaryCacheSig({
                n_human_prompts: sessionDoc.n_human_prompts,
                total_tool_calls: sessionDoc.total_tool_calls,
                tool_error_count: sessionDoc.tool_error_count,
                rule_score: sessionDoc.rule_score,
                avg_prompt_score:
                    sessionDoc.prompt_eval_summary?.avg_prompt_score ?? sessionDoc.avg_prompt_score,
                weak_prompt_count:
                    sessionDoc.prompt_eval_summary?.weak_prompt_count ?? sessionDoc.weak_prompt_count,
                has_ai_analysis: Boolean(sessionDoc.ai_analysis?.diagnosis || sessionDoc.has_ai_analysis),
                ai_is_fresh: sessionDoc.ai_is_fresh,
                is_running: sessionDoc.is_running,
                last_activity_ts: sessionDoc.last_activity_ts,
                end_ts: sessionDoc.end_ts,
            });
        cache[skey] = { detail: sessionDoc, sig: computedSig };
    }, []);

    const loadSessionDetail = useCallback(
        async (
            skey: string,
            opts?: { forceNetwork?: boolean; silent?: boolean; expectedSig?: string }
        ) => {
            const forceNetwork = Boolean(opts?.forceNetwork);
            const silent = Boolean(opts?.silent);
            const expectedSig = opts?.expectedSig || '';

            if (!skey) {
                abortControllerRef.current?.abort();
                setDetail(null);
                setDetailErr('');
                setDetailLoading(false);
                return;
            }

            const cached = detailCacheRef.current[skey];
            if (!forceNetwork && cached) {
                setDetail(cached.detail);
                setDetailErr('');
                setDetailLoading(false);
                if (expectedSig && cached.sig && cached.sig !== expectedSig) {
                    // Cache signature drifted after background sync/AI: refresh silently without blanking screen
                    void loadSessionDetail(skey, { forceNetwork: true, silent: true, expectedSig });
                }
                return;
            }

            let controller: AbortController | null = null;
            if (!silent) {
                abortControllerRef.current?.abort();
                controller = new AbortController();
                abortControllerRef.current = controller;
                if (!cached) {
                    setDetail(null);
                }
                setDetailLoading(true);
                setDetailErr('');
            }

            try {
                const res = await fetch(`/api/owner/prompt-coach/session/${encodeURIComponent(skey)}`, {
                    headers: resolveAuthHeaders(),
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: controller?.signal,
                });
                const doc = await res.json().catch(() => ({}));
                if (!res.ok || !doc?.ok || !doc?.session) {
                    throw new Error(doc?.error || `Không tải được phiên (HTTP ${res.status}).`);
                }
                const sessionDoc = doc.session as AgPcSessionDetail;
                putDetailCache(skey, sessionDoc, expectedSig);
                if (!controller?.signal.aborted && latestKeyRef.current === skey) {
                    setDetail(sessionDoc);
                    setDetailErr('');
                }
            } catch (err: any) {
                if (err?.name === 'AbortError' || controller?.signal.aborted) return;
                if (!silent && latestKeyRef.current === skey) {
                    setDetailErr(err?.message || 'Lỗi tải luồng hội thoại Antigravity.');
                }
            } finally {
                if (!silent && !controller?.signal.aborted && latestKeyRef.current === skey) {
                    setDetailLoading(false);
                }
            }
        },
        [putDetailCache, resolveAuthHeaders]
    );

    // Primary load when switching sessions
    useEffect(() => {
        if (effectiveSessionKey) {
            void loadSessionDetail(effectiveSessionKey, {
                forceNetwork: false,
                silent: false,
                expectedSig: activeSummarySig,
            });
        } else {
            setDetail(null);
            setDetailErr('');
            setDetailLoading(false);
        }
        return () => {
            abortControllerRef.current?.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveSessionKey, loadSessionDetail]);

    // Silent background cache invalidation & refresh when 3s/10s/20s dashboard poll updates active session metadata
    useEffect(() => {
        if (!effectiveSessionKey || !activeSummarySig) return;
        const cached = detailCacheRef.current[effectiveSessionKey];
        if (cached && cached.sig !== activeSummarySig) {
            void loadSessionDetail(effectiveSessionKey, {
                forceNetwork: true,
                silent: true,
                expectedSig: activeSummarySig,
            });
        }
    }, [effectiveSessionKey, activeSummarySig, loadSessionDetail]);

    // Reset scroll position, turn filter, batch limit & problem cursor when switching session
    useEffect(() => {
        setTurnFilter('all');
        setRenderLimit(INITIAL_TURN_BATCH);
        setHighlightedTurnIdx(null);
        problemCursorRef.current = -1;
        canvasScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }, [effectiveSessionKey]);

    useEffect(() => {
        setRenderLimit(INITIAL_TURN_BATCH);
        problemCursorRef.current = -1;
    }, [turnFilter]);

    const isAnalyzingCurrent = Boolean(
        (effectiveSessionKey && analyzingKeys[effectiveSessionKey]) || activeSummary?.ai_analyzing
    );

    const handleTriggerAiAnalyze = async () => {
        const targetKey = effectiveSessionKey;
        if (!targetKey || analyzingKeys[targetKey]) return;
        setAnalyzingKeys(prev => ({ ...prev, [targetKey]: true }));
        try {
            const res = await fetch('/api/owner/prompt-coach/analyze-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({ session_key: targetKey, force: true }),
            });
            const doc = await res.json().catch(() => ({}));
            if (!res.ok || !doc?.ok) {
                throw new Error(doc?.error || 'AI chưa phân tích được phiên này.');
            }
            showToast('AI đã chấm sâu và viết lại các câu yếu cho phiên này!', 'success');
            await loadSessionDetail(targetKey, { forceNetwork: true, silent: true });
            onRefreshDashboard();
        } catch (err: any) {
            showToast(err?.message || 'Lỗi chạy AI phân tích.', 'error');
        } finally {
            setAnalyzingKeys(prev => {
                const next = { ...prev };
                delete next[targetKey];
                return next;
            });
        }
    };

    const handleTurnDeepSpec = async (p: AgPcPromptSample) => {
        if (!detail) return;
        const k = `${detail.session_key}:${p.idx}`;
        if (inlineDeepLoadingKey === k) return;
        setInlineDeepLoadingKey(k);
        try {
            const res = await fetch('/api/owner/prompt-coach/optimize-draft', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    draft: p.text_redacted,
                    tool: detail.tool || 'all',
                    goal_type: p.stage === 'diagnosis' ? 'bugfix' : 'feature',
                    target_files: '',
                }),
            });
            const doc = (await res.json().catch(() => ({}))) as AgPcDraftOptResult & { error?: string };
            if (!res.ok || !doc?.ok) {
                throw new Error(doc?.error || 'Không viết lại được Spec chuyên sâu.');
            }
            setInlineDeepSpecs(prev => ({ ...prev, [k]: doc }));
            showToast(`AI đã nâng cấp Spec 1-Phát chuyên sâu cho lượt #${p.idx}!`, 'success');
        } catch (err: any) {
            showToast(err?.message || 'Lỗi nâng cấp Spec.', 'error');
        } finally {
            setInlineDeepLoadingKey(prev => (prev === k ? null : prev));
        }
    };

    const sessionFileHints = useMemo(() => collectSessionFileHints(detail), [detail]);

    const liveComposerEval = useMemo(
        () => scoreDraftClientSide(composerText, detail?.project || 'aihot.vn', sessionFileHints),
        [composerText, detail?.project, sessionFileHints]
    );

    const handleComposerInputChange = (nextVal: string) => {
        setComposerText(nextVal);
        setPendingAbOptimizedB('');
        if (lastUpgradedSpec && nextVal.trim() !== lastUpgradedSpec.trim()) {
            setRawDraftBeforeUpgrade('');
            setLastUpgradedSpec('');
        }
    };

    const handleUpgradeComposerAi = async () => {
        const currentTrim = composerText.trim();
        if (!currentTrim) {
            const seed = 'fix loi trang bao cao khong hien so lieu hom nay';
            setComposerText(seed);
            setRawDraftBeforeUpgrade('');
            setLastUpgradedSpec('');
            return;
        }
        if (composerUpgrading) return;
        const baseRaw =
            rawDraftBeforeUpgrade.trim() && currentTrim === lastUpgradedSpec.trim()
                ? rawDraftBeforeUpgrade.trim()
                : currentTrim;

        setComposerUpgrading(true);
        try {
            const evalBase = scoreDraftClientSide(baseRaw, detail?.project || 'aihot.vn', sessionFileHints);
            const res = await fetch('/api/owner/prompt-coach/optimize-draft', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    draft: baseRaw,
                    tool: detail?.tool || 'antigravity',
                    goal_type: evalBase.stage === 'diagnosis' ? 'bugfix' : 'feature',
                    target_files: '',
                }),
            });
            const doc = (await res.json().catch(() => ({}))) as AgPcDraftOptResult & { error?: string };
            const upgraded =
                res.ok && doc?.ok
                    ? doc.full_spec_prompt || doc.compact_prompt || evalBase.improved
                    : evalBase.improved;
            setRawDraftBeforeUpgrade(baseRaw);
            setLastUpgradedSpec(upgraded);
            setComposerText(upgraded);
            setComposerAbResult(null);
            setPendingAbOptimizedB('');
            showToast(
                res.ok && doc?.ok
                    ? 'AI đã viết lại Spec 1-Phát ngay trong ô Composer!'
                    : 'Đã nâng cấp ô nhập lên mẫu Spec 1-Phát!',
                'success'
            );
        } catch {
            const evalBase = scoreDraftClientSide(baseRaw, detail?.project || 'aihot.vn', sessionFileHints);
            setRawDraftBeforeUpgrade(baseRaw);
            setLastUpgradedSpec(evalBase.improved);
            setComposerText(evalBase.improved);
            showToast('Đã nâng cấp ô nhập lên Spec 1-Phát!', 'success');
        } finally {
            setComposerUpgrading(false);
        }
    };

    const handleRestoreRawDraft = () => {
        if (!rawDraftBeforeUpgrade.trim()) return;
        setComposerText(rawDraftBeforeUpgrade);
        setRawDraftBeforeUpgrade('');
        setLastUpgradedSpec('');
        setComposerAbResult(null);
        setPendingAbOptimizedB('');
        showToast('Đã khôi phục câu nháp gốc trước khi nâng cấp!', 'info');
    };

    const handleCompareComposerAb = async () => {
        const currentTrim = composerText.trim() || 'fix loi trang bao cao khong hien so lieu hom nay';
        if (!composerText.trim()) setComposerText(currentTrim);
        if (composerComparing) return;
        setComposerComparing(true);
        try {
            const hasSavedRaw =
                Boolean(rawDraftBeforeUpgrade.trim()) &&
                rawDraftBeforeUpgrade.trim() !== currentTrim;
            const originalA = hasSavedRaw ? rawDraftBeforeUpgrade.trim() : currentTrim;
            const evalA = scoreDraftClientSide(originalA, detail?.project || 'aihot.vn', sessionFileHints);
            let optimizedB = hasSavedRaw ? currentTrim : '';

            if (!optimizedB) {
                try {
                    const optRes = await fetch('/api/owner/prompt-coach/optimize-draft', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...resolveAuthHeaders(),
                        },
                        credentials: 'same-origin',
                        body: JSON.stringify({
                            draft: originalA,
                            tool: detail?.tool || 'antigravity',
                            goal_type: evalA.stage === 'diagnosis' ? 'bugfix' : 'feature',
                            target_files: '',
                        }),
                    });
                    const optDoc = (await optRes.json().catch(() => ({}))) as AgPcDraftOptResult;
                    if (optRes.ok && optDoc?.ok) {
                        optimizedB = optDoc.full_spec_prompt || optDoc.compact_prompt || '';
                    }
                } catch {
                    // Fallback to synchronized client spec if optimize endpoint fails
                }
                if (!optimizedB) {
                    optimizedB = evalA.improved;
                }
                setPendingAbOptimizedB(optimizedB);
            } else {
                setPendingAbOptimizedB('');
            }

            const res = await fetch('/api/owner/prompt-coach/compare-draft', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...resolveAuthHeaders(),
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    original_draft: originalA,
                    optimized_prompt: optimizedB,
                    tool: detail?.tool || 'antigravity',
                    goal_type: evalA.stage === 'diagnosis' ? 'bugfix' : 'feature',
                }),
            });
            const doc = (await res.json().catch(() => ({}))) as AgPcCompareResult & { error?: string };
            if (!res.ok || !doc?.ok) {
                throw new Error(doc?.error || 'Không chạy được giả lập Dry-Run A/B.');
            }
            setComposerAbResult(doc);
            showToast('Đã hoàn tất giả lập A/B (Nháp gốc vs Bản 1-Phát)!', 'success');
        } catch (err: any) {
            showToast(err?.message || 'Lỗi chạy so sánh A/B.', 'error');
        } finally {
            setComposerComparing(false);
        }
    };

    const stepSession = (delta: number) => {
        if (filteredSidebarSessions.length === 0) return;
        const idx = filteredSidebarSessions.findIndex(s => s.session_key === effectiveSessionKey);
        const nextIdx = idx < 0 ? 0 : Math.max(0, Math.min(filteredSidebarSessions.length - 1, idx + delta));
        const target = filteredSidebarSessions[nextIdx];
        if (target && target.session_key !== effectiveSessionKey) {
            onSelectSessionKey(target.session_key);
        }
    };

    const loadIntoComposer = (txt: string, msg = 'Đã nạp vào ô Composer bên dưới!', rawOrigin = '') => {
        setComposerText(txt);
        if (rawOrigin.trim() && rawOrigin.trim() !== txt.trim()) {
            setRawDraftBeforeUpgrade(rawOrigin.trim());
            setLastUpgradedSpec(txt);
        } else {
            setRawDraftBeforeUpgrade('');
            setLastUpgradedSpec('');
        }
        setComposerAbResult(null);
        setPendingAbOptimizedB('');
        showToast(msg, 'success');
        window.setTimeout(() => composerRef.current?.focus(), 60);
    };

    const activePrompts = detail?.prompts_sample || [];
    const errTurnsCount = useMemo(
        () => activePrompts.filter(p => p.had_tool_error || Boolean(p.assistant_err_snippet)).length,
        [activePrompts]
    );
    const redundantTurnsCount = useMemo(
        () => activePrompts.filter(p => p.is_short_nudge || (p.merge_with && p.merge_with.length > 0)).length,
        [activePrompts]
    );
    const computedWeakTurnsCount = useMemo(
        () => activePrompts.filter(p => (p.score ?? 80) < WEAK_SCORE_THRESHOLD).length,
        [activePrompts]
    );
    const weakCount =
        detail?.prompt_eval_summary?.weak_prompt_count ??
        detail?.weak_prompt_count ??
        computedWeakTurnsCount;

    const visiblePrompts = useMemo(() => {
        if (turnFilter === 'weak') return activePrompts.filter(p => (p.score ?? 80) < WEAK_SCORE_THRESHOLD);
        if (turnFilter === 'err') return activePrompts.filter(p => p.had_tool_error || Boolean(p.assistant_err_snippet));
        if (turnFilter === 'redundant') {
            return activePrompts.filter(p => p.is_short_nudge || (p.merge_with && p.merge_with.length > 0));
        }
        return activePrompts;
    }, [activePrompts, turnFilter]);

    const displayedPrompts = useMemo(
        () => visiblePrompts.slice(0, renderLimit),
        [visiblePrompts, renderLimit]
    );

    const jumpToTurn = useCallback(
        (targetIdx: number) => {
            if (!activePrompts.length) return;
            let posInVisible = visiblePrompts.findIndex(p => p.idx === targetIdx);
            if (posInVisible < 0) {
                const posInAll = activePrompts.findIndex(p => p.idx === targetIdx);
                if (posInAll < 0) return;
                setTurnFilter('all');
                setRenderLimit(prev => Math.max(prev, posInAll + 8));
            } else if (posInVisible >= renderLimit) {
                setRenderLimit(posInVisible + 8);
            }
            setHighlightedTurnIdx(targetIdx);
            window.setTimeout(() => {
                const el = document.getElementById(`agpc-turn-row-${targetIdx}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 45);
            window.setTimeout(() => {
                setHighlightedTurnIdx(prev => (prev === targetIdx ? null : prev));
            }, 2400);
        },
        [activePrompts, visiblePrompts, renderLimit]
    );

    useEffect(() => {
        if (focusTurnIdx && detail && detail.prompts_sample?.some(p => p.idx === focusTurnIdx)) {
            jumpToTurn(focusTurnIdx);
            onClearFocusTurnIdx?.();
        }
    }, [focusTurnIdx, detail, jumpToTurn, onClearFocusTurnIdx]);

    useEffect(() => {
        if (pendingScrollIdx && !showRealtimeReport && detail && detail.prompts_sample?.some(p => p.idx === pendingScrollIdx)) {
            jumpToTurn(pendingScrollIdx);
            setPendingScrollIdx(null);
        }
    }, [pendingScrollIdx, showRealtimeReport, detail, jumpToTurn]);

    const handleOpenSessionTurnFromReport = useCallback(
        (sessionKey: string, turnIdx?: number) => {
            setShowRealtimeReport(false);
            setMobileDrawerOpen(false);
            onSelectSessionKey(sessionKey);
            if (turnIdx && turnIdx > 0) {
                setPendingScrollIdx(turnIdx);
            }
        },
        [onSelectSessionKey]
    );

    const problemTurnIdxs = useMemo(() => {
        const errList = visiblePrompts
            .filter(p => p.had_tool_error || Boolean(p.assistant_err_snippet))
            .map(p => p.idx);
        if (errList.length > 0) return errList;
        return visiblePrompts
            .filter(p => (p.score ?? 80) < WEAK_SCORE_THRESHOLD)
            .map(p => p.idx);
    }, [visiblePrompts]);

    const handleJumpNextProblem = () => {
        if (problemTurnIdxs.length === 0) return;
        const nextPos = (problemCursorRef.current + 1) % problemTurnIdxs.length;
        problemCursorRef.current = nextPos;
        jumpToTurn(problemTurnIdxs[nextPos]);
    };

    // Layered Escape handler: Close A/B -> Blur Input/Textarea -> Close Drawer -> Exit Fullscreen
    useEffect(() => {
        if (typeof document === 'undefined' || !isFullscreen) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || e.defaultPrevented) return;
            if (composerAbResult) {
                e.preventDefault();
                setComposerAbResult(null);
                return;
            }
            const activeEl = document.activeElement as HTMLElement | null;
            if (
                activeEl &&
                (activeEl.tagName === 'TEXTAREA' ||
                    activeEl.tagName === 'INPUT' ||
                    activeEl.tagName === 'SELECT' ||
                    activeEl.isContentEditable)
            ) {
                e.preventDefault();
                activeEl.blur();
                return;
            }
            if (mobileDrawerOpen) {
                e.preventDefault();
                setMobileDrawerOpen(false);
                return;
            }
            e.preventDefault();
            onExitToOverview();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [isFullscreen, composerAbResult, mobileDrawerOpen, onExitToOverview]);

    // Authentic Antigravity PC Color Tokens
    const shellBg = agDark ? 'bg-[#191919] text-[#e8eaed] border-[#343434]' : 'bg-[#f9f9f8] text-[#1f1f1f] border-[#dfdfd8]';
    const sidebarBg = agDark ? 'bg-[#141414] border-[#2b2b2b]' : 'bg-[#f3f3f2] border-[#e6e6e4]';
    const cardBg = agDark ? 'bg-[#212121] border-[#333333]' : 'bg-white border-[#dfdfd8]';
    const bubbleBg = agDark ? 'bg-[#2b2b2b] border-[#3a3a3a] text-[#e8eaed]' : 'bg-[#f3f3f1] border-[#dfdfd8] text-[#1f1f1f]';
    const mutedTxt = agDark ? 'text-[#a8adb5]' : 'text-[#5f6368]';

    const avgPromptScore =
        detail?.prompt_eval_summary?.avg_prompt_score ??
        detail?.avg_prompt_score ??
        100;
    const focusHabit = detail?.prompt_eval_summary?.focus_habit || detail?.focus_habit;
    const masterPlan = useMemo(
        () => (detail ? buildUnifiedSessionSpec(detail, sessionFileHints) : null),
        [detail, sessionFileHints]
    );

    const workspaceNode = (
        <div
            className={
                isFullscreen
                    ? `fixed inset-0 z-[120] w-screen h-dvh flex flex-col overflow-hidden ${shellBg}`
                    : `rounded-2xl border shadow-md overflow-hidden flex flex-col ${shellBg}`
            }
        >
            {/* Merged Single-Row Top Navigation, Breadcrumb & Filter Bar (~42px) */}
            <div
                className={`px-2.5 py-1.5 border-b flex items-center justify-between gap-2 overflow-x-auto text-xs shrink-0 ${
                    agDark ? 'bg-[#121212] border-[#2b2b2b]' : 'bg-[#f1f1ef] border-[#e3e3e0]'
                }`}
            >
                <div className="flex items-center gap-1.5 min-w-0 shrink-0">
                    {isFullscreen && (
                        <button
                            type="button"
                            onClick={onExitToOverview}
                            title="Thoát chế độ toàn màn hình về Bảng điều hành A12 (Esc)"
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-extrabold cursor-pointer whitespace-nowrap transition-colors ${cardBg} hover:border-indigo-500`}
                        >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>Về A12</span>
                        </button>
                    )}

                    <button
                        type="button"
                        onClick={() => {
                            if (typeof window !== 'undefined' && window.innerWidth < 1024) {
                                setMobileDrawerOpen(v => !v);
                            } else {
                                setSidebarCollapsed(v => !v);
                            }
                        }}
                        title="Đóng/Mở danh sách phiên bên trái"
                        className={`p-1.5 rounded-lg border ${cardBg} cursor-pointer shrink-0`}
                    >
                        <PanelLeft className="w-3.5 h-3.5" />
                    </button>

                    {realtimeReport && (
                        <button
                            type="button"
                            onClick={() => setShowRealtimeReport(v => !v)}
                            title="Mở/Đóng Báo cáo Nhịp Realtime 30 Giây (Nắm bắt toàn cảnh không cần đọc từng câu prompt)"
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-extrabold cursor-pointer whitespace-nowrap transition-colors tabular-nums ${
                                showRealtimeReport
                                    ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-xs'
                                    : 'bg-indigo-600/15 hover:bg-indigo-600/25 text-indigo-700 dark:text-indigo-200 border-indigo-500/40'
                            }`}
                        >
                            <Zap className="w-3.5 h-3.5 text-amber-500 dark:text-amber-300 shrink-0" />
                            <span>
                                {showRealtimeReport
                                    ? 'Đang xem Báo cáo 30s (Bấm về Hội thoại)'
                                    : `Báo cáo Nhịp 30s · 1-Phát ${realtimeReport.kpis.one_shot_rate_pct}%`}
                            </span>
                        </button>
                    )}

                    {detail && (
                        <div className="flex items-center gap-1.5 min-w-0 tabular-nums">
                            {(detail.is_running || activeSummary?.is_running) ? (
                                <AntigravityRunningGridIcon />
                            ) : (
                                <span
                                    className={`w-2 h-2 rounded-full shrink-0 ${
                                        (TOOL_STYLE[detail.tool] || { dotCls: 'bg-indigo-600' }).dotCls
                                    }`}
                                />
                            )}
                            <span className="font-extrabold truncate max-w-[165px] xl:max-w-[260px]" title={detail.title}>
                                {detail.project ? `[${detail.project}] ` : ''}
                                {cleanTitle(detail.title, detail.first_human_preview, detail.session_key)}
                            </span>
                            <span
                                className={`px-2 py-0.5 rounded-full border font-extrabold whitespace-nowrap ${scorePillClasses(
                                    avgPromptScore,
                                    agDark
                                )}`}
                            >
                                TB {avgPromptScore}đ
                            </span>
                            <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-bold whitespace-nowrap ${cardBg}`}>
                                <span>
                                    {activePrompts.length}p · {weakCount} yếu
                                </span>
                                {(detail.total_tool_calls || 0) > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                        <span>·</span>
                                        <Wrench className="w-3 h-3 text-indigo-500" />
                                        <span>{detail.total_tool_calls}</span>
                                        {(detail.tool_error_count || 0) > 0 && (
                                            <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                                ({detail.tool_error_count} lỗi)
                                            </span>
                                        )}
                                    </span>
                                )}
                            </span>
                            <button
                                type="button"
                                disabled={isAnalyzingCurrent}
                                onClick={() => void handleTriggerAiAnalyze()}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-extrabold cursor-pointer whitespace-nowrap"
                            >
                                <Sparkles className={`w-3.5 h-3.5 ${isAnalyzingCurrent ? 'animate-spin' : ''}`} />
                                <span>{isAnalyzingCurrent ? 'AI đang chấm...' : 'AI chấm sâu'}</span>
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0 tabular-nums">
                    <div className="flex items-center gap-1">
                        {(
                            [
                                ['today', 'Hôm nay'],
                                ['yesterday', 'Hôm qua'],
                                ['7d', '7d'],
                                ['30d', '30d'],
                                ['all', 'Tất cả'],
                            ] as Array<[AgPcPeriodKey, string]>
                        ).map(([pk, pl]) => (
                            <button
                                key={pk}
                                type="button"
                                onClick={() => onChangePeriod(pk)}
                                className={`px-2 py-1 rounded-lg font-bold border cursor-pointer whitespace-nowrap transition-colors ${
                                    period === pk
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : `${cardBg} hover:border-indigo-400`
                                }`}
                            >
                                {pl}
                            </button>
                        ))}
                        <input
                            type="date"
                            value={customDate}
                            onChange={e => {
                                const val = e.target.value;
                                if (val) onChangePeriod('date', val);
                                else onChangePeriod('today');
                            }}
                            aria-label="Chọn ngày cụ thể"
                            className={`px-1.5 py-0.5 rounded-lg border font-bold tabular-nums ${cardBg}`}
                        />
                    </div>

                    <div className="flex items-center gap-1">
                        {[
                            ['all', '3 AI'],
                            ['antigravity', 'AG'],
                            ['claude', 'Claude'],
                            ['codex', 'Codex'],
                        ].map(([tk, tl]) => (
                            <button
                                key={tk}
                                type="button"
                                onClick={() => onChangeToolFilter(tk)}
                                className={`px-2 py-1 rounded-lg font-bold border cursor-pointer whitespace-nowrap transition-colors ${
                                    toolFilter === tk
                                        ? agDark
                                            ? 'bg-white text-slate-900 border-white'
                                            : 'bg-slate-900 text-white border-slate-900'
                                        : cardBg
                                }`}
                            >
                                {tl}
                            </button>
                        ))}
                    </div>

                    <label className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-bold cursor-pointer select-none whitespace-nowrap ${cardBg}`}>
                        <input
                            type="checkbox"
                            checked={includeSub}
                            onChange={e => onChangeIncludeSub(e.target.checked)}
                            className="rounded border-slate-300 text-indigo-600"
                        />
                        <span>Ngầm</span>
                    </label>

                    <button
                        type="button"
                        onClick={() => setAgDark(v => !v)}
                        title={agDark ? 'Chuyển giao diện Sáng' : 'Chuyển giao diện Tối'}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-bold cursor-pointer whitespace-nowrap ${cardBg}`}
                    >
                        {agDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-600" />}
                        <span className="hidden xl:inline">{agDark ? 'Sáng' : 'Tối'}</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setIsFullscreen(v => !v)}
                        title={isFullscreen ? 'Thu gọn về trong khung Tab A12' : 'Bung toàn màn hình giống hệt Antigravity PC'}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold cursor-pointer whitespace-nowrap"
                    >
                        {isFullscreen ? (
                            <>
                                <Minimize2 className="w-3.5 h-3.5" />
                                <span>Thu khung</span>
                            </>
                        ) : (
                            <>
                                <Maximize2 className="w-3.5 h-3.5" />
                                <span>Full Màn Hình</span>
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Simulated Antigravity PC Window Body */}
            <div className={`relative flex flex-1 min-h-0 ${isFullscreen ? '' : 'min-h-[760px] max-h-[86vh]'}`}>
                {/* Mobile Drawer Backdrop */}
                {mobileDrawerOpen && (
                    <div
                        className="fixed inset-0 z-40 bg-slate-950/55 lg:hidden"
                        onClick={() => setMobileDrawerOpen(false)}
                    />
                )}

                {/* 1. LEFT SIDEBAR — Antigravity PC Agent Manager */}
                <aside
                    className={`${sidebarBg} border-r flex flex-col shrink-0 transition-all z-50 ${
                        sidebarCollapsed ? 'lg:w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-[272px]'
                    } ${
                        mobileDrawerOpen
                            ? 'fixed inset-y-0 left-0 w-[285px] shadow-2xl flex'
                            : 'hidden lg:flex'
                    }`}
                >
                    <div className="px-3.5 pt-2.5 pb-2 flex items-center justify-between gap-2">
                        <div className="inline-flex items-center gap-2 font-bold text-xs sm:text-sm">
                            <AntigravityRibbonIcon className="w-[18px] h-[18px]" />
                            <span>Antigravity PC</span>
                        </div>
                        <div className="flex items-center gap-0.5">
                            {onTriggerPcSync && (
                                <button
                                    type="button"
                                    disabled={pcSyncing}
                                    onClick={() => void onTriggerPcSync()}
                                    title="Đồng bộ tức thì thứ tự & dữ liệu từ PC ngay lập tức"
                                    className={`p-1.5 rounded-md ${mutedTxt} hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50 cursor-pointer`}
                                >
                                    <RefreshCw className={`w-3.5 h-3.5 ${pcSyncing ? 'animate-spin text-indigo-500' : ''}`} />
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => stepSession(-1)}
                                title="Phiên trước"
                                className={`p-1.5 rounded-md ${mutedTxt} hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer`}
                            >
                                <ArrowLeft className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => stepSession(1)}
                                title="Phiên tiếp theo"
                                className={`p-1.5 rounded-md ${mutedTxt} hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer`}
                            >
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Search Box */}
                    <div className="px-3 pb-2">
                        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border ${cardBg}`}>
                            <Search className={`w-3.5 h-3.5 shrink-0 ${mutedTxt}`} />
                            <input
                                type="text"
                                value={sidebarSearch}
                                onChange={e => setSidebarSearch(e.target.value)}
                                placeholder="Tìm phiên, dự án, nội dung..."
                                className="w-full bg-transparent text-xs outline-none"
                            />
                            {sidebarSearch && (
                                <button
                                    type="button"
                                    onClick={() => setSidebarSearch('')}
                                    aria-label="Xóa tìm kiếm"
                                    className="cursor-pointer"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Quick Actions */}
                    <div className="px-3 pb-2 space-y-1">
                        {realtimeReport && (
                            <button
                                type="button"
                                onClick={() => {
                                    setShowRealtimeReport(v => !v);
                                    setMobileDrawerOpen(false);
                                }}
                                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-extrabold flex items-center justify-between gap-2 cursor-pointer transition-colors tabular-nums ${
                                    showRealtimeReport
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                                        : 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-500/35'
                                }`}
                            >
                                <span className="inline-flex items-center gap-1.5">
                                    <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                    <span>Báo cáo Nhịp Realtime 30s</span>
                                </span>
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-200 font-black">
                                    {realtimeReport.kpis.one_shot_rate_pct}%
                                </span>
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={() => {
                                setShowRealtimeReport(false);
                                setMobileDrawerOpen(false);
                                composerRef.current?.focus();
                            }}
                            className={`w-full px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${cardBg} hover:border-indigo-500`}
                        >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Soạn &amp; Test Prompt Mới</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setOnlyErrSessions(v => !v)}
                            className={`w-full px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between cursor-pointer transition-colors ${
                                onlyErrSessions
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-400/40'
                                    : `${mutedTxt} hover:bg-black/5 dark:hover:bg-white/5`
                            }`}
                        >
                            <span className="inline-flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                <span>Chỉ lọc phiên dính lỗi Tool</span>
                            </span>
                            <span className="tabular-nums font-extrabold text-rose-600 dark:text-rose-400">
                                {errSessionsCount}
                            </span>
                        </button>
                    </div>

                    {/* Workspaces & Projects Tree */}
                    <div className="flex-1 overflow-y-auto px-3 py-1.5 space-y-3">
                        <div className={`px-1.5 flex items-center justify-between gap-1 text-xs font-semibold ${mutedTxt} tabular-nums`}>
                            <span>Workspaces ({groupedByProject.length})</span>
                            <button
                                type="button"
                                onClick={() =>
                                    setSidebarSortMode(m => (m === 'realtime' ? 'priority' : 'realtime'))
                                }
                                title={
                                    sidebarSortMode === 'realtime'
                                        ? 'Đang sắp xếp Realtime 1:1 giống Antigravity PC (Đang chạy → Mới sửa gần nhất). Bấm để chuyển sang Ưu tiên nhiều lỗi.'
                                        : 'Đang sắp xếp theo Ưu tiên nhiều lỗi/phiên dài. Bấm để quay về Thứ tự Realtime chuẩn Antigravity PC.'
                                }
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-bold cursor-pointer transition-colors ${
                                    sidebarSortMode === 'realtime'
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40'
                                        : `${cardBg}`
                                }`}
                            >
                                <span
                                    className={`w-1.5 h-1.5 rounded-full ${
                                        sidebarSortMode === 'realtime'
                                            ? 'bg-emerald-500 animate-pulse'
                                            : 'bg-amber-500'
                                    }`}
                                />
                                <span>
                                    {sidebarSortMode === 'realtime' ? 'Realtime' : 'Nhiều lỗi'} · {filteredSidebarSessions.length}
                                </span>
                            </button>
                        </div>

                        {pinnedSidebarSessions.length > 0 && (
                            <div className="space-y-1">
                                <div className={`px-1.5 py-1 flex items-center gap-1.5 text-xs font-bold ${mutedTxt}`}>
                                    <Pin className="w-3.5 h-3.5 shrink-0 text-amber-500" />
                                    <span>Đã ghim</span>
                                </div>
                                {pinnedSidebarSessions.map(s => {
                                    const isActive = s.session_key === effectiveSessionKey;
                                    const sScore = Math.round(s.avg_prompt_score ?? s.rule_score ?? 100);
                                    const tm = TOOL_STYLE[s.tool] || {
                                        label: s.tool,
                                        shortLabel: s.tool,
                                        dotCls: 'bg-slate-500',
                                    };
                                    return (
                                        <button
                                            key={`pin-${s.session_key}`}
                                            type="button"
                                            onClick={() => {
                                                setShowRealtimeReport(false);
                                                onSelectSessionKey(s.session_key);
                                                setMobileDrawerOpen(false);
                                            }}
                                            className={`w-full text-left px-2.5 py-2 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                                                isActive
                                                    ? agDark
                                                        ? 'bg-[#2a2a2a] border-[#454545]'
                                                        : 'bg-[#e3e3e0] border-[#cfcfc8]'
                                                    : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-1.5">
                                                <span className="text-xs font-semibold leading-snug line-clamp-2 break-words">
                                                    {cleanTitle(s.title, s.first_human_preview, s.session_key)}
                                                </span>
                                                <span
                                                    className={`px-2 py-0.5 rounded-full border text-xs font-extrabold shrink-0 tabular-nums ${scorePillClasses(
                                                        sScore,
                                                        agDark
                                                    )}`}
                                                >
                                                    {sScore}đ
                                                </span>
                                            </div>
                                            <div className={`flex items-center justify-between gap-1.5 text-xs ${mutedTxt} tabular-nums`}>
                                                <span className="inline-flex items-center gap-1.5 font-semibold truncate">
                                                    <span className={`w-2 h-2 rounded-full shrink-0 ${tm.dotCls}`} />
                                                    <span>
                                                        {tm.label} · {s.n_human_prompts}p
                                                    </span>
                                                    {(s.tool_error_count || 0) > 0 && (
                                                        <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                                            · {s.tool_error_count} lỗi
                                                        </span>
                                                    )}
                                                </span>
                                                {s.is_running ? (
                                                    <AntigravityRunningGridIcon />
                                                ) : (
                                                    <span className="shrink-0">
                                                        {formatRelTime(getSessionActivityTs(s), nowEpochSec)}
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        {groupedByProject.length === 0 && pinnedSidebarSessions.length === 0 ? (
                            <div className={`py-8 text-center text-xs ${mutedTxt}`}>
                                Không có phiên nào khớp bộ lọc hiện tại.
                            </div>
                        ) : (
                            groupedByProject.map(([projName, list]) => (
                                <div key={projName} className="space-y-1">
                                    <div className={`px-1.5 py-1 flex items-center gap-1.5 text-xs font-bold ${mutedTxt}`}>
                                        <Folder className="w-3.5 h-3.5 shrink-0" />
                                        <span className="truncate">{projName}</span>
                                    </div>
                                    {list.map(s => {
                                        const isActive = s.session_key === effectiveSessionKey;
                                        const sScore = Math.round(s.avg_prompt_score ?? s.rule_score ?? 100);
                                        const tm = TOOL_STYLE[s.tool] || {
                                            label: s.tool,
                                            shortLabel: s.tool,
                                            dotCls: 'bg-slate-500',
                                        };
                                        return (
                                            <button
                                                key={s.session_key}
                                                type="button"
                                                onClick={() => {
                                                    onSelectSessionKey(s.session_key);
                                                    setMobileDrawerOpen(false);
                                                }}
                                                className={`w-full text-left px-2.5 py-2 rounded-xl border transition-colors cursor-pointer space-y-1 ${
                                                    isActive
                                                        ? agDark
                                                            ? 'bg-[#2a2a2a] border-[#454545]'
                                                            : 'bg-[#e3e3e0] border-[#cfcfc8]'
                                                        : 'border-transparent hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-1.5">
                                                    <span className="text-xs font-semibold leading-snug line-clamp-2 break-words">
                                                        {cleanTitle(s.title, s.first_human_preview, s.session_key)}
                                                    </span>
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full border text-xs font-extrabold shrink-0 tabular-nums ${scorePillClasses(
                                                            sScore,
                                                            agDark
                                                        )}`}
                                                    >
                                                        {sScore}đ
                                                    </span>
                                                </div>
                                                <div className={`flex items-center justify-between gap-1.5 text-xs ${mutedTxt} tabular-nums`}>
                                                    <span className="inline-flex items-center gap-1.5 font-semibold truncate">
                                                        <span className={`w-2 h-2 rounded-full shrink-0 ${tm.dotCls}`} />
                                                        <span>
                                                            {tm.label} · {s.n_human_prompts}p
                                                        </span>
                                                        {(s.tool_error_count || 0) > 0 && (
                                                            <span className="text-rose-600 dark:text-rose-400 font-extrabold">
                                                                · {s.tool_error_count} lỗi
                                                            </span>
                                                        )}
                                                    </span>
                                                    {s.is_running ? (
                                                        <AntigravityRunningGridIcon />
                                                    ) : (
                                                        <span className="shrink-0">
                                                            {formatRelTime(getSessionActivityTs(s), nowEpochSec)}
                                                        </span>
                                                    )}
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            ))
                        )}
                    </div>

                    {/* Sidebar Footer Host Box */}
                    <div className={`p-2.5 border-t ${agDark ? 'border-[#2b2b2b]' : 'border-[#e6e6e4]'}`}>
                        <button
                            type="button"
                            onClick={() => onToggleRealtimeAuto?.()}
                            title={
                                realtimeAuto
                                    ? 'Đang tự động đồng bộ thứ tự & lượt chạy Realtime (~3 giây). Bấm để tạm dừng.'
                                    : 'Tự động đồng bộ Realtime đang tắt. Bấm để bật lại.'
                            }
                            className={`w-full px-3 py-1.5 rounded-lg border flex items-center justify-between text-xs font-semibold tabular-nums cursor-pointer ${cardBg}`}
                        >
                            <span className="inline-flex items-center gap-2">
                                <span
                                    className={`w-2 h-2 rounded-full ${
                                        realtimeAuto ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                                    }`}
                                />
                                <span>{realtimeAuto ? 'Realtime PC · 3s' : 'Tạm dừng Realtime'}</span>
                            </span>
                            <span className={mutedTxt}>{totalMatchingSessions.toLocaleString('vi-VN')} phiên</span>
                        </button>
                    </div>
                </aside>

                {/* 2. RIGHT MAIN ANTIGRAVITY CANVAS (Chia đôi Song song 1-1: Thật ↔ 1-Phát) */}
                <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                    {/* Scrollable Split Conversation Canvas */}
                    <div ref={canvasScrollRef} className="flex-1 overflow-y-auto px-3.5 sm:px-5 pb-5 space-y-3.5">
                        {showRealtimeReport && realtimeReport ? (
                            <div className={`${isFullscreen ? 'max-w-[1680px]' : 'max-w-[1240px]'} mx-auto pt-3 space-y-3.5`}>
                                <RealtimeExecutiveReportPanel
                                    report={realtimeReport}
                                    dark={agDark}
                                    copiedId={copiedId}
                                    onCopy={onCopy}
                                    onOpenSessionTurn={handleOpenSessionTurnFromReport}
                                    onLoadTemplateToComposer={tpl => {
                                        setShowRealtimeReport(false);
                                        loadIntoComposer(tpl, 'Đã nạp mẫu 1-Phát vào ô Composer!');
                                    }}
                                    onCloseReportView={() => setShowRealtimeReport(false)}
                                />
                            </div>
                        ) : detailLoading && !detail ? (
                            <div className="py-16 text-center space-y-2 text-xs">
                                <RefreshCw className="w-6 h-6 animate-spin text-indigo-500 mx-auto" />
                                <div className="font-bold">Đang mở luồng Antigravity PC của phiên...</div>
                            </div>
                        ) : detailErr ? (
                            <div className="mt-4 rounded-xl border border-rose-400/50 bg-rose-500/10 p-4 text-xs font-bold text-rose-600 dark:text-rose-300">
                                {detailErr}
                            </div>
                        ) : !detail ? (
                            <div className={`py-16 text-center text-xs ${mutedTxt}`}>
                                Không có phiên nào khớp bộ lọc hiện tại hoặc chưa chọn phiên.
                            </div>
                        ) : (
                            <div className={`${isFullscreen ? 'max-w-[1680px]' : 'max-w-[1240px]'} mx-auto pt-3 space-y-3.5`}>
                                {/* Global 30-Second Realtime Pulse Strip — 1-click access to Executive Report */}
                                {realtimeReport && (
                                    <div
                                        className={`rounded-xl border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
                                            agDark
                                                ? 'bg-indigo-950/35 border-indigo-500/40 text-indigo-100'
                                                : 'bg-indigo-50/90 border-indigo-200 text-slate-900'
                                        }`}
                                    >
                                        <span className="inline-flex items-center gap-2 font-bold min-w-0">
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-600 text-white font-extrabold shrink-0">
                                                <Zap className="w-3 h-3 text-amber-300" />
                                                <span>Nhịp 30s</span>
                                            </span>
                                            <span className="truncate">{realtimeReport.headline}</span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => setShowRealtimeReport(true)}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer shrink-0"
                                        >
                                            <span>Mở Báo cáo Nhịp Realtime 30s →</span>
                                        </button>
                                    </div>
                                )}

                                {/* Focus Habit Banner (inside scroll region so it never steals fixed viewport height) */}
                                {focusHabit && (
                                    <div
                                        className={`rounded-xl border px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${cardBg}`}
                                    >
                                        <span className={`inline-flex items-center gap-1.5 font-bold ${mutedTxt}`}>
                                            <Target className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span>
                                                Thói quen ưu tiên #1 phiên này:{' '}
                                                <strong className={agDark ? 'text-white' : 'text-slate-900'}>
                                                    {focusHabit.title}
                                                </strong>
                                            </span>
                                        </span>
                                        {focusHabit.action_tip && (
                                            <span className="font-semibold text-indigo-600 dark:text-indigo-300">
                                                {focusHabit.action_tip}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {/* Session Summary + Realistic Multi-Stage / 1-Shot Master Spec Card */}
                                {masterPlan && (
                                    <div className={`rounded-2xl border p-3.5 grid grid-cols-1 lg:grid-cols-12 gap-3.5 ${cardBg}`}>
                                        <div className="lg:col-span-5 space-y-2 text-xs">
                                            <div className="text-sm font-extrabold">Tổng kết &amp; Chiến lược Phiên</div>
                                            <p className={`${mutedTxt} leading-relaxed tabular-nums`}>
                                                Phiên gốc có <strong>{detail.n_human_prompts || activePrompts.length}</strong> câu prompt (
                                                <strong>{weakCount}</strong> câu &lt;{WEAK_SCORE_THRESHOLD}đ,{' '}
                                                <strong>{detail.tool_error_count || 0}</strong> lỗi tool /{' '}
                                                {(detail.total_tool_calls || 0).toLocaleString('vi-VN')} lệnh tool) · Điểm TB{' '}
                                                <strong>{avgPromptScore}/100đ</strong>.
                                            </p>
                                            {masterPlan.splitStrategyText && (
                                                <div
                                                    className={`rounded-xl border p-2.5 leading-relaxed ${
                                                        agDark
                                                            ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
                                                            : 'bg-amber-50 border-amber-200 text-amber-950'
                                                    }`}
                                                >
                                                    <strong>Phác đồ chia chặng:</strong> {masterPlan.splitStrategyText}
                                                </div>
                                            )}
                                            {detail.ai_analysis?.diagnosis && (
                                                <div
                                                    className={`rounded-xl border p-2.5 leading-relaxed ${
                                                        agDark
                                                            ? 'bg-indigo-950/35 border-indigo-800/60 text-indigo-200'
                                                            : 'bg-indigo-50 border-indigo-200 text-indigo-950'
                                                    }`}
                                                >
                                                    <strong>Chẩn đoán AI:</strong> {detail.ai_analysis.diagnosis}
                                                </div>
                                            )}
                                        </div>

                                        <div
                                            className={`lg:col-span-7 rounded-xl border p-3.5 space-y-2 text-xs ${
                                                agDark
                                                    ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-100'
                                                    : 'bg-[#e6f4ea] border-[#a8dab5] text-[#1f1f1f]'
                                            }`}
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 font-extrabold ${
                                                        agDark ? 'text-emerald-300' : 'text-[#137333]'
                                                    } tabular-nums`}
                                                >
                                                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                                    <span>
                                                        {masterPlan.isLongMultiStage
                                                            ? `Phác đồ Tách ${masterPlan.idealSessions} Phiên & Spec 1-Phát (Còn ~${masterPlan.estPromptsAfter}p · Tiết kiệm ~${masterPlan.savedTurns} lượt)`
                                                            : `Bản Gộp 1-Phát Mở Đầu Phiên (Tiết kiệm ~${masterPlan.savedTurns} lượt)`}
                                                    </span>
                                                </span>
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            onCopy(
                                                                masterPlan.specText,
                                                                `agpc-uni-${detail.session_key}`,
                                                                'Đã copy Bản Spec 1-Phát!'
                                                            )
                                                        }
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold cursor-pointer"
                                                    >
                                                        {copiedId === `agpc-uni-${detail.session_key}` ? (
                                                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                                                        ) : (
                                                            <Copy className="w-3.5 h-3.5" />
                                                        )}
                                                        <span>Copy 1-Phát</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            loadIntoComposer(
                                                                masterPlan.specText,
                                                                'Đã nạp Spec 1-Phát xuống Composer!',
                                                                detail.first_human_preview || ''
                                                            )
                                                        }
                                                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                                                    >
                                                        Nạp Composer
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            void onSavePrivatePrompt(
                                                                `1-Phát: ${cleanTitle(detail.title, detail.first_human_preview, detail.session_key).slice(0, 48)}`,
                                                                masterPlan.specText,
                                                                '1-shot',
                                                                detail.tool,
                                                                detail.first_human_preview,
                                                                detail.ai_analysis?.key_takeaway || 'Rút từ giao diện Antigravity PC Song song'
                                                            )
                                                        }
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                                    >
                                                        <Save className="w-3.5 h-3.5" />
                                                        <span>Lưu Kho</span>
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="whitespace-pre-wrap break-words leading-relaxed">{masterPlan.specText}</div>
                                        </div>
                                    </div>
                                )}

                                {/* Sticky Filter & Jump-to-Error Bar + Column Headers */}
                                <div
                                    className={`sticky top-0 z-20 py-2 border-b space-y-2 ${
                                        agDark
                                            ? 'bg-[#191919]/95 border-[#2e2e2e]'
                                            : 'bg-[#f9f9f8]/95 border-[#e3e3e0]'
                                    } backdrop-blur-xs`}
                                >
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span className={`font-bold ${mutedTxt}`}>Lọc lượt:</span>
                                            {(
                                                [
                                                    ['all', `Tất cả (${activePrompts.length})`],
                                                    ['weak', `Câu yếu <${WEAK_SCORE_THRESHOLD}đ (${computedWeakTurnsCount})`],
                                                    ['err', `Dính lỗi Tool (${errTurnsCount})`],
                                                    ['redundant', `Lượt thừa gộp được (${redundantTurnsCount})`],
                                                ] as const
                                            ).map(([fk, fl]) => (
                                                <button
                                                    key={fk}
                                                    type="button"
                                                    onClick={() => setTurnFilter(fk)}
                                                    className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer transition-colors ${
                                                        turnFilter === fk
                                                            ? 'bg-indigo-600 text-white border-indigo-600'
                                                            : `${cardBg} hover:border-indigo-400`
                                                    }`}
                                                >
                                                    {fl}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2">
                                            {problemTurnIdxs.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={handleJumpNextProblem}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-extrabold cursor-pointer"
                                                >
                                                    <ArrowDown className="w-3.5 h-3.5" />
                                                    <span>
                                                        {errTurnsCount > 0
                                                            ? `Nhảy lượt lỗi kế tiếp (${errTurnsCount})`
                                                            : `Nhảy câu yếu kế tiếp (${problemTurnIdxs.length})`}
                                                    </span>
                                                </button>
                                            )}
                                            <span className={mutedTxt}>
                                                Hiện <strong>{displayedPrompts.length}</strong>/{visiblePrompts.length} lượt
                                            </span>
                                        </div>
                                    </div>

                                    <div className="hidden lg:grid lg:grid-cols-2 gap-3.5 text-xs font-extrabold">
                                        <div className={`px-3 py-1.5 rounded-xl border flex items-center justify-between ${bubbleBg}`}>
                                            <span className="inline-flex items-center gap-1.5">
                                                <MessageSquare className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                <span>Luồng Antigravity thật của anh</span>
                                            </span>
                                            <span className="tabular-nums">{visiblePrompts.length} lượt khớp lọc</span>
                                        </div>
                                        <div
                                            className={`px-3 py-1.5 rounded-xl border flex items-center justify-between ${
                                                agDark
                                                    ? 'bg-emerald-950/35 border-emerald-800/70 text-emerald-300'
                                                    : 'bg-[#e6f4ea] border-[#a8dab5] text-[#137333]'
                                            }`}
                                        >
                                            <span className="inline-flex items-center gap-1.5">
                                                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                                <span>Đối chiếu 1-Phát tương ứng từng lượt</span>
                                            </span>
                                            <span>Thu gọn lượt đạt chuẩn &amp; lượt thừa</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Turn-by-Turn 1-to-1 Aligned Side-by-Side Stream (Chunked 25 + content-visibility) */}
                                <div className="space-y-3">
                                    {displayedPrompts.map(p => {
                                        const pScore = typeof p.score === 'number' ? p.score : 80;
                                        const pVerdict = p.verdict || (pScore >= 80 ? 'Đạt chuẩn' : 'Cần bổ sung Spec');
                                        const isRedundant = Boolean(
                                            p.is_short_nudge || (p.merge_with && p.merge_with.length > 0)
                                        );
                                        const isAlreadyGood =
                                            pScore >= 80 && !p.had_tool_error && !p.assistant_err_snippet && !isRedundant;
                                        const thKey = `${detail.session_key}:${p.idx}`;
                                        const thOpen = Boolean(expandedThoughts[thKey]);
                                        const rawPromptTxt = (p.text_redacted || '').trim();
                                        const isLongPrompt =
                                            rawPromptTxt.length > 360 || rawPromptTxt.split(/\r?\n/).length > 6;
                                        const promptExpanded = Boolean(expandedLongPrompts[thKey]);

                                        const deepOpt = inlineDeepSpecs[thKey];
                                        const isDeepLoading = inlineDeepLoadingKey === thKey;
                                        const turnFiles = (p.files_touched || []).filter(Boolean).slice(0, 4);
                                        const failedList = (p.failed_tools || []).map(x => x.trim()).filter(Boolean);
                                        const failedSet = new Set(failedList);

                                        const rawCandidateImproved = (
                                            deepOpt?.full_spec_prompt ||
                                            deepOpt?.compact_prompt ||
                                            p.improved_prompt ||
                                            rawPromptTxt
                                        ).trim();
                                        const effectiveImproved = enrichPromptPlaceholder(
                                            rawCandidateImproved,
                                            turnFiles,
                                            sessionFileHints,
                                            p.assistant_err_snippet
                                        );

                                        const trigTools = (p.tools_triggered || []).filter(Boolean);
                                        const mergedTools = [...trigTools];
                                        failedList.forEach(ft => {
                                            if (!mergedTools.includes(ft)) mergedTools.push(ft);
                                        });
                                        const totalTurnToolCalls = p.tool_call_count || mergedTools.length;
                                        const realDurationLabel = formatTurnDuration(p.turn_duration_s);
                                        const summaryTxt = (p.assistant_summary || '').trim();
                                        const missingList = (p.checks || [])
                                            .filter(c => !c.ok && c.applicable !== false)
                                            .map(c => c.label);
                                        const mergeTargetIdx = p.merge_with?.[0];
                                        const isRowHighlighted = highlightedTurnIdx === p.idx;

                                        return (
                                            <div
                                                id={`agpc-turn-row-${p.idx}`}
                                                key={`${detail.session_key}-pair-${p.idx}`}
                                                style={{
                                                    contentVisibility: 'auto',
                                                    containIntrinsicSize: 'auto 210px',
                                                }}
                                                className={`rounded-2xl border p-3.5 grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start transition-shadow scroll-mt-24 ${cardBg} ${
                                                    isRowHighlighted ? 'ring-2 ring-indigo-500 shadow-lg' : ''
                                                }`}
                                            >
                                                {/* LEFT: Authentic Antigravity PC Real Turn */}
                                                <div className="space-y-2 min-w-0">
                                                    <div className="flex flex-col items-end gap-1.5">
                                                        <div className="flex flex-wrap items-center justify-end gap-1.5 text-xs tabular-nums">
                                                            <span className={`px-2 py-0.5 rounded-full border font-bold ${cardBg} ${mutedTxt}`}>
                                                                #{p.idx} · {p.stage_label || STAGE_LABELS[p.stage || ''] || 'Thực thi'} · {p.chars} ký tự
                                                            </span>
                                                            <span
                                                                className={`px-2.5 py-0.5 rounded-full border font-extrabold ${scorePillClasses(
                                                                    pScore,
                                                                    agDark
                                                                )}`}
                                                            >
                                                                {pScore}/100đ · {pVerdict}
                                                            </span>
                                                            {p.ai_scored && (
                                                                <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white font-bold">
                                                                    AI chấm
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div
                                                            className={`max-w-[94%] rounded-2xl border px-3.5 py-2.5 text-xs sm:text-sm leading-relaxed break-words ${bubbleBg}`}
                                                        >
                                                            <div
                                                                className={`whitespace-pre-wrap ${
                                                                    isLongPrompt && !promptExpanded ? 'line-clamp-6' : ''
                                                                }`}
                                                            >
                                                                {rawPromptTxt}
                                                            </div>
                                                            {isLongPrompt && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setExpandedLongPrompts(prev => ({
                                                                            ...prev,
                                                                            [thKey]: !prev[thKey],
                                                                        }))
                                                                    }
                                                                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-extrabold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                                                                >
                                                                    {promptExpanded ? (
                                                                        <>
                                                                            <ChevronUp className="w-3.5 h-3.5" />
                                                                            <span>Thu gọn</span>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <ChevronDown className="w-3.5 h-3.5" />
                                                                            <span>Xem trọn câu ({p.chars} ký tự)</span>
                                                                        </>
                                                                    )}
                                                                </button>
                                                            )}
                                                        </div>

                                                        {/* 7-Dimension Mini Matrix */}
                                                        <div className="flex flex-wrap items-center justify-end gap-1 tabular-nums">
                                                            {RUBRIC_DIMS.map(d => {
                                                                const chk = (p.checks || []).find(c => c.key === d.key);
                                                                const isApp = chk ? chk.applicable !== false : true;
                                                                const isOk = chk
                                                                    ? chk.ok
                                                                    : Number(p.dimension_scores?.[d.key] ?? 100) >= 75;
                                                                const cls = !isApp
                                                                    ? `${cardBg} ${mutedTxt} opacity-65`
                                                                    : isOk
                                                                      ? scorePillClasses(90, agDark)
                                                                      : scorePillClasses(30, agDark);
                                                                return (
                                                                    <span
                                                                        key={d.key}
                                                                        title={`${d.label}: ${!isApp ? 'Tùy chọn' : isOk ? 'Đạt' : 'Thiếu'}`}
                                                                        className={`px-1.5 py-0.5 rounded border text-xs font-extrabold ${cls}`}
                                                                    >
                                                                        {d.short}
                                                                    </span>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>

                                                    {/* Authentic Antigravity Work Block (Real Duration + Summary + Files Touched + Tool Trace) */}
                                                    <div
                                                        className={`pl-3 ml-1 border-l-2 space-y-1.5 text-xs ${
                                                            agDark ? 'border-[#333333]' : 'border-[#dfdfd8]'
                                                        }`}
                                                    >
                                                        <div className={`rounded-xl border overflow-hidden ${cardBg}`}>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setExpandedThoughts(prev => ({
                                                                        ...prev,
                                                                        [thKey]: !prev[thKey],
                                                                    }))
                                                                }
                                                                className={`w-full px-3 py-1.5 flex items-center justify-between gap-2 text-left font-semibold cursor-pointer tabular-nums ${mutedTxt}`}
                                                            >
                                                                <span className="inline-flex items-center gap-1.5 min-w-0">
                                                                    {realDurationLabel ? (
                                                                        <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                                    ) : (
                                                                        <Sparkles className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                                                    )}
                                                                    <span className="truncate">
                                                                        {realDurationLabel
                                                                            ? `Thực thi ${realDurationLabel}`
                                                                            : 'Phản hồi Agent'}
                                                                        {totalTurnToolCalls > 0
                                                                            ? ` · ${totalTurnToolCalls} lệnh tool`
                                                                            : ''}
                                                                        {' · '}
                                                                        {pScore < 60
                                                                            ? 'Thiếu Spec nên phải dò ngữ cảnh'
                                                                            : 'Nhận rõ mục tiêu'}
                                                                    </span>
                                                                </span>
                                                                {thOpen ? (
                                                                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                                                                ) : (
                                                                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                                                                )}
                                                            </button>

                                                            {summaryTxt && (
                                                                <div
                                                                    className={`px-3 py-1.5 border-t leading-relaxed break-words ${
                                                                        agDark
                                                                            ? 'border-[#2e2e2e] text-[#d5d9df]'
                                                                            : 'border-[#ededeb] text-[#33363b]'
                                                                    }`}
                                                                >
                                                                    <span className={`font-bold ${mutedTxt}`}>Kết luận AI: </span>
                                                                    {summaryTxt}
                                                                </div>
                                                            )}

                                                            {thOpen && (
                                                                <div
                                                                    className={`px-3 py-1.5 border-t leading-relaxed ${mutedTxt} ${
                                                                        agDark ? 'border-[#2e2e2e]' : 'border-[#ededeb]'
                                                                    }`}
                                                                >
                                                                    {p.had_tool_error && p.assistant_err_snippet
                                                                        ? `Lượt này vấp lỗi công cụ: ${p.assistant_err_snippet}`
                                                                        : missingList.length > 0
                                                                          ? `Câu lệnh thiếu [${missingList.join(', ')}] nên Agent phải dò thêm ngữ cảnh hoặc dễ làm chệch ý.`
                                                                          : `Đã xác định rõ phạm vi dự án ${detail.project || 'AG'} và thực thi thẳng.`}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {turnFiles.length > 0 && (
                                                            <div className="flex flex-wrap items-center gap-1">
                                                                {turnFiles.map((fp, fi) => (
                                                                    <span
                                                                        key={`${fp}-${fi}`}
                                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-xs ${cardBg}`}
                                                                    >
                                                                        <FileCode className="w-3 h-3 text-sky-500 shrink-0" />
                                                                        <span className="truncate max-w-[220px]" title={fp}>
                                                                            {fp}
                                                                        </span>
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {(mergedTools.length > 0 || (p.had_tool_error && failedSet.size === 0)) && (
                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                {mergedTools.map((tn, ti) => {
                                                                    const isCmd =
                                                                        tn.includes('command') || tn.includes('Bash');
                                                                    const isConfirmedFailed = failedSet.has(tn);
                                                                    const isConfirmedOk =
                                                                        !isConfirmedFailed &&
                                                                        (!p.had_tool_error || failedSet.size > 0);
                                                                    return (
                                                                        <span
                                                                            key={`${tn}-${ti}`}
                                                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border font-mono text-xs font-semibold ${
                                                                                isConfirmedFailed
                                                                                    ? scorePillClasses(30, agDark)
                                                                                    : cardBg
                                                                            }`}
                                                                        >
                                                                            {isCmd ? (
                                                                                <Terminal className="w-3 h-3 text-indigo-500 shrink-0" />
                                                                            ) : (
                                                                                <Wrench className="w-3 h-3 text-emerald-600 shrink-0" />
                                                                            )}
                                                                            <span>{tn}</span>
                                                                            {isConfirmedFailed ? (
                                                                                <X className="w-3 h-3 text-rose-500 shrink-0" />
                                                                            ) : isConfirmedOk ? (
                                                                                <Check className="w-3 h-3 text-emerald-500 shrink-0" />
                                                                            ) : null}
                                                                        </span>
                                                                    );
                                                                })}
                                                                {p.had_tool_error && failedSet.size === 0 && (
                                                                    <span
                                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border font-bold ${scorePillClasses(
                                                                            30,
                                                                            agDark
                                                                        )}`}
                                                                    >
                                                                        <AlertTriangle className="w-3 h-3 shrink-0" />
                                                                        <span>Có lỗi thực thi tool</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}

                                                        {p.assistant_err_snippet && (
                                                            <div
                                                                className={`rounded-xl border px-3 py-2 break-words leading-relaxed flex items-start gap-1.5 ${scorePillClasses(
                                                                    25,
                                                                    agDark
                                                                )}`}
                                                            >
                                                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                                                <div className="min-w-0">
                                                                    <strong>Lỗi Assistant phát sinh:</strong>{' '}
                                                                    {p.assistant_err_snippet}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* RIGHT: 1-to-1 Aligned Coaching Card (Compact 1-line for Good / Redundant, Full Spec for Weak) */}
                                                {isAlreadyGood && !deepOpt ? (
                                                    <div
                                                        className={`rounded-xl border px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                                                            agDark
                                                                ? 'bg-emerald-950/20 border-emerald-800/50 text-emerald-200'
                                                                : 'bg-[#e6f4ea]/75 border-[#a8dab5] text-[#137333]'
                                                        }`}
                                                    >
                                                        <span className="inline-flex items-center gap-1.5 font-bold tabular-nums">
                                                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                                                            <span>
                                                                Lượt #{p.idx} đạt chuẩn ({pScore}đ · {pVerdict}) — Không cần viết lại
                                                            </span>
                                                        </span>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    onCopy(
                                                                        rawPromptTxt,
                                                                        `agpc-good-${thKey}`,
                                                                        `Đã copy câu chuẩn lượt #${p.idx}!`
                                                                    )
                                                                }
                                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                                            >
                                                                {copiedId === `agpc-good-${thKey}` ? (
                                                                    <Check className="w-3 h-3 text-emerald-500" />
                                                                ) : (
                                                                    <Copy className="w-3 h-3" />
                                                                )}
                                                                <span>Copy gốc</span>
                                                            </button>
                                                            <button
                                                                type="button"
                                                                disabled={isDeepLoading}
                                                                onClick={() => void handleTurnDeepSpec(p)}
                                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-bold cursor-pointer"
                                                            >
                                                                <Wand2 className="w-3 h-3" />
                                                                <span>{isDeepLoading ? 'Đang viết...' : 'Spec sâu'}</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : isRedundant && !deepOpt ? (
                                                    <div
                                                        className={`rounded-xl border px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                                                            agDark
                                                                ? 'bg-violet-950/30 border-violet-800/60 text-violet-200'
                                                                : 'bg-[#f3e8ff] border-[#d8b4fe] text-[#6b21a8]'
                                                        }`}
                                                    >
                                                        <span className="inline-flex items-center gap-1.5 font-bold tabular-nums min-w-0">
                                                            <Link2 className="w-4 h-4 shrink-0" />
                                                            <span>
                                                                Lượt #{p.idx} thừa ({pVerdict}) — Đáng lẽ không gửi rời
                                                                {mergeTargetIdx ? `, gộp thẳng vào lượt #${mergeTargetIdx}` : ''}
                                                            </span>
                                                        </span>
                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {mergeTargetIdx && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => jumpToTurn(mergeTargetIdx)}
                                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-extrabold cursor-pointer tabular-nums"
                                                                >
                                                                    <span>Tới lượt #{mergeTargetIdx}</span>
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                disabled={isDeepLoading}
                                                                onClick={() => void handleTurnDeepSpec(p)}
                                                                title="Viết thành câu lệnh độc lập nếu muốn tách phiên mới"
                                                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                                            >
                                                                <Wand2 className="w-3 h-3" />
                                                                <span>{isDeepLoading ? 'Đang viết...' : 'Tách độc lập'}</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div
                                                        className={`rounded-xl border p-3.5 space-y-2.5 text-xs ${
                                                            agDark
                                                                ? 'bg-emerald-950/25 border-emerald-800/60 text-emerald-100'
                                                                : 'bg-[#e6f4ea] border-[#a8dab5] text-[#1f1f1f]'
                                                        }`}
                                                    >
                                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                                            <span
                                                                className={`inline-flex items-center gap-1.5 font-extrabold ${
                                                                    agDark ? 'text-emerald-300' : 'text-[#137333]'
                                                                } tabular-nums`}
                                                            >
                                                                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                                                <span>
                                                                    {deepOpt
                                                                        ? `Bản AI Spec 1-Phát chuyên sâu (${deepOpt.estimated_prompts_saved})`
                                                                        : `Cách viết lại Lượt #${p.idx} chuẩn 1-Phát`}
                                                                </span>
                                                            </span>

                                                            <div className="flex flex-wrap items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        onCopy(
                                                                            effectiveImproved,
                                                                            `agpc-turn-${thKey}`,
                                                                            `Đã copy gợi ý 1-Phát lượt #${p.idx}!`
                                                                        )
                                                                    }
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-bold cursor-pointer"
                                                                >
                                                                    {copiedId === `agpc-turn-${thKey}` ? (
                                                                        <Check className="w-3 h-3 text-emerald-400" />
                                                                    ) : (
                                                                        <Copy className="w-3 h-3" />
                                                                    )}
                                                                    <span>Copy</span>
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        loadIntoComposer(
                                                                            effectiveImproved,
                                                                            `Đã nạp gợi ý lượt #${p.idx} xuống Composer!`,
                                                                            rawPromptTxt
                                                                        )
                                                                    }
                                                                    className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                                                                >
                                                                    Nạp Composer
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    disabled={isDeepLoading}
                                                                    onClick={() => void handleTurnDeepSpec(p)}
                                                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-bold cursor-pointer"
                                                                >
                                                                    <Wand2 className="w-3 h-3" />
                                                                    <span>{isDeepLoading ? 'Đang viết...' : 'Spec sâu'}</span>
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="whitespace-pre-wrap break-words leading-relaxed font-medium">
                                                            {effectiveImproved}
                                                        </div>

                                                        <div
                                                            className={`pt-2 border-t flex flex-wrap items-center justify-between gap-2 ${
                                                                agDark ? 'border-white/10' : 'border-black/10'
                                                            }`}
                                                        >
                                                            <span className={mutedTxt}>
                                                                <strong>Lý do:</strong>{' '}
                                                                {p.lesson ||
                                                                    'Bổ sung đủ ngữ cảnh file, ranh giới và tiêu chí kiểm chứng để chốt trong 1 lượt.'}
                                                            </span>
                                                            {p.root_cause_type && (
                                                                <span
                                                                    className={`px-2 py-0.5 rounded-full border font-bold ${scorePillClasses(
                                                                        35,
                                                                        agDark
                                                                    )}`}
                                                                >
                                                                    {ROOT_CAUSE_VI[p.root_cause_type] || p.root_cause_type}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Progressive Batch Load Controls */}
                                {visiblePrompts.length > renderLimit && (
                                    <div className="py-3 flex flex-wrap items-center justify-center gap-2 text-xs tabular-nums">
                                        <button
                                            type="button"
                                            onClick={() => setRenderLimit(prev => prev + TURN_BATCH_STEP)}
                                            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold cursor-pointer"
                                        >
                                            Xem thêm {Math.min(TURN_BATCH_STEP, visiblePrompts.length - renderLimit)} lượt (Đang hiện{' '}
                                            {displayedPrompts.length}/{visiblePrompts.length})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRenderLimit(visiblePrompts.length)}
                                            className={`px-3 py-2 rounded-xl border font-bold cursor-pointer ${cardBg} hover:border-indigo-400`}
                                        >
                                            Hiện tất cả ({visiblePrompts.length} lượt)
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* 3. BOTTOM ANTIGRAVITY COMPOSER — Synchronized Live Rubric + Dry-Run A/B (No Dead Selects, Stable Height) */}
                    <div
                        className={`px-3 py-2 sm:px-5 sm:py-2.5 border-t shrink-0 ${
                            agDark ? 'border-[#2b2b2b] bg-[#191919]' : 'border-[#e6e6e4] bg-[#f9f9f8]'
                        }`}
                    >
                        <div className={`${isFullscreen ? 'max-w-[1280px]' : 'max-w-[960px]'} mx-auto space-y-1.5`}>
                            {/* Live Pre-Send Coaching Strip */}
                            <div className={`rounded-xl border px-3 py-1.5 space-y-2 text-xs ${cardBg}`}>
                                {!composerText.trim() ? (
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className={`inline-flex items-center gap-1.5 font-bold ${mutedTxt}`}>
                                            <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                            <span>Chấm điểm 7 chiều trực tiếp khi gõ (hoặc thử mẫu nhanh):</span>
                                        </span>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <button
                                                type="button"
                                                onClick={() => handleComposerInputChange('fix loi trang web di')}
                                                className={`px-2 py-0.5 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                Mẫu yếu: &quot;fix loi...&quot;
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleComposerInputChange('deploy sqlite len production ngay')
                                                }
                                                className={`px-2 py-0.5 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                Thiếu rào an toàn
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    handleComposerInputChange(
                                                        'Mục tiêu: Sửa AdminPromptCoachSection.tsx thêm cột 7 chiều Rubric.\nRanh giới: Chỉ sửa 1 file TSX này, giữ nguyên dữ liệu DB.\nDone: Chạy npx tsc --noEmit && npm run build đạt 0 lỗi.'
                                                    )
                                                }
                                                className={`px-2 py-0.5 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                Mẫu chuẩn 1-Phát (~94đ)
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <span
                                                className={`px-2.5 py-0.5 rounded-full border font-extrabold ${scorePillClasses(
                                                    liveComposerEval.score,
                                                    agDark
                                                )}`}
                                            >
                                                Điểm nháp: {liveComposerEval.score}/100đ
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-full border font-bold ${cardBg}`}>
                                                {liveComposerEval.stageLabel}
                                            </span>
                                            {liveComposerEval.safetyWarning && (
                                                <span
                                                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border font-extrabold ${scorePillClasses(
                                                        25,
                                                        agDark
                                                    )}`}
                                                >
                                                    <AlertTriangle className="w-3 h-3 shrink-0" />
                                                    <span>Thiếu rào Backup / Dry-Run!</span>
                                                </span>
                                            )}
                                            {liveComposerEval.missingLabels.length > 0 ? (
                                                <span className="font-bold text-rose-600 dark:text-rose-400">
                                                    Cần thêm: {liveComposerEval.missingLabels.join(', ')}
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 font-extrabold text-emerald-600 dark:text-emerald-400">
                                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                                    <span>Đủ Spec 1-Phát — Sẵn sàng gửi!</span>
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            {RUBRIC_DIMS.map(d => {
                                                const chk = liveComposerEval.checks.find(c => c.key === d.key);
                                                const cls = !chk?.applicable
                                                    ? `${cardBg} ${mutedTxt} opacity-65`
                                                    : chk.ok
                                                      ? scorePillClasses(90, agDark)
                                                      : scorePillClasses(30, agDark);
                                                return (
                                                    <span
                                                        key={d.key}
                                                        title={d.label}
                                                        className={`px-1.5 py-0.5 rounded border text-xs font-extrabold ${cls}`}
                                                    >
                                                        {d.short}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* Live Dry-Run A/B Comparison Card */}
                                {composerAbResult && (
                                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2 max-h-[210px] overflow-y-auto">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="font-extrabold text-indigo-600 dark:text-indigo-300 inline-flex items-center gap-1.5">
                                                <GitCompare className="w-3.5 h-3.5" />
                                                <span>Dry-Run A/B: Nháp gốc (A) vs Bản 1-Phát tối ưu (B)</span>
                                            </span>
                                            <div className="flex items-center gap-2 tabular-nums">
                                                <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                                                    {composerAbResult.score_a}đ → {composerAbResult.score_b}đ
                                                </span>
                                                {pendingAbOptimizedB && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            const orig = composerText.trim();
                                                            setRawDraftBeforeUpgrade(orig);
                                                            setLastUpgradedSpec(pendingAbOptimizedB);
                                                            setComposerText(pendingAbOptimizedB);
                                                            setPendingAbOptimizedB('');
                                                            showToast('Đã áp dụng Phương án B vào Composer!', 'success');
                                                        }}
                                                        className="px-2 py-0.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold cursor-pointer"
                                                    >
                                                        Áp dụng Bản B
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setComposerAbResult(null)}
                                                    aria-label="Đóng bảng so sánh A/B"
                                                    className="cursor-pointer"
                                                >
                                                    <X className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                            <div
                                                className={`rounded-lg border p-2.5 space-y-1 ${scorePillClasses(
                                                    35,
                                                    agDark
                                                )}`}
                                            >
                                                <div className="font-extrabold">
                                                    Phương án A (Nháp gốc · {composerAbResult.a_plan.est_turns})
                                                </div>
                                                <ul className="list-disc pl-4 space-y-0.5">
                                                    {(composerAbResult.a_plan.predicted_questions_or_errors || []).map(
                                                        (it, i) => (
                                                            <li key={i}>{it}</li>
                                                        )
                                                    )}
                                                </ul>
                                            </div>
                                            <div
                                                className={`rounded-lg border p-2.5 space-y-1 ${scorePillClasses(
                                                    90,
                                                    agDark
                                                )}`}
                                            >
                                                <div className="font-extrabold">
                                                    Phương án B (1-Phát · {composerAbResult.b_plan.est_turns})
                                                </div>
                                                <ul className="list-disc pl-4 space-y-0.5">
                                                    {(composerAbResult.b_plan.plan_steps || []).map((it, i) => (
                                                        <li key={i}>{it}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Authentic Antigravity Composer Input Box (rows={1} smooth, zero dead selects) */}
                            <div className={`rounded-2xl border px-3 py-2 space-y-1.5 shadow-xs ${cardBg}`}>
                                <textarea
                                    ref={composerRef}
                                    value={composerText}
                                    onChange={e => handleComposerInputChange(e.target.value)}
                                    onKeyDown={e => {
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                                            e.preventDefault();
                                            void handleUpgradeComposerAi();
                                        }
                                    }}
                                    rows={1}
                                    placeholder="Gõ nháp Prompt (Ctrl+Enter nâng lên 1-Phát · Esc bỏ chọn mà không mất nháp)..."
                                    className="w-full bg-transparent text-xs sm:text-sm leading-relaxed outline-none resize-y min-h-[34px] max-h-[120px]"
                                />
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <button
                                            type="button"
                                            disabled={composerUpgrading}
                                            onClick={() => void handleUpgradeComposerAi()}
                                            title="Viết lại nháp thành Spec 1-Phát bằng AI (Ctrl+Enter)"
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />
                                            <span>
                                                {composerUpgrading ? 'Đang nâng cấp...' : 'Nâng lên 1-Phát'}
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            disabled={composerComparing}
                                            onClick={() => void handleCompareComposerAb()}
                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-extrabold cursor-pointer"
                                        >
                                            <GitCompare className="w-3.5 h-3.5" />
                                            <span>{composerComparing ? 'Đang giả lập...' : 'Dry-Run A/B'}</span>
                                        </button>
                                        {rawDraftBeforeUpgrade.trim() && (
                                            <button
                                                type="button"
                                                onClick={handleRestoreRawDraft}
                                                title="Quay lại câu nháp gốc của anh trước khi nâng cấp"
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                <RotateCcw className="w-3.5 h-3.5" />
                                                <span>Nháp gốc</span>
                                            </button>
                                        )}
                                        {composerText.trim() && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onOpenFullOptimizer(
                                                        rawDraftBeforeUpgrade.trim() || composerText,
                                                        detail?.tool || 'antigravity',
                                                        detail?.session_key
                                                    )
                                                }
                                                className={`px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                Mở Xưởng Nháp
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-1.5">
                                        {composerText.trim() && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    onCopy(
                                                        composerText,
                                                        'agpc-comp-copy',
                                                        'Đã copy nội dung ô Composer!'
                                                    )
                                                }
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border font-bold cursor-pointer ${cardBg}`}
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                                <span>Copy</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            disabled={!composerText.trim()}
                                            onClick={() => onDispatchToA1(composerText.trim())}
                                            title="Đẩy câu Prompt này sang A1 Chat để gửi thật"
                                            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-extrabold cursor-pointer"
                                        >
                                            <span>Copy & Dùng ngay</span>
                                            <Send className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (isFullscreen && typeof document !== 'undefined') {
        return createPortal(workspaceNode, document.body);
    }
    return workspaceNode;
};

export default AntigravityPcCoachTab;
