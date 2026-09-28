import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { FileMessageBubble } from './FileMessageBubble';
import {
  Send,
  Paperclip,
  Shield,
  ShieldAlert,
  Users,
  Check,
  CheckCheck,
  Radio,
  Menu,
  Lock,
  ArrowDown,
  Sparkles,
} from 'lucide-react';
import { ChatMessage } from '../types';

interface ChatPaneProps {
  onOpenSidebar: () => void;
  onOpenNetwork: () => void;
}

export const ChatPane: React.FC<ChatPaneProps> = ({ onOpenSidebar, onOpenNetwork }) => {
  const {
    activeGroup,
    messages,
    sendMessage,
    sendFile,
    session,
    peers,
    connectedCount,
  } = useApp();

  const [inputVal, setInputVal] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Auto scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    scrollToBottom('auto');
  }, [activeGroup?.id]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages.length]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputVal.trim() || sending) return;

    const text = inputVal;
    setInputVal('');
    setSending(true);
    try {
      await sendMessage(text);
    } catch (err) {
      console.error('Failed to send:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    sendFile(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!activeGroup) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 bg-slate-950 text-slate-400">
        <Radio className="w-12 h-12 text-slate-400 mb-3 animate-pulse" />
        <h3 className="text-base font-semibold text-slate-200">No Group Selected</h3>
        <p className="text-xs text-slate-400 mt-1 text-center max-w-sm">
          Select a group from the sidebar or create a new private encrypted mesh room.
        </p>
        <button
          onClick={onOpenSidebar}
          className="mt-4 px-4 py-2 rounded-xl bg-slate-800 text-xs font-medium text-slate-200 md:hidden"
        >
          Open Sidebar
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden relative">
      {/* Chat Top Bar */}
      <div className="h-16 px-4 border-b border-slate-800/80 bg-slate-900/90 backdrop-blur-md flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          {/* Mobile Menu button */}
          <button
            onClick={onOpenSidebar}
            className="md:hidden p-1.5 -ml-1 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
            title="Open Groups Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Group Avatar */}
          <div
            style={{ backgroundColor: activeGroup.avatarColor || '#10b981' }}
            className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-white text-sm shadow-md"
          >
            {activeGroup.name.slice(0, 2).toUpperCase()}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white leading-tight">{activeGroup.name}</h2>
              {activeGroup.isEncrypted ? (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  title="End-to-End Encrypted with AES-GCM-256"
                >
                  <Lock className="w-2.5 h-2.5" />
                  <span>E2EE</span>
                </span>
              ) : (
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400"
                  title="Signed ECDSA P-256 Open Mesh"
                >
                  Open Mesh
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${connectedCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span>
                {connectedCount > 0
                  ? `${connectedCount} direct peer${connectedCount === 1 ? '' : 's'} connected`
                  : 'Standalone (Local DB ready)'}
              </span>
            </p>
          </div>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenNetwork}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-xs font-medium text-slate-300 transition cursor-pointer"
            title="Inspect Mesh Network"
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">Network</span>
          </button>
        </div>
      </div>

      {/* Message Feed */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {/* Security E2E Notice banner */}
        <div className="flex items-center justify-center my-2">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 text-center max-w-md shadow-sm">
            <Shield className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span>
              Messages are signed with ECDSA P-256. Verified and relayed across offline peers.
            </span>
          </div>
        </div>

        {messages.length === 0 && (
          <div className="h-64 flex flex-col items-center justify-center text-center text-slate-400">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">No messages in this group yet</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">
              Say hello or attach a file. When peers link to you, messages synchronize automatically!
            </p>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg: ChatMessage) => {
          const isMe = msg.senderId === session?.userId || msg.isOutgoing;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group`}
            >
              {/* Sender Name for incoming */}
              {!isMe && (
                <div className="flex items-center gap-1.5 ml-2 mb-1">
                  <span className="text-[11px] font-semibold text-emerald-400">
                    {msg.senderName}
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono">
                    ({msg.senderPublicKeyId?.slice(0, 6)}...)
                  </span>
                </div>
              )}

              {/* Message Bubble Container */}
              <div
                className={`max-w-[85%] sm:max-w-md rounded-2xl px-4 py-2.5 shadow-md relative ${
                  isMe
                    ? 'bg-emerald-600 text-white rounded-br-xs'
                    : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-xs'
                }`}
              >
                {/* Text Content */}
                {msg.text && (
                  <p className="text-xs sm:text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {msg.text}
                  </p>
                )}

                {/* File Attachment Bubble */}
                {msg.fileMeta && (
                  <FileMessageBubble fileMeta={msg.fileMeta} isOutgoing={isMe} />
                )}

                {/* Bubble Footer: Timestamp & Verification & Hops */}
                <div
                  className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                    isMe ? 'text-emerald-200/90' : 'text-slate-400'
                  }`}
                >
                  {msg.hopCount > 0 && (
                    <span title={`Relayed via ${msg.hopCount} mesh hops`}>
                      {msg.hopCount} hop{msg.hopCount > 1 ? 's' : ''} •
                    </span>
                  )}
                  <span>{formatTime(msg.timestamp)}</span>
                  {isMe ? (
                    <span title={msg.relayedToCount ? `Relayed to ${msg.relayedToCount} peers` : 'Saved locally'}>
                      <CheckCheck className="w-3.5 h-3.5 text-white/90" />
                    </span>
                  ) : (
                    msg.verified && (
                      <span title="ECDSA P-256 signature verified">
                        <Check className="w-3 h-3 text-emerald-400" />
                      </span>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Composer */}
      <div className="p-3 sm:p-4 bg-slate-900/90 border-t border-slate-800/80 backdrop-blur-md">
        <form onSubmit={handleSend} className="flex items-end gap-2 max-w-4xl mx-auto">
          {/* File Attachment Button */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelected}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition flex-shrink-0 cursor-pointer border border-slate-700/60"
            title="Attach any file (images, video, audio, PDF, etc.)"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          {/* Textarea */}
          <div className="flex-1 rounded-2xl bg-slate-950 border border-slate-800 focus-within:border-emerald-500/60 focus-within:ring-1 focus-within:ring-emerald-500/30 transition px-3.5 py-2">
            <textarea
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message #${activeGroup.name}...`}
              rows={1}
              className="w-full bg-transparent text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none resize-none max-h-32"
            />
          </div>

          {/* Send Button */}
          <button
            type="submit"
            disabled={!inputVal.trim() || sending}
            className="p-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-semibold shadow-lg shadow-emerald-900/30 transition flex-shrink-0 cursor-pointer"
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
