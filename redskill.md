# redskill · Install Paper mode

> **Read this file and install Paper mode for DeepSeek Harness.** One command, no config files to edit.

Paper mode is an agent preset that gives non-coding work its own contract: outputs go to a workspace `AI-Cooperate/` archive with enforced `YYMMDD-project-file` names, intermediate files go to an auto-cleaned system-temp scratch directory, and Paper sessions are tagged with 📑 in the sidebar. Repo: <https://github.com/sevenhsu7/dsh-paper-mode>

## For humans — one command

```sh
dsh plugin --profile desktop add github:sevenhsu7/dsh-paper-mode
```

Then restart DeepSeek Harness. Open **Settings → Agent presets** and confirm the **Paper mode** card. On a `dsh` CLI profile other than `desktop`, use that profile name (`web`, `headless`, …).

If you don't have the `dsh` CLI on your PATH, use full path:

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:sevenhsu7/dsh-paper-mode
```

## For agents — install, verify, report

When a user points you at this file, do this:

1. **Detect DSH.** `command -v dsh`, or the desktop CLI path above.
2. **Install the bundle.**
   ```sh
   dsh plugin --profile desktop add github:sevenhsu7/dsh-paper-mode
   ```
   If the network blocks GitHub, clone first and install from the local folder:
   ```sh
   git clone https://github.com/sevenhsu7/dsh-paper-mode.git
   dsh plugin --profile desktop add ./dsh-paper-mode
   ```
   Never hand-edit the profile's `package.json` or `cordis.patch.yml` — `dsh plugin add` reconciles the bundle list itself.
3. **Restart DeepSeek Harness** (plugin code and the preset roster load at boot). If the app is running and a restart is not possible, tell the user to restart it.
4. **Verify** (CLI profile inspection):
   ```sh
   dsh --profile desktop --dump-config | grep -n "preset-cowork"
   ```
   Or ask the user to open **Settings → Agent presets** and confirm a **Paper mode** card exists (custom group).
5. **Smoke test (optional, in the app).** Start a task with **Paper mode**, ask for a tiny report, then check:
   - the file is under `<workspace>/AI-Cooperate/`;
   - its name matches `YYMMDD-<project-code>-<title>.md`;
   - the session title in the sidebar starts with 📑.
6. **Report** what was installed, what was verified, and anything skipped.

## What gets installed

- Preset `cowork` (display name **Paper mode**; internal id kept for compatibility), based on the standard tool set.
- `cowork_save` tool: enforces the archive folder and naming (never overwrites; asks the user when multiple archive folders exist).
- `scratch` tool + 7-day cleanup: intermediate files stay in an auto-cleaned system-temp directory, never in the workspace.
- Workspace-aware: automatically tells code repositories from plain folders. In a git repository the archive is added to `.git/info/exclude` (local-only; tracked `.gitignore` untouched) and scratch stays out; plain folders get no git handling.
- Host plugin: prefixes 📑 on Paper mode session titles.

## Uninstall

```sh
dsh plugin --profile desktop remove @local/dsh-cowork-preset
```

(Run `dsh plugin --profile desktop list` if the package name differs.) Restart DSH afterwards.

## Limits

- Works only in DeepSeek Harness; Claude Code / Codex / Cursor do not read this preset.
- This is a prompt-level contract plus a save-tool boundary, not an OS sandbox.
