import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  createPeerOffer,
  acceptPeerOfferAndCreateAnswer,
  applyPeerAnswer,
  PeerConnection,
} from '../services/p2p';
import { QRCodeDisplay } from './QRCodeDisplay';
import { QRScannerModal } from './QRScannerModal';
import {
  Radio,
  QrCode,
  Camera,
  CheckCircle2,
  X,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface ConnectPeerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ConnectPeerModal: React.FC<ConnectPeerModalProps> = ({ isOpen, onClose }) => {
  const { session, mesh, showToast } = useApp();

  const [mode, setMode] = useState<'select' | 'create_offer' | 'scan_offer' | 'show_answer' | 'scan_answer'>('select');
  const [createdOffer, setCreatedOffer] = useState<string>('');
  const [createdAnswer, setCreatedAnswer] = useState<string>('');
  const [pendingInitiatorPeer, setPendingInitiatorPeer] = useState<PeerConnection | null>(null);

  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerPurpose, setScannerPurpose] = useState<'offer' | 'answer'>('offer');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectedPeerName, setConnectedPeerName] = useState<string | null>(null);

  if (!isOpen || !session) return null;

  const resetState = () => {
    setMode('select');
    setCreatedOffer('');
    setCreatedAnswer('');
    setPendingInitiatorPeer(null);
    setScannerOpen(false);
    setError(null);
    setConnectedPeerName(null);
  };

  const handleClose = () => {
    if (pendingInitiatorPeer && mode !== 'create_offer') {
      pendingInitiatorPeer.close();
    }
    resetState();
    onClose();
  };

  // Step 1A: User creates Offer
  const startCreateOffer = async () => {
    setError(null);
    setLoading(true);
    try {
      const { peer, offerCompressed } = await createPeerOffer(
        {
          id: session.userId,
          displayName: session.displayName,
          publicKeyJwk: session.publicKeyJwk,
          publicKeyId: session.publicKeyId,
        },
        (msg) => mesh?.handleIncomingWireMessage(msg, peer.id),
        (status) => {
          if (status === 'connected') {
            showToast(`Connected with ${peer.name}!`, 'success');
            setConnectedPeerName(peer.name);
          }
        }
      );

      setPendingInitiatorPeer(peer);
      setCreatedOffer(offerCompressed);
      setMode('create_offer');
    } catch (err: any) {
      setError(err.message || 'Failed to create invite');
    } finally {
      setLoading(false);
    }
  };

  // Step 1B: User accepts Offer
  const handleOfferScannedOrPasted = async (offerData: string) => {
    setError(null);
    setLoading(true);
    try {
      const { peer, answerCompressed, offerSenderName } = await acceptPeerOfferAndCreateAnswer(
        offerData,
        {
          id: session.userId,
          displayName: session.displayName,
          publicKeyJwk: session.publicKeyJwk,
          publicKeyId: session.publicKeyId,
        },
        (msg) => mesh?.handleIncomingWireMessage(msg, peer.id),
        (status) => {
          if (status === 'connected') {
            showToast(`Connected with ${peer.name}!`, 'success');
            setConnectedPeerName(peer.name);
          }
        }
      );

      // Register peer with mesh
      mesh?.addDirectPeer(peer);
      setCreatedAnswer(answerCompressed);
      setConnectedPeerName(offerSenderName);
      setMode('show_answer');
    } catch (err: any) {
      setError(err.message || 'Invalid invite data');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Initiator completes with Answer
  const handleAnswerScannedOrPasted = async (answerData: string) => {
    if (!pendingInitiatorPeer) {
      setError('Connection context lost. Please try again.');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const { answerSenderName } = await applyPeerAnswer(pendingInitiatorPeer, answerData);

      // Register peer with mesh
      mesh?.addDirectPeer(pendingInitiatorPeer);
      setConnectedPeerName(answerSenderName);
      showToast(`Connected with ${answerSenderName}!`, 'success');
      setPendingInitiatorPeer(null);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Invalid answer data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col text-slate-100">
          {/* Header */}
          <div className="flex items-center justify-between p-5 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                <Radio className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">P2P Mesh Connector</h2>
                <p className="text-xs text-slate-400">Offline WebRTC direct link (zero server)</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6">
            {error && (
              <div className="mb-4 flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
                <span>{error}</span>
              </div>
            )}

            {/* Mode Select */}
            {mode === 'select' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Connect two devices directly over local Wi-Fi or phone hotspot. One device taps
                  <strong className="text-white"> Create Invite</strong>, and the other taps
                  <strong className="text-white"> Join / Accept Invite</strong>.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={startCreateOffer}
                    disabled={loading}
                    className="p-5 rounded-2xl bg-gradient-to-br from-emerald-600/20 to-teal-600/10 border border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-600/30 transition text-left flex flex-col justify-between group cursor-pointer"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center mb-3 group-hover:scale-105 transition">
                        <QrCode className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Create Invite</h4>
                      <p className="text-xs text-slate-400 mt-1">
                        Show a QR code for your peer to scan with their camera.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center text-xs font-semibold text-emerald-400 gap-1 group-hover:translate-x-1 transition">
                      <span>Generate QR</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setScannerPurpose('offer');
                      setScannerOpen(true);
                    }}
                    disabled={loading}
                    className="p-5 rounded-2xl bg-gradient-to-br from-cyan-600/20 to-blue-600/10 border border-cyan-500/30 hover:border-cyan-500/60 hover:bg-cyan-600/30 transition text-left flex flex-col justify-between group cursor-pointer"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-cyan-500 text-slate-950 flex items-center justify-center mb-3 group-hover:scale-105 transition">
                        <Camera className="w-5 h-5" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">Join / Accept Invite</h4>
                      <p className="text-xs text-slate-400 mt-1">
                        Scan your peer's invite QR code or paste their invite blob.
                      </p>
                    </div>
                    <div className="mt-4 flex items-center text-xs font-semibold text-cyan-400 gap-1 group-hover:translate-x-1 transition">
                      <span>Scan Camera</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Mode: Create Offer (Waiting for Peer to Scan) */}
            {mode === 'create_offer' && (
              <div className="flex flex-col items-center text-center">
                <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-2">
                  Step 1 of 2
                </span>
                <h3 className="text-base font-bold text-white">Have Peer Scan this Invite</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4 max-w-sm">
                  Your peer opens MeshChat, taps "Join / Accept Invite", and scans this QR code:
                </p>

                <QRCodeDisplay data={createdOffer} size={220} />

                <div className="mt-6 w-full pt-4 border-t border-slate-800 flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setScannerPurpose('answer');
                      setScannerOpen(true);
                    }}
                    className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-semibold text-xs text-white transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/30"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Step 2: Scan Peer's Return Answer</span>
                  </button>
                  <button
                    onClick={resetState}
                    className="py-1.5 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Mode: Show Answer (Responder returns answer to Initiator) */}
            {mode === 'show_answer' && (
              <div className="flex flex-col items-center text-center">
                <span className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 mb-2">
                  Step 2 of 2
                </span>
                <h3 className="text-base font-bold text-white">Show this Answer to your Peer</h3>
                <p className="text-xs text-slate-400 mt-1 mb-4 max-w-sm">
                  Have {connectedPeerName || 'your peer'} scan this QR code on their screen:
                </p>

                <QRCodeDisplay data={createdAnswer} size={220} />

                {connectedPeerName && (
                  <div className="mt-4 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>Paired with {connectedPeerName}. Awaiting final handshake...</span>
                  </div>
                )}

                <div className="mt-5 w-full pt-4 border-t border-slate-800">
                  <button
                    onClick={handleClose}
                    className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* QR Scanner Modal */}
      <QRScannerModal
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title={scannerPurpose === 'offer' ? 'Scan Peer Invite QR' : "Scan Peer's Answer QR"}
        description={
          scannerPurpose === 'offer'
            ? 'Scan your peer’s invite QR code to accept connection'
            : 'Scan your peer’s answer QR code to finalize connection'
        }
        onScan={(data) => {
          if (scannerPurpose === 'offer') {
            handleOfferScannedOrPasted(data);
          } else {
            handleAnswerScannedOrPasted(data);
          }
        }}
      />
    </>
  );
};
