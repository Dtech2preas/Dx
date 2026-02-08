const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://student.dtech-services.co.za',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
};

// Config Defaults
const DEFAULT_CONFIG = {
    monthly_budget: 500.00,
    min_withdrawal: 10.00,
    max_withdrawal: 250.00,
    fees: {
        'Airtime': 0.25,
        'Voucher': 0.30,
        'Cash Send': 0.40
    },
    mission_targets: {
        'popunder': 4,
        'inpage': 6,
        'direct': 8
    },
    rewards: {
        r1_min: 0.10, r1_max: 0.30,
        r2_min_low: 0.10, r2_max_low: 0.20,
        r2_min_high: 0.20, r2_max_high: 0.30,
        r3_min: 0.001, r3_max: 0.10,
        shadow_min: 0.0001, shadow_max: 0.001
    },
    cooldowns: {
        r1: 3600000, // 60 mins
        r2: 1200000  // 20 mins
    }
};

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
      } else if (path === '/profile' && request.method === 'GET') {
        return await handleGetProfile(request, env);
      } else if (path === '/update-notification-streak' && request.method === 'POST') {
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
      } else if (path === '/admin/ad-sets' && (request.method === 'GET' || request.method === 'POST')) {
        return await handleAdSets(request, env);
      } else if (path === '/admin/reconcile' && request.method === 'POST') {
        return await handleReconcile(request, env);
      } else if (path === '/admin/system-config' && (request.method === 'GET' || request.method === 'POST')) {
        return await handleSystemConfig(request, env);
      } else if (path === '/dismiss-message' && request.method === 'POST') {
        return await handleDismissMessage(request, env);
      } else if (path === '/system-status' && request.method === 'GET') {
        return await handleGetSystemStatus(request, env);
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
      // Archive History
      try {
          let history = [];
          const rawHist = await env.USERS.get('SYSTEM:HISTORY_30_DAYS');
          if(rawHist) history = JSON.parse(rawHist);

          history.unshift({
              date: stats.last_active_date,
              active: stats.active_today || 0,
              ads: stats.ads_today || 0,
              rewards: stats.rewards_today || 0,
              liability: stats.liability || 0
          });

          if(history.length > 30) history = history.slice(0, 30);
          await env.USERS.put('SYSTEM:HISTORY_30_DAYS', JSON.stringify(history));
      } catch(e) {}

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

async function getConfig(env) {
    try {
        const raw = await env.USERS.get('SYSTEM:CONFIG');
        if(raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch(e) {}
    return DEFAULT_CONFIG;
}

async function logSystemAction(env, action, details) {
    const entry = { time: new Date().toISOString(), action, details };
    try {
        let logs = [];
        const raw = await env.USERS.get('SYSTEM:LOGS');
        if(raw) logs = JSON.parse(raw);
        logs.unshift(entry);
        if(logs.length > 100) logs = logs.slice(0, 100);
        await env.USERS.put('SYSTEM:LOGS', JSON.stringify(logs));
    } catch(e) {}
}

// --- Logic Helpers ---

async function determineRound(user, env) {
    const config = await getConfig(env);
    const now = Date.now();
    const r1End = user.rounds?.r1_last_completed || 0;
    const r2End = user.rounds?.r2_last_completed || 0;

    const r1Cooldown = config.cooldowns.r1;
    const r2Cooldown = config.cooldowns.r2;

    // Check R1 Availability
    if (now - r1End > r1Cooldown) {
        return { round: 1, active: true, label: 'Round 1 (Green)' };
    }

    // Check R2 Availability (Only if R1 is NOT available)
    if (now - r2End > r2Cooldown) {
        return { round: 2, active: true, label: 'Round 2 (Yellow)' };
    }

    // Default to R3
    return { round: 3, active: true, label: 'Round 3 (Red)' };
}

// --- Handlers ---

async function handleRegister(request, env) {
  const { username, password, referred_by, email, whatsapp } = await request.json();

  if (!username || !password || !email || !whatsapp) {
    return new Response(JSON.stringify({ error: 'Missing fields: Username, Password, Email, WhatsApp' }), { status: 400, headers: CORS_HEADERS });
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
    balance_pending: 0.00,
    status: 'pending',
    ad_set_id: null,
    email: email,
    whatsapp: whatsapp,
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
    notification_streak: { last_check: "", days: 0 },
    daily_stats: {} // { "YYYY-MM-DD": { popunder: {pending, approved}, ... } }
  };

  await env.USERS.put(username, JSON.stringify(userData));

  // Update Global Stats
  const stats = await getGlobalStats(env);
  stats.total_users += 1;
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // Add to Pending List
  let pendingList = [];
  try {
      const raw = await env.USERS.get('PENDING_USERS');
      if (raw) pendingList = JSON.parse(raw);
  } catch(e) {}

  pendingList.push({
      username: username,
      email: email,
      whatsapp: whatsapp,
      date: new Date().toISOString()
  });
  await env.USERS.put('PENDING_USERS', JSON.stringify(pendingList));

  // Update Referrer Count
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
  if (!user.daily_stats) user.daily_stats = {};

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
  await logSystemAction(env, 'LOGIN', `User ${username} logged in`);

  return new Response(JSON.stringify({
      message: 'Login successful',
      balance: user.balance,
      token: token,
      username: username,
      status: user.status || 'active',
      personal_message: user.personal_message || null
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleAddPoints(request, env) {
  const { username, token, type } = await request.json(); // Type: popunder, inpage, direct, push

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });
  if (!['popunder', 'inpage', 'direct', 'push'].includes(type)) {
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

  const config = await getConfig(env);

  // Determine Round
  const roundInfo = await determineRound(user, env);
  const currentRound = roundInfo.round;

  // Check Mission Status for R1/R2
  let missionComplete = false;
  if (currentRound === 1 || currentRound === 2) {
      if (!user.rounds.mission_progress) {
          user.rounds.mission_progress = { popunder: 0, inpage: 0, direct: 0, push: 0 };
      }

      const currentCount = user.rounds.mission_progress[type] || 0;
      const target = config.mission_targets[type] || 999;

      if (type !== 'push' && currentCount >= target) {
          return new Response(JSON.stringify({
              error: `Mission for ${type} complete for this round. Switch ad types.`
          }), { status: 400, headers: CORS_HEADERS });
      }

      // Increment
      user.rounds.mission_progress[type] = currentCount + 1;

      // Check if FULL Round Mission is complete
      const p = user.rounds.mission_progress;
      if (p.popunder >= config.mission_targets.popunder &&
          p.inpage >= config.mission_targets.inpage &&
          p.direct >= config.mission_targets.direct) {

          missionComplete = true;
          // Mark completed
          if (currentRound === 1) user.rounds.r1_last_completed = Date.now();
          if (currentRound === 2) user.rounds.r2_last_completed = Date.now();

          user.rounds.mission_progress = { popunder: 0, inpage: 0, direct: 0 };
      }
  }

  // Calculate Reward
  let min = 0.01;
  let max = 0.05;

  if (currentRound === 1) {
      min = config.rewards.r1_min; max = config.rewards.r1_max;
  } else if (currentRound === 2) {
      const roll = Math.random();
      if (roll < 0.80) { min = config.rewards.r2_min_low; max = config.rewards.r2_max_low; }
      else { min = config.rewards.r2_min_high; max = config.rewards.r2_max_high; }
  } else {
      min = config.rewards.r3_min; max = config.rewards.r3_max;
  }

  if (user.is_shadow_banned) {
      min = config.rewards.shadow_min; max = config.rewards.shadow_max;
  }

  let earnings = parseFloat((Math.random() * (max - min) + min).toFixed(3));
  if (stats.system_status.emergency_cut) {
      earnings = parseFloat((earnings * 0.5).toFixed(3));
  }

  // Budget Check
  const totalCommitment = stats.paid + stats.liability;
  if (totalCommitment + earnings > config.monthly_budget) {
      return new Response(JSON.stringify({ error: 'Monthly budget reached.' }), { status: 503, headers: CORS_HEADERS });
  }

  // Update Global Stats
  stats.liability = parseFloat((stats.liability + earnings).toFixed(2));
  stats.ads_today += 1;
  stats.rewards_today = parseFloat((stats.rewards_today + earnings).toFixed(2));
  await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

  // RED ZONE TRACKING
  if (currentRound === 3) {
      let redList = [];
      try {
          const raw = await env.USERS.get('RED_ZONE_USERS');
          if (raw) redList = JSON.parse(raw);
      } catch (e) {}

      redList = redList.filter(u => u.username !== username);
      redList.unshift({ username: username, time: new Date().toISOString(), earned: earnings });
      if (redList.length > 50) redList = redList.slice(0, 50);

      await env.USERS.put('RED_ZONE_USERS', JSON.stringify(redList));
  }

  // Update User Pending Balance
  user.balance_pending = parseFloat(((user.balance_pending || 0) + earnings).toFixed(3));
  user.daily_count = (user.daily_count || 0) + 1;

  // --- STATS LOGGING ---
  const todayStr = new Date().toISOString().split('T')[0];
  if (!user.daily_stats) user.daily_stats = {};
  if (!user.daily_stats[todayStr]) {
      user.daily_stats[todayStr] = {
          popunder: { pending: 0, approved: 0 },
          inpage: { pending: 0, approved: 0 },
          direct: { pending: 0, approved: 0 },
          push: { pending: 0, approved: 0 },
          total_pending: 0,
          total_approved: 0,
          status: 'pending'
      };
  }

  // Increment pending for specific type
  if (!user.daily_stats[todayStr][type]) {
      // Safety init if schema drift
      user.daily_stats[todayStr][type] = { pending: 0, approved: 0 };
  }
  user.daily_stats[todayStr][type].pending += earnings;
  user.daily_stats[todayStr].total_pending = parseFloat((user.daily_stats[todayStr].total_pending + earnings).toFixed(3));

  // Referral Commission
  let referralBonus = 0;
  if (user.referred_by) {
      referralBonus = parseFloat((earnings * 0.05).toFixed(3)); // 5%

      const refUserJson = await env.USERS.get(user.referred_by);
      if (refUserJson) {
          const refUser = JSON.parse(refUserJson);
          if (refUser.referral_balance === undefined) refUser.referral_balance = 0;

          refUser.referral_balance = parseFloat((refUser.referral_balance + referralBonus).toFixed(3));

          stats.liability = parseFloat((stats.liability + referralBonus).toFixed(2));
          await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));

          await env.USERS.put(user.referred_by, JSON.stringify(refUser));
      }
  }

  await env.USERS.put(username, JSON.stringify(user));

  return new Response(JSON.stringify({
      message: 'Earnings credited',
      balance: user.balance,
      balance_pending: user.balance_pending,
      earned: earnings,
      round: currentRound,
      mission_complete: missionComplete,
      progress: (currentRound === 3) ? null : user.rounds.mission_progress
  }), { status: 200, headers: CORS_HEADERS });
}

async function handleNotificationStreak(request, env) {
    const { username, token } = await request.json();

    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);
    if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

    const todayStr = new Date().toISOString().split('T')[0];
    if (!user.notification_streak) user.notification_streak = { last_check: "", days: 0 };

    if (user.notification_streak.last_check === todayStr) {
        return new Response(JSON.stringify({ message: 'Already checked today', days: user.notification_streak.days }), { status: 200, headers: CORS_HEADERS });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    if (user.notification_streak.last_check === yesterdayStr) {
        user.notification_streak.days += 1;
    } else {
        user.notification_streak.days = 1;
    }

    if (user.notification_streak.days > 7) {
        user.notification_streak.days = 1;
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

    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);

    // --- AGGREGATE STATS ---
    const stats = user.daily_stats || {};
    const todayStr = new Date().toISOString().split('T')[0];

    // Helper to get ranges
    const getRangeStats = (filterFn) => {
        let agg = { popunder: 0, inpage: 0, direct: 0, push: 0, total: 0 };
        Object.keys(stats).forEach(date => {
            if (filterFn(date)) {
                const day = stats[date];
                // If status is approved, use approved values. Else use pending.
                // Prompt: "if it's not approved yet ... yesterday's pending amount ... if it's approved show as approved"
                const useApproved = day.status === 'approved';

                ['popunder', 'inpage', 'direct', 'push'].forEach(t => {
                    const val = useApproved ? (day[t]?.approved || 0) : (day[t]?.pending || 0);
                    agg[t] += val;
                });
                agg.total += useApproved ? (day.total_approved || 0) : (day.total_pending || 0);
            }
        });
        return agg;
    };

    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthStart = new Date(); monthStart.setDate(1);

    const yesterdayStats = getRangeStats(d => d === yesterdayStr);
    const weekStats = getRangeStats(d => d >= weekAgo.toISOString().split('T')[0]);
    const monthStats = getRangeStats(d => d.startsWith(todayStr.substring(0, 7))); // YYYY-MM
    const allTimeStats = getRangeStats(() => true);

    // Fetch Ad Set
    let adSet = null;
    if (user.ad_set_id) {
        try {
            const rawSet = await env.USERS.get(`ADSET:${user.ad_set_id}`);
            if (rawSet) adSet = JSON.parse(rawSet);
        } catch (e) {}
    }

    // Determine Round Data for UI
    const config = await getConfig(env);
    const now = Date.now();
    const r1End = user.rounds?.r1_last_completed || 0;
    const r2End = user.rounds?.r2_last_completed || 0;

    const r1Cooldown = config.cooldowns.r1;
    const r2Cooldown = config.cooldowns.r2;

    const r1Remaining = Math.max(0, (r1End + r1Cooldown) - now);
    const r2Remaining = Math.max(0, (r2End + r2Cooldown) - now);

    const roundInfo = await determineRound(user, env);

    return new Response(JSON.stringify({
        username: user.username,
        balance: user.balance || 0,
        balance_pending: user.balance_pending || 0,
        referral_balance: user.referral_balance || 0,
        referral_count: user.referral_count || 0,
        daily_count: user.daily_count || 0,
        history: user.history || [],
        status: user.status || 'active',
        ad_set: adSet,
        streak: user.notification_streak?.days || 0,
        stats: {
            yesterday: yesterdayStats,
            week: weekStats,
            month: monthStats,
            all_time: allTimeStats
        },
        rounds: {
            current: roundInfo.round,
            r1_cooldown_ms: r1Remaining,
            r2_cooldown_ms: r2Remaining,
            mission: user.rounds?.mission_progress || { popunder: 0, inpage: 0, direct: 0 }
        }
    }), { status: 200, headers: CORS_HEADERS });
}

async function handleRedeem(request, env) {
  const { username, token, amount, method } = await request.json();
  const config = await getConfig(env);

  if (!username || !token) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS_HEADERS });

  if (config.fees[method] === undefined) {
      return new Response(JSON.stringify({ error: 'Invalid or missing withdrawal method' }), { status: 400, headers: CORS_HEADERS });
  }

  const amountR = parseFloat(amount);
  if (isNaN(amountR) || amountR < config.min_withdrawal || amountR > config.max_withdrawal) {
      return new Response(JSON.stringify({ error: `Amount must be between R${config.min_withdrawal} and R${config.max_withdrawal}` }), { status: 400, headers: CORS_HEADERS });
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

  const totalAvailable = (user.balance || 0) + (user.referral_balance || 0);

  if (totalAvailable < amountR) {
      return new Response(JSON.stringify({ error: 'Insufficient balance (Main + Referral)' }), { status: 400, headers: CORS_HEADERS });
  }

  let remainingToDeduct = amountR;

  if (user.balance >= remainingToDeduct) {
      user.balance = parseFloat((user.balance - remainingToDeduct).toFixed(2));
      remainingToDeduct = 0;
  } else {
      remainingToDeduct -= user.balance;
      user.balance = 0;
      user.referral_balance = parseFloat((user.referral_balance - remainingToDeduct).toFixed(2));
  }

  const feePct = config.fees[method];
  const fee = parseFloat((amountR * feePct).toFixed(2));
  const payout = parseFloat((amountR - fee).toFixed(2));

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
  await logSystemAction(env, 'WITHDRAWAL', `User ${username} requested R${amountR} via ${method} (Cert: ${certId})`);

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
      balance_pending: user.balance_pending || 0,
      status: user.status || 'active',
      history: user.history || [],
      personal_message: user.personal_message || null
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

    try {
        const motd = await env.USERS.get('SYSTEM:MOTD');
        stats.motd = motd;
    } catch(e) {}

    let redZone = [];
    try {
        const raw = await env.USERS.get('RED_ZONE_USERS');
        if (raw) redZone = JSON.parse(raw);
    } catch (e) {}
    stats.red_zone = redZone;

    let pendingUsers = [];
    try {
        const raw = await env.USERS.get('PENDING_USERS');
        if (raw) pendingUsers = JSON.parse(raw);
    } catch (e) {}
    stats.pending_users = pendingUsers;

    let unassignedSets = [];
    try {
        const raw = await env.USERS.get('AD_SETS_UNASSIGNED');
        if (raw) unassignedSets = JSON.parse(raw);
    } catch (e) {}
    stats.unassigned_sets_count = unassignedSets.length;

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
        const rInfo = await determineRound(user, env);
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
    }
    else if (action === 'update_profile') {
        if(value.email) user.email = value.email;
        if(value.whatsapp) user.whatsapp = value.whatsapp;
        if(value.password) user.passwordHash = await hashPassword(value.password);
        message = 'Profile updated';
        await logSystemAction(env, 'ADMIN_UPDATE_PROFILE', `Updated profile for ${username}`);
    }
    else if (action === 'send_message') {
        user.personal_message = value;
        message = 'Personal message sent';
    }
    else if (action === 'approve') {
        if (user.status !== 'pending') {
             return new Response(JSON.stringify({ error: 'User is not pending' }), { status: 400, headers: CORS_HEADERS });
        }

        let unassigned = [];
        try {
            const raw = await env.USERS.get('AD_SETS_UNASSIGNED');
            if (raw) unassigned = JSON.parse(raw);
        } catch(e) {}

        if (unassigned.length === 0) {
            return new Response(JSON.stringify({ error: 'No ad sets available. Create one first.' }), { status: 400, headers: CORS_HEADERS });
        }

        const setId = unassigned.shift();
        user.ad_set_id = setId;
        user.status = 'active';

        const setKey = `ADSET:${setId}`;
        const rawSet = await env.USERS.get(setKey);
        if (rawSet) {
            const adSet = JSON.parse(rawSet);
            adSet.assigned_to = username;
            await env.USERS.put(setKey, JSON.stringify(adSet));
        }

        await env.USERS.put('AD_SETS_UNASSIGNED', JSON.stringify(unassigned));

        let pendingList = [];
        try {
            const raw = await env.USERS.get('PENDING_USERS');
            if (raw) pendingList = JSON.parse(raw);
        } catch(e) {}

        pendingList = pendingList.filter(u => u.username !== username);
        await env.USERS.put('PENDING_USERS', JSON.stringify(pendingList));

        message = 'User approved and assigned Ad Set ' + setId;
    }
    else if (action === 'unlink_ad_set') {
        const setId = user.ad_set_id;
        if (setId) {
            // 1. Update Ad Set
            const setKey = `ADSET:${setId}`;
            const rawSet = await env.USERS.get(setKey);
            if (rawSet) {
                const adSet = JSON.parse(rawSet);
                adSet.assigned_to = null;
                await env.USERS.put(setKey, JSON.stringify(adSet));
            }

            // 2. Update Unassigned List
            let unassigned = [];
            try {
                const raw = await env.USERS.get('AD_SETS_UNASSIGNED');
                if (raw) unassigned = JSON.parse(raw);
            } catch(e) {}
            // Avoid duplicates
            if (!unassigned.includes(setId)) {
                unassigned.push(setId);
                await env.USERS.put('AD_SETS_UNASSIGNED', JSON.stringify(unassigned));
            }

            // 3. Update User
            user.ad_set_id = null;
            user.status = 'pending'; // Move back to pending

            // 4. Update Pending List
            let pendingList = [];
            try {
                const raw = await env.USERS.get('PENDING_USERS');
                if (raw) pendingList = JSON.parse(raw);
            } catch(e) {}

            // Avoid duplicates
            if (!pendingList.find(u => u.username === username)) {
                pendingList.push({
                    username: username,
                    email: user.email,
                    whatsapp: user.whatsapp,
                    date: new Date().toISOString()
                });
                await env.USERS.put('PENDING_USERS', JSON.stringify(pendingList));
            }

            message = 'User unlinked from Ad Set and moved to Pending';
            await logSystemAction(env, 'UNLINK_AD_SET', `Unlinked ${username} from ${setId}`);
        } else {
            return new Response(JSON.stringify({ error: 'User has no ad set assigned' }), { status: 400, headers: CORS_HEADERS });
        }
    }
    else {
        return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS_HEADERS });
    }

    await env.USERS.put(username, JSON.stringify(user));
    return new Response(JSON.stringify({ message, user }), { status: 200, headers: CORS_HEADERS });
}

