import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { listLocalAccounts } from '../services/auth';
import { ShieldCheck, Lock, Mail, User, KeyRound, AlertTriangle, ArrowRight, UserPlus, Users } from 'lucide-react';

export const AuthScreen: React.FC = () => {
  const { signup, login } = useApp();
  const [isSignup, setIsSignup] = useState(false);

  // Form states
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Local accounts on this device
  const [savedAccounts, setSavedAccounts] = useState<Array<{ email: string; displayName: string }>>([]);

  useEffect(() => {
    listLocalAccounts().then((accs) => {
      setSavedAccounts(accs);
      if (accs.length === 0) {
        setIsSignup(true); // First-time user defaults to signup
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isSignup) {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match');
        }
        await signup({ displayName, email, password });
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication error');
    } finally {
      setLoading(false);
    }
  };

  const selectExistingAccount = (accountEmail: string) => {
    setEmail(accountEmail);
    setIsSignup(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500 p-0.5 shadow-xl shadow-emerald-500/20 mb-3">
            <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center justify-center gap-2">
            MeshChat
            <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Offline P2P
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
            Serverless, zero-cloud peer-to-peer mesh. Messages never touch a central server.
          </p>
        </div>

        {/* Auth Card */}
        <div className="rounded-3xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {/* Mode Switcher Tabs */}
          <div className="flex rounded-xl bg-slate-950 p-1 mb-6 border border-slate-800/80">
            <button
              type="button"
              onClick={() => {
                setIsSignup(false);
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                !isSignup ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setIsSignup(true);
                setError(null);
              }}
              className={`flex-1 py-2 rounded-lg text-xs font-semibold transition ${
                isSignup ? 'bg-slate-800 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-5 flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs animate-shake">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Display Name
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Alice Cooper"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alice@local.p2p"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Password {isSignup && <span className="text-slate-400 font-normal">(min 8 characters)</span>}
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition"
                />
              </div>
            </div>

            {isSignup && (
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Confirm Password
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-xl bg-slate-950 border border-slate-800 pl-10 pr-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs transition duration-150 flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : isSignup ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Generate ECDSA Keypair & Sign Up</span>
                </>
              ) : (
                <>
                  <span>Sign In Locally</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Quick Account Switcher (if multiple accounts saved on device) */}
          {!isSignup && savedAccounts.length > 0 && (
            <div className="mt-6 pt-5 border-t border-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 mb-2.5">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span>Existing Accounts on this Device</span>
              </div>
              <div className="space-y-1.5">
                {savedAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => selectExistingAccount(acc.email)}
                    className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs transition border ${
                      email === acc.email
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/60 text-slate-300'
                    }`}
                  >
                    <div>
                      <p className="font-medium text-white">{acc.displayName}</p>
                      <p className="text-[11px] text-slate-400">{acc.email}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                      Switch
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Offline Security Guarantee */}
          <div className="mt-6 p-3 rounded-2xl bg-slate-950/80 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2.5 leading-relaxed">
            <Lock className="w-4 h-4 flex-shrink-0 text-emerald-400 mt-0.5" />
            <div>
              <strong className="text-slate-200">100% Offline Vault:</strong> Passwords are
              hashed with PBKDF2 (SHA-256, 310,000 iterations). Your private ECDSA key is
              encrypted with AES-GCM and stored only in IndexedDB. No remote servers ever see your credentials.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
