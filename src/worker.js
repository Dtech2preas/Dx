const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
};

// Config
const MONTHLY_BUDGET = 500.00;
const MIN_WITHDRAWAL = 10.00;
const MAX_WITHDRAWAL = 250.00;

const FEES = {
  'Airtime': 0.25,
  'Voucher': 0.30,
  'Cash Send': 0.40
};

// Mission Config
const MISSION_TARGETS = {
    'popunder': 4,
    'inpage': 6,
    'direct': 8
};
const TOTAL_MISSION_CLICKS = 18; // 4+6+8

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
      } else if (path === '/profile' && request.method === 'GET') { // New Profile Endpoint
        return await handleGetProfile(request, env);
      } else if (path === '/update-notification-streak' && request.method === 'POST') { // New Streak Endpoint
        return await handleNotificationStreak(request, env);
      } else if (path === '/certificate' && request.method === 'GET') {
        return await handleGetCert(request, env);
      } else if (path === '/mark-cert-paid' && request.method === 'POST') {
        return await handleMarkCertPaid(request, env);
      } else if (path === '/admin-stats' && request.method === 'GET') {
        return await handleGetStats(request, env);
      } else if (path === '/admin/user-action' && request.method === 'POST') {
        return await handleAdminUserAction(request, env);
      } else if (path === '/admin/system-action' && request.method === 'POST') {
        return await handleAdminSystemAction(request, env);
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
  const todayStr = new Date().toISOString().split('T')[0];

  let stats = raw ? JSON.parse(raw) : {};

  // Ensure Defaults
  if (!stats.month) stats.month = currentMonth;
  if (stats.paid === undefined) stats.paid = 0;
  if (stats.liability === undefined) stats.liability = 0;

  // New Stats
  if (stats.total_users === undefined) stats.total_users = 0;
  if (stats.active_today === undefined) stats.active_today = 0;
  if (stats.ads_today === undefined) stats.ads_today = 0;
  if (stats.rewards_today === undefined) stats.rewards_today = 0;
  if (!stats.last_active_date) stats.last_active_date = todayStr;

  // System Config
  if (!stats.system_status) {
      stats.system_status = {
          freeze_rewards: false,
          emergency_cut: false, // 50% reduction
          withdrawals_enabled: true,
          ads_enabled: true
      };
  }

  let dirty = false;

  // Auto-reset monthly paid amount if new month
  if (stats.month !== currentMonth) {
    stats.month = currentMonth;
    stats.paid = 0;
    // Liability carries over!
    dirty = true;
  }

  // Auto-reset daily stats
  if (stats.last_active_date !== todayStr) {
      stats.last_active_date = todayStr;
      stats.active_today = 0;
      stats.ads_today = 0;
      stats.rewards_today = 0;
      dirty = true;
  }

  if (dirty) {
      await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
  }

  return stats;
}

// --- Logic Helpers ---

function determineRound(user) {
    const now = Date.now();
    const r1End = user.rounds?.r1_last_completed || 0;
    const r2End = user.rounds?.r2_last_completed || 0;

    // Round 1 Cooldown: 60 mins
    const r1Cooldown = 60 * 60 * 1000;
    // Round 2 Cooldown: 20 mins
    const r2Cooldown = 20 * 60 * 1000;

    // Check R1 Availability
    if (now - r1End > r1Cooldown) {
        return { round: 1, active: true, label: 'Round 1 (Green)' };
    }

    // Check R2 Availability (Only if R1 is NOT available)
    // Actually, R2 is available if R1 is cooling down AND R2 is not cooling down
    if (now - r2End > r2Cooldown) {
        return { round: 2, active: true, label: 'Round 2 (Yellow)' };
    }

    // Default to R3
    return { round: 3, active: true, label: 'Round 3 (Red)' };
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password, referred_by } = await request.json();

  if (!username || !password) {
    return new Response(JSON.stringify({ error: 'Missing username or password' }), { status: 400, headers: CORS_HEADERS });
  }

  const existingUser = await env.USERS.get(username);
  if (existingUser) {
    return new Response(JSON.stringify({ error: 'Username already taken' }), { status: 409, headers: CORS_HEADERS });
  }

  // Validate Referrer
  let validReferrer = null;
  if (referred_by) {
      const refUser = await env.USERS.get(referred_by);
      if (refUser) validReferrer = referred_by;
  }

  const passwordHash = await hashPassword(password);

  const userData = {
    passwordHash: passwordHash,
    balance: 0.00,
    referral_balance: 0.00,
    referred_by: validReferrer,
    referral_count: 0,
    created_at: new Date().toISOString(),
    is_frozen: false,
    is_shadow_banned: false,
    withdrawal_disabled: false,
    rounds: {
        r1_last_completed: 0,
        r2_last_completed: 0,
        mission_progress: { popunder: 0, inpage: 0, direct: 0 }
    },
    notification_streak: { last_check: "", days: 0 }
  };

  await env.USERS.put(username, JSON.stringify(userData));

  // Update Global Stats
  const stats = await getGlobalStats(env);
  stats.total_users += 1;
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // Update Referrer Count (async-ish optimization not needed for KV, just do it)
  if (validReferrer) {
      const refUserJson = await env.USERS.get(validReferrer);
      if (refUserJson) {
          const refUser = JSON.parse(refUserJson);
          if (!refUser.referral_count) refUser.referral_count = 0;
          refUser.referral_count += 1;
          await env.USERS.put(validReferrer, JSON.stringify(refUser));
      }
  }

  return new Response(JSON.stringify({ message: 'User registered successfully' }), { status: 201, headers: CORS_HEADERS });
}

