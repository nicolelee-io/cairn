# Deploying Cairn

How to run Cairn on your own server: start it, put it on your network, configure it, keep it backed up and upgrade it. It assumes you're comfortable with Docker and a terminal. Nothing here depends on a particular host, proxy or VPN; where a choice matters, the options are side by side.

## What you need

- A machine that runs Docker with Compose (Linux, or Windows/macOS with Docker Desktop). The image is built for `linux/amd64`.
- Disk space for your photos and attachments. The database itself stays small.
- For use away from home: a way in, such as a reverse proxy with https, a Cloudflare Tunnel or a VPN like Tailscale. See [Reaching Cairn](#reaching-cairn).

Cairn is one container: a Node server that serves the web app and the API, with everything it stores (an SQLite database, photos, attachments) in one Docker volume. It needs no other database, cache or mail server. An optional second container takes encrypted backups ([backup.md](backup.md)).

## Quick start

Cairn is published as a ready-built image on the GitHub Container Registry, so you don't need the source code to run it:

| Image                               | What                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `ghcr.io/nicolelee-io/cairn`        | The app                                                |
| `ghcr.io/nicolelee-io/cairn-backup` | The optional backup container ([backup.md](backup.md)) |

Each has release tags at three levels: `:1` (the newest 1.x release: features and fixes, never a change that needs you to act; the one to use), `:1.0` (fixes only) and `:1.0.0` (exactly that release). `:latest` is the newest build of the `main` branch, which moves ahead of releases, and every build of `main` also has a tag of its full git SHA. See [Upgrades](#upgrades) for choosing. Both are public: pulling needs no GitHub account or `docker login`. They're built for `linux/amd64` only; on an ARM machine (a Raspberry Pi, an Apple Silicon Mac) build from source instead, below.

### With the prebuilt image

Make a folder for Cairn, say `~/cairn`, and put this in it as `docker-compose.yml`:

```yaml
services:
  cairn:
    image: ghcr.io/nicolelee-io/cairn:1
    container_name: cairn
    ports:
      - '8086:3000'
    env_file: .env
    volumes:
      - cairn_data:/data
    restart: unless-stopped

volumes:
  cairn_data:
    name: cairn_data
```

Next to it, make a `.env` file with the first account (all of the settings are in [Configuration](#configuration)):

```bash
INITIAL_USERNAME=you
INITIAL_PASSWORD=a long password of 8 characters or more
INITIAL_DISPLAY_NAME=Your Name
INITIAL_TIMEZONE=Europe/London
```

`INITIAL_TIMEZONE` is any IANA zone name, such as `America/Denver`. Then pull the image and start it:

```bash
docker compose pull
docker compose up -d
```

Open `http://<server>:8086` and sign in. That first account is an admin; add everyone else in Settings > Manage users (there's no signup page).

The `INITIAL_*` values are used only while there are no users, so after the first start they do nothing. Remove the password from `.env` once you've signed in, and change it in Settings > Account if it was ever written down anywhere.

Without Compose, the same thing is:

```bash
docker volume create cairn_data
docker run -d --name cairn --restart unless-stopped -p 8086:3000 \
  --env-file .env -v cairn_data:/data ghcr.io/nicolelee-io/cairn:1
```

### From source

To build the image yourself (on ARM, or to run changes of your own), clone the repo and use its compose file, which has a `build:` section:

```bash
git clone https://github.com/nicolelee-io/cairn.git
cd cairn
cp .env.example .env    # then fill in the INITIAL_* values
docker compose up -d --build
```

The build installs every development dependency and compiles the web app, so on a small or busy server build it on another machine and push the image to a registry of your own.

## Where your data lives

Everything is in the named volume `cairn_data`, mounted at `/data` in the container:

| Path                          | What                                                        |
| ----------------------------- | ----------------------------------------------------------- |
| `cairn.db` (+ `-wal`, `-shm`) | The database: accounts, journals, entries, settings         |
| `photos/<user id>/`           | Photo originals and their WebP copies, profile pictures     |
| `attachments/<user id>/`      | PDFs, videos, audio                                         |
| `backups/`                    | Database snapshots taken before each upgrade, backup status |

It's a named volume, not a folder bind-mounted from the host, on purpose: the backup container reads the live database through the same volume, and SQLite's shared-memory file only works properly between containers that share a Docker volume. Never copy the live `cairn.db` while Cairn runs: the copy can be inconsistent. Use the backup container, or stop Cairn first.

`docker compose down -v` deletes named volumes, `cairn_data` included. Use `docker compose down` without `-v`. To guard against it for good, create the volume yourself (`docker volume create cairn_data`) and mark it `external: true` in your compose file.

## Reaching Cairn

Out of the box Cairn listens on port 8086 over plain http. That's fine on a home network, but browsers hold back some features from plain http, and a password sent over it can be read on the way. Pick whichever of these fits.

| Setup                          | https    | Install as an app, offline | Works away from home |
| ------------------------------ | -------- | -------------------------- | -------------------- |
| Plain http on your LAN         | No       | No                         | No                   |
| A VPN (Tailscale, WireGuard)   | Optional | Only with https            | Yes, on your devices |
| A reverse proxy (Caddy, nginx) | Yes      | Yes                        | Yes                  |
| Cloudflare Tunnel              | Yes      | Yes                        | Yes, no open ports   |

Installing Cairn as an app and using it offline rely on a service worker, which browsers only allow over https (or on `localhost`). [offline.md](offline.md) lists what works offline and what doesn't.

### What every proxy needs

Whatever sits in front of Cairn has to get these right:

1. **Pass the `Host` header through unchanged.** Cairn refuses a write whose `Origin` doesn't match the `Host` it received (its CSRF protection). A proxy that rewrites `Host` to `cairn:3000` makes every save fail with `bad_origin`.
2. **Send `X-Forwarded-Proto: https`.** The session cookie is marked `Secure` only when the request arrived over https, and Cairn learns that from this header.
3. **Allow request bodies up to 100 MB.** Photos are up to 50 MB and other attachments up to 95 MB, one file per request.
4. **Set `TRUST_PROXY`** so the login rate limits see each visitor's own address. See below.
5. **Allow a few minutes for slow requests.** A large export can take a while to start sending.

### `TRUST_PROXY` and the login limits

Cairn limits failed sign-ins: 8 per address and 30 per username, every 15 minutes. A browser that has signed in to an account before is exempt from that account's username limit, so someone guessing your username can't lock you out of your own devices.

By default the "address" is the one the connection comes from. Behind a proxy that's the proxy's own, so every visitor would share it and one person's mistakes would lock everyone out. `TRUST_PROXY` names the proxies whose `X-Forwarded-For` header Cairn should believe instead:

```bash
TRUST_PROXY=caddy                   # a container name on a shared Docker network
TRUST_PROXY=172.20.0.5              # an IP
TRUST_PROXY=10.0.0.0/8, fd00::/8    # address ranges (CIDR), comma-separated
TRUST_PROXY=true                    # any peer: only if nothing but the proxy can reach Cairn
```

Hostnames are looked up again every minute, so a container whose IP changes when it's recreated stays trusted. Cairn uses the last entry in `X-Forwarded-For`, the one your proxy added; anything before it came from the visitor and could be made up.

Trust only the proxy itself. Requests to a port published with Docker's `ports:` arrive from the Docker network's gateway (such as `172.20.0.1`), so trusting a whole Docker subnet lets anyone who can reach the published port pretend to be any address. If everyone comes through the proxy, the simplest fix is to stop publishing the port at all (below).

Leave `TRUST_PROXY` unset when browsers connect to Cairn directly (LAN, or a VPN with no proxy in between).

### Plain http on your LAN

The quick start as is. Set `CAIRN_PORT` in `.env` to use another port than 8086.

### A VPN (Tailscale, WireGuard)

Your devices join a private network and reach `http://<server>:8086` as if they were at home. Nothing is exposed to the internet, so this is the safest option. For https (and with it, the installable app), put a reverse proxy in front as below, or use your VPN's own https feature, such as `tailscale serve`, which needs no change to Cairn. Leave `TRUST_PROXY` unset unless the proxy sends `X-Forwarded-For`; on a private network, everyone sharing one address for the login limits is fine.

### A reverse proxy

Put the proxy and Cairn on the same Docker network and let the proxy reach `cairn:3000`. Then remove Cairn's `ports:` section (or bind it to `127.0.0.1:8086:3000`), so the proxy is the only way in.

**Caddy** gets a certificate on its own and already passes `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`, with no body size limit:

```
journal.example.com {
    reverse_proxy cairn:3000
}
```

```bash
TRUST_PROXY=caddy   # the Caddy container's name
```

**nginx** needs the headers and limits spelled out:

```nginx
server {
    listen 443 ssl;
    server_name journal.example.com;
    # ssl_certificate ... ;

    client_max_body_size 100m;
    proxy_request_buffering off;   # stream uploads straight to Cairn
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass http://cairn:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
TRUST_PROXY=nginx   # the nginx container's name
```

A proxy on the host rather than in Docker reaches Cairn through the published port, so its requests arrive from the Docker gateway. In that case bind the port to `127.0.0.1` and trust the gateway address, which only the host can then use.

### Cloudflare Tunnel

A `cloudflared` container makes an outbound connection to Cloudflare, so the server needs no open ports and no certificate of its own.

1. In Cloudflare Zero Trust, create a tunnel and copy its token.
2. Run `cloudflared` on the same Docker network as Cairn:

   ```yaml
   services:
     cloudflared:
       image: cloudflare/cloudflared:latest
       container_name: cloudflared
       command: tunnel --no-autoupdate run
       environment:
         TUNNEL_TOKEN: ${TUNNEL_TOKEN}
       restart: unless-stopped
   ```

3. Give the tunnel a public hostname, such as `journal.example.com`, that points to `http://cairn:3000`.
4. Set `TRUST_PROXY=cloudflared` (the container's name) and restart Cairn.

Cloudflare sends `X-Forwarded-Proto` and appends the visitor's real address to `X-Forwarded-For`, so nothing else is needed. Cloudflare's free plan refuses request bodies over 100 MB, which is why Cairn's upload limits stay below it.

For a second lock on the door, put a Cloudflare Access policy in front of the hostname: visitors then sign in to Cloudflare before they can even see Cairn's login page.

## Configuration

All configuration is environment variables, read from `.env` by Compose. Restart Cairn after a change (`docker compose up -d`).

| Variable               | Default  | What                                                                                                     |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `CAIRN_PORT`           | `8086`   | Host port for the web app (Compose only).                                                                |
| `INITIAL_USERNAME`     |          | First account, created only while there are no users.                                                    |
| `INITIAL_PASSWORD`     |          | Its password, 8 characters or more. Remove it after the first start.                                     |
| `INITIAL_DISPLAY_NAME` | username | Its display name.                                                                                        |
| `INITIAL_TIMEZONE`     | `UTC`    | Its default timezone (an IANA name such as `America/Denver`).                                            |
| `TRUST_PROXY`          | unset    | Reverse proxies to believe about the visitor's address. See [above](#trust_proxy-and-the-login-limits).  |
| `GOOGLE_API_KEY`       | unset    | Optional. Enables place search and Google weather. Can be set in Settings instead, which wins over this. |

The image sets `PORT`, `DATA_DIR`, `WEB_DIST` and `MIGRATIONS_DIR` itself; leave them alone.

Most settings live in the app, on the admin-only Settings pages (Backups & alerts, Places & weather, Uploads & Trash): the Google API key, the weather source, photo quality, the attachment size limit, how long the Trash keeps things, and server alerts through ntfy.

**Places and weather without Google.** Weather comes from [Open-Meteo](https://open-meteo.com) by default: free, no key, and history for any date. A Google API key (Places API (New), Geocoding API, and Weather API if you want Google's weather) adds searching for places by name and naming a location from its coordinates. Without one, entries can still take your current location or a photo's GPS position as coordinates, without a place name.

## Backups

Set up the backup container before you put anything in Cairn you'd mind losing. It takes a nightly, encrypted [restic](https://restic.net) backup of the database, photos and attachments to Cloudflare R2, Backblaze B2, S3, SFTP, Google Drive or a folder, keeps a rolling history, can do a test restore, and reports to Settings. The whole guide is in [backup.md](backup.md).

Do a test restore once it's running (`docker compose --profile backup run --rm backup verify`). A backup you haven't restored from is a hope, not a backup.

An export (Settings > Export) is a different thing: a Day One-format zip of your journals you can read or import elsewhere. It doesn't hold accounts, settings or other users' journals, so it doesn't replace a backup.

## Upgrades

```bash
docker compose pull
docker compose up -d
```

On start, Cairn applies any database migrations the new version brings. Before applying them it saves a snapshot of the database to `backups/pre-migrate-<time>.db` in the data volume (the last 5 are kept). If a migration fails, Cairn doesn't start: it exits rather than run on a half-upgraded database, and `docker logs cairn` says why.

Migrations only go forward. Once a newer version has started, an older image can't use that database. To go back, restore the pre-migration snapshot (or a backup) along with the older image.

Which tag to follow: `:1` takes every 1.x release, features included, and never a breaking one (that would be 2.0, with notes on what to do in the [changelog](../CHANGELOG.md)); `:1.0` takes fixes only; a full version such as `:1.0.0` never changes, so you upgrade by editing the tag. Releases that bring a database migration are minor versions (1.1, 1.2), so `:1.0` never migrates. `:latest` tracks unreleased work on `main`; use it only if you want to try changes early. If you use [Watchtower](https://containrrr.dev/watchtower/) to update automatically, know that it doesn't roll back, so keep the nightly backup running.

Open browsers and installed apps notice the new version and offer a Reload. Settings > About shows which build the server and the device are running.

## Health and monitoring

- `GET /api/health` answers `{"status":"ok","sha":"…"}` without signing in. The image's Docker `HEALTHCHECK` uses it, so `docker ps` shows `healthy`. Point an uptime monitor (Uptime Kuma, healthchecks.io) at it to hear when Cairn is down.
- Settings > Backups & alerts can send a message through [ntfy](https://ntfy.sh) when backups fail or stop, or the database can't be written.
- `docker logs cairn` has the server log.

## Admin tools

These run inside the container and use the same data as the app.

**Forgot your password** (there's no email, so this is the way back in). It asks for the new password twice and signs that user out everywhere:

```bash
docker exec -it cairn node reset-password.js <username>
```

To script it, pass the password on standard input, never as an argument: `echo "new password" | docker exec -i cairn node reset-password.js <username> --password-stdin`.

**No admin left** (after editing the database by hand, or restoring an old backup). This makes the user an admin and re-enables them:

```bash
docker exec cairn node make-admin.js <username>
```

Otherwise the app never lets the last enabled admin lose their role.

**Importing from Day One.** In Day One, export your journals as JSON (a zip). Back up first if Cairn already holds entries you care about.

The easy way is in the app: **Settings > Import**, choose the zip, check what it holds, and press Import. It goes into the account you're signed in as, and runs on the server, so you can leave the page. It also reads a Cairn export. The upload is capped by the attachment limit in Settings > Uploads & Trash (95 MB at most, because Cloudflare refuses larger requests; your proxy may have a lower limit of its own, such as nginx's `client_max_body_size`). The zip is kept in `imports/` in the data volume only until the import ends, and a restart clears that folder; if the server restarts mid-import, upload the same zip again and it finishes the rest.

For a larger export, or one with lots of photos or video, use the command line. From the folder with your `docker-compose.yml` (with the backup container set up), the script backs up, imports and checks the backup afterwards:

```bash
scripts/import.sh Export.zip --user <username>
```

`--user` says whose journals these become. It's required once Cairn has more than one user; with a single user it can be left out and that user gets the journals. `--archived "Journal Name"` imports a journal as archived (repeatable). The script stops before importing if the first backup fails, and `--no-backup` skips both backups when you don't run the backup container.

Without the script, the zip goes in over stdin, so there's nothing to copy in or clean up:

```bash
docker exec -i cairn node import-journal.js - --user <username> < Export.zip
```

Running it again skips what's already imported, so it's safe to retry. Large exports with lots of media are fine here; there's no upload size limit, because the file never goes through the browser.

## Security checklist

- Use https for anything reachable from the internet (a reverse proxy or a tunnel).
- Set `TRUST_PROXY` when Cairn is behind a proxy, and only to the proxy itself.
- Don't publish Cairn's port beyond your network when a proxy is in front of it.
- Remove `INITIAL_PASSWORD` from `.env` after the first start.
- Admins are trusted. No route lets an admin read another user's entries, but an admin can reset that user's password, and whoever runs the server can read the database and the data volume. Only make people admins you'd trust with that. The same goes for anyone using a server you run: tell them that you can read their entries, as the README's "Who can read your entries" says.
- Keep the backup container running, and keep the restic password somewhere other than the server.
- Consider a second login in front of Cairn (Cloudflare Access, or a VPN) if it's on the public internet.
