/**
 * MeshChat Local Authentication Service
 * Manages user accounts, PBKDF2 hashing, ECDSA keypairs, rate-limiting, and sessions.
 */

import { UserAccount, UserSession } from '../types';
import {
  constantTimeEqual,
  getRandomBytes,
  bufferToHex,
  hashPasswordWithSalt,
  deriveKeyFromPassword,
  generateUserKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  decryptPrivateKeyJwk,
} from './crypto';
import {
  getAccountByEmail,
  saveAccount,
  deleteAccount as dbDeleteAccount,
  saveActiveSession,
  getActiveSession,
  clearActiveSession,
  getRateLimitRecord,
  recordFailedLogin,
  resetFailedLogin,
  getAllAccounts,
  saveSessionCryptoKey,
  getSessionCryptoKey,
  savePinnedIdentity,
} from './storage';

// Keep private signing key in active memory only
let activePrivateKey: CryptoKey | null = null;
let currentSession: UserSession | null = null;

export function getActivePrivateKey(): CryptoKey | null {
  return activePrivateKey;
}

export function isPrivateKeyUnlocked(): boolean {
  return activePrivateKey !== null;
}

export function getCurrentSession(): UserSession | null {
  return currentSession;
}

export interface SignupParams {
  displayName: string;
  email: string;
  password: string;
}

