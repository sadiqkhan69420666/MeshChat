import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  getStorageStats,
  deleteFileAndChunks,
  clearAllCachedFiles,
} from '../services/storage';
import {
  X,
  User,
  Key,
  HardDrive,
  Trash2,
  Moon,
  Sun,
  LogOut,
  AlertTriangle,
  Check,
  Copy,
  Shield,
} from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { session, logout, changePassword, deleteAccount, theme, toggleTheme, showToast } = useApp();

  const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'storage'>('profile');

  // Change password form
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passError, setPassError] = useState<string | null>(null);
  const [passLoading, setPassLoading] = useState(false);

  // Delete account form
  const [deletePass, setDeletePass] = useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Storage info
  const [storageStats, setStorageStats] = useState<{
    fileCount: number;
    totalSizeApproxBytes: number;
    files: Array<{ fileId: string; name: string; size: number }>;
  }>({ fileCount: 0, totalSizeApproxBytes: 0, files: [] });

  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStorage();
    }
  }, [isOpen]);

  const loadStorage = async () => {
    const stats = await getStorageStats();
    setStorageStats(stats);
  };

  if (!isOpen || !session) return null;

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);
    if (newPass.length < 8) {
      setPassError('New password must be at least 8 characters');
      return;
    }
    if (newPass !== confirmPass) {
      setPassError('New passwords do not match');
      return;
    }

    setPassLoading(true);
    try {
      await changePassword(currentPass, newPass);
      setCurrentPass('');
      setNewPass('');
      setConfirmPass('');
    } catch (err: any) {
      setPassError(err.message || 'Failed to change password');
    } finally {
      setPassLoading(false);
    }
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletePass) return;
    setDeleteLoading(true);
    try {
      await deleteAccount(deletePass);
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete account', 'warning');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteCachedFile = async (fileId: string) => {
    await deleteFileAndChunks(fileId);
    showToast('File removed from cache', 'info');
    loadStorage();
  };

  const handleClearAllStorage = async () => {
    if (window.confirm('Delete all cached files from this device?')) {
      await clearAllCachedFiles();
      showToast('All cached files cleared', 'info');
      loadStorage();
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const copyFullPublicKey = () => {
    navigator.clipboard.writeText(JSON.stringify(session.publicKeyJwk, null, 2));
    setCopiedKey(true);
    showToast('Full ECDSA public key copied', 'info');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-3xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <h3 className="text-base font-bold text-white">Settings &amp; Vault</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex-1 py-3 transition ${
              activeTab === 'profile'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Profile &amp; Keys
          </button>
          <button
            onClick={() => setActiveTab('security')}
            className={`flex-1 py-3 transition ${
              activeTab === 'security'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Security &amp; Account
          </button>
          <button
            onClick={() => setActiveTab('storage')}
            className={`flex-1 py-3 transition ${
              activeTab === 'storage'
                ? 'text-emerald-400 border-b-2 border-emerald-500 bg-slate-900'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Storage &amp; Files
          </button>
        </div>

        {/* Tab contents */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80">
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                  Account Identity
                </span>
                <p className="text-sm font-bold text-white mt-1">{session.displayName}</p>
                <p className="text-xs text-slate-400">{session.email}</p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    ECDSA P-256 Public Key Fingerprint
                  </span>
                  <button
                    onClick={copyFullPublicKey}
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy JWK'}</span>
                  </button>
                </div>
                <p className="font-mono text-xs text-slate-300 break-all p-2 rounded-xl bg-slate-900 border border-slate-800">
                  {session.publicKeyId}
                </p>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  Used by peers to cryptographically verify every chat message and file you author.
                </p>
              </div>

              {/* Theme Switcher */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold text-white">App Appearance</h4>
                  <p className="text-[11px] text-slate-400">Current mode: {theme === 'dark' ? 'Dark Matrix' : 'Light Theme'}</p>
                </div>
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                >
                  {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
                  <span>Toggle</span>
                </button>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    logout();
                    onClose();
                  }}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Log Out of this Device</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-5">
              {/* Change Password */}
              <form onSubmit={handlePasswordChange} className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-white">
                  <Key className="w-4 h-4 text-emerald-400" />
                  <span>Change Device Password</span>
                </div>

                {passError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 p-2 rounded-lg border border-rose-500/20">
                    {passError}
                  </p>
                )}

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Current Password</label>
                  <input
                    type="password"
                    required
                    value={currentPass}
                    onChange={(e) => setCurrentPass(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">New Password (min 8 chars)</label>
                  <input
                    type="password"
                    required
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    className="w-full rounded-xl bg-slate-900 border border-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={passLoading || !currentPass || !newPass}
                  className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold text-xs transition cursor-pointer"
                >
                  {passLoading ? 'Updating...' : 'Update Password & Re-encrypt Keys'}
                </button>
              </form>

              {/* Danger Zone: Delete Account */}
              <div className="p-4 rounded-2xl bg-rose-950/20 border border-rose-500/30 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-rose-300">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>Delete Account from this Device</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  This wipes your account profile and private ECDSA keys permanently from this device's IndexedDB.
                </p>

                {!deleteConfirmOpen ? (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="px-4 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition cursor-pointer"
                  >
                    Delete Account...
                  </button>
                ) : (
                  <form onSubmit={handleDeleteAccount} className="space-y-3 pt-2">
                    <label className="block text-[11px] text-rose-300">
                      Confirm by entering your password:
                    </label>
                    <input
                      type="password"
                      required
                      value={deletePass}
                      onChange={(e) => setDeletePass(e.target.value)}
                      placeholder="Your current password"
                      className="w-full rounded-xl bg-slate-950 border border-rose-500/40 px-3 py-2 text-xs text-white focus:outline-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmOpen(false)}
                        className="px-3 py-1.5 rounded-xl text-xs text-slate-400 hover:text-white"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={deleteLoading || !deletePass}
                        className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        {deleteLoading ? 'Deleting...' : 'Permanently Delete'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}

          {activeTab === 'storage' && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    Cached Files &amp; 64KB Chunks
                  </span>
                  <p className="text-base font-bold text-white mt-1">
                    {storageStats.fileCount} file{storageStats.fileCount === 1 ? '' : 's'} (
                    {formatBytes(storageStats.totalSizeApproxBytes)})
                  </p>
                </div>
                {storageStats.fileCount > 0 && (
                  <button
                    onClick={handleClearAllStorage}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {storageStats.files.length === 0 ? (
                <div className="p-8 text-center text-slate-400 border border-dashed border-slate-800 rounded-2xl">
                  <HardDrive className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                  <p className="text-xs font-medium text-slate-300">No files stored locally yet</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Attached images and documents will appear here with storage management.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {storageStats.files.map((f) => (
                    <div
                      key={f.fileId}
                      className="p-3 rounded-2xl bg-slate-950 border border-slate-800/80 flex items-center justify-between"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="text-xs font-semibold text-slate-200 truncate">{f.name}</p>
                        <p className="text-[11px] text-slate-400">{formatBytes(f.size)}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteCachedFile(f.fileId)}
                        className="p-1.5 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-slate-900 transition"
                        title="Delete cached file"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
