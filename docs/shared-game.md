# Private shared game

`/` remains the local game. `/shared.html` renders authoritative snapshots through
SharedSession; it never advances, replaces or autosaves the shared World locally.
The private transport must serve the production frontend and same-origin API.

Joining takes a name and nothing else: the credential cookie is the whole account.
It admits a player without claiming an island. Choose an available island,
confirm the claim, then place its founding harbour. A claim focuses that city's
landing. A rejected claim keeps the selected island and displays the reason;
Cancel leaves the dialog without retrying. Pending claims disable both atlas
selection and confirmation. Cancel remains available.

Construction, vendors and founding require an owned, viewed city and a ready
session. Disconnects disable these controls and cancel unfinished gestures.
Read-only visits and camera controls remain available. A login change preserves a
still-valid viewed city and camera, while H returns to the newly owned city.
A realm change resets presentation.

An uncertain action may already have applied. Cancel the claim dialog to access
recovery controls. Discard asks for confirmation and abandons only recovery, never
rolls back the world. Cancelling confirmation preserves pending bytes. No action is
automatically retried as fresh intent. Request outcomes are associated with their
sequence and realm/login scope; promise fallback and event delivery share one
presentation path.

Menus do not pause shared time. Shared mode exposes no local checkpoint, import,
export, reset, undo or speed controls. Browser storage failures still allow
read-only snapshots. Startup failure retains a visible error and closes the socket.
