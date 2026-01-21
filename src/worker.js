
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
    // We only need the USERS KV namespace now.
    const missingBindings = [];
    if (!env.USERS) missingBindings.push("USERS (KV Namespace)");

    if (missingBindings.length > 0) {
        if (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html')) {
            return new Response(getSetupGuideHTML(missingBindings), {
                headers: { 'Content-Type': 'text/html' }
            });
        }
        return new Response(JSON.stringify({
            error: "Server Configuration Missing",
            details: missingBindings,
            message: "Please configure the USERS KV Namespace in Cloudflare Dashboard."
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
        return await handleAddPoints(request, env);
      } else if (path === '/redeem' && request.method === 'POST') {
        return await handleRedeem(request, env);
      } else if (path === '/user' && request.method === 'GET') {
        return await handleUserInfo(request, env);
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
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Setup Required</h1>
            <p>Your Cloudflare Worker needs one KV Namespace binding.</p>

            <div class="step">
                <h3>1. Open Settings</h3>
                <p>Go to your Worker > <strong>Settings</strong> > <strong>Variables</strong>.</p>
            </div>

            <div class="step">
                <h3>2. Add KV Namespace Binding</h3>
                <p>Scroll to <strong>KV Namespace Bindings</strong> and click <strong>Add binding</strong>.</p>
                <ul>
                    <li>Variable name: <code>USERS</code></li>
                    <li>KV Namespace: <em>Select your namespace</em></li>
                </ul>
            </div>

            <p><strong>Click "Save and Deploy" and refresh this page.</strong></p>
        </div>
    </body>
    </html>
    `;
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return jsonResp({ error: 'Missing inputs' }, 400);

  const key = `PROFILE:${username}`;
  const existing = await env.USERS.get(key);
  if (existing) return jsonResp({ error: 'Username taken' }, 409);

  const pwHash = await hashPassword(password);
  const userProfile = {
    username,
    passwordHash: pwHash,
    created_at: new Date().toISOString()
  };

  await env.USERS.put(key, JSON.stringify(userProfile));

  // Initialize Data
  const dataKey = `DATA:${username}`;
  await env.USERS.put(dataKey, JSON.stringify({
      balance: 0.00,
      ad_count: 0,
      last_ad_ts: 0,
      last_reset_day: getTodayStr(),
      history: []
  }));

  return jsonResp({ message: 'Registered successfully' }, 201);
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  const key = `PROFILE:${username}`;
  const profileStr = await env.USERS.get(key);
  if (!profileStr) return jsonResp({ error: 'User not found' }, 404);

  const profile = JSON.parse(profileStr);
  const inputHash = await hashPassword(password);

  if (profile.passwordHash !== inputHash) {
    return jsonResp({ error: 'Invalid credentials' }, 401);
  }

  const token = crypto.randomUUID();
  profile.token = token;
  await env.USERS.put(key, JSON.stringify(profile));

  // Get balance
  const dataKey = `DATA:${username}`;
  const dataStr = await env.USERS.get(dataKey);
  const data = dataStr ? JSON.parse(dataStr) : { balance: 0 };

  return jsonResp({
    message: 'Login successful',
    token: token,
    balance: data.balance
  });
}

async function handleUserInfo(request, env) {
    const url = new URL(request.url);
    const username = url.searchParams.get('username');
    if (!username) return jsonResp({ error: 'Missing username' }, 400);

    const data = await getUserData(env, username);
    return jsonResp({
        username: username,
        balance: data.balance,
        history: data.history
    });
}

async function handleAddPoints(request, env) {
    const body = await request.json();
    const { username, token } = body;

    // Verify Token
    if (!(await verifyToken(env, username, token))) {
        return jsonResp({ error: 'Invalid token' }, 403);
    }

    // Load Data
    const data = await getUserData(env, username);

    // Daily Reset
    const today = getTodayStr();
    if (data.last_reset_day !== today) {
        data.ad_count = 0;
        data.last_reset_day = today;
    }

    // Cooldown
    const now = Date.now();
    if (now - data.last_ad_ts < 30 * 1000) {
        return jsonResp({ error: 'Cooldown active' }, 429);
    }

    // Check Global Budget
    const proceed = await checkGlobalBudget(env, 0.3);
    if (!proceed) {
        return jsonResp({ error: 'Daily limit reached or system paused.' }, 503);
    }

    // Calculate Reward
    const reward = calculateReward(data.ad_count);

    // Update
    data.balance = parseFloat((data.balance + reward).toFixed(2));
    data.ad_count += 1;
    data.last_ad_ts = now;

    await saveUserData(env, username, data);
    await addTreasuryLiability(env, reward);

    return jsonResp({
        message: 'Points added',
        balance: data.balance,
        earned: reward
    });
}

async function handleRedeem(request, env) {
    const { amount, method, username, token } = await request.json();

    if (!(await verifyToken(env, username, token))) {
        return jsonResp({ error: 'Invalid token' }, 403);
    }

    const data = await getUserData(env, username);
    const amountR = parseFloat(amount);

    if (isNaN(amountR) || amountR < 10.00 || amountR > 250.00) {
        return jsonResp({ error: 'Invalid amount (10-250)' }, 400);
    }
    if (data.balance < amountR) {
        return jsonResp({ error: 'Insufficient balance' }, 400);
    }

    // Fees
    let feePct = 0;
    if (method === 'Airtime') feePct = 0.25;
    else if (method === 'Voucher') feePct = 0.30;
    else if (method === 'Cash Send') feePct = 0.40;
    else return jsonResp({ error: 'Invalid method' }, 400);

    const fee = parseFloat((amountR * feePct).toFixed(2));
    const payout = parseFloat((amountR - fee).toFixed(2));

    // Deduct
    data.balance = parseFloat((data.balance - amountR).toFixed(2));

    // Create Cert
    const uniqueId = crypto.randomUUID().split('-')[0].toUpperCase();
    const certId = `CERT-${uniqueId}`;
    const dateStr = new Date().toISOString();

    const certData = {
        id: certId,
        username: username,
        amount: amountR,
        fee: fee,
        payout: payout,
        method: method,
        date: dateStr,
        status: 'issued'
    };

    // History
    data.history.unshift({
        id: certId,
        amount: amountR,
        payout: payout,
        date: dateStr,
        status: 'issued'
    });

    await saveUserData(env, username, data);
    await env.USERS.put(certId, JSON.stringify(certData));

    return jsonResp({
        message: 'Redemption successful',
        balance: data.balance,
        cert_id: certId
    });
}

async function handleGetCert(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Missing id' }, 400);

    // Frontend sends full ID (e.g. CERT-ABCD)
    // We store it directly as that key.
    const cert = await env.USERS.get(id);
    if (!cert) return jsonResp({ error: 'Certificate not found' }, 404);

    return new Response(cert, { headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
    const { id, admin_secret } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    // id is the full CERT-ABCD string
    const certKey = id;
    const certStr = await env.USERS.get(certKey);
    if (!certStr) return jsonResp({ error: 'Not found' }, 404);

    const cert = JSON.parse(certStr);
    if (cert.status === 'paid') return jsonResp({ error: 'Already paid' }, 400);

    cert.status = 'paid';
    await env.USERS.put(certKey, JSON.stringify(cert));

    // Update Treasury: Liability -> Paid
    await payTreasuryLiability(env, cert.amount);

    return jsonResp({ message: 'Marked paid', cert });
}

async function handleGetStats(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const stats = await getTreasuryStats(env);
    const config = await getTreasuryConfig(env);
    return jsonResp({ stats, config });
}

async function handleUpdateConfig(request, env) {
    const { admin_secret, config } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const current = await getTreasuryConfig(env);
    const newConfig = { ...current, ...config };
    await env.USERS.put('TREASURY:CONFIG', JSON.stringify(newConfig));

    return jsonResp({ message: 'Config updated', config: newConfig });
}

// --- Helpers ---

async function verifyToken(env, username, token) {
    if (!username || !token) return false;
    const profileStr = await env.USERS.get(`PROFILE:${username}`);
    if (!profileStr) return false;
    const profile = JSON.parse(profileStr);
    return profile.token === token;
}

async function getUserData(env, username) {
    const dataStr = await env.USERS.get(`DATA:${username}`);
    if (!dataStr) {
        return {
            balance: 0.00,
            ad_count: 0,
            last_ad_ts: 0,
            last_reset_day: getTodayStr(),
            history: []
        };
    }
    return JSON.parse(dataStr);
}

async function saveUserData(env, username, data) {
    await env.USERS.put(`DATA:${username}`, JSON.stringify(data));
}

// --- Treasury Logic ---

async function getTreasuryStats(env) {
    const s = await env.USERS.get('TREASURY:STATS');
    const defaults = { paid: 0, liability: 0, month: getCurrentMonth() };
    const stats = s ? JSON.parse(s) : defaults;

    // Monthly Reset
    if (stats.month !== getCurrentMonth()) {
        stats.month = getCurrentMonth();
        stats.paid = 0;
        await env.USERS.put('TREASURY:STATS', JSON.stringify(stats));
    }
    return stats;
}

async function getTreasuryConfig(env) {
    const c = await env.USERS.get('TREASURY:CONFIG');
    return c ? JSON.parse(c) : { budget: 500.0, halted: false };
}

async function checkGlobalBudget(env, amount) {
    const stats = await getTreasuryStats(env);
    const config = await getTreasuryConfig(env);
    if (config.halted) return false;
    const total = stats.paid + stats.liability + amount;
    return total <= config.budget;
}

async function addTreasuryLiability(env, amount) {
    const stats = await getTreasuryStats(env);
    stats.liability = parseFloat((stats.liability + amount).toFixed(2));
    await env.USERS.put('TREASURY:STATS', JSON.stringify(stats));
}

async function payTreasuryLiability(env, amount) {
    const stats = await getTreasuryStats(env);
    stats.liability = parseFloat((stats.liability - amount).toFixed(2));
    if (stats.liability < 0) stats.liability = 0;
    stats.paid = parseFloat((stats.paid + amount).toFixed(2));
    await env.USERS.put('TREASURY:STATS', JSON.stringify(stats));
}

function calculateReward(adCount) {
    const currentAd = adCount + 1;
    if (currentAd <= 5) return rand(0.1, 0.3);
    else if (currentAd <= 10) {
        return Math.random() < 0.7 ? rand(0.1, 0.2) : rand(0.2, 0.3);
    } else {
        return Math.random() < 0.8 ? rand(0.001, 0.05) : rand(0.05, 0.1);
    }
}

function rand(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(3));
}

function getTodayStr() {
    return new Date().toISOString().split('T')[0];
}

function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
