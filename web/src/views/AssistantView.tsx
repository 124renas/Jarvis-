import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Orb, type OrbState } from "../components/Orb";
import { Icon } from "../components/Icon";
import { Markdown } from "../components/Markdown";
import { StatusIndicators } from "../components/StatusIndicators";
import { Spinner } from "../components/ui";
import { api, ApiError, fileToBase64, prepareImage, streamChat } from "../lib/api";
import { domainOf, greeting } from "../lib/format";
import { haptic } from "../lib/haptics";
import { useApp, type DataKind } from "../lib/store";
import { speaker, startListening, sttSupported, unlockSpeech } from "../lib/voice";
import type { ChatEvent, ChatMessage } from "../lib/types";

interface Attachment {
  name: string;
  mediaType: string;
  data: string;
  preview?: string;
}

const QUICK_ACTIONS: { icon: string; title: string; hint: string; prompt: string; send?: boolean; web?: boolean }[] = [
  {
    icon: "calendar",
    title: "Daily plan",
    hint: "From your tasks & calendar",
    prompt: "Create my plan for today. Check my open tasks and today's calendar first, then give me a prioritised, time-blocked plan.",
    send: true,
  },
  { icon: "tasks", title: "Add a task", hint: "Natural language", prompt: "Add a task: " },
  { icon: "notes", title: "Summarise text", hint: "Paste anything long", prompt: "Summarise this clearly, with key points and action items:\n\n" },
  { icon: "edit", title: "Draft an email", hint: "Or any message", prompt: "Draft a professional email to " },
  { icon: "globe", title: "Research", hint: "Live web sources", prompt: "Research the latest on ", web: true },
  { icon: "sparkle", title: "Generate ideas", hint: "Brainstorm", prompt: "Give me 10 creative ideas for " },
  { icon: "check", title: "Break it down", hint: "Steps for a big task", prompt: "Break this into small, manageable steps: " },
  { icon: "brain", title: "Explain simply", hint: "Any complex topic", prompt: "Explain simply, with an analogy: " },
];

const STATUS_LABEL: Record<string, string> = {
  thinking: "Analysing…",
  searching: "Searching the web…",
  tool: "Working on it…",
  writing: "Responding…",
};

const TOOL_LABEL: Record<string, string> = {
  create_task: "Adding to your tasks…",
  list_tasks: "Checking your tasks…",
  complete_task: "Updating your tasks…",
  create_event: "Updating your calendar…",
  list_events: "Checking your calendar…",
  create_note: "Saving a note…",
  search_notes: "Searching your notes…",
  propose_memory: "Noting a preference…",
};

