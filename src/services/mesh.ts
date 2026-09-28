/**
 * MeshChat Mesh & Gossip Layer
 * Implements flood forwarding, signature verification, peer-list gossip,
 * deduplication, and store-and-forward synchronization.
 */

import {
  ChatMessage,
  WireMessage,
  PeerInfo,
  PeerGossipNode,
  Group,
} from '../types';
import { PeerConnection } from './p2p';
import { verifySignature, signData } from './crypto';
import {
  saveMessage,
  getMessageById,
  getAllGroupMessageSummaries,
  getMessagesByGroup,
  getPinnedIdentity,
  savePinnedIdentity,
} from './storage';

export type MeshEventHandler = (event: {
  type: 'message-received' | 'peer-status-changed' | 'peers-updated' | 'file-chunk-received';
  data: any;
}) => void;

export class MeshNetwork {
  private currentUserId: string;
  private currentDisplayName: string;
  private currentPublicKeyJwk: JsonWebKey;
  private currentPublicKeyId: string;
  private privateKey: CryptoKey | null = null;

  // Active direct WebRTC connections: peerId -> PeerConnection
  private directPeers: Map<string, PeerConnection> = new Map();

  // Mesh presence: all known peers (direct + indirect via gossip)
  private meshPeers: Map<string, PeerGossipNode> = new Map();

  // Deduplication cache: bounded set of seen message IDs
  private seenMessageIds: Set<string> = new Set();
  private maxSeenCacheSize = 5000;

  // Event subscribers
  private listeners: Set<MeshEventHandler> = new Set();

  // Gossip interval
  private gossipTimer?: number;

  constructor(user: {
    id: string;
    displayName: string;
    publicKeyJwk: JsonWebKey;
    publicKeyId: string;
    privateKey?: CryptoKey | null;
  }) {
    this.currentUserId = user.id;
    this.currentDisplayName = user.displayName;
    this.currentPublicKeyJwk = user.publicKeyJwk;
    this.currentPublicKeyId = user.publicKeyId;
    this.privateKey = user.privateKey || null;

    this.startGossipLoop();
  }

  public setPrivateKey(key: CryptoKey | null) {
    this.privateKey = key;
  }

