# Ad Watcher Rewards System

This project allows students to earn points by watching ads (tracked via tab visibility) and redeem them for a certificate.

## Architecture

*   **Frontend (`src/index.html`):**
    *   A single-page app that handles Login, Ad Tracking, and Certificate Generation.
    *   Designed to be hosted on GitHub Pages or any static host.
*   **Backend (`src/worker.js`):**
    *   A Cloudflare Worker script.
    *   Handles User Registration, Login, and Points Storage.
    *   Uses Cloudflare KV (Key-Value Storage) to persist user data.

## Setup Instructions

### 1. Backend (Cloudflare)

1.  **Create a Worker:**
    *   Log in to your Cloudflare Dashboard -> Workers.
    *   Create a new Service (Worker).
    *   Copy the content of `src/worker.js` and paste it into the Worker editor (replacing the default code).
    *   Save and Deploy.

2.  **Setup Database (KV Namespace):**
    *   In the Cloudflare Dashboard -> Workers -> KV, create a new Namespace named `USERS_KV`.
    *   Go to your Worker's **Settings** -> **Variables**.
    *   Under **KV Namespace Bindings**, add a binding:
        *   **Variable name:** `USERS` (Must be exactly this).
        *   **KV Namespace:** Select the `USERS_KV` you just created.
    *   Save and Deploy.

3.  **Get the URL:**
    *   Copy your Worker's URL (e.g., `https://your-worker.your-name.workers.dev`).

### 2. Frontend (GitHub Pages)

1.  **Update Config:**
    *   Open `src/index.html`.
    *   Find the line `const API_URL = "http://localhost:8000";`.
    *   Replace `"http://localhost:8000"` with your **Cloudflare Worker URL** from the previous step.
    *   (Optional) You can also update `AD_LINK` if you change ad providers.

2.  **Deploy:**
    *   Commit and push this code to GitHub.
    *   Go to your Repository Settings -> Pages.
    *   Select the `main` branch and the `/src` folder (or root, depending on where you put it).
    *   Your site will be live!

## How it Works
1.  User Registers/Logins.
2.  User clicks "Watch Ad".
3.  A new tab opens with the ad.
4.  The user must stay on the ad tab for **at least 15 seconds**.
5.  When they return to the app tab, the points are awarded automatically.
6.  Once they reach 100 points, they can download the "Certificate of Worthy".
