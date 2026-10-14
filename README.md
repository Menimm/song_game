# 🎶 המסיבה של מאי — Song Intro Game

A "name that tune" party game for kids. The operator's computer plays a **very short intro** of a song (1 s → 2 s → 4 s → 8 s → 15 s); the girls pick the title from 4 choices **on their phones**. If nobody gets it, a longer intro plays. Faster answers score more; a wrong answer costs 10 points.

* Hebrew, right-to-left UI, capybara theme, sound effects
* Phones join with a QR code (or a 4-digit room code) and a nickname — no accounts
* One computer plays all audio (connected to a speaker/TV); phones, TV and operator talk to it over WebSocket
* Songs are **local audio files** (exact cuts, works offline). A built-in song manager searches your music server, copies files in, and can import a Spotify playlist
* Wrong answers are chosen smartly: same language (Hebrew songs get Hebrew choices), similar tempo, editable

> **Audio files are not in this repo** (only the song list). See [Getting the songs](#getting-the-songs).

## Screens

| URL | Who | What |
|---|---|---|
| `/play` | each girl's phone | join, countdown, 4 choices, score |
| `/tv` | the TV / big screen | QR + room code, countdown, choices, leaderboard, reveal with album art |
| `/host` | the operator (this computer only) | controls, plays the audio, player bar (pause / drag to seek) |
| `/manage` | operator or the birthday girl | search the music server, add/edit songs, import a playlist |

## Requirements

* **Node.js 22+** (`brew install node` on macOS)
* **Google Chrome** on the computer that plays the audio (Safari suspends audio too aggressively)
* Optional: **`cloudflared`** for a public link so phones on mobile data can join (`brew install cloudflared`). Without it the game works on the home Wi-Fi only.

## Quick start

```bash
git clone <this repo> identifySongs
cd identifySongs
npm install
# put the audio files in place (see "Getting the songs"), e.g.:
npm run restore
npm start                 # starts the server, the tunnel (if cloudflared exists) and prints a QR code
```

`npm start` prints:

```
Room code     : 4430
Phones        : https://<random>.trycloudflare.com/play?c=4430   (public tunnel)
Host (Chrome) : http://localhost:3000/host
TV            : http://localhost:3000/tv
Song manager  : http://localhost:3000/manage   (PIN from other devices: 1234)
```

1. Open the **Host** URL in Chrome → press **🔊 הפעלת סאונד** (you should hear a two-note beep). Keep this tab open — it plays all the audio.
2. Open the **TV** URL on the second screen (full screen).
3. Girls scan the QR (on the TV or terminal) and type a nickname.
4. On the host page press **▶** next to a song (or **🎲 אקראי**). Everything else runs itself; use the buttons to intervene.

Useful options:

```bash
MANAGE_PIN=1234 npm start      # fixed PIN for /manage from other devices (default: random, printed at start)
PORT=3100 npm start            # if port 3000 is busy
MUSIC_DIR=/Volumes/music npm start
npm start -- --no-tunnel       # home Wi-Fi only (no cloudflared)
```

`MUSIC_DIR` defaults to `/Volumes/music` on macOS and `\\BIGBOX2\music` on Windows (edit `config.js` for your own server).

**If the share mounts under a different name** (macOS adds `-1`, `-2`… when a name is already taken — check with `ls /Volumes`), tell every command where it is — `npm start`, `npm run restore`, `npm run seed` all read it:

```bash
export MUSIC_DIR="/Volumes/music-1"     # for this Terminal window
npm run restore && npm start
```

## Getting the songs

`data/songs.json` lists the songs; the audio files live in `songs/` (git-ignored — they are copyrighted).

* **Same music server as before** — mount it (macOS: Finder → Go → Connect to Server → `smb://BIGBOX2/music`) and run `npm run restore`. It re-copies every missing file listed in `data/songs.json` from the server.
* **Build your own list** — open `/manage`, press **רענון אינדקס** once (scans the music folder, 1–2 min), search, press **➕ הוסף**. Or drag a file onto the page. `npm run seed` adds the original 15 starter songs automatically.
* **Spotify playlist** — in `/manage` paste a playlist link (or a `Title - Artist` list) → it shows which tracks exist on your music server and adds them with one click. Spotify can't provide audio, only the list.

For each song you can set a **start offset** (skip a silent intro), a small optional **hook line** shown on reveal, and the 3 **wrong answers** (auto-suggested — press ✨). Buttons: *🔤 Hebrew names for Hebrew songs*, *🥁 compute BPM*, *✨ fill wrong answers*.

## Running the game

**Operator buttons:** ▶ pick a song · 🎲 random · ⏸ pause / ▶ continue · 🔁 replay the same clip · ➕ longer clip · 👀 reveal now · ⏭ skip · ➡ next (stops the music) · ±10 points / ✖ remove per player · 🤖 practice bots.
**"ניסיונות (שלבים)"** = how many clip lengths are tried before the answer is revealed (1–5). Change it right before pressing ▶ for a per-round override.
**After the reveal** the full song plays; the bar at the bottom lets you pause and drag to any point.

**Scoring:** 100 / 80 / 60 / 40 / 20 points depending on which clip length got it · wrong answer −10 (never below 0) · a wrong guess locks that player out only until the next, longer clip.

A phone that locks or loses connection comes back automatically with the same name and score.

## Saturday checklist

See **[docs/RUNBOOK-mac.md](docs/RUNBOOK-mac.md)** — one-time Mac setup, start-up steps, troubleshooting table and a rehearsal script.

## Safety notes

* `/host` opens **only on the computer running the server**; `/tv`, `/manage` and the song files are refused for anyone coming through the public tunnel; `/manage` needs the PIN from other devices on the Wi-Fi.
* Only `/play` (and the join QR) is reachable through the tunnel. The tunnel address changes every start.
* Don't commit audio, `data/index.json` (a cache of your music folder) or PINs.

## Development

```bash
npm test          # ~130 tests: scoring, game state machine, store, search, guards, WebSocket integration, 14-phone load test…
npm run dev       # server without the tunnel
```

```
src/game/      scoring, the Game state machine, practice bots
src/library/   song store, search index of the music folder, tags/ingest, wrong-answer picker, Spotify import, Hebrew names
src/net/       WebSocket hub, local-only/PIN guards, /api/manage routes
public/        the four pages (vanilla JS, no build step)
scripts/       start, dev, seed, restore
docs/superpowers/   design spec and implementation plan
```

Design notes: [docs/superpowers/specs](docs/superpowers/specs/2026-10-14-song-intro-game-design.md) · [plan](docs/superpowers/plans/2026-10-14-song-intro-game.md).