async function handleAdSets(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });

    if (request.method === 'GET') {
        let index = [];
        try {
            const raw = await env.USERS.get('AD_SETS_INDEX');
            if (raw) index = JSON.parse(raw);
        } catch(e) {}

        const sets = await Promise.all(index.map(async id => {
            const raw = await env.USERS.get(`ADSET:${id}`);
            return raw ? JSON.parse(raw) : null;
        }));

        return new Response(JSON.stringify(sets.filter(s => s)), { status: 200, headers: CORS_HEADERS });
    }
    else if (request.method === 'POST') {
        const data = await request.json();

        const id = 'SET-' + crypto.randomUUID().split('-')[0].toUpperCase();
        const newSet = {
            id: id,
            created_at: new Date().toISOString(),
            assigned_to: null,
            popunder: data.popunder,
            inpage: data.inpage,
            direct: data.direct,
            push: data.push
        };

        await env.USERS.put(`ADSET:${id}`, JSON.stringify(newSet));

        let index = [];
        try {
            const raw = await env.USERS.get('AD_SETS_INDEX');
            if (raw) index = JSON.parse(raw);
        } catch(e) {}
        index.push(id);
        await env.USERS.put('AD_SETS_INDEX', JSON.stringify(index));

        let unassigned = [];
        try {
            const raw = await env.USERS.get('AD_SETS_UNASSIGNED');
            if (raw) unassigned = JSON.parse(raw);
        } catch(e) {}
        unassigned.push(id);
        await env.USERS.put('AD_SETS_UNASSIGNED', JSON.stringify(unassigned));

        return new Response(JSON.stringify({ message: 'Ad Set created', id: id }), { status: 201, headers: CORS_HEADERS });
    }
}

