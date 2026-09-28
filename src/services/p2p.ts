/**
 * MeshChat P2P WebRTC Layer
 * Handles serverless manual signaling, ICE candidate completion,
 * data channel management, and backpressure control.
 */

import {
  SignalingOfferPayload,
  SignalingAnswerPayload,
  WireMessage,
  PeerInfo,
} from '../types';
import { bufferToBase64, base64ToBuffer } from './crypto';

// Fast deflate compression for QR codes & invite blobs
export async function compressSignalingData(str: string): Promise<string> {
  try {
    if (typeof CompressionStream !== 'undefined') {
      const stream = new Blob([new TextEncoder().encode(str)])
        .stream()
        .pipeThrough(new CompressionStream('deflate'));
      const buffer = await new Response(stream).arrayBuffer();
      return 'MC1:' + bufferToBase64(new Uint8Array(buffer));
    }
  } catch (err) {
    console.warn('CompressionStream error, fallback to btoa', err);
  }
  return 'MC0:' + btoa(unescape(encodeURIComponent(str)));
}

export async function decompressSignalingData(data: string): Promise<string> {
  const trimmed = data.trim();
  if (trimmed.startsWith('MC1:')) {
    const raw = base64ToBuffer(trimmed.slice(4));
    const stream = new Blob([raw as any])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'));
    return await new Response(stream).text();
  }
  if (trimmed.startsWith('MC0:')) {
    return decodeURIComponent(escape(atob(trimmed.slice(4))));
  }
  // Try raw base64 or raw string
  try {
    const decoded = atob(trimmed);
    if (decoded.startsWith('{')) return decoded;
  } catch {
    // ignore
  }
  return trimmed;
}

// STUN configuration: local ICE candidates work completely offline without STUN;
// standard public STUN servers are added for situations where devices are on same LAN/WLAN.
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 2,
};

export class PeerConnection {
  public id: string; // Target Peer ID (assigned once known)
  public name: string;
  public publicKeyId: string;
  public pc: RTCPeerConnection;
  public channel: RTCDataChannel | null = null;
  public status: 'connecting' | 'connected' | 'disconnected' | 'failed' = 'connecting';
  public bytesSent = 0;
  public bytesReceived = 0;
  public rttMs?: number;
  public connectionTime?: number;
  public lastSeen: number = Date.now();

  private onMessageCallback?: (msg: WireMessage) => void;
  private onStateChangeCallback?: (status: PeerInfo['status']) => void;
  private pingInterval?: number;

  constructor(
    id: string,
    name: string,
    publicKeyId: string,
    onMessage?: (msg: WireMessage) => void,
    onStateChange?: (status: PeerInfo['status']) => void
  ) {
    this.id = id;
    this.name = name;
    this.publicKeyId = publicKeyId;
    this.onMessageCallback = onMessage;
    this.onStateChangeCallback = onStateChange;

    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.setupConnectionListeners();
  }

