# My Ride Money

My Ride Money is a private, offline-first shift tracker for rideshare, delivery, and other driving work. Record shift times, odometer readings, earnings, and expenses; the app calculates gross pay, take-home pay, hours, miles, and take-home rates per hour and mile.

The app uses plain HTML, CSS, and JavaScript with no framework, build step, external dependencies, backend, account, analytics, or cloud storage. Settings, an active shift, and up to 500 completed shifts are stored in browser `localStorage`. CSV and JSON backup exports are generated locally.

## Run locally

Serve the repository over HTTP so its service worker can register:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000/>. If another service worker was previously installed on that exact origin, use a fresh port or clear that origin’s site data before testing.

## Deploy with GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select `main` and `/ (root)`, then save.

Every runtime path is relative, so the app works at `/myridemoney-site/` and from any local static-server root.

## Install on iPhone

1. Open the deployed site in Safari while online.
2. Tap **Share → Add to Home Screen**.
3. Enable **Open as Web App** if shown and tap **Add**.
4. Open the app once from the Home Screen while online so the app shell is cached.

After the first successful online load, the tracker opens and works offline. Export a backup before clearing browser data or moving devices.

## Updating the offline cache

`service-worker.js` precaches every required app asset. Whenever any static file changes, increment `CACHE_NAME` (for example, `my-ride-money-v1` to `my-ride-money-v2`) before deployment so installed copies receive the update.
