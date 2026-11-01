import { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Authenticated user-এর তথ্য রাখার জন্য Type
export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

// Better Auth configuration
const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || "http://localhost:3000";

// Better Auth JWKS endpoint
const JWKS = createRemoteJWKSet(
  new URL(`${BETTER_AUTH_URL}/api/auth/jwks`)
);

// JWT Verification Middleware
export async function verifyJWT(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    // HTTPOnly Cookie থেকে JWT নেওয়া
    const token = req.cookies?.studio_auth_token;
console.log("Cookie received:", !!token);
console.log("Cookies received:", Object.keys(req.cookies || {}));
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required. Please login.",
      });
    }

    // Verify JWT using Better Auth JWKS
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: BETTER_AUTH_URL,
      audience: BETTER_AUTH_URL,
    });
console.log("Verified JWT Payload:", payload);
    // Required user information যাচাই
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    // Authenticated user তথ্য সংরক্ষণ
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: typeof payload.name === "string" ? payload.name : "",
    };

    next();
  } catch (error) {
    console.error("JWT Verification Error:", error);

    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token.",
    });
  }
}