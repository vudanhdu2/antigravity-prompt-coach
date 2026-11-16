import React, { useEffect, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
    id: number;
    message: string;
    kind: ToastKind;
}

type Listener = (item: ToastItem) => void;
const listeners = new Set<Listener>();
let seq = 1;

export function showToast(message: string, kind: ToastKind = 'info'): void {
    const item: ToastItem = { id: seq++, message, kind };
    listeners.forEach(fn => fn(item));
}

export const ToastViewport: React.FC = () => {
    const [items, setItems] = useState<ToastItem[]>([]);

    useEffect(() => {
        const onToast: Listener = item => {
            setItems(prev => [...prev.slice(-3), item]);
            window.setTimeout(() => {
                setItems(prev => prev.filter(x => x.id !== item.id));
            }, 3200);
        };
        listeners.add(onToast);
        return () => {
            listeners.delete(onToast);
        };
    }, []);

    if (items.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm pointer-events-none">
            {items.map(t => {
                const cls =
                    t.kind === 'error'
                        ? 'bg-rose-600 text-white border-rose-500'
                        : t.kind === 'success'
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-slate-900 text-white border-slate-700';
                return (
                    <div
                        key={t.id}
                        className={`px-3.5 py-2.5 rounded-xl border shadow-xl text-xs font-bold pointer-events-auto ${cls}`}
                    >
                        {t.message}
                    </div>
                );
            })}
        </div>
    );
};
