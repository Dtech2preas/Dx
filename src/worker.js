
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
    // KV Only Check
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
            message: "Please configure KV in Cloudflare Dashboard."
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

// --- Helper Functions ---

async function getUser(env, username) {
    const dataStr = await env.USERS.get(username);
    if (!dataStr) return null;
    let data = JSON.parse(dataStr);

    // Initialize fields if missing (migration from auth-only or partial data)
    if (data.balance === undefined) {
        data.balance = 0.00;
        data.ad_count = 0;
        data.last_ad_ts = 0;
        data.last_reset_day = new Date().toISOString().split('T')[0];
        data.history = [];
    }

    // Daily Reset Logic
    const today = new Date().toISOString().split('T')[0];
    if (data.last_reset_day !== today) {
        data.ad_count = 0;
        data.last_reset_day = today;
    }
    return data;
}

async function saveUser(env, username, data) {
    await env.USERS.put(username, JSON.stringify(data));
}

async function getTreasury(env) {
    let dataStr = await env.USERS.get('TREASURY_GLOBAL');
    let data;
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

    if (!dataStr) {
        data = {
            stats: { paid: 0, liability: 0, month: currentMonth },
            config: { budget: 500.0, halted: false, reward_multiplier: 1.0 }
        };
    } else {
        data = JSON.parse(dataStr);
    }

    // Monthly Reset
    if (data.stats.month !== currentMonth) {
        data.stats.month = currentMonth;
        data.stats.paid = 0;
        // Liability carries over
    }
    return data;
}

async function saveTreasury(env, data) {
    await env.USERS.put('TREASURY_GLOBAL', JSON.stringify(data));
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return jsonResp({ error: 'Missing inputs' }, 400);

  // Reserved Names
  if (username === 'TREASURY_GLOBAL' || username.startsWith('CERT:')) {
      return jsonResp({ error: 'Invalid username' }, 400);
  }

  const existing = await env.USERS.get(username);
  if (existing) return jsonResp({ error: 'Username taken' }, 409);

  const pwHash = await hashPassword(password);
  const userProfile = {
    passwordHash: pwHash,
    created_at: new Date().toISOString(),
    balance: 0.00,
    ad_count: 0,
    last_ad_ts: 0,
    last_reset_day: new Date().toISOString().split('T')[0],
    history: []
  };

  await env.USERS.put(username, JSON.stringify(userProfile));

  return jsonResp({ message: 'Registered successfully' }, 201);
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();

  // Use getUser to ensure we have the full object structure initialized
  const profile = await getUser(env, username);
  if (!profile) return jsonResp({ error: 'User not found' }, 404);

  const inputHash = await hashPassword(password);
  if (profile.passwordHash !== inputHash) {
    return jsonResp({ error: 'Invalid credentials' }, 401);
  }

  const token = crypto.randomUUID();
  profile.token = token;

  // Save the token (and any init fields from getUser)
  await saveUser(env, username, profile);

  return jsonResp({
    message: 'Login successful',
    token: token,
    balance: profile.balance
  });
}

