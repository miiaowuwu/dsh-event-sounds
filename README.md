# dsh-event-sounds — Voice Control Plugin (Angelina「hirari do～」)

English | [中文](README.zh.md)

A DSH Web GUI client plugin: plays a chosen sound effect when the conversation **ends / shows options / requests permission / stops**.

> 🐋 Character reference: a fan-made project for **Angelina** from *Arknights*. The bundled sample sounds are Angelina's "hirari do～" and "Huh?" voice clips, for personal learning and entertainment only — **not for commercial use**.

## Install

Both methods work for **either** user type — Desktop users and `npx dsh web` users can use whichever they prefer.

**Option A — Setup installer (recommended, zero dependencies, works for both):**

1. **If dsh isn't running, start it once** (the Desktop app or `npx dsh web`) so its profiles get initialized — then **quit it** (the Desktop app or the `dsh web` server)
2. Download [dsh-event-sounds-Setup-1.1.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-Setup-1.1.0-x64.exe) and **double-click it**
3. The installer **restarts dsh automatically** — the 🔊 floating ball means it's installed

- **Update**: re-download the latest Setup exe and run it (restarts dsh automatically; older versions are overwritten automatically — no need to uninstall first, no conflicts)
- **Uninstall**: double-click [dsh-event-sounds-UnSetup-1.1.0-x64.exe](https://github.com/miiaowuwu/dsh-event-sounds/releases/latest/download/dsh-event-sounds-UnSetup-1.1.0-x64.exe) — it restarts dsh automatically when done

> Note (just how it works — no action needed): the installer deploys the plugin to `$DSH_HOME/plugins/dsh-client-ui-event-sounds` and registers it into **every initialized profile** (web, desktop, …) via the official `dsh plugin` command, so all profiles share the same copy. If no dsh CLI is found, it auto-detects one (desktop bundled runtime → system npx → downloads Node.js). On finish it **restarts dsh automatically**: Desktop launches exactly like double-clicking the app (no terminal window, unaffected by closing the installer); web runs in the background and your browser opens the page automatically. Fully automated, no manual config edits.

**Option B — dsh CLI (needs Node.js, works for both):**

> If dsh isn't running yet, start it once first (`npx @deepseek-ai/dsh web`) so its profiles get initialized.

Pick **the one command** that matches how you run dsh — Desktop or web — and run **only that one** (choose 1 of 2):

```bash
# Desktop users —— run this one
npx @deepseek-ai/dsh plugin --profile desktop add dsh-client-ui-event-sounds --config.minimumReleaseAge=0
```

```bash
# web users (dsh runs via `npx dsh web`) —— run this one
npx @deepseek-ai/dsh plugin --profile web add dsh-client-ui-event-sounds --config.minimumReleaseAge=0
```

Then **restart** dsh (or just start it if it isn't running):

```bash
npx @deepseek-ai/dsh web
```

> `dsh-client-ui-event-sounds` is the **npm package name** (installed from the npm registry — no direct GitHub connection needed); the trailing `--config.minimumReleaseAge=0` bypasses pnpm's supply-chain gate (when you hit `minimumReleaseAge` errors).
>
> Development convenience: `npm run setup` auto-detects all local profiles and registers this plugin into each of them; `npm run setup:deploy` deploys a copy to `$DSH_HOME/plugins` and points every profile at it (release/fixed-use mode). Add `--profile <name>` (e.g. `node tools/install.mjs --profile web --unify`) to operate on a single profile only; `node tools/install.mjs --npm --start` installs from the npm package and auto-starts the matching side when done (Desktop window for desktop / web service + browser for web).

## Features

- **Draggable floating ball** (🔊): drag it anywhere on screen; **dragging it to a screen edge collapses it into a small half-ball (a ">" icon only)**; click to open the settings dialog; position is persisted, defaults to the left side
- **Settings dialog**: draggable (grab the title bar), z-index on top
  - 4 trigger conditions: **session end / options popup / permission request / stop**, each with an independent 【enable checkbox + sound dropdown】offering **built-in chime / no sound / a specific sound** ("built-in chime" is a Web Audio arpeggio — no audio file required)
  - **Attention events** (options popup / permission request) always ring — they play as soon as they appear, regardless of the conversation's running/viewing state, and take priority over the completion sounds
  - **Appearance**: Whale Girl (default) / Pure White / Pure Black, plus a **customizable voice name**
  - Volume slider (0–100%), **test sound** dropdown (incl. a "built-in chime" option) + ▶ preview + status bar, reset button position
  - Sound library (local audio in the plugin `sounds/` folder) + refresh + **Custom dialog: pick/drag-drop upload, delete sounds, restore hidden bundled sounds**
- **Sound source**: local audio files in the plugin `sounds/` directory (mp3/wav/ogg/m4a/flac/opus/aac/wma/webm), served by the host side via the `/dsh-sounds-control` static server (Range/206 chunking, ETag, streaming)
- **Persistent config**: dual-write to localStorage + host-side `config.json`, survives restarts; every field is sanitized (type/range/enum) on load, bad values fall back to defaults
- **Preload on startup**: fetches config and sound list and buffers the configured sound when the app opens, so the first play is instant
- Defaults: volume 75%; session end →「hirari do～」, options popup / permission request →「呢？」, stop → built-in chime
- Falls back to a Web Audio built-in beep when no sound is selected or loading fails
- **Dev tooling**: `npm test` (Node smoke tests for host-side list/config/upload/delete and browser-side logic), `npm run setup` / `setup:fix` / `setup:deploy` (multi-profile auto-config), `releases/build-single-exe.ps1` (builds the Setup/UnSetup installers)

## Directory structure

```
dsh-event-sounds/
├── package.json          # Package manifest (dsh.client / dsh.bundle.patch / types / scripts)
├── cordis.patch.yml      # Composition patch: mounts line ui-event-sounds
├── CHANGELOG.md          # Version history
├── README.md
├── LICENSE
├── sounds/               # Dev: put your audio files here (mp3/wav/ogg etc.)
├── lib/
│   ├── index.js          # Host side: /dsh-sounds-control static server (list/config/audio)
│   ├── client.js         # Browser side: floating ball + settings dialog + trigger detection + playback
│   └── types/index.d.ts  # Type declarations
├── tools/
│   ├── install.mjs       # Multi-profile auto-config (setup / --fix / --unify / --deploy)
│   ├── test-host.mjs     # Host-side API smoke tests (list/config/upload/delete)
│   └── test-client.mjs   # Browser-side logic smoke tests
└── releases/             # Publishing: build-single-exe.ps1 + versioned Setup/UnSetup exe (not in repo)
```

## Dual-side structure

The plugin is two halves, loaded automatically from a single install:

- **Host side (Node half)** [lib/index.js](lib/index.js): runs in the DSH main process (Node), exposes the plugin `sounds/` directory to the browser side through the `/dsh-sounds-control` static server (sound list / audio files / config.json persistence)
- **Browser side (Web GUI half)** [lib/client.js](lib/client.js): runs in the DSH Web GUI page — floating ball, settings dialog, trigger detection, and sound playback

Mounting of both halves is driven by `package.json` — no separate install needed:

- `dsh.client` declaration (`exports "./client"`) → loads the browser side in the Web GUI
- `dsh.bundle.patch` ([cordis.patch.yml](cordis.patch.yml)) → registers the host side in the DSH main process

Because dsh plugins are isolated **per profile** (`$DSH_HOME/profiles/<name>` each has its own `package.json` / `node_modules`), a plugin must be registered in every profile you want it in — that's what the installer and `tools/install.mjs` automate (see [Install](#install)).

## Usage

1. **Add sounds**: during development, put audio files in the repo `sounds/` folder (see the directory tree above). When installed, there is no need to hunt for the folder — open the settings dialog → Sound library → **Custom**, then pick a local file or drag & drop to import (it is copied into the `sounds/` folder of the install location automatically). You can also delete sounds from the list (bundled sounds are hidden, restorable anytime).
2. **Open the settings dialog**: click the 🔊 floating ball
3. **Refresh the sound list**: click "Refresh"; the plugin enumerates all audio files under `sounds/`
4. **Configure triggers**: for the four events (session end / options popup / permission request / stop), set 【enable + sound】independently — each dropdown offers "built-in chime / no sound / a specific sound" ("built-in chime" is a Web Audio arpeggio — no audio file required)
5. **Test sound**: pick one in the "Test sound" dropdown (which includes a "built-in chime" option) and click ▶ to preview; selecting "built-in chime" or nothing previews the Web Audio arpeggio. Adjust volume with the slider (0–100%)
6. **In effect**: the chosen sound plays automatically on matching events; a built-in beep plays as a fallback when nothing is selected or loading fails

> Tip: drag the floating ball anywhere; it collapses into a half-ball at screen edges; switch between Whale Girl / Pure White / Pure Black under "Appearance"; position and config are saved automatically and survive restarts.

## Disclaimer

- This is a **fan-made (unofficial) personal project** with no affiliation, sponsorship, or authorization from the official *Arknights* team or Shanghai Hypergryph Network Technology Co., Ltd.
- Character images, names, quotes, and voice assets referenced in this project (including Angelina's "hirari do～" and "Huh?" voice clips) belong to the official *Arknights* team and their respective right holders; the copyright of the voices belongs to the respective voice actors.
- This project is for personal learning, research, and entertainment only — **not for commercial use** and not for profit.
- The sound assets shipped with the project are local audio files added by users; users are responsible for ensuring their usage complies with applicable laws and the original right holders' requirements.
- If any right holder believes any content of this project infringes their rights, please contact the author to remove the material and we will handle it promptly.
- This project is provided as-is; the author is not responsible for any consequences arising from its use.
