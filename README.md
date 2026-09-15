# Dismas Scriptorium

Secure web portal to the Cathedral vault. Talk to Dismas, the Good Thief.

## v3 Changes

- **SQLite storage** (better-sqlite3) - survives Railway redeploy with volume mount
- **Setup flow** - visit `/setup` on first deploy to generate password hash and MFA QR
- **Rate limiting** - 5 login attempts per 15 min per IP

## First Deploy

1. Deploy to Railway from GitHub
2. Visit the URL - you'll see the setup page (not login)
3. Enter a password -> copy the bcrypt hash
4. Generate MFA -> scan QR with Google Authenticator -> copy the base32 secret
5. In Railway, set env vars:
   - `DISMAS_PASSWORD_HASH` = hash from step 3
   - `DISMAS_TOTP_SECRET` = base32 from step 4
   - `DISMAS_SESSION_SECRET` = any random string
   - `DATA_DIR` = `/data`
6. Add a Railway Volume mounted at `/data`
7. Redeploy
8. Visit URL again - now you get the login page