  private setupConnectionListeners() {
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      if (state === 'connected') {
        this.status = 'connected';
        this.connectionTime = Date.now();
        this.startPing();
      } else if (state === 'disconnected') {
        this.status = 'disconnected';
        this.stopPing();
      } else if (state === 'failed' || state === 'closed') {
        this.status = 'failed';
        this.stopPing();
      }
      this.onStateChangeCallback?.(this.status);
    };

    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      if (state === 'disconnected') {
        this.status = 'disconnected';
        this.onStateChangeCallback?.('disconnected');
      } else if (state === 'failed') {
        this.status = 'failed';
        this.onStateChangeCallback?.('failed');
      }
    };
  }

  public setupDataChannel(channel: RTCDataChannel) {
    this.channel = channel;
    this.channel.binaryType = 'arraybuffer';

    this.channel.onopen = () => {
      this.status = 'connected';
      this.connectionTime = Date.now();
      this.startPing();
      this.onStateChangeCallback?.('connected');
    };

    this.channel.onclose = () => {
      this.status = 'disconnected';
      this.stopPing();
      this.onStateChangeCallback?.('disconnected');
    };

    this.channel.onerror = (err) => {
      console.warn('Data channel error on peer', this.id, err);
    };

    this.channel.onmessage = (event) => {
      this.lastSeen = Date.now();
      try {
        let text: string;
        if (typeof event.data === 'string') {
          text = event.data;
          this.bytesReceived += text.length;
        } else if (event.data instanceof ArrayBuffer) {
          text = new TextDecoder().decode(event.data);
          this.bytesReceived += event.data.byteLength;
        } else {
          return;
        }

        const parsed: WireMessage = JSON.parse(text);

        // Handle internal ping/pong
        if (parsed.type === 'ping') {
          this.send({
            id: crypto.randomUUID(),
            type: 'pong',
            senderId: 'self',
            senderName: '',
            timestamp: parsed.timestamp,
            hopCount: 0,
            ttl: 1,
            payload: null,
          });
          return;
        }

        if (parsed.type === 'pong') {
          this.rttMs = Math.max(1, Date.now() - parsed.timestamp);
          return;
        }

        this.onMessageCallback?.(parsed);
      } catch (err) {
        console.error('Failed to parse wire message:', err);
      }
    };
  }

  public send(msg: WireMessage): boolean {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }
    try {
      const serialized = JSON.stringify(msg);
      this.channel.send(serialized);
      this.bytesSent += serialized.length;
      return true;
    } catch (err) {
      console.error('Failed to send on channel to peer', this.id, err);
      return false;
    }
  }

  /**
   * Send binary chunk with backpressure handling
   */
  public async sendWithBackpressure(data: string, maxBuffered = 65536): Promise<boolean> {
    if (!this.channel || this.channel.readyState !== 'open') {
      return false;
    }

    if (this.channel.bufferedAmount > maxBuffered) {
      await new Promise<void>((resolve) => {
        if (!this.channel) return resolve();
        this.channel.bufferedAmountLowThreshold = maxBuffered / 2;
        const handler = () => {
          if (this.channel) this.channel.onbufferedamountlow = null;
          resolve();
        };
        this.channel.onbufferedamountlow = handler;
        // Safety timeout in case callback doesn't fire
        setTimeout(() => resolve(), 500);
      });
    }

    try {
      this.channel.send(data);
      this.bytesSent += data.length;
      return true;
    } catch (err) {
      console.error('Error sending buffered chunk:', err);
      return false;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingInterval = window.setInterval(() => {
      if (this.channel && this.channel.readyState === 'open') {
        this.send({
          id: crypto.randomUUID(),
          type: 'ping',
          senderId: 'self',
          senderName: '',
          timestamp: Date.now(),
          hopCount: 0,
          ttl: 1,
          payload: null,
        });
      }
    }, 10000);
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }
  }

  public close() {
    this.stopPing();
    try {
      this.channel?.close();
    } catch {
      // ignore
    }
    try {
      this.pc.close();
    } catch {
      // ignore
    }
    this.status = 'disconnected';
  }
}

/**
 * Wait for ICE gathering to finish so SDP contains all candidates.
 * Uses a safe timeout fallback (1800ms) for speedy manual signaling.
 */
function waitForIceGatheringComplete(pc: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (pc.iceGatheringState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timer: number;

    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };

    timer = window.setTimeout(() => {
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    }, timeoutMs);

    pc.addEventListener('icegatheringstatechange', check);
  });
}

/**
 * 1. Initiator creates Offer (Creates Invite)
 */
