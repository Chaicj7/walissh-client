import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Check, ChevronDown, CirclePlus, Copy, Edit3,
  GitBranch, History, MessageSquareText, Monitor, Moon,
  PanelRightClose, PanelRightOpen, Paperclip, Plus, Search, Send, Server,
  Settings, Sparkles, SquareTerminal, Sun, TerminalSquare, Trash2, Unplug, WifiOff, X, Zap,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { sshApi, SshConnectionDto, SshConnectionPayload, terminalApi } from "./api/ssh";
import "@xterm/xterm/css/xterm.css";
import "./App.css";

type ServerProfile = { id: string; name: string; host: string; port: number; user: string; authType: 1 | 2; password: string; privateKey: string; online: boolean };
type ChatMessage = { id: number; role: "assistant" | "user"; content: string; time: string };
type Theme = "dark" | "light" | "system";

const initialMessages: ChatMessage[] = [
  { id: 1, role: "assistant", time: "10:23", content: "你好，我是 Wali AI。我可以分析终端输出、排查服务故障，并协助你执行安全的运维操作。今天需要处理什么？" },
  { id: 2, role: "user", time: "10:24", content: "帮我检查这台服务器上的 Nginx 服务状态，并解释是否存在异常。" },
  { id: 3, role: "assistant", time: "10:24", content: "Nginx 当前为 active (running)，已设置为开机启动。主进程 PID 为 1186，共有 2 个 worker 进程，内存占用约 5.8 MB。\n\n目前没有明显异常。建议再运行 nginx -t 检查配置语法。" },
];

function toServerProfile(dto: SshConnectionDto): ServerProfile {
  return { id: dto.connectionId, name: dto.connectionName, host: dto.host, port: dto.port, user: dto.username, authType: dto.authType === 2 ? 2 : 1, password: "", privateKey: "", online: dto.status === 1 };
}

function ActivityRail({ chatVisible, onToggleChat, onOpenSettings }: {
  chatVisible: boolean; onToggleChat: () => void; onOpenSettings: () => void;
}) {
  return <nav className="activity-rail" aria-label="主要功能">
    <div className="brand-mark"><Zap size={19} fill="currentColor" /></div>
    <div className="rail-terminal-mark" title="SSH 终端"><TerminalSquare size={20} /></div>
    <button className={`rail-button ${chatVisible ? "active" : ""}`} aria-label={chatVisible ? "隐藏 AI 对话" : "显示 AI 对话"} title={chatVisible ? "隐藏 AI 对话" : "显示 AI 对话"} onClick={onToggleChat}><MessageSquareText size={20} /></button>
    <div className="rail-spacer" />
    <button className="rail-button" aria-label="打开设置" title="设置" onClick={onOpenSettings}><Settings size={20} /></button>
  </nav>;
}