export async function signup(params: SignupParams): Promise<UserSession> {
  const { displayName, email, password } = params;

  // Validation
  const trimmedName = displayName.trim();
  const trimmedEmail = email.trim().toLowerCase();

  if (!trimmedName) {
    throw new Error('Display name is required');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    throw new Error('Please enter a valid email address');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  // Check unique email on this device
  const existing = await getAccountByEmail(trimmedEmail);
  if (existing) {
    throw new Error('An account with this email already exists on this device');
  }

  // Generate salts (32 bytes each)
  const passwordSalt = getRandomBytes(32);
  const encryptionSalt = getRandomBytes(32);

  // Hash password with PBKDF2 (310,000 iterations, SHA-256)
  const passwordHashHex = await hashPasswordWithSalt(password, passwordSalt);

  // Derive AES-GCM key to encrypt private ECDSA key
  const aesKey = await deriveKeyFromPassword(password, encryptionSalt);

  // Generate ECDSA P-256 Keypair
  const { publicKeyJwk, publicKeyId, privateKey, privateKeyJwk } = await generateUserKeyPair();

  // Encrypt private key with AES-GCM
  const encryptedPrivateKey = await encryptPrivateKey(privateKeyJwk, aesKey);

  const accountId = crypto.randomUUID();
  const newAccount: UserAccount = {
    id: accountId,
    email: trimmedEmail,
    displayName: trimmedName,
    passwordSaltHex: bufferToHex(passwordSalt),
    passwordHashHex,
    encryptionSaltHex: bufferToHex(encryptionSalt),
    encryptedPrivateKey,
    publicKeyJwk,
    publicKeyId,
    createdAt: Date.now(),
  };

  await saveAccount(newAccount);

  // Import private key as non-extractable CryptoKey so memory and session storage match login
  const nonExtractablePrivateKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Set active session in memory and IndexedDB
  activePrivateKey = nonExtractablePrivateKey;
  currentSession = {
    userId: accountId,
    email: trimmedEmail,
    displayName: trimmedName,
    publicKeyJwk,
    publicKeyId,
  };

  await saveActiveSession({
    userId: accountId,
    email: trimmedEmail,
    displayName: trimmedName,
    publicKeyJwk,
    publicKeyId,
    encryptedPrivateKey,
    encryptionSaltHex: newAccount.encryptionSaltHex,
  });

  // Save non-extractable session CryptoKey in IndexedDB for seamless reload persistence
  await saveSessionCryptoKey(nonExtractablePrivateKey);

  // Pin user's own identity locally
  await savePinnedIdentity({
    senderId: accountId,
    displayName: trimmedName,
    publicKeyJwk,
    publicKeyId,
    verifiedByHandshake: true,
    pinnedAt: Date.now(),
  });

  return currentSession;
}

export async function login(email: string, password: string): Promise<UserSession> {
  const trimmedEmail = email.trim().toLowerCase();

  // Check rate limit
  const rateLimit = await getRateLimitRecord(trimmedEmail);
  if (rateLimit && rateLimit.lockedUntil > Date.now()) {
    const remainingSecs = Math.ceil((rateLimit.lockedUntil - Date.now()) / 1000);
    throw new Error(`Too many failed login attempts. Account locked. Please wait ${remainingSecs} seconds.`);
  }

  const account = await getAccountByEmail(trimmedEmail);
  if (!account) {
    await recordFailedLogin(trimmedEmail);
    throw new Error('Invalid email or password');
  }

  // Hash provided password using user's stored salt
  const salt = new TextEncoder().encode(account.passwordSaltHex); // or hexToBuffer
  const { hexToBuffer } = await import('./crypto');
  const saltBytes = hexToBuffer(account.passwordSaltHex);

  const calculatedHashHex = await hashPasswordWithSalt(password, saltBytes);

  // Constant-time comparison
  const isValid = constantTimeEqual(calculatedHashHex, account.passwordHashHex);
  if (!isValid) {
    const updatedRate = await recordFailedLogin(trimmedEmail);
    if (updatedRate.lockedUntil > Date.now()) {
      const waitSec = Math.ceil((updatedRate.lockedUntil - Date.now()) / 1000);
      throw new Error(`Invalid credentials. Account locked for ${waitSec} seconds due to repeated failures.`);
    }
    const attemptsLeft = Math.max(0, 5 - updatedRate.failedCount);
    throw new Error(
      attemptsLeft > 0
        ? `Invalid email or password (${attemptsLeft} attempt${attemptsLeft === 1 ? '' : 's'} remaining before lockout)`
        : 'Invalid email or password'
    );
  }

  // Successful login -> reset rate limit
  await resetFailedLogin(trimmedEmail);

  // Decrypt private ECDSA key with password
  const encSaltBytes = hexToBuffer(account.encryptionSaltHex);
  const aesKey = await deriveKeyFromPassword(password, encSaltBytes);

  let privateKey: CryptoKey;
  try {
    privateKey = await decryptPrivateKey(account.encryptedPrivateKey, aesKey);
  } catch (err) {
    throw new Error('Failed to decrypt private key. Password verification mismatch.');
  }

  activePrivateKey = privateKey;
  currentSession = {
    userId: account.id,
    email: account.email,
    displayName: account.displayName,
    publicKeyJwk: account.publicKeyJwk,
    publicKeyId: account.publicKeyId,
  };

  await saveActiveSession({
    userId: account.id,
    email: account.email,
    displayName: account.displayName,
    publicKeyJwk: account.publicKeyJwk,
    publicKeyId: account.publicKeyId,
    encryptedPrivateKey: account.encryptedPrivateKey,
    encryptionSaltHex: account.encryptionSaltHex,
  });

  // Persist session key in IndexedDB for seamless reload
  await saveSessionCryptoKey(privateKey);

  // Pin user identity locally
  await savePinnedIdentity({
    senderId: account.id,
    displayName: account.displayName,
    publicKeyJwk: account.publicKeyJwk,
    publicKeyId: account.publicKeyId,
    verifiedByHandshake: true,
    pinnedAt: Date.now(),
  });

  return currentSession;
}

export async function restoreSession(password?: string): Promise<UserSession | null> {
  const saved = await getActiveSession();
  if (!saved) {
    return null;
  }

  // Check if account still exists
  const account = await getAccountByEmail(saved.email);
  if (!account) {
    await clearActiveSession();
    return null;
  }

  currentSession = {
    userId: account.id,
    email: account.email,
    displayName: account.displayName,
    publicKeyJwk: account.publicKeyJwk,
    publicKeyId: account.publicKeyId,
  };

  // If password was supplied, restore private key immediately
  if (password) {
    const { hexToBuffer } = await import('./crypto');
    const encSaltBytes = hexToBuffer(account.encryptionSaltHex);
    const aesKey = await deriveKeyFromPassword(password, encSaltBytes);
    activePrivateKey = await decryptPrivateKey(account.encryptedPrivateKey, aesKey);
    await saveSessionCryptoKey(activePrivateKey);
  } else {
    // Restore session CryptoKey from IndexedDB
    try {
      const storedKey = await getSessionCryptoKey();
      if (storedKey) {
        activePrivateKey = storedKey;
      }
    } catch (err) {
      console.warn('Could not restore session CryptoKey from IndexedDB:', err);
    }
  }

  return currentSession;
}

export async function unlockPrivateKeyWithPassword(password: string): Promise<boolean> {
  if (!currentSession) return false;
  const account = await getAccountByEmail(currentSession.email);
  if (!account) return false;

  const { hexToBuffer } = await import('./crypto');
  const encSaltBytes = hexToBuffer(account.encryptionSaltHex);
  const aesKey = await deriveKeyFromPassword(password, encSaltBytes);

  try {
    activePrivateKey = await decryptPrivateKey(account.encryptedPrivateKey, aesKey);
    await saveSessionCryptoKey(activePrivateKey);
    return true;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  activePrivateKey = null;
  currentSession = null;
  await clearActiveSession();
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  if (!currentSession) throw new Error('Not logged in');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters long');

  const account = await getAccountByEmail(currentSession.email);
  if (!account) throw new Error('Account not found');

  const { hexToBuffer, bufferToHex } = await import('./crypto');

  // Verify current password
  const oldSaltBytes = hexToBuffer(account.passwordSaltHex);
  const oldHash = await hashPasswordWithSalt(currentPassword, oldSaltBytes);
  if (!constantTimeEqual(oldHash, account.passwordHashHex)) {
    throw new Error('Current password is incorrect');
  }

  // Decrypt current private key JWK directly from encrypted bytes (no exportKey needed on non-extractable key)
  const oldEncSalt = hexToBuffer(account.encryptionSaltHex);
  const oldAesKey = await deriveKeyFromPassword(currentPassword, oldEncSalt);
  const privateKeyJwk = await decryptPrivateKeyJwk(account.encryptedPrivateKey, oldAesKey);

  // Generate new salts
  const newPasswordSalt = getRandomBytes(32);
  const newEncSalt = getRandomBytes(32);

  // Hash new password
  const newPasswordHashHex = await hashPasswordWithSalt(newPassword, newPasswordSalt);

  // Re-encrypt private key with new password
  const newAesKey = await deriveKeyFromPassword(newPassword, newEncSalt);
  const newEncryptedPrivateKey = await encryptPrivateKey(privateKeyJwk, newAesKey);

  // Re-import as non-extractable CryptoKey for active session
  const newNonExtractableKey = await crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  // Update account in DB
  const updatedAccount: UserAccount = {
    ...account,
    passwordSaltHex: bufferToHex(newPasswordSalt),
    passwordHashHex: newPasswordHashHex,
    encryptionSaltHex: bufferToHex(newEncSalt),
    encryptedPrivateKey: newEncryptedPrivateKey,
  };

  await saveAccount(updatedAccount);
  activePrivateKey = newNonExtractableKey;
  await saveSessionCryptoKey(newNonExtractableKey);
}

export async function deleteAccount(password: string): Promise<void> {
  if (!currentSession) throw new Error('Not logged in');
  const account = await getAccountByEmail(currentSession.email);
  if (!account) throw new Error('Account not found');

  const { hexToBuffer } = await import('./crypto');
  const saltBytes = hexToBuffer(account.passwordSaltHex);
  const hash = await hashPasswordWithSalt(password, saltBytes);
  if (!constantTimeEqual(hash, account.passwordHashHex)) {
    throw new Error('Incorrect password');
  }

  await dbDeleteAccount(account.email);
  await logout();
}

export async function listLocalAccounts(): Promise<Array<{ email: string; displayName: string; id: string }>> {
  const accounts = await getAllAccounts();
  return accounts.map((a) => ({
    email: a.email,
    displayName: a.displayName,
    id: a.id,
  }));
}
