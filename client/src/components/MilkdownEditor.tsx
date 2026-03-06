import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/common/prosemirror.css";
import "@milkdown/crepe/theme/common/block-edit.css";
import "@milkdown/crepe/theme/common/cursor.css";
import "@milkdown/crepe/theme/common/image-block.css";
import "@milkdown/crepe/theme/common/link-tooltip.css";
import "@milkdown/crepe/theme/common/list-item.css";
import "@milkdown/crepe/theme/common/table.css";
import "@milkdown/crepe/theme/common/toolbar.css";
import "@milkdown/crepe/theme/frame.css";
import "./MilkdownEditor.css";

import { useCallback, useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, prosePluginsCtx } from "@milkdown/core";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { replaceAll } from "@milkdown/utils";
import { createPortal } from "react-dom";
import { MentionList } from "./MentionList";
import type { MentionListHandle } from "./MentionList";
import type { SlimPersonSummary } from "@/api/people";
import { usePerson } from "@/api/hooks";
import { PersonHoverContent } from "@/components/PersonChip";

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
  onImageUpload?: (file: File) => Promise<string>;
  onMentionClick?: (personId: string) => void;
  className?: string;
  readOnly?: boolean;
  enableMentions?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getDisplayName(person: {
  names?: Array<{ first?: string; last?: string }>;
}): string {
  const n = person.names?.[0];
  return [n?.first, n?.last].filter(Boolean).join(" ") || "";
}

// ── @mention trigger plugin ─────────────────────────────────────────────────

const MENTION_KEY = new PluginKey<MentionPluginState>("legacy_mention");

function makeMentionPlugin(
  onUpdate: React.MutableRefObject<(state: MentionUIState) => void>,
): Plugin {
  return new Plugin<MentionPluginState>({
    key: MENTION_KEY,
    state: {
      init: () => ({ active: false, query: "", from: 0, to: 0 }),
      apply(tr): MentionPluginState {
        if (!tr.selection.empty)
          return { active: false, query: "", from: 0, to: 0 };
        const { $from } = tr.selection;
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 40),
          $from.parentOffset,
        );
        const m = /@([a-zA-Z0-9_-]*)$/.exec(textBefore);
        if (m) {
          return {
            active: true,
            query: m[1],
            from: $from.pos - m[0].length,
            to: $from.pos,
          };
        }
        return { active: false, query: "", from: 0, to: 0 };
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
              onUpdate.current({
                active: false,
                query: "",
                from: 0,
                to: 0,
                rect: null,
              });
            }
          } else {
            onUpdate.current({
              active: false,
              query: "",
              from: 0,
              to: 0,
              rect: null,
            });
          }
        },
      };
    },
  });
}

// ── Mention decoration plugin ────────────────────────────────────────────────

const DECOR_KEY = new PluginKey("mention_decor");