async function handleReconcile(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });

    const { date, approvals } = await request.json();
    // approvals: [{ username, breakdown: {popunder:..., inpage:...}, total: ... }]

    if (!approvals || !Array.isArray(approvals) || !date) {
        return new Response(JSON.stringify({ error: 'Invalid data (approvals array and date required)' }), { status: 400, headers: CORS_HEADERS });
    }

    let count = 0;
    const stats = await getGlobalStats(env);

    for (const item of approvals) {
        if (!item.username || item.total === undefined) continue;

        const raw = await env.USERS.get(item.username);
        if (raw) {
            const user = JSON.parse(raw);
            const amt = parseFloat(item.total);

            // Update Main Balance
            user.balance = parseFloat(((user.balance || 0) + amt).toFixed(2));

            // Logic: Deduct the *Pending* amount for that day from balance_pending.
            // This prevents "double dipping" or orphaned pending amounts.
            if (!user.daily_stats) user.daily_stats = {};
            if (user.daily_stats[date]) {
                const pendingForDay = user.daily_stats[date].total_pending || 0;
                user.balance_pending = parseFloat(Math.max(0, (user.balance_pending || 0) - pendingForDay).toFixed(3));

                // Update stats entry to Approved status
                user.daily_stats[date].status = 'approved';
                user.daily_stats[date].total_approved = amt;

                // Update granular breakdown
                if (item.breakdown) {
                    ['popunder', 'inpage', 'direct', 'push'].forEach(t => {
                        if (user.daily_stats[date][t]) {
                            user.daily_stats[date][t].approved = item.breakdown[t] || 0;
                        } else {
                            user.daily_stats[date][t] = { pending: 0, approved: item.breakdown[t] || 0 };
                        }
                    });
                }
            } else {
                // If no stats exist for that day (maybe manual/external), just create entry
                user.daily_stats[date] = {
                    status: 'approved',
                    total_approved: amt,
                    total_pending: 0,
                    popunder: { pending: 0, approved: item.breakdown?.popunder || 0 },
                    inpage: { pending: 0, approved: item.breakdown?.inpage || 0 },
                    direct: { pending: 0, approved: item.breakdown?.direct || 0 },
                    push: { pending: 0, approved: item.breakdown?.push || 0 }
                };
            }

            await env.USERS.put(item.username, JSON.stringify(user));

            // Add to Liability
            stats.liability = parseFloat((stats.liability + amt).toFixed(2));
            count++;
        }
    }

    await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
    return new Response(JSON.stringify({ message: `Reconciled ${count} users for ${date}` }), { status: 200, headers: CORS_HEADERS });
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
    else if (action === 'set_motd') {
        await env.USERS.put('SYSTEM:MOTD', String(value));
        return new Response(JSON.stringify({ message: 'MOTD updated' }), { status: 200, headers: CORS_HEADERS });
    }
    else if (action === 'get_logs') {
        let logs = [];
        try { const r = await env.USERS.get('SYSTEM:LOGS'); if(r) logs = JSON.parse(r); } catch(e){}
        return new Response(JSON.stringify({ logs }), { status: 200, headers: CORS_HEADERS });
    }
    else if (action === 'get_history') {
        let history = [];
        try { const r = await env.USERS.get('SYSTEM:HISTORY_30_DAYS'); if(r) history = JSON.parse(r); } catch(e){}
        return new Response(JSON.stringify({ history }), { status: 200, headers: CORS_HEADERS });
    }
    else if (action === 'approve_all_pending') {
        let pending = [];
        try { const r = await env.USERS.get('PENDING_USERS'); if(r) pending = JSON.parse(r); } catch(e){}

        let unassigned = [];
        try { const r = await env.USERS.get('AD_SETS_UNASSIGNED'); if(r) unassigned = JSON.parse(r); } catch(e){}

        let approvedCount = 0;
        const LIMIT = 20; // Safety limit per request

        // Process batch
        const toProcess = pending.slice(0, LIMIT);

        for (const pUser of toProcess) {
            if (unassigned.length === 0) break;

            const username = pUser.username;
            const userJson = await env.USERS.get(username);
            if (userJson) {
                const user = JSON.parse(userJson);
                if (user.status === 'pending') {
                    const setId = unassigned.shift();
                    user.ad_set_id = setId;
                    user.status = 'active';

                    // Update Ad Set
                    const setKey = `ADSET:${setId}`;
                    const rawSet = await env.USERS.get(setKey);
                    if (rawSet) {
                        const adSet = JSON.parse(rawSet);
                        adSet.assigned_to = username;
                        await env.USERS.put(setKey, JSON.stringify(adSet));
                    }

                    await env.USERS.put(username, JSON.stringify(user));
                    approvedCount++;
                }
            }
        }

        const newPending = pending.slice(approvedCount);
        await env.USERS.put('PENDING_USERS', JSON.stringify(newPending));
        await env.USERS.put('AD_SETS_UNASSIGNED', JSON.stringify(unassigned));

        await logSystemAction(env, 'BULK_APPROVE', `Approved ${approvedCount} users`);
        return new Response(JSON.stringify({ message: `Approved ${approvedCount} users`, remaining: newPending.length }), { status: 200, headers: CORS_HEADERS });
    }
    else if (action === 'freeze_red_zone') {
        let redZone = [];
        try { const r = await env.USERS.get('RED_ZONE_USERS'); if(r) redZone = JSON.parse(r); } catch(e){}

        let count = 0;
        for (const item of redZone) {
            const userJson = await env.USERS.get(item.username);
            if (userJson) {
                const user = JSON.parse(userJson);
                if (!user.is_frozen) {
                    user.is_frozen = true;
                    await env.USERS.put(item.username, JSON.stringify(user));
                    count++;
                }
            }
        }
        await logSystemAction(env, 'BULK_FREEZE', `Frozen ${count} red zone users`);
        return new Response(JSON.stringify({ message: `Frozen ${count} users` }), { status: 200, headers: CORS_HEADERS });
    }
    else return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: CORS_HEADERS });

    await env.USERS.put('GLOBAL_STATS', JSON.stringify(stats));
    return new Response(JSON.stringify({ message: 'System updated', status: stats.system_status }), { status: 200, headers: CORS_HEADERS });
}

