# StudioSpace Backend API

The backend service for **StudioSpace**, a peer-to-peer creative workspace and production studio sharing platform. It provides REST APIs for studio discovery and management, customer bookings, owner booking management, authentication verification, and studio reviews.

## 🌐 Live Deployment

| Resource | URL |
|---|---|
| Backend API | https://studiospace-server-l4bg.onrender.com |
| API Health Check | https://studiospace-server-l4bg.onrender.com/api/health |
| Frontend Website | https://studiospace-client-one.vercel.app/ |
| Frontend Repository | https://github.com/sajidraian/studiospace-client |

## ✨ Features

- RESTful API built with Express 5 and TypeScript.
- MongoDB Atlas integration using the official MongoDB Node.js driver.
- JWT verification using Better Auth's remote JWKS endpoint.
- HTTPOnly cookie-based authentication through the `studio_auth_token` cookie.
- Public studio discovery, featured studios, search, category filtering, and pagination.
- Authenticated studio creation, update, listing ownership, and deletion.
- Customer booking requests and paginated booking history.
- Studio-owner booking management and confirmation.
- Booking cancellation for customers.
- Prevention of overlapping confirmed bookings, including transaction-based locking during confirmation.
- Studio reviews and ratings, limited to eligible completed bookings.
- Request validation and consistent JSON responses.
- Security headers with Helmet, credentialed CORS, and API/booking rate limits.
- MongoDB indexes for common queries and booking/review consistency.

## 🛠️ Tech Stack

- Node.js
- Express.js 5
- TypeScript
- MongoDB Atlas
- MongoDB Node.js Driver
- Better Auth JWT / JOSE
- Cookie Parser
- Helmet
- CORS
- Express Rate Limit
- dotenv

## 📁 Project Structure

```text
studiospace-server/
├── src/
│   ├── index.ts          # Express app, database connection and API routes
│   └── middleware.ts     # Better Auth JWT verification middleware
├── .env                  # Local environment variables (not committed)
├── package.json
├── package-lock.json
└── tsconfig.json
```

## 🚀 Installation and Setup

### Prerequisites

- Node.js 20 or later
- npm
- A MongoDB Atlas cluster (or compatible MongoDB deployment)
- The StudioSpace frontend configured with Better Auth

### 1. Clone the repository

```bash
git clone https://github.com/sajidraian/studiospace-server.git
cd studiospace-server
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=your_mongodb_connection_string
CLIENT_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000
```

Replace the example values with your own configuration.

| Variable | Description |
|---|---|
| `PORT` | Port used by the API. Defaults to `5000`. |
| `NODE_ENV` | Set to `development` locally and `production` when deployed. |
| `MONGODB_URI` | MongoDB connection string. Required. |
| `CLIENT_URL` | Allowed frontend origin for credentialed CORS requests. |
| `BETTER_AUTH_URL` | Base URL of the Better Auth frontend. Used to retrieve JWKS and verify token issuer/audience. |

For local development, the frontend and `BETTER_AUTH_URL` should use the same local origin. In production, set `CLIENT_URL` and `BETTER_AUTH_URL` to the deployed frontend origin. Keep all credentials and environment files private; never commit them to Git.

### 4. Run the development server

```bash
npm run dev
```

The API will run at `http://localhost:5000` unless another port is configured.

### 5. Build and run for production

```bash
npm run build
npm start
```

## 🔐 Authentication

Protected endpoints use the `verifyJWT` middleware.

1. The frontend authenticates users with Better Auth.
2. The frontend obtains a Better Auth JWT and stores it in the HTTPOnly `studio_auth_token` cookie.
3. The backend reads that cookie and verifies the JWT against the Better Auth JWKS endpoint at `<BETTER_AUTH_URL>/api/auth/jwks`.
4. The token's issuer and audience are checked against `BETTER_AUTH_URL`.
5. The authenticated user's ID, email, and name are attached to the request.

Requests to protected endpoints must include the authentication cookie. Do not expose tokens or secrets in client-side code, logs, screenshots, or source control.

## 🔌 API Reference

Base URL (local): `http://localhost:5000`

Base URL (production): `https://studiospace-server-l4bg.onrender.com`

### General and studio endpoints

| Method | Endpoint | Description | Access |
|---|---|---|---|
| GET | `/` | Basic server status | Public |
| GET | `/api/health` | API and MongoDB health check | Public |
| GET | `/api/studios` | List studios; supports `search`, `category`, `page`, and `limit` query parameters | Public |
| GET | `/api/featured-studios` | Get the latest featured studios | Public |
| GET | `/api/studios/:id` | Get studio details | Public |
| GET | `/api/studios/:id/reviews` | Get public reviews for a studio | Public |
| POST | `/api/studios` | Create a studio listing | Authenticated |
| GET | `/api/my-studios` | Get the signed-in owner's studio listings | Authenticated |
| PUT | `/api/studios/:id` | Update an owned studio listing | Authenticated owner |
| DELETE | `/api/studios/:id` | Delete an owned studio listing | Authenticated owner |

### Booking endpoints

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/api/bookings` | Submit a booking request | Authenticated customer |
| GET | `/api/my-bookings` | Get the current customer's bookings; supports `page` and `limit` | Authenticated customer |
| GET | `/api/owner-bookings` | Get bookings for the current studio owner; supports `page` and `limit` | Authenticated owner |
| PATCH | `/api/bookings/:id/cancel` | Cancel a pending booking | Booking customer |
| PATCH | `/api/bookings/:id/confirm` | Confirm a pending booking | Studio owner |

### Review endpoint

| Method | Endpoint | Description | Access |
|---|---|---|---|
| POST | `/api/reviews` | Submit a 1–5 star review for an eligible past confirmed booking | Authenticated booking customer |

### Health check example

```http
GET /api/health
```

A successful response returns HTTP `200` with `success: true` and `database: "connected"`. If the database ping fails, the endpoint returns HTTP `503`.

## 🛡️ Booking Conflict Prevention

Booking requests are checked against existing confirmed bookings for the same studio and date. When an owner confirms a pending booking, the backend performs the overlap check inside a MongoDB transaction and uses a unique booking-lock record to serialize confirmations for that studio and date. Conflicting confirmation attempts receive HTTP `409`.

**Deployment note:** Transaction-based booking confirmation requires a MongoDB deployment that supports transactions, such as a replica set or MongoDB Atlas cluster.

## ⚙️ Security and Reliability

- Helmet adds standard HTTP security headers.
- CORS allows the configured frontend origin and credentials.
- API requests are rate-limited to 100 requests per 15 minutes.
- Booking creation is additionally limited to 10 requests per 15 minutes.
- Protected operations verify the signed Better Auth JWT.
- Studio update/delete operations are restricted to the listing owner.
- Booking and review operations validate IDs, dates, times, ratings, and ownership.
- Environment files and credentials must remain private.

## 📜 Available Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server with file watching |
| `npm run build` | Compile TypeScript into the `dist/` directory |
| `npm start` | Run the compiled production server |

## 🔗 Related Project

- **Frontend:** [StudioSpace Client](https://github.com/sajidraian/studiospace-client)
- **Live Website:** [studiospace-client-one.vercel.app](https://studiospace-client-one.vercel.app/)
- **Live Backend:** [studiospace-server-l4bg.onrender.com](https://studiospace-server-l4bg.onrender.com)

---

**StudioSpace** — Peer-to-Peer Creative Workspace & Production Studio Sharing Platform.
