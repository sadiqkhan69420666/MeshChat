/**
 * MeshChat Type Definitions
 */

export interface UserAccount {
  id: string; // UUID
  email: string;
  displayName: string;
  passwordSaltHex: string; // Hex salt for PBKDF2 password verification
  passwordHashHex: string; // Hex hash
  encryptionSaltHex: string; // Salt for key derivation
  encryptedPrivateKey: {
    ivHex: string;
    ciphertextBase64: string;
  };
  publicKeyJwk: JsonWebKey;
  publicKeyId: string; // Short fingerprint/hash of public key
  createdAt: number;
}

export interface UserSession {
  userId: string;
  email: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  // cryptoKey is held in memory only, not stored in DB
}

export interface Group {
  id: string; // UUID
  name: string;
  description?: string;
  isEncrypted: boolean;
  passphraseSaltHex?: string;
  createdAt: number;
  createdBy: string;
  avatarColor: string;
}

export interface FileMetadata {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  chunkCount: number;
  chunkSize: number;
  chunkHashes: string[]; // SHA-256 hex per chunk
  fileHash: string; // Full file SHA-256 hex
}

export interface FileChunk {
  fileId: string;
  chunkIndex: number;
  hash: string;
  dataBase64: string;
}

export interface FileDownloadProgress {
  fileId: string;
  receivedChunks: number;
  totalChunks: number;
  isComplete: boolean;
  error?: string;
  cancelled?: boolean;
}

export type MessageType =
  | 'text'
  | 'file-meta'
  | 'system';

export interface ChatMessage {
  id: string; // UUID
  groupId: string;
  senderId: string;
  senderName: string;
  senderPublicKeyJwk: JsonWebKey;
  senderPublicKeyId: string;
  timestamp: number;
  type: MessageType;
  text?: string;
  fileMeta?: FileMetadata;
  encryptedPayload?: {
    ivHex: string;
    ciphertextBase64: string;
  };
  signature: string; // ECDSA signature over canonical data
  hopCount: number;
  ttl: number;
  // Local state
  verified?: boolean;
  isOutgoing?: boolean;
  relayedToCount?: number;
}

export type WireMessageType =
  | 'chat-message'
  | 'peer-gossip'
  | 'sync-summary'
  | 'sync-request'
  | 'sync-response'
  | 'file-chunk-req'
  | 'file-chunk-data'
  | 'ping'
  | 'pong';

export interface WireMessage {
  id: string; // UUID
  type: WireMessageType;
  senderId: string;
  senderName: string;
  timestamp: number;
  hopCount: number;
  ttl: number;
  targetPeerId?: string; // If unicast through mesh
  payload: any;
  signature?: string;
}

export interface PeerGossipNode {
  nodeId: string;
  displayName: string;
  publicKeyId: string;
  hops: number;
  lastSeen: number;
}

export interface PeerInfo {
  id: string; // Peer's user or node ID
  name: string;
  publicKeyId: string;
  publicKeyJwk?: JsonWebKey;
  status: 'connecting' | 'connected' | 'disconnected' | 'failed';
  direct: boolean; // Direct WebRTC connection vs indirect mesh peer
  hops: number;
  lastSeen: number;
  rttMs?: number;
  bytesSent: number;
  bytesReceived: number;
  connectionTime?: number;
}

export interface SignalingOfferPayload {
  version: 1;
  type: 'offer';
  sdp: string;
  senderId: string;
  senderName: string;
  senderPublicKeyJwk: JsonWebKey;
  senderPublicKeyId: string;
}

export interface SignalingAnswerPayload {
  version: 1;
  type: 'answer';
  sdp: string;
  senderId: string;
  senderName: string;
  senderPublicKeyJwk: JsonWebKey;
  senderPublicKeyId: string;
}

export interface RateLimitRecord {
  email: string;
  failedCount: number;
  lockedUntil: number; // Timestamp
  lastAttempt: number;
}

export interface PinnedIdentity {
  senderId: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  verifiedByHandshake: boolean;
  pinnedAt: number;
}
