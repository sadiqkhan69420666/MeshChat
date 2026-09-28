/**
 * MeshChat IndexedDB Storage Service
 * Provides robust, fully offline persistent storage for accounts, sessions,
 * messages, groups, file metadata, and 64KB raw chunks.
 */

import {
  UserAccount,
  Group,
  ChatMessage,
  FileMetadata,
  FileChunk,
  RateLimitRecord,
} from '../types';

const DB_NAME = 'meshchat_storage_v1';
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Accounts store
      if (!db.objectStoreNames.contains('accounts')) {
        const store = db.createObjectStore('accounts', { keyPath: 'email' });
        store.createIndex('id', 'id', { unique: true });
      }

      // 2. Active Session store
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'key' });
      }

      // 3. Groups store
      if (!db.objectStoreNames.contains('groups')) {
        const store = db.createObjectStore('groups', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // 4. Messages store
      if (!db.objectStoreNames.contains('messages')) {
        const store = db.createObjectStore('messages', { keyPath: 'id' });
        store.createIndex('groupId', 'groupId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('groupId_timestamp', ['groupId', 'timestamp'], { unique: false });
      }

      // 5. File Metadata store
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'fileId' });
      }

      // 6. Complete File Blobs store
      if (!db.objectStoreNames.contains('file_blobs')) {
        db.createObjectStore('file_blobs', { keyPath: 'fileId' });
      }

      // 7. File Chunks store (composite key: fileId:chunkIndex)
      if (!db.objectStoreNames.contains('file_chunks')) {
        const store = db.createObjectStore('file_chunks', { keyPath: 'chunkKey' });
        store.createIndex('fileId', 'fileId', { unique: false });
      }

      // 8. Rate Limiting store
      if (!db.objectStoreNames.contains('rate_limits')) {
        db.createObjectStore('rate_limits', { keyPath: 'email' });
      }

      // 9. App Settings store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        try {
          const transaction = db.transaction(storeName, mode);
          const store = transaction.objectStore(storeName);
          const request = fn(store);

          transaction.oncomplete = () => {
            if (request && 'result' in request) {
              resolve(request.result);
            } else {
              resolve(undefined as unknown as T);
            }
          };

          transaction.onerror = () => {
            reject(transaction.error || new Error('Transaction error'));
          };
        } catch (err) {
          reject(err);
        }
      })
  );
}

// ----------------- Accounts & Auth -----------------

export async function getAccountByEmail(email: string): Promise<UserAccount | undefined> {
  const normalized = email.trim().toLowerCase();
  return runTransaction<UserAccount>('accounts', 'readonly', (store) => store.get(normalized));
}

export async function getAllAccounts(): Promise<UserAccount[]> {
  return runTransaction<UserAccount[]>('accounts', 'readonly', (store) => store.getAll());
}

export async function saveAccount(account: UserAccount): Promise<void> {
  const normalizedAccount = {
    ...account,
    email: account.email.trim().toLowerCase(),
  };
  await runTransaction('accounts', 'readwrite', (store) => store.put(normalizedAccount));
}

export async function deleteAccount(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await runTransaction('accounts', 'readwrite', (store) => store.delete(normalized));
}

// Active session storage (persists user session on this device)
export async function saveActiveSession(session: {
  userId: string;
  email: string;
  displayName: string;
  publicKeyJwk: JsonWebKey;
  publicKeyId: string;
  encryptedPrivateKey: { ivHex: string; ciphertextBase64: string };
  encryptionSaltHex: string;
}): Promise<void> {
  await runTransaction('sessions', 'readwrite', (store) =>
    store.put({ key: 'current_user', ...session })
  );
}

export async function getActiveSession(): Promise<any | undefined> {
  return runTransaction('sessions', 'readonly', (store) => store.get('current_user'));
}

export async function clearActiveSession(): Promise<void> {
  await runTransaction('sessions', 'readwrite', (store) => store.delete('current_user'));
}

