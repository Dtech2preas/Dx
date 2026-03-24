import re

with open('src/worker.js', 'r') as f:
    content = f.read()

# 1. Update CORS
cors_code = """function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "";

  // Check if it's one of the allowed domains
  if (
    origin.endsWith(".dtech-services.co.za") ||
    origin.endsWith(".preasx24.co.za") ||
    origin === "https://student.dtech-services.co.za"
  ) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
    };
  }

  // Default fallback for other requests (or you can restrict it further if needed)
  return {
    'Access-Control-Allow-Origin': 'https://student.dtech-services.co.za',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
  };
}"""

content = re.sub(
    r"const CORS_HEADERS = \{[^}]+\};",
    cors_code,
    content,
    flags=re.MULTILINE
)

# Replace CORS_HEADERS usage in fetch block
content = re.sub(
    r"return new Response\((.*?), \{ headers: CORS_HEADERS \}\);",
    r"return new Response(\1, { headers: getCorsHeaders(request) });",
    content
)
content = re.sub(
    r"return new Response\((.*?), \{ status: (\d+), headers: CORS_HEADERS \}\);",
    r"return new Response(\1, { status: \2, headers: getCorsHeaders(request) });",
    content
)

# 2. Add routing logic for /redeem-voucher and /verify-payment
routing_code = """      } else if (path === '/redeem-voucher' && request.method === 'POST') {
        return await handleRedeemVoucher(request, env);
      } else if (path === '/verify-payment' && request.method === 'POST') {
        return await handleVerifyPayment(request, env);
      } else if (path === '/user' && request.method === 'GET') {"""

content = content.replace("      } else if (path === '/user' && request.method === 'GET') {", routing_code)

# 3. Add the handlers
handlers_code = """
async function handleRedeemVoucher(request, env) {
  try {
    const { voucher, amount, order_id } = await request.json();

    if (!voucher || !amount || !order_id) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: getCorsHeaders(request) });
    }

    const amountR = parseFloat(amount);

    const voucherKey = `VOUCHER:${voucher}`;
    const voucherJson = await env.USERS.get(voucherKey);

    if (!voucherJson) {
        return new Response(JSON.stringify({ error: 'Invalid voucher code' }), { status: 404, headers: getCorsHeaders(request) });
    }

    const voucherData = JSON.parse(voucherJson);

    if (voucherData.is_used) {
        return new Response(JSON.stringify({ error: 'Voucher has already been used' }), { status: 400, headers: getCorsHeaders(request) });
    }

    if (parseFloat(voucherData.worth) !== amountR) {
        return new Response(JSON.stringify({ error: 'Voucher value does not match the exact requested amount' }), { status: 400, headers: getCorsHeaders(request) });
    }

    // Mark as used
    voucherData.is_used = true;
    voucherData.used_at = new Date().toISOString();
    voucherData.order_id = order_id;
    await env.USERS.put(voucherKey, JSON.stringify(voucherData));

    // Generate Verification Token
    const secureToken = crypto.randomUUID();
    const tokenData = {
        token: secureToken,
        order_id: order_id,
        amount: amountR,
        voucher: voucher,
        created_at: new Date().toISOString(),
        is_verified: false
    };

    // Store the token (valid for some time, e.g. 1 hour)
    await env.USERS.put(`VERIFY_TOKEN:${secureToken}`, JSON.stringify(tokenData));

    await logSystemAction(env, 'VOUCHER_REDEEMED', `Voucher ${voucher} redeemed for order ${order_id} (Amount: R${amountR})`);

    return new Response(JSON.stringify({
        success: true,
        token: secureToken
    }), { status: 200, headers: getCorsHeaders(request) });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: getCorsHeaders(request) });
  }
}

async function handleVerifyPayment(request, env) {
  try {
    const { token, order_id } = await request.json();

    if (!token || !order_id) {
        return new Response(JSON.stringify({ error: 'Missing token or order_id' }), { status: 400, headers: getCorsHeaders(request) });
    }

    const tokenKey = `VERIFY_TOKEN:${token}`;
    const tokenJson = await env.USERS.get(tokenKey);

    if (!tokenJson) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 404, headers: getCorsHeaders(request) });
    }

    const tokenData = JSON.parse(tokenJson);

    if (tokenData.order_id !== order_id) {
        return new Response(JSON.stringify({ error: 'Order ID mismatch' }), { status: 400, headers: getCorsHeaders(request) });
    }

    if (tokenData.is_verified) {
        return new Response(JSON.stringify({ error: 'Token has already been verified' }), { status: 400, headers: getCorsHeaders(request) });
    }

    // Mark token as verified
    tokenData.is_verified = true;
    tokenData.verified_at = new Date().toISOString();
    await env.USERS.put(tokenKey, JSON.stringify(tokenData));

    return new Response(JSON.stringify({
        valid: true,
        amount: tokenData.amount
    }), { status: 200, headers: getCorsHeaders(request) });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: getCorsHeaders(request) });
  }
}

// --- Helpers ---"""

content = content.replace("// --- Helpers ---", handlers_code)

with open('src/worker.js', 'w') as f:
    f.write(content)
