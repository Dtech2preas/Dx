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

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
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
      } else {
        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  },
};

// --- Handlers ---

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleRegister(request, env) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400, headers: CORS_HEADERS });
  }

  // Check if user already exists
  const existingUser = await env.USERS.get(username);
  if (existingUser) {
    return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 409, headers: CORS_HEADERS });
  }

  const passwordHash = await hashPassword(password);

  // Create new user
  const userData = {
    passwordHash: passwordHash,
    points: 0,
    created_at: new Date().toISOString()
  };

  await env.USERS.put(username, JSON.stringify(userData));

  return new Response(JSON.stringify({ message: 'User registered successfully' }), { status: 201, headers: CORS_HEADERS });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const user = JSON.parse(userJson);
  const inputHash = await hashPassword(password);

  // Check password (support legacy plain text if needed, but primarily hash)
  if (user.passwordHash !== inputHash) {
      if (user.password && user.password === password) {
          // Auto-upgrade legacy user
          user.passwordHash = await hashPassword(password);
          delete user.password;
          // We'll save this update when we save the token
      } else {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: CORS_HEADERS });
      }
  }

  // Generate and store session token
  const token = crypto.randomUUID();
  user.token = token;
  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({ message: 'Login successful', points: user.points, token: token }), { status: 200, headers: CORS_HEADERS });
}

async function handleAddPoints(request, env) {
  const { username, amount, token } = await request.json();
  // Note: amount is optional, defaults to 10 if not provided
  const pointsToAdd = amount ? parseInt(amount) : 10;

  if (!username || !token) {
    return new Response(JSON.stringify({ error: 'Missing username or token' }), { status: 401, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const user = JSON.parse(userJson);

  // Verify Token
  if (!user.token || user.token !== token) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), { status: 403, headers: CORS_HEADERS });
  }

  user.points = (user.points || 0) + pointsToAdd;

  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({ message: 'Points added', points: user.points }), { status: 200, headers: CORS_HEADERS });
}

async function handleRedeem(request, env) {
  const { username, token } = await request.json();

  if (!username || !token) {
    return new Response(JSON.stringify({ error: 'Missing username or token' }), { status: 401, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const user = JSON.parse(userJson);

  if (!user.token || user.token !== token) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), { status: 403, headers: CORS_HEADERS });
  }

  if (user.points < 20) {
      return new Response(JSON.stringify({ error: 'Not enough points (20 required)' }), { status: 400, headers: CORS_HEADERS });
  }

  // Deduct points
  user.points -= 20;
  await env.USERS.put(username, JSON.stringify(user));

  // Generate Certificate ID
  // Format: CERT-XXXX-XXXX
  const uniqueId = crypto.randomUUID().split('-')[0].toUpperCase() + '-' + crypto.randomUUID().split('-')[1].toUpperCase();
  const certId = `CERT-${uniqueId}`;

  const certData = {
      id: certId,
      username: username,
      date: new Date().toISOString(),
      status: 'issued' // status: issued, paid
  };

  // Store certificate
  // We use a prefix 'CERT:' to distinguish from users
  await env.USERS.put(`CERT:${certId}`, JSON.stringify(certData));

  return new Response(JSON.stringify({ message: 'Redemption successful', points: user.points, cert_id: certId }), { status: 200, headers: CORS_HEADERS });
}

async function handleGetCert(request, env) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id param' }), { status: 400, headers: CORS_HEADERS });
  }

  const certJson = await env.USERS.get(`CERT:${id}`);
  if (!certJson) {
    return new Response(JSON.stringify({ error: 'Certificate not found' }), { status: 404, headers: CORS_HEADERS });
  }

  return new Response(certJson, { status: 200, headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
  const { id, admin_secret } = await request.json();

  // Simple Admin Check
  // In production, use an environment variable: env.ADMIN_SECRET
  // For this MVP, we'll check against a hardcoded value or env if available
  const SECRET = env.ADMIN_SECRET || 'admin-secret-123';

  if (admin_secret !== SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });
  }

  const key = `CERT:${id}`;
  const certJson = await env.USERS.get(key);

  if (!certJson) {
    return new Response(JSON.stringify({ error: 'Certificate not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const cert = JSON.parse(certJson);
  cert.status = 'paid';

  await env.USERS.put(key, JSON.stringify(cert));

  return new Response(JSON.stringify({ message: 'Certificate marked as paid', cert: cert }), { status: 200, headers: CORS_HEADERS });
}

async function handleGetUser(request, env) {
  const url = new URL(request.url);
  const username = url.searchParams.get('username');

  if (!username) {
    return new Response(JSON.stringify({ error: 'Missing username param' }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const user = JSON.parse(userJson);
  // Don't return the password!
  return new Response(JSON.stringify({ username: username, points: user.points }), { status: 200, headers: CORS_HEADERS });
}