export function AssistantView({ compact, onOpenHistory }: { compact: boolean; onOpenHistory(): void }) {
  const app = useApp();
  const { settings, activeId, setActiveId, online, status, user, refreshConversations, bump, toast, pendingPrompt, setPendingPrompt, conversations } = app;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingConv, setLoadingConv] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [webSearch, setWebSearch] = useState(settings.webSearch);

  const abortRef = useRef<AbortController | null>(null);
  const stopListenRef = useRef<(() => void) | null>(null);
  const skipLoadRef = useRef<number | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pulseRef = useRef(0);
  const stickRef = useRef(true);

  useEffect(() => setWebSearch(settings.webSearch), [settings.webSearch]);
  useEffect(() => speaker.onState((s) => setSpeaking(s === "speaking")), []);
  useEffect(() => speaker.onBoundary(() => pulseRef.current++), []);
  useEffect(() => () => {
    abortRef.current?.abort();
    stopListenRef.current?.();
  }, []);

  // Load the selected conversation.
  const loadConversation = useCallback(async (id: number | null) => {
    setLoadError(null);
    if (id == null) {
      setMessages([]);
      return;
    }
    setLoadingConv(true);
    try {
      const data = await api<{ messages: ChatMessage[] }>(`/conversations/${id}`);
      setMessages(data.messages);
      stickRef.current = true;
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  useEffect(() => {
    if (skipLoadRef.current !== null && skipLoadRef.current === activeId) {
      skipLoadRef.current = null;
      return;
    }
    abortRef.current?.abort();
    speaker.stop();
    loadConversation(activeId);
  }, [activeId, loadConversation]);

  // Keep the newest message in view while streaming, unless the user scrolled up.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (messages.length === 0) el.scrollTop = 0;
    else if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Auto-grow the composer, and shrink it back after sending.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [input]);

  const onScroll = () => {
    const el = threadRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const updateLast = (fn: (m: ChatMessage) => ChatMessage) =>
    setMessages((list) => {
      const copy = list.slice();
      const i = copy.length - 1;
      if (i >= 0 && copy[i].role === "assistant") copy[i] = fn(copy[i]);
      return copy;
    });

  const send = useCallback(
    async (rawText: string, opts: { fromVoice?: boolean; web?: boolean } = {}) => {
      const text = rawText.trim();
      if ((!text && attachments.length === 0) || streaming) return;
      if (!online) {
        toast("You're offline. JARVIS will be available when you reconnect.", "error");
        return;
      }
      unlockSpeech();
      speaker.stop();
      haptic("light");

      const speak = !settings.textOnly && (settings.autoSpeak || !!opts.fromVoice);
      const sentAttachments = attachments;
      const now = Date.now();
      setMessages((m) => [
        ...m,
        {
          id: `u${now}`,
          role: "user",
          content: text,
          meta: sentAttachments.length ? { attachments: sentAttachments.map((a) => ({ name: a.name, mediaType: a.mediaType })) } : {},
          created_at: now,
        },
        { id: `a${now}`, role: "assistant", content: "", meta: {}, created_at: now, pending: true },
      ]);
      setInput("");
      setAttachments([]);
      setStreaming(true);
      setStatusText(STATUS_LABEL.thinking);
      stickRef.current = true;

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      let conversationId = activeId;

      const onEvent = (e: ChatEvent) => {
        switch (e.type) {
          case "meta":
            if (conversationId == null) {
              conversationId = e.conversationId;
              skipLoadRef.current = e.conversationId;
              setActiveId(e.conversationId);
              refreshConversations();
            }
            break;
          case "status":
            setStatusText(e.status === "tool" && e.detail ? TOOL_LABEL[e.detail] ?? STATUS_LABEL.tool : STATUS_LABEL[e.status] ?? "");
            break;
          case "text":
            pulseRef.current++;
            updateLast((m) => ({ ...m, content: m.content + e.delta }));
            if (speak) speaker.feed(e.delta);
            break;
          case "action":
            updateLast((m) => ({ ...m, meta: { ...m.meta, actions: [...(m.meta.actions ?? []), e.summary] } }));
            if (e.changed) bump(e.changed as DataKind);
            haptic("success");
            break;
          case "memory_proposal":
            updateLast((m) => ({ ...m, memoryProposals: [...(m.memoryProposals ?? []), { content: e.content, category: e.category }] }));
            break;
          case "sources":
            updateLast((m) => ({ ...m, meta: { ...m.meta, sources: e.sources } }));
            break;
          case "done":
            updateLast((m) => ({ ...m, id: e.messageId, pending: false }));
            break;
          case "error":
            updateLast((m) => ({ ...m, pending: false, error: e.message }));
            haptic("warning");
            break;
        }
      };

      try {
        await streamChat(
          {
            conversationId,
            text,
            webSearch: opts.web ?? webSearch,
            attachments: sentAttachments.map(({ name, mediaType, data }) => ({ name, mediaType, data })),
          },
          onEvent,
          ctrl.signal,
        );
        if (ctrl.signal.aborted) updateLast((m) => ({ ...m, pending: false, meta: { ...m.meta, stopped: true } }));
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Something went wrong.";
        updateLast((m) => ({ ...m, pending: false, error: message }));
      } finally {
        setStreaming(false);
        setStatusText("");
        if (speak && !ctrl.signal.aborted) speaker.flush();
        updateLast((m) => (m.pending ? { ...m, pending: false } : m));
        refreshConversations();
      }
    },
    [attachments, streaming, online, settings, activeId, webSearch, setActiveId, refreshConversations, bump, toast],
  );

  // Prompts handed over from quick actions elsewhere, Shortcuts (?q=) etc.
  useEffect(() => {
    if (!pendingPrompt) return;
    setPendingPrompt(null);
    if (pendingPrompt.send) send(pendingPrompt.text);
    else {
      setInput(pendingPrompt.text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [pendingPrompt, setPendingPrompt, send]);

  const stop = () => {
    abortRef.current?.abort();
    speaker.stop();
    haptic("light");
  };

  const toggleListening = () => {
    if (listening) {
      stopListenRef.current?.();
      return;
    }
    if (settings.textOnly) {
      toast("Text-only mode is on. Turn it off in Settings to use voice.");
      return;
    }
    unlockSpeech();
    speaker.stop();
    haptic("light");
    setListening(true);
    const before = input;
    stopListenRef.current = startListening({
      onInterim: (t) => {
        pulseRef.current++;
        setInput((before ? before + " " : "") + t);
      },
      onFinal: (t) => {
        const full = ((before ? before + " " : "") + t).trim();
        setInput(full);
        send(full, { fromVoice: true });
      },
      onEnd: () => {
        setListening(false);
        stopListenRef.current = null;
      },
      onError: (msg) => toast(msg, "error"),
    });
  };

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const next: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 4 - attachments.length)) {
      try {
        if (f.type === "application/pdf") {
          if (f.size > 10 * 1024 * 1024) {
            toast(`${f.name} is larger than 10 MB.`, "error");
            continue;
          }
          next.push({ name: f.name, mediaType: f.type, data: await fileToBase64(f) });
        } else if (f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)) {
          const img = await prepareImage(f);
          next.push({ name: f.name, ...img, preview: `data:${img.mediaType};base64,${img.data}` });
        } else {
          toast(`${f.name}: only images and PDFs are supported.`, "error");
        }
      } catch {
        toast(`Couldn't read ${f.name}.`, "error");
      }
    }
    setAttachments((a) => [...a, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  const decideMemory = async (msgIndex: number, pIndex: number, save: boolean) => {
    const proposal = messages[msgIndex].memoryProposals?.[pIndex];
    if (!proposal) return;
    if (save) {
      try {
        await api("/memories", { body: { content: proposal.content, category: proposal.category } });
        bump("memories");
        haptic("success");
      } catch (e) {
        toast((e as Error).message, "error");
        return;
      }
    }
    setMessages((list) =>
      list.map((m, i) =>
        i === msgIndex ? { ...m, memoryProposals: m.memoryProposals?.map((p, j) => (j === pIndex ? { ...p, state: save ? "saved" : "dismissed" } : p)) } : m,
      ),
    );
  };

  const retry = (index: number) => {
    const prevUser = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
    if (!prevUser) return;
    setMessages((m) => m.slice(0, index - 1));
    send(prevUser.content);
  };

  const orbState: OrbState = listening ? "listening" : speaking ? "speaking" : streaming ? "thinking" : "idle";
  const empty = messages.length === 0 && !loadingConv && !loadError;
  const title = conversations.find((c) => c.id === activeId)?.title;
  const subtitle = !online
    ? "Offline. Reconnect to talk to JARVIS."
    : status?.ai === "demo"
      ? "JARVIS systems are online in demo mode."
      : "JARVIS systems are online.";

  return (
    <section className={`assistant ${empty ? "is-empty" : ""}`} aria-label="Assistant">
      <header className="assistant-bar">
        {compact && (
          <button type="button" className="icon-btn" onClick={onOpenHistory} aria-label="Conversation history">
            <Icon name="history" />
          </button>
        )}
        {!empty && <Orb state={orbState} size={40} pulseRef={pulseRef} />}
        <div className="assistant-title">
          {empty ? <span className="brand-word">J.A.R.V.I.S.</span> : <span className="conv-name">{title ?? "Conversation"}</span>}
          {statusText && !empty && (
            <span className="status-text" aria-live="polite">
              {statusText}
            </span>
          )}
        </div>
        {speaking && (
          <button type="button" className="btn small ghost" onClick={() => speaker.stop()} aria-label="Stop speaking">
            <Icon name="mute" size={18} /> Stop voice
          </button>
        )}
        {!empty && (
          <button type="button" className="icon-btn" onClick={() => setActiveId(null)} aria-label="New conversation">
            <Icon name="plus" />
          </button>
        )}
      </header>

      <div className="thread" ref={threadRef} onScroll={onScroll}>
        {empty && (
          <div className="hero">
            <Orb state={orbState} size={compact ? 220 : 280} pulseRef={pulseRef} onClick={toggleListening} label={listening ? "Stop listening" : "Tap to speak to JARVIS"} />
            <h1 className="greeting">{greeting(user.name, settings.addressAs)}</h1>
            <p className="subtitle">{listening ? "Listening…" : subtitle}</p>
            <StatusIndicators />
            <div className="quick-grid">
              {QUICK_ACTIONS.map((q) => (
                <button
                  key={q.title}
                  type="button"
                  className="quick-card glass"
                  onClick={() => {
                    haptic("light");
                    if (q.web) setWebSearch(true);
                    if (q.send) send(q.prompt);
                    else {
                      setInput(q.prompt);
                      inputRef.current?.focus();
                    }
                  }}
                >
                  <Icon name={q.icon} size={20} />
                  <span className="quick-title">{q.title}</span>
                  <span className="quick-hint">{q.hint}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {loadingConv && <Spinner label="Loading conversation" />}
        {loadError && (
          <div className="error-state" role="alert">
            <p>{loadError}</p>
            <button type="button" className="btn" onClick={() => loadConversation(activeId)}>
              Retry
            </button>
          </div>
        )}

        {messages.map((m, i) => (
          <article key={m.id} className={`msg msg-${m.role}`} aria-label={m.role === "user" ? "You" : "JARVIS"}>
            {m.role === "assistant" && <div className="msg-avatar" aria-hidden="true" />}
            <div className="msg-body">
              {m.meta.attachments?.length ? (
                <div className="msg-attachments">
                  {m.meta.attachments.map((a) => (
                    <span key={a.name} className="chip">
                      <Icon name="clip" size={14} /> {a.name}
                    </span>
                  ))}
                </div>
              ) : null}
              {m.role === "user" ? (
                <p className="user-text">{m.content}</p>
              ) : m.content ? (
                <Markdown text={m.content} streaming={m.pending} />
              ) : m.pending ? (
                <div className="typing" aria-label="JARVIS is thinking">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}

              {m.meta.actions?.length ? (
                <ul className="actions-list">
                  {m.meta.actions.map((a, j) => (
                    <li key={j}>
                      <Icon name="check" size={14} /> {a}
                    </li>
                  ))}
                </ul>
              ) : null}

              {m.memoryProposals?.map((p, j) => (
                <div key={j} className="memory-card glass">
                  <Icon name="brain" size={18} />
                  <div>
                    <p className="small muted">JARVIS would like to remember:</p>
                    <p>{p.content}</p>
                    {p.state ? (
                      <p className="small muted">{p.state === "saved" ? "Saved to memory." : "Dismissed."}</p>
                    ) : (
                      <div className="row">
                        <button type="button" className="btn small primary" onClick={() => decideMemory(i, j, true)}>
                          Remember
                        </button>
                        <button type="button" className="btn small ghost" onClick={() => decideMemory(i, j, false)}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {m.meta.sources?.length ? (
                <div className="sources">
                  <p className="small muted">Sources (verified links from web search)</p>
                  <ol>
                    {m.meta.sources.slice(0, 8).map((s) => (
                      <li key={s.url}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          <span className="src-domain">{domainOf(s.url)}</span>
                          <span className="src-title">{s.title}</span>
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              {m.meta.stopped && <p className="small muted">Stopped.</p>}
              {(m.error || m.meta.error) && (
                <div className="msg-error" role="alert">
                  <span>{m.error ?? m.meta.error}</span>
                  {m.error && i === messages.length - 1 && !streaming && (
                    <button type="button" className="btn small" onClick={() => retry(i)}>
                      Retry
                    </button>
                  )}
                </div>
              )}

              {m.role === "assistant" && !m.pending && m.content && (
                <div className="msg-tools">
                  {!settings.textOnly && (
                    <button
                      type="button"
                      className="icon-btn small"
                      aria-label="Read aloud"
                      onClick={() => {
                        unlockSpeech();
                        speaker.speakAll(m.content);
                      }}
                    >
                      <Icon name="volume" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn small"
                    aria-label="Copy response"
                    onClick={() => navigator.clipboard?.writeText(m.content).then(() => toast("Copied."))}
                  >
                    <Icon name="copy" size={16} />
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <form
        className="composer glass"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a, i) => (
              <span key={i} className="attachment">
                {a.preview ? <img src={a.preview} alt="" /> : <Icon name="notes" size={18} />}
                <span>{a.name}</span>
                <button type="button" aria-label={`Remove ${a.name}`} onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}>
                  <Icon name="close" size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="composer-row">
          <button type="button" className="icon-btn" onClick={() => fileRef.current?.click()} aria-label="Attach image or PDF" disabled={streaming}>
            <Icon name="clip" />
          </button>
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <button
            type="button"
            className={`icon-btn ${webSearch ? "on" : ""}`}
            onClick={() => setWebSearch((w) => !w)}
            aria-pressed={webSearch}
            aria-label={webSearch ? "Web search on" : "Web search off"}
            title="Web search"
          >
            <Icon name="globe" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            placeholder={listening ? "Listening…" : "Ask JARVIS…"}
            aria-label="Message JARVIS"
            enterKeyHint="send"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          {!settings.textOnly && (
            <button
              type="button"
              className={`mic-btn ${listening ? "live" : ""}`}
              onClick={toggleListening}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Speak to JARVIS"}
              disabled={streaming || (!sttSupported() && !listening)}
              title={sttSupported() ? "Voice input" : "Voice input not supported here: use keyboard dictation"}
            >
              <Icon name="mic" />
            </button>
          )}
          {streaming ? (
            <button type="button" className="send-btn stop" onClick={stop} aria-label="Stop generating">
              <Icon name="stop" />
            </button>
          ) : (
            <button type="submit" className="send-btn" disabled={!input.trim() && attachments.length === 0} aria-label="Send">
              <Icon name="send" />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
