# BREACHLINE

An original browser tactical shooter: attack/defend rounds, destructible walls, gadgets, drones, bots,
three modes (Bomb, Hostage, Secure Area) on two maps, and online multiplayer with friends.

This repo is ready for Cloudflare Workers (free plan):

- `public/index.html`: the whole game (one file).
- `worker.js`: serves the game and runs the multiplayer relay at `/ws` (one Durable Object per room).
- `wrangler.jsonc`: Cloudflare config.

Deploy: Cloudflare dashboard → Workers & Pages → Create → Import a repository → pick this repo → Deploy.
Your game is then at `https://breachline.<your-subdomain>.workers.dev`, multiplayer included.
Multiplayer uses ordinary secure WebSocket traffic on port 443, so it works on most school and work networks.
