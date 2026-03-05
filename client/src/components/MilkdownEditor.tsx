import './MilkdownEditor.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Editor,
    defaultValueCtx,
    editorViewCtx,
    editorViewOptionsCtx,
    prosePluginsCtx,
    rootCtx,
} from '@milkdown/core';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { history } from '@milkdown/plugin-history';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { trailing } from '@milkdown/plugin-trailing';
import { replaceAll } from '@milkdown/utils';
import { Plugin, PluginKey } from '@milkdown/prose/state';
import { createPortal } from 'react-dom';
import { MentionList } from './MentionList';
import type { MentionListHandle } from './MentionList';
import type { SlimPersonSummary } from '@/api/people';

// ── Types ────────────────────────────────────────────────────────────────────

interface MentionPluginState {
    active: boolean;
    query: string;
    from: number;
    to: number;
}

interface MentionUIState extends MentionPluginState {
    rect: { left: number; top: number } | null;
}

export interface MilkdownEditorProps {
    content: string;
    onChange: (md: string) => void;
    placeholder?: string;
    onImageUpload?: (file: File) => Promise<string>;
    className?: string;
    readOnly?: boolean;
    minHeight?: string;
    enableMentions?: boolean;
}

// ── ProseMirror mention plugin ───────────────────────────────────────────────

const MENTION_KEY = new PluginKey<MentionPluginState>('legacy_mention');

function makeMentionPlugin(
    onUpdate: React.MutableRefObject<(state: MentionUIState) => void>,
): Plugin {
    return new Plugin<MentionPluginState>({
        key: MENTION_KEY,
        state: {
            init: () => ({ active: false, query: '', from: 0, to: 0 }),
            apply(tr): MentionPluginState {
                if (!tr.selection.empty) return { active: false, query: '', from: 0, to: 0 };
                const { $from } = tr.selection;
                const textBefore = $from.parent.textBetween(
                    Math.max(0, $from.parentOffset - 40),
                    $from.parentOffset,
                );
                const m = /@([a-zA-Z0-9_-]*)$/.exec(textBefore);
                if (m) {
                    return { active: true, query: m[1], from: $from.pos - m[0].length, to: $from.pos };
                }
                return { active: false, query: '', from: 0, to: 0 };
            },
        },
        view() {
            return {
                update(view) {
                    const s = MENTION_KEY.getState(view.state);
                    if (!s) return;
                    if (s.active) {
                        try {
                            const c = view.coordsAtPos(s.from);
                            onUpdate.current({
                                ...s,
                                rect: { left: c.left, top: c.bottom + window.scrollY + 4 },
                            });
                        } catch {
                            onUpdate.current({ active: false, query: '', from: 0, to: 0, rect: null });
                        }
                    } else {
                        onUpdate.current({ active: false, query: '', from: 0, to: 0, rect: null });
                    }
                },
            };
        },
    });
}

// ── Inner component (inside MilkdownProvider) ────────────────────────────────

