import React from 'react';
import { buildHighlightedSegments } from './vnSearch';

export interface HighlightTextProps {
    text: string;
    query: string;
    markClassName?: string;
}

export const HighlightText: React.FC<HighlightTextProps> = React.memo(
    ({
        text,
        query,
        markClassName = 'bg-amber-200/90 dark:bg-amber-400/30 text-slate-950 dark:text-amber-100 rounded px-0.5 font-bold',
    }) => {
        if (!text) return null;
        const q = (query || '').trim();
        if (!q) return <>{text}</>;
        const parts = buildHighlightedSegments(text, q);
        if (parts.length === 1 && !parts[0].match) return <>{text}</>;
        return (
            <>
                {parts.map((part, idx) =>
                    part.match ? (
                        <mark key={idx} className={markClassName}>
                            {part.text}
                        </mark>
                    ) : (
                        <React.Fragment key={idx}>{part.text}</React.Fragment>
                    )
                )}
            </>
        );
    }
);

HighlightText.displayName = 'HighlightText';

export default HighlightText;