function makeMentionDecorPlugin(
  nameCacheRef: React.MutableRefObject<Map<string, string>>,
): Plugin {
  return new Plugin({
    key: DECOR_KEY,
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (!node.isText || !node.text) return;
          const regex = /@(N_[a-zA-Z0-9_-]+)/g;
          let match;
          while ((match = regex.exec(node.text)) !== null) {
            try {
              const id = match[1];
              const name = nameCacheRef.current.get(id);
              const start = pos + match.index;
              const end = start + match[0].length;
              decos.push(
                Decoration.inline(start, end, {
                  nodeName: "span",
                  class: "mention-chip",
                  "data-mention-id": id,
                  ...(name ? { "data-mention-label": name } : {}),
                }),
              );
            } catch (e) {
              console.error("MILKDOWN ERROR Decoration.inline", e);
            }
          }
        });
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

// ── Mention hover card ────────────────────────────────────────────────────────

function MentionHoverCard({
  personId,
  rect,
  onMouseEnter,
  onMouseLeave,
}: {
  personId: string;
  rect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const { data: person } = usePerson(personId);
  return createPortal(
    <div
      className="mention-hover-card w-64 rounded-lg border bg-popover p-3 shadow-md text-popover-foreground"
      style={{
        position: "fixed",
        left: Math.min(rect.left, window.innerWidth - 280),
        top: rect.top - 8,
        transform: "translateY(-100%)",
        zIndex: 10000,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <PersonHoverContent id={personId} person={person} />
    </div>,
    document.body,
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function MilkdownEditor({
  content,
  onChange,
  onImageUpload,
  onMentionClick,
  className = "",
  readOnly = false,
  enableMentions = false,
}: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const contentRef = useRef(content);
  contentRef.current = content;
  const suppressChangeRef = useRef(false);
  const contentAppliedRef = useRef(false);
  const crepeReadyRef = useRef(false);
  // Track readOnly in a ref so content-apply helpers can access it without stale closures
  const readOnlyRef = useRef(readOnly);
  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  // Mention hover card state
  const [mentionHover, setMentionHover] = useState<{
    personId: string;
    rect: DOMRect;
  } | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // @mention UI state
  const [mentionUI, setMentionUI] = useState<MentionUIState>({
    active: false,
    query: "",
    from: 0,
    to: 0,
    rect: null,
  });
  const setMentionUIRef = useRef(setMentionUI);
  setMentionUIRef.current = setMentionUI;
  const mentionListRef = useRef<MentionListHandle | null>(null);
  const [mentionItems, setMentionItems] = useState<SlimPersonSummary[]>([]);

  // Name cache for mention decorations
  const nameCacheRef = useRef<Map<string, string>>(new Map());

  // Create plugins once (stable across renders)
  const mentionPlugin = useRef(
    enableMentions ? makeMentionPlugin(setMentionUIRef) : null,
  ).current;
  const decorPlugin = useRef(makeMentionDecorPlugin(nameCacheRef)).current;

  // ── Apply content safely (works in both readonly and editable modes) ─────────

  const applyContent = useCallback((crepe: Crepe, md: string) => {
    const wasReadonly = readOnlyRef.current;
    if (wasReadonly) crepe.setReadonly(false);
    suppressChangeRef.current = true;
    
    // Sanitize the markdown
    const safeMd = md.replace(/&#x20;/g, ' ').replace(/\\_/g, '_');
    crepe.editor.action(replaceAll(safeMd));
    
    setTimeout(() => {
      suppressChangeRef.current = false;
      if (wasReadonly) crepe.setReadonly(true);
    }, 100);
  }, []);

  // ── Force decoration re-render ────────────────────────────────────────────

  const forceDecorUpdate = useCallback(() => {
    if (!crepeRef.current || !crepeReadyRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        view.dispatch(view.state.tr.setMeta(DECOR_KEY, true));
      }
    });
  }, []);

  // ── Initialize Crepe on mount ─────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const initialContent = contentRef.current;
    const crepe = new Crepe({
      root: containerRef.current,
      defaultValue: initialContent,
    });

    // Add ProseMirror plugins
    const extraPlugins: Plugin[] = [decorPlugin];
    if (mentionPlugin) extraPlugins.push(mentionPlugin);

    crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (prev) => [...prev, ...extraPlugins]);
    });

    // Register onChange listener
    crepe.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        if (!suppressChangeRef.current) {
          onChangeRef.current(markdown);
        }
      });
    });

    crepe.create().then(() => {
      crepeRef.current = crepe;
      crepeReadyRef.current = true;
      crepe.setReadonly(readOnlyRef.current);

      if (initialContent) {
        contentAppliedRef.current = true;
      } else if (contentRef.current && !contentAppliedRef.current) {
        contentAppliedRef.current = true;
        applyContent(crepe, contentRef.current);
      }
    });

    return () => {
      crepeReadyRef.current = false;
      contentAppliedRef.current = false;
      crepeRef.current = null;
      crepe.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only on mount — content/readOnly handled by separate effects

  // ── Apply content when it arrives externally ──────────────────────────────

  useEffect(() => {
    if (contentAppliedRef.current || !content || !crepeReadyRef.current || !crepeRef.current) return;
    contentAppliedRef.current = true;
    applyContent(crepeRef.current, content);
  }, [content, applyContent]);

  // ── Toggle readOnly ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!crepeReadyRef.current || !crepeRef.current) return;
    crepeRef.current.setReadonly(readOnly);
  }, [readOnly]);

  // ── Fetch mention suggestions ─────────────────────────────────────────────

  useEffect(() => {
    if (!mentionUI.active || mentionUI.query.length < 1) {
      setMentionItems([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/search?q=${encodeURIComponent(mentionUI.query)}&limit=8`)
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((data) => {
        if (!cancelled) setMentionItems(data.people ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [mentionUI.active, mentionUI.query]);

  // ── Pre-fetch names for existing @mentions in content ─────────────────────

  useEffect(() => {
    if (!enableMentions || !content) return;
    const ids = Array.from(content.matchAll(/@(N_[a-zA-Z0-9_-]+)/g)).map(
      (m) => m[1],
    );
    const toFetch = ids.filter((id) => !nameCacheRef.current.has(id));
    if (toFetch.length === 0) return;

    let cancelled = false;
    Promise.all(
      toFetch.map((id) =>
        fetch(`/api/people/${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((p) => (p ? { id, name: getDisplayName(p) } : null))
          .catch(() => null),
      ),
    ).then((results) => {
      if (cancelled) return;
      let changed = false;
      for (const r of results) {
        if (r?.name) {
          nameCacheRef.current.set(r.id, r.name);
          changed = true;
        }
      }
      if (changed) {
        console.log("MILKDOWN DEBUG: forcing decor update");
        forceDecorUpdate();
      }
    });
    return () => {
      cancelled = true;
    };
    // We only run this when content transitions from empty to non-empty (story load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enableMentions, !!content]);

  // ── Insert mention ────────────────────────────────────────────────────────

  const insertMention = useCallback(
    (person: SlimPersonSummary) => {
      const { from, to } = mentionUI;
      const name = getDisplayName(person);
      if (name) nameCacheRef.current.set(person.id, name);

      if (crepeRef.current) {
        crepeRef.current.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { tr, schema } = view.state;
          view.dispatch(
            tr.replaceWith(from, to, schema.text(`@${person.id} `)),
          );
          view.focus();
        });
      }
      setMentionUI({ active: false, query: "", from: 0, to: 0, rect: null });
      // Force decoration update after inserting
      setTimeout(forceDecorUpdate, 0);
    },
    [mentionUI, forceDecorUpdate],
  );

  // ── Keyboard: mention navigation ─────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!mentionUI.active) return;
      if (["ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        const handled =
          mentionListRef.current?.onKeyDown(e.nativeEvent) ?? false;
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
      if (e.key === "Escape") {
        setMentionUI({ active: false, query: "", from: 0, to: 0, rect: null });
      }
    },
    [mentionUI.active],
  );

  // ── Hover: show person preview card on mention chips ─────────────────────

  const handleMouseOver = useCallback((e: React.MouseEvent) => {
    const chip = (e.target as HTMLElement).closest(
      "[data-mention-id]",
    ) as HTMLElement | null;
    if (!chip) return;
    const id = chip.getAttribute("data-mention-id");
    if (!id) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setMentionHover({ personId: id, rect: chip.getBoundingClientRect() });
  }, []);

  const handleMouseOut = useCallback((e: React.MouseEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (
      related?.closest("[data-mention-id]") ||
      related?.closest(".mention-hover-card")
    )
      return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setMentionHover(null), 120);
  }, []);

  // ── Click: navigate to person in readonly mode ────────────────────────────

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!onMentionClick || !readOnly) return;
      const target = e.target as HTMLElement;
      const chip = target.closest("[data-mention-id]") as HTMLElement | null;
      if (chip) {
        const id = chip.getAttribute("data-mention-id");
        if (id) {
          e.preventDefault();
          onMentionClick(id);
        }
      }
    },
    [onMentionClick, readOnly],
  );

  // ── Image drag-and-drop ───────────────────────────────────────────────────

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      if (!onImageUpload || readOnly) return;
      const file = e.dataTransfer.files[0];
      if (!file?.type.startsWith("image/")) return;
      e.preventDefault();
      try {
        const filename = await onImageUpload(file);
        if (crepeRef.current) {
          crepeRef.current.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const pos = view.state.selection.from;
            view.dispatch(
              view.state.tr.insertText(
                `\n![${file.name}](/assets/${filename})\n`,
                pos,
              ),
            );
          });
        }
      } catch {
        /* parent handles toast */
      }
    },
    [onImageUpload, readOnly],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`milkdown-crepe-wrapper${readOnly ? " read-only" : ""}${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
      onDrop={handleDrop}
      onDragOver={(e) => {
        // Allow image file drops; also allow Crepe's internal block drag-and-drop
        if (!readOnly) e.preventDefault();
      }}
      onClick={handleClick}
      onMouseOver={handleMouseOver}
      onMouseOut={handleMouseOut}
    >
      <div ref={containerRef} />
      {enableMentions &&
        mentionUI.active &&
        !!mentionUI.rect &&
        mentionItems.length > 0 &&
        createPortal(
          <div
            style={{
              position: "absolute",
              left: mentionUI.rect.left,
              top: mentionUI.rect.top,
              zIndex: 9999,
            }}
          >
            <MentionList
              ref={mentionListRef}
              items={mentionItems}
              command={insertMention}
            />
          </div>,
          document.body,
        )}
      {mentionHover && (
        <MentionHoverCard
          personId={mentionHover.personId}
          rect={mentionHover.rect}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
          }}
          onMouseLeave={() => setMentionHover(null)}
        />
      )}
    </div>
  );
}