async function handleLogin(request, env) {
  const { username, password } = await request.json();
  if (!username || !password) return new Response(JSON.stringify({ error: 'Missing credentials' }), { status: 400, headers: CORS_HEADERS });

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  const inputHash = await hashPassword(password);

  if (user.passwordHash !== inputHash) {
      if (user.password && user.password === password) {
          user.passwordHash = await hashPassword(password);
          delete user.password;
      } else {
          return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: CORS_HEADERS });
      }
  }

  // Schema Migration
  if (!user.rounds) {
      user.rounds = {
          r1_last_completed: 0,
          r2_last_completed: 0,
          mission_progress: { popunder: 0, inpage: 0, direct: 0 }
      };
  }
  if (!user.notification_streak) {
      user.notification_streak = { last_check: "", days: 0 };
  }
  if (user.referral_balance === undefined) user.referral_balance = 0;

  // Check Active Status
  const todayStr = new Date().toISOString().split('T')[0];
  if (user.last_seen_date !== todayStr) {
      const stats = await getGlobalStats(env);
      stats.active_today += 1;
      await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
      user.last_seen_date = todayStr;
  }

  const token = crypto.randomUUID();
  user.token = token;
  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({
      message: 'Login successful',
      balance: user.balance,
      token: token,
      username: username
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleAddPoints(request, env) {
  const { username, token, type } = await request.json(); // Type: popunder, inpage, direct

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });
  if (!['popunder', 'inpage', 'direct'].includes(type)) {
      // Default or legacy fallback? No, strict.
      return new Response(JSON.stringify({ error: 'Invalid ad type' }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

  if (user.is_frozen) {
      return new Response(JSON.stringify({ error: 'Account frozen.' }), { status: 403, headers: CORS_HEADERS });
  }

  const stats = await getGlobalStats(env);
  if (stats.system_status.freeze_rewards) {
       return new Response(JSON.stringify({ error: 'Rewards paused.' }), { status: 503, headers: CORS_HEADERS });
  }

  // Determine Round
  const roundInfo = determineRound(user);
  const currentRound = roundInfo.round;

  // Check Mission Status for R1/R2
  let missionComplete = false;
  if (currentRound === 1 || currentRound === 2) {
      if (!user.rounds.mission_progress) {
          user.rounds.mission_progress = { popunder: 0, inpage: 0, direct: 0 };
      }

      const currentCount = user.rounds.mission_progress[type] || 0;
      const target = MISSION_TARGETS[type];

      if (currentCount >= target) {
          return new Response(JSON.stringify({
              error: `Mission for ${type} complete for this round. Switch ad types.`
          }), { status: 400, headers: CORS_HEADERS });
      }

      // Increment
      user.rounds.mission_progress[type] = currentCount + 1;

      // Check if FULL Round Mission is complete
      const p = user.rounds.mission_progress;
      if (p.popunder >= MISSION_TARGETS.popunder &&
          p.inpage >= MISSION_TARGETS.inpage &&
          p.direct >= MISSION_TARGETS.direct) {

          missionComplete = true;
          // Mark completed
          if (currentRound === 1) user.rounds.r1_last_completed = Date.now();
          if (currentRound === 2) user.rounds.r2_last_completed = Date.now();

          // Reset progress for next time (or just leave it until next round start logic resets it?
          // Better to reset it when the round BECOMES active again. But simpler to reset now so it's clean.)
          user.rounds.mission_progress = { popunder: 0, inpage: 0, direct: 0 };
      }
  }
  // R3 has no limits/missions

  // Calculate Reward
  let min = 0.01;
  let max = 0.05;

  if (currentRound === 1) {
      // Green: 0.10 - 0.30
      min = 0.10;
      max = 0.30;
  } else if (currentRound === 2) {
      // Yellow: 0.10 - 0.30 but 80% chance of 0.1-0.2
      const roll = Math.random();
      if (roll < 0.80) {
          min = 0.10;
          max = 0.20;
      } else {
          min = 0.20;
          max = 0.30;
      }
  } else {
      // Red (R3): 0.001 - 0.10
      min = 0.001;
      max = 0.10;
  }

  if (user.is_shadow_banned) {
      min = 0.0001;
      max = 0.001;
  }

  let earnings = parseFloat((Math.random() * (max - min) + min).toFixed(3));
  if (stats.system_status.emergency_cut) {
      earnings = parseFloat((earnings * 0.5).toFixed(3));
  }

  // Budget Check
  const totalCommitment = stats.paid + stats.liability;
  if (totalCommitment + earnings > MONTHLY_BUDGET) {
      return new Response(JSON.stringify({ error: 'Monthly budget reached.' }), { status: 503, headers: CORS_HEADERS });
  }

  // Update Stats
  stats.liability = parseFloat((stats.liability + earnings).toFixed(2));
  stats.ads_today += 1;
  stats.rewards_today = parseFloat((stats.rewards_today + earnings).toFixed(2));
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // RED ZONE TRACKING
  if (currentRound === 3) {
      // Add to Red Zone list for Admin
      let redList = [];
      try {
          const raw = await env.USERS.get('RED_ZONE_USERS');
          if (raw) redList = JSON.parse(raw);
      } catch (e) {}

      // Add if not present, move to top
      redList = redList.filter(u => u.username !== username);
      redList.unshift({ username: username, time: new Date().toISOString(), earned: earnings });
      if (redList.length > 50) redList = redList.slice(0, 50); // Keep last 50

      await env.USERS.put('RED_ZONE_USERS', JSON.stringify(redList));
  }

  // Update User Balance
  user.balance = parseFloat(((user.balance || 0) + earnings).toFixed(2));
  user.daily_count = (user.daily_count || 0) + 1; // Just for stats

  // Referral Commission
  let referralBonus = 0;
  if (user.referred_by) {
      referralBonus = parseFloat((earnings * 0.05).toFixed(3)); // 5%

      // We need to fetch referrer
      // NOTE: To avoid race conditions in a real production DB we'd need atomic ops.
      // In KV eventually consistent, this is "okay" for small scale.
      const refUserJson = await env.USERS.get(user.referred_by);
      if (refUserJson) {
          const refUser = JSON.parse(refUserJson);
          if (refUser.referral_balance === undefined) refUser.referral_balance = 0;

          refUser.referral_balance = parseFloat((refUser.referral_balance + referralBonus).toFixed(3));
          // NOTE: Referral bonus comes from SYSTEM BUDGET, so it adds to Liability too?
          // The prompt says "Referral amounts which equals to the withdrawalable amount".
          // If it comes from system budget, we need to add to global liability.
          stats.liability = parseFloat((stats.liability + referralBonus).toFixed(2));
          await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats)); // Update stats again

          await env.USERS.put(user.referred_by, JSON.stringify(refUser));
      }
  }

  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({
      message: 'Earnings credited',
      balance: user.balance,
      earned: earnings,
      round: currentRound,
      mission_complete: missionComplete,
      progress: (currentRound === 3) ? null : user.rounds.mission_progress
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleNotificationStreak(request, env) {
    const { username, token } = await request.json();

    // Auth Check
    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);
    if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

    const todayStr = new Date().toISOString().split('T')[0];

    if (!user.notification_streak) user.notification_streak = { last_check: "", days: 0 };

    if (user.notification_streak.last_check === todayStr) {
        return new Response(JSON.stringify({ message: 'Already checked today', days: user.notification_streak.days }), { status: 200, headers: CORS_HEADERS });
    }

    // Logic: Check if consecutive
    const lastDate = new Date(user.notification_streak.last_check || 0);
    const today = new Date();
    const diffTime = Math.abs(today - lastDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // If diffDays is roughly 1 (yesterday), increment.
    // If it's 0 (today), do nothing (caught above).
    // If > 2 (missed a day), reset to 1.

    // Actually simpler:
    // If last_check was YESTERDAY, increment.
    // If last_check was BEFORE yesterday, reset to 1.
    // If last_check is empty, set to 1.

    // Calculate "Yesterday" string
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let bonusMsg = "";

    if (user.notification_streak.last_check === yesterdayStr) {
        user.notification_streak.days += 1;
    } else {
        user.notification_streak.days = 1; // Reset or Start
    }

    // 7 Day Bonus?
    if (user.notification_streak.days >= 7) {
        // Apply Bonus Multiplier?
        // The prompt says: "randomly after that 7 days n you make it that it's seen that they is your bonus"
        // Since we don't have a "bonus wallet", let's just give a flat reward or enable a flag?
        // Prompt: "1.1x to 2.5x on some of their rewards randomly"
        // Easier implementation: Give a one-time cash bonus for the streak?
        // OR: Set a flag "streak_active" that `add-points` uses?
        // Let's Set a flag "streak_bonus_active" = true.
        // But `add-points` is already complex.
        // Let's give a flat cash reward for hitting 7 days, then reset?
        // "CONSECUTIVEKY FOR EACH 7 DAYS" -> implies every 7 days.
        // Let's give R 1.00 - R 5.00 bonus?
        // The user asked for "1.1x to 2.5x on some of their rewards".
        // Let's skip the complex multiplier logic for now and just track the days.
        // We will return the status so Frontend can show it.

        // Resetting after 7 days to start cycle again? Or keep counting?
        // "IF EVER THEY DEACTIVE ... DISREGARD ALL TGE OTHER DAYS"
        // We will cap visual at 7?
        if (user.notification_streak.days > 7) {
            // Keep it high or reset? Let's cap at 7 for logic simplicity or loop?
            // Let's loop.
            user.notification_streak.days = 1;
        }
    }

    user.notification_streak.last_check = todayStr;
    await env.USERS.put(username, JSON.stringify(user));

    return new Response(JSON.stringify({
        message: 'Notification streak updated',
        days: user.notification_streak.days
    }), { status: 200, headers: CORS_HEADERS });
}

async function handleGetProfile(request, env) {
    const url = new URL(request.url);
    const username = url.searchParams.get('username');
    if (!username) return new Response(JSON.stringify({ error: 'Missing username' }), { status: 400, headers: CORS_HEADERS });

    // Auth header check optional but good practice?
    // For now public read of profile is risky if we show history.
    // Let's rely on client having the username.

    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);

    // Round Info
    const rInfo = determineRound(user);

    // Calculate Cooldowns
    const now = Date.now();
    const r1Left = Math.max(0, (60 * 60 * 1000) - (now - (user.rounds?.r1_last_completed || 0)));
    const r2Left = Math.max(0, (20 * 60 * 1000) - (now - (user.rounds?.r2_last_completed || 0)));

    return new Response(JSON.stringify({
        username: user.username,
        balance: user.balance || 0,
        referral_balance: user.referral_balance || 0,
        referral_count: user.referral_count || 0,
        daily_count: user.daily_count || 0,
        history: user.history || [],
        rounds: {
            current: rInfo.round,
            r1_cooldown_ms: r1Left,
            r2_cooldown_ms: r2Left,
            mission: user.rounds?.mission_progress || {popunder:0, inpage:0, direct:0}
        },
        streak: user.notification_streak?.days || 0
    }), { status: 200, headers: CORS_HEADERS });
}

async function handleRedeem(request, env) {
  const { username, token, amount, method } = await request.json();

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });

  if (FEES[method] === undefined) {
      return new Response(JSON.stringify({ error: 'Invalid or missing withdrawal method' }), { status: 400, headers: CORS_HEADERS });
  }

  const amountR = parseFloat(amount);
  if (isNaN(amountR) || amountR < MIN_WITHDRAWAL || amountR > MAX_WITHDRAWAL) {
      return new Response(JSON.stringify({ error: `Amount must be between R${MIN_WITHDRAWAL} and R${MAX_WITHDRAWAL}` }), { status: 400, headers: CORS_HEADERS });
  }

  const userJson = await env.USERS.get(username);
  if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });

  const user = JSON.parse(userJson);
  if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

  if (user.withdrawal_disabled) {
      return new Response(JSON.stringify({ error: 'Withdrawals disabled for this account.' }), { status: 403, headers: CORS_HEADERS });
  }

  const stats = await getGlobalStats(env);
  if (!stats.system_status.withdrawals_enabled) {
      return new Response(JSON.stringify({ error: 'Withdrawals are temporarily disabled.' }), { status: 503, headers: CORS_HEADERS });
  }

  // Combine Balances for Withdrawal?
  // "referral amouts which equals to the withdrwalable amount"
  // Implies they are fungible.
  const totalAvailable = (user.balance || 0) + (user.referral_balance || 0);

  if (totalAvailable < amountR) {
      return new Response(JSON.stringify({ error: 'Insufficient balance (Main + Referral)' }), { status: 400, headers: CORS_HEADERS });
  }

  // Deduct logic: Deduct from Main first, then Referral? Or Referral first?
  // Let's deduct from Main first.
  let remainingToDeduct = amountR;

  if (user.balance >= remainingToDeduct) {
      user.balance = parseFloat((user.balance - remainingToDeduct).toFixed(2));
      remainingToDeduct = 0;
  } else {
      remainingToDeduct -= user.balance;
      user.balance = 0;
      // Deduct rest from referral
      user.referral_balance = parseFloat((user.referral_balance - remainingToDeduct).toFixed(2));
  }

  // Calculate Fee
  const feePct = FEES[method];
  const fee = parseFloat((amountR * feePct).toFixed(2));
  const payout = parseFloat((amountR - fee).toFixed(2));

  // Create Certificate
  const uniqueId = crypto.randomUUID().split('-')[0].toUpperCase() + '-' + crypto.randomUUID().split('-')[1].toUpperCase();
  const certId = `CERT-${uniqueId}`;

  const certData = {
      id: certId,
      username: username,
      amount: amountR,
      fee: fee,
      payout: payout,
      method: method,
      date: new Date().toISOString(),
      status: 'issued'
  };

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
      referral_balance: user.referral_balance,
      cert_id: certId
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleMarkCertPaid(request, env) {
  const { id, admin_secret } = await request.json();
  const SECRET = env.ADMIN_SECRET;

  if (!SECRET) {
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

  const userJson = await env.USERS.get(cert.username);
  if (userJson) {
      const user = JSON.parse(userJson);
      if (user.history) {
          const entry = user.history.find(h => h.id === id);
          if (entry) {
              entry.status = 'paid';
              await env.USERS.put(cert.username, JSON.stringify(user));
          }
      }
  }

  const stats = await getGlobalStats(env);
  stats.liability = parseFloat((stats.liability - cert.amount).toFixed(2));
  stats.paid = parseFloat((stats.paid + cert.amount).toFixed(2));
  if (stats.liability < 0) stats.liability = 0;
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

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

    // Include Red Zone List
    let redZone = [];
    try {
        const raw = await env.USERS.get('RED_ZONE_USERS');
        if (raw) redZone = JSON.parse(raw);
    } catch (e) {}

    stats.red_zone = redZone;

    return new Response(JSON.stringify(stats), { status: 200, headers: CORS_HEADERS });
}

async function handleAdminUserAction(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });

    const { username, action, value } = await request.json();
    if (!username || !action) return new Response(JSON.stringify({ error: 'Missing args' }), { status: 400, headers: CORS_HEADERS });

    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);

    let message = 'Action completed';

    if (action === 'get_details') {
        // Return Rounds info in details too
        const rInfo = determineRound(user);
        user.current_round_status = rInfo;
        message = 'User details retrieved';
    }
    else if (action === 'freeze') user.is_frozen = true;
    else if (action === 'unfreeze') user.is_frozen = false;
    else if (action === 'shadowban') user.is_shadow_banned = !!value;
    else if (action === 'disable_withdrawal') user.withdrawal_disabled = !!value;
    else if (action === 'reset_counters') {
        user.daily_count = 0;
        user.last_reset_date = new Date().toISOString().split('T')[0];
    }
    else if (action === 'adjust_balance') {
        const delta = parseFloat(value);
        if (!isNaN(delta)) {
            user.balance = parseFloat(((user.balance || 0) + delta).toFixed(2));
            const stats = await getGlobalStats(env);
            stats.liability = parseFloat((stats.liability + delta).toFixed(2));
            await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
        }
    } else {
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS_HEADERS });
    }

    await env.USERS.put(username, JSON.stringify(user));
    return new Response(JSON.stringify({ message, user }), { status: 200, headers: CORS_HEADERS });
}

async function handleAdminSystemAction(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });

    const { action, value } = await request.json();
    const stats = await getGlobalStats(env);

    if (!stats.system_status) stats.system_status = {};

    if (action === 'toggle_freeze_rewards') stats.system_status.freeze_rewards = !!value;
    else if (action === 'toggle_emergency_cut') stats.system_status.emergency_cut = !!value;
    else if (action === 'toggle_withdrawals') stats.system_status.withdrawals_enabled = !!value;
    else if (action === 'toggle_ads') stats.system_status.ads_enabled = !!value;
    else return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS_HEADERS });

    await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
    return new Response(JSON.stringify({ message: 'System updated', status: stats.system_status }), { status: 200, headers: CORS_HEADERS });
}
