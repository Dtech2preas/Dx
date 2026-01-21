import os
import json
import uuid
import datetime
import hashlib
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='.')
CORS(app)

# --- Mock KV Storage ---
KV = {
    "USERS": {},     # key: username, value: user_profile
    "CERTS": {},     # key: cert_id, value: cert_data
    "TREASURY": {    # Global Treasury Data
        "stats": {"paid": 0.0, "liability": 0.0, "month": datetime.datetime.now().strftime("%Y-%m")},
        "config": {"budget": 500.0, "halted": False}
    }
}
ADMIN_SECRET = "REPLACE_THIS_WITH_A_SECURE_SECRET"

# --- Helpers ---

def get_today_str():
    return datetime.datetime.now().strftime("%Y-%m-%d")

def get_current_month():
    return datetime.datetime.now().strftime("%Y-%m")

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def get_user(username):
    user_json = KV["USERS"].get(username)
    if not user_json:
        return None
    user = json.loads(user_json)

    # Daily Reset Check
    today = get_today_str()
    if user.get("last_reset_day") != today:
        user["ad_count"] = 0
        user["last_reset_day"] = today
        save_user(username, user)

    return user

def save_user(username, data):
    KV["USERS"][username] = json.dumps(data)

def get_treasury():
    data = KV["TREASURY"]
    # Monthly Reset Check
    current_month = get_current_month()
    if data["stats"]["month"] != current_month:
        data["stats"]["month"] = current_month
        data["stats"]["paid"] = 0.0
        # liability carries over
    return data

def save_treasury(data):
    KV["TREASURY"] = data

# --- Routes ---

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({"error": "Missing inputs"}), 400

    if KV["USERS"].get(username):
        return jsonify({"error": "Username taken"}), 409

    user_profile = {
        "passwordHash": hash_password(password),
        "created_at": datetime.datetime.now().isoformat(),
        "balance": 0.00,
        "ad_count": 0,
        "last_ad_ts": 0,
        "last_reset_day": get_today_str(),
        "history": []
    }

    save_user(username, user_profile)
    return jsonify({"message": "Registered successfully"}), 201

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')

    user = get_user(username)
    if not user:
        return jsonify({"error": "User not found"}), 404

    if user["passwordHash"] != hash_password(password):
        return jsonify({"error": "Invalid credentials"}), 401

    token = str(uuid.uuid4())
    user["token"] = token
    save_user(username, user)

    return jsonify({
        "message": "Login successful",
        "token": token,
        "balance": user["balance"]
    })

@app.route('/user', methods=['GET'])
def user_info():
    username = request.args.get('username')
    if not username:
        return jsonify({"error": "Missing username"}), 400

    user = get_user(username)
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify({
        "username": username,
        "balance": user["balance"],
        "history": user["history"]
    })

@app.route('/add-points', methods=['POST'])
def add_points():
    data = request.json
    username = data.get('username')
    token = data.get('token')

    user = get_user(username)
    if not user:
        return jsonify({"error": "User not found"}), 404

    if user.get("token") != token:
        return jsonify({"error": "Invalid token"}), 403

    # Check Budget
    treasury = get_treasury()
    potential_reward = 0.3 # Max possible
    total_liability = treasury["stats"]["paid"] + treasury["stats"]["liability"] + potential_reward

    if treasury["config"]["halted"] or (total_liability > treasury["config"]["budget"]):
        return jsonify({"error": "Daily limit reached or system paused."}), 503

    # Cooldown (30s)
    now_ts = datetime.datetime.now().timestamp() * 1000
    if (now_ts - user["last_ad_ts"]) < 30000:
        return jsonify({"error": "Cooldown active"}), 429

    # Calc Reward
    count = user["ad_count"] + 1
    import random
    def rand(min_val, max_val):
        return round(random.uniform(min_val, max_val), 3)

    if count <= 5:
        reward = rand(0.1, 0.3)
    elif count <= 10:
        reward = rand(0.1, 0.2) if random.random() < 0.7 else rand(0.2, 0.3)
    else:
        reward = rand(0.001, 0.05) if random.random() < 0.8 else rand(0.05, 0.1)

    # Update User
    user["balance"] = round(user["balance"] + reward, 2)
    user["ad_count"] = count
    user["last_ad_ts"] = now_ts
    save_user(username, user)

    # Update Treasury
    treasury["stats"]["liability"] = round(treasury["stats"]["liability"] + reward, 2)
    save_treasury(treasury)

    return jsonify({
        "message": "Points added",
        "balance": user["balance"],
        "earned": reward
    })