function ServerSidebar({ servers, selectedId, connectingId, disconnectingId, loading, error, onRetry, onSelect, onConnect, onDisconnect, onAdd, onEdit, onDelete }: {
  servers: ServerProfile[]; selectedId: string | null; connectingId: string | null; disconnectingId: string | null; loading: boolean; error: string;
  onRetry: () => void; onSelect: (id: string) => void; onAdd: () => void; onEdit: (server: ServerProfile) => void;
  onDelete: (id: string) => void; onConnect: (id: string) => void; onDisconnect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => servers.filter((server) => `${server.name} ${server.host} ${server.user}`.toLowerCase().includes(query.toLowerCase())), [query, servers]);
  return <aside className="server-sidebar">
    <header className="pane-heading"><div><span className="eyebrow">工作区</span><h1>SSH 服务器</h1></div></header>
    <div className="server-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务器..." aria-label="搜索服务器" />{query ? <button onClick={() => setQuery("")} aria-label="清除搜索"><X size={13} /></button> : null}</div>
    <button className="add-server-button" onClick={onAdd}><CirclePlus size={16} /> 添加服务器</button>
    {loading ? <div className="sidebar-notice">正在加载服务器...</div> : null}
    {error ? <div className="sidebar-error"><span>{error}</span><button onClick={onRetry}>重试</button></div> : null}
    <div className="server-list">
      {!loading && !error && filtered.length === 0 ? <div className="server-list-empty">{query ? "没有匹配的服务器" : "暂无服务器"}</div> : null}
      {filtered.map((server) => {
        const connecting = connectingId === server.id;
        const disconnecting = disconnectingId === server.id;
        return <div className={`server-row ${selectedId === server.id ? "selected" : ""} ${connecting || disconnecting ? "connecting" : ""}`} key={server.id} onClick={() => onSelect(server.id)}>
          <span className={`status-dot ${server.online ? "online" : ""} ${connecting ? "connecting" : ""}`} /><Server size={17} />
          <div className="server-meta"><strong>{server.user}@{server.name}</strong><span>{connecting ? "正在连接..." : disconnecting ? "正在断开..." : `${server.host}:${server.port}`}</span></div>
          <button
            className={`connection-pill ${server.online ? "disconnect" : "connect"}`}
            disabled={Boolean(connectingId || disconnectingId)}
            onClick={(event) => { event.stopPropagation(); server.online ? onDisconnect(server.id) : onConnect(server.id); }}
            aria-label={`${server.online ? "断开" : "连接"} ${server.name}`}
          >{connecting ? "连接中" : disconnecting ? "断开中" : server.online ? "断开" : "连接"}</button>
          <div className="row-actions"><button onClick={(event) => { event.stopPropagation(); onEdit(server); }} aria-label={`编辑 ${server.name}`}><Edit3 size={14} /></button><button className="danger-action" onClick={(event) => { event.stopPropagation(); onDelete(server.id); }} aria-label={`删除 ${server.name}`}><Trash2 size={14} /></button></div>
        </div>;
      })}
    </div>
    <footer className="sidebar-footer"><History size={14} /><span>服务器</span><span className="footer-count">{servers.length}</span></footer>
  </aside>;
}

