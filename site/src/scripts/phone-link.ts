/**
 * phone-link — the visitor's phone as an UPLINK to the desktop tab's kernel.
 *
 * Architecture, honestly stated:
 *  - The desktop tab mints a random room secret and shows it as a QR code.
 *  - Both devices meet on public Nostr relays ONLY to exchange the WebRTC
 *    handshake, encrypted with a key derived from that secret (relays see
 *    a random room tag and ciphertext — no questions, no content).
 *  - The conversation itself then flows peer-to-peer over a WebRTC data
 *    channel: phone → desktop directly. No server of ours exists; the
 *    static site never sees a byte of it.
 *  - The phone is a dumb terminal: the kernel, the model, the guard, and
 *    the record all stay on the desktop. The bridge on the desktop side
 *    accepts exactly one message type (ask) and rate-limits it.
 *
 * The signaling is a deliberately tiny Nostr client: ephemeral-range kind
 * (relays don't store it), throwaway keypair per session, single room tag.
 */

import { schnorr } from '@noble/curves/secp256k1.js';
import { blake3 } from '@noble/hashes/blake3.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const KIND = 20777; // ephemeral range: relays route, never store
const STUN = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }] };

export type LinkStatus =
  | 'waiting' // signaling up, other end not seen yet
  | 'connecting' // handshake exchanged, ICE in progress
  | 'connected'
  | 'closed'
  | 'failed';

export interface LinkHandle {
  send(msg: unknown): void;
  close(): void;
}

interface LinkCallbacks {
  onStatus(s: LinkStatus, detail?: string): void;
  onMessage(msg: Record<string, unknown>): void;
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const ROOM_TAG_CONTEXT = enc.encode('unicity-aos.phone-link.room-tag.v1');
const AES_KEY_CONTEXT = enc.encode('unicity-aos.phone-link.aes-256-gcm-key.v1');

const b64u = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function mintSecret(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return b64u(b);
}

export function deriveRoomMaterial(secret: string): { tag: string; keyBytes: Uint8Array } {
  const raw = fromB64u(secret);
  const tag = bytesToHex(blake3(raw, { context: ROOM_TAG_CONTEXT, dkLen: 16 }));
  const keyBytes = blake3(raw, { context: AES_KEY_CONTEXT, dkLen: 32 });
  return { tag, keyBytes };
}

async function roomOf(secret: string): Promise<{ tag: string; key: CryptoKey }> {
  // BLAKE3 context mode gives the public room tag and private encryption key
  // independent derivation domains; relays only ever see the tag.
  const { tag, keyBytes } = deriveRoomMaterial(secret);
  const key = await crypto.subtle.importKey('raw', keyBytes.slice().buffer, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  return { tag, key };
}

async function seal(key: CryptoKey, obj: unknown): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64u(out);
}

async function open(key: CryptoKey, content: string): Promise<unknown | null> {
  try {
    const raw = fromB64u(content);
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) },
      key,
      raw.slice(12),
    );
    return JSON.parse(dec.decode(pt)) as unknown;
  } catch {
    return null; // not ours / garbled — ignore
  }
}

/** Minimal Nostr signaling channel: publish + subscribe on one room tag. */
class Signal {
  #sockets: WebSocket[] = [];
  #sk: Uint8Array;
  #pk: string;
  #seen = new Set<string>();
  #key: CryptoKey;
  #tag: string;
  onPayload: ((p: Record<string, unknown>) => void) | null = null;

