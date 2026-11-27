# rve-sync (WordPress plugin for ruralgreece.gr)

Tells the Rural Value Engine when a `business`, `route` or `pois` post is published, updated, unpublished or deleted. The engine then fetches that post from the public REST API. The engine also does a full re-read every night, so a missed notification is fixed by the next morning.

## Install
1. Zip this folder and upload it under **Plugins → Add New → Upload**, or copy it to `wp-content/plugins/rve-sync`.
2. Activate it.
3. Under **Settings → Rural Value Engine**, enter the engine URL and the shared secret (the engine's `WP_WEBHOOK_SECRET`).

It only sends a small signed notice (`{type, id, action}`). It never sends content or personal data, and it doesn't slow down saving, because requests are non-blocking.
