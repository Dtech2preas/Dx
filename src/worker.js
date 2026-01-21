
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
};

// Global Config Defaults
const DEFAULT_BUDGET = 500.00;
const MIN_WITHDRAWAL = 10.00;
const MAX_WITHDRAWAL = 250.00;

export default {
  async fetch(request, env, ctx) {
    // --- 1. CONFIGURATION DIAGNOSTIC CHECK ---
    // If the bindings are missing, we intercept the request to provide instructions.
    // This prevents the "Cannot read properties of undefined" crash.
    const missingBindings = [];
    if (!env.USER_DO) missingBindings.push("USER_DO (Durable Object)");
    if (!env.TREASURY_DO) missingBindings.push("TREASURY_DO (Durable Object)");
    if (!env.USERS) missingBindings.push("USERS (KV Namespace)");

    if (missingBindings.length > 0) {
        // If it's a browser request (HTML), show the Setup Guide
        if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
            return new Response(getSetupGuideHTML(missingBindings), {
                headers: { 'Content-Type': 'text/html' }
            });
        }
        // If it's an API request, return JSON error
        return new Response(JSON.stringify({
            error: "Server Configuration Missing",
            details: missingBindings,
            message: "Please configure Durable Objects and KV in Cloudflare Dashboard."
        }), { status: 503, headers: CORS_HEADERS });
    }

    // Handle OPTIONS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/register' && request.method === 'POST') {
        return await handleRegister(request, env);
      } else if (path === '/login' && request.method === 'POST') {
        return await handleLogin(request, env);
      } else if (path === '/add-points' && request.method === 'POST') {
        return await handleUserAction(request, env, 'addPoints');
      } else if (path === '/redeem' && request.method === 'POST') {
        return await handleUserAction(request, env, 'redeem');
      } else if (path === '/user' && request.method === 'GET') {
        return await handleUserAction(request, env, 'info');
      } else if (path === '/certificate' && request.method === 'GET') {
        return await handleGetCert(request, env);
      } else if (path === '/mark-cert-paid' && request.method === 'POST') {
        return await handleMarkCertPaid(request, env);
      } else if (path === '/admin-stats' && request.method === 'GET') {
        return await handleGetStats(request, env);
      } else if (path === '/admin/config' && request.method === 'POST') {
        return await handleUpdateConfig(request, env);
      } else {
        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  },
};

