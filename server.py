import http.server
import socketserver
import json
import os

PORT = 8081
DIRECTORY = "src"

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/":
            self.path = "/index.html"

        if self.path == "/user":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"username": "testuser", "points": 10}).encode())
            return

        # Check if file exists in src
        file_path = os.path.join(DIRECTORY, self.path.lstrip("/"))
        if os.path.exists(file_path):
             self.send_response(200)
             # Determine content type
             if file_path.endswith(".html"):
                 self.send_header("Content-type", "text/html")
             elif file_path.endswith(".js"):
                 self.send_header("Content-type", "application/javascript")
             elif file_path.endswith(".css"):
                 self.send_header("Content-type", "text/css")

             self.send_header("Access-Control-Allow-Origin", "*")
             self.end_headers()

             with open(file_path, 'rb') as f:
                 self.wfile.write(f.read())
             return
        else:
             self.send_error(404)

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)

        response = {"success": True}
        if self.path == "/login":
            response["token"] = "mock-token"
            response["points"] = 0
        elif self.path == "/add-points":
            response["points"] = 20

        self.send_response(200)
        self.send_header("Content-type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print("serving at port", PORT)
    httpd.serve_forever()
