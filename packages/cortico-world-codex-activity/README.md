<!-- Owner: src/definition.ts, src/config.ts, src/world.ts, src/activity.mjs, src/model-text.ts, web/view.js, web/strings.js, ../cortico-world-desktop-pet/src/display.ts, ../../integration/install-world.mjs. -->
# Codex Activity World

`cortico-world-codex-activity` reads local Codex desktop activity and displays notifications
and figure states in Coopanion's existing pet window. Its World ID is `codex-activity`.
It requires this fork's updated `cortico-world-desktop-pet/display` interface; the desktop-pet
package version alone does not establish compatibility with an upstream release. Activity display
does not require a model connection. Completion events enter Coopanion's normal conversation flow:
the current model composes a response using its existing bubble, chat history and action tools.
An enabled voice World supplies speech through its usual tools; without it, the pet can still
display the response in a bubble.

## Configuration

The package defaults to disabled. A deployment enables it through `worlds.codex-activity.enabled`.
The portable launcher installs and enables it on the first migration; later launches preserve
activation and removal choices. Use the Codex activity World page to enable, stop or restart it.
Stop the World before uninstalling it through extension management.

| Key under `worlds.codex-activity` | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Mount the World |
| `sessionsDir` | `""` | Absolute Codex sessions directory; empty uses `CODEX_HOME/sessions`, then `~/.codex/sessions` |
| `pollMs` | `400` | Read interval in milliseconds, from 100 to 60000 |
| `maxThreads` | `32` | Maximum displayed conversations, from 1 to 32 |
| `notifyOnComplete` | `true` | Send fresh completed turns to Coopanion's current model for a response |

Save configuration and restart this World for changes to take effect. Stopping closes the
watcher, waits for the current read to finish, stops polling and removes the display. Restarting
recreates the reader and display. The World page reports the read state, sessions directory and
conversation count. Diagnostic status is written to
`<WorldContext.dataDir>/worlds/codex-activity/status.json`; it contains identifiers, states and
counters, without conversation bodies. It reports `enabled: false` after the World stops.
With the portable application's default paths, this is
`<application-data>/home/companion/data/worlds/codex-activity/status.json`.
The deployment's `paths.data` configuration can change the World data directory.

## Completion Responses

While running, the World emits `codex-activity.completed` for an explicit completed turn,
with the thread title and completion fact. Historical completions from before startup,
failed turns and interrupted turns do not trigger a response. Repeated observations of the
same completed turn are deduplicated. Completion responses require a model connection and
follow Core pause and World visibility settings.

The model chooses the wording and uses the existing pet and voice tools. Its response appears
in Coopanion's normal chat history. The event does not forward the Codex transcript to the model.

## Display And Data

Notifications retain their collapse, hide, dismiss, swipe and thread-opening behavior. The
World uses the same pet window as Coopanion. The pet's own chat, input, speech and actions retain
priority. Only the authenticated pet window receives notification titles and summaries; preview
pages do not receive them. The desktop-pet package serves only the World files named in its
display registration.

When completion responses are enabled, the completion fact and thread title also enter the Core
event record and the current model's context.

The reader supports the desktop transcript format used by Codex `0.167.x`. It reads public
assistant messages, turn events, the current task summary and the adjacent `session_index.jsonl`
title index. It does not read login credentials or private databases. It does not forward
reasoning, tool arguments, tool results or compressed context. Assistant summaries are capped
at 280 characters and task summaries at 240 characters.

The transcript is a version-specific fallback. Events not yet written to disk, approval details
and character-by-character output may be unavailable. Silence does not imply completion. A
completed turn observed while the World was running becomes locally unread until its
notification is opened; reading it elsewhere in Codex cannot clear this local marker. Native
Codex unread state and this display are not fully equivalent.

## Development

| File | Ownership |
|---|---|
| `src/definition.ts` | World identity, defaults and construction |
| `src/config.ts` | Configuration schema and bounds |
| `src/world.ts` | Start/stop, completion event delivery, display registration and validated thread-opening actions |
| `src/activity.mjs` | Transcript discovery, incremental parsing, snapshots and diagnostics |
| `src/model-text.ts` | Model-facing completion event text |
| `web/view.js` | Notification interactions, layout, figure state and cleanup |
| `web/strings.js` | Human-facing text in all eleven application languages |

Add Codex behavior within this package. Read operations belong to the reader, user actions to
the World's `onAction`, and controls to the display. Expose new configuration through
`codexActivityConfigGroup(language)`. The generic pet display contract is documented in the
[desktop-pet README](../cortico-world-desktop-pet/README.md#world-显示接口).

`scripts/Install-CodexBridge.ps1` remains a compatible launcher entry. Its migration helper
is `integration/install-world.mjs`; `GHOST_CODEX_BRIDGE_MODULE` no longer starts the reader.
The old pet-service `/api/codex-bridge` route is removed.
