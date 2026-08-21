/*
 * src/lib/coedit.ts — start/stop live co-editing for one post, on top of Milkdown's official
 * @milkdown/plugin-collab (y-prosemirror) and our serverless SupabaseCollabProvider transport.
 *
 * Seeding is race-safe for a serverless mesh with no authority:
 *   • If a peer is already in the room, their sync-step-2 arrives first (provider.onSynced) → we
 *     connect WITHOUT seeding, and y-prosemirror populates the editor from the shared doc.
 *   • If nobody replies within the window, we are the first in the room → we applyTemplate(markdown)
 *     to seed the shared doc from the post's current text, then connect. applyTemplate's own guard
 *     (only when the shared doc is empty) is a second backstop against double-seeding.
 *
 * Only ever constructed for a co-authored post; solo editing never loads the collab plugin at all.
 */
import * as Y from 'yjs';
import { SupabaseCollabProvider, type CollabUser } from './collab-provider';

// Muted editorial hues for remote carets/selections (never the product accent, which "speaks").
const PALETTE = ['#2f6b63', '#8a5a1e', '#3a5aa8', '#8a2f5e', '#4a7d2f', '#7a6d1a'];
export function colorForHandle(handle: string): string {
  let n = 0; const s = String(handle || '');
  for (let i = 0; i < s.length; i++) n = (Math.imul(n, 31) + s.charCodeAt(i)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

export interface CoeditController {
  provider: SupabaseCollabProvider;
  stop(): void;
}

export function startCoedit(opts: {
  supabase: any;
  room: string;
  user: CollabUser;
  template: string;
  /** returns the Milkdown CollabService from the editor ctx (ctx.get(collabServiceCtx)) */
  getService: () => any;
  onPeers?: (peers: CollabUser[]) => void;
  seedDelayMs?: number;
}): CoeditController {
  const doc = new Y.Doc();
  const provider = new SupabaseCollabProvider(opts.supabase, opts.room, doc, opts.user);
  const service = opts.getService();
  service.bindDoc(doc).setAwareness(provider.awareness);

  let connected = false;
  const doConnect = (seed: boolean) => {
    if (connected) return;
    connected = true;
    if (seed) service.applyTemplate(opts.template);   // guarded: only seeds an empty shared doc
    service.connect();
    opts.onPeers?.(provider.peers());
  };
  provider.onSynced = () => doConnect(false);          // a peer handed us the live content
  const timer = setTimeout(() => doConnect(true), opts.seedDelayMs ?? 1200);  // first in → seed
  provider.onPeers = () => opts.onPeers?.(provider.peers());

  return {
    provider,
    stop() {
      clearTimeout(timer);
      try { service.disconnect(); } catch { /* ignore */ }
      provider.destroy();
    },
  };
}