async function handleUserAction(request, env, action) {
  let username, token;

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

  let user = await getUser(env, username);
  if (!user) return jsonResp({ error: 'User not found' }, 404);

  // Token Check for Protected Actions
  if (action === 'addPoints' || action === 'redeem') {
    if (user.token !== token) return jsonResp({ error: 'Invalid token' }, 403);
  }

  // --- Logic previously in UserDO ---

  if (action === 'info') {
      return jsonResp({
          username: username,
          balance: user.balance,
          history: user.history
      });
  }

  if (action === 'addPoints') {
      // 1. Check Global Budget
      const treasury = await getTreasury(env);
      const potentialReward = 0.3; // Max assumption
      const totalLiability = treasury.stats.paid + treasury.stats.liability + potentialReward;

      if (treasury.config.halted || (totalLiability > treasury.config.budget)) {
          return jsonResp({ error: 'Daily limit reached or system paused.' }, 503);
      }

      // 2. Cooldown
      const now = Date.now();
      if (now - user.last_ad_ts < 30 * 1000) {
           return jsonResp({ error: 'Cooldown active' }, 429);
      }

      // 3. Calculate Reward
      const reward = calculateReward(user.ad_count);

      // 4. Update State
      user.balance = parseFloat((user.balance + reward).toFixed(2));
      user.ad_count += 1;
      user.last_ad_ts = now;

      treasury.stats.liability = parseFloat((treasury.stats.liability + reward).toFixed(2));

      // 5. Commit
      await saveUser(env, username, user);
      await saveTreasury(env, treasury);

      return jsonResp({
          message: 'Points added',
          balance: user.balance,
          earned: reward
      });
  }

  if (action === 'redeem') {
      const { amount, method } = await request.json(); // username taken from outer scope
      const amountR = parseFloat(amount);

      if (isNaN(amountR) || amountR < 10.00 || amountR > 250.00) {
          return jsonResp({ error: 'Invalid amount (10-250)' }, 400);
      }
      if (user.balance < amountR) {
          return jsonResp({ error: 'Insufficient balance' }, 400);
      }

      let feePct = 0;
      if (method === 'Airtime') feePct = 0.25;
      else if (method === 'Voucher') feePct = 0.30;
      else if (method === 'Cash Send') feePct = 0.40;
      else return jsonResp({ error: 'Invalid method' }, 400);

      const fee = parseFloat((amountR * feePct).toFixed(2));
      const payout = parseFloat((amountR - fee).toFixed(2));

      // Deduct
      user.balance = parseFloat((user.balance - amountR).toFixed(2));

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

      user.history.unshift({
          id: certId,
          amount: amountR,
          payout: payout,
          date: dateStr,
          status: 'issued'
      });

      // Save User and Cert
      await saveUser(env, username, user);
      await env.USERS.put(`CERT:${certId}`, JSON.stringify(certData)); // Correct key for cert lookup

      return jsonResp({
          message: 'Redemption successful',
          balance: user.balance,
          cert_id: certId
      });
  }

  return jsonResp({ error: 'Unknown action' }, 400);
}

async function handleGetCert(request, env) {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return jsonResp({ error: 'Missing id' }, 400);

    const cert = await env.USERS.get(`CERT:${id}`);
    if (!cert) return jsonResp({ error: 'Certificate not found' }, 404);

    return new Response(cert, { headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
    const { id, admin_secret } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    // Frontend/Scanner passes 'CERT-XXXX'.
    // The key in KV is `CERT:CERT-XXXX`.

    const certKey = `CERT:${id}`;
    const certStr = await env.USERS.get(certKey);
    if (!certStr) return jsonResp({ error: 'Not found' }, 404);

    const cert = JSON.parse(certStr);
    if (cert.status === 'paid') return jsonResp({ error: 'Already paid' }, 400);

    cert.status = 'paid';

    // Update Treasury
    const treasury = await getTreasury(env);

    treasury.stats.liability = parseFloat((treasury.stats.liability - cert.amount).toFixed(2));
    if (treasury.stats.liability < 0) treasury.stats.liability = 0;

    treasury.stats.paid = parseFloat((treasury.stats.paid + cert.amount).toFixed(2));

    await env.USERS.put(certKey, JSON.stringify(cert));
    await saveTreasury(env, treasury);

    return jsonResp({ message: 'Marked paid', cert });
}

async function handleGetStats(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const treasury = await getTreasury(env);
    return jsonResp(treasury);
}

async function handleUpdateConfig(request, env) {
    const { admin_secret, config } = await request.json();
    if (admin_secret !== env.ADMIN_SECRET) return jsonResp({ error: 'Unauthorized' }, 403);

    const treasury = await getTreasury(env);
    treasury.config = { ...treasury.config, ...config };

    await saveTreasury(env, treasury);

    return jsonResp({ message: 'Config updated', config: treasury.config });
}


// --- Utils ---

function jsonResp(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function calculateReward(adCount) {
    const currentAd = adCount + 1;
    let min, max;

    if (currentAd <= 5) {
        min = 0.1; max = 0.3;
        return rand(min, max);
    } else if (currentAd <= 10) {
        if (Math.random() < 0.7) return rand(0.1, 0.2);
        else return rand(0.2, 0.3);
    } else {
        if (Math.random() < 0.8) return rand(0.001, 0.05);
        else return rand(0.05, 0.1);
    }
}

function rand(min, max) {
    return parseFloat((Math.random() * (max - min) + min).toFixed(3));
}

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
            <p>Your Cloudflare Worker code is deployed, but it is not connected to the required KV storage. The following bindings are missing:</p>
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

            <p><strong>After adding this, click "Save and Deploy" and refresh this page.</strong></p>
        </div>
    </body>
    </html>
    `;
}
