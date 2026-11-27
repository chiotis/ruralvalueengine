# Deploying to lighthouse03

How to install the Rural Value Engine on lighthouse03, connect it to ruralgreece.gr, and point the app at it.
Nothing here has been run on lighthouse03 yet: each step is for whoever does the first install, with Chris's go-ahead.

Assumes Debian or Ubuntu, a DNS name for the engine (below `engine.ruralgreece.gr`), and sudo.

## 1. Packages

```bash
sudo apt install -y postgresql nginx certbot python3-certbot-nginx git
# Node 22 (NodeSource or the distribution's package if it is 22+)
node --version   # must print v22 or newer
```

## 2. Database

```bash
sudo -u postgres createuser rve
sudo -u postgres createdb -O rve rve
sudo -u postgres psql -c "ALTER USER rve PASSWORD 'a-long-random-password'"
```

## 3. Code

```bash
sudo useradd --system --home /opt/rve --shell /usr/sbin/nologin rve
sudo mkdir -p /opt/rve && sudo chown rve:rve /opt/rve
sudo -u rve git clone https://github.com/chiotis/ruralvalueengine.git /opt/rve
cd /opt/rve/engine
sudo -u rve npm ci
sudo -u rve npm run build
```

## 4. Settings

```bash
sudo mkdir -p /etc/rve
sudo cp /opt/rve/engine/.env.example /etc/rve/engine.env
sudo chown root:rve /etc/rve/engine.env && sudo chmod 640 /etc/rve/engine.env
sudo nano /etc/rve/engine.env
```

Fill in every value. Make each secret with `openssl rand -base64 48`:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgres://rve:PASSWORD@localhost:5432/rve` |
| `JWT_SECRET` | a new secret |
| `QR_KEYS` | `{"1":"<a new secret>"}`. Never change or remove a version that is on printed QR codes; to rotate, add `"2"` |
| `ADMIN_TOKEN` | a new secret, given only to ETAM staff who use the admin panel |
| `WP_WEBHOOK_SECRET` | a new secret, also entered in the WordPress plugin |
| `RURALGREECE_URL` | `https://ruralgreece.gr` |
| `SMTP_URL`, `MAIL_FROM` | the mailbox that sends login codes, e.g. `smtps://no-reply%40ruralgreece.gr:PASSWORD@mail.host:465` (an `@` in the user name is written `%40`) |
| `TRUST_PROXY` | `1` (nginx sits in front) |

The engine refuses to start with short secrets, which catches a forgotten value.

## 5. Service and web server

```bash
sudo cp /opt/rve/deploy/rve-engine.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now rve-engine
curl http://127.0.0.1:8080/health          # {"ok":true}

sudo cp /opt/rve/deploy/nginx-rve.conf /etc/nginx/sites-available/rve
sudo ln -s /etc/nginx/sites-available/rve /etc/nginx/sites-enabled/rve
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d engine.ruralgreece.gr
```

The engine creates its tables on start and then syncs ruralgreece.gr: right away, every 15 minutes, and in full once a day. Logs: `journalctl -u rve-engine -f`.

## 6. WordPress plugin (ruralgreece.gr)

This changes the live site, so do it with Chris's go-ahead.

1. Upload `wordpress/rve-sync` to `wp-content/plugins/` and activate **Rural Value Engine Sync**.
2. Under **Settings → Rural Value Engine**, enter `https://engine.ruralgreece.gr` and the `WP_WEBHOOK_SECRET`.
3. Edit any business and save it; the engine log should show the webhook.

Without the plugin the 15-minute sync still keeps content up to date, only slower.

## 7. First run in the admin panel

Open `https://engine.ruralgreece.gr/admin` and paste the `ADMIN_TOKEN`.

1. **Επισκόπηση → Πλήρης συγχρονισμός** to pull everything now.
2. **Μέλη**: businesses with no email in ruralgreece.gr can't log in to the member area; add the email on the site or as an extra login here. Then **Δημιουργία QR για όσα μέλη δεν έχουν**.
3. **Κωδικοί QR → Εκτύπωση** prints two codes per A4 page for the businesses.
4. **Σημεία**: create QR codes only for points where a sign will actually be placed; the others work with the GPS check-in.
5. **Πακέτα** and **Ανταμοιβές**: create the first thematic packages and network rewards.

To keep the panel to ETAM's office only, uncomment the `allow` block in the nginx file.

## 8. The app

Set `extra.apiUrl` in `app/app.json` to `https://engine.ruralgreece.gr` (already the default) and build the APK as described in `app/README.md`.

## 9. Backups and updates

```bash
sudo cp /opt/rve/deploy/backup.sh /usr/local/bin/rve-backup && sudo chmod +x /usr/local/bin/rve-backup
sudo mkdir -p /var/backups/rve && sudo chown postgres /var/backups/rve
echo '30 3 * * * postgres /usr/local/bin/rve-backup' | sudo tee /etc/cron.d/rve-backup
```

Copy `/var/backups/rve` off the server as well (e.g. with the server's existing offsite backup).

Update to a new version:

```bash
cd /opt/rve && sudo -u rve git pull
cd engine && sudo -u rve npm ci && sudo -u rve npm run build
sudo systemctl restart rve-engine      # applies new database migrations on start
```
