# Deploying the engine

The engine needs Node.js 22+, PostgreSQL and HTTPS. There are two ways to host it:

- **A. A fresh small VPS (recommended).** One script sets everything up and nothing else runs on the box.
- **B. lighthouse03 under CloudPanel**, as a CloudPanel Node.js site. See part B below.

Nothing has been deployed yet. Do each step only after Chris gives the go-ahead.

# A. Fresh VPS

**Server:** Ubuntu 24.04 (Debian 12 also works), 2 GB RAM, 1–2 vCPUs, 20–40 GB disk, in an EU location. A Hetzner CX22 or a small DigitalOcean or Contabo plan is plenty.

1. Point a DNS A record, for example `engine.ruralgreece.gr`, at the VPS's IP address.
2. SSH in as root and run:

```bash
curl -fsSL https://raw.githubusercontent.com/chiotis/ruralvalueengine/main/deploy/install.sh -o install.sh
DOMAIN=engine.ruralgreece.gr EMAIL=you@example.gr bash install.sh
```

The script:
- installs PostgreSQL, Node.js 22, nginx, certbot, a firewall (SSH, HTTP and HTTPS only) and automatic security updates
- creates the database and generates every secret into `/etc/rve/engine.env`
- builds the engine and runs it as a systemd service (`rve-engine`)
- issues the Let's Encrypt certificate and sets up nightly database backups in `/var/backups/rve`

At the end it prints the **ADMIN_TOKEN** for the admin panel and the **WP_WEBHOOK_SECRET** for the WordPress plugin.

3. **Email:** to send login codes, put the mailbox in `/etc/rve/engine.env`:

```
SMTP_URL=smtps://no-reply%40ruralgreece.gr:PASSWORD@mail.host:465
```

Write an `@` in the user name as `%40`. Then run `systemctl restart rve-engine`. Until this is set, login codes appear in `journalctl -u rve-engine`.

4. Continue with **WordPress plugin**, **First run in the admin panel** and **The app** below. They are the same for both options.

**Updates:** run the same script again. It pulls the latest code, rebuilds and restarts, and keeps the existing settings.
**Logs:** `journalctl -u rve-engine -f`.
**Restore a backup:** `sudo -u postgres pg_restore --clean --no-owner -d rve /var/backups/rve/rve-YYYY-MM-DD.dump`.
Also copy `/var/backups/rve` off the server, for example with the VPS provider's backup option.

# B. lighthouse03 with CloudPanel

lighthouse03 runs **CloudPanel**, so here the engine goes in as a CloudPanel **Node.js site** and pm2 keeps it running. CloudPanel's own databases are MySQL/MariaDB, so PostgreSQL is installed next to it.
Below, the engine's address is `engine.ruralgreece.gr` and the CloudPanel site user is `rve`.

## 1. DNS

Point `engine.ruralgreece.gr` (an A record) at lighthouse03.

## 2. PostgreSQL (as root, over SSH)

```bash
apt update && apt install -y postgresql
sudo -u postgres createuser rve
sudo -u postgres createdb -O rve rve
sudo -u postgres psql -c "ALTER USER rve PASSWORD 'a-long-random-password'"
```

PostgreSQL listens only on localhost by default, which is what we want. Don't open port 5432 in CloudPanel's firewall.

## 3. Create the site in CloudPanel

**Sites → Add Site → Create a Node.js Site**:

- Domain: `engine.ruralgreece.gr`
- Node.js version: **22** or newer
- App Port: `8080` (any free port works, as long as `PORT` in step 5 matches)
- Site user: `rve`, with a strong password

Then, under the site's **SSL/TLS** tab, issue a **Let's Encrypt** certificate.

## 4. Code (as the site user)

```bash
ssh rve@lighthouse03
cd htdocs/engine.ruralgreece.gr
git clone https://github.com/chiotis/ruralvalueengine.git .
cd engine
npm ci
npm run build
```

## 5. Settings

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

