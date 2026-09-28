import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Radio,
  Plus,
  Wifi,
  Shield,
  Activity,
  ArrowUpRight,
  ArrowDownLeft,
  Info,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { PeerInfo } from '../types';

interface NetworkViewProps {
  onOpenConnectModal: () => void;
}

export const NetworkView: React.FC<NetworkViewProps> = ({ onOpenConnectModal }) => {
  const { session, peers, mesh, showToast } = useApp();
  const [selectedPeer, setSelectedPeer] = useState<PeerInfo | null>(null);

  const directPeers = peers.filter((p) => p.direct && p.status === 'connected');
  const indirectPeers = peers.filter((p) => !p.direct);

  const handleRefreshGossip = () => {
    mesh?.sendPeerGossip();
    showToast('Sent peer discovery gossip', 'info');
  };

  const handleDisconnect = (peerId: string) => {
    mesh?.removeDirectPeer(peerId);
    showToast('Peer disconnected', 'info');
  };

  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-950 p-4 sm:p-6 text-slate-100">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white">Mesh Network Topology</h1>
            <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              {directPeers.length} Direct Peer{directPeers.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Gossip-routed peer graph. Messages flood across peers automatically with loop prevention.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleRefreshGossip}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 transition cursor-pointer"
            title="Broadcast peer list gossip"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
            <span>Discover Peers</span>
          </button>
          <button
            onClick={onOpenConnectModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white shadow-lg shadow-emerald-900/30 transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Peer</span>
          </button>
        </div>
      </div>

      {/* Visual Topology Canvas */}
      <div className="mt-6 rounded-3xl bg-slate-900/80 border border-slate-800 p-6 overflow-hidden relative shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>Live Mesh Map</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <span>You (Hub)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-400" />
              <span>Direct Link</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
              <span>Relayed (Multi-hop)</span>
            </div>
          </div>
        </div>

        {/* SVG Mesh Diagram */}
        <div className="relative w-full h-64 sm:h-80 flex items-center justify-center bg-slate-950/60 rounded-2xl border border-slate-800/80 overflow-hidden">
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 600 300">
            <defs>
              <linearGradient id="linkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>

            {/* Central Node is at (300, 150) */}
            {peers.map((peer, idx) => {
              const total = Math.max(1, peers.length);
              const angle = (idx * 2 * Math.PI) / total;
              const radius = peer.direct ? 100 : 130;
              const x = 300 + radius * Math.cos(angle);
              const y = 150 + radius * Math.sin(angle);

              return (
                <g key={peer.id}>
                  <line
                    x1="300"
                    y1="150"
                    x2={x}
                    y2={y}
                    stroke={peer.direct ? 'url(#linkGrad)' : '#6366f1'}
                    strokeWidth={peer.direct ? '2.5' : '1.5'}
                    strokeDasharray={peer.direct ? 'none' : '4 4'}
                    opacity={peer.status === 'connected' ? 0.7 : 0.2}
                  />
                  {peer.direct && peer.rttMs && (
                    <text
                      x={(300 + x) / 2}
                      y={(150 + y) / 2 - 6}
                      fill="#94a3b8"
                      fontSize="9"
                      textAnchor="middle"
                      fontFamily="monospace"
                    >
                      {peer.rttMs}ms
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Center Hub Node (Self) */}
          <div className="absolute z-10 flex flex-col items-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-0.5 shadow-xl shadow-emerald-500/20">
              <div className="w-full h-full bg-slate-900 rounded-[14px] flex items-center justify-center">
                <Shield className="w-6 h-6 text-emerald-400" />
              </div>
            </div>
            <span className="mt-1 text-[11px] font-bold text-white bg-slate-900/90 px-2 py-0.5 rounded-full border border-slate-800">
              {session?.displayName} (You)
            </span>
          </div>

          {/* Satellite Peer Nodes */}
          {peers.map((peer, idx) => {
            const total = Math.max(1, peers.length);
            const angle = (idx * 2 * Math.PI) / total;
            const radius = peer.direct ? 100 : 130;
            // Center is at 50% / 50%
            const leftPct = 50 + (radius / 300) * 50 * Math.cos(angle);
            const topPct = 50 + (radius / 150) * 45 * Math.sin(angle);

            return (
              <div
                key={peer.id}
                onClick={() => setSelectedPeer(peer)}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  transform: 'translate(-50%, -50%)',
                }}
                className={`absolute z-20 cursor-pointer p-1.5 rounded-2xl transition hover:scale-110 ${
                  peer.direct
                    ? 'bg-slate-900 border-2 border-cyan-500/60 shadow-lg shadow-cyan-500/20'
                    : 'bg-slate-900 border-2 border-dashed border-indigo-500/60'
                }`}
                title={`Click to inspect ${peer.name}`}
              >
                <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center font-bold text-xs text-white">
                  {peer.name.slice(0, 2).toUpperCase()}
                </div>
              </div>
            );
          })}

          {peers.length === 0 && (
            <div className="absolute z-10 text-center p-4">
              <Radio className="w-8 h-8 text-slate-400 mx-auto mb-2 animate-pulse" />
              <p className="text-xs text-slate-300 font-medium">No peers connected yet</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Tap "Connect Peer" to link with a nearby phone or laptop offline.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Selected Peer Inspector Modal or Card */}
      {selectedPeer && (
        <div className="mt-4 p-4 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold">
              {selectedPeer.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">{selectedPeer.name}</h4>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    selectedPeer.direct
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  }`}
                >
                  {selectedPeer.direct ? 'Direct (1 hop)' : `${selectedPeer.hops} hops`}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">
                Key ID: {selectedPeer.publicKeyId || 'Unknown'} {selectedPeer.rttMs ? `• Ping: ${selectedPeer.rttMs}ms` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {selectedPeer.direct && (
              <button
                onClick={() => handleDisconnect(selectedPeer.id)}
                className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/20 cursor-pointer"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={() => setSelectedPeer(null)}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Peer Cards Grid */}
      <div className="mt-6">
        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
          <span>Connected & Reachable Nodes</span>
          <span className="text-xs font-normal text-slate-400">({peers.length})</span>
        </h3>

        {peers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-400">
            <Wifi className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-300">Your node is currently standalone</p>
            <p className="text-[11px] text-slate-400 mt-1 max-w-sm mx-auto">
              Any messages you send are saved locally and will automatically flood to peers once you connect.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {peers.map((peer) => (
              <div
                key={peer.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-slate-800 text-slate-200 flex items-center justify-center font-bold text-xs">
                      {peer.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-white">{peer.name}</h4>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {peer.publicKeyId ? `ID: ${peer.publicKeyId.slice(0, 10)}...` : 'Node ID: ' + peer.id.slice(0, 8)}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                      peer.status === 'connected'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {peer.status}
                  </span>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-800/80 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                  <div>
                    <span className="text-slate-400 block text-[10px]">Route:</span>
                    <span className="font-semibold text-slate-300">
                      {peer.direct ? 'Direct Link' : `${peer.hops} Hops away`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px]">Latency:</span>
                    <span className="font-semibold text-slate-300">
                      {peer.rttMs ? `${peer.rttMs} ms` : 'Local radio'}
                    </span>
                  </div>
                </div>

                {peer.direct && (
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                      {(peer.bytesSent / 1024).toFixed(1)} KB sent
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowDownLeft className="w-3 h-3 text-cyan-400" />
                      {(peer.bytesReceived / 1024).toFixed(1)} KB rcvd
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Offline P2P Instructions Accordion */}
      <div className="mt-8 rounded-3xl bg-slate-900/60 border border-slate-800 p-5">
        <h3 className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-emerald-400" />
          <span>How to Link Devices Fully Offline</span>
        </h3>
        <div className="space-y-2 text-xs text-slate-400 leading-relaxed">
          <p>
            1. <strong className="text-slate-200">Local Radio:</strong> Ensure both phones or laptops are on the same Wi-Fi network, or one device turns on a portable Wi-Fi Hotspot and the other joins it. <span className="text-emerald-400">(Internet connection is NOT required!).</span>
          </p>
          <p>
            2. <strong className="text-slate-200">Generate Invite:</strong> Tap <strong className="text-white">Connect Peer &gt; Create Invite</strong> on Device A. A QR code is generated containing the self-contained WebRTC offer.
          </p>
          <p>
            3. <strong className="text-slate-200">Scan &amp; Pair:</strong> Tap <strong className="text-white">Join / Accept Invite</strong> on Device B and scan Device A's screen. Then show the return QR to Device A.
          </p>
          <p>
            4. <strong className="text-slate-200">Mesh Forwarding:</strong> Once connected, every message sent in any group is flood-routed across all linked nodes, and catching up is automated via IndexedDB store-and-forward sync!
          </p>
        </div>
      </div>
    </div>
  );
};
