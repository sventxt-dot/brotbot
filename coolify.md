# BrotBot – Coolify Deployment Reference

Live URL: https://brotbot.bot-boutique.com
Server:   178.104.67.188 (same as supabase.bot-boutique.com)
DNS:      A record at all-inkl — brotbot → 178.104.67.188

All secrets go into Coolify's Environment Variables panel — never into the image.

---

## 1. Create the application in Coolify

New Resource → Docker → Dockerfile

| Field | Value |
|---|---|
| Name | `brotbot` |
| Source | Git repository (this repo, branch `main`) |
| Build pack | Dockerfile |
| Dockerfile path | `./Dockerfile` |
| Published port | `3000` |

---

## 2. Domain

In the application's **Domains** tab:

```
https://brotbot.bot-boutique.com
```

- Enable **HTTPS** — Coolify provisions Let's Encrypt automatically
- Force HTTPS redirect: **on**

---

## 3. Environment variables

Enter these in the **Environment Variables** tab.
Mark all as **Secret** so they are never exposed in build logs.

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://qlqyndcugdzbojwqqfij.supabase.co` |
| `SUPABASE_ANON_KEY` | *(Supabase publishable key — sb_publishable_...)* |
| `OPENAI_API_KEY` | *(OpenAI key — sk-proj-...)* |
| `ANTHROPIC_API_KEY` | *(Anthropic key — sk-ant-...)* |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5` |
| `NODE_ENV` | `production` |

**Do NOT add** `SUPABASE_SERVICE_ROLE_KEY` — that key was only needed
for the migration script, which has already run. The runtime app uses
the read-only anon key only.

---

## 4. Health check

In the **Health Check** tab:

| Field | Value |
|---|---|
| Path | `/api/health` |
| Interval | `30` s |
| Timeout | `10` s |
| Start period | `30` s |

---

## 5. Deploy

1. Click **Deploy** — Coolify runs the 3-stage Docker build
2. Watch the build log for:
   ```
   ✓ Compiled successfully
   ```
3. Once status is **Running**, check the **Logs** tab for startup errors
4. Visit https://brotbot.bot-boutique.com and run the smoke test

---

## 6. Auto-deploy on push (optional)

Enable **Webhooks** in Coolify → copy the webhook URL → add it to the
Git repository's push hooks so every push to `main` triggers a rebuild.

---

## Re-running the migration (if ever needed)

The migration script is a one-off. It does NOT run during deployment.
If the Supabase `documents` table ever needs to be rebuilt from scratch:

```bash
cd /path/to/brotbot
# Fill .env with all credentials including SUPABASE_SERVICE_ROLE_KEY
npm run migrate
```

Run this locally, never from within the container.
