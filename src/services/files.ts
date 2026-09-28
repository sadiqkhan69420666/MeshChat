/**
 * MeshChat File Sharing & P2P Swarming Service
 * Handles 64 KB chunking, SHA-256 per-chunk verification,
 * backpressure-controlled transmission, IndexedDB chunk caching, and reassembly.
 */

import { FileMetadata, FileChunk, FileDownloadProgress } from '../types';
import { sha256Hex, bufferToBase64, base64ToBuffer } from './crypto';
import {
  saveFileMetadata,
  getFileMetadata,
  saveFileChunk,
  getFileChunk,
  getDownloadedChunkIndexes,
  getAllChunksForFile,
  saveCompleteFileBlob,
  getCompleteFileBlob,
} from './storage';
import { MeshNetwork } from './mesh';

export const CHUNK_SIZE = 64 * 1024; // 64 KB

export interface FileProgressCallback {
  (progress: FileDownloadProgress): void;
}

class FileManager {
  private activeDownloads: Map<string, {
    progress: FileDownloadProgress;
    callbacks: Set<FileProgressCallback>;
    inFlightChunks: Set<number>;
    cancelled: boolean;
  }> = new Map();

  private blobUrlCache: Map<string, string> = new Map();

  /**
   * Process and chunk a raw File into 64KB chunks with SHA-256 hashes
   */
  public async prepareFileForSharing(file: File): Promise<{
    metadata: FileMetadata;
    chunks: FileChunk[];
  }> {
    const fileId = crypto.randomUUID();
    const arrayBuffer = await file.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    const chunkCount = Math.ceil(totalBytes / CHUNK_SIZE) || 1;

    const chunkHashes: string[] = [];
    const chunks: FileChunk[] = [];

    for (let i = 0; i < chunkCount; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const chunkBytes = arrayBuffer.slice(start, end);
      const hash = await sha256Hex(chunkBytes);
      const dataBase64 = bufferToBase64(new Uint8Array(chunkBytes));

      chunkHashes.push(hash);
      chunks.push({
        fileId,
        chunkIndex: i,
        hash,
        dataBase64,
      });
    }

    const fullFileHash = await sha256Hex(arrayBuffer);

    const metadata: FileMetadata = {
      fileId,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      chunkCount,
      chunkSize: CHUNK_SIZE,
      chunkHashes,
      fileHash: fullFileHash,
    };

    // Store metadata, all chunks, and complete blob in IndexedDB
    await saveFileMetadata(metadata);
    for (const chunk of chunks) {
      await saveFileChunk(chunk);
    }
    await saveCompleteFileBlob(fileId, file);

    return { metadata, chunks };
  }

  /**
   * Check if file is already completely downloaded and cached
   */
  public async isFileComplete(fileId: string): Promise<boolean> {
    const blob = await getCompleteFileBlob(fileId);
    if (blob) return true;

    const meta = await getFileMetadata(fileId);
    if (!meta) return false;

    const downloaded = await getDownloadedChunkIndexes(fileId);
    return downloaded.length >= meta.chunkCount;
  }

  /**
   * Get an object URL for a file (for inline preview or download link)
   */
  public async getFileBlobUrl(fileId: string): Promise<string | null> {
    if (this.blobUrlCache.has(fileId)) {
      return this.blobUrlCache.get(fileId)!;
    }

    let blob: Blob | null | undefined = await getCompleteFileBlob(fileId);
    if (!blob) {
      // Try to reassemble from stored chunks
      blob = await this.reassembleFile(fileId);
    }

    if (blob) {
      const url = URL.createObjectURL(blob);
      this.blobUrlCache.set(fileId, url);
      return url;
    }

    return null;
  }

  /**
   * Reassemble full Blob from stored chunks in IndexedDB
   */
  public async reassembleFile(fileId: string): Promise<Blob | null> {
    const meta = await getFileMetadata(fileId);
    if (!meta) return null;

    const chunks = await getAllChunksForFile(fileId);
    if (chunks.length < meta.chunkCount) {
      return null;
    }

    const buffers: Uint8Array[] = [];
    for (const c of chunks) {
      buffers.push(base64ToBuffer(c.dataBase64));
    }

    const fullBlob = new Blob(buffers as any, { type: meta.mimeType });
    await saveCompleteFileBlob(fileId, fullBlob);
    return fullBlob;
  }

  /**
   * Subscribe to download progress for a file
   */
  public subscribeProgress(fileId: string, callback: FileProgressCallback): () => void {
    let dl = this.activeDownloads.get(fileId);
    if (!dl) {
      dl = {
        progress: {
          fileId,
          receivedChunks: 0,
          totalChunks: 0,
          isComplete: false,
        },
        callbacks: new Set(),
        inFlightChunks: new Set(),
        cancelled: false,
      };
      this.activeDownloads.set(fileId, dl);
    }
    dl.callbacks.add(callback);
    callback(dl.progress);

    return () => {
      dl?.callbacks.delete(callback);
    };
  }

  /**
   * Cancel ongoing download
   */
  public cancelDownload(fileId: string) {
    const dl = this.activeDownloads.get(fileId);
    if (dl) {
      dl.cancelled = true;
      dl.progress.cancelled = true;
      for (const cb of dl.callbacks) {
        cb(dl.progress);
      }
    }
  }

