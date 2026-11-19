// BREACHLINE multiplayer relay + game host for Cloudflare Workers (free plan).
// GET /ws?room=<code>&id=<peer>  → WebSocket into that room's Durable Object (one object per room).
// Everything else → the game's static files (public/index.html).
// The relay is dumb on purpose: it keeps each peer's latest presence and forwards it to the others.
// The game itself (host-authoritative) runs in the players' browsers.
import { DurableObject } from 'cloudflare:workers';

const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const ID_RE = /^[a-z0-9]{4,24}$/;
const MAX_PEERS = 16, MAX_MSG = 4600, RATE = 60, BURST = 120; // messages per second per player

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.pres = new Map();   // peer id → latest presence JSON string
    this.bucket = new Map(); // peer id → {tokens, t}
  }
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id') || '';
    if (!ID_RE.test(id)) return new Response('bad id', { status: 400 });
    const live = this.ctx.getWebSockets();
    for (const old of this.ctx.getWebSockets(id)) { try { old.close(4000, 'replaced'); } catch (e) { /* gone */ } } // reconnect: same id
    if (live.filter((w) => !this.ctx.getWebSockets(id).includes(w)).length >= MAX_PEERS) return new Response('room full', { status: 429 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [id]);
    server.serializeAttachment({ id });
    const peers = [];
    for (const [pid, p] of this.pres) if (pid !== id && this.ctx.getWebSockets(pid).length) peers.push([pid, p]);
    server.send(JSON.stringify({ k: 'hi', id, peers }));
    return new Response(null, { status: 101, webSocket: client });
  }
  allow(id) {
    const now = Date.now();
    let b = this.bucket.get(id);
    if (!b) { b = { tokens: BURST, t: now }; this.bucket.set(id, b); }
    b.tokens = Math.min(BURST, b.tokens + (now - b.t) * RATE / 1000); b.t = now;
    if (b.tokens < 1) return false;
    b.tokens--; return true;
  }
  idOf(ws) { try { const a = ws.deserializeAttachment(); return a && a.id; } catch (e) { return null; } }
  broadcast(from, text) {
    for (const w of this.ctx.getWebSockets()) if (w !== from) { try { w.send(text); } catch (e) { /* closing */ } }
  }
  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > MAX_MSG) return;
    const id = this.idOf(ws);
    if (!id || !this.allow(id)) return;
    let m; try { m = JSON.parse(msg); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.k === 'p' && typeof m.p === 'string' && m.p.length <= MAX_MSG) {
      this.pres.set(id, m.p);
      this.broadcast(ws, JSON.stringify({ k: 'p', id, p: m.p }));
    } else if (m.k === 'ka') {
      this.broadcast(ws, '{"k":"ka","id":"' + id + '"}');
    } else if (m.k === 'bye') {
      this.gone(ws, id);
      try { ws.close(1000, 'bye'); } catch (e) { /* closed */ }
    }
  }
  gone(ws, id) {
    if (!id) return;
    if (this.ctx.getWebSockets(id).some((w) => w !== ws && w.readyState === 1)) return; // replaced by a reconnect
    this.pres.delete(id); this.bucket.delete(id);
    this.broadcast(ws, '{"k":"bye","id":"' + id + '"}');
  }
  async webSocketClose(ws, code) {
    this.gone(ws, this.idOf(ws));
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, 'closing'); } catch (e) { /* already closed */ }
  }
  async webSocketError(ws) { this.gone(ws, this.idOf(ws)); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('BREACHLINE relay: expected a WebSocket', { status: 426 });
      const room = (url.searchParams.get('room') || '').toLowerCase();
      if (!ROOM_RE.test(room)) return new Response('bad room', { status: 400 });
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('BREACHLINE relay is running.', { headers: { 'content-type': 'text/plain' } });
  },
};
