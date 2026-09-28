/**
 * MeshChat - Offline Peer-to-Peer Mesh Group Chat Application
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthScreen } from './components/AuthScreen';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/ChatPane';
import { NetworkView } from './components/NetworkView';
import { ConnectPeerModal } from './components/ConnectPeerModal';
import { CreateGroupModal, JoinGroupModal } from './components/GroupModals';
import { SettingsModal } from './components/SettingsModal';
import { Radio, CheckCircle, AlertTriangle, Info, X } from 'lucide-react';

const MainLayout: React.FC = () => {
  const { session, isLoadingAuth, toast } = useApp();

  const [currentView, setCurrentView] = useState<'chat' | 'network'>('chat');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Modals
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [joinGroupModalOpen, setJoinGroupModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);

  if (isLoadingAuth) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-white">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 p-0.5 animate-pulse mb-3">
          <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
            <Radio className="w-6 h-6 text-emerald-400" />
          </div>
        </div>
        <h2 className="text-base font-bold tracking-tight">Initializing MeshChat...</h2>
        <p className="text-xs text-slate-400 mt-1">Opening encrypted local vault</p>
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Desktop Sidebar (hidden on mobile) */}
      <div className="hidden md:flex flex-shrink-0 h-full">
        <Sidebar
          currentView={currentView}
          setCurrentView={setCurrentView}
          onOpenConnectModal={() => setConnectModalOpen(true)}
          onOpenCreateGroupModal={() => setCreateGroupModalOpen(true)}
          onOpenJoinGroupModal={() => setJoinGroupModalOpen(true)}
          onOpenSettingsModal={() => setSettingsModalOpen(true)}
        />
      </div>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-50 w-80 max-w-[85vw] h-full shadow-2xl">
            <Sidebar
              currentView={currentView}
              setCurrentView={setCurrentView}
              onOpenConnectModal={() => {
                setMobileSidebarOpen(false);
                setConnectModalOpen(true);
              }}
              onOpenCreateGroupModal={() => {
                setMobileSidebarOpen(false);
                setCreateGroupModalOpen(true);
              }}
              onOpenJoinGroupModal={() => {
                setMobileSidebarOpen(false);
                setJoinGroupModalOpen(true);
              }}
              onOpenSettingsModal={() => {
                setMobileSidebarOpen(false);
                setSettingsModalOpen(true);
              }}
              onCloseMobileSidebar={() => setMobileSidebarOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full min-w-0 overflow-hidden relative">
        {currentView === 'chat' ? (
          <ChatPane
            onOpenSidebar={() => setMobileSidebarOpen(true)}
            onOpenNetwork={() => setCurrentView('network')}
          />
        ) : (
          <NetworkView
            onOpenConnectModal={() => setConnectModalOpen(true)}
          />
        )}
      </main>

      {/* Modals */}
      <ConnectPeerModal
        isOpen={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
      />

      <CreateGroupModal
        isOpen={createGroupModalOpen}
        onClose={() => setCreateGroupModalOpen(false)}
      />

      <JoinGroupModal
        isOpen={joinGroupModalOpen}
        onClose={() => setJoinGroupModalOpen(false)}
      />

      <SettingsModal
        isOpen={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
      />

      {/* Global Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl text-xs font-medium text-slate-100 animate-in fade-in slide-in-from-bottom-3 duration-200">
          {toast.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
          {toast.type === 'warning' && <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-cyan-400 flex-shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