function TerminalWorkspace({ server, chatVisible, disconnecting, lightMode, onToggleChat, onDisconnect, notify }: {
  server: ServerProfile | null; chatVisible: boolean; disconnecting: boolean; lightMode: boolean; onToggleChat: () => void;
  onDisconnect: () => void; notify: (message: string) => void;
}) {
  const [sessionState, setSessionState] = useState<"idle" | "opening" | "ready" | "closed" | "error">("idle");
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) return;
    const terminal = new Terminal({ cursorBlink: true, convertEol: false, fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, monospace', fontSize: 12, lineHeight: 1.35, scrollback: 5000, allowProposedApi: false, disableStdin: true });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon); terminal.open(host); fitAddon.fit();
    terminalRef.current = terminal;
    let pendingInput = "";
    let writeTimer: number | null = null;
    const flushInput = () => {
      writeTimer = null; const id = sessionIdRef.current; const input = pendingInput; pendingInput = "";
      if (id && input) void terminalApi.write(id, input).catch((error) => terminal.writeln(`\r\n[输入失败] ${error instanceof Error ? error.message : "未知错误"}`));
    };
    const inputDisposable = terminal.onData((data) => { pendingInput += data; if (writeTimer === null) writeTimer = window.setTimeout(flushInput, 25); });
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch { return; }
      const id = sessionIdRef.current;
      if (id) void terminalApi.resize(id, terminal.cols, terminal.rows).catch(() => undefined);
    });
    resizeObserver.observe(host);
    return () => { if (writeTimer !== null) window.clearTimeout(writeTimer); resizeObserver.disconnect(); inputDisposable.dispose(); terminal.dispose(); terminalRef.current = null; };
  }, []);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = lightMode
      ? { background: "#ffffff", foreground: "#344252", cursor: "#17618f", selectionBackground: "#b9dcf5" }
      : { background: "#070b10", foreground: "#c9d2dd", cursor: "#f4f7fa", selectionBackground: "#24425d" };
  }, [lightMode]);
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    sessionIdRef.current = null; terminal.options.disableStdin = true; terminal.reset();
    if (!server) { setSessionState("idle"); return; }
    let cancelled = false;
    let openedSessionId: string | null = null;
    let polling = false;
    let terminalFailed = false;
    setSessionState("opening"); terminal.writeln("\x1b[90m正在打开终端会话...\x1b[0m");
    const poll = async () => {
      if (!openedSessionId || polling || terminalFailed) return;
      polling = true;
      try {
        const data = await terminalApi.read(openedSessionId);
        if (!cancelled && data.output) terminal.write(data.output);
        // Keep compatibility with a backend that has not restarted yet and
        // therefore does not include the new `closed` response field.
        const shellClosed = data.closed || data.output.includes("[连接已断开]");
        if (!cancelled && shellClosed) {
          terminalFailed = true; sessionIdRef.current = null; terminal.options.disableStdin = true; setSessionState("closed");
        }
      }
      catch (error) { terminalFailed = true; if (!cancelled) { setSessionState("error"); terminal.options.disableStdin = true; terminal.writeln(`\r\n\x1b[31m[终端读取失败] ${error instanceof Error ? error.message : "未知错误"}\x1b[0m`); } }
      finally { polling = false; }
    };
    const timer = window.setInterval(() => void poll(), 250);
    // Delay the side effect slightly so React StrictMode can run its development
    // setup/cleanup probe without creating two competing backend PTY sessions.
    const openTimer = window.setTimeout(() => {
      void terminalApi.open(server.id, terminal.cols, terminal.rows).then((data) => {
        openedSessionId = data.sessionId; sessionIdRef.current = data.sessionId;
        if (cancelled) { void terminalApi.close(data.sessionId).catch(() => undefined); return; }
        terminal.reset(); terminal.options.disableStdin = false; terminal.focus(); setSessionState("ready"); if (data.initialOutput) terminal.write(data.initialOutput);
      }).catch((error) => {
        if (!cancelled) { setSessionState("error"); terminal.writeln(`\x1b[31m[终端打开失败] ${error instanceof Error ? error.message : "未知错误"}\x1b[0m`); }
      });
    }, 60);
    return () => { cancelled = true; window.clearTimeout(openTimer); window.clearInterval(timer); sessionIdRef.current = null; terminal.options.disableStdin = true; if (openedSessionId) void terminalApi.close(openedSessionId).catch(() => undefined); };
  }, [server?.id]);
  const addTerminal = () => notify(server ? "当前后端每个 SSH 连接支持一个终端会话" : "请先连接 SSH 服务器");
  const copySession = async () => {
    if (!server) { notify("暂无可复制的 SSH 会话"); return; }
    try {
      await navigator.clipboard.writeText(`${server.user}@${server.host}:${server.port}`);
      notify("会话信息已复制");
    } catch {
      notify("复制失败，请检查剪贴板权限");
    }
  };
  return <main className="terminal-pane">
    <div className="terminal-tabs">
      <div className="terminal-tab active" role="tab" aria-selected="true"><button className="tab-select"><SquareTerminal size={15} /><span>{server ? `${server.user}@${server.name}` : "SSH 终端"}</span></button><button className="tab-close" onClick={() => notify("请使用“断开连接”关闭当前终端")} aria-label="关闭 main"><X size={13} /></button></div>
      <button className="tab-plus" aria-label="新建终端" title="新建终端" onClick={addTerminal}><Plus size={16} /></button><div className="tab-spacer" />
      <button className="icon-button" aria-label={chatVisible ? "隐藏 AI 对话" : "显示 AI 对话"} title={chatVisible ? "隐藏 AI 对话" : "显示 AI 对话"} onClick={onToggleChat}>{chatVisible ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button>
    </div>
    {server ? <div className="connection-bar"><span className={`status-dot ${sessionState === "ready" ? "online" : "connecting"}`} /><strong>{sessionState === "opening" ? "正在打开终端" : sessionState === "closed" ? "终端已退出" : sessionState === "error" ? "终端异常" : "已连接"}</strong><span className="bar-divider" /><span>{server.user}@{server.name}</span><code>{server.host}</code><div className="connection-actions"><button onClick={copySession}><Copy size={14} /> 复制会话信息</button><button onClick={onDisconnect} disabled={disconnecting}><Unplug size={14} /> {disconnecting ? "断开中..." : "断开连接"}</button></div></div> : <div className="connection-bar disconnected"><span className="status-dot" /><strong>未连接</strong><span>请选择 SSH 服务器建立连接</span></div>}
    <div className="terminal-canvas" role="log" aria-label="SSH 终端输出"><div className={`terminal-content xterm-content ${server ? "" : "hidden"}`}><div className="terminal-host" ref={terminalHostRef} /></div>{!server ? <div className="terminal-empty"><span className="empty-terminal-icon"><WifiOff size={24} /></span><strong>暂无连接 SSH 服务器</strong><p>请从左侧选择在线服务器以建立连接</p></div> : null}</div>
    <footer className="terminal-statusbar"><span><GitBranch size={13} /> main</span>{server ? <><span><span className="status-dot online" /> 已连接: {server.host}</span><span>SSH</span></> : <span><span className="status-dot" /> 未连接</span>}<div className="status-spacer" /><span>UTF-8</span><span>LF</span>{server ? <span>Shell: bash</span> : null}</footer>
  </main>;
}

