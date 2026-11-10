# RAE / HUB — Cloudflare dashboard

A private, responsive personal link dashboard deployed at **https://dashboard.diverseonpurpose.com/admin**. Group apps by domains you own, maintain a separate category-driven Online Tools area, star favorites, search, and add/edit/delete everything from the browser. Links persist in Cloudflare D1 across devices.

## Prerequisites

- `diverseonpurpose.com` must be in the **same Cloudflare account** you deploy from.
- Node.js and npm installed locally; `npx wrangler login` signed in to that account.
- Configure **Cloudflare Access** before using the dashboard: its content is personal, and the app deliberately relies on Cloudflare Access authentication (rather than storing passwords in the code). Protect **the whole hostname** `dashboard.diverseonpurpose.com` including `/api/*`, not just `/admin`. Create a self-hosted Access application with an Allow policy limited to your email/identity. Test that both `/admin` and `/api/data` require a login when signed out. Do not deploy with an open hostname.

## Deploy (from this project folder)

1. `npx wrangler login`
2. `npx wrangler d1 create rae_dashboard_db`
3. Copy the resulting `database_id` into `wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
4. `npx wrangler d1 execute rae_dashboard_db --remote --file=./schema.sql`
5. Set up Cloudflare Zero Trust → Access controls → Applications → Add an application → Self-hosted; hostname: `dashboard.diverseonpurpose.com`; Allow policy limited to **your own email**. Confirm it covers **all paths**. You can use email OTP or an existing identity provider.
6. `npx wrangler deploy`
7. Visit `https://dashboard.diverseonpurpose.com/admin` (automatically redirects to `/admin/`).
8. Use **Manage domains** to create domain folders, then **Add link** to add apps or Online tools. The app is not automatically importing browser bookmarks.

**DNS:** Cloudflare Workers custom domain routing automatically creates the required hostname association in the corresponding Cloudflare zone, provided your account and zone permit the route. Do not manually point this hostname to a different deployment.

**Security:** Wrangler config sets `workers_dev = false` and `preview_urls = false` to avoid bypassing Access via alternate hostnames. The Worker enforces same-origin on write APIs, validates http(s) URLs, uses parameterized SQL, and escapes user content in the frontend. This is not a replacement for an Access policy, and there is no independent password system. Do not store passwords, API tokens, or secrets as link notes. A redirect to an external application does not grant login access to that application.

**Backups:** Example: `npx wrangler d1 export rae_dashboard_db --remote --output=./rae_dashboard_backup.sql`. Keep the resulting SQL backup private.

## Files

- `public/index.html` — dashboard shell
- `public/styles.css` — responsive dark interface
- `public/app.js` — search, domain management, links, categories, favorites
- `src/index.js` — Cloudflare Worker and D1 CRUD API
- `schema.sql` — D1 schema
- `wrangler.toml` — Cloudflare settings and custom domain

## Future upgrades

Drag-and-drop ordering, tags, browser bookmark import, custom favicons, quick-open keyboard palette, audit trail, and multi-user permissions.