  public subscribe(handler: MeshEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(type: 'message-received' | 'peer-status-changed' | 'peers-updated' | 'file-chunk-received', data: any) {
    for (const listener of this.listeners) {
      try {
        listener({ type, data });
      } catch (err) {
        console.error('Mesh event error:', err);
      }
    }
  }

  /**
   * Register a new direct peer connection
   */
  public addDirectPeer(peer: PeerConnection) {
    this.directPeers.set(peer.id, peer);

    // Update presence
    this.meshPeers.set(peer.id, {
      nodeId: peer.id,
      displayName: peer.name,
      publicKeyId: peer.publicKeyId,
      hops: 1,
      lastSeen: Date.now(),
    });

    // Send initial gossip and sync-summary
    this.sendPeerGossip();
    this.sendSyncSummaryToPeer(peer);

    this.emit('peer-status-changed', { peerId: peer.id, status: peer.status });
    this.emit('peers-updated', this.getAllKnownPeers());
  }

  public removeDirectPeer(peerId: string) {
    const peer = this.directPeers.get(peerId);
    if (peer) {
      peer.close();
      this.directPeers.delete(peerId);
    }
    this.emit('peer-status-changed', { peerId, status: 'disconnected' });
    this.emit('peers-updated', this.getAllKnownPeers());
  }

  public getDirectPeers(): PeerConnection[] {
    return Array.from(this.directPeers.values());
  }

  public getAllKnownPeers(): PeerInfo[] {
    const result: PeerInfo[] = [];

    // Add all direct peers
    for (const [id, conn] of this.directPeers.entries()) {
      result.push({
        id,
        name: conn.name,
        publicKeyId: conn.publicKeyId,
        status: conn.status,
        direct: true,
        hops: 1,
        lastSeen: conn.lastSeen,
        rttMs: conn.rttMs,
        bytesSent: conn.bytesSent,
        bytesReceived: conn.bytesReceived,
        connectionTime: conn.connectionTime,
      });
    }

    // Add indirect peers (not already in direct peers)
    for (const [id, node] of this.meshPeers.entries()) {
      if (id === this.currentUserId || this.directPeers.has(id)) {
        continue;
      }
      // Stale cutoff 90 seconds
      if (Date.now() - node.lastSeen > 90000) {
        continue;
      }
      result.push({
        id: node.nodeId,
        name: node.displayName,
        publicKeyId: node.publicKeyId,
        status: 'connected',
        direct: false,
        hops: node.hops,
        lastSeen: node.lastSeen,
        bytesSent: 0,
        bytesReceived: 0,
      });
    }

    return result;
  }

  /**
   * Verify and enforce sender identity public key pinning:
   * 1. Reject if claims to be current user with wrong key.
   * 2. If senderId already pinned, verify that senderPublicKeyId and JWK match the pinned key.
   * 3. If senderId not yet seen, pin to this first public key (Trust On First Use - TOFU).
   */
  private async authenticateSenderIdentity(
    senderId: string,
    senderName: string,
    senderPublicKeyJwk: JsonWebKey,
    senderPublicKeyId: string
  ): Promise<boolean> {
    // 1. Prevent identity theft of current local user
    if (senderId === this.currentUserId) {
      if (
        senderPublicKeyId !== this.currentPublicKeyId ||
        senderPublicKeyJwk.x !== this.currentPublicKeyJwk.x ||
        senderPublicKeyJwk.y !== this.currentPublicKeyJwk.y
      ) {
        console.warn('Rejecting message attempting to spoof local user identity:', senderId);
        return false;
      }
      return true;
    }

    // 2. Check if identity is already pinned
    const pinned = await getPinnedIdentity(senderId);
    if (pinned) {
      // Compare public key ID and JWK parameters
      if (
        pinned.publicKeyId !== senderPublicKeyId ||
        pinned.publicKeyJwk.x !== senderPublicKeyJwk.x ||
        pinned.publicKeyJwk.y !== senderPublicKeyJwk.y
      ) {
        console.warn(
          `Rejecting spoofed message: senderId "${senderId}" (${senderName}) does not match pinned public key (${pinned.publicKeyId} vs ${senderPublicKeyId})`
        );
        return false;
      }
      return true;
    }

    // 3. Trust On First Use (TOFU): Pin sender identity to first-seen public key
    await savePinnedIdentity({
      senderId,
      displayName: senderName,
      publicKeyJwk: senderPublicKeyJwk,
      publicKeyId: senderPublicKeyId,
      verifiedByHandshake: false,
      pinnedAt: Date.now(),
    });

    return true;
  }

  /**
   * Handle incoming wire message from a direct peer
   */
  public async handleIncomingWireMessage(msg: WireMessage, fromPeerId: string) {
    // 1. Deduplication check
    if (this.seenMessageIds.has(msg.id)) {
      return;
    }

    // 2. Dispatch based on wire message type
    switch (msg.type) {
      case 'chat-message':
        // Note: recordSeenId is called inside handleIncomingChatMessage ONLY AFTER signature and identity pinning verification succeed!
        await this.handleIncomingChatMessage(msg.payload as ChatMessage, msg, fromPeerId);
        break;

      case 'peer-gossip':
        this.recordSeenId(msg.id);
        this.handleIncomingGossip(msg.payload as PeerGossipNode[], fromPeerId);
        break;

      case 'sync-summary':
        this.recordSeenId(msg.id);
        await this.handleIncomingSyncSummary(msg.payload, fromPeerId);
        break;

      case 'sync-request':
        this.recordSeenId(msg.id);
        await this.handleIncomingSyncRequest(msg.payload, fromPeerId);
        break;

      case 'sync-response':
        this.recordSeenId(msg.id);
        await this.handleIncomingSyncResponse(msg.payload, fromPeerId);
        break;

      case 'file-chunk-req':
        this.recordSeenId(msg.id);
        this.emit('file-chunk-received', { type: 'req', payload: msg.payload, fromPeerId });
        break;

      case 'file-chunk-data':
        this.recordSeenId(msg.id);
        this.emit('file-chunk-received', { type: 'data', payload: msg.payload, fromPeerId });
        break;

      default:
        break;
    }
  }

  /**
   * Handle Chat Message: verify sender identity, verify signature, store, forward
   */
  private async handleIncomingChatMessage(chatMsg: ChatMessage, wireMsg: WireMessage, fromPeerId: string) {
    // Check if already in IndexedDB
    const existing = await getMessageById(chatMsg.id);
    if (existing) {
      this.recordSeenId(wireMsg.id);
      this.recordSeenId(chatMsg.id);
      return;
    }

    // 1. Authenticate sender identity (Public Key Pinning)
    const isSenderAuthentic = await this.authenticateSenderIdentity(
      chatMsg.senderId,
      chatMsg.senderName,
      chatMsg.senderPublicKeyJwk,
      chatMsg.senderPublicKeyId
    );

    if (!isSenderAuthentic) {
      console.warn('Rejecting message failing sender identity authentication:', chatMsg.id);
      return;
    }

    // 2. Canonical representation for signature verification
    const canonicalString = JSON.stringify({
      id: chatMsg.id,
      groupId: chatMsg.groupId,
      senderId: chatMsg.senderId,
      senderPublicKeyId: chatMsg.senderPublicKeyId,
      timestamp: chatMsg.timestamp,
      type: chatMsg.type,
      text: chatMsg.text || '',
      fileMeta: chatMsg.fileMeta || null,
      encryptedPayload: chatMsg.encryptedPayload || null,
    });

    // 3. Verify ECDSA signature
    const isValid = await verifySignature(
      canonicalString,
      chatMsg.signature,
      chatMsg.senderPublicKeyJwk
    );

    if (!isValid) {
      console.warn('Rejecting message with invalid signature:', chatMsg.id);
      return;
    }

    // 4. Record in seen deduplication cache ONLY AFTER verification succeeds!
    this.recordSeenId(wireMsg.id);
    this.recordSeenId(chatMsg.id);

    chatMsg.verified = true;
    chatMsg.isOutgoing = chatMsg.senderId === this.currentUserId;

    // Save to local IndexedDB (store-and-forward)
    await saveMessage(chatMsg);

    // Notify UI
    this.emit('message-received', chatMsg);

    // Flood forwarding: relay to other connected direct peers
    if (wireMsg.ttl > 1) {
      const relayedWireMsg: WireMessage = {
        ...wireMsg,
        hopCount: wireMsg.hopCount + 1,
        ttl: wireMsg.ttl - 1,
      };
      this.relayToOthers(relayedWireMsg, fromPeerId);
    }
  }

  /**
   * Broadcast message originated by current user
   */
  public async broadcastChatMessage(
    params: {
      groupId: string;
      text?: string;
      fileMeta?: any;
      encryptedPayload?: { ivHex: string; ciphertextBase64: string };
      type?: ChatMessage['type'];
    }
  ): Promise<ChatMessage> {
    if (!this.privateKey) {
      throw new Error('Private key not unlocked for signing');
    }

    const messageId = crypto.randomUUID();
    const timestamp = Date.now();
    const msgType = params.type || (params.fileMeta ? 'file-meta' : 'text');

    const canonicalData = JSON.stringify({
      id: messageId,
      groupId: params.groupId,
      senderId: this.currentUserId,
      senderPublicKeyId: this.currentPublicKeyId,
      timestamp,
      type: msgType,
      text: params.text || '',
      fileMeta: params.fileMeta || null,
      encryptedPayload: params.encryptedPayload || null,
    });

    const signature = await signData(canonicalData, this.privateKey);

    const chatMsg: ChatMessage = {
      id: messageId,
      groupId: params.groupId,
      senderId: this.currentUserId,
      senderName: this.currentDisplayName,
      senderPublicKeyJwk: this.currentPublicKeyJwk,
      senderPublicKeyId: this.currentPublicKeyId,
      timestamp,
      type: msgType,
      text: params.text,
      fileMeta: params.fileMeta,
      encryptedPayload: params.encryptedPayload,
      signature,
      hopCount: 0,
      ttl: 6,
      verified: true,
      isOutgoing: true,
    };

    // Save locally
    await saveMessage(chatMsg);
    this.recordSeenId(messageId);

    // Construct wire message and broadcast to all connected direct peers
    const wireMsg: WireMessage = {
      id: messageId,
      type: 'chat-message',
      senderId: this.currentUserId,
      senderName: this.currentDisplayName,
      timestamp,
      hopCount: 0,
      ttl: 6,
      payload: chatMsg,
    };

    let sentCount = 0;
    for (const peer of this.directPeers.values()) {
      if (peer.status === 'connected') {
        peer.send(wireMsg);
        sentCount++;
      }
    }
    chatMsg.relayedToCount = sentCount;

    return chatMsg;
  }

  /**
   * Relay a wire message to all connected peers except the sender
   */
  public relayToOthers(msg: WireMessage, exceptPeerId?: string) {
    for (const [peerId, peer] of this.directPeers.entries()) {
      if (peerId !== exceptPeerId && peer.status === 'connected') {
        peer.send(msg);
      }
    }
  }

  /**
   * Send arbitrary wire message to a specific peer or broadcast
   */
  public sendWireMessage(msg: WireMessage, targetPeerId?: string): boolean {
    if (targetPeerId) {
      const direct = this.directPeers.get(targetPeerId);
      if (direct && direct.status === 'connected') {
        return direct.send(msg);
      }
    }
    // Broadcast if no specific peer or if relaying
    this.relayToOthers(msg);
    return true;
  }

  /**
   * Peer-list Gossip Protocol
   */
  private startGossipLoop() {
    this.gossipTimer = window.setInterval(() => {
      this.sendPeerGossip();
    }, 15000);
  }

  public sendPeerGossip() {
    const list: PeerGossipNode[] = [
      // Self
      {
        nodeId: this.currentUserId,
        displayName: this.currentDisplayName,
        publicKeyId: this.currentPublicKeyId,
        hops: 0,
        lastSeen: Date.now(),
      },
    ];

    // Direct peers
    for (const [id, peer] of this.directPeers.entries()) {
      if (peer.status === 'connected') {
        list.push({
          nodeId: id,
          displayName: peer.name,
          publicKeyId: peer.publicKeyId,
          hops: 1,
          lastSeen: peer.lastSeen,
        });
      }
    }

    // Indirect peers
    for (const [id, node] of this.meshPeers.entries()) {
      if (id !== this.currentUserId && !this.directPeers.has(id)) {
        if (Date.now() - node.lastSeen < 60000) {
          list.push({
            nodeId: node.nodeId,
            displayName: node.displayName,
            publicKeyId: node.publicKeyId,
            hops: node.hops,
            lastSeen: node.lastSeen,
          });
        }
      }
    }

    const wireMsg: WireMessage = {
      id: crypto.randomUUID(),
      type: 'peer-gossip',
      senderId: this.currentUserId,
      senderName: this.currentDisplayName,
      timestamp: Date.now(),
      hopCount: 0,
      ttl: 3,
      payload: list,
    };

    for (const peer of this.directPeers.values()) {
      if (peer.status === 'connected') {
        peer.send(wireMsg);
      }
    }
  }

  private handleIncomingGossip(nodes: PeerGossipNode[], fromPeerId: string) {
    let updated = false;

    for (const node of nodes) {
      if (node.nodeId === this.currentUserId) continue;

      const existing = this.meshPeers.get(node.nodeId);
      const hopDistance = this.directPeers.has(node.nodeId) ? 1 : node.hops + 1;

      if (!existing || existing.hops > hopDistance || Date.now() - existing.lastSeen > 30000) {
        this.meshPeers.set(node.nodeId, {
          nodeId: node.nodeId,
          displayName: node.displayName,
          publicKeyId: node.publicKeyId,
          hops: hopDistance,
          lastSeen: Date.now(),
        });
        updated = true;
      }
    }

    if (updated) {
      this.emit('peers-updated', this.getAllKnownPeers());
    }
  }

  /**
   * Store-and-Forward Synchronization
   */
  public async sendSyncSummaryToPeer(peer: PeerConnection) {
    if (peer.status !== 'connected') return;

    const summaries = await getAllGroupMessageSummaries();
    const wireMsg: WireMessage = {
      id: crypto.randomUUID(),
      type: 'sync-summary',
      senderId: this.currentUserId,
      senderName: this.currentDisplayName,
      timestamp: Date.now(),
      hopCount: 0,
      ttl: 1,
      payload: summaries,
    };
    peer.send(wireMsg);
  }

  private async handleIncomingSyncSummary(remoteSummaries: { [groupId: string]: string[] }, fromPeerId: string) {
    const peer = this.directPeers.get(fromPeerId);
    if (!peer || peer.status !== 'connected') return;

    const localSummaries = await getAllGroupMessageSummaries();
    const missingMessageIdsToRequest: string[] = [];
    const messagesToSendBack: ChatMessage[] = [];

    // Compare each group's messages
    const allGroupIds = new Set([...Object.keys(localSummaries), ...Object.keys(remoteSummaries)]);

    for (const groupId of allGroupIds) {
      const localIds = new Set(localSummaries[groupId] || []);
      const remoteIds = new Set(remoteSummaries[groupId] || []);

      // If remote has messages we don't have, request them
      for (const rId of remoteIds) {
        if (!localIds.has(rId)) {
          missingMessageIdsToRequest.push(rId);
        }
      }

      // If we have messages remote doesn't have, prepare to send them
      for (const lId of localIds) {
        if (!remoteIds.has(lId)) {
          const msg = await getMessageById(lId);
          if (msg) messagesToSendBack.push(msg);
        }
      }
    }

    // 1. Send missing messages to peer
    if (messagesToSendBack.length > 0) {
      peer.send({
        id: crypto.randomUUID(),
        type: 'sync-response',
        senderId: this.currentUserId,
        senderName: this.currentDisplayName,
        timestamp: Date.now(),
        hopCount: 0,
        ttl: 1,
        payload: messagesToSendBack.slice(0, 100), // In batches of 100
      });
    }

    // 2. Request missing messages from peer
    if (missingMessageIdsToRequest.length > 0) {
      peer.send({
        id: crypto.randomUUID(),
        type: 'sync-request',
        senderId: this.currentUserId,
        senderName: this.currentDisplayName,
        timestamp: Date.now(),
        hopCount: 0,
        ttl: 1,
        payload: missingMessageIdsToRequest.slice(0, 100),
      });
    }
  }

  private async handleIncomingSyncRequest(requestedIds: string[], fromPeerId: string) {
    const peer = this.directPeers.get(fromPeerId);
    if (!peer || peer.status !== 'connected') return;

    const msgs: ChatMessage[] = [];
    for (const id of requestedIds) {
      const msg = await getMessageById(id);
      if (msg) msgs.push(msg);
    }

    if (msgs.length > 0) {
      peer.send({
        id: crypto.randomUUID(),
        type: 'sync-response',
        senderId: this.currentUserId,
        senderName: this.currentDisplayName,
        timestamp: Date.now(),
        hopCount: 0,
        ttl: 1,
        payload: msgs,
      });
    }
  }

  private async handleIncomingSyncResponse(receivedMessages: ChatMessage[], fromPeerId: string) {
    for (const chatMsg of receivedMessages) {
      const existing = await getMessageById(chatMsg.id);
      if (!existing) {
        // Authenticate sender identity (Public Key Pinning)
        const isSenderAuthentic = await this.authenticateSenderIdentity(
          chatMsg.senderId,
          chatMsg.senderName,
          chatMsg.senderPublicKeyJwk,
          chatMsg.senderPublicKeyId
        );

        if (!isSenderAuthentic) {
          console.warn('Rejecting sync message failing sender identity authentication:', chatMsg.id);
          continue;
        }

        // Verify signature
        const canonicalString = JSON.stringify({
          id: chatMsg.id,
          groupId: chatMsg.groupId,
          senderId: chatMsg.senderId,
          senderPublicKeyId: chatMsg.senderPublicKeyId,
          timestamp: chatMsg.timestamp,
          type: chatMsg.type,
          text: chatMsg.text || '',
          fileMeta: chatMsg.fileMeta || null,
          encryptedPayload: chatMsg.encryptedPayload || null,
        });

        const isValid = await verifySignature(
          canonicalString,
          chatMsg.signature,
          chatMsg.senderPublicKeyJwk
        );

        if (isValid) {
          chatMsg.verified = true;
          chatMsg.isOutgoing = chatMsg.senderId === this.currentUserId;
          await saveMessage(chatMsg);
          this.emit('message-received', chatMsg);
        }
      }
    }
  }

  private recordSeenId(id: string) {
    this.seenMessageIds.add(id);
    if (this.seenMessageIds.size > this.maxSeenCacheSize) {
      const iterator = this.seenMessageIds.values();
      for (let i = 0; i < 500; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.seenMessageIds.delete(next.value);
      }
    }
  }

  public destroy() {
    if (this.gossipTimer) {
      clearInterval(this.gossipTimer);
    }
    for (const peer of this.directPeers.values()) {
      peer.close();
    }
    this.directPeers.clear();
    this.listeners.clear();
  }
}