function ChatPanel({ server, onClose, notify }: { server: ServerProfile | null; onClose: () => void; notify: (message: string) => void }) {
  const [messages, setMessages] = useState(initialMessages); const [draft, setDraft] = useState(""); const [agent, setAgent] = useState("Wali AI · 运维专家");
  const [attachment, setAttachment] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sendMessage = () => { const content = draft.trim(); if (!content) return; const now = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }); setMessages((current) => [...current, { id: Date.now(), role: "user", content, time: now }]); setDraft(""); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } };
  return <aside className="chat-panel">
    <header className="chat-header"><div><span className="eyebrow">协同助手</span><h2>AI 对话</h2></div><div className="chat-header-actions"><button className="new-chat" onClick={() => setMessages([])}><Plus size={15} /> 新建对话</button><button className="icon-button close-chat" onClick={onClose} aria-label="隐藏 AI 对话" title="隐藏 AI 对话"><PanelRightClose size={17} /></button></div></header>
    <div className="agent-select-wrap"><Sparkles size={15} /><select value={agent} onChange={(event) => setAgent(event.target.value)} aria-label="选择智能体"><option>Wali AI · 运维专家</option><option>Linux 故障诊断</option><option>代码审查助手</option></select><ChevronDown size={14} /></div>
    <div className="chat-messages">{messages.length === 0 ? <div className="chat-empty"><Bot size={28} /><strong>开始新对话</strong><span>向智能体询问终端输出或服务器问题。</span></div> : messages.map((message) => <article className={`message ${message.role}`} key={message.id}><div className="message-meta">{message.role === "assistant" ? <span className="avatar"><Bot size={14} /></span> : null}<strong>{message.role === "assistant" ? "Wali AI" : "你"}</strong><time>{message.time}</time></div><div className="message-bubble">{message.content}</div></article>)}</div>
    <div className="composer">
      {attachment ? <div className="attachment-chip"><Paperclip size={12} /><span>{attachment}</span><button onClick={() => setAttachment("")} aria-label="移除附件"><X size={12} /></button></div> : null}
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown} placeholder="输入消息，Enter 发送，Shift + Enter 换行" aria-label="对话输入框" />
      <div className="composer-toolbar"><div>
        <input ref={fileInputRef} className="visually-hidden" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setAttachment(file.name); notify(`已选择附件：${file.name}`); } }} />
        <button aria-label="添加附件" title="添加附件" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
        <button aria-label="插入终端上下文" title="插入终端上下文" onClick={() => { const context = server ? `${server.user}@${server.name} (${server.host}) 当前连接正常。` : "暂无连接 SSH 服务器。"; setDraft((current) => `${current}${current ? "\n" : ""}[终端上下文] ${context}`); notify("已插入当前终端上下文"); }}><TerminalSquare size={16} /></button>
      </div><button className="send-button" onClick={sendMessage} disabled={!draft.trim()}><Send size={15} /> 发送</button></div>
    </div>
  </aside>;
}

