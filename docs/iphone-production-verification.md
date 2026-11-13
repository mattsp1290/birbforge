# Verify the iPhone app against production

This handoff is for an agent on a Mac with a physical iPhone attached. Follow it to check that the native Forge app works against the new production deployment. The owner set the scope as Core, Projects and project chats, and Live chat. The work is tracked on Beans record `forge-c1ua`.

Screen text quoted below comes from app source at `3221c40b24b3fbf0c0924544918cc96faf5277cc`. Claims cite the file and line that set them. Where source does not settle what a screen shows, this page says "unverified, record what you see". Do not guess in those places.

The production server must run a later revision than that one: the revision that removed provider attestations (Beans record `forge-92fz`). The app revision above works with it unchanged. Server citations stay at the commit above unless they say `main`. [Check the route from the Mac](#check-the-route-from-the-mac) shows how to confirm the server revision.

This handoff authorizes no merge, deployment or account change. It changes no network setup. J7.6 only switches Airplane Mode and the phone's NetBird connection off and on again. One step needs the owner's explicit go-ahead at the time you reach it. That step is the delivery approval in [J6](#j6-delivery-approval-of-forge-yxl6). Removing the old app or a saved machine from the phone also needs the owner's consent.

## Private values

This repository is public. Private destinations and device identifiers stay out of Git, as in earlier handoffs (`docs/mac-iphone-verification.md:161-162`, `docs/mac-iphone-verification.md:295-297`, `docs/evidence/acceptance.md:36-38`). The owner supplies the values below in the private notes on `forge-c1ua`. Read them with `bn show --project forge forge-c1ua`, or ask the owner. Do not copy them into Git, a pull request or a public report.

| Name on this page | What it is |
| --- | --- |
| `FORGE_URL` | The production HTTPS origin, with no path. |
| Token command | The one-line command that prints the owner token on the production host. |
| NetBird group | The private group whose devices can reach `FORGE_URL`. The Mac and the iPhone must both be members. |
| Pilot URL | The endpoint of the earlier pilot. That pilot is scaled to zero and must not be used. |

The owner token itself is in no repository and no Beans record. You get it from the owner or from the token command.

## Rules for the whole run

1. Keep the owner token out of screenshots, recordings, logs, shell history, evidence files, Beans notes, chat messages and commits. If it lands in any of them, stop and tell the owner so the token can be replaced.
2. Paste the token only into the masked **Owner credential** field. Type `FORGE_URL` as keystrokes and never paste it. An earlier run pasted stale clipboard content into the endpoint field through iPhone Mirroring, and a screenshot exposed it (`docs/evidence/contextless-closure-native-acceptance.md:29`).
3. Every chat message is a live provider call on the owner's accounts. Send only the messages this page lists.
4. Record times in UTC with `date -u +%Y-%m-%dT%H:%M:%SZ`. The owner correlates failures by time on the Datadog dashboard named Forge production. You do not need Datadog access.
5. Do not change NetBird, signing, developer account or device trust settings. A missing prerequisite is a gate to report, not to fix (`docs/mac-iphone-verification.md:108-114`). The one exception is turning the NetBird connection off and on again in J7.6.
6. Leave what the journeys create. That is two agents, one project and their chats. Delete nothing on the server.
7. Do not tap the controls in this table.

| Control | Where | Why |
| --- | --- | --- |
| **Reject goal** | Delivery card, next to **Approve goal and start** (`app/src/DeliveryPanel.tsx:25-28`) | A rejection is final. The workflow accepts one decision per installed goal (`delivery/workflow.py:102-107`). |
| **Request cancellation** | Delivery card during authoring, reviewing and publishing (`app/src/DeliveryPanel.tsx:38`) | It asks the worker to stop the owner's delivery. |
| **Cancel conversation** | Bottom of a project chat (`app/src/GoalWorkflows.tsx:244-245`) | It ends that chat. |
| **Replace OPENCODE_GO_API_KEY**, **Remove OPENCODE_GO_API_KEY** | **Settings**, **Machine secrets** (`app/src/MachineSecrets.tsx:63-64`) | Live chat needs that secret (`server/chat.ts:71-72`). |
| **Remove project from active use**, **Delete agent** | Project page and **Crew** (`app/src/ProjectHome.tsx:153-155`, `app/src/CatalogScreens.tsx:209-210`) | They remove what the owner asked you to create. |

## Production state when this was written

The owner measured these on 2026-11-13. This repository cannot confirm them. A difference is a finding to report. It is not proof that the app is wrong.

| Item | Measured value |
| --- | --- |
| Reachability | Private NetBird service with a valid public TLS certificate. Only devices in the NetBird group reach it. The phone must have NetBird connected. |
| `GET /healthz` | `200` with `{"code":"ready"}`. From the revision that removed provider attestations, the body also carries `"chat":"live"` (`server/gateway.ts` on `main`). |
| `GET /api/access` | `{"kind":"bearer"}` |
| `GET /api/session` | `401` without the token. `200` with `{"authenticated":true,"managedProjects":true}` with it. |
| `GET /api/catalog` | `{"projects":[],"agents":[],"projectsAvailable":true,"engines":["codex","pi"]}` |
| `GET /api/chats` | One thread, `chief-of-staff`, mode `live`. It already holds one smoke message from the installer. That reply took 6.6 seconds. |
| `GET /api/factory` | `gateway` is `online`, `runtime` is `ready`, `verification` is `unconfigured` |
| `GET /api/secrets` | Lists the name `OPENCODE_GO_API_KEY` |
| Codex | Runs on a ChatGPT subscription and is signed in. Codex CLI 0.167.1. The intended model id is `gpt-6.1-sol`. That CLI version has not yet been shown to accept it. |
| Pi | Runs on an OpenCode Go key. |
| Claude | Deliberately not supported in this deployment. |
| First delivery goal | Beans record `forge-yxl6`, "Document the first production delivery". Repository `mattsp1290/forge`, branch `main`, allowed path `docs/first-production-delivery.md`. Installed and waiting for approval. |
| Provider attestations | Removed. On the measured day, live model calls needed a dated owner statement that expired after 12 hours. Forge and Crew no longer read one, and nothing in this handoff expires. Valid provider credentials are enough. |
| Known issue | The Codex sidecar logs "Codex could not find bubblewrap on PATH". Beans record `forge-jlhw` tracks it. The impact is unknown until the first Codex turn. |
| Earlier pilot | Scaled to zero. Do not use a machine saved in the app with the pilot URL. Change or remove it with the owner's consent. |

## Tooling

Use the tools in the first table. The repository documents them, or they ship with Xcode.

| Tool | Use | Basis |
| --- | --- | --- |
| `npx expo run:ios --device --configuration Release --no-bundler` | Builds a signed Release app with bundled JavaScript and installs it on the phone. No Metro connection is needed. | `docs/mac-iphone-verification.md:202-215`, `docs/evidence/expo-ios-help.txt` |
| iPhone Mirroring | Drives the phone from the Mac and shows its screen for capture. Earlier acceptance runs used it. | `docs/evidence/acceptance.md:16`, `docs/evidence/contextless-closure-native-acceptance.md:5` |
| `xcrun devicectl` | Ships with Xcode. Lists devices and apps, installs a built app, starts the app and sets orientation. An earlier run installed with it after the Expo install stalled. | `docs/evidence/acceptance.md:44-45` |

These `devicectl` commands were checked against the help text of Xcode 26.2. Take the device identifier from the first command, set `FORGE_DEVICE` to it and keep it private.

```sh
xcrun devicectl list devices
xcrun devicectl device info apps --device "$FORGE_DEVICE"
xcrun devicectl device install app --device "$FORGE_DEVICE" /path/to/Forge.app
xcrun devicectl device process launch --device "$FORGE_DEVICE" --terminate-existing dev.birbforge.proof
xcrun devicectl device orientation set --device "$FORGE_DEVICE" landscapeLeft
xcrun devicectl device orientation set --device "$FORGE_DEVICE" portrait
```

The help text says `--terminate-existing` and orientation control are not supported on every platform. Whether they work on your iPhone is unverified. That help text lists no screenshot subcommand.

The items below are suggestions. This repository does not document them and they do not ship with Xcode.

- Capture the iPhone Mirroring window with the macOS `screencapture` tool.
- Take a screenshot on the phone with its buttons and move the image to the Mac privately.
- Record the phone screen with QuickTime Player when you need timings.
- Read a draft pull request with `gh pr view`.

iPhone Mirroring has limits that matter here. Earlier runs found its keyboard entry unreliable (`docs/evidence/contextless-closure-native-acceptance.md:29`). It types from the Mac keyboard, so the on-screen keyboard may not appear. It cannot turn the phone or reach every system control. Those three limits are not from this repository, so confirm them on your setup. Steps marked **Hands** need a person holding the phone. Ask the owner who that is. If nobody can do it, mark that check NOT RUN and say why.

## Prepare

### Check the Mac and the phone

1. Record the macOS, Xcode, Node and npm versions, the phone model and its iOS version. Keep the device identifier private.
2. Confirm the Mac and the phone are members of the NetBird group and that NetBird is connected on both. The app uses the phone's existing NetBird connection (`docs/development.md:56`).
3. Confirm the phone is paired, Developer Mode is on and existing signing works. If one is missing, report that gate and stop.
4. Confirm `bn show --project forge forge-c1ua` works and shows the private values. If the values are missing, ask the owner. Pass `--project forge` on every `bn` command in this handoff. In a new worktree `bn` can stop and ask for a project, because the Forge remote is linked to more than one.

### Check the route from the Mac

Set `FORGE_URL` in your shell from the private note, then run these.

```sh
curl -sS "$FORGE_URL/healthz"
curl -sS "$FORGE_URL/api/access"
curl -sS -o /dev/null -w '%{http_code}\n' "$FORGE_URL/api/session"
```

Expect `{"code":"ready","chat":"live"}` (`server/gateway.ts` on `main`), `{"kind":"bearer"}` (`server/gateway.ts:99-102`) and `401` (`server/gateway.ts:104-107`). If the health body has no `chat` field, production still runs a revision from before provider attestations were removed. If it reads `"chat":"local"`, the gateway answers chats from local inspection and makes no model call. In either case stop and tell the owner. If access reports `private-single-owner`, stop and tell the owner. This check covers the Mac's route only. It says nothing about the phone. A ready health check shows only that the listener runs (`docs/persistent-delivery.md:24`).

### Build the exact revision

Run these from an existing Forge clone on the Mac. If there is none, clone `https://github.com/mattsp1290/forge.git` first. Set `FORGE_MAC_CHECKOUT` to a new path outside that clone.

```sh
FORGE_REVISION=3221c40b24b3fbf0c0924544918cc96faf5277cc
git fetch origin main
git worktree add --detach "$FORGE_MAC_CHECKOUT" "$FORGE_REVISION"
cd "$FORGE_MAC_CHECKOUT"
git rev-parse HEAD
npm ci
npx expo install --check
npm run check
```

Use that commit unless the owner names a later one. Record the full hash you built. Do not build a moving branch tip (`docs/mac-iphone-verification.md:21-23`). Use the Mac's installed Node and npm, and do not run `scripts/setup` on the Mac (`docs/mac-iphone-verification.md:139-140`).

Do not reuse an older installed build. A build made before Forge accepted the `opencode-go` reviewer cannot parse the delivery snapshots this deployment produces (`docs/persistent-delivery.md:7`, `app/src/delivery-contract.ts:13`).

Leave `EXPO_PUBLIC_BIRBFORGE_URL` and `EXPO_PUBLIC_BIRBFORGE_ENDPOINT` unset. The **Server URL** field then starts empty, as the public app does (`app/src/settings.ts:25-34`, `README.md:36`). `env | grep EXPO_PUBLIC` should print nothing.

```sh
npx expo run:ios --device --configuration Release --no-bundler
```

Select the connected iPhone. The command generates the `ios` project, builds with existing Xcode signing and installs the app (`docs/mac-iphone-verification.md:212-215`). Do not commit the generated `ios` folder. If the Expo install step stalls, install the built app with `xcrun devicectl device install app`. The path of the built `.app` is unverified, so take it from the build log and record it. Do not use Expo Go (`docs/mac-iphone-verification.md:221-223`).

The app is named Forge, version 0.1.0, with bundle identifier `dev.birbforge.proof` (`app.json:3-9`). A successful build or install passes no journey (`docs/mac-iphone-verification.md:46`).

### Choose the starting state on the phone

Check whether Forge is already on the phone with `xcrun devicectl device info apps`. The bundle identifier has not changed (`tests/repository-rename.test.ts:22`), so a new build replaces the old one. Expect the old app's saved machines to survive that. This is iOS behavior and is not from this repository.

- **Clean install.** Preferred. Ask the owner, then delete the old app before installing. The app keeps only machine names and URLs, the theme, the text size and pending action records on the device (`app/src/settings.ts:9-11`, `app/src/chat-pending.ts:5`, `app/src/project-pending.ts:8`). It keeps no credential there.
- **Upgrade.** If the owner keeps the old app, record that. In J2 part A the **Machines** card then lists saved machines and the form does not open by itself. Do not connect to a machine whose URL is not `FORGE_URL`. Add production with **Add machine**. With the owner's consent, remove a machine that holds the pilot URL through **Manage machine**, **Remove machine** and **Remove from device** (`app/src/SettingsScreen.tsx:91-97`).

### Hold the owner token privately

The owner may prefer to enter the token on the phone personally. The last device run did that (`docs/evidence/contextless-closure-native-acceptance.md:5`, `docs/evidence/contextless-closure-native-acceptance.md:29`). If so, skip this section.

Otherwise run the token command from the private note with its output redirected. Replace `TOKEN_COMMAND` with that command. The command text holds no secret. Its output is the token.

```sh
set +x
umask 077
FORGE_PRIVATE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/forge-iphone-XXXXXX")
{ TOKEN_COMMAND; } | tr -d '\r\n' > "$FORGE_PRIVATE_DIR/owner-token"
grep -Eq '^[^[:space:]]{32,}$' "$FORGE_PRIVATE_DIR/owner-token" && echo ok
echo "$FORGE_PRIVATE_DIR"
```

The check before the last line should print `ok`. It tests the shape only. The last line prints the directory path. Note it. The path is not a secret, and you need it again in [Finish](#finish). The gateway refuses tokens shorter than 32 characters (`server/gateway.ts:23`). If `ok` is missing, the command failed or printed something else. Delete the file and ask the owner. Never run the token command without the redirect. Output that reaches the terminal also reaches an agent's transcript, and that counts as a leak under rule 1. Never print the file and never pass the token as a command argument.

Before each paste, copy the token with `pbcopy < "$FORGE_PRIVATE_DIR/owner-token"`. After each paste, clear the Mac clipboard with `pbcopy </dev/null` (`docs/mac-iphone-verification.md:196`). Then copy a harmless word on the phone, so the token does not stay on the phone's clipboard. Move it to the phone only by a method the owner already approves (`docs/mac-iphone-verification.md:197-198`). Universal Clipboard is one suggestion. Turn off any clipboard manager on the Mac before the first copy. The phone clipboard step and the clipboard manager step are precautions that are not from this repository.

You will enter the token at least three times. Keep the file until [Finish](#finish). Shell variables may not last between an agent's commands, so set `FORGE_URL`, `FORGE_PRIVATE_DIR` and `FORGE_EVIDENCE_DIR` again when you need them.

### Set up evidence

Create an evidence directory outside every Git checkout and set `FORGE_EVIDENCE_DIR` to it. Do not put it in a temporary folder that the system clears. Name files as each journey lists them. Add a number suffix when one screen needs more than one image. Capture the phone's own screen. A Mac browser window is not evidence for this handoff.

Keep a list of every message you send, with its thread and UTC time. J7.7 checks the threads against it.

Read every screenshot before you keep it. Delete any that shows the token, and report it under rule 1. Evidence stays on the Mac. Reports carry file names and hashes only.

### Optional baseline from the Mac

This records server state before you start. It supports the screenshots. It never replaces them, because an API response is not a claim about what the phone rendered (`docs/contextless-closure-native-handoff.md:21`).

```sh
set +x
umask 077
{ printf 'Authorization: Bearer '; cat "$FORGE_PRIVATE_DIR/owner-token"; printf '\n'; } > "$FORGE_PRIVATE_DIR/auth-header"
for name in session catalog chats factory secrets projects conversations; do
  curl -sS --max-time 20 -H @"$FORGE_PRIVATE_DIR/auth-header" "$FORGE_URL/api/$name" > "$FORGE_EVIDENCE_DIR/baseline-$name.json"
done
grep -c '"authenticated":true' "$FORGE_EVIDENCE_DIR/baseline-session.json"
```

The last line should print `1`. If it prints `0`, the token file is wrong. Stop before J1 and ask the owner. The saved responses hold no credential. The secrets route returns names only (`server/workspace.ts:42`). The header file holds the token, so keep it in the private directory.

## How the app holds the owner credential

Under bearer access the app keeps the owner token in memory only.

- A saved machine has an id, a name and an endpoint, and nothing else (`app/src/settings.ts:36-42`). That record is all the app writes to device storage for a machine (`app/src/settings.ts:129`, `app/src/settings.ts:139`).
- The token lives in React state as part of the active machine (`app/src/settings.ts:44`, `app/src/settings.ts:72`, `app/src/settings.ts:143`).
- At launch the app connects by itself only when a build-time endpoint is set and the gateway reports `private-single-owner` (`app/src/settings.ts:100-107`). A bearer gateway never connects by itself.
- The form says the same. It reads "The credential stays in memory until you disconnect, switch machines, or close the app." (`app/src/SettingsScreen.tsx:80`).

So after every cold start the machine is still listed but not connected, and the token must be pasted again. That is expected. Beans record `forge-n8sw` tracks Keychain storage. Do not file it again.

Sending the app to the background does not clear the token. If iOS ends the app while it is in the background, the next launch is a cold start. That last point is iOS behavior and is not from this repository.

## Journeys

Run them in this order. J2 part A, J1, J2 part B, J3, J4, J5, J6, J7. Several J7 checks happen during earlier journeys, so read J7 before you start.

Give each journey one result.

| Result | Meaning |
| --- | --- |
| PASS | Every pass criterion was observed on the phone. |
| FAIL | A fail criterion was observed. File a finding. |
| INCONCLUSIVE | Something outside the app stopped the check. Say what. A provider that refuses its credential and a blocked device step are examples. |
| NOT RUN | The journey was not started. Say why. |

### J1. Connectivity and sign-in

This proves the phone reaches production, a wrong token is refused in plain words, the right token connects, and a cold start drops the token.

1. **Hands.** On the phone, confirm NetBird is connected. The NetBird app's screens are unverified, record what you see.
2. Open Forge and select **Settings**. On a clean install the **Add a machine** form is already open (`app/src/SettingsScreen.tsx:107`).
3. Leave **Machine name** as Forge. Type `FORGE_URL` into **Server URL** as keystrokes. While you type, "Could not check access. Check your endpoint and private network connection." can appear for a partial URL. That is expected, because the form checks access after each pause (`app/src/SettingsScreen.tsx:34-51`).
4. Wait for the masked **Owner credential** field and the memory note under it (`app/src/SettingsScreen.tsx:77-80`). They appear only after the phone has read `/api/access` and it reported `bearer`.
5. Type `wrong-credential-for-negative-check` into **Owner credential** and select **Connect machine**.
6. Clear the field. Copy the token on the Mac as [Hold the owner token privately](#hold-the-owner-token-privately) describes and paste it, or have the owner enter it. Select **Connect machine**. Time it from the tap until **Connected** shows.
7. Clear the Mac clipboard and replace the phone's clipboard, as that section describes.
8. Cold start the app. Swipe it away in the app switcher and open it again, or run the `devicectl` launch command with `--terminate-existing`.
9. Look at **Factory**, then **Settings**. Select **Manage machine** and wait for the **Owner credential** field as in step 4. Enter the token again as in step 6 and select **Connect machine**. Clear both clipboards as in step 7.

**Expected.**

- Step 4. If "Could not check access. Check your endpoint and private network connection." stays with a **Check endpoint** button, the phone cannot reach production (`app/src/SettingsScreen.tsx:47`, `app/src/SettingsScreen.tsx:81-84`). Check NetBird and the URL. If "Connected through your private network." shows instead of the field, the gateway is not in bearer mode (`app/src/SettingsScreen.tsx:76`). Stop and tell the owner.
- Step 5. Red text reads "The gateway rejected this owner credential." (`app/src/settings.ts:65`, `app/src/SettingsScreen.tsx:85`). The form stays open. The header still shows **No machine** (`app/App.tsx:85`). Nothing is saved, because the app saves a machine only after the gateway accepts the credential (`app/src/settings.ts:136-139`).
- Step 6. The button reads **Working…** and the form closes. The **Machines** card shows the name, the URL and **Connected**, with **Edit connection** and **Disconnect machine** (`app/src/SettingsScreen.tsx:120-131`). The header shows the machine name. A **Machine secrets** card appears (`app/src/SettingsScreen.tsx:138`).
- Step 8. The app opens on **Factory** (`app/App.tsx:76`) with "Connect your factory" (`app/src/FactoryScreen.tsx:70`), and the header shows **No machine**.
- Step 9. **Settings** still lists the machine and its URL. It shows **Manage machine** and no **Connected** label (`app/src/SettingsScreen.tsx:126-129`). The form opens as **Edit machine** with the name and URL filled and an empty **Owner credential** field. After the paste it connects as in step 6.

**Evidence.** `j1-01-credential-field.png`, `j1-02-wrong-credential.png`, `j1-03-connected.png`, `j1-04-cold-start-factory.png`, `j1-05-cold-start-settings.png`, `j1-06-reconnected.png`. Record the seconds from **Connect machine** to **Connected**, both times.

**Pass.** All expected results were seen.

**Fail.** Any of these. The credential field never appears with NetBird connected. The wrong token connects. The wrong token is refused with no message, or with a message that does not say the credential was rejected. The right token is refused. The URL is lost after the cold start. The app is still connected after the cold start, which would contradict the source above.

### J2. Screen states on the fresh deployment

Part A covers the app before any machine is connected. Run it before J1. Part B covers the five screens after sign-in. Run it after J1.

On a phone in portrait the five tabs sit in a bar at the bottom, in the order **Chat**, **Projects**, **Crew**, **Factory**, **Settings** (`app/App.tsx:18-24`, `app/App.tsx:118`). The header shows the Forge mark and a machine button (`app/App.tsx:94`).

**Part A. No machine connected, clean install.**

| Screen | Expected | Source |
| --- | --- | --- |
| Launch | The app opens on **Factory**. The header button reads **No machine**. | `app/App.tsx:76`, `app/App.tsx:85` |
| **Factory** | Title "Factory" with "Machine health and work in progress." A card reads "ACTIVE MACHINE", "Connect your factory" and "Add a machine to see its runtime and verification queue.", with **Connect a machine**. **Service status** lists Forge gateway, Crew runtime and Verification service, each "Disconnected". There is no **Refresh status** button and no **Goal workflows** card. | `app/App.tsx:22`, `app/src/FactoryScreen.tsx:63-83`, `app/src/FactoryScreen.tsx:95` |
| **Chat**, **Projects**, **Crew** | The screen title, then a card "Connect a machine" with "Open Settings to connect to the Forge server for this workspace." and **Open settings**. | `app/App.tsx:108-113` |
| **Settings** | **Machines** reads "No machines saved on this device." The **Add a machine** form is open. **Machine name** holds Forge. **Server URL** is empty with the placeholder "https://your-server.example". A note reads "Connect to NetBird to reach your private Forge server." **Connect machine** and **Save machine** are disabled and **Cancel** is enabled. **Appearance** offers **System**, **Light**, **Dark**, **Standard text** and **Large text**. There is no **Machine secrets** card. | `app/src/SettingsScreen.tsx:16-17`, `app/src/SettingsScreen.tsx:65-71`, `app/src/SettingsScreen.tsx:87-89`, `app/src/SettingsScreen.tsx:107`, `app/src/SettingsScreen.tsx:118-119`, `app/src/SettingsScreen.tsx:138-152` |

**Part B. Connected to production, nothing created yet.**

| Screen | Expected | Source |
| --- | --- | --- |
| Header | The machine button shows the machine name. | `app/App.tsx:85` |
| **Factory** | The card shows the machine name, `FORGE_URL` and **Machine settings**. **Service status** has **Refresh status**. It reads Forge gateway "Online", Crew runtime "Ready" and Verification service "Not installed", then "Last checked" with a time. Rows can read "Unknown" for a moment first. There is no **Queue activity** card, because verification is not configured. | `app/src/FactoryScreen.tsx:63-86`, `server/factory.ts:14`, `server/factory.ts:25` |
| **Factory**, lower | A **Goal workflows** card reads "Start a goal or reopen its conversation and decision inbox." It has **New conversation**, **Find my conversations**, a **Conversation identity** field and a disabled **Continue conversation**. There is no **Open verification queue** button. Do not tap **New conversation** yet. | `app/src/GoalWorkflows.tsx:289-303` |
| **Chat** | Title "Chat" with "Conversations with your Crew." A pinned **Chief of Staff** entry reads "Pinned". **New chat** is below it. No other thread is listed. Select **New chat**. It shows "Choose an agent" and "Create an agent in Crew to start a chat." Select **Close agent list**. | `app/App.tsx:19`, `app/src/ChatScreen.tsx:188-204` |
| **Projects** | The managed projects page, because the session reports managed projects. It reads "Your projects", with **Back to conversations**, **Import repositories into a new project**, **Refresh projects** and "No active projects. Import repositories to begin." **Back to conversations** opens **Factory**. | `app/App.tsx:107`, `server/workspace.ts:26`, `app/src/ProjectHome.tsx:109-121` |
| **Crew** | Title "Crew" with "Your Crew agents and their project assignments." **New agent** and **Refresh agents**. A card reads "No crew agents yet" and "Add an agent and choose the projects it works on." | `app/App.tsx:21`, `app/src/CatalogScreens.tsx:188-194` |
| **Settings** | **Machines** shows the machine as in J1 step 6, plus **Add machine**. **Machine secrets** reads "Store credentials on this server. Live Crew chat uses the secret named OPENCODE_GO_API_KEY." It lists `OPENCODE_GO_API_KEY` with **Replace OPENCODE_GO_API_KEY** and **Remove OPENCODE_GO_API_KEY**, then **Add secret**. Do not tap them. **Appearance** is as in part A. | `app/src/SettingsScreen.tsx:120-134`, `app/src/MachineSecrets.tsx:56-65`, `app/src/MachineSecrets.tsx:86` |

**Evidence.** `j2a-factory.png`, `j2a-chat.png`, `j2a-projects.png`, `j2a-crew.png`, `j2a-settings.png`. Then `j2b-factory.png`, `j2b-factory-lower.png`, `j2b-chat.png`, `j2b-chat-agent-list.png`, `j2b-projects.png`, `j2b-crew.png`, `j2b-settings.png`.

**Pass.** Each screen shows what its row lists, with no error text.

**Fail.** A listed element is missing, an error shows, or a screen shows data nobody created. If the server state differs from the measured state above, record the difference and compare it with the Mac baseline before you call it an app defect.

### J3. Live chat with the Chief of Staff

1. Confirm that the health check under [Check the route from the Mac](#check-the-route-from-the-mac) reported `"chat":"live"`. If it did not, stop and tell the owner before you send anything.
2. Select **Chat**, then the pinned **Chief of Staff**.
3. Type "What is the current factory status?" and select **Send message**. Time it from the tap until the reply shows.

**Expected.**

- Step 2. The header reads "Chief of Staff" with "Crew chat" under it, and a **Chats** button returns to the list (`app/src/ChatScreen.tsx:119-121`). If it reads "Local inspection · Live model off", the gateway is not in live mode. Stop and tell the owner. The thread already shows the installer's smoke message and its reply. The empty state "What’s happening in the factory?" should not show (`app/src/ChatScreen.tsx:126-127`). The message field reads "Message Chief of Staff" (`app/src/ChatScreen.tsx:142`).
- Step 3. The button reads **Sending…** and the new turn reads "Waiting for a reply…" (`app/src/ChatScreen.tsx:134`, `app/src/ChatScreen.tsx:145`). The reply then shows under the name Chief of Staff (`app/src/ChatScreen.tsx:133`). The gateway allows 90 seconds for this reply and the app waits up to 100 (`server/chat.ts:75-76`, `app/src/ChatScreen.tsx:40`).
- The reply should agree with what **Factory** showed in J2. The chief reads a status line built from the gateway, the Crew runtime, the verification state, the crew roster and the projects (`server/chat.ts:26-52`). At this point that means gateway online, runtime ready, verification not configured, an empty roster and no projects. The wording is the model's own, so judge the facts and not the phrasing.

**Evidence.** `j3-01-thread-before.png`, `j3-02-waiting.png`, `j3-03-reply.png`. Record the UTC send time and the seconds to the reply.

**Pass.** One new turn exists. It has a reply within 90 seconds, and the reply does not contradict **Factory**.

**Fail.** An error notice shows. The reply contradicts **Factory**. The message appears twice. See [When a chat fails](#when-a-chat-fails) for each error text.

### J4. Codex and Pi members

The Codex chat is the first real test of the model id `gpt-6.1-sol` and of the bubblewrap issue. Treat its result as a check of its own. The phone never shows which model ran. A Codex reply shows only that the turn completed. The owner confirms from the server logs that it ran on the intended model id.

1. Select **Crew**, then **New agent**.
2. Enter the name `Codex check` and the instructions `Answer in one short sentence.` Under **Engine** select **Codex**. Select **Save agent**.
3. Select **New agent** again. Enter the name `Pi check` and the same instructions. Select **Pi**, then **Save agent**.
4. Select **Chat**. The Chief of Staff thread from J3 is still open, so select **Chats**. Select **New chat**, then **Codex check · Codex**.
5. Type "Say hello from Codex in one short sentence." and select **Send message**. Time it until the reply shows.
6. Select **Chats**. Select **New chat**, then **Pi check · Pi**.
7. Type "Say hello from Pi in one short sentence." and select **Send message**. Time it until the reply shows.
8. Select **Chats** and look at the list.

**Expected.**

- Step 2. The form is headed "New agent". It has **Agent name**, **Instructions**, "Assigned projects" with "Create a project to assign it here.", and an **Engine** row with **Workspace (built-in)**, **Codex** and **Pi** (`app/src/CatalogScreens.tsx:156-180`). An engine is offered only when the gateway has a profile for it (`server/workspace.ts:14`, `docs/member-chats.md:24`). After the save, the agent's card shows its name, its instructions, "No projects assigned" and "Engine · Codex" (`app/src/CatalogScreens.tsx:195-199`).
- Step 4. The agent list shows both agents with their engine (`app/src/ChatScreen.tsx:198`). The new thread is headed "Codex check" with "Crew member · Codex" (`app/src/ChatScreen.tsx:120-121`). It reads "Start a conversation" and "Send a message to Codex check." (`app/src/ChatScreen.tsx:127-128`).
- Steps 5 and 7. The send returns at once with the turn pending. The turn reads "Waiting for a reply…" and the button reads **Waiting for reply** (`app/src/ChatScreen.tsx:23`, `app/src/ChatScreen.tsx:145`). The app reads the chat again every five seconds until the turn finishes (`app/src/ChatScreen.tsx:88-92`, `docs/member-chats.md:47`). The reply then shows under the agent's name. Your timing is therefore accurate only to five seconds. The app reads again only while the thread is on screen and shows no error (`app/src/ChatScreen.tsx:89`). Stay in the thread. If an error notice with **Refresh messages** shows, select it and record it.
- Step 8. Each thread is listed under the first 64 characters of its first message, with the agent and engine below (`server/chat.ts:220`, `app/src/ChatScreen.tsx:208-209`).

**J4 failure steps, for a Codex turn that does not produce a reply.** The app shows only a fixed sentence for each outcome and never the underlying Codex error (`app/src/ChatScreen.tsx:22-31`, `docs/member-chats.md:53`). So do this.

1. Copy the on-screen sentence exactly, character for character.
2. Record the UTC time of the send and the UTC time the sentence appeared.
3. If the turn still reads "Waiting for a reply…" or "This agent is waiting for a decision that Forge cannot answer yet." after five minutes, record that and the elapsed time. Five minutes is this handoff's choice, not a limit in source.
4. If you made the header file for the Mac baseline, read the thread list with `curl -sS -H @"$FORGE_PRIVATE_DIR/auth-header" "$FORGE_URL/api/chats"` and find the thread id. Read `"$FORGE_URL/api/chats/<thread id>"` the same way and record the turn's `status` value. The possible values are listed in `app/src/chat.ts:11`. Never write the token into a command.
5. Start one new chat with **Codex check** and send the same message once. Record that result too. Do not try a third time.
6. Tell the owner at once. Give the exact sentence, both times and both results. The owner reads the Codex error from the server logs for that minute.
7. Add the result to `forge-jlhw` as a note, whether the turn worked or not.

Do the same for Pi, without step 7.

**Evidence.** `j4-01-agent-form-codex.png`, `j4-02-crew-list.png`, `j4-03-codex-waiting.png`, `j4-04-codex-reply.png`, `j4-05-pi-waiting.png`, `j4-06-pi-reply.png`, `j4-07-chat-list.png`, and `j4-08-failure.png` if a turn fails. Record the UTC send time and the seconds to each reply.

**Pass.** Both agents are saved with their engine. Each chat shows one turn with a reply under the agent's name. Report Codex and Pi separately.

**Fail.** An engine button is missing. A save shows an error. A turn ends with one of the sentences in [When a chat fails](#when-a-chat-fails). A turn is still waiting after five minutes.

### J5. Project and project chat

Use the repository `mattsp1290/forge` unless the owner names another. The expected sources below assume it.

1. Select **Projects**, then **Import repositories into a new project**.
2. Type `forge` into **Search accessible repositories**. Select **Select mattsp1290/forge**.
3. Leave the project name field empty. Its placeholder shows `forge`. Select **Create project**.
4. In the **Project chats** card select **New project chat**.
5. Read the context card. Record the commit and every source line.
6. Type "Using README.md, list the five workspace screens. Name the file you used." and select **Send message**. Time it until the answer shows.
7. Select **Back to project**.

**Expected.**

- Step 2. The picker is headed "Select GitHub repositories". It loads the gateway's list from `/api/github/repositories`, thirty rows at a time (`app/src/ProjectHome.tsx:36-46`, `app/src/projects.ts:29`, `server/github.ts:55-60`). After the tap the button reads **Selected mattsp1290/forge** and a line reads "Selected in order · mattsp1290/forge" (`app/src/ProjectHome.tsx:44-47`). Whether the gateway's GitHub token lists that repository is unverified. If it is missing, record that and ask the owner which repository to use.
- Step 3. The notice reads "Project saved." (`app/src/ProjectHome.tsx:100`). The page title becomes "forge", the default name from the first repository (`server/projects.ts:38`). A line shows the project id and a 12 character revision (`app/src/ProjectHome.tsx:132`). The **Repositories** card lists "mattsp1290/forge · GitHub ID" and a number (`app/src/ProjectHome.tsx:137`). The **Project chats** card reads "No chats yet." (`app/src/ProjectHome.tsx:151`). If the notice reads "Saved in the local Beans hub. Publication is not confirmed.", that is a fail. A new chat needs a published hub (`docs/project-chats.md:54`, `server/beans-projects.ts:52-55`).
- Step 4. The chat opens with "BIRBFORGE / PROJECT CHAT", the project name and "Discuss your project using versioned repository sources and scoped notes." (`app/src/GoalWorkflows.tsx:180-182`). A card shows **Conversation identity**, a status line and **Reconnect**, **Disconnect** and **Back to project** (`app/src/GoalWorkflows.tsx:183-192`). The exact status words are unverified, record what you see.
- Step 5. The context card reads "This chat uses the current project revision." (`app/src/GoalWorkflows.tsx:167`). It lists the repository with a 40 character commit, then one line for each frozen file and each missing file (`app/src/GoalWorkflows.tsx:196-199`). The gateway looks for four files at that commit and takes those up to 24,000 bytes (`server/github.ts:97-111`). At the commit this handoff was written against, expect "Source" lines for `README.md` and `docs/design-decisions.md`, and "Unavailable source" lines ending in "missing" for `AGENTS.md` and `docs/architecture.md`. The chat freezes the head of the default branch when it is created (`server/github.ts:89-90`), so a later commit can differ. On the Mac, `git show <commit>:README.md | shasum -a 256` should start with the 12 characters on the `README.md` line.
- Step 6. The field is labelled "Message your project assistant" (`app/src/GoalWorkflows.tsx:233-234`). After the send the notice reads "Message accepted." (`app/src/controller.ts:165`). The counter reads "1 messages sent. Reconnect observes finalized history without resending." (`app/src/GoalWorkflows.tsx:241`). The answer shows in the conversation under a role label (`app/src/GoalWorkflows.tsx:212-214`). The label text is unverified, record what you see.
- The answer should name Factory, Projects, Crew, Chat and Settings, which is what `README.md:30-34` lists. It should name `README.md` as its source. How the assistant cites sources when not asked is set in Crew and is unverified here, which is why the message asks for the file by name.
- Step 7. The project page lists the chat as **Open chat** with the first eight characters of its identity (`app/src/ProjectHome.tsx:150`).

**Evidence.** `j5-01-picker.png`, `j5-02-project.png`, `j5-03-chat-context.png`, `j5-04-answer.png`, `j5-05-project-chat-list.png`. Record the conversation identity, the commit, the UTC send time and the seconds to the answer.

**Pass.** The project is saved and published. The chat lists at least `README.md` as a source. The answer names the five screens correctly and names a file that the context card lists.

**Fail.** The repository list does not load. The save or the new chat shows an error notice. The answer is wrong about the five screens. The answer names no source after being asked. The answer cites a file that the context card does not list. No answer shows within three minutes. Three minutes is this handoff's choice, not a limit in source.

### J6. Delivery approval of forge-yxl6

Part A only looks. It spends nothing. Part B approves. **Part B needs the owner's explicit go-ahead at the time you reach it.** Approval spends subscription usage and opens a real draft pull request on `mattsp1290/forge`.

**Part A. Read the installed goal.**

1. Select **Factory** and scroll to **Goal workflows**.
2. Select **Find my conversations**. Compare the eight characters on each button with the identity you recorded in J5. Select the first conversation that is not your J5 project chat. If there is none, select **New conversation** once. Whether this list includes project chats is unverified, record what you see. A conversation headed "BIRBFORGE / PROJECT CHAT" is the wrong one, so leave it.
3. Record the **Conversation identity**.
4. Read the delivery card. Select **Inbox (1)** and read it again.
5. On the Mac run `bn show --project forge forge-yxl6` and compare its text with the goal text on the card.

**Expected.**

- Step 2. The conversation is headed "BIRBFORGE / PRIVATE PILOT" with "Approve one goal. Follow its reviewed draft PR across devices." (`app/src/GoalWorkflows.tsx:180-182`). If it reads "BIRBFORGE / LOCAL PROOF", the gateway is not in approved goal mode. Stop and tell the owner. The identity card offers **Reconnect**, **Disconnect** and **Close goal** (`app/src/GoalWorkflows.tsx:189-191`).
- Step 4. The buttons read **Conversation** and **Inbox (1)** (`app/src/GoalWorkflows.tsx:203-204`). The heading reads "Goal conversation", or "Your decision inbox" on the inbox (`app/src/GoalWorkflows.tsx:206`). Both show the same card (`app/src/GoalWorkflows.tsx:229`).
- The card shows the goal title, the goal text, "Repository ·", "Allowed changes ·" and "Base ·" lines, then a stage line (`app/src/DeliveryPanel.tsx:17-22`). Expect the title "Document the first production delivery", the allowed change `docs/first-production-delivery.md` and the stage "awaiting approval · connected". The exact repository text and base commit are unverified, record what you see. The card does not show the Beans record id.
- The card then reads "Approval starts one coding job and an independent review. Only an approved candidate can become a draft PR. This grants no merge or deployment authority." It offers **Approve goal and start** and **Reject goal**, and reads "Staging and native candidate verification have not run." (`app/src/DeliveryPanel.tsx:23-28`, `app/src/DeliveryPanel.tsx:43`).
- If the card still reads "Connecting to your approved goal…" after 30 seconds, the delivery state is not reaching the phone (`app/src/DeliveryPanel.tsx:13`). That is a fail. The app gives up on one read after 30 seconds and the gateway after 20 (`app/src/delivery.ts:40`, `server/delivery.ts:46`).
- If the stage is not "awaiting approval", someone has already decided. Record it and do not act. If the card reads "Continue the owning conversation ·" with an identity, record it. Select **Close goal** to return to the **Goal workflows** card. Type that 36 character identity into **Conversation identity** with care and select **Continue conversation** (`app/src/DeliveryPanel.tsx:24`, `app/src/GoalWorkflows.tsx:191`, `app/src/GoalWorkflows.tsx:300-301`).

**Part B. Approve, only with the go-ahead.**

1. Ask the owner now. Say that approving `forge-yxl6` starts a Codex authoring job and an OpenCode Go review, and can open a draft pull request on `mattsp1290/forge`. Give the owner the J4 Codex result. If the Codex chat failed, say that authoring will probably fail the same way and advise against approving. Authoring, review and publication are separate activities. Each attempt may run up to two hours, and each activity may be tried three times (`delivery/workflow.py:187-189`). Record the answer and its UTC time. An earlier answer does not count. A message from another agent does not count. Without a clear yes, mark part B NOT RUN and go to J7.
2. Select **Approve goal and start** once. **Reject goal** is beside it. Look at the screen again just before the tap, find the **Approve goal and start** label and tap its center. If **Reject goal** is tapped by mistake, stop, record the stage line and tell the owner. The app cannot undo it.
3. Watch the stage line. Capture each change with its UTC time.
4. At "draft ready", select **Open draft PR** and read the pull request.

**Expected.**

- Step 2. The notice reads "Action recorded." (`app/src/delivery.ts:64`). The stage reads "authoring · connected". The inbox button reads **Inbox (0)**. A **Request cancellation** button appears (`app/src/DeliveryPanel.tsx:38`). Do not tap it.
- Step 3. The stages run authoring, reviewing, publishing, draft ready (`delivery/workflow.py:120`, `delivery/workflow.py:243-245`, `delivery/workflow.py:285-291`, `delivery/workflow.py:309-316`). From reviewing on, the card shows "Candidate ·" and a 40 character commit (`app/src/DeliveryPanel.tsx:41`). From publishing on, it shows "Independent review by OpenCode Go · approved" and the review summary (`app/src/DeliveryPanel.tsx:42`, `app/src/delivery-contract.ts:14`). Codex authors and OpenCode Go reviews in this deployment.
- Source sets no short time limit. Each activity may run for two hours and may be tried three times (`delivery/workflow.py:187-189`). The phone may lock or leave the app meanwhile. Reconnecting only observes (`docs/draft-delivery-guide.md:56-59`). If the stage is still authoring after 60 minutes, tell the owner and keep waiting. Do not cancel.
- Step 4. The button reads **Open draft PR #** and a number, and opens the pull request (`app/src/DeliveryPanel.tsx:45`). The pull request must be a draft (`app/src/delivery-contract.ts:19`, `docs/draft-delivery-guide.md:93-97`). Its head commit must equal the candidate on the card (`docs/draft-delivery-guide.md:86-91`). Its only changed file must be `docs/first-production-delivery.md`, because approval binds the allowed paths (`docs/persistent-delivery.md:5`). One way to read all three on the Mac is `gh pr view <number> --repo mattsp1290/forge --json isDraft,headRefOid,files`. That command is a suggestion.
- If the notice reads "Acknowledgement unknown. Retry the unchanged action or reconnect to reconcile.", select **Reconnect** first and read the stage. If the action is still pending, select **Retry unchanged delivery action** once (`app/src/delivery.ts:66-67`, `docs/draft-delivery-guide.md:61-67`). Never approve from a second conversation.
- If the stage becomes "changes requested", "blocked", "uncertain" or "cancelled", record the stage, the reason line and the review summary exactly, with the UTC time (`app/src/DeliveryPanel.tsx:42-44`). Tap nothing more on the card. Tell the owner. If authoring failed, add a note to `forge-jlhw`.

**Leave the pull request as a draft for the owner.** Do not merge it, close it, comment on it or mark it ready.

**Evidence.** `j6-01-offer.png`, `j6-02-inbox.png`, then `j6-03-authoring.png`, `j6-04-reviewing.png`, `j6-05-publishing.png`, `j6-06-draft-ready.png`, `j6-07-pull-request.png`. Record the conversation identity, the owner's go-ahead and its time, the UTC time of each stage, the candidate commit and the pull request number.

**Pass, part A.** The pilot conversation opens and the card shows the expected goal at "awaiting approval · connected" on both views.

**Pass, part B.** The app showed every stage through "draft ready". The reviewer reads OpenCode Go with "approved". The pull request is a draft, matches the candidate and changes only the allowed path.

**Fail.** The card never loads. The goal on the card is not the expected one. A stage change on the server does not reach the phone. The pull request is not a draft, does not match the candidate or changes another path. Report a "changes requested", "blocked" or "uncertain" outcome as the delivery result, and say separately whether the app displayed it correctly.

### J7. Mobile quality

These are the things a person would notice. Do checks 1 to 3 during J3 to J5. Do the rest after J6. Report each check on its own line.

#### J7.1 Keyboard and message field

**Hands.** Open the Chief of Staff thread, a project chat and the **New agent** form. In each, tap the text field so the on-screen keyboard opens. In the chat field type four lines of text. Do not send them. Clear the field afterwards.

**Expected.** The field and its send or save button stay visible above the keyboard, or scrolling brings them into view. The app pads its content above the keyboard on iOS (`app/App.tsx:95`). The tab bar sits outside that padded area (`app/App.tsx:118`). What happens to the tab bar is unverified, record what you see. After each send in J3 and J4, the newest turn is in view (`app/src/ChatScreen.tsx:123-124`).

#### J7.2 Safe areas

Look at every screen in portrait.

**Expected.** The header clears the top sensor area and the tab bar clears the home indicator. The whole app sits inside a safe area view (`app/App.tsx:126`).

#### J7.3 Text size in the app

In **Settings** select **Large text**. Visit every screen and one chat. Select **Standard text** again.

**Expected.** Headings, body text and buttons from the shared components grow (`app/src/ui.tsx:20-27`, `app/src/ui.tsx:43`). **Chat**, **Crew**, **Settings** and the projects page grow with them. The machine banner on **Factory**, most labels in a goal or project conversation and the delivery card keep fixed sizes (`app/src/FactoryScreen.tsx:99-104`, `app/src/GoalWorkflows.tsx:306-330`, `app/src/DeliveryPanel.tsx:50-53`). Record which parts did not grow. That alone is not a failure. No label is cut off and no button is pushed out of reach. The choice is saved on the device (`app/src/settings.ts:165-168`).

#### J7.4 Rotation

**Hands**, or the `devicectl` orientation command. Turn the phone to landscape on **Factory**, on **Chat** with a thread open and some typed text, and on a project chat. Turn it back.

**Expected.** The app does not lock orientation (`app.json:6`). At a width of 850 points or more it moves the tabs into a left sidebar (`app/App.tsx:75`). At 840 or more **Chat** shows the list beside the thread (`app/src/ChatScreen.tsx:153`). Which layout your phone gets is unverified, record what you see. The open screen and the typed text survive the turn. Every control stays reachable.

#### J7.5 Background and foreground

1. From **Factory**, go to the Home Screen for 30 seconds and return.
2. From a project chat, do the same.
3. In the Chief of Staff thread send "Reply with the word ready." and go to the Home Screen at once. Return after 30 seconds. Stay in the thread.

**Expected.**

- The app is still connected each time and the header still shows the machine. If the header shows **No machine** on return, iOS ended the app. Record that as a cold start, sign in again and repeat the step once. It fails this check only if it happens again.
- **Factory** stops checking in the background and checks again on return (`app/src/FactoryScreen.tsx:27-35`).
- The project chat disconnects and reconnects by itself (`app/src/GoalWorkflows.tsx:131-137`). Its message count does not change.
- The Chief of Staff turn ends with one reply. If "The reply could not be received. Retry this message to recover it." shows, select **Retry message** once. The retry sends the same message identity, and the gateway does not store it twice (`app/src/ChatScreen.tsx:93-109`, `server/chat.ts:229-241`).

#### J7.6 Network loss

**Hands.** Airplane Mode ends iPhone Mirroring, so capture on the phone.

1. Open the Chief of Staff thread while online. Type "Reply with the word online." and do not send it.
2. Turn on Airplane Mode and make sure Wi-Fi is off.
3. Select **Send message**. Stay in the thread. The **Chats** button would discard the unsent message.
4. Select the **Factory** tab, then **Refresh status**.
5. Select the **Crew** tab. Select the **Projects** tab.
6. Turn Airplane Mode off and wait for NetBird to reconnect.
7. Select the **Chat** tab. The thread is still open. Select **Retry message**.
8. Turn NetBird off and leave the network on. On **Factory** select **Refresh status**. In **Chat** select **Chats** to return to the list, which loads it again. Time each error. Turn NetBird on again.

**Expected.**

- Step 3. The thread reads "The reply could not be received. Retry this message to recover it." with **Refresh messages**. The field keeps your text and the button reads **Retry message** (`app/src/ChatScreen.tsx:109`, `app/src/ChatScreen.tsx:137-138`, `app/src/ChatScreen.tsx:144-145`).
- Step 4. **Factory** reads "Could not refresh factory status. Check the machine connection or try again." and its rows read "Unknown" (`app/src/FactoryScreen.tsx:50`, `app/src/FactoryScreen.tsx:63`).
- Step 5. **Crew** is written to read "Could not reach the catalog. Check your connection and retry." with **Refresh list** (`app/src/CatalogScreens.tsx:51`, `app/src/CatalogScreens.tsx:70`). That line shows this sentence only when the error's name is not `Error`. The native transport is Expo's fetch (`app/src/transport.native.ts:1-3`). In the pinned Expo 55.0.32 that fetch raises an error named `Error` whose message starts with "fetch failed". After `npm ci` you can read that in `node_modules/expo/src/winter/fetch/FetchErrors.ts`. So the phone may show the raw message instead. Unverified, record what you see.
- Step 5. **Projects** reads "acknowledgement unknown" and offers **Restore pending project actions** (`app/src/projects.ts:17`, `app/src/ProjectHome.tsx:75`, `app/src/ProjectHome.tsx:112`).
- Step 7. The retry gets one reply. The app is still connected, with no new paste.
- Step 8. **Factory** shows the same sentence as in step 4. The **Chat** list shows the transport's own message with **Refresh chats** (`app/src/ChatScreen.tsx:168`, `app/src/ChatScreen.tsx:202`). Unverified, record what you see. A request can wait 12 seconds on **Factory** and up to 100 on the **Chat** list before the error shows (`app/src/FactoryScreen.tsx:43`, `app/src/ChatScreen.tsx:40`).
- After the network returns, **Factory** checks again by itself about 15 seconds after its last check ended (`app/src/FactoryScreen.tsx:54-56`). The other screens recover when you act. Select **Refresh chats** on the **Chat** list, **Refresh list** on **Crew** and **Restore pending project actions** on **Projects**, or open the tab again.

File a priority 3 finding for each screen that shows a raw transport message, such as text starting with "fetch failed". That alone does not fail this check.

#### J7.7 Chats after a relaunch

Cold start the app and sign in again as in J1 step 9. Open **Chat** and each thread. Open **Crew**. Open **Projects**, the project and its chat. Open **Factory** and select **Find my conversations**.

**Expected.** Everything from J3 to J6 is still there, once. The Chief of Staff thread has the installer's turn and every message on your list. Both member threads are listed with their engine. Both agents are listed. The project opens from **Open forge** and lists its chat (`app/src/ProjectHome.tsx:122`, `app/src/ProjectHome.tsx:150`). The J6 conversation opens with the same identity and its current stage. This state lives on the server and not on the phone (`server/chat.ts:99-110`, `server/catalog.ts:61-64`). The theme and text size also survive (`app/src/settings.ts:87-90`).

#### J7.8 System text size

Optional. **Hands.** Raise the iOS text size and look at **Factory**, **Chat** and **Settings**. Set it back.

**Expected.** Unverified, record what you see. The app sets no rule for system text size, and earlier acceptance deferred this check (`docs/evidence/acceptance.md:6-8`). File a finding only if a main control becomes unreachable.

The delivery card uses fixed dark colors in every theme (`app/src/DeliveryPanel.tsx:50-53`). Note how it looks in **Light**. That alone is not a failure.

**Evidence.** `j7-1-keyboard-chat.png`, `j7-1-keyboard-project-chat.png`, `j7-1-keyboard-agent-form.png`, `j7-2-safe-area.png`, `j7-3-large-text.png`, `j7-4-landscape.png`, `j7-5-background-return.png`, `j7-6-offline-thread.png`, `j7-6-offline-factory.png`, `j7-6-offline-crew.png`, `j7-6-offline-projects.png`, `j7-6-retry.png`, `j7-6-netbird-off-factory.png`, `j7-6-netbird-off-chat-list.png`, `j7-7-relaunch.png`, `j7-8-system-text.png`. Record the seconds until each error shows in step 8 of J7.6.

**Pass.** Checks 1 to 7 show what they expect.

**Fail.** Any of these. The keyboard hides a field or its button and scrolling cannot reach it. Content sits under the sensor area or the home indicator. A control is cut off or out of reach in portrait or landscape. The app loses its connection on a short trip to the background. An offline screen shows no message or never stops loading. A retry stores a message twice. Anything from J3 to J6 is missing or doubled after the relaunch.

## When a chat fails

The app maps each failure to one fixed sentence. Use this table to read it.

| On screen | Where | What source says | What to do |
| --- | --- | --- | --- |
| "Crew could not finish the reply. Check the gateway provider configuration and retry." | Chief of Staff | The reply process failed or passed its 90 second limit (`server/chat.ts:75-79`, `app/src/ChatScreen.tsx:15`). A provider that refuses the key ends the process the same way. | Fail. Tell the owner. |
| "Add OPENCODE_GO_API_KEY under Machine secrets in Settings, then retry this message." | Chief of Staff | The secret is missing on the server (`server/chat.ts:71-72`). | Fail. Tell the owner. Do not add a secret. |
| "The gateway needs a Crew Python runner to answer live chats." | Chief of Staff | The gateway has no chat runner (`server/chat.ts:70`). | Fail. Tell the owner. |
| "Waiting for a reply…" that never ends | Member chat | The turn is still pending. The gateway does not report why (`docs/member-chats.md:49-53`). | Follow the J4 failure steps. |
| "Crew could not run this message. Start a new chat to continue." | Member chat | Crew reported the turn as failed (`docs/member-chats.md:62`). | Follow the J4 failure steps. |
| "Crew rejected this message. Start a new chat to continue." | Member chat | Crew refused the member, the conversation or the request (`docs/member-chats.md:65`, `server/members.ts:48-49`). | Follow the J4 failure steps. |
| "Crew could not confirm whether this reply finished, so it will not be retried. Start a new chat to continue." | Member chat | Crew reported the turn as uncertain (`docs/member-chats.md:64`). | Follow the J4 failure steps. |
| "This agent is waiting for a decision that Forge cannot answer yet." | Member chat | Crew reported the turn as waiting. The turn stays pending and the app keeps reading (`docs/member-chats.md:60`, `app/src/chat.ts:23`). | Follow the J4 failure steps. |
| "This message was cancelled before it ran. Start a new chat to continue." | Member chat | Crew reported the turn as cancelled (`docs/member-chats.md:63`). | Follow the J4 failure steps. |
| "This chat reached Crew’s message limit. Start a new chat to continue." | Member chat | The thread reached Crew's turn limit (`docs/member-chats.md:73`). | Not expected on a first message. Follow the J4 failure steps. |
| "This agent’s engine is not available on this gateway. Choose another engine for the agent in Crew." | New member chat | The gateway has no profile for that engine (`server/chat.ts:205-206`, `app/src/ChatScreen.tsx:17`). | Fail. Tell the owner. |
| "Reconnect in Settings with the owner credential." | Any chat | The gateway answered 401 or 403 (`app/src/ChatScreen.tsx:34`). | Check whether the app cold started. Sign in again. |
| "The reply could not be received. Retry this message to recover it." | Any chat | The request did not complete (`app/src/ChatScreen.tsx:109`). | Check the network. Select **Retry message** once. |

A failed, cancelled, uncertain, rejected or limit outcome ends a member chat. The message field is then replaced by "This conversation has ended. Start a new chat to continue." (`app/src/chat.ts:24`, `app/src/ChatScreen.tsx:140`). A pending or waiting turn does not end the chat.

**A refused provider credential is an owner task, not an app bug.** No provider attestation exists any more, so no failure here comes from an expired statement and nothing needs renewing. If a chat, a project answer or the delivery fails because a provider refuses its key or Codex is signed out, stop sending messages. Mark the affected journey INCONCLUSIVE and tell the owner. Do not change a credential yourself. The "Acceptance checklist" in `docs/forge-production.md` in the private repository `mattsp1290/birbhomes` lists the same journeys from the server side. What the phone shows in a member chat or a project chat when a provider refuses its credential is unverified, record what you see.

## Finish

1. In **Settings** select **Disconnect machine**. The header shows **No machine** and the token leaves memory (`app/src/settings.ts:150-153`).
2. Check the evidence for the token before you delete the token file. Set `FORGE_PRIVATE_DIR` to the path you noted. Run `grep -rlF -f "$FORGE_PRIVATE_DIR/owner-token" "$FORGE_EVIDENCE_DIR"`. It names any file that holds the token and should print nothing. It cannot read text inside an image, so look through every screenshot once more. If the owner entered the token personally there is no token file, so only look through the screenshots.
3. Clear the clipboard with `pbcopy </dev/null`. Delete the private directory with `rm -rf "$FORGE_PRIVATE_DIR"`. Then run `ls -d "${TMPDIR:-/tmp}"/forge-iphone-*`. A "no matches" or "no such file" message means none is left. If it lists a directory, the token file is still on disk, so remove it before you finish.
4. Keep the evidence directory flat, with no subfolders. Run `cd "$FORGE_EVIDENCE_DIR" && rm -f SHA256SUMS && shasum -a 256 -- * > SHA256SUMS`.
5. Leave the app installed. Leave the agents, the project, the chats and the draft pull request as they are.

## Results template

Copy this into a file beside the evidence directory, not inside it, and fill it in.

| Field | Value |
| --- | --- |
| Run started and ended, UTC | |
| Forge commit built | |
| Mac, macOS, Xcode, Node | |
| iPhone model and iOS | |
| How the phone was driven | |
| Starting state, clean install or upgrade | |
| Health check reported `"chat":"live"`, yes or no | |
| Times the token was entered | |
| Token kept out of all evidence, yes or no | |
| Evidence directory and hash of `SHA256SUMS` | |

| Journey | Result | Timings | Evidence files | Findings filed | Notes |
| --- | --- | --- | --- | --- | --- |
| J1 Connectivity and sign-in | | Connect seconds, first and second | | | |
| J1 Wrong token refused clearly | | | | | Exact text shown |
| J1 Cold start needs the token again | | | | | |
| J2 part A, no machine | | | | | |
| J2 part B, connected | | | | | |
| J3 Chief of Staff | | Seconds to reply | | | |
| J4 Codex member | | Seconds to reply | | | Exact text if it failed |
| J4 Pi member | | Seconds to reply | | | Exact text if it failed |
| J5 Project created | | | | | Project id |
| J5 Project chat answer cites sources | | Seconds to answer | | | Commit and sources listed |
| J6 part A, goal shown | | | | | Conversation identity |
| J6 part B, approval | | UTC time of each stage | | | Go-ahead and its time, final stage, pull request number |
| J7.1 Keyboard | | | | | |
| J7.2 Safe areas | | | | | |
| J7.3 Text size in the app | | | | | |
| J7.4 Rotation | | | | | Layout seen in landscape |
| J7.5 Background and foreground | | | | | |
| J7.6 Network loss | | Seconds to each error | | | Exact text on the **Chat** list |
| J7.7 Chats after a relaunch | | | | | |
| J7.8 System text size | | | | | Observation only |

| Check on a known issue | Result |
| --- | --- |
| Codex member replied, yes or no. If no, the on-screen sentence word for word. The owner confirms the model id `gpt-6.1-sol` from the server logs. | |
| First Codex turn and the bubblewrap issue `forge-jlhw` | |
| Every "unverified, record what you see" item, with what you saw | |

The run passes when J1 to J5, J6 part A and J7 checks 1 to 7 pass. Report J6 part B on its own line, because it depends on the owner's go-ahead.

## What to report back and to whom

Report to the owner. Use Beans for the record, in the `forge` project.

1. Tell the owner at once about any of these. Do not wait for the end of the run.
   - A token leak.
   - A wrong token that connects.
   - A gateway that is not in bearer mode.
   - A Codex turn that fails.
   - A delivery stage other than the expected ones.
2. File each finding as its own issue with the label `production`.

   ```sh
   bn create --project forge "Short title" -t bug -p 2 -l production -d "details" --silent
   ```

   Use priority 1 when the finding failed a journey, 2 for a defect that did not, and 3 for a cosmetic one. Give no token and no private value. Put these in the details.
   - The journey and step.
   - What was expected, with its source line.
   - What the phone showed, word for word.
   - The UTC time.
   - The commit built, the phone model and the iOS version.
   - The evidence file names.
3. Do not file what is already tracked. Add a note instead. `forge-n8sw` covers pasting the token after every cold start. `forge-jlhw` covers the bubblewrap message, and it gets a note with the result of the first Codex turn either way.
4. Put the results on `forge-c1ua` with `bn note --project forge forge-c1ua "text"`. Leave `forge-c1ua` open for the owner to close. Give these.
   - The commit built, the phone model and the iOS version.
   - One result for each line of the template.
   - The ids of the findings.
   - The evidence directory and the hash of `SHA256SUMS`.
5. Run `bn` writes one at a time. Each one syncs the shared hub.
6. Keep screenshots and recordings on the Mac. Share them with the owner privately when asked.

## What this handoff could not ground in source

Treat these as open until you observe them.

- Everything under [Production state when this was written](#production-state-when-this-was-written). The owner measured it.
- What the phone shows when Codex refuses the model id, and what a member chat or project chat shows when a provider refuses its credential.
- Whether a project answer cites sources without being asked, and the role labels on project chat messages.
- The repository text and base commit on the delivery card, and whether its goal text matches `forge-yxl6` word for word.
- Whether **Find my conversations** lists project chats, and whether the gateway's GitHub token lists `mattsp1290/forge`.
- The error text on the **Chat** list and on **Crew** when the network is down. It depends on the pinned Expo package, not on this repository.
- The behavior of the keyboard, the tab bar and landscape layout on your phone.
- The limits of iPhone Mirroring, the path of the built `.app`, and whether the `devicectl` launch and orientation commands work on an iPhone.
- iOS behavior. That covers app data surviving a reinstall, the system ending a background app, and system text size.
- That the gateway runs in approved goal mode. The owner's delivery facts imply it.
- What the private runbook says. It was read once while this page was written and is not in this repository.
- The suggested tools and precautions, including Universal Clipboard, the clipboard precautions and reading curl headers from a file.
- The waiting limits of five minutes, three minutes and 60 minutes. This handoff chose them.