@app.route('/redeem', methods=['POST'])
def redeem():
    data = request.json
    username = data.get('username')
    token = data.get('token')
    amount = float(data.get('amount', 0))
    method = data.get('method')

    user = get_user(username)
    if not user: return jsonify({"error": "User not found"}), 404
    if user.get("token") != token: return jsonify({"error": "Invalid token"}), 403

    if amount < 10 or amount > 250:
        return jsonify({"error": "Invalid amount (10-250)"}), 400
    if user["balance"] < amount:
        return jsonify({"error": "Insufficient balance"}), 400

    fee_pct = 0.25 if method == 'Airtime' else 0.30 if method == 'Voucher' else 0.40 if method == 'Cash Send' else 0
    if fee_pct == 0: return jsonify({"error": "Invalid method"}), 400

    fee = round(amount * fee_pct, 2)
    payout = round(amount - fee, 2)

    # Update User
    user["balance"] = round(user["balance"] - amount, 2)
    cert_id = f"CERT-{str(uuid.uuid4()).split('-')[0].upper()}"
    date_str = datetime.datetime.now().isoformat()

    record = {
        "id": cert_id,
        "amount": amount,
        "payout": payout,
        "date": date_str,
        "status": "issued"
    }
    user["history"].insert(0, record)
    save_user(username, user)

    # Create Cert
    cert_data = {
        "id": cert_id,
        "username": username,
        "amount": amount,
        "fee": fee,
        "payout": payout,
        "method": method,
        "date": date_str,
        "status": "issued"
    }
    KV["CERTS"][cert_id] = json.dumps(cert_data)

    return jsonify({
        "message": "Redemption successful",
        "balance": user["balance"],
        "cert_id": cert_id
    })

@app.route('/certificate', methods=['GET'])
def get_cert():
    cert_id = request.args.get('id')
    cert_json = KV["CERTS"].get(cert_id)
    if not cert_json:
        return jsonify({"error": "Certificate not found"}), 404
    return cert_json, 200, {'Content-Type': 'application/json'}

@app.route('/mark-cert-paid', methods=['POST'])
def mark_paid():
    data = request.json
    if data.get('admin_secret') != ADMIN_SECRET:
        return jsonify({"error": "Unauthorized"}), 403

    cert_id = f"CERT:{data.get('id')}" if not data.get('id', '').startswith('CERT-') else data.get('id')
    # Fix ID mismatch in logic
    real_id = data.get('id')

    cert_json = KV["CERTS"].get(real_id)
    if not cert_json: return jsonify({"error": "Not found"}), 404

    cert = json.loads(cert_json)
    if cert["status"] == "paid": return jsonify({"error": "Already paid"}), 400

    cert["status"] = "paid"
    KV["CERTS"][real_id] = json.dumps(cert)

    # Update Treasury
    treasury = get_treasury()
    treasury["stats"]["liability"] = round(treasury["stats"]["liability"] - cert["amount"], 2)
    if treasury["stats"]["liability"] < 0: treasury["stats"]["liability"] = 0
    treasury["stats"]["paid"] = round(treasury["stats"]["paid"] + cert["amount"], 2)
    save_treasury(treasury)

    return jsonify({"message": "Marked paid", "cert": cert})

@app.route('/admin-stats', methods=['GET'])
def admin_stats():
    secret = request.headers.get('X-Admin-Secret')
    if secret != ADMIN_SECRET: return jsonify({"error": "Unauthorized"}), 403

    return jsonify(get_treasury())

@app.route('/admin/config', methods=['POST'])
def update_config():
    data = request.json
    if data.get('admin_secret') != ADMIN_SECRET: return jsonify({"error": "Unauthorized"}), 403

    treasury = get_treasury()
    treasury["config"].update(data.get('config', {}))
    save_treasury(treasury)

    return jsonify({"message": "Config updated", "config": treasury["config"]})

if __name__ == '__main__':
    print(f"Server running on http://localhost:8787")
    app.run(host='0.0.0.0', port=8787, debug=True)
