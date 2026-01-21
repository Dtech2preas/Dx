# Manual Deployment Guide (Cloudflare Dashboard)

It looks like you are manually copying and pasting code into the Cloudflare Dashboard. This is fine, but you must manually configure the "Bindings" (permissions) for the code to work.

## Step 1: Copy the Code

1. Copy the **entire** content of `src/worker.js`.
2. Paste it into your Worker's code editor (the "Quick Edit" screen).
3. Click **Save and Deploy**.

## Step 2: Check the Status (New Feature!)

I have added a **Diagnostic Screen** to your worker.
1. Open your worker's URL in your browser (e.g., `https://your-worker.workers.dev`).
2. If the configuration is missing, you will see a **"Setup Required"** page.
3. This page will list exactly which settings are missing.

## Step 3: Configure Bindings (If needed)

If you see the "Setup Required" page, follow these steps in the Cloudflare Dashboard:

1. Go to your Worker's overview page.
2. Click **Settings** (tab at the top).
3. Click **Variables** (or **Runtime**, or **Bindings** depending on the menu).

### A. Add KV Namespace
1. Scroll to **KV Namespace Bindings**.
2. Click **Add binding**.
3. **Variable name**: `USERS` (Must be ALL CAPS).
4. **KV Namespace**: Select `USERS_KV` (or whatever you named it).
5. Click **Save**.

### B. Add Durable Objects
1. Scroll to **Durable Object Bindings**.
2. Click **Add binding**.
3. Fill in the first one:
   - **Variable name**: `USER_DO`
   - **Class name**: `UserDO`
4. Click **Add binding** again.
5. Fill in the second one:
   - **Variable name**: `TREASURY_DO`
   - **Class name**: `TreasuryDO`
6. Click **Save and Deploy**.

## Step 4: Add the Admin Secret
1. Scroll to **Environment Variables**.
2. Click **Add variable**.
3. **Variable name**: `ADMIN_SECRET`
4. **Value**: Enter a secure password.
5. Click **Save and Deploy**.

## Troubleshooting
If you still see errors like "No Durable Objects found", verify:
1. Did you click **Save and Deploy** after adding the bindings?
2. Are the **Variable names** exactly `USER_DO` and `TREASURY_DO`? (Case sensitive!)
3. Are the **Class names** exactly `UserDO` and `TreasuryDO`?
