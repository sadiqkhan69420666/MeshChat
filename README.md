# MeshChat - Fully Offline, Serverless P2P Group Chat (PWA)

MeshChat is an installable Progressive Web App (PWA) that enables group chat and raw byte file sharing directly between devices without a central server, signaling backend, or internet connection.

---

## 🚀 Key Features

1. **Local Authentication & Vault (Zero Remote Credentials)**
   - Accounts and sessions are stored strictly on-device in **IndexedDB**.
   - Passwords are never stored in plaintext: hashed with **PBKDF2** (SHA-256, 310,000 iterations, unique random salt per user).
   - Password verification performed in **constant time** to prevent timing attacks.
   - An **ECDSA P-256 keypair** is generated per user. The public key is shared across the mesh, and the private signing key is encrypted with an **AES-GCM-256** key derived from the user's password.
   - Support for multiple accounts per device, password changes, account deletion, and 5-attempt rate-limiting lockout with backoff.

2. **Serverless Peer-to-Peer Mesh Networking**
   - **WebRTC Data Channels only** — no signaling server required.
   - **Manual Signaling via QR Code or Text Blob**:
     - Initiator creates an Invite (Offer) with complete self-contained host & srflx ICE candidates.
     - Peer scans the QR code (built-in camera scanner with `jsqr`) or pastes the compressed blob.
     - Peer generates a Return Answer QR code for the initiator to scan.
     - Direct WebRTC connection establishes immediately!
   - **Gossip & Flood Forwarding**: Each peer relays received messages to all other connected peers (`ttl` hop-limited).
   - **Signature Verification**: Every message is verified against the author's public key before being displayed or relayed.
   - **Deduplication**: Message UUIDs prevent loops.
   - **Peer-List Gossip**: Nodes share reachable presence so the interactive Network Topology map displays multi-hop neighbors.

3. **Groups & Store-and-Forward Sync**
   - Create channels and join by room ID.
   - **End-to-End Encryption (E2EE)**: Optional AES-GCM-256 group encryption derived from a group passphrase.
   - **Offline Store-and-Forward**: Messages are saved in IndexedDB. When two peers pair, they exchange a compact summary (`sync-summary`) and sync missing messages automatically.

4. **Peer-to-Peer File Swarming (Any File Type)**
   - Attach images, videos, audio, PDFs, archives, or binaries.
   - Files are split into **64 KB chunks**, each validated with **SHA-256**.
   - Peers request missing chunks in parallel (`file-chunk-req`), reassemble, and verify integrity.
   - Backpressure management (`bufferedAmount` & `onbufferedamountlow`) prevents data channel overflows.
   - Inline preview for images, audio, and video; direct download button for documents.
   - Storage manager in Settings allows inspecting and clearing cached file chunks.

5. **Installable PWA**
   - Service worker precaches all application scripts and styles via `vite-plugin-pwa` for 100% offline launches.
   - Meets all Web App Manifest standards with 192x192, 512x512, and maskable icons.
   - In-app install banner with iOS Safari guidance.

---

## 📱 How to Connect Devices Offline

### Scenario 1: Same Local Wi-Fi or Phone Hotspot (No Internet Needed)
1. Ensure both devices are connected to the same Wi-Fi router OR have one phone turn on a **Personal Wi-Fi Hotspot** and connect the second device to it.
2. Open **MeshChat** on both devices.
3. On **Device A**:
   - Tap **Connect Peer** -> **Create Invite**.
   - A QR code representing the compressed WebRTC offer appears.
4. On **Device B**:
   - Tap **Connect Peer** -> **Join / Accept Invite**.
   - Point Device B's camera at Device A's screen.
   - Device B accepts the offer and shows a **Return Answer QR Code**.
5. On **Device A**:
   - Tap **Step 2: Scan Peer's Return Answer** and point Device A's camera at Device B's screen.
6. **Handshake complete!** You are now connected directly over WebRTC.

### Scenario 2: Connecting a Third Peer
- Connect Device C to Device B using the same QR flow.
- Messages sent by Device A will now automatically flood through Device B to reach Device C!

---

## ⚠️ Known Limitations & Technical Notes

1. **Subnets and Symmetric NATs**:
   - WebRTC host candidates allow direct local connection across any devices that can route IP packets between each other (e.g. same Wi-Fi, hotspot, or local subnet).
   - If two devices are on completely distinct cellular networks or strict asymmetric corporate NATs without a STUN/TURN server or route, direct UDP packets cannot traverse. For pure offline use, using a local Wi-Fi router or phone hotspot is the recommended medium.

2. **iOS WebKit Background Restrictions**:
   - iOS Safari suspends WebRTC data channels when the browser tab is sent to the background or the screen locks. Keeping the app in the foreground or installed to the home screen as a standalone PWA ensures persistent connections while active.

3. **Storage Quotas**:
   - Large file swarms are stored in browser IndexedDB. Most browsers allocate up to 60-80% of available disk space to IndexedDB. Use the **Storage & Files** tab in Settings to clear old cached chunks if space is constrained.