function MilkdownEditorInner({
    content,
    onChange,
    onImageUpload,
    className = '',
    readOnly = false,
    minHeight = '200px',
    enableMentions = false,
}: MilkdownEditorProps) {
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;

    const suppressChangeRef = useRef(false);
    const initializedRef = useRef(false);

    // Mention UI state
    const [mentionUI, setMentionUI] = useState<MentionUIState>({
        active: false, query: '', from: 0, to: 0, rect: null,
    });
    const setMentionUIRef = useRef(setMentionUI);
    setMentionUIRef.current = setMentionUI;

    const mentionListRef = useRef<MentionListHandle | null>(null);
    const [mentionItems, setMentionItems] = useState<SlimPersonSummary[]>([]);

    // Stable mention plugin instance (enableMentions doesn't change at runtime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const mentionPlugin = useMemo(() => (enableMentions ? makeMentionPlugin(setMentionUIRef) : null), []);

    // ── Editor setup ──────────────────────────────────────────────────────────

    const { get, loading } = useEditor((container) => {
        return Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, container);
                ctx.set(defaultValueCtx, '');
                ctx.update(editorViewOptionsCtx, (prev) => ({
                    ...prev,
                    editable: () => !readOnlyRef.current,
                }));
                ctx.get(listenerCtx).markdownUpdated((_, md) => {
                    if (!suppressChangeRef.current) {
                        onChangeRef.current(md);
                    }
                });
                if (mentionPlugin) {
                    ctx.update(prosePluginsCtx, (prev) => [...prev, mentionPlugin]);
                }
            })
            .use(commonmark)
            .use(gfm)
            .use(history)
            .use(listener)
            .use(trailing);
    });

    // ── One-time content initialization ──────────────────────────────────────

    useEffect(() => {
        if (loading || initializedRef.current || !content) return;
        initializedRef.current = true;
        suppressChangeRef.current = true;
        get()?.action(replaceAll(content));
        suppressChangeRef.current = false;
    }, [loading, get, content]);

    // ── Toggle readOnly ───────────────────────────────────────────────────────

    useEffect(() => {
        if (loading) return;
        // Dispatch empty transaction to force ProseMirror to re-evaluate editable()
        get()?.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            view.dispatch(view.state.tr);
        });
    }, [readOnly, loading, get]);

    // ── Fetch mention suggestions ─────────────────────────────────────────────

    useEffect(() => {
        if (!mentionUI.active || mentionUI.query.length < 1) { setMentionItems([]); return; }
        let cancelled = false;
        fetch(`/api/search?q=${encodeURIComponent(mentionUI.query)}&limit=8`)
            .then((r) => r.ok ? r.json() : { people: [] })
            .then((data) => { if (!cancelled) setMentionItems(data.people ?? []); })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [mentionUI.active, mentionUI.query]);

    // ── Insert mention text ───────────────────────────────────────────────────

    const insertMention = useCallback((person: SlimPersonSummary) => {
        const { from, to } = mentionUI;
        get()?.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { tr, schema } = view.state;
            view.dispatch(tr.replaceWith(from, to, schema.text(`@${person.id} `)));
            view.focus();
        });
        setMentionUI({ active: false, query: '', from: 0, to: 0, rect: null });
    }, [get, mentionUI]);

    // ── Keydown for mention navigation ────────────────────────────────────────

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!mentionUI.active) return;
        if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
            const handled = mentionListRef.current?.onKeyDown(e.nativeEvent) ?? false;
            if (handled) { e.preventDefault(); e.stopPropagation(); }
        }
        if (e.key === 'Escape') {
            setMentionUI({ active: false, query: '', from: 0, to: 0, rect: null });
        }
    }, [mentionUI.active]);

    // ── Image drag-and-drop ───────────────────────────────────────────────────

    const handleDrop = useCallback(async (e: React.DragEvent<HTMLDivElement>) => {
        if (!onImageUpload) return;
        const file = e.dataTransfer.files[0];
        if (!file?.type.startsWith('image/')) return;
        e.preventDefault();
        try {
            const filename = await onImageUpload(file);
            get()?.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const pos = view.state.selection.from;
                view.dispatch(view.state.tr.insertText(`\n![${file.name}](/assets/${filename})\n`, pos));
            });
        } catch { /* parent handles toast */ }
    }, [get, onImageUpload]);

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <div
            className={`milkdown-wrapper${readOnly ? ' read-only' : ''}${className ? ` ${className}` : ''}`}
            style={{ minHeight }}
            onDrop={handleDrop}
            onDragOver={(e) => { if (onImageUpload) e.preventDefault(); }}
            onKeyDown={handleKeyDown}
        >
            <Milkdown />
            {enableMentions && mentionUI.active && !!mentionUI.rect && createPortal(
                <div style={{
                    position: 'absolute',
                    left: mentionUI.rect.left,
                    top: mentionUI.rect.top,
                    zIndex: 9999,
                }}>
                    <MentionList
                        ref={mentionListRef}
                        items={mentionItems}
                        command={insertMention}
                    />
                </div>,
                document.body,
            )}
        </div>
    );
}

// ── Public export (wraps with provider) ──────────────────────────────────────

export function MilkdownEditor(props: MilkdownEditorProps) {
    return (
        <MilkdownProvider>
            <MilkdownEditorInner {...props} />
        </MilkdownProvider>
    );
}
