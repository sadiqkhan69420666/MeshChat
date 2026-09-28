import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { WifiOff, Radio } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
        isOnline
          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
          : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
      }`}
      title={isOnline ? 'Online + P2P Mesh enabled' : 'Full Offline Mode — WebRTC P2P direct radio/Wi-Fi active'}
    >
      {isOnline ? (
        <>
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span>P2P Ready</span>
        </>
      ) : (
        <>
          <WifiOff className="w-3 h-3 text-amber-400" />
          <span>Offline Mesh</span>
        </>
      )}
    </div>
  );
};