export async function createPeerOffer(
  user: { id: string; displayName: string; publicKeyJwk: JsonWebKey; publicKeyId: string },
  onMessage?: (msg: WireMessage) => void,
  onStateChange?: (status: PeerInfo['status']) => void
): Promise<{
  peer: PeerConnection;
  offerCompressed: string;
}> {
  const tempPeerId = 'pending-' + crypto.randomUUID().slice(0, 8);
  const peer = new PeerConnection(tempPeerId, 'Connecting Peer...', '', onMessage, onStateChange);

  // Initiator creates data channel
  const channel = peer.pc.createDataChannel('meshchat_data', { ordered: true });
  peer.setupDataChannel(channel);

  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);

  // Wait for all candidates so SDP is self-contained
  await waitForIceGatheringComplete(peer.pc);

  const payload: SignalingOfferPayload = {
    version: 1,
    type: 'offer',
    sdp: peer.pc.localDescription?.sdp || offer.sdp || '',
    senderId: user.id,
    senderName: user.displayName,
    senderPublicKeyJwk: user.publicKeyJwk,
    senderPublicKeyId: user.publicKeyId,
  };

  const offerCompressed = await compressSignalingData(JSON.stringify(payload));
  return { peer, offerCompressed };
}

/**
 * 2. Responder accepts Offer and creates Answer (Join / Accept Invite)
 */
export async function acceptPeerOfferAndCreateAnswer(
  offerString: string,
  user: { id: string; displayName: string; publicKeyJwk: JsonWebKey; publicKeyId: string },
  onMessage?: (msg: WireMessage) => void,
  onStateChange?: (status: PeerInfo['status']) => void
): Promise<{
  peer: PeerConnection;
  answerCompressed: string;
  offerSenderName: string;
  offerSenderId: string;
}> {
  const decompressed = await decompressSignalingData(offerString);
  const offerPayload: SignalingOfferPayload = JSON.parse(decompressed);

  if (offerPayload.type !== 'offer' || !offerPayload.sdp) {
    throw new Error('Invalid invite offer data. Please verify the QR code or text.');
  }

  const peer = new PeerConnection(
    offerPayload.senderId,
    offerPayload.senderName,
    offerPayload.senderPublicKeyId,
    onMessage,
    onStateChange
  );

  // Responder listens for channel
  peer.pc.ondatachannel = (event) => {
    peer.setupDataChannel(event.channel);
  };

  await peer.pc.setRemoteDescription(
    new RTCSessionDescription({
      type: 'offer',
      sdp: offerPayload.sdp,
    })
  );

  const answer = await peer.pc.createAnswer();
  await peer.pc.setLocalDescription(answer);

  // Wait for ICE gathering
  await waitForIceGatheringComplete(peer.pc);

  const answerPayload: SignalingAnswerPayload = {
    version: 1,
    type: 'answer',
    sdp: peer.pc.localDescription?.sdp || answer.sdp || '',
    senderId: user.id,
    senderName: user.displayName,
    senderPublicKeyJwk: user.publicKeyJwk,
    senderPublicKeyId: user.publicKeyId,
  };

  const answerCompressed = await compressSignalingData(JSON.stringify(answerPayload));

  return {
    peer,
    answerCompressed,
    offerSenderName: offerPayload.senderName,
    offerSenderId: offerPayload.senderId,
  };
}

/**
 * 3. Initiator receives Answer and completes connection
 */
export async function applyPeerAnswer(
  peer: PeerConnection,
  answerString: string
): Promise<{ answerSenderName: string; answerSenderId: string }> {
  const decompressed = await decompressSignalingData(answerString);
  const answerPayload: SignalingAnswerPayload = JSON.parse(decompressed);

  if (answerPayload.type !== 'answer' || !answerPayload.sdp) {
    throw new Error('Invalid answer data. Please check the QR code or text.');
  }

  peer.id = answerPayload.senderId;
  peer.name = answerPayload.senderName;
  peer.publicKeyId = answerPayload.senderPublicKeyId;

  await peer.pc.setRemoteDescription(
    new RTCSessionDescription({
      type: 'answer',
      sdp: answerPayload.sdp,
    })
  );

  return {
    answerSenderName: answerPayload.senderName,
    answerSenderId: answerPayload.senderId,
  };
}
