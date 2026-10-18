---
name: install-paper-mode
description: Use when the user wants to install, update or verify "Paper mode" for DeepSeek Harness (DSH). Installs the dsh-paper-mode bundle with `dsh plugin add`, verifies the preset roster entry, and smoke-tests the AI-Cooperate archive, enforced naming and 📑 session badge.
---

# Install Paper mode (DSH)

Paper mode is an agent preset for DeepSeek Harness: non-coding work (research, analysis, reports, documents, charts, data) runs under a dedicated contract — artifacts go to a workspace `AI-Cooperate/` archive, files are named `YYMMDD-project-code-name`, intermediate files go to an auto-cleaned system-temp scratch directory, and Paper sessions carry a 📑 prefix.

Repo: <https://github.com/sevenhsu7/dsh-paper-mode>

## Steps

1. **Detect DSH.**
   - `command -v dsh` → use `dsh`.
   - Otherwise use the desktop launcher: `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`.

2. **Install the bundle** into the user's profile:
   ```sh
   dsh plugin --profile desktop add github:sevenhsu7/dsh-paper-mode
   ```
   Fallback when GitHub is unreachable: `git clone https://github.com/sevenhsu7/dsh-paper-mode.git && dsh plugin --profile desktop add ./dsh-paper-mode`.
   Do not hand-edit `~/.dsh/profiles/*/package.json` or `cordis.patch.yml`; `dsh plugin add` reconciles them.

3. **Restart DeepSeek Harness** (the preset roster and plugin code load at boot). Ask the user to restart if you cannot.

4. **Verify the declaration**:
   ```sh
   dsh --profile desktop --dump-config | grep -n "preset-cowork"
   ```
   And ask the user to confirm **Settings → Agent presets → Paper mode**.

5. **Smoke test** in a new Paper task: ask for a one-line report, then check
   - file path: `<workspace>/AI-Cooperate/YYMMDD-<project-code>-<title>.md`;
   - duplicate names get `-2`/`-3`;
   - sidebar session title starts with 📑.

6. **Report** installed version, verification output, and any step that needed the user.

- Workspace-aware: automatically detects whether the workspace is a git repository. In repos the archive is added to `.git/info/exclude` (local-only; tracked `.gitignore` untouched); plain folders get no git handling.

## Troubleshooting

- Card missing after install → restart DSH; then `dsh --profile desktop --dump-config | grep preset-cowork`.
- 📑 missing but files correct → session-title service absent or the session predates install; new sessions should work after restart.
- Install from a profile other than `desktop` → replace `--profile desktop` with that profile name.
- Uninstall: `dsh plugin --profile desktop remove @local/dsh-cowork-preset` and restart.
