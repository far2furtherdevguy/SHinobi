# Neon Arena v3.2 (Solara Port)

Offline modes (1v1, 2v2, Battle Royale vs bots) run in any browser. Online 1v1 / Battle Royale, cloud accounts,
the coin shop and server-side validation need this Node server.

## Run locally
    npm install
    npm start
Open http://localhost:3000 (two windows for online 1v1). Use `MOVE_CHECK=off npm start` only for debugging.

## Deploy on Render
1. Push this folder to GitHub.
2. Render > New > Blueprint (reads render.yaml), or New > Web Service: build `npm install`, start `npm start`.
3. Open your `https://<name>.onrender.com` URL. The game is served from the same address, so leave "Server URL" empty.

Accounts are stored in `data/accounts.json` (override the folder with the `DATA_DIR` env var). Render's free plan has an
ephemeral disk and sleeps when idle, so accounts reset on redeploy or restart. For permanent saves attach a Render
persistent disk (paid) and set `DATA_DIR` to its mount path.

## Profiles, coins and the shop
* Sign in with a username + 4-8 digit PIN (created on first use), or press Guest. Guests can play everything but earn nothing.
* Served from the server = cloud account (works on any device). Opened as a plain file = local account on that device only.
* Coins come from matches (kills, headshots, wins). Spend them in the Shop on:
  heroes (Phantom free, Scout, Medic, Tank, Gunner), gun upgrades (Damage, Magazine, Reload, 3 levels per weapon) and perks.
* Server authority for cloud accounts: coins, XP, purchases, owned heroes and upgrades are stored and checked only on the server.
  The client can't set them. Online matches pay out from the server's own kill tracking. Offline results are capped and rate limited.
* Upgrades and perks apply only to the player who owns them: in online play the server uses the shooter's own account to compute
  damage, armor, grenades and pickups. Hero skills require owning the hero.
* Movement is validated against the map's collision boxes (`mapdata.json`, generated from the client map): speed limits,
  no walking through walls, no flying. Bad positions are corrected back.

## Weapons and models
Uzi (FBX + PBR textures) and RPG-7 (OBJ) are in `public/models/` and configured in `models.json`. They load only when served over
http. Drop in more `.glb` characters/props as described in `public/models/README.txt`.

## Controls
WASD, Shift sprint, Space jump/climb, C crouch, V prone, mouse aim, click fire, right-click scope, R reload, Q gloo wall,
F heal, E hero skill, G grenade, 1/2 swap gun. Touch: on-screen buttons; drag the right side or the FIRE buttons to aim.