function ServerDialog({ server, onClose, onSave }: { server: ServerProfile | null | undefined; onClose: () => void; onSave: (server: Omit<ServerProfile, "id" | "online">) => void }) {
  const editing = Boolean(server); const [form, setForm] = useState({ name: server?.name ?? "", host: server?.host ?? "", port: server?.port ?? 22, user: server?.user ?? "ubuntu", authType: server?.authType ?? 1, password: server?.password ?? "", privateKey: server?.privateKey ?? "" });
  const credentialRequired = !editing || form.authType !== server?.authType;
  const submit = (event: FormEvent) => { event.preventDefault(); onSave(form as Omit<ServerProfile, "id" | "online">); };
  return <div className="dialog-backdrop" onMouseDown={onClose}><form className="server-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
    <div className="dialog-header"><div><span className="eyebrow">连接配置</span><h2>{editing ? "编辑服务器" : "添加服务器"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div>
    <div className="form-grid"><label className="wide"><span>名称</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="prod-web-02" /></label><label className="wide"><span>主机地址</span><input required value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="192.168.1.10" /></label><label><span>用户名</span><input required value={form.user} onChange={(event) => setForm({ ...form, user: event.target.value })} /></label><label><span>端口</span><input required type="number" value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>
      <fieldset className="auth-type-field wide"><legend>认证方式</legend><div className="auth-type-options"><button type="button" className={form.authType === 1 ? "active" : ""} onClick={() => setForm({ ...form, authType: 1 })}>密码认证</button><button type="button" className={form.authType === 2 ? "active" : ""} onClick={() => setForm({ ...form, authType: 2 })}>私钥认证</button></div></fieldset>
      {form.authType === 1 ? <label className="wide"><span>密码{editing && !credentialRequired ? "（留空则保留）" : ""}</span><input required={credentialRequired} type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder={editing && !credentialRequired ? "留空则保留原密码" : "请输入 SSH 登录密码"} autoComplete="new-password" /></label> : <label className="wide"><span>私钥{editing && !credentialRequired ? "（留空则保留）" : ""}</span><textarea required={credentialRequired} value={form.privateKey} onChange={(event) => setForm({ ...form, privateKey: event.target.value })} placeholder={editing && !credentialRequired ? "留空则保留原私钥" : "粘贴 OpenSSH 私钥内容"} spellCheck={false} /></label>}
    </div>
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="submit" className="primary-button"><Check size={15} /> 保存配置</button></div>
  </form></div>;
}

function SettingsDialog({ theme, onThemeChange, onClose }: { theme: Theme; onThemeChange: (theme: Theme) => void; onClose: () => void }) {
  const options: { value: Theme; label: string; description: string; icon: typeof Moon }[] = [
    { value: "dark", label: "深色", description: "适合终端和低光环境", icon: Moon },
    { value: "light", label: "浅色", description: "明亮清晰的工作界面", icon: Sun },
    { value: "system", label: "跟随系统", description: "自动匹配系统外观", icon: Monitor },
  ];
  return <div className="dialog-backdrop" onMouseDown={onClose}>
    <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="dialog-header"><div><span className="eyebrow">偏好设置</span><h2 id="settings-title">外观设置</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭设置"><X size={17} /></button></div>
      <div className="settings-content"><div className="settings-section-title">主题</div><div className="theme-options">
        {options.map((option) => { const Icon = option.icon; return <button className={`theme-option ${theme === option.value ? "selected" : ""}`} key={option.value} onClick={() => onThemeChange(option.value)}>
          <span className="theme-icon"><Icon size={18} /></span><span><strong>{option.label}</strong><small>{option.description}</small></span>{theme === option.value ? <Check size={16} /> : null}
        </button>; })}
      </div></div>
      <div className="dialog-actions"><button className="primary-button" onClick={onClose}><Check size={15} /> 完成</button></div>
    </section>
  </div>;
}

function DeleteServerDialog({ server, deleting, onClose, onConfirm }: { server: ServerProfile; deleting: boolean; onClose: () => void; onConfirm: () => void }) {
  return <div className="dialog-backdrop" onMouseDown={deleting ? undefined : onClose}>
    <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-server-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="dialog-header"><div><span className="eyebrow">危险操作</span><h2 id="delete-server-title">删除服务器</h2></div><button className="icon-button" onClick={onClose} disabled={deleting} aria-label="关闭删除确认"><X size={17} /></button></div>
      <div className="confirm-content"><strong>确定删除“{server.name}”吗？</strong><p>{server.user}@{server.host}:{server.port}</p><span>删除后该连接配置将不再显示。</span></div>
      <div className="dialog-actions"><button className="secondary-button" onClick={onClose} disabled={deleting}>取消</button><button className="danger-button" onClick={onConfirm} disabled={deleting}><Trash2 size={15} /> {deleting ? "删除中..." : "确认删除"}</button></div>
    </section>
  </div>;
}

function App() {
  const [servers, setServers] = useState<ServerProfile[]>([]); const [selectedId, setSelectedId] = useState<string | null>(null); const [connectedId, setConnectedId] = useState<string | null>(null); const [dialogServer, setDialogServer] = useState<ServerProfile | null | undefined>(undefined);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(""); const [connectingId, setConnectingId] = useState<string | null>(null); const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [chatVisible, setChatVisible] = useState(true); const [settingsOpen, setSettingsOpen] = useState(false); const [toast, setToast] = useState("");
  const [deleteServerId, setDeleteServerId] = useState<string | null>(null); const [deleting, setDeleting] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("walissh-theme") as Theme | null) ?? "dark");
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const connectedServer = servers.find((server) => server.id === connectedId) ?? null;
  const deleteTarget = servers.find((server) => server.id === deleteServerId) ?? null;
  const notify = (message: string) => setToast(message);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 2200); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { const media = window.matchMedia("(prefers-color-scheme: dark)"); const update = (event: MediaQueryListEvent) => setSystemDark(event.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const updateTheme = (nextTheme: Theme) => { setTheme(nextTheme); localStorage.setItem("walissh-theme", nextTheme); };
  const toggleChat = () => setChatVisible((current) => !current);
  const loadConnections = useCallback(async () => {
    setLoading(true); setLoadError("");
    try {
      const data = await sshApi.list(); const nextServers = data.map(toServerProfile); const active = nextServers.find((server) => server.online) ?? null;
      setServers(nextServers); setConnectedId(active?.id ?? null); setSelectedId(active?.id ?? null);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "加载服务器失败"); setServers([]); setConnectedId(null); setSelectedId(null); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadConnections(); }, [loadConnections]);
  const selectServer = (id: string) => setSelectedId(id);
  const connectServer = async (id: string) => {
    if (connectingId || disconnectingId) return; const server = servers.find((item) => item.id === id); if (!server) return; setSelectedId(id);
    if (connectedId === id) return;
    setConnectingId(id);
    try {
      if (connectedId) await sshApi.disconnect(connectedId);
      await sshApi.connect(id); setServers((current) => current.map((item) => ({ ...item, online: item.id === id }))); setConnectedId(id); notify(`已连接 ${server.user}@${server.name}`);
    } catch (error) { setServers((current) => current.map((item) => ({ ...item, online: false }))); setConnectedId(null); notify(error instanceof Error ? error.message : "SSH 连接失败"); }
    finally { setConnectingId(null); }
  };
  const disconnectServer = async (id: string = connectedId ?? "") => {
    if (!id || connectingId || disconnectingId) return; const server = servers.find((item) => item.id === id); if (!server) return; setDisconnectingId(id);
    try { await sshApi.disconnect(id); setServers((current) => current.map((item) => item.id === id ? { ...item, online: false } : item)); if (connectedId === id) setConnectedId(null); notify(`已断开 ${server.user}@${server.name}`); }
    catch (error) { notify(error instanceof Error ? error.message : "断开连接失败"); }
    finally { setDisconnectingId(null); }
  };
  const deleteServer = async (id: string) => {
    const server = servers.find((item) => item.id === id); if (!server || deleting) return; setDeleting(true);
    try { if (connectedId === id) await sshApi.disconnect(id); await sshApi.delete(id); setServers((current) => current.filter((item) => item.id !== id)); if (selectedId === id) setSelectedId(null); if (connectedId === id) setConnectedId(null); setDeleteServerId(null); notify("服务器已删除"); }
    catch (error) { notify(error instanceof Error ? error.message : "删除服务器失败"); }
    finally { setDeleting(false); }
  };
  const saveServer = async (data: Omit<ServerProfile, "id" | "online">) => {
    const payload: SshConnectionPayload = { connectionId: dialogServer?.id, connectionName: data.name, host: data.host, port: data.port, username: data.user, authType: data.authType, password: data.authType === 1 ? data.password || undefined : undefined, privateKey: data.authType === 2 ? data.privateKey || undefined : undefined, userId: "default" };
    try {
      const saved = dialogServer ? await sshApi.update(payload) : await sshApi.create(payload); const profile = toServerProfile(saved);
      setServers((current) => dialogServer ? current.map((server) => server.id === dialogServer.id ? profile : server) : [...current, profile]); setSelectedId(profile.id); if (dialogServer?.id === connectedId && !profile.online) setConnectedId(null); setDialogServer(undefined); notify(dialogServer ? "服务器配置已更新" : "服务器已创建");
    } catch (error) { notify(error instanceof Error ? error.message : "保存服务器失败"); }
  };
  const effectiveTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme;
  const shellClass = `app-shell ${effectiveTheme}-theme${chatVisible ? "" : " chat-hidden"}`;
  return <div className={shellClass}>
    <ActivityRail chatVisible={chatVisible} onToggleChat={toggleChat} onOpenSettings={() => setSettingsOpen(true)} />
    <ServerSidebar servers={servers} selectedId={selectedId} connectingId={connectingId} disconnectingId={disconnectingId} loading={loading} error={loadError} onRetry={loadConnections} onSelect={selectServer} onConnect={connectServer} onDisconnect={disconnectServer} onAdd={() => setDialogServer(null)} onEdit={setDialogServer} onDelete={setDeleteServerId} />
    <TerminalWorkspace server={connectedServer} chatVisible={chatVisible} disconnecting={Boolean(disconnectingId)} lightMode={effectiveTheme === "light"} onToggleChat={toggleChat} onDisconnect={() => void disconnectServer()} notify={notify} />
    {chatVisible ? <ChatPanel server={connectedServer} onClose={toggleChat} notify={notify} /> : null}
    {dialogServer !== undefined ? <ServerDialog server={dialogServer} onClose={() => setDialogServer(undefined)} onSave={saveServer} /> : null}
    {deleteTarget ? <DeleteServerDialog server={deleteTarget} deleting={deleting} onClose={() => setDeleteServerId(null)} onConfirm={() => void deleteServer(deleteTarget.id)} /> : null}
    {settingsOpen ? <SettingsDialog theme={theme} onThemeChange={updateTheme} onClose={() => setSettingsOpen(false)} /> : null}
    {toast ? <div className="toast" role="status"><Check size={14} />{toast}</div> : null}
  </div>;
}

export default App;