// Rate Limiting
export async function getRateLimitRecord(email: string): Promise<RateLimitRecord | undefined> {
  const normalized = email.trim().toLowerCase();
  return runTransaction<RateLimitRecord>('rate_limits', 'readonly', (store) =>
    store.get(normalized)
  );
}

export async function recordFailedLogin(email: string): Promise<RateLimitRecord> {
  const normalized = email.trim().toLowerCase();
  const existing = (await getRateLimitRecord(normalized)) || {
    email: normalized,
    failedCount: 0,
    lockedUntil: 0,
    lastAttempt: Date.now(),
  };

  const newCount = existing.failedCount + 1;
  let lockedUntil = existing.lockedUntil;

  // 5 failed attempts -> 30s lockout. Each subsequent failure adds 30s * (newCount - 4)
  if (newCount >= 5) {
    const backoffSeconds = 30 * Math.pow(1.5, newCount - 5);
    lockedUntil = Date.now() + Math.min(backoffSeconds * 1000, 300000); // Max 5 mins
  }

  const updated: RateLimitRecord = {
    email: normalized,
    failedCount: newCount,
    lockedUntil,
    lastAttempt: Date.now(),
  };

  await runTransaction('rate_limits', 'readwrite', (store) => store.put(updated));
  return updated;
}

export async function resetFailedLogin(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await runTransaction('rate_limits', 'readwrite', (store) => store.delete(normalized));
}

// ----------------- Groups -----------------

export async function getAllGroups(): Promise<Group[]> {
  const groups = await runTransaction<Group[]>('groups', 'readonly', (store) => store.getAll());
  return groups || [];
}

export async function getGroupById(groupId: string): Promise<Group | undefined> {
  return runTransaction<Group>('groups', 'readonly', (store) => store.get(groupId));
}

export async function saveGroup(group: Group): Promise<void> {
  await runTransaction('groups', 'readwrite', (store) => store.put(group));
}

export async function deleteGroup(groupId: string): Promise<void> {
  await runTransaction('groups', 'readwrite', (store) => store.delete(groupId));
  // Also clean up messages in that group
  const messages = await getMessagesByGroup(groupId);
  for (const m of messages) {
    await deleteMessage(m.id);
  }
}

// ----------------- Messages -----------------

export async function saveMessage(message: ChatMessage): Promise<void> {
  await runTransaction('messages', 'readwrite', (store) => store.put(message));
}

export async function getMessageById(id: string): Promise<ChatMessage | undefined> {
  return runTransaction<ChatMessage>('messages', 'readonly', (store) => store.get(id));
}

