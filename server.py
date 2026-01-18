import http.server
import socketserver
import json
import os
import hashlib
import uuid
from urllib.parse import urlparse, parse_qs

PORT = 8000
KV_STORE = {} # In-memory "Cloudflare KV"

def set_cors_headers(handler):
    handler.send_header('Access-Control-Allow-Origin', '*')
    handler.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    handler.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        set_cors_headers(self)
        self.end_headers()

    def do_GET(self):
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # Serve index.html for root
        if path == '/' or path == '/index.html' or path == '/src/index.html':
            try:
                with open('index.html', 'rb') as f:
                    content = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html')
                self.end_headers()
                self.wfile.write(content)
                return
            except FileNotFoundError:
                self.send_error(404, "File not found")
                return

        # API Routes
        if path == '/user':
            self.handle_get_user(parsed_path)
        elif path == '/certificate':
            self.handle_get_cert(parsed_path)
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        body = self.rfile.read(content_length)
        data = json.loads(body)

        parsed_path = urlparse(self.path)
        path = parsed_path.path

        if path == '/register':
            self.handle_register(data)
        elif path == '/login':
            self.handle_login(data)
        elif path == '/add-points':
            self.handle_add_points(data)
        elif path == '/redeem':
            self.handle_redeem(data)
        elif path == '/mark-cert-paid':
            self.handle_mark_cert_paid(data)
        else:
            self.send_error(404, "Not Found")

    def send_json(self, status, data):
        self.send_response(status)
        set_cors_headers(self)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

    # --- Handlers ---

    def handle_register(self, data):
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return self.send_json(400, {'error': 'Missing username or password'})

        if username in KV_STORE:
            return self.send_json(409, {'error': 'Username already taken'})

        # Hash password (simple simulation)
        pw_hash = hashlib.sha256(password.encode()).hexdigest()

        KV_STORE[username] = {
            'passwordHash': pw_hash,
            'points': 0,
            'created_at': 'now'
        }
        self.send_json(201, {'message': 'User registered successfully'})

    def handle_login(self, data):
        username = data.get('username')
        password = data.get('password')

        user = KV_STORE.get(username)
        if not user:
            return self.send_json(404, {'error': 'User not found'})

        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        if user.get('passwordHash') != pw_hash:
             return self.send_json(401, {'error': 'Invalid credentials'})

        token = str(uuid.uuid4())
        user['token'] = token
        KV_STORE[username] = user # Save token

        self.send_json(200, {'message': 'Login successful', 'points': user['points'], 'token': token})

    def handle_add_points(self, data):
        username = data.get('username')
        token = data.get('token')
        amount = int(data.get('amount', 10))

        user = KV_STORE.get(username)
        if not user:
            return self.send_json(404, {'error': 'User not found'})

        if user.get('token') != token:
             return self.send_json(403, {'error': 'Unauthorized: Invalid token'})

        user['points'] += amount
        KV_STORE[username] = user
        self.send_json(200, {'message': 'Points added', 'points': user['points']})

    def handle_get_user(self, parsed_path):
        qs = parse_qs(parsed_path.query)
        username = qs.get('username', [None])[0]

        user = KV_STORE.get(username)
        if not user:
             return self.send_json(404, {'error': 'User not found'})

        self.send_json(200, {'username': username, 'points': user['points']})

    def handle_redeem(self, data):
        username = data.get('username')
        token = data.get('token')

        user = KV_STORE.get(username)
        if not user or user.get('token') != token:
            return self.send_json(403, {'error': 'Unauthorized'})

        if user['points'] < 20:
            return self.send_json(400, {'error': 'Not enough points'})

        user['points'] -= 20
        KV_STORE[username] = user

        cert_id = f"CERT-{uuid.uuid4().hex[:8].upper()}"
        KV_STORE[f"CERT:{cert_id}"] = {
            'id': cert_id,
            'username': username,
            'date': 'now',
            'status': 'issued'
        }

        self.send_json(200, {'message': 'Redeemed', 'points': user['points'], 'cert_id': cert_id})

    def handle_get_cert(self, parsed_path):
        qs = parse_qs(parsed_path.query)
        cert_id = qs.get('id', [None])[0]

        cert = KV_STORE.get(f"CERT:{cert_id}")
        if not cert:
            return self.send_json(404, {'error': 'Certificate not found'})

        self.send_json(200, cert)

    def handle_mark_cert_paid(self, data):
        cert_id = data.get('id')
        admin_secret = data.get('admin_secret')

        if admin_secret != 'admin-secret-123':
             return self.send_json(403, {'error': 'Unauthorized'})

        cert_key = f"CERT:{cert_id}"
        cert = KV_STORE.get(cert_key)

        if not cert:
            return self.send_json(404, {'error': 'Certificate not found'})

        cert['status'] = 'paid'
        KV_STORE[cert_key] = cert

        self.send_json(200, {'message': 'Marked as paid', 'cert': cert})

print(f"Starting local server on port {PORT}")
http.server.HTTPServer(("", PORT), Handler).serve_forever()
