# The shared game

`/` is the only game. It renders authoritative snapshots through SharedSession; it
never advances, replaces or saves the World locally. The private transport must
serve the frontend and same-origin API. There is no local mode, no checkpoint,
import, export, undo or speed control: the server owns the world and its clock.
A menu pause of one's own, for a world nobody else is playing, is still to come.

Joining takes a name and nothing else: the credential cookie is the whole account.
It admits a player without a city. The camera opens on the whole sea; hovering a
shore previews a harbour, R turns it, and clicking places it. That placement is the
claim: the island under the quay becomes yours, the city is founded and named after
you, and the view settles on it. A refused site says why and costs nothing.

Founding requires a ready session and no city yet. Construction and vendors
require an owned, viewed city and a ready session. Disconnects disable these controls and cancel unfinished gestures.
Read-only visits and camera controls remain available. A login change preserves a
still-valid viewed city and camera, while H returns to the newly owned city.
A realm change resets presentation.

An uncertain action may already have applied. Cancel the claim dialog to access
recovery controls. Discard asks for confirmation and abandons only recovery, never
rolls back the world. Cancelling confirmation preserves pending bytes. No action is
automatically retried as fresh intent. Request outcomes are associated with their
sequence and realm/login scope; promise fallback and event delivery share one
presentation path.

Menus do not pause shared time. Browser storage failures still allow
read-only snapshots. Startup failure retains a visible error and closes the socket.
