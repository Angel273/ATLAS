'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Send,
  Plus,
  Bot,
  User,
  ShieldCheck,
  Clock,
  Database,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  Hash,
  Terminal,
  FileSpreadsheet,
} from 'lucide-react';
import { AppHeader } from '../../../components/app-header';
import { api } from '../../../lib/api';
import {
  sessionSchema,
  conversationListSchema,
  conversationDetailSchema,
  conversationSchema,
  type Session,
  type Conversation,
  type ConversationMessage,
  type ToolExecution,
  type GroundingCitation,
} from '@atlas/contracts';

function formatLineContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          style={{
            background: 'var(--surface-muted)',
            padding: '1px 5px',
            borderRadius: '3px',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '12px',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

const SUGGESTED_PROMPTS = [
  {
    title: 'Desempeño de FCR',
    prompt: '¿Cuál es el desempeño y cumplimiento de meta del FCR en los últimos 30 días?',
    icon: GitBranch,
  },
  {
    title: 'Estructura de Workforce',
    prompt: '¿Cómo se distribuyen los agentes entre equipos y cuántos colaboradores activos tenemos?',
    icon: User,
  },
  {
    title: 'KPIs con Metas Críticas',
    prompt: '¿Qué métricas y KPIs gobernados tienen metas críticas no cumplidas en el catálogo?',
    icon: AlertCircle,
  },
  {
    title: 'Relaciones y Tablas',
    prompt: '¿Cuáles son las relaciones semánticas activas entre datasets en nuestra organización?',
    icon: Database,
  },
];

export default function ChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  // Conversations
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [inputPrompt, setInputPrompt] = useState('');
  const [activeModel, setActiveModel] = useState<string>('Google Gemini');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadSession() {
      try {
        const s = await api('/auth/session', sessionSchema);
        setSession(s);
        await loadConversations();
        fetch('/api/v1/conversations/info/model', { credentials: 'same-origin' })
          .then(res => res.json())
          .then(data => {
            if (data?.model) setActiveModel(data.model);
          })
          .catch(() => {});
      } catch {
        router.replace('/login');
      } finally {
        setLoadingSession(false);
      }
    }
    void loadSession();
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function loadConversations() {
    try {
      const data = await api('/conversations', conversationListSchema);
      const items = data.items || [];
      setConversations(items);
      if (items.length > 0 && items[0] && !activeConversationId) {
        void selectConversation(items[0].id);
      }
    } catch (err) {
      console.error('Error cargando conversaciones:', err);
    }
  }

  async function selectConversation(id: string) {
    setActiveConversationId(id);
    setLoadingChat(true);
    try {
      const data = await api(`/conversations/${id}`, conversationDetailSchema);
      setMessages(data.messages || []);
      setToolExecutions(data.toolExecutions || []);
    } catch (err) {
      console.error('Error cargando mensajes:', err);
    } finally {
      setLoadingChat(false);
    }
  }

  async function handleNewConversation() {
    try {
      const created = await api('/conversations', conversationSchema, {
        method: 'POST',
        body: JSON.stringify({ title: 'Nueva consulta operacional' }),
      });
      setConversations(prev => [created, ...prev]);
      setActiveConversationId(created.id);
      setMessages([]);
      setToolExecutions([]);
    } catch (err) {
      console.error('Error creando conversación:', err);
    }
  }

  async function handleSendMessage(textToSend?: string) {
    const text = (textToSend ?? inputPrompt).trim();
    if (!text || sending) return;

    let convId = activeConversationId;
    if (!convId) {
      try {
        const created = await api('/conversations', conversationSchema, {
          method: 'POST',
          body: JSON.stringify({ title: text.slice(0, 40) }),
        });
        setConversations(prev => [created, ...prev]);
        convId = created.id;
        setActiveConversationId(convId);
      } catch {
        return;
      }
    }

    // Optimistic user message
    const tempUserMsg: ConversationMessage = {
      id: `temp-${Date.now()}`,
      conversationId: convId,
      role: 'user',
      content: text,
      groundingContext: [],
      tokensUsed: 0,
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setInputPrompt('');
    setSending(true);

    try {
      const res = await fetch(`/api/v1/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ content: text }),
      });

      if (res.ok) {
        const data = await res.json();
        // Replace temp message with server response
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== tempUserMsg.id);
          return [...filtered, data.userMessage, data.assistantMessage];
        });
        // Reload details to get new toolExecutions
        const detailData = await api(`/conversations/${convId}`, conversationDetailSchema);
        setToolExecutions(detailData.toolExecutions || []);
        // update conversation in sidebar list
        setConversations(prev =>
          prev.map(c => (c.id === convId ? { ...c, title: detailData.conversation.title } : c))
        );
      } else {
        const errData = await res.json().catch(() => ({}));
        setMessages(prev => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            conversationId: convId!,
            role: 'assistant',
            content: `Error al procesar la consulta: ${errData.message || 'El servicio no está disponible.'}`,
            groundingContext: [],
            tokensUsed: 0,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          conversationId: convId!,
          role: 'assistant',
          content: 'No se pudo conectar con el servidor de inteligencia operacional.',
          groundingContext: [],
          tokensUsed: 0,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }

  function toggleSources(msgId: string) {
    setExpandedSources(prev => ({ ...prev, [msgId]: !prev[msgId] }));
  }

  function copyText(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  if (loadingSession) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '14px', color: 'var(--ink-secondary)' }}>Cargando espacio de trabajo...</span>
      </div>
    );
  }

  const activeConv = conversations.find(c => c.id === activeConversationId);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--canvas)', display: 'flex', flexDirection: 'column' }}>
      <AppHeader session={session} />

      <main style={{ flex: 1, display: 'flex', height: 'calc(100vh - 56px)', overflow: 'hidden' }}>
        {/* Sidebar: Conversations History */}
        <aside
          style={{
            width: '280px',
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
            <button
              className="button primary"
              onClick={() => { void handleNewConversation(); }}
              style={{ width: '100%', justifyContent: 'center', gap: '8px', height: '36px' }}
            >
              <Plus size={16} />
              <span>Nueva consulta</span>
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--ink-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '8px 8px 4px' }}>
              Historial de consultas
            </div>
            {conversations.length === 0 ? (
              <div style={{ padding: '16px 8px', fontSize: '13px', color: 'var(--ink-muted)', textAlign: 'center' }}>
                No hay consultas previas
              </div>
            ) : (
              conversations.map(c => {
                const isSelected = c.id === activeConversationId;
                return (
                  <button
                    key={c.id}
                    onClick={() => { void selectConversation(c.id); }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: '4px',
                      background: isSelected ? 'var(--surface-muted)' : 'transparent',
                      border: isSelected ? '1px solid var(--border)' : '1px solid transparent',
                      cursor: 'pointer',
                      marginBottom: '4px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      color: 'var(--ink)',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <div style={{ fontSize: '13px', fontWeight: isSelected ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                      {new Date(c.updatedAt).toLocaleDateString('es-ES', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Context Footer info */}
          <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'var(--canvas)', fontSize: '11px', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <ShieldCheck size={14} style={{ color: 'var(--accent)' }} />
            <span>Consultas aisladas por tenant · Solo lectura</span>
          </div>
        </aside>

        {/* Main Chat Area */}
        <section style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--canvas)' }}>
          {/* Header Bar */}
          <div
            style={{
              padding: '12px 24px',
              borderBottom: '1px solid var(--border)',
              background: 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                <Sparkles size={16} />
              </div>
              <div>
                <h1 style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontSize: '18px', fontWeight: 600, color: 'var(--ink)', margin: 0, lineHeight: 1.2 }}>
                  {activeConv ? activeConv.title : 'Asistente Operacional de Inteligencia'}
                </h1>
                <span style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
                  Fundamentado en KPIs gobernados, catálogo semántico y estructura de workforce
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <span className="badge positive" style={{ fontSize: '11px' }}>
                Modelo: {activeModel}
              </span>
              <span className="badge" style={{ fontSize: '11px', background: 'var(--surface-muted)' }}>
                Solo lectura
              </span>
            </div>
          </div>

          {/* Messages Stream */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {messages.length === 0 && !loadingChat ? (
              <div style={{ maxWidth: '800px', margin: '40px auto 0', width: '100%' }}>
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
                    <Bot size={26} />
                  </div>
                  <h2 style={{ fontFamily: 'var(--font-serif, Georgia, serif)', fontSize: '26px', color: 'var(--ink)', margin: '0 0 8px' }}>
                    ¿En qué puedo asistirte hoy?
                  </h2>
                  <p style={{ fontSize: '14px', color: 'var(--ink-secondary)', maxWidth: '560px', margin: '0 auto' }}>
                    Analiza el rendimiento de tus campañas, cumplimiento de metas de KPIs, linaje de datos y estructura de agentes mediante consultas auditadas.
                  </p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                  {SUGGESTED_PROMPTS.map((p, idx) => {
                    const Icon = p.icon;
                    return (
                      <button
                        key={idx}
                        onClick={() => { void handleSendMessage(p.prompt); }}
                        className="card"
                        style={{
                          textAlign: 'left',
                          padding: '16px',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                          background: 'var(--surface)',
                          transition: 'border-color 0.15s ease, transform 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontWeight: 600, fontSize: '13px' }}>
                          <Icon size={16} />
                          <span>{p.title}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.4 }}>
                          {p.prompt}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              messages.map(msg => {
                const isUser = msg.role === 'user';
                const hasSources = msg.groundingContext && msg.groundingContext.length > 0;
                const isExpanded = expandedSources[msg.id];

                return (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      gap: '12px',
                      maxWidth: isUser ? '75%' : '85%',
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                    }}
                  >
                    {!isUser && (
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '4px',
                          background: 'var(--accent)',
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: '2px',
                        }}
                      >
                        <Bot size={18} />
                      </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                      <div
                        style={{
                          padding: '16px 20px',
                          borderRadius: '6px',
                          background: isUser ? 'var(--accent)' : 'var(--surface)',
                          color: isUser ? '#fff' : 'var(--ink)',
                          border: isUser ? 'none' : '1px solid var(--border)',
                          fontSize: '14px',
                          lineHeight: 1.6,
                          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                        }}
                      >
                        {/* Render markdown-like sections for assistant */}
                        {!isUser ? (
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {msg.content.split('\n').map((line, idx) => {
                              if (line.startsWith('### ')) {
                                return (
                                  <h4
                                    key={idx}
                                    style={{
                                      fontFamily: 'var(--font-serif, Georgia, serif)',
                                      fontSize: '15px',
                                      fontWeight: 700,
                                      color: 'var(--accent)',
                                      margin: '16px 0 6px',
                                      borderBottom: '1px solid var(--border)',
                                      paddingBottom: '4px',
                                    }}
                                  >
                                    {line.replace('### ', '')}
                                  </h4>
                                );
                              }
                              if (line.startsWith('- ') || line.startsWith('* ')) {
                                return (
                                  <div key={idx} style={{ paddingLeft: '12px', marginBottom: '4px' }}>
                                    • {formatLineContent(line.slice(2))}
                                  </div>
                                );
                              }
                              return (
                                <div key={idx} style={{ marginBottom: line ? '4px' : '8px' }}>
                                  {formatLineContent(line)}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                        )}

                        {/* Grounding & Context Drawer for Assistant Responses */}
                        {!isUser && (hasSources || toolExecutions.length > 0) && (
                          <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                            <button
                              onClick={() => toggleSources(msg.id)}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                                fontWeight: 600,
                                color: 'var(--accent)',
                                cursor: 'pointer',
                              }}
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span>Fuentes y evidencia gobernada ({msg.groundingContext?.length || 0} referencias)</span>
                            </button>

                            {isExpanded && (
                              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {msg.groundingContext?.map((cite, cIdx) => (
                                  <div
                                    key={cIdx}
                                    style={{
                                      padding: '8px 12px',
                                      borderRadius: '4px',
                                      background: 'var(--surface-muted)',
                                      border: '1px solid var(--border)',
                                      fontSize: '12px',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                    }}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      {cite.factType === 'fact' && <FileSpreadsheet size={14} style={{ color: 'var(--accent)' }} />}
                                      {cite.factType === 'calculation' && <GitBranch size={14} style={{ color: 'var(--positive)' }} />}
                                      {cite.factType === 'structure' && <User size={14} style={{ color: 'var(--warning)' }} />}
                                      <span style={{ fontWeight: 600 }}>{cite.title}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '6px', fontSize: '11px', color: 'var(--ink-muted)' }}>
                                      {cite.kpiSlug && <span>Slug: <code>{cite.kpiSlug}</code></span>}
                                      {cite.queryHash && (
                                        <span title={cite.queryHash}>
                                          Hash: <code>{cite.queryHash.slice(0, 8)}</code>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}

                                {toolExecutions.length > 0 && (
                                  <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--ink-secondary)' }}>
                                    <strong>Herramientas ejecutadas en este hilo:</strong>{' '}
                                    {toolExecutions.map((t, tIdx) => (
                                      <span
                                        key={tIdx}
                                        style={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '4px',
                                          marginRight: '6px',
                                          padding: '2px 6px',
                                          borderRadius: '3px',
                                          background: 'var(--canvas)',
                                          border: '1px solid var(--border)',
                                        }}
                                      >
                                        <Terminal size={10} />
                                        <code>{t.toolName}</code> ({t.durationMs}ms)
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Footer actions for assistant message */}
                      {!isUser && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingLeft: '4px', fontSize: '11px', color: 'var(--ink-muted)' }}>
                          <button
                            onClick={() => copyText(msg.id, msg.content)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              color: 'var(--ink-secondary)',
                            }}
                          >
                            {copiedId === msg.id ? <Check size={12} style={{ color: 'var(--positive)' }} /> : <Copy size={12} />}
                            <span>{copiedId === msg.id ? 'Copiado' : 'Copiar'}</span>
                          </button>
                          <span>·</span>
                          <span>Tokens: {msg.tokensUsed}</span>
                          <span>·</span>
                          <span>{new Date(msg.createdAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                      )}
                    </div>

                    {isUser && (
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '4px',
                          background: 'var(--surface-muted)',
                          color: 'var(--ink)',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          marginTop: '2px',
                        }}
                      >
                        <User size={18} />
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {sending && (
              <div style={{ display: 'flex', gap: '12px', maxWidth: '85%', alignSelf: 'flex-start' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '4px', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={18} />
                </div>
                <div style={{ padding: '14px 20px', borderRadius: '6px', background: 'var(--surface)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--ink-secondary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={16} className="spin" style={{ color: 'var(--accent)' }} />
                  <span>Consultando modelo semántico y ejecutando herramientas de análisis gobernadas...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Box Area */}
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div
              style={{
                maxWidth: '960px',
                margin: '0 auto',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                background: 'var(--canvas)',
                display: 'flex',
                alignItems: 'flex-end',
                padding: '8px 12px',
                gap: '8px',
                boxShadow: '0 2px 6px rgba(0,0,0,0.03)',
              }}
            >
              <textarea
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pregunta sobre métricas, FCR, distribución de agentes, metas operacionales... (Enter para enviar, Shift+Enter para salto de línea)"
                rows={2}
                disabled={sending}
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  resize: 'none',
                  fontFamily: 'inherit',
                  fontSize: '14px',
                  lineHeight: 1.5,
                  color: 'var(--ink)',
                  padding: '4px',
                }}
              />
              <button
                className="button primary"
                onClick={() => { void handleSendMessage(); }}
                disabled={!inputPrompt.trim() || sending}
                style={{ height: '36px', width: '36px', padding: 0, justifyContent: 'center', borderRadius: '4px', flexShrink: 0 }}
                aria-label="Enviar pregunta"
              >
                <Send size={15} />
              </button>
            </div>
            <div style={{ maxWidth: '960px', margin: '6px auto 0', fontSize: '11px', color: 'var(--ink-muted)', textAlign: 'center' }}>
              Las respuestas son generadas consultando exclusivamente los datos y definiciones publicadas de la organización.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