export async function getMessagesByGroup(groupId: string, limit = 500): Promise<ChatMessage[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const index = store.index('groupId');
      const request = index.getAll(groupId);

      request.onsuccess = () => {
        const msgs: ChatMessage[] = request.result || [];
        msgs.sort((a, b) => a.timestamp - b.timestamp);
        if (msgs.length > limit) {
          resolve(msgs.slice(-limit));
        } else {
          resolve(msgs);
        }
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function getAllMessageIdsByGroup(groupId: string): Promise<string[]> {
  const messages = await getMessagesByGroup(groupId);
  return messages.map((m) => m.id);
}

export async function getAllGroupMessageSummaries(): Promise<{ [groupId: string]: string[] }> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('messages', 'readonly');
      const store = tx.objectStore('messages');
      const request = store.getAll();

      request.onsuccess = () => {
        const msgs: ChatMessage[] = request.result || [];
        const summary: { [groupId: string]: string[] } = {};
        for (const m of msgs) {
          if (!summary[m.groupId]) {
            summary[m.groupId] = [];
          }
          summary[m.groupId].push(m.id);
        }
        resolve(summary);
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function deleteMessage(id: string): Promise<void> {
  await runTransaction('messages', 'readwrite', (store) => store.delete(id));
}

// ----------------- Files & Chunks -----------------

export async function saveFileMetadata(meta: FileMetadata): Promise<void> {
  await runTransaction('files', 'readwrite', (store) => store.put(meta));
}

export async function getFileMetadata(fileId: string): Promise<FileMetadata | undefined> {
  return runTransaction<FileMetadata>('files', 'readonly', (store) => store.get(fileId));
}

export async function getAllFileMetadata(): Promise<FileMetadata[]> {
  return runTransaction<FileMetadata[]>('files', 'readonly', (store) => store.getAll());
}

export async function saveFileChunk(chunk: FileChunk): Promise<void> {
  const chunkKey = `${chunk.fileId}:${chunk.chunkIndex}`;
  await runTransaction('file_chunks', 'readwrite', (store) =>
    store.put({ chunkKey, ...chunk })
  );
}

export async function getFileChunk(fileId: string, chunkIndex: number): Promise<FileChunk | undefined> {
  const chunkKey = `${fileId}:${chunkIndex}`;
  return runTransaction<FileChunk>('file_chunks', 'readonly', (store) => store.get(chunkKey));
}

export async function getDownloadedChunkIndexes(fileId: string): Promise<number[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('file_chunks', 'readonly');
      const store = tx.objectStore('file_chunks');
      const index = store.index('fileId');
      const request = index.getAll(fileId);

      request.onsuccess = () => {
        const chunks: Array<FileChunk & { chunkIndex: number }> = request.result || [];
        resolve(chunks.map((c) => c.chunkIndex));
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function getAllChunksForFile(fileId: string): Promise<FileChunk[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction('file_chunks', 'readonly');
      const store = tx.objectStore('file_chunks');
      const index = store.index('fileId');
      const request = index.getAll(fileId);

      request.onsuccess = () => {
        const chunks: FileChunk[] = request.result || [];
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
        resolve(chunks);
      };
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

export async function saveCompleteFileBlob(fileId: string, blob: Blob): Promise<void> {
  await runTransaction('file_blobs', 'readwrite', (store) =>
    store.put({ fileId, blob, savedAt: Date.now() })
  );
}

export async function getCompleteFileBlob(fileId: string): Promise<Blob | undefined> {
  const record = await runTransaction<{ fileId: string; blob: Blob }>('file_blobs', 'readonly', (store) =>
    store.get(fileId)
  );
  return record?.blob;
}

export async function deleteFileAndChunks(fileId: string): Promise<void> {
  const db = await openDB();
  // Delete metadata
  await runTransaction('files', 'readwrite', (store) => store.delete(fileId));
  // Delete blob
  await runTransaction('file_blobs', 'readwrite', (store) => store.delete(fileId));

  // Delete all chunks
  const chunks = await getAllChunksForFile(fileId);
  const tx = db.transaction('file_chunks', 'readwrite');
  const store = tx.objectStore('file_chunks');
  for (const c of chunks) {
    store.delete(`${fileId}:${c.chunkIndex}`);
  }
}

export async function getStorageStats(): Promise<{
  fileCount: number;
  totalSizeApproxBytes: number;
  files: Array<{ fileId: string; name: string; size: number }>;
}> {
  const allFiles = await getAllFileMetadata();
  let total = 0;
  const list = allFiles.map((f) => {
    total += f.size;
    return { fileId: f.fileId, name: f.name, size: f.size };
  });

  return {
    fileCount: allFiles.length,
    totalSizeApproxBytes: total,
    files: list,
  };
}

export async function clearAllCachedFiles(): Promise<void> {
  const allFiles = await getAllFileMetadata();
  for (const f of allFiles) {
    await deleteFileAndChunks(f.fileId);
  }
}

// ----------------- App Settings -----------------

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const res = await runTransaction<{ key: string; value: T }>('settings', 'readonly', (store) =>
    store.get(key)
  );
  return res ? res.value : defaultValue;
}

export async function saveSetting<T>(key: string, value: T): Promise<void> {
  await runTransaction('settings', 'readwrite', (store) => store.put({ key, value }));
}
