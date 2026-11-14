# Northstar CSRF Playground

An intentionally vulnerable, localhost-only CSRF training lab.

## Requirements

- Node.js 20 or newer
- npm

## Run

Open a terminal inside the project folder:

    npm install
    npm start

Open both sites in the same browser:

- Victim bank: http://127.0.0.1:3000
- Attacker page: http://127.0.0.1:4000

Click "Войти как Alice" on the victim app.

Alice starts with 1000 demo credits.
Bob is the recipient account.

## Experiment

1. Choose vulnerable mode.
2. Open Daily Perks on port 4000.
3. Submit the local demo form.
4. Return to Northstar Bank.
5. Refresh the server-side event log.
6. Switch to CSRF Token mode.
7. Repeat the experiment.
8. Try Origin and Token + Origin modes.

## Browser details

The two ports represent different origins:

http://127.0.0.1:3000
http://127.0.0.1:4000

They share the same hostname and scheme.

Therefore, this is a same-site, cross-origin demonstration,
not a full cross-site SameSite test.

## Database

SQLite database is created automatically:

data/csrf-lab.sqlite

To reset the database:

1. Stop the server.
2. Delete csrf-lab.sqlite.
3. Delete its -shm and -wal companions if present.
4. Start the server again.

## Safety

This project uses synthetic data and demo accounts.

Both servers bind exclusively to 127.0.0.1.

Do not expose this intentionally vulnerable lab to
the public internet or to an untrusted network.
