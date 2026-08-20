/*
 * src/lib/collab-provider.ts — live collaborative editing transport over Supabase Realtime.
 * ---------------------------------------------------------------------------
 * Syncs a Y.Doc + awareness (live cursors / "who's here") between everyone in a room (one post),
 * using Supabase Realtime BROADCAST as the peer mesh — no extra websocket server or Durable Object.
 * It runs the standard y-protocols sync + awareness handshake and base64-frames the binary
 * messages so they ride inside Supabase's JSON broadcast payloads.
 *
 * Every peer is equal (no server authority): on join we send sync-step-1 (our state vector); peers
 * reply with the updates we're missing; thereafter each local edit is broadcast as an update. This
 * converges because Yjs is a CRDT — order and duplication don't matter.
 *
 * Used only by the editor when a post actually has co-authors; solo editing never constructs one.
 */
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as sync from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;

// Uint8Array <-> base64 (broadcast payloads are JSON, so binary can't ride raw).
const toB64 = (u8: Uint8Array) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH) as unknown as number[]); return btoa(s); };
const fromB64 = (b64: string) => { const s = atob(b64); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; };

export interface CollabUser { name: string; color: string; handle?: string | null; }

export class SupabaseCollabProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  private channel: any;
  private subscribed = false;
  synced = false;
  onSynced?: () => void;
  onPeers?: (count: number) => void;

  constructor(supabase: any, room: string, doc: Y.Doc, user?: CollabUser) {
    this.doc = doc;
    this.awareness = new Awareness(doc);
    if (user) this.awareness.setLocalStateField('user', user);

    this._onDocUpdate = this._onDocUpdate.bind(this);
    this._onAwareUpdate = this._onAwareUpdate.bind(this);
    doc.on('update', this._onDocUpdate);
    this.awareness.on('update', this._onAwareUpdate);

    this.channel = supabase.channel('collab:' + room, { config: { broadcast: { self: false, ack: false } } });
    this.channel.on('broadcast', { event: 'y' }, (msg: any) => this._recv(msg && msg.payload));
    this.channel.subscribe((status: string) => {
      if (status !== 'SUBSCRIBED') return;
      this.subscribed = true;
      // sync-step-1: send our state vector so peers send back what we're missing
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      sync.writeSyncStep1(enc, doc);
      this._send(enc);
      // ask peers for their awareness, and announce ours
      const q = encoding.createEncoder();
      encoding.writeVarUint(q, MSG_QUERY_AWARENESS);
      this._send(q);
      this._broadcastAwareness([doc.clientID]);
    });

    if (typeof window !== 'undefined') window.addEventListener('beforeunload', this._leave);
  }

  private _leave = () => { this.destroy(); };

  private _send(enc: any) {
    if (!this.subscribed) return;
    this.channel.send({ type: 'broadcast', event: 'y', payload: { b64: toB64(encoding.toUint8Array(enc)) } });
  }

  private _onDocUpdate(update: Uint8Array, origin: any) {
    if (origin === this) return;                 // remote-applied update — don't echo it back
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    sync.writeUpdate(enc, update);
    this._send(enc);
  }

  private _broadcastAwareness(clients: number[]) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_AWARENESS);
    encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(this.awareness, clients));
    this._send(enc);
  }
  private _onAwareUpdate({ added, updated, removed }: any) {
    this._broadcastAwareness([...added, ...updated, ...removed]);
    this.onPeers?.(this.awareness.getStates().size);
  }

  private _recv(payload: any) {
    if (!payload || !payload.b64) return;
    let dec;
    try { dec = decoding.createDecoder(fromB64(payload.b64)); } catch { return; }
    const type = decoding.readVarUint(dec);
    if (type === MSG_SYNC) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MSG_SYNC);
      const syncType = sync.readSyncMessage(dec, enc, this.doc, this); // origin=this → _onDocUpdate ignores
      if (encoding.length(enc) > 1) this._send(enc);                    // a reply was produced (step2 / update)
      if (!this.synced && syncType === sync.messageYjsSyncStep2) { this.synced = true; this.onSynced?.(); }
    } else if (type === MSG_AWARENESS) {
      applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(dec), this);
      this.onPeers?.(this.awareness.getStates().size);
    } else if (type === MSG_QUERY_AWARENESS) {
      this._broadcastAwareness(Array.from(this.awareness.getStates().keys()));
    }
  }

  /** Everyone currently in the room (including self), for a presence row. */
  peers(): CollabUser[] {
    const out: CollabUser[] = [];
    this.awareness.getStates().forEach((st: any) => { if (st && st.user) out.push(st.user); });
    return out;
  }

  destroy() {
    try { window.removeEventListener('beforeunload', this._leave); } catch { /* no window */ }
    try { removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy'); } catch { /* ignore */ }
    try { this.doc.off('update', this._onDocUpdate); } catch { /* ignore */ }
    try { this.awareness.off('update', this._onAwareUpdate); } catch { /* ignore */ }
    try { this.channel.unsubscribe(); } catch { /* ignore */ }
    this.subscribed = false;
  }
}