// --- Setup Guide HTML Generator ---
function getSetupGuideHTML(missing) {
    const listItems = missing.map(m => `<li>${m}</li>`).join('');
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Server Setup Required</title>
        <style>
            body { font-family: sans-serif; padding: 40px; background: #f8fafc; color: #334155; }
            .container { max-width: 700px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; border-bottom: 2px solid #fecaca; padding-bottom: 10px; }
            .step { background: #eff6ff; padding: 15px; margin-bottom: 15px; border-left: 4px solid #3b82f6; }
            code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
            .missing-list { background: #fef2f2; border: 1px solid #fecaca; color: #ef4444; padding: 15px; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Setup Required</h1>
            <p>Your Cloudflare Worker code is deployed, but it is not connected to the required storage (Durable Objects & KV). The following bindings are missing:</p>
            <ul class="missing-list">${listItems}</ul>

            <h2>How to Fix (In Cloudflare Dashboard)</h2>

            <div class="step">
                <h3>1. Open Settings</h3>
                <p>Go to your Worker > <strong>Settings</strong> > <strong>Variables</strong> (or Bindings).</p>
            </div>

            <div class="step">
                <h3>2. Add KV Namespace Binding</h3>
                <p>Scroll to <strong>KV Namespace Bindings</strong> and click <strong>Add binding</strong>.</p>
                <ul>
                    <li>Variable name: <code>USERS</code></li>
                    <li>KV Namespace: <em>Select your namespace</em></li>
                </ul>
            </div>

            <div class="step">
                <h3>3. Add Durable Object Bindings</h3>
                <p>Scroll to <strong>Durable Object Bindings</strong> and click <strong>Add binding</strong> twice.</p>

                <p><strong>Binding 1:</strong></p>
                <ul>
                    <li>Variable name: <code>USER_DO</code></li>
                    <li>Class name: <code>UserDO</code></li>
                </ul>

                <p><strong>Binding 2:</strong></p>
                <ul>
                    <li>Variable name: <code>TREASURY_DO</code></li>
                    <li>Class name: <code>TreasuryDO</code></li>
                </ul>
            </div>

            <p><strong>After adding these, click "Save and Deploy" and refresh this page.</strong></p>
        </div>
    </body>
    </html>
    `;
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return jsonResp({ error: 'Missing inputs' }, 400);

  const existing = await env.USERS.get(username);
  if (existing) return jsonResp({ error: 'Username taken' }, 409);

  // Generate DO ID
  const id = env.USER_DO.newUniqueId();
  const idStr = id.toString();

  const pwHash = await hashPassword(password);
  const userProfile = {
    passwordHash: pwHash,
    do_id: idStr,
    created_at: new Date().toISOString()
  };

  await env.USERS.put(username, JSON.stringify(userProfile));

  return jsonResp({ message: 'Registered successfully' }, 201);
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  const profileStr = await env.USERS.get(username);
  if (!profileStr) return jsonResp({ error: 'User not found' }, 404);

  const profile = JSON.parse(profileStr);
  const inputHash = await hashPassword(password);

  if (profile.passwordHash !== inputHash) {
    return jsonResp({ error: 'Invalid credentials' }, 401);
  }

  const token = crypto.randomUUID();
  // Update KV with token
  profile.token = token;
  await env.USERS.put(username, JSON.stringify(profile));

  // Fetch balance from DO to return in login
  const id = env.USER_DO.idFromString(profile.do_id);
  const stub = env.USER_DO.get(id);
  const infoReq = new Request('http://internal/info');
  const infoResp = await stub.fetch(infoReq);
  const infoData = await infoResp.json();

  return jsonResp({
    message: 'Login successful',
    token: token,
    balance: infoData.balance
  });
}

// Wrapper to route to UserDO
async function handleUserAction(request, env, action) {
  let username, token;

  // Parse params based on Method
  if (request.method === 'GET') {
    const url = new URL(request.url);
    username = url.searchParams.get('username');
  } else {
    const body = await request.json();
    username = body.username;
    token = body.token;
    request = new Request(request.url, {
        method: request.method,
        body: JSON.stringify(body)
    });
  }

  if (!username) return jsonResp({ error: 'Missing username' }, 400);

  const profileStr = await env.USERS.get(username);
  if (!profileStr) return jsonResp({ error: 'User not found' }, 404);
  const profile = JSON.parse(profileStr);

  // Token Check for Protected Actions
  if (action === 'addPoints' || action === 'redeem') {
    if (profile.token !== token) return jsonResp({ error: 'Invalid token' }, 403);
  }

  if (!profile.do_id) {
      return jsonResp({ error: 'System reset: Please re-register' }, 400);
  }

  const id = env.USER_DO.idFromString(profile.do_id);
  const stub = env.USER_DO.get(id);

  // Forward to DO
  return await stub.fetch(request);
}

async function handleGetCert(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Missing id' }, 400);

    // Certs are in KV
    const cert = await env.USERS.get(`CERT:${id}`);
    if (!cert) return jsonResp({ error: 'Certificate not found' }, 404);

    return new Response(cert, { headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
    const { id, admin_secret } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const certKey = `CERT:${id}`;
    const certStr = await env.USERS.get(certKey);
    if (!certStr) return jsonResp({ error: 'Not found' }, 404);

    const cert = JSON.parse(certStr);
    if (cert.status === 'paid') return jsonResp({ error: 'Already paid' }, 400);

    cert.status = 'paid';
    await env.USERS.put(certKey, JSON.stringify(cert));

    // Update Treasury
    const treasuryId = env.TREASURY_DO.idFromName('GLOBAL_TREASURY');
    const treasury = env.TREASURY_DO.get(treasuryId);

    await treasury.fetch(new Request('http://internal/payout', {
        method: 'POST',
        body: JSON.stringify({ amount: cert.amount })
    }));

    return jsonResp({ message: 'Marked paid', cert });
}

async function handleGetStats(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const treasuryId = env.TREASURY_DO.idFromName('GLOBAL_TREASURY');
    const treasury = env.TREASURY_DO.get(treasuryId);
    return await treasury.fetch(request);
}

async function handleUpdateConfig(request, env) {
    const { admin_secret, config } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const treasuryId = env.TREASURY_DO.idFromName('GLOBAL_TREASURY');
    const treasury = env.TREASURY_DO.get(treasuryId);

    return await treasury.fetch(new Request('http://internal/config', {
        method: 'POST',
        body: JSON.stringify(config)
    }));
}


// --- Durable Objects ---

export class TreasuryDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
    }

    async fetch(request) {
        const url = new URL(request.url);

        // Load State
        let stats = (await this.state.storage.get('stats')) || { paid: 0, liability: 0, month: this.getCurrentMonth() };
        let config = (await this.state.storage.get('config')) || {
            budget: 500.0,
            halted: false,
            reward_multiplier: 1.0
        };

        // Monthly Reset Check
        const currentMonth = this.getCurrentMonth();
        if (stats.month !== currentMonth) {
            stats.month = currentMonth;
            stats.paid = 0;
            // Liability carries over
            await this.state.storage.put('stats', stats);
        }

        if (url.pathname === '/admin-stats') {
            return jsonResp({ stats, config });
        }

        if (url.pathname === '/check-budget') {
            const { amount } = await request.json();
            const total = stats.paid + stats.liability + amount;
            const ok = !config.halted && (total <= config.budget);
            return jsonResp({ ok, config });
        }

        if (url.pathname === '/add-liability') {
            const { amount } = await request.json();
            stats.liability = parseFloat((stats.liability + amount).toFixed(2));
            await this.state.storage.put('stats', stats);
            return jsonResp({ ok: true });
        }

        if (url.pathname === '/payout') {
            const { amount } = await request.json();
            stats.liability = parseFloat((stats.liability - amount).toFixed(2));
            if (stats.liability < 0) stats.liability = 0;
            stats.paid = parseFloat((stats.paid + amount).toFixed(2));
            await this.state.storage.put('stats', stats);
            return jsonResp({ ok: true });
        }

        if (url.pathname === '/config') {
            const newConfig = await request.json();
            config = { ...config, ...newConfig };
            await this.state.storage.put('config', config);
            return jsonResp({ message: 'Config updated', config });
        }

        return jsonResp({ error: 'Not found' }, 404);
    }

    getCurrentMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }
}

export class UserDO {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.globalConfig = null;
        this.lastGlobalCheck = 0;
    }

    async fetch(request) {
        const url = new URL(request.url);

        // Load State
        let userData = (await this.state.storage.get('data')) || {
            balance: 0.00,
            ad_count: 0,
            last_ad_ts: 0,
            last_reset_day: this.getTodayStr(),
            history: []
        };

        // Daily Reset Logic
        const today = this.getTodayStr();
        if (userData.last_reset_day !== today) {
            userData.ad_count = 0;
            userData.last_reset_day = today;
            await this.state.storage.put('data', userData);
        }

        if (url.pathname === '/user') {
            return jsonResp({
                username: 'User',
                balance: userData.balance,
                history: userData.history
            });
        }

        if (url.pathname === '/add-points') {
            // 1. Sync/Check Budget
            const canProceed = await this.checkGlobalBudget(0.3);
            if (!canProceed) {
                 return jsonResp({ error: 'Daily limit reached or system paused.' }, 503);
            }

            // 2. Cooldown
            const now = Date.now();
            if (now - userData.last_ad_ts < 30 * 1000) {
                 return jsonResp({ error: 'Cooldown active' }, 429);
            }

            // 3. Calculate Reward
            const reward = this.calculateReward(userData.ad_count);

            // 4. Update State
            userData.balance = parseFloat((userData.balance + reward).toFixed(2));
            userData.ad_count += 1;
            userData.last_ad_ts = now;

            await this.state.storage.put('data', userData);

            // 5. Notify Treasury
            await this.notifyTreasuryLiability(reward);

            return jsonResp({
                message: 'Points added',
                balance: userData.balance,
                earned: reward
            });
        }

        if (url.pathname === '/redeem') {
            const { amount, method, username } = await request.json();
            const amountR = parseFloat(amount);

            if (isNaN(amountR) || amountR < 10.00 || amountR > 250.00) {
                return jsonResp({ error: 'Invalid amount (10-250)' }, 400);
            }
            if (userData.balance < amountR) {
                return jsonResp({ error: 'Insufficient balance' }, 400);
            }

            // Calc Fees
            let feePct = 0;
            if (method === 'Airtime') feePct = 0.25;
            else if (method === 'Voucher') feePct = 0.30;
            else if (method === 'Cash Send') feePct = 0.40;
            else return jsonResp({ error: 'Invalid method' }, 400);

            const fee = parseFloat((amountR * feePct).toFixed(2));
            const payout = parseFloat((amountR - fee).toFixed(2));

            // Deduct
            userData.balance = parseFloat((userData.balance - amountR).toFixed(2));

            // Generate Cert ID
            const uniqueId = crypto.randomUUID().split('-')[0].toUpperCase();
            const certId = `CERT-${uniqueId}`;
            const dateStr = new Date().toISOString();

            const certData = {
                id: certId,
                username: username || 'User',
                amount: amountR,
                fee: fee,
                payout: payout,
                method: method,
                date: dateStr,
                status: 'issued'
            };

            // History
            userData.history.unshift({
                id: certId,
                amount: amountR,
                payout: payout,
                date: dateStr,
                status: 'issued'
            });

            await this.state.storage.put('data', userData);
            await this.env.USERS.put(certId, JSON.stringify(certData));

            return jsonResp({
                message: 'Redemption successful',
                balance: userData.balance,
                cert_id: certId
            });
        }

        return jsonResp({ error: 'Not found' }, 404);
    }

    getTodayStr() {
        return new Date().toISOString().split('T')[0];
    }

    calculateReward(adCount) {
        const currentAd = adCount + 1;
        let min, max;

        if (currentAd <= 5) {
            min = 0.1; max = 0.3;
            return this.rand(min, max);
        } else if (currentAd <= 10) {
            if (Math.random() < 0.7) return this.rand(0.1, 0.2);
            else return this.rand(0.2, 0.3);
        } else {
            if (Math.random() < 0.8) return this.rand(0.001, 0.05);
            else return this.rand(0.05, 0.1);
        }
    }

    rand(min, max) {
        return parseFloat((Math.random() * (max - min) + min).toFixed(3));
    }

    async checkGlobalBudget(potentialAmount) {
        const now = Date.now();
        if (!this.globalConfig || (now - this.lastGlobalCheck > 60000)) {
            try {
                const id = this.env.TREASURY_DO.idFromName('GLOBAL_TREASURY');
                const stub = this.env.TREASURY_DO.get(id);
                const res = await stub.fetch(new Request('http://internal/check-budget', {
                    method: 'POST',
                    body: JSON.stringify({ amount: potentialAmount })
                }));
                const data = await res.json();
                this.globalConfig = data.config;
                this.lastGlobalCheck = now;
                return data.ok;
            } catch (e) {
                return false;
            }
        }
        if (this.globalConfig.halted) return false;
        return true;
    }

    async notifyTreasuryLiability(amount) {
        try {
            const id = this.env.TREASURY_DO.idFromName('GLOBAL_TREASURY');
            const stub = this.env.TREASURY_DO.get(id);
            await stub.fetch(new Request('http://internal/add-liability', {
                method: 'POST',
                body: JSON.stringify({ amount })
            }));
        } catch (e) {
            console.error('Failed to update treasury', e);
        }
    }
}

// Helpers
function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
