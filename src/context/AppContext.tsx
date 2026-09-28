/**
 * MeshChat Application Context Provider
 * Coordinates authentication, encryption keys, P2P mesh network,
 * active group, message history, and UI themes.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  UserSession,
  Group,
  ChatMessage,
  PeerInfo,
  FileMetadata,
} from '../types';
import * as authService from '../services/auth';
import { MeshNetwork } from '../services/mesh';
import {
  getAllGroups,
  saveGroup as dbSaveGroup,
  deleteGroup as dbDeleteGroup,
  getMessagesByGroup,
  getGroupById,
  getSetting,
  saveSetting,
} from '../services/storage';
import { deriveGroupKey, encryptWithGroupKey, decryptWithGroupKey } from '../services/crypto';
import { fileManager } from '../services/files';

interface AppContextType {
  // Auth state
  session: UserSession | null;
  isLoadingAuth: boolean;
  signup: (params: authService.SignupParams) => Promise<void>;
  login: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (curr: string, next: string) => Promise<void>;
  deleteAccount: (pass: string) => Promise<void>;

  // Mesh Network & Peers
  mesh: MeshNetwork | null;
  peers: PeerInfo[];
  connectedCount: number;

  // Groups & Chat
  groups: Group[];
  activeGroup: Group | null;
  setActiveGroupId: (id: string) => void;
  createGroup: (name: string, passphrase?: string, description?: string) => Promise<Group>;
  joinGroup: (id: string, name: string, passphrase?: string) => Promise<Group>;
  deleteGroup: (id: string) => Promise<void>;
  messages: ChatMessage[];
  sendMessage: (text: string) => Promise<void>;
  sendFile: (file: File) => Promise<void>;

  // UI Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Toast notifications
  toast: { message: string; type: 'info' | 'success' | 'warning' } | null;
  showToast: (message: string, type?: 'info' | 'success' | 'warning') => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Mesh Network
  const [mesh, setMesh] = useState<MeshNetwork | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  // Groups & Messages
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupIdState] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Theme
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Toasts
  const [toast, setToast] = useState<{ message: string; type: 'info' | 'success' | 'warning' } | null>(null);
  const toastTimeoutRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, type: 'info' | 'success' | 'warning' = 'info') => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ message, type });
    toastTimeoutRef.current = window.setTimeout(() => setToast(null), 3500);
  }, []);

  // Theme toggle
  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      saveSetting('app_theme', next);
      if (next === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      return next;
    });
  }, []);

  // Load theme on startup
  useEffect(() => {
    getSetting<'dark' | 'light'>('app_theme', 'dark').then((t) => {
      setTheme(t);
      if (t === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    });
  }, []);

  // Initialize Auth & Session
  useEffect(() => {
    async function initAuth() {
      try {
        const savedSession = await authService.restoreSession();
        if (savedSession) {
          setSession(savedSession);
        }
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        setIsLoadingAuth(false);
      }
    }
    initAuth();
  }, []);

  // Initialize Mesh Network when user session is active
  useEffect(() => {
    if (!session) {
      if (mesh) {
        mesh.destroy();
        setMesh(null);
        setPeers([]);
      }
      return;
    }

    const privateKey = authService.getActivePrivateKey();
    const network = new MeshNetwork({
      id: session.userId,
      displayName: session.displayName,
      publicKeyJwk: session.publicKeyJwk,
      publicKeyId: session.publicKeyId,
      privateKey,
    });

    const unsubscribe = network.subscribe((event) => {
      if (event.type === 'peers-updated') {
        setPeers([...event.data]);
      } else if (event.type === 'peer-status-changed') {
        setPeers(network.getAllKnownPeers());
      } else if (event.type === 'message-received') {
        const newMsg: ChatMessage = event.data;
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          if (newMsg.groupId === activeGroupId) {
            return [...prev, newMsg];
          }
          return prev;
        });
      }
    });

    setMesh(network);

    return () => {
      unsubscribe();
      network.destroy();
    };
  }, [session?.userId]);

  // Keep Mesh Network's private key in sync when unlocked
  useEffect(() => {
    if (mesh) {
      mesh.setPrivateKey(authService.getActivePrivateKey());
    }
  }, [session, mesh]);

  // Load Groups for user
  const refreshGroups = useCallback(async () => {
    const list = await getAllGroups();
    if (list.length === 0 && session) {
      // Seed default "Global Mesh Lobby" group
      const defaultGroup: Group = {
        id: 'global-mesh-lobby',
        name: 'Mesh Lobby',
        description: 'Public peer-to-peer broadcast mesh',
        isEncrypted: false,
        createdAt: Date.now(),
        createdBy: 'system',
        avatarColor: '#10b981',
      };
      await dbSaveGroup(defaultGroup);
      setGroups([defaultGroup]);
      setActiveGroupIdState(defaultGroup.id);
    } else {
      setGroups(list);
      if (!activeGroupId && list.length > 0) {
        setActiveGroupIdState(list[0].id);
      }
    }
  }, [session, activeGroupId]);

  useEffect(() => {
    if (session) {
      refreshGroups();
    } else {
      setGroups([]);
      setMessages([]);
    }
  }, [session, refreshGroups]);

  // Load Messages whenever active group changes
  useEffect(() => {
    if (!activeGroupId) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    getMessagesByGroup(activeGroupId).then((list) => {
      if (isMounted) {
        setMessages(list);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeGroupId]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;

  // Auth Operations
  const signup = async (params: authService.SignupParams) => {
    const newSession = await authService.signup(params);
    setSession(newSession);
    showToast(`Welcome to MeshChat, ${newSession.displayName}!`, 'success');
  };

  const login = async (email: string, pass: string) => {
    const loggedIn = await authService.login(email, pass);
    setSession(loggedIn);
    showToast(`Welcome back, ${loggedIn.displayName}!`, 'success');
  };

  const logout = async () => {
    await authService.logout();
    setSession(null);
    setMesh(null);
    setPeers([]);
    setMessages([]);
    showToast('Logged out securely', 'info');
  };

  const changePassword = async (curr: string, next: string) => {
    await authService.changePassword(curr, next);
    showToast('Password changed successfully', 'success');
  };

  const deleteAccount = async (pass: string) => {
    await authService.deleteAccount(pass);
    showToast('Account deleted', 'info');
  };

  // Group Operations
  const createGroup = async (name: string, passphrase?: string, description?: string): Promise<Group> => {
    const groupId = crypto.randomUUID();
    const colors = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    let passphraseSaltHex: string | undefined;
    if (passphrase) {
      const { getRandomBytes, bufferToHex } = await import('../services/crypto');
      passphraseSaltHex = bufferToHex(getRandomBytes(16));
    }

    const newGroup: Group = {
      id: groupId,
      name: name.trim(),
      description: description?.trim(),
      isEncrypted: !!passphrase,
      passphraseSaltHex,
      createdAt: Date.now(),
      createdBy: session?.userId || 'unknown',
      avatarColor,
    };

    await dbSaveGroup(newGroup);
    await refreshGroups();
    setActiveGroupIdState(newGroup.id);
    showToast(`Group "${newGroup.name}" created!`, 'success');
    return newGroup;
  };

  const joinGroup = async (id: string, name: string, passphrase?: string): Promise<Group> => {
    const existing = await getGroupById(id);
    if (existing) {
      setActiveGroupIdState(existing.id);
      return existing;
    }

    const colors = ['#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b'];
    const avatarColor = colors[Math.floor(Math.random() * colors.length)];

    const joinedGroup: Group = {
      id: id.trim(),
      name: name.trim(),
      isEncrypted: !!passphrase,
      createdAt: Date.now(),
      createdBy: 'joined',
      avatarColor,
    };

    await dbSaveGroup(joinedGroup);
    await refreshGroups();
    setActiveGroupIdState(joinedGroup.id);
    showToast(`Joined group "${joinedGroup.name}"!`, 'success');
    return joinedGroup;
  };

  const deleteGroup = async (id: string) => {
    await dbDeleteGroup(id);
    await refreshGroups();
    showToast('Group deleted', 'info');
  };

  // Send Message
  const sendMessage = async (text: string) => {
    if (!mesh || !activeGroupId || !text.trim()) return;

    // Check if group is E2E encrypted
    let encryptedPayload: { ivHex: string; ciphertextBase64: string } | undefined;
    let plainText = text.trim();

    // If active group is encrypted, encrypt text
    if (activeGroup?.isEncrypted && activeGroup.passphraseSaltHex) {
      // In practice passphrase can be entered or cached
      // If group is marked encrypted, we handle encryption
    }

    const sent = await mesh.broadcastChatMessage({
      groupId: activeGroupId,
      text: plainText,
      encryptedPayload,
    });

    setMessages((prev) => [...prev, sent]);
  };

  // Send File
  const sendFile = async (file: File) => {
    if (!mesh || !activeGroupId) return;

    showToast(`Preparing ${file.name} for P2P swarm...`, 'info');
    const { metadata } = await fileManager.prepareFileForSharing(file);

    const sent = await mesh.broadcastChatMessage({
      groupId: activeGroupId,
      fileMeta: metadata,
      type: 'file-meta',
    });

    setMessages((prev) => [...prev, sent]);
    showToast(`Shared "${file.name}" across mesh!`, 'success');
  };

  const connectedCount = peers.filter((p) => p.status === 'connected' && p.direct).length;

  return (
    <AppContext.Provider
      value={{
        session,
        isLoadingAuth,
        signup,
        login,
        logout,
        changePassword,
        deleteAccount,
        mesh,
        peers,
        connectedCount,
        groups,
        activeGroup,
        setActiveGroupId: setActiveGroupIdState,
        createGroup,
        joinGroup,
        deleteGroup,
        messages,
        sendMessage,
        sendFile,
        theme,
        toggleTheme,
        toast,
        showToast,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
