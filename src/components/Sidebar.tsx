import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { PWAInstallButton } from './PWAInstallButton';
import { OfflineIndicator } from './OfflineIndicator';
import {
  Users,
  Radio,
  Plus,
  Settings,
  Lock,
  Copy,
  Check,
  LogOut,
  Hash,
  Share2,
  ChevronRight,
  Shield,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Group } from '../types';

interface SidebarProps {
  currentView: 'chat' | 'network';
  setCurrentView: (view: 'chat' | 'network') => void;
  onOpenConnectModal: () => void;
  onOpenCreateGroupModal: () => void;
  onOpenJoinGroupModal: () => void;
  onOpenSettingsModal: () => void;
  onCloseMobileSidebar?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  setCurrentView,
  onOpenConnectModal,
  onOpenCreateGroupModal,
  onOpenJoinGroupModal,
  onOpenSettingsModal,
  onCloseMobileSidebar,
}) => {
  const {
    session,
    groups,
    activeGroup,
    setActiveGroupId,
    connectedCount,
    logout,
    showToast,
  } = useApp();

  const [copiedKey, setCopiedKey] = useState(false);

  const copyPublicKeyId = () => {
    if (!session?.publicKeyId) return;
    navigator.clipboard.writeText(session.publicKeyId);
    setCopiedKey(true);
    showToast('Public key ID copied to clipboard', 'info');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleSelectGroup = (g: Group) => {
    setActiveGroupId(g.id);
    setCurrentView('chat');
    onCloseMobileSidebar?.();
  };

  return (
    <aside className="w-80 h-full flex flex-col bg-slate-900 border-r border-slate-800 text-slate-200 select-none">
      {/* 1. Header Profile & PWA Bar */}
      <div className="p-4 border-b border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-0.5 shadow-md">
              <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center font-bold text-white text-xs">
                {session?.displayName.slice(0, 2).toUpperCase()}
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white truncate">{session?.displayName}</h3>
              <button
                onClick={copyPublicKeyId}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-emerald-400 transition cursor-pointer font-mono"
                title="Copy ECDSA Public Key Fingerprint"
              >
                <span>ID: {session?.publicKeyId.slice(0, 8)}...</span>
                {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onOpenSettingsModal}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title="Settings & Storage"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* PWA Install Button & Offline Indicator row */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <OfflineIndicator />
          <PWAInstallButton />
        </div>
      </div>

      {/* 2. Primary Navigation Switcher */}
      <div className="p-3 border-b border-slate-800/60 bg-slate-900/60">
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800">
          <button
            onClick={() => {
              setCurrentView('chat');
              onCloseMobileSidebar?.();
            }}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              currentView === 'chat'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Groups</span>
          </button>
          <button
            onClick={() => {
              setCurrentView('network');
              onCloseMobileSidebar?.();
            }}
            className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
              currentView === 'network'
                ? 'bg-slate-800 text-white shadow'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mesh ({connectedCount})</span>
          </button>
        </div>
      </div>

      {/* 3. Group List Header */}
      <div className="px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-400">
        <div className="flex items-center gap-1.5">
          <Hash className="w-3.5 h-3.5 text-slate-400" />
          <span>ROOMS &amp; CHANNELS</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenJoinGroupModal}
            className="px-2 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 text-[11px] font-medium text-slate-300 hover:text-white transition cursor-pointer"
            title="Join existing group via invite code"
          >
            Join
          </button>
          <button
            onClick={onOpenCreateGroupModal}
            className="p-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition cursor-pointer"
            title="Create new group"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 4. Groups Scroll Container */}
      <div className="flex-1 overflow-y-auto px-2 space-y-1">
        {groups.map((group) => {
          const isActive = currentView === 'chat' && activeGroup?.id === group.id;

          return (
            <button
              key={group.id}
              onClick={() => handleSelectGroup(group)}
              className={`w-full flex items-center gap-3 p-2.5 rounded-2xl text-left transition cursor-pointer ${
                isActive
                  ? 'bg-emerald-600/15 border border-emerald-500/30 text-white shadow-sm'
                  : 'hover:bg-slate-800/60 text-slate-300 border border-transparent'
              }`}
            >
              {/* Group avatar */}
              <div
                style={{ backgroundColor: group.avatarColor || '#10b981' }}
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-xs flex-shrink-0 shadow"
              >
                {group.name.slice(0, 2).toUpperCase()}
              </div>

              {/* Group info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold truncate ${isActive ? 'text-white' : 'text-slate-200'}`}>
                    {group.name}
                  </span>
                  {group.isEncrypted && (
                    <span title="End-to-End Encrypted" className="flex items-center ml-1">
                      <Lock className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {group.description || (group.isEncrypted ? 'E2EE Encrypted room' : 'Mesh room')}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* 5. Footer: P2P Peer Quick Connect bar */}
      <div className="p-3 border-t border-slate-800 bg-slate-950/60">
        <button
          onClick={onOpenConnectModal}
          className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950 cursor-pointer"
        >
          <Radio className="w-4 h-4" />
          <span>Connect Peer (QR / Manual)</span>
        </button>
      </div>
    </aside>
  );
};
