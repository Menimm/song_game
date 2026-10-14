# Song Intro Game (מאי's Capybara Party) — Design

Date: 2026-10-14 · Event: Saturday party, 12–14 girls (age ~10), solo play, Hebrew UI (RTL).

## Goal
"Name that tune": a short intro of a song plays, players pick the title from 4 choices on their phones. If nobody gets it, a longer intro plays. An operator drives the game; the game runs itself otherwise.

## Roles / screens (one Node server, three web pages)
- **Phone `/play`** — join via QR + short code, nickname only. Shows: pre-round countdown, "listening" state, answer countdown, 4 choices (title + artist, small hook line optional), lock-out state, own score. No accounts.
- **TV `/tv`** — big countdown, current step, live leaderboard, answer reveal with album art (title, artist, hook line). Capybara/מאי theme, sound effects.
- **Operator `/host`** — controls AND audio playback (Web Audio in the browser on the Mac connected to the TV/speaker). Needs one initial tap to unlock sound; has a "test sound" button.

- **Song manager `/manage`** (Hebrew, host/kid use, never on the public tunnel; local-network access behind a PIN if used from another device) — easy management of the song list, see "Song manager" below.

## Song manager
- **Index:** built from the music share (`\\BIGBOX2\music`, `/Volumes/music` on the Mac; folder is a setting) — recursive scan of audio files (mp3/flac/m4a/wav…), cached to JSON, "refresh index" button, tags read for artist/title/album (filename fallback). Measured: ~41k files, ~105s over SMB on the first scan.
- **Search:** one box, Hebrew/English, fuzzy (spelling variants, word order), ranks clean originals above remix/live/instrumental/accapella; every result has a preview play button.
- **Add:** one tap copies the file into the project `songs/` folder (game then needs no NAS/internet) and creates its entry.
- **List editing:** reorder, remove, enable/disable, start offset (with "test 1s intro"), optional hook line, three distractors (auto-suggested, editable).
- **Spotify import:** reads the public playlist, shows match status per track against the index, one-click add, flags missing tracks.
- **Manual add:** drag a file onto the page for songs not on the NAS.

## Runtime / hosting
- Node.js (22) server + WebSockets, runs on the operator's **Mac**. Built on Windows, no OS-specific code; music folder is a setting.
- One public URL via **Cloudflare Tunnel** (`cloudflared`) so phones on home Wi-Fi or mobile data use the same link; QR points to it. Local-network URL as fallback (no-internet mode).
- Single `start` script launches server (+ tunnel if available) and prints QR/join code.
- Vercel not used (serverless cannot hold the live connections).

## Songs
- Source of truth: the user's Spotify playlist (max 20 songs) — read via Spotify Web API (user creates a Spotify Developer app, one-time login) for title/artist/album art. If the app setup is skipped, a pasted list of title+artist is accepted.
- Audio: **local files** copied into the project's `songs/` folder (originally from `\\BIGBOX2\music`, mounted at `/Volumes/music` on the Mac). A matcher script pairs playlist tracks to files (English + Hebrew, spelling variants) and reports missing ones. Spotify cannot supply audio; missing songs are replaced or files added by the user.
- Per-song config (editable JSON): start offset (skip silent intros), optional hook line (typed by the user, not generated), 3 distractors.
- Distractors: BPM computed from the files; candidates chosen by similar tempo, same language, similar style, including songs outside the playlist. Operator can edit before the party.
- Clips are cut in the browser (exact ms), so no ffmpeg dependency.

## Round flow
1. Operator picks a song or hits random (no repeats).
2. Pre-round countdown on phones/TV, then the intro plays: ladder **1s → 2s → 4s → 8s → 15s**.
3. After each clip an answer window runs. First correct answer ends the round.
4. Wrong answer: −10 and the player is locked out for the current step only (may answer again at the next, longer step). "Attempts" = number of ladder steps played before the reveal (`maxSteps`, 1–5, default 5; set once for the game, per-round override). Answer window opens when the host page acks that audio actually started; phones get remaining durations, not absolute times.
5. Nobody correct → next longer clip. After the last step → reveal.
6. Reveal on TV + phones (title, artist, art, hook line); the full song plays until the operator moves on.

## Scoring
Correct at step 1..5 = 100 / 80 / 60 / 40 / 20. Wrong answer = −10. Operator can manually adjust points, kick a player.

## Operator controls
Pick / random, pause / continue, replay, lengthen to next step, skip, reveal, next song, manual points, kick player, attempts override, practice mode (fake players for the 4-person rehearsals), editable distractors.

## Error handling
Player reconnect restores state by nickname/code; late answers after time are ignored server-side (server is the single clock); missing audio file → song excluded and flagged; tunnel failure → local-network mode; audio-unlock reminder if the operator tab is not interacted with.

## Testing
Unit tests for scoring/round state machine; scripted fake-player runs (practice mode) for sync and load with ~14 clients; full rehearsals with 4 players on the Mac; Saturday checklist (HDMI/audio output, tunnel up, phone join test on Wi-Fi and mobile data).

## Out of scope
Accounts, teams, persistent history, Spotify-based audio playback (possible later fallback), generated lyrics.

## Decisions recorded
- Host machine on Saturday: the Mac (`smb://BIGBOX2/music` confirmed reachable from it).
- `/manage` is used by the host and the birthday girl (she may pick songs): reachable on the home network behind a PIN, blocked on the public tunnel. Added songs are always copied into `songs/`.
- Starting library (seed, editable in `/manage`): English pop — Shake It Off, Flowers, Roar, Watermelon Sugar, Don't Start Now, Hips Don't Lie; Israeli — הרקדן האוטומטי, יש לי ציפור קטנה בלב, מיליון דולר, אם אתה גבר, אמבולנס, Tikitas; Gazoz (3 songs, user's decision; Hebrew-titled FLAC copy "גזוז - 1990 - 20 הלהיטים") — חללית, תשע בכיכר, רוני. Seed = 15 songs; the rest are added through `/manage`. 14 playlist hits are not on the NAS; they get added when files are supplied.
- Playlist "של מאי" (100 tracks, public) is imported for matching; Shakira/Spanish and "Stidlmusic" programming-titled tracks are ignored.

## Open inputs needed from the user
- Spotify playlist link (or title+artist list).
- Spotify Developer app client ID (guided, ~3 min) if using API import.
- Confirm point values and ladder (agreed) and the final 20 songs after matching.
