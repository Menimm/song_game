# Running the song game on the Mac

## One-time setup (do this before Saturday, not on Saturday)
1. Install tools: `brew install node cloudflared` (and Google Chrome).
2. Mount the music share: Finder → Go → Connect to Server → `smb://BIGBOX2/music`. It appears as `/Volumes/music`.
3. Copy the whole project folder to the Mac **including `songs/` and `data/`** (they are not in git). In the folder: `npm install`.
4. First start: `npm start`. macOS asks "Allow node to accept incoming connections?" → **Allow**.
5. Keep the Mac awake during the party: run `caffeinate -d` in a second Terminal tab.

## Start the game
```
cd identifySongs
MANAGE_PIN=1234 npm start          # music folder defaults to /Volumes/music; override with MUSIC_DIR=...
                                   # if port 3000 is busy:  PORT=3100 npm start
```
The terminal prints a QR code, the room code, and the URLs. If it says "No public tunnel", phones must be on the home Wi-Fi.

1. Chrome → `http://localhost:3000/host` → press **הפעלת סאונד** (you should hear a two-note beep). This tab plays all audio; keep it open.
2. Second window on the TV (HDMI, extended display) → `http://localhost:3000/tv` → full screen (Cmd+Ctrl+F).
3. System Settings → Sound → Output → the TV or speaker.
4. Girls scan the QR on the TV (or type the code at the phone URL) and enter a nickname.

## Managing songs
`http://localhost:3000/manage` (from a phone on the home Wi-Fi: `http://<mac-ip>:3000/manage`, PIN `1234`). Search the NAS, tap ➕, set start offset / hook / wrong answers, press the BPM and "complete wrong answers" buttons.
First time on a new machine: press **רענון אינדקס** once (1–2 minutes) so the NAS search works.

## Operator quick reference (host page)
▶ pick a song / 🎲 random · ⏸ pause–▶ continue · 🔁 replay the same clip · ➕ longer clip · 👀 reveal now · ⏭ skip song · ➡ next (stops the music) · "ניסיונות" = how many clip lengths before the answer is revealed (change it right before pressing ▶ for a per-round override) · ±10 points and ✖ kick per player · 🤖 bots for practice.
**Bottom player bar:** after the reveal the full song plays; use ⏸/▶ and drag the slider to jump anywhere.

## If something goes wrong
| Symptom | Fix |
|---|---|
| No sound | Host tab: press **הפעלת סאונד** again; check the macOS output device; the host tab must be Chrome and not muted. |
| "השיר לא נטען" notice, song removed | The file is missing/corrupt. In `/manage` fix or re-add it. |
| Phones can't open the link | Check the `Phones:` line in the terminal. "home network only" → phone must be on the home Wi-Fi. Restart `npm start` for a new tunnel URL. |
| A girl is disconnected | She reopens the link; her score and name come back. |
| Everything stuck | Ctrl+C, `npm start`, reload `/host` and `/tv`. Scores reset on restart. |

## Rehearsal script (do it twice, with 4 players)
1. `npm start`; open host + TV; 4 phones join (use 2 on mobile data to test the tunnel).
2. Press 🤖 +3 for a fuller board. Play 5 rounds: one answered at step 1, one at step 3, one nobody answers, one wrong-then-right, one with ⏸ pause in the middle.
3. Lock a phone screen for 20 s mid-round; unlock: it returns with the same name/score.
4. Open `/manage` on a phone (PIN); add a song by search; play it.
5. `npm start -- --no-tunnel` and confirm LAN-only still works.
