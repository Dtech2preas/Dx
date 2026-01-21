# Cloudflare Worker Configuration Instructions

The errors you are seeing (`Cannot read properties of undefined (reading 'idFromString')`) occur because your Cloudflare Worker code is trying to access **Durable Objects** and **KV Namespaces** that have not been "bound" (connected) in the Cloudflare Dashboard yet.

Please follow these steps to manually configure your Worker in the Cloudflare Dashboard.

## 1. Create the KV Namespace

1. Log in to the **Cloudflare Dashboard**.
2. Go to **Workers & Pages**.
3. Select **KV** from the sidebar menu.
4. Click **Create a Namespace**.
5. Name it `USERS` (or any name, but remember it).
6. Click **Add**.

## 2. Configure Your Worker

1. Go to **Workers & Pages** and click on your worker (e.g., `dtech-rewards-backend`).
2. Go to the **Settings** tab.
3. Select **Variables** (or **Runtime** / **Bindings** depending on the dashboard version).

### A. Bind the KV Namespace

1. Scroll to **KV Namespace Bindings**.
2. Click **Add binding**.
3. **Variable name**: `USERS` (Must be exactly this).
4. **KV Namespace**: Select the namespace you created in Step 1.
5. Click **Save and deploy** (or just Save).

### B. Bind the Durable Objects

1. Scroll to **Durable Object Bindings**.
2. Click **Add binding**.
3. **Binding 1**:
   - **Variable name**: `USER_DO` (Must be exactly this).
   - **Class name**: `UserDO` (Must be exactly this).
4. Click **Add binding** again.
5. **Binding 2**:
   - **Variable name**: `TREASURY_DO` (Must be exactly this).
   - **Class name**: `TreasuryDO` (Must be exactly this).
6. Click **Save and deploy** (or just Save).

### C. Add Environment Variables

1. Scroll to **Environment Variables**.
2. Click **Add variable**.
3. **Variable name**: `ADMIN_SECRET`
4. **Value**: Enter a secure password (e.g., `mySuperSecretAdminKey123`).
   - *Note: This key is needed for admin actions.*
5. Click **Save and deploy**.

## 3. Verify and Redeploy

1. Once all settings are saved, go to the **Deployments** tab.
2. Ensure the latest deployment is active.
3. If needed, click **Deploy** to force a refresh with the new settings.

## Summary of Required Settings

| Setting Type | Variable Name | Value / Class Name |
| :--- | :--- | :--- |
| **KV Namespace** | `USERS` | *(Select your KV namespace)* |
| **Durable Object** | `USER_DO` | `UserDO` |
| **Durable Object** | `TREASURY_DO` | `TreasuryDO` |
| **Env Variable** | `ADMIN_SECRET` | *(Your chosen secret)* |

Once these are set, the errors `reading 'idFromString'` and `reading 'newUniqueId'` will resolve.