  /**
   * Start or resume downloading a file by swarming missing chunks across peers
   */
  public async startDownload(
    fileMeta: FileMetadata,
    mesh: MeshNetwork,
    onProgress?: FileProgressCallback
  ): Promise<Blob> {
    const { fileId, chunkCount } = fileMeta;

    // Check if already completed
    const existingBlob = await getCompleteFileBlob(fileId);
    if (existingBlob) {
      if (onProgress) {
        onProgress({
          fileId,
          receivedChunks: chunkCount,
          totalChunks: chunkCount,
          isComplete: true,
        });
      }
      return existingBlob;
    }

    // Save metadata locally if not already stored
    await saveFileMetadata(fileMeta);

    // Get chunks already in IndexedDB
    const downloadedIndexes = new Set(await getDownloadedChunkIndexes(fileId));
    if (downloadedIndexes.size >= chunkCount) {
      const reassembled = await this.reassembleFile(fileId);
      if (reassembled) {
        if (onProgress) {
          onProgress({
            fileId,
            receivedChunks: chunkCount,
            totalChunks: chunkCount,
            isComplete: true,
          });
        }
        return reassembled;
      }
    }

    let dl = this.activeDownloads.get(fileId);
    if (!dl) {
      dl = {
        progress: {
          fileId,
          receivedChunks: downloadedIndexes.size,
          totalChunks: chunkCount,
          isComplete: false,
        },
        callbacks: new Set(),
        inFlightChunks: new Set(),
        cancelled: false,
      };
      this.activeDownloads.set(fileId, dl);
    } else {
      dl.cancelled = false;
      dl.progress.cancelled = false;
      dl.progress.receivedChunks = downloadedIndexes.size;
      dl.progress.totalChunks = chunkCount;
    }

    if (onProgress) {
      dl.callbacks.add(onProgress);
      onProgress(dl.progress);
    }

    // Identify missing chunks
    const missingChunks: number[] = [];
    for (let i = 0; i < chunkCount; i++) {
      if (!downloadedIndexes.has(i)) {
        missingChunks.push(i);
      }
    }

    return new Promise((resolve, reject) => {
      // Swarm request chunk loop
      const peers = mesh.getDirectPeers().filter((p) => p.status === 'connected');
      if (peers.length === 0) {
        const error = 'No connected peers to download from';
        dl!.progress.error = error;
        for (const cb of dl!.callbacks) cb(dl!.progress);
        return reject(new Error(error));
      }

      // Request chunks in batches across connected peers
      let peerIdx = 0;
      const requestBatch = () => {
        if (!dl || dl.cancelled) {
          return reject(new Error('Download cancelled'));
        }

        const activePeers = mesh.getDirectPeers().filter((p) => p.status === 'connected');
        if (activePeers.length === 0) return;

        for (const chunkIndex of missingChunks) {
          if (!dl.inFlightChunks.has(chunkIndex)) {
            dl.inFlightChunks.add(chunkIndex);
            const peer = activePeers[peerIdx % activePeers.length];
            peerIdx++;

            peer.send({
              id: crypto.randomUUID(),
              type: 'file-chunk-req',
              senderId: 'self',
              senderName: '',
              timestamp: Date.now(),
              hopCount: 0,
              ttl: 1,
              payload: { fileId, chunkIndex },
            });
          }
        }
      };

      requestBatch();

      // Listen for incoming chunks via mesh event handler
      const unsubscribe = mesh.subscribe(async (event) => {
        if (event.type === 'file-chunk-received') {
          const { type, payload } = event.data;

          // Someone is requesting a chunk from us
          if (type === 'req' && payload.fileId === fileId) {
            const chunk = await getFileChunk(fileId, payload.chunkIndex);
            if (chunk) {
              const reqPeer = mesh.getDirectPeers().find((p) => p.id === event.data.fromPeerId);
              if (reqPeer && reqPeer.status === 'connected') {
                reqPeer.send({
                  id: crypto.randomUUID(),
                  type: 'file-chunk-data',
                  senderId: 'self',
                  senderName: '',
                  timestamp: Date.now(),
                  hopCount: 0,
                  ttl: 1,
                  payload: chunk,
                });
              }
            }
          }

          // We received a chunk
          if (type === 'data' && payload.fileId === fileId) {
            if (!dl || dl.cancelled) return;

            const chunkIndex = payload.chunkIndex;
            dl.inFlightChunks.delete(chunkIndex);

            // Verify chunk hash
            const expectedHash = fileMeta.chunkHashes[chunkIndex];
            const dataBytes = base64ToBuffer(payload.dataBase64);
            const actualHash = await sha256Hex(dataBytes);

            if (actualHash === expectedHash) {
              await saveFileChunk(payload);
              downloadedIndexes.add(chunkIndex);

              dl.progress.receivedChunks = downloadedIndexes.size;
              for (const cb of dl.callbacks) cb(dl.progress);

              // Check if all chunks received
              if (downloadedIndexes.size >= chunkCount) {
                dl.progress.isComplete = true;
                for (const cb of dl.callbacks) cb(dl.progress);

                const finalBlob = await this.reassembleFile(fileId);
                unsubscribe();
                this.activeDownloads.delete(fileId);

                if (finalBlob) {
                  resolve(finalBlob);
                } else {
                  reject(new Error('Failed to reassemble file'));
                }
              }
            } else {
              console.warn('Chunk hash mismatch on index', chunkIndex);
              // Retry requesting this chunk
              missingChunks.push(chunkIndex);
              requestBatch();
            }
          }
        }
      });
    });
  }

  /**
   * Handle incoming chunk request from a peer
   */
  public async handleIncomingChunkReq(
    payload: { fileId: string; chunkIndex: number },
    peer: any
  ) {
    const chunk = await getFileChunk(payload.fileId, payload.chunkIndex);
    if (chunk && peer && peer.status === 'connected') {
      peer.send({
        id: crypto.randomUUID(),
        type: 'file-chunk-data',
        senderId: 'self',
        senderName: '',
        timestamp: Date.now(),
        hopCount: 0,
        ttl: 1,
        payload: chunk,
      });
    }
  }
}

export const fileManager = new FileManager();
