# Spyne OB Dashboard — Transfer & Setup Guide

## What's in this dump

```
spyne-dashboard-dump/
├── dashboard/
│   ├── index.html       ← The full dashboard (single file, ~450KB)
│   └── .gitignore
├── spyne-proxy.gs       ← Google Apps Script for live data refresh
└── SETUP.md             ← This file
```

---

## Step 1 — Install prerequisites on new MacBook

Open Terminal and run:

```bash
# Install Homebrew (if not already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Install Vercel CLI
npm install -g vercel

# Install Git (usually pre-installed on Mac)
git --version
```

---

## Step 2 — Set up the project folder

```bash
# Create project folder
mkdir -p ~/Onbaording_dashboard

# Copy dashboard file from this dump into it
cp /path/to/spyne-dashboard-dump/dashboard/index.html ~/Onbaording_dashboard/
cp /path/to/spyne-dashboard-dump/dashboard/.gitignore ~/Onbaording_dashboard/

cd ~/Onbaording_dashboard
```

---

## Step 3 — Connect to GitHub repo

```bash
cd ~/Onbaording_dashboard

git init
git remote add origin https://github.com/anshukumar-hash/Onbaording_dashboard.git

# Pull latest code (this fetches current production code from GitHub)
git fetch origin
git reset --hard origin/main
```

> You'll need GitHub credentials (username + personal access token).
> Generate a token at: https://github.com/settings/tokens → New token → select `repo` scope.

---

## Step 4 — Connect to Vercel

```bash
cd ~/Onbaording_dashboard

# Login to Vercel (opens browser)
vercel login

# Link to existing project
vercel link --project onbaording-dashboard --yes
```

When prompted, select team: **hey-s-projects4**

---

## Step 5 — Verify everything works

```bash
# Open dashboard locally in browser
open ~/Onbaording_dashboard/index.html
```

The dashboard opens directly in your browser — no server needed.

---

## Step 6 — How to deploy updates

Whenever you make changes or refresh data:

```bash
cd ~/Onbaording_dashboard

# Deploy to Vercel production
vercel --yes --prod
```

Live URL: https://onbaording-dashboard.vercel.app

---

## Step 7 — How to refresh dashboard data (embed new sheet data)

Run these commands to re-download the latest Google Sheets data and embed it:

```bash
# Download latest CSV from Google Sheets
curl -L "https://docs.google.com/spreadsheets/d/1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0/pub?gid=2053683245&single=true&output=csv" -o /tmp/vini_data.csv

curl -L "https://docs.google.com/spreadsheets/d/1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0/pub?gid=1134407178&single=true&output=csv" -o /tmp/amer_data.csv

curl -L "https://docs.google.com/spreadsheets/d/1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0/pub?gid=764039413&single=true&output=csv" -o /tmp/apac_data.csv

# Then run the Python embed script (ask Claude to regenerate this if needed)
python3 embed_data.py
```

> Alternatively, set up the Google Apps Script proxy (see spyne-proxy.gs) for automatic live refresh via the Refresh button in the dashboard.

---

## Google Apps Script (Live Refresh) Setup

1. Go to https://script.google.com → New Project
2. Paste contents of `spyne-proxy.gs`
3. Click **Deploy → New Deployment → Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web App URL
5. Open `index.html`, find `const APPS_SCRIPT_URL = '';` near the top
6. Paste the URL inside the quotes and save

---

## Key URLs

| Resource | URL |
|---|---|
| Live Dashboard | https://onbaording-dashboard.vercel.app |
| Vercel Project | https://vercel.com/hey-s-projects4/onbaording-dashboard |
| GitHub Repo | https://github.com/anshukumar-hash/Onbaording_dashboard |
| Google Sheet | https://docs.google.com/spreadsheets/d/1ioRrooOvDSBxc7gjC2XUGjqHH_YBze_2HryOF8JWqL0 |

---

## Credentials needed

| What | Where to get |
|---|---|
| GitHub token | https://github.com/settings/tokens |
| Vercel login | vercel.com (same Google/GitHub account) |
| Google Sheet access | Already public (published CSV) |
