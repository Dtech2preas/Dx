/**
 * Cloudflare Worker Backend
 *
 * Required KV Namespace Binding: 'USERS'
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
};

// Config
const MONTHLY_BUDGET = 500.00;
const MIN_WITHDRAWAL = 10.00;
const MAX_WITHDRAWAL = 250.00;
const RATE_LIMIT_SECONDS = 20;

export default {
  async fetch(request, env, ctx) {
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
        return await handleGetUser(request, env);
      } else if (path === '/certificate' && request.method === 'GET') {
        return await handleGetCert(request, env);
      } else if (path === '/mark-cert-paid' && request.method === 'POST') {
        return await handleMarkCertPaid(request, env);
      } else if (path === '/admin-stats' && request.method === 'GET') {
        return await handleGetStats(request, env);
      } else {
        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  },
};

// --- Helpers ---

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getCurrentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function getGlobalStats(env) {
  const raw = await env.USERS.get('GLOBAL_STATS');
  const currentMonth = getCurrentMonthStr();

  let stats = raw ? JSON.parse(raw) : {
    month: currentMonth,
    paid: 0,
    liability: 0
  };

  // Auto-reset monthly paid amount if new month
  if (stats.month !== currentMonth) {
    stats.month = currentMonth;
    stats.paid = 0;
    // Liability carries over!
    await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
  }

  return stats;
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400, headers: CORS_HEADERS });
  }

  const existingUser = await env.USERS.get(username);
  if (existingUser) {
    return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 409, headers: CORS_HEADERS });
  }

  const passwordHash = await hashPassword(password);

  const userData = {
    passwordHash: passwordHash,
    balance: 0.00, // Rands
    created_at: new Date().toISOString()
  };

  await env.USERS.put(username, JSON.stringify(userData));

  return new Response(JSON.stringify({ message: 'User registered successfully' }), { status: 201, headers: CORS_HEADERS });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400, headers: CORS_HEADERS });

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  const inputHash = await hashPassword(password);

  // Check password
  if (user.passwordHash !== inputHash) {
      if (user.password && user.password === password) {
          user.passwordHash = await hashPassword(password);
          delete user.password;
      } else {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: CORS_HEADERS });
      }
  }

  // --- MIGRATION: Points -> Rands ---
  // If user has 'points' but no 'balance', convert.
  // Assumption: 1 Ad = 0.5 pts. 1 Ad = ~0.10 Rands. So 1 pt = 0.2 Rands.
  if (user.balance === undefined && user.points !== undefined) {
      user.balance = parseFloat((user.points * 0.2).toFixed(2));
      // Update Global Liability for this migrated amount?
      // Ideally yes, but we might just catch it on the next write or let the system self-correct eventually.
      // To be safe, we will just set it. The Global Stats might be slightly under-reporting initial liability
      // until we manually sync, but that's better than blocking login.
      // Actually, let's just do it.
      const stats = await getGlobalStats(env);
      stats.liability += user.balance;
      await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

      delete user.points; // Remove old field
  }

  if (user.balance === undefined) user.balance = 0;

  const token = crypto.randomUUID();
  user.token = token;
  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({
      message: 'Login successful',
      balance: user.balance,
      token: token
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleAddPoints(request, env) {
  const { username, token } = await request.json();

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

  // 1. Rate Limiting
  const now = Date.now();
  if (user.last_earned_at) {
      const elapsed = (now - user.last_earned_at) / 1000;
      if (elapsed < RATE_LIMIT_SECONDS) {
          return new Response(JSON.stringify({ error: `Please wait ${Math.ceil(RATE_LIMIT_SECONDS - elapsed)}s` }), { status: 429, headers: CORS_HEADERS });
      }
  }

  // 2. Calculate Random Earnings (0.05 - 0.15 Rands)
  // 1 Ad = 0.5 pts. 1 pt = 0.1-0.3 R. => 1 Ad = 0.5 * (0.1..0.3) = 0.05..0.15
  const min = 0.05;
  const max = 0.15;
  const earnings = parseFloat((Math.random() * (max - min) + min).toFixed(2));

  // 3. Check Budget
  const stats = await getGlobalStats(env);
  const totalCommitment = stats.paid + stats.liability;

  if (totalCommitment + earnings > MONTHLY_BUDGET) {
      return new Response(JSON.stringify({
          error: 'Monthly payout limit reached. Please try again next month.'
      }), { status: 503, headers: CORS_HEADERS });
  }

  // 4. Update Global
  stats.liability = parseFloat((stats.liability + earnings).toFixed(2));
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // 5. Update User
  user.balance = parseFloat(((user.balance || 0) + earnings).toFixed(2));
  user.last_earned_at = now;

  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({
      message: 'Earnings credited',
      balance: user.balance,
      earned: earnings
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleRedeem(request, env) {
  const { username, token, amount } = await request.json();

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });

  const amountR = parseFloat(amount);
  if (isNaN(amountR) || amountR < MIN_WITHDRAWAL || amountR > MAX_WITHDRAWAL) {
      return new Response(JSON.stringify({ error: `Amount must be between R${MIN_WITHDRAWAL} and R${MAX_WITHDRAWAL}` }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

  if ((user.balance || 0) < amountR) {
      return new Response(JSON.stringify({ error: 'Insufficient balance' }), { status: 400, headers: CORS_HEADERS });
  }

  // Deduct from User
  user.balance = parseFloat((user.balance - amountR).toFixed(2));

  // Create Certificate
  // Liability does NOT change (it moves from User Wallet to Certificate Value)
  const uniqueId = crypto.randomUUID().split('-')[0].toUpperCase() + '-' + crypto.randomUUID().split('-')[1].toUpperCase();
  const certId = `CERT-${uniqueId}`;

  const certData = {
      id: certId,
      username: username,
      amount: amountR,
      date: new Date().toISOString(),
      status: 'issued' // status: issued, paid
  };

  // Add to User History
  if (!user.history) user.history = [];
  user.history.unshift({
      id: certId,
      amount: amountR,
      date: certData.date,
      status: 'issued'
  });

  await env.USERS.put(username, JSON.stringify(user));
  await env.USERS.put(`CERT:${certId}`, JSON.stringify(certData));

  return new Response(JSON.stringify({
      message: 'Certificate generated',
      balance: user.balance,
      cert_id: certId
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
  const { id, admin_secret } = await request.json();
  const SECRET = env.ADMIN_SECRET;

  if (!SECRET) {
      // Security: If ADMIN_SECRET is not set in Cloudflare, fail open or closed?
      // Fails closed for security.
      return new Response(JSON.stringify({ error: 'Server misconfiguration: ADMIN_SECRET not set' }), { status: 500, headers: CORS_HEADERS });
  }

  if (admin_secret !== SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });
  }

  const key = `CERT:${id}`;
  const certJson = await env.USERS.get(key);

  if (!certJson) return new Response(JSON.stringify({ error: 'Certificate not found' }), { status: 404, headers: CORS_HEADERS });

  const cert = JSON.parse(certJson);
  if (cert.status === 'paid') {
      return new Response(JSON.stringify({ error: 'Certificate already paid' }), { status: 400, headers: CORS_HEADERS });
  }

  cert.status = 'paid';
  await env.USERS.put(key, JSON.stringify(cert));

  // Update Stats: Shift from Liability to Paid
  const stats = await getGlobalStats(env);
  stats.liability = parseFloat((stats.liability - cert.amount).toFixed(2));
  stats.paid = parseFloat((stats.paid + cert.amount).toFixed(2));

  // Sanity check for negative liability (shouldn't happen, but just in case)
  if (stats.liability < 0) stats.liability = 0;

  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // --- SYNC USER HISTORY ---
  if (cert.username) {
      const userJson = await env.USERS.get(cert.username);
      if (userJson) {
          const user = JSON.parse(userJson);
          if (user.history) {
              const item = user.history.find(h => h.id === id);
              if (item) {
                  item.status = 'paid';
                  await env.USERS.put(cert.username, JSON.stringify(user));
              }
          }
      }
  }

  return new Response(JSON.stringify({ message: 'Certificate marked as paid', cert: cert }), { status: 200, headers: CORS_HEADERS });
}

async function handleGetCert(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: CORS_HEADERS });

  const certJson = await env.USERS.get(`CERT:${id}`);
  if (!certJson) return new Response(JSON.stringify({ error: 'Certificate not found' }), { status: 404, headers: CORS_HEADERS });

  return new Response(certJson, { status: 200, headers: CORS_HEADERS });
}

async function handleGetUser(request, env) {
  const url = new URL(request.url);
  const username = url.searchParams.get('username');
  if (!username) return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400, headers: CORS_HEADERS });

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  return new Response(JSON.stringify({
      username: username,
      balance: user.balance || 0,
      history: user.history || []
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleGetStats(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    const EXPECTED = env.ADMIN_SECRET;

    if (!EXPECTED) {
         return new Response(JSON.stringify({ error: 'Server misconfiguration: ADMIN_SECRET not set' }), { status: 500, headers: CORS_HEADERS });
    }

    if (secret !== EXPECTED) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });
    }

    const stats = await getGlobalStats(env);
    return new Response(JSON.stringify(stats), { status: 200, headers: CORS_HEADERS });
}
