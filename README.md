# LessMissed

**A three-sided marketplace for usability intelligence.**

LessMissed connects brands who need real user behavior data with consumers who browse naturally and earn rewards. It collects five behavioral signals — gaze, click, scroll, hover, and visibility — and transforms them into actionable UX insights through an engagement scoring engine.

---

## What's in this repo

```
LESSMISSED/
├── Web-App/lessmissed/       # Next.js dashboard & API
└── lessmissed_extension/     # Chrome browser extension
```

---

## Web App

**Stack:** Next.js 16 · React 19 · MongoDB (Mongoose) · AWS S3 · Tailwind CSS 4

The web app serves three audiences:

| Layer | Who | What they do |
|-------|-----|--------------|
| Marketing | Anyone | Landing page, sign-up |
| Client Dashboard | Brands / UX teams | Create projects, configure pages, launch tasks, view insights |
| Consumer App | Extension users | Browse tasks, earn coupons/rewards |

### Routes

```
app/
├── (marketing)/      # Public landing pages
├── (auth)/           # Login / register
├── dashboard/
│   ├── projects/     # Project & page management
│   ├── tasks/        # Task creation and tracking
│   ├── coupons/      # Reward management
│   └── setup/        # Onboarding
└── api/
    ├── auth/
    ├── projects/
    ├── tasks/
    ├── coupons/
    └── extension/    # Endpoints consumed by the Chrome extension
```

### Getting started

```bash
cd Web-App/lessmissed
npm install
cp .env.example .env.local   # fill in MONGODB_URI, AWS credentials, etc.
npm run dev                  # http://localhost:3000
```

---

## Chrome Extension

**Stack:** TypeScript · React 17 · Webpack 5

The extension runs in the consumer's browser and captures behavioral signals from pages configured by clients.

| Component | Role |
|-----------|------|
| `contentScript.ts` | Injected into tracked pages — collects gaze, click, scroll, hover, and visibility events |
| `background.ts` | Service worker — batches and sends data to the API |
| `popup/` | Extension UI — shows active tasks and status |
| `options/` | Settings page |

### Getting started

```bash
cd lessmissed_extension
npm install

# Development (watch mode)
npm start

# Production build
npm run build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

> Full build instructions: [lessmissed_extension/EXTENSION_BUILD.md](lessmissed_extension/EXTENSION_BUILD.md)

---

## Data signals

LessMissed collects five behavioral signals per page visit:

- **Gaze** — eye-tracking heatmaps (where users look)
- **Click** — tap and click positions
- **Scroll** — scroll depth and velocity
- **Hover** — cursor dwell time per element
- **Visibility** — which elements entered the viewport and for how long

These signals feed an **Engagement Score** engine that outputs 23 insight types — from attention hotspots to drop-off predictions.

---

## Environment variables

Both packages require environment configuration. Neither `.env` nor `.env.local` files are committed to this repo.

**Web App** (`.env.local`):

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `NEXTAUTH_SECRET` | Auth session secret |
| `AWS_ACCESS_KEY_ID` | S3 credentials for screenshot storage |
| `AWS_SECRET_ACCESS_KEY` | S3 credentials |
| `AWS_REGION` | S3 region |
| `S3_BUCKET_NAME` | Bucket for gaze plot screenshots |

---

## License

Private — all rights reserved.