  constructor(tag: string, key: CryptoKey) {
    this.#tag = tag;
    this.#key = key;
    this.#sk = new Uint8Array(32);
    crypto.getRandomValues(this.#sk);
    this.#pk = bytesToHex(schnorr.getPublicKey(this.#sk));
  }

  start(): void {
    for (const url of RELAYS) {
      try {
        const ws = new WebSocket(url);
        ws.onopen = () => {
          ws.send(
            JSON.stringify([
              'REQ',
              'astrid-link',
              { kinds: [KIND], '#t': [this.#tag], since: Math.floor(Date.now() / 1000) - 30 },
            ]),
          );
        };
        ws.onmessage = (ev) => {
          try {
            const m = JSON.parse(String(ev.data)) as unknown[];
            if (m[0] !== 'EVENT') return;
            const e = m[2] as { id: string; pubkey: string; content: string };
            if (e.pubkey === this.#pk || this.#seen.has(e.id)) return;
            this.#seen.add(e.id);
            void open(this.#key, e.content).then((p) => {
              if (p && typeof p === 'object') this.onPayload?.(p as Record<string, unknown>);
            });
          } catch {
            /* relay noise */
          }
        };
        this.#sockets.push(ws);
      } catch {
        /* relay unreachable — the pool absorbs it */
      }
    }
  }

  async send(payload: unknown): Promise<void> {
    const content = await seal(this.#key, payload);
    const created_at = Math.floor(Date.now() / 1000);
    const tags = [['t', this.#tag]];
    const idPre = JSON.stringify([0, this.#pk, created_at, KIND, tags, content]);
    // NIP-01 defines the event id as SHA-256 of this canonical serialization.
    const id = bytesToHex(sha256(enc.encode(idPre)));
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), this.#sk));
    const evt = JSON.stringify([
      'EVENT',
      { id, pubkey: this.#pk, created_at, kind: KIND, tags, content, sig },
    ]);
    for (const ws of this.#sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(evt);
      else if (ws.readyState === WebSocket.CONNECTING)
        ws.addEventListener('open', () => ws.send(evt), { once: true });
    }
  }

  close(): void {
    for (const ws of this.#sockets) {
      try {
        ws.close();
      } catch {
        /* already down */
      }
    }
    this.#sockets = [];
  }
}

function wirePeer(
  pc: RTCPeerConnection,
  dc: RTCDataChannel | null,
  sig: Signal,
  role: 'host' | 'guest',
  cb: LinkCallbacks,
  onChannel: (dc: RTCDataChannel) => void,
): void {
  pc.onicecandidate = (e) => {
    if (e.candidate) void sig.send({ role, type: 'ice', candidate: e.candidate.toJSON() });
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') cb.onStatus('connected');
    else if (pc.connectionState === 'failed')
      cb.onStatus('failed', "couldn't punch through between the two networks");
    else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed')
      cb.onStatus('closed');
  };
  const attach = (channel: RTCDataChannel) => {
    channel.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as Record<string, unknown>;
        cb.onMessage(m);
      } catch {
        /* only JSON crosses this bridge */
      }
    };
    onChannel(channel);
  };
  if (dc) attach(dc);
  else pc.ondatachannel = (e) => attach(e.channel);
}

/** Desktop side: create the room, wait for the phone, own the channel. */
export async function hostLink(secret: string, cb: LinkCallbacks): Promise<LinkHandle> {
  const { tag, key } = await roomOf(secret);
  const sig = new Signal(tag, key);
  const pc = new RTCPeerConnection(STUN);
  const dc = pc.createDataChannel('astrid-uplink');
  let channel: RTCDataChannel | null = null;
  wirePeer(pc, dc, sig, 'host', cb, (c) => {
    channel = c;
  });

  sig.onPayload = (p) => {
    void (async () => {
      if (p.role !== 'guest') return;
      if (p.type === 'hello') {
        // (re)offer for the guest that just arrived
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sig.send({ role: 'host', type: 'offer', sdp: pc.localDescription });
        cb.onStatus('connecting');
      } else if (p.type === 'answer' && p.sdp) {
        await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit);
      } else if (p.type === 'ice' && p.candidate) {
        await pc.addIceCandidate(p.candidate as RTCIceCandidateInit).catch(() => {});
      }
    })();
  };
  sig.start();
  cb.onStatus('waiting');

  return {
    send(msg: unknown) {
      if (channel?.readyState === 'open') channel.send(JSON.stringify(msg));
    },
    close() {
      sig.close();
      pc.close();
    },
  };
}

/** Phone side: join the room from the QR secret. */
export async function joinLink(secret: string, cb: LinkCallbacks): Promise<LinkHandle> {
  const { tag, key } = await roomOf(secret);
  const sig = new Signal(tag, key);
  const pc = new RTCPeerConnection(STUN);
  let channel: RTCDataChannel | null = null;
  wirePeer(pc, null, sig, 'guest', cb, (c) => {
    channel = c;
  });

  sig.onPayload = (p) => {
    void (async () => {
      if (p.role !== 'host') return;
      if (p.type === 'offer' && p.sdp) {
        await pc.setRemoteDescription(p.sdp as RTCSessionDescriptionInit);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sig.send({ role: 'guest', type: 'answer', sdp: pc.localDescription });
        cb.onStatus('connecting');
      } else if (p.type === 'ice' && p.candidate) {
        await pc.addIceCandidate(p.candidate as RTCIceCandidateInit).catch(() => {});
      }
    })();
  };
  sig.start();
  cb.onStatus('waiting');
  void sig.send({ role: 'guest', type: 'hello' });

  return {
    send(msg: unknown) {
      if (channel?.readyState === 'open') channel.send(JSON.stringify(msg));
    },
    close() {
      sig.close();
      pc.close();
    },
  };
}