async function handleDismissMessage(request, env) {
    const { username, token } = await request.json();
    const userJson = await env.USERS.get(username);
    if (!userJson) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: CORS_HEADERS });
    const user = JSON.parse(userJson);
    if (user.token !== token) return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 403, headers: CORS_HEADERS });

    user.personal_message = null;
    await env.USERS.put(username, JSON.stringify(user));
    return new Response(JSON.stringify({ message: 'Message dismissed' }), { status: 200, headers: CORS_HEADERS });
}

async function handleSystemConfig(request, env) {
    const secret = request.headers.get('X-Admin-Secret');
    if (secret !== env.ADMIN_SECRET) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 403, headers: CORS_HEADERS });

    if (request.method === 'GET') {
        const config = await getConfig(env);
        return new Response(JSON.stringify(config), { status: 200, headers: CORS_HEADERS });
    } else if (request.method === 'POST') {
        const newConfig = await request.json();
        const merged = { ...DEFAULT_CONFIG, ...newConfig };
        await env.USERS.put('SYSTEM:CONFIG', JSON.stringify(merged));
        await logSystemAction(env, 'CONFIG_UPDATE', 'System configuration updated');
        return new Response(JSON.stringify({ message: 'Configuration saved', config: merged }), { status: 200, headers: CORS_HEADERS });
    }
}

async function handleGetSystemStatus(request, env) {
    const stats = await getGlobalStats(env);
    let motd = null;
    try { motd = await env.USERS.get('SYSTEM:MOTD'); } catch(e){}

    return new Response(JSON.stringify({
        system_status: stats.system_status,
        motd: motd
    }), { status: 200, headers: CORS_HEADERS });
}
