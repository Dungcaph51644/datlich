import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Bot,
  ChevronDown,
  LoaderCircle,
  MessageCircle,
  Send,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { ChatClientError, type ChatReply } from './chatClient';
import { navigateRoute, readRoute } from './navigation';

interface Message {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  reply?: ChatReply;
}
export interface ClubChatProps {
  memberName: string | null;
  identityKey: string;
  online: boolean;
  onChoose: () => void;
  ask: (
    message: string,
    history: string[],
    signal: AbortSignal,
  ) => Promise<ChatReply>;
}
const suggestions = [
  'Tuần này đánh hôm nào?',
  'Ai đặt sân tuần sau?',
  'Buổi thứ Ba còn mấy chỗ?',
  'Tôi còn thiếu bao nhiêu?',
];
export default function ClubChat({
  memberName,
  identityKey,
  online,
  onChoose,
  ask,
}: ClubChatProps) {
  const [view, setView] = useState<'closed' | 'open' | 'minimized'>('closed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    message: string;
    question: string;
    history: string[];
  } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const pending = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const lastSent = useRef(0);
  const count = useRef(0);
  const previousView = useRef(view);
  useEffect(() => {
    sequence.current++;
    pending.current?.abort();
    setMessages([]);
    setFailure(null);
    setBusy(false);
    setConfirmClear(false);
    return () => {
      sequence.current++;
      pending.current?.abort();
    };
  }, [identityKey]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(
      () => setCooldown((n) => Math.max(0, n - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [cooldown]);
  useEffect(() => {
    if (view === 'open') input.current?.focus();
    else if (previousView.current === 'open') launcher.current?.focus();
    previousView.current = view;
  }, [view]);
  useEffect(() => {
    if (view === 'open') end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages, busy, failure, view]);
  function clear() {
    sequence.current++;
    pending.current?.abort();
    setMessages([]);
    setDraft('');
    setBusy(false);
    setFailure(null);
    setConfirmClear(false);
  }
  function close() {
    setView('closed');
    launcher.current?.focus();
  }
  async function send(question: string, retryHistory?: string[]) {
    const text = question.trim();
    if (!text || text.length > 800 || busy || !online || cooldown) return;
    const history =
      retryHistory ??
      messages
        .filter((m) => m.role === 'user')
        .slice(-4)
        .map((m) => m.text);
    const wait = Math.ceil((lastSent.current + 3500 - Date.now()) / 1000);
    if (wait > 0) {
      setCooldown(wait);
      return;
    }
    lastSent.current = Date.now();
    setDraft('');
    setFailure(null);
    setBusy(true);
    if (!retryHistory)
      setMessages((previous) =>
        [
          ...previous,
          { id: ++count.current, role: 'user' as const, text },
        ].slice(-40),
      );
    const controller = new AbortController();
    pending.current = controller;
    const seq = ++sequence.current;
    const timeout = setTimeout(() => controller.abort(), 55000);
    try {
      const reply = await ask(text, history, controller.signal);
      if (seq !== sequence.current) return;
      setMessages((previous) =>
        [
          ...previous,
          {
            id: ++count.current,
            role: 'assistant' as const,
            text: reply.answer,
            reply,
          },
        ].slice(-40),
      );
    } catch (error) {
      if (seq !== sequence.current) return;
      const message =
        error instanceof Error && error.name !== 'AbortError'
          ? error.message
          : 'Trợ lý phản hồi lâu hơn dự kiến. Bạn thử lại nhé.';
      setFailure({ message, question: text, history });
      if (error instanceof ChatClientError && error.retryAfter)
        setCooldown(error.retryAfter);
    } finally {
      clearTimeout(timeout);
      if (seq === sequence.current) setBusy(false);
    }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };
  return (
    <div className="club-chat-root">
      {view !== 'open' && (
        <button
          ref={launcher}
          className={`club-chat-launcher ${view === 'minimized' ? 'minimized' : ''}`}
          aria-label="Mở trợ lý AI cầu lông"
          aria-expanded={false}
          onClick={() => setView('open')}
        >
          {busy ? (
            <LoaderCircle size={23} className="spin" />
          ) : (
            <MessageCircle size={24} />
          )}
          <span>
            {view === 'minimized' ? 'Tiếp tục trò chuyện' : 'Hỏi trợ lý'}
            <small>Đồng hành cùng đội</small>
          </span>
          <i aria-hidden="true" />
        </button>
      )}
      {view === 'open' && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="club-chat-title"
          className="club-chat-panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <header className="club-chat-header">
            <div className="club-chat-avatar">
              <Bot size={25} />
            </div>
            <div>
              <h2 id="club-chat-title">
                Bạn đồng hành <Sparkles size={14} />
              </h2>
              <p>Trợ lý AI · Cầu lông & những người bạn</p>
            </div>
            <div className="club-chat-tools">
              <button
                type="button"
                aria-label="Xóa cuộc trò chuyện"
                title="Xóa cuộc trò chuyện"
                onClick={() => setConfirmClear(true)}
                disabled={!messages.length && !failure}
              >
                <Trash2 size={17} />
              </button>
              <button
                type="button"
                aria-label="Thu nhỏ trò chuyện"
                onClick={() => setView('minimized')}
              >
                <ChevronDown size={21} />
              </button>
              <button
                type="button"
                aria-label="Đóng trò chuyện"
                onClick={close}
              >
                <X size={19} />
              </button>
            </div>
          </header>
          <div className="club-chat-identity">
            <span>
              <span className={online ? 'online-dot' : 'offline-dot'} />{' '}
              {memberName
                ? `Đang tra cứu cho ${memberName}`
                : 'Chưa chọn tên cá nhân'}
            </span>
            <button
              type="button"
              onClick={() => {
                const question = messages
                  .filter((m) => m.role === 'user')
                  .at(-1)?.text;
                if (question) setDraft(question);
                setView('minimized');
                onChoose();
              }}
            >
              <Users size={13} />
              {memberName ? 'Đổi tên' : 'Chọn tên'}
            </button>
          </div>
          {confirmClear && (
            <div className="club-chat-confirm" role="alert">
              <p>Xóa toàn bộ tin nhắn trong phiên này?</p>
              <button onClick={clear}>Xóa cuộc trò chuyện</button>
              <button onClick={() => setConfirmClear(false)}>Giữ lại</button>
            </div>
          )}
          <div
            className="club-chat-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Nội dung trò chuyện"
          >
            {!messages.length && (
              <div className="club-chat-welcome">
                <div>
                  <Sparkles size={25} />
                </div>
                <h3>Lên sân thôi, để mình giúp!</h3>
                <p>
                  Hỏi về lịch đánh, người lo sân, chỗ trống, tiền nhóm hoặc
                  chuyến đi sắp tới.
                </p>
                <div className="club-chat-suggestions">
                  {suggestions.map((question) => (
                    <button
                      key={question}
                      disabled={busy || !online || !!cooldown}
                      onClick={() => void send(question)}
                    >
                      {question}
                      <ArrowRight size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article
                key={message.id}
                className={`club-chat-message ${message.role}`}
              >
                <span className="club-chat-sender">
                  {message.role === 'user' ? 'Bạn' : 'Bạn đồng hành'}
                </span>
                <p>{message.text}</p>
                {message.reply?.sources.length ? (
                  <div className="club-chat-sources">
                    {message.reply.sources.map((source) => (
                      <a
                        key={source.id}
                        href={source.href}
                        onClick={(event) => {
                          event.preventDefault();
                          navigateRoute(readRoute(source.href));
                          setView('minimized');
                        }}
                      >
                        {source.label}
                        <ArrowRight size={13} />
                      </a>
                    ))}
                  </div>
                ) : null}
                {message.reply?.needsMember && (
                  <button
                    className="club-chat-choose"
                    onClick={() => {
                      setDraft(
                        messages.filter((m) => m.role === 'user').at(-1)
                          ?.text ?? '',
                      );
                      setView('minimized');
                      onChoose();
                    }}
                  >
                    <Users size={14} />
                    Chọn tên của tôi
                  </button>
                )}
                {message.reply && (
                  <time dateTime={message.reply.checkedAt}>
                    Tra cứu lúc{' '}
                    {new Date(message.reply.checkedAt).toLocaleTimeString(
                      'vi-VN',
                      {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Ho_Chi_Minh',
                      },
                    )}{' '}
                    ·{' '}
                    {new Date(message.reply.checkedAt).toLocaleDateString(
                      'vi-VN',
                      { timeZone: 'Asia/Ho_Chi_Minh' },
                    )}
                  </time>
                )}
              </article>
            ))}
            {busy && (
              <div className="club-chat-typing" role="status">
                <LoaderCircle size={17} className="spin" />
                <span>Đang tra cứu và soạn câu trả lời…</span>
              </div>
            )}
            {failure && (
              <div className="club-chat-error" role="alert">
                <p>{failure.message}</p>
                <button
                  disabled={busy || !online || !!cooldown}
                  onClick={() => void send(failure.question, failure.history)}
                >
                  Thử lại{cooldown ? ` sau ${cooldown}s` : ''}
                </button>
              </div>
            )}
            <div ref={end} />
          </div>
          <form className="club-chat-composer" onSubmit={submit}>
            {!online && (
              <p className="club-chat-offline" role="status">
                Đang mất mạng. Chưa thể lấy dữ liệu mới nhất.
              </p>
            )}
            <div>
              <textarea
                ref={input}
                aria-label="Câu hỏi cho trợ lý"
                placeholder="Bạn muốn hỏi điều gì?"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={800}
                rows={2}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    !matchMedia('(pointer: coarse)').matches
                  ) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
              />
              <button
                type="submit"
                aria-label="Gửi câu hỏi"
                disabled={busy || !online || !draft.trim() || !!cooldown}
              >
                {busy ? (
                  <LoaderCircle size={19} className="spin" />
                ) : (
                  <Send size={19} />
                )}
              </button>
            </div>
            <div className="club-chat-footnote">
              <span>
                {cooldown
                  ? `Có thể gửi sau ${cooldown}s`
                  : 'Chỉ hỏi đáp · Thao tác tại trang chức năng'}
              </span>
              <span>{draft.length}/800</span>
            </div>
            <p className="club-chat-privacy">
              Dữ liệu liên quan được gửi đến dịch vụ AI khi hỏi. Tin nhắn chỉ
              giữ trong phiên này; đổi tên sẽ xóa nội dung. Hỏi lại để xem cập
              nhật mới.
            </p>
          </form>
        </section>
      )}
    </div>
  );
}
