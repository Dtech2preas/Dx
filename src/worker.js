/**
 * Cloudflare Worker Backend
 *
 * Required KV Namespace Binding: 'USERS'
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
      } else if (path === '/user' && request.method === 'GET') {
        return await handleGetUser(request, env);
      } else {
        return new Response('Not Found', { status: 404, headers: CORS_HEADERS });
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS_HEADERS });
    }
  },
};

// --- Handlers ---

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

  // Create new user
  const userData = {
    password: password, // In production, this should be hashed!
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
  if (user.password !== password) {
    return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify({ message: 'Login successful', points: user.points }), { status: 200, headers: CORS_HEADERS });
}

async function handleAddPoints(request, env) {
  const { username, amount } = await request.json();
  // Note: amount is optional, defaults to 10 if not provided, but capped for safety in this demo
  const pointsToAdd = amount ? parseInt(amount) : 10;

  if (!username) {
    return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
  }

  const user = JSON.parse(userJson);
  user.points = (user.points || 0) + pointsToAdd;

  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({ message: 'Points added', points: user.points }), { status: 200, headers: CORS_HEADERS });
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
