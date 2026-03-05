import { useCallback, useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Mention } from '@tiptap/extension-mention';
import { Markdown } from 'tiptap-markdown';
import { createRoot } from 'react-dom/client';
import { MentionList } from './MentionList';
import type { MentionListHandle } from './MentionList';
import type { SlimPersonSummary } from '@/api/people';

export interface TiptapEditorProps {
    content: string;
    onChange: (markdown: string) => void;
    placeholder?: string;
    onImageUpload?: (file: File) => Promise<string>;
    className?: string;
    readOnly?: boolean;
    minHeight?: string;
}

function getDisplayName(person: SlimPersonSummary): string {
    const n = person.names?.[0];
    return [n?.first, n?.last].filter(Boolean).join(' ') || person.id;
}

// LegacyMention extends Mention with:
// 1. Markdown serialization → @N_xxx format
// 2. Markdown parsing → @N_xxx → mention node via markdown-it rule
const LegacyMention = Mention.extend({
    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write(`@${node.attrs.id ?? ''}`);
                },
                parse: {
                    setup(this: any, md: any) {
                        // Add a markdown-it inline rule for @N_xxx → <span data-type="mention" ...>
                        md.core.ruler.after('inline', 'legacy_mention', (state: any) => {
                            const AT_MENTION = /@(N_[a-zA-Z0-9_-]+)/g;
                            for (const token of state.tokens) {
                                if (token.type !== 'inline') continue;
                                const newChildren: any[] = [];
                                for (const child of token.children ?? []) {
                                    if (child.type !== 'text') {
                                        newChildren.push(child);
                                        continue;
                                    }
                                    const text: string = child.content;
                                    let lastIndex = 0;
                                    let m: RegExpExecArray | null;
                                    AT_MENTION.lastIndex = 0;
                                    while ((m = AT_MENTION.exec(text)) !== null) {
                                        if (m.index > lastIndex) {
                                            const t = new state.Token('text', '', 0);
                                            t.content = text.slice(lastIndex, m.index);
                                            newChildren.push(t);
                                        }
                                        const id = m[1];
                                        const open = new state.Token('html_inline', '', 0);
                                        open.content = `<span data-type="mention" data-id="${id}" data-label="${id}">@${id}</span>`;
                                        newChildren.push(open);
                                        lastIndex = m.index + m[0].length;
                                    }
                                    if (lastIndex < text.length) {
                                        const t = new state.Token('text', '', 0);
                                        t.content = text.slice(lastIndex);
                                        newChildren.push(t);
                                    }
                                }
                                token.children = newChildren;
                            }
                        });
                    },
                },
            },
        };
    },
});

export function TiptapEditor({
    content,
    onChange,
    placeholder = 'Start writing…',
    onImageUpload,
    className = '',
    readOnly = false,
    minHeight = '200px',
}: TiptapEditorProps) {
    const onChangeCbRef = useRef(onChange);
    onChangeCbRef.current = onChange;

    const contentRef = useRef(content);
    // Track whether we're internally updating to avoid feedback loops
    const isInternalUpdateRef = useRef(false);

    const editor = useEditor({
        editable: !readOnly,
        extensions: [
            StarterKit,
            Markdown.configure({
                html: true,
                transformPastedText: true,
            }),
            Placeholder.configure({ placeholder }),
            LegacyMention.configure({
                HTMLAttributes: { class: 'mention-chip' },
                renderText: ({ node }: any) => `@${node.attrs.id ?? ''}`,
                suggestion: {
                    char: '@',
                    items: async ({ query }: { query: string }) => {
                        if (!query || query.length < 1) return [];
                        try {
                            const res = await fetch(
                                `/api/search?q=${encodeURIComponent(query)}&limit=8`,
                            );
                            if (!res.ok) return [];
                            const data = await res.json();
                            return (data.people ?? []) as SlimPersonSummary[];
                        } catch {
                            return [];
                        }
                    },
                    render: () => {
                        let reactRoot: ReturnType<typeof createRoot> | null = null;
                        let container: HTMLDivElement | null = null;
                        let mentionListRef: MentionListHandle | null = null;

                        return {
                            onStart: (props: any) => {
                                container = document.createElement('div');
                                container.style.position = 'absolute';
                                container.style.zIndex = '9999';
                                document.body.appendChild(container);

                                reactRoot = createRoot(container);
                                reactRoot.render(
                                    <MentionList
                                        ref={(r) => { mentionListRef = r; }}
                                        items={props.items}
                                        command={(item) => {
                                            props.command({ id: item.id, label: getDisplayName(item) });
                                        }}
                                    />,
                                );

                                // Position the popup
                                if (props.clientRect) {
                                    const rect = props.clientRect();
                                    if (rect && container) {
                                        container.style.left = `${rect.left}px`;
                                        container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                                    }
                                }
                            },
                            onUpdate: (props: any) => {
                                reactRoot?.render(
                                    <MentionList
                                        ref={(r) => { mentionListRef = r; }}
                                        items={props.items}
                                        command={(item) => {
                                            props.command({ id: item.id, label: getDisplayName(item) });
                                        }}
                                    />,
                                );
                                if (props.clientRect) {
                                    const rect = props.clientRect();
                                    if (rect && container) {
                                        container.style.left = `${rect.left}px`;
                                        container.style.top = `${rect.bottom + window.scrollY + 4}px`;
                                    }
                                }
                            },
                            onKeyDown: (props: any) => {
                                if (props.event.key === 'Escape') {
                                    reactRoot?.unmount();
                                    container?.remove();
                                    return true;
                                }
                                return mentionListRef?.onKeyDown(props.event) ?? false;
                            },
                            onExit: () => {
                                reactRoot?.unmount();
                                container?.remove();
                                reactRoot = null;
                                container = null;
                            },
                        };
                    },
                },
            }),
        ],
        content: '',
        onUpdate: ({ editor: ed }) => {
            if (isInternalUpdateRef.current) return;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const md = (ed.storage as any).markdown.getMarkdown();
            contentRef.current = md;
            onChangeCbRef.current(md);
        },
    });

    // Sync external content → editor when it changes
    useEffect(() => {
        if (!editor) return;
        if (content === contentRef.current) return;
        contentRef.current = content;
        isInternalUpdateRef.current = true;
        // The Markdown extension intercepts setContent and parses Markdown → ProseMirror doc
        editor.commands.setContent(content, { emitUpdate: false });
        isInternalUpdateRef.current = false;
    }, [editor, content]);

    // Drag-and-drop image upload
    const handleDrop = useCallback(
        async (e: React.DragEvent<HTMLDivElement>) => {
            if (!onImageUpload) return;
            const file = e.dataTransfer.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            e.preventDefault();
            try {
                const filename = await onImageUpload(file);
                editor?.chain().focus().insertContent(`![${file.name}](/assets/${filename})`).run();
            } catch {
                // let parent handle error toast
            }
        },
        [editor, onImageUpload],
    );

    return (
        <div
            className={`tiptap-editor-wrapper relative ${className}`}
            style={{ minHeight }}
            onDrop={handleDrop}
            onDragOver={(e) => { if (onImageUpload) e.preventDefault(); }}
        >
            <EditorContent
                editor={editor}
                className="h-full"
            />
        </div>
    );
}
