StudioSpace Backend API

StudioSpace is a peer-to-peer creative workspace and production studio sharing platform. This repository contains the backend API used by the StudioSpace frontend to manage studio listings, user bookings, and related data.

🌐 Deployment

Backend API: https://studiospace-server-l4bg.onrender.com

Frontend Website: https://studiospace-client-one.vercel.app/

Frontend Repository: https://github.com/sajidraian/studiospace-client

✨ Backend Features

RESTful API built with Express.js and TypeScript.

MongoDB Atlas database integration.

JWT-based authentication using Better Auth tokens.

HTTPOnly cookie-based authentication support through the frontend.

Protected studio management operations.

Studio listing retrieval and management.

Booking creation and booking history retrieval.

Booking cancellation for customers.

Booking confirmation for studio owners.

Prevention of overlapping confirmed bookings.

Input validation and structured JSON responses.

CORS configuration for frontend-backend communication.

🛠️ Technology Stack

Node.js

Express.js

TypeScript

MongoDB Atlas

MongoDB Node.js Driver

JWT

Better Auth

dotenv

📦 Installation and Setup

Prerequisites

Node.js 20 or later

npm

MongoDB Atlas account

1. Clone the Repository

git clone https://github.com/sajidraian/studiospace-server.git

2. Navigate to the Server Directory

cd studiospace-server

3. Install Dependencies

npm install

4. Configure Environment Variables

Create a .env file in the server project root. Add the variables required by your server configuration:

PORT=5000
NODE_ENV=development

MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret

CLIENT_URL=http://localhost:3000
BETTER_AUTH_URL=http://localhost:3000

Replace the placeholder values with your actual local configuration. Keep .env out of version control and never publish secrets.

5. Run the Development Server

Use the development script configured in package.json. For example:

npm run dev

If your project uses a different script name, use the matching script from package.json.

🔌 API Overview

The API provides endpoints for studio listings and bookings. The following booking endpoints are implemented:

Method

Endpoint

Description

Authentication

POST

/api/bookings

Submit a booking request

Required

GET

/api/my-bookings

Get the current customer's bookings

Required

PATCH

/api/bookings/:id/cancel

Cancel a pending booking

Required

PATCH

/api/bookings/:id/confirm

Confirm a pending booking as the studio owner

Required

The API also includes studio-related endpoints used by the frontend for exploring and managing studio listings.

❤️ Health Check

The deployed API provides a health-check endpoint:

GET /

A successful response indicates that the API is running and the database connection is available.

🔐 Security Notes

Protected endpoints require a valid authenticated session/token.

Do not commit .env files or publish database credentials, JWT secrets, or OAuth secrets.

Configure CLIENT_URL and BETTER_AUTH_URL to match the frontend environment when deploying.

Use HTTPS for production deployments.

📁 Related Repository

Frontend: https://github.com/sajidraian/studiospace-client

Live Website: https://studiospace-client-one.vercel.app/

Project: StudioSpace — Peer-to-Peer Creative Workspace & Production Studio Sharing Platform