The engine reads `engine/.env` on start. Fill in every value, and make each secret with `openssl rand -base64 48`:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgres://rve:PASSWORD@localhost:5432/rve` |
| `PORT` | the App Port from step 3, e.g. `8080` |
| `JWT_SECRET` | a new secret |
| `QR_KEYS` | `{"1":"<a new secret>"}`. Never change or remove a version that is on printed QR codes. To rotate keys, add `"2"`. |
| `ADMIN_TOKEN` | a new secret, given only to the ETAM staff who use the admin panel |
| `WP_WEBHOOK_SECRET` | a new secret, also entered in the WordPress plugin |
| `RURALGREECE_URL` | `https://ruralgreece.gr` |
| `SMTP_URL`, `MAIL_FROM` | the mailbox that sends login codes, e.g. `smtps://no-reply%40ruralgreece.gr:PASSWORD@mail.host:465` (an `@` in the user name is written `%40`) |
| `TRUST_PROXY` | `1` (CloudPanel's nginx sits in front) |
| `HOST` | leave out: the default `127.0.0.1` lets only the local nginx reach the engine |

The engine refuses to start with short secrets, which catches a value you forgot to fill in.

## 6. Start it with pm2 (as the site user)

```bash
npm install pm2@latest -g
pm2 start npm --name rve-engine -- start
pm2 save
curl http://127.0.0.1:8080/health          # {"ok":true}
```

To restart it after the server reboots (CloudPanel's recommended way):

```bash
echo $PATH        # copy the output
crontab -e        # add these two lines, pasting the PATH output:
#   PATH=<pasted output>
#   @reboot pm2 resurrect &> /dev/null
```

Check with `pm2 status` (it should say `online`) and read the logs with `pm2 logs rve-engine`.

On start, the engine creates its tables and syncs ruralgreece.gr. After that it syncs every 15 minutes, with a full pass once a day.

### Optional, in the site's Vhost editor in CloudPanel

- A full sync started from the admin panel can take longer than nginx's default timeout. Add `proxy_read_timeout 120s;` to the `location /` block that proxies to the app.
- To limit the admin panel to ETAM's office, add a block like this before `location /`, copying the proxy lines from the existing `location /` block:

```nginx
location ~ ^/(admin|v1/admin) {
    allow 203.0.113.10;   # ETAM's office IP
    deny all;
    # ...same proxy_pass and proxy_set_header lines as in location /
}
```

## Backups and updates (CloudPanel)

A nightly database dump, kept for 14 days (as root):

```bash
cp /home/rve/htdocs/engine.ruralgreece.gr/deploy/backup.sh /usr/local/bin/rve-backup && chmod +x /usr/local/bin/rve-backup
mkdir -p /var/backups/rve && chown postgres /var/backups/rve
echo '30 3 * * * postgres /usr/local/bin/rve-backup' > /etc/cron.d/rve-backup
```

CloudPanel's own backups cover the site files but not PostgreSQL, so also copy `/var/backups/rve` off the server.

To update to a new version (as the site user):

```bash
cd ~/htdocs/engine.ruralgreece.gr && git pull
cd engine && npm ci && npm run build
pm2 restart rve-engine      # applies new database migrations on start
```

# Both options

## WordPress plugin (ruralgreece.gr)

This changes the live site, so do it only with Chris's go-ahead.

1. Upload `wordpress/rve-sync` to `wp-content/plugins/` and activate **Rural Value Engine Sync**.
2. Under **Settings → Rural Value Engine**, enter `https://engine.ruralgreece.gr` and the `WP_WEBHOOK_SECRET`.
3. Edit any business and save it. The webhook should appear in the engine log (`journalctl -u rve-engine` on the VPS, `pm2 logs rve-engine` on CloudPanel).

Without the plugin, the 15-minute sync still keeps content up to date, just more slowly.

## First run in the admin panel

Open `https://engine.ruralgreece.gr/admin` and paste the `ADMIN_TOKEN`.

1. **Επισκόπηση → Πλήρης συγχρονισμός** pulls everything now.
2. **Μέλη**: a business with no email on ruralgreece.gr can't log in to the member area. Add the email on the site, or add it as an extra login here. Then press **Δημιουργία QR για όσα μέλη δεν έχουν**.
3. **Κωδικοί QR → Εκτύπωση** prints two codes per A4 page for the businesses.
4. **Σημεία**: create QR codes only for the points where a sign will actually be placed. The others work with the GPS check-in.
5. **Πακέτα** and **Ανταμοιβές**: create the first thematic packages and network rewards.

## The app

`extra.apiUrl` in `app/app.json` must be `https://engine.ruralgreece.gr`, which is already the default. Build the APK as described in `app/README.md`.
