# tiktakwater backend

## Local setup

1. Install dependencies:
   - `npm install`
2. Create env file:
   - Copy `.env.example` to `.env`
3. Run API:
   - `npm run dev`

## GitHub upload (server only)

Run these commands from `server` folder:

```bash
git init
git add .
git commit -m "Initial backend setup"
git branch -M main
git remote add origin https://github.com/imahmad00987655/t-tak_backend.git
git push -u origin main
```

## Hostinger deploy (Node.js app)

1. Create Node.js app in Hostinger hPanel.
2. Set Node.js version to latest LTS supported by Hostinger.
3. Upload project files (without local `.env`).
4. In Hostinger environment variables, set values from `.env.example`.
5. Set startup command to:
   - `npm start`
6. App health check URL:
   - `/api/health`
7. Restart the app after env changes.

## Recommended production env values

- `NODE_ENV=production`
- `PORT` should match Hostinger app port (or keep default if Hostinger injects it)
- `PUBLIC_APP_URL` = frontend domain
- `CORS_ORIGINS` = comma-separated allowed frontend domains

Example:

```env
PUBLIC_APP_URL=https://app.example.com
CORS_ORIGINS=https://app.example.com,https://www.app.example.com
```
