import dns from "node:dns";
import helmet from "helmet";
import { ObjectId } from "mongodb";
import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { MongoClient } from "mongodb";
import rateLimit from "express-rate-limit";
import { verifyJWT, AuthRequest } from "./middleware.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dotenv.config();

const app = express();
// Render runs Express behind a reverse proxy and forwards the client IP.
// Trust the single proxy hop so express-rate-limit can identify clients correctly.
app.set("trust proxy", 1);
app.use(helmet());

const PORT = process.env.PORT || 5000;

// ==========================================
// Rate Limiters
// ==========================================

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests. Please try again later.",
  },
});

const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many booking requests. Please try again later.",
  },
});

// ==========================================
// Middleware
// ==========================================

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use("/api", apiLimiter);

// ==========================================
// MongoDB Connection
// ==========================================

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is missing from .env file");
}

const client = new MongoClient(MONGODB_URI);

let db: ReturnType<typeof client.db>;

async function connectDatabase() {
  await client.connect();

  db = client.db("studiospace");

  // Studio indexes
  await db.collection("studios").createIndex({ createdAt: -1 });
  await db.collection("studios").createIndex({ ownerEmail: 1 });
  await db.collection("studios").createIndex({ category: 1 });

  // Booking indexes
  await db.collection("bookings").createIndex({
    customerEmail: 1,
    createdAt: -1,
  });

  await db.collection("bookings").createIndex({
    ownerEmail: 1,
    createdAt: -1,
  });

  await db.collection("bookings").createIndex({
    studioId: 1,
    bookingDate: 1,
    status: 1,
  });

  // Newsletter subscribers: prevent duplicate email registrations
  await db.collection("newsletterSubscribers").createIndex({ email: 1 }, { unique: true });

  // Review indexes: one review per completed booking
  await db.collection("reviews").createIndex({ bookingId: 1 }, { unique: true });
  await db.collection("reviews").createIndex({ studioId: 1, createdAt: -1 });

  // Booking confirmation lock index
  await db.collection("bookingLocks").createIndex(
    { lockKey: 1 },
    { unique: true }
  );

  console.log("MongoDB Connected Successfully!");
  console.log("Database indexes created successfully!");
}

// ==========================================
// Server Test Route
// ==========================================

app.get("/", (req: Request, res: Response) => {
  res.send("StudioSpace Server is Running!");
});

// ==========================================
// Health Check API
// ==========================================

app.get("/api/health", async (req: Request, res: Response) => {
  try {
    await db.command({ ping: 1 });

    return res.status(200).json({
      success: true,
      message: "StudioSpace API is healthy!",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Health Check Failed:", error);

    return res.status(503).json({
      success: false,
      message: "StudioSpace API is unavailable.",
      database: "disconnected",
      timestamp: new Date().toISOString(),
    });
  }
});

// ==========================================
// Newsletter Subscription
// ==========================================

app.post("/api/newsletter", async (req: Request, res: Response) => {
  try {
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || email.length > 254 || !emailPattern.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    await db.collection("newsletterSubscribers").insertOne({
      email,
      subscribedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "You have successfully subscribed.",
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "This email is already subscribed.",
      });
    }

    console.error("Newsletter Subscription Error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not complete your subscription.",
    });
  }
});

// ==========================================
// Add New Studio (JWT Protected)
// ==========================================

app.post(
  "/api/studios",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        title,
        category,
        hourlyRate,
        securityDeposit,
        maxCapacity,
        location,
        image,
        galleryImages,
        amenities,
        overview,
      } = req.body;

      if (
        !title ||
        !category ||
        hourlyRate === undefined ||
        !location ||
        !image ||
        !overview
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required fields",
        });
      }

      const rate = Number(hourlyRate);
      const deposit = Number(securityDeposit) || 0;
      const capacity = Number(maxCapacity) || 1;

      if (
        !Number.isFinite(rate) ||
        rate <= 0 ||
        !Number.isFinite(deposit) ||
        deposit < 0 ||
        !Number.isInteger(capacity) ||
        capacity < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid studio pricing and capacity",
        });
      }

      const newStudio = {
        title,
        category,
        hourlyRate: rate,
        securityDeposit: deposit,
        maxCapacity: capacity,
        location,
        image,

        galleryImages: Array.isArray(galleryImages)
          ? galleryImages
              .filter(
                (url: unknown) =>
                  typeof url === "string" && url.trim().length > 0
              )
              .slice(0, 4)
          : [],

        amenities: Array.isArray(amenities) ? amenities : [],
        overview,

        ownerEmail: req.user!.email,
        ownerName: req.user!.name,

        createdAt: new Date(),
      };

      const result = await db.collection("studios").insertOne(newStudio);

      return res.status(201).json({
        success: true,
        message: "Studio added successfully!",
        insertedId: result.insertedId,
      });
    } catch (error) {
      console.error("Failed to add studio:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to add studio",
      });
    }
  }
);

// ==========================================
// Escape Special Regex Characters
// ==========================================

const escapeRegex = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// ==========================================
// Get All Studios (Search, Filter & Pagination)
// ==========================================

app.get("/api/studios", async (req: Request, res: Response) => {
  try {
    const {
      category,
      search,
      page = "1",
      limit = "12",
    } = req.query;

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.min(50, Math.max(1, Number(limit) || 12));
    const skip = (currentPage - 1) * pageLimit;

    const filter: Record<string, unknown> = {};

    if (typeof category === "string" && category.trim()) {
      filter.category = {
        $regex: escapeRegex(category.trim()),
        $options: "i",
      };
    }

    if (typeof search === "string" && search.trim()) {
      const safeSearch = escapeRegex(search.trim().slice(0, 100));

      const searchRegex = {
        $regex: safeSearch,
        $options: "i",
      };

      filter.$or = [
        { title: searchRegex },
        { location: searchRegex },
        { category: searchRegex },
      ];
    }

    const collection = db.collection("studios");

    const [studios, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit)
        .toArray(),

      collection.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: studios.length,
      total,
      pagination: {
        currentPage,
        totalPages: Math.ceil(total / pageLimit),
        limit: pageLimit,
      },
      data: studios,
    });
  } catch (error) {
    console.error("Failed to fetch studios:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch studios",
    });
  }
});

// ==========================================
// Get My Studios (JWT Protected)
// ==========================================

app.get(
  "/api/my-studios",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const studios = await db
        .collection("studios")
        .find({ ownerEmail: req.user!.email })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        count: studios.length,
        data: studios,
      });
    } catch (error) {
      console.error("Failed to fetch your studios:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch your studios",
      });
    }
  }
);

// ==========================================
// Delete Studio (JWT Protected)
// ==========================================

app.delete(
  "/api/studios/:id",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid studio ID",
        });
      }

      const result = await db.collection("studios").deleteOne({
        _id: new ObjectId(id),
        ownerEmail: req.user!.email,
      });

      if (result.deletedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Studio not found or you are not the owner.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Studio deleted successfully!",
      });
    } catch (error) {
      console.error("Failed to delete studio:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to delete studio",
      });
    }
  }
);

// ==========================================
// Update Studio (JWT Protected)
// ==========================================

app.put(
  "/api/studios/:id",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid studio ID",
        });
      }

      const {
        title,
        category,
        hourlyRate,
        securityDeposit,
        maxCapacity,
        location,
        image,
        galleryImages,
        amenities,
        overview,
      } = req.body;

      if (
        !title ||
        !category ||
        hourlyRate === undefined ||
        !location ||
        !image ||
        !overview
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required fields",
        });
      }

      const rate = Number(hourlyRate);
      const deposit = Number(securityDeposit) || 0;
      const capacity = Number(maxCapacity) || 1;

      if (
        !Number.isFinite(rate) ||
        rate <= 0 ||
        !Number.isFinite(deposit) ||
        deposit < 0 ||
        !Number.isInteger(capacity) ||
        capacity < 1
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide valid studio pricing and capacity",
        });
      }

      const result = await db.collection("studios").updateOne(
        {
          _id: new ObjectId(id),
          ownerEmail: req.user!.email,
        },
        {
          $set: {
            title: title.trim(),
            category,
            hourlyRate: rate,
            securityDeposit: deposit,
            maxCapacity: capacity,
            location: location.trim(),
            image: image.trim(),

            galleryImages: Array.isArray(galleryImages)
              ? galleryImages
                  .filter(
                    (url: unknown) =>
                      typeof url === "string" && url.trim().length > 0
                  )
                  .slice(0, 4)
              : [],

            amenities: Array.isArray(amenities) ? amenities : [],
            overview: overview.trim(),
            updatedAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Studio not found or you are not the owner.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Studio updated successfully!",
      });
    } catch (error) {
      console.error("Failed to update studio:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to update studio",
      });
    }
  }
);

// ==========================================
// Get Single Studio by ID (Public)
// ==========================================

app.get("/api/studios/:id", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid studio ID",
      });
    }

    const studio = await db.collection("studios").findOne({
      _id: new ObjectId(id),
    });

    if (!studio) {
      return res.status(404).json({
        success: false,
        message: "Studio not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: studio,
    });
  } catch (error) {
    console.error("Failed to fetch studio:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch studio",
    });
  }
});

// ==========================================
// Get Featured Studios (Latest 6) (Public)
// ==========================================

app.get("/api/featured-studios", async (req: Request, res: Response) => {
  try {
    const studios = await db
      .collection("studios")
      .find()
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    return res.status(200).json({
      success: true,
      data: studios,
    });
  } catch (error) {
    console.error("Failed to fetch featured studios:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch featured studios",
    });
  }
});

// ==========================================
// Studio Reviews & Ratings
// ==========================================

// Get public reviews for a studio
app.get("/api/studios/:id/reviews", async (req: Request, res: Response) => {
  try {
    const studioId = String(req.params.id);
    if (!ObjectId.isValid(studioId)) {
      return res.status(400).json({ success: false, message: "Invalid studio ID." });
    }

    const reviews = await db.collection("reviews")
      .find({ studioId }, { projection: { reviewerEmail: 0, bookingId: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    return res.status(200).json({ success: true, count: reviews.length, data: reviews });
  } catch (error) {
    console.error("Fetch Studio Reviews Error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch reviews." });
  }
});

// Submit a review only for a past, confirmed booking owned by the guest
app.post("/api/reviews", verifyJWT, async (req: AuthRequest, res: Response) => {
  try {
    const { bookingId, rating, comment } = req.body;
    if (!bookingId || !ObjectId.isValid(String(bookingId))) {
      return res.status(400).json({ success: false, message: "A valid booking ID is required." });
    }

    const score = Number(rating);
    const reviewText = typeof comment === "string" ? comment.trim() : "";
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return res.status(400).json({ success: false, message: "Rating must be between 1 and 5." });
    }
    if (reviewText.length > 1000) {
      return res.status(400).json({ success: false, message: "Review must be 1000 characters or fewer." });
    }

    const booking = await db.collection("bookings").findOne({
      _id: new ObjectId(String(bookingId)),
      customerEmail: req.user!.email,
      status: { $in: ["Confirmed", "Completed"] },
    });
    if (!booking) {
      return res.status(403).json({ success: false, message: "Only guests with a confirmed booking can review this studio." });
    }

    const today = new Date().toISOString().slice(0, 10);
    if (typeof booking.bookingDate !== "string" || booking.bookingDate >= today) {
      return res.status(403).json({ success: false, message: "You can review this studio after your booking date has passed." });
    }

    const studioId = String(booking.studioId);
    const studio = await db.collection("studios").findOne({ _id: new ObjectId(studioId) });
    if (!studio) {
      return res.status(404).json({ success: false, message: "Studio not found." });
    }

    const review = {
      studioId,
      bookingId: String(booking._id),
      reviewerEmail: req.user!.email,
      reviewerName: req.user!.name || "Guest",
      rating: score,
      comment: reviewText,
      createdAt: new Date(),
    };

    await db.collection("reviews").insertOne(review);

    const stats = await db.collection("reviews").aggregate([
      { $match: { studioId } },
      { $group: { _id: "$studioId", averageRating: { $avg: "$rating" }, reviewCount: { $sum: 1 } } },
    ]).next();

    const averageRating = stats ? Number(stats.averageRating.toFixed(1)) : score;
    const reviewCount = stats?.reviewCount || 1;

    await db.collection("studios").updateOne(
      { _id: new ObjectId(studioId) },
      { $set: { rating: averageRating, reviewCount } }
    );

    return res.status(201).json({
      success: true,
      message: "Thank you for sharing your review!",
      data: {
        reviewerName: review.reviewerName,
        rating: averageRating,
        reviewCount,
        comment: review.comment,
        createdAt: review.createdAt,
      },
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      return res.status(409).json({ success: false, message: "You have already reviewed this booking." });
    }
    console.error("Submit Studio Review Error:", error);
    return res.status(500).json({ success: false, message: "Failed to submit review." });
  }
});

// ==========================================
// Booking System
// ==========================================

// Create New Booking (JWT Protected + Rate Limited)

app.post(
  "/api/bookings",
  bookingLimiter,
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const {
        studioId,
        bookingDate,
        startTime,
        endTime,
        guests,
        notes,
      } = req.body;

      if (
        !studioId ||
        !bookingDate ||
        !startTime ||
        !endTime ||
        !guests
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide all required booking details.",
        });
      }

      if (!ObjectId.isValid(studioId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid studio ID.",
        });
      }

      const date = new Date(`${bookingDate}T00:00:00.000Z`);
      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(bookingDate) ||
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== bookingDate ||
        !timePattern.test(startTime) ||
        !timePattern.test(endTime) ||
        startTime >= endTime
      ) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid booking date and time.",
        });
      }

      const guestCount = Number(guests);

      if (!Number.isInteger(guestCount) || guestCount < 1) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid number of guests.",
        });
      }

      const studio = await db.collection("studios").findOne({
        _id: new ObjectId(studioId),
      });

      if (!studio) {
        return res.status(404).json({
          success: false,
          message: "Studio not found.",
        });
      }

      if (guestCount > studio.maxCapacity) {
        return res.status(400).json({
          success: false,
          message: "Guest count exceeds studio capacity.",
        });
      }

      if (studio.ownerEmail === req.user!.email) {
        return res.status(403).json({
          success: false,
          message: "You cannot book your own studio.",
        });
      }

      const conflictingBooking = await db.collection("bookings").findOne({
        studioId,
        bookingDate,
        status: "Confirmed",
        startTime: { $lt: endTime },
        endTime: { $gt: startTime },
      });

      if (conflictingBooking) {
        return res.status(409).json({
          success: false,
          message: "This studio is already booked for the selected time.",
        });
      }

      const hours =
        (Number(endTime.split(":")[0]) * 60 +
          Number(endTime.split(":")[1]) -
          Number(startTime.split(":")[0]) * 60 -
          Number(startTime.split(":")[1])) /
        60;

      const totalPrice = hours * Number(studio.hourlyRate);

      const newBooking = {
        studioId,
        studioTitle: studio.title,
        studioImage: studio.image,
        studioLocation: studio.location,
        ownerEmail: studio.ownerEmail,
        ownerName: studio.ownerName || "",
        customerEmail: req.user!.email,
        customerName: req.user!.name,
        bookingDate,
        startTime,
        endTime,
        guests: guestCount,
        notes: typeof notes === "string" ? notes.trim() : "",
        hourlyRate: studio.hourlyRate,
        totalPrice,
        status: "Pending",
        createdAt: new Date(),
      };

      const result = await db.collection("bookings").insertOne(newBooking);

      return res.status(201).json({
        success: true,
        message: "Booking request submitted successfully!",
        data: {
          ...newBooking,
          _id: result.insertedId,
        },
      });
    } catch (error) {
      console.error("Create Booking Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to create booking.",
      });
    }
  }
);

// ==========================================
// Get My Bookings (Customer) (JWT Protected + Pagination)
// ==========================================

app.get(
  "/api/my-bookings",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(
        50,
        Math.max(1, Number(req.query.limit) || 10)
      );

      const skip = (page - 1) * limit;

      const filter = {
        customerEmail: req.user!.email,
      };

      const collection = db.collection("bookings");

      // Automatically close confirmed bookings after their booking date has passed.
      const today = new Date().toISOString().slice(0, 10);
      await collection.updateMany(
        { ...filter, status: "Confirmed", bookingDate: { $lt: today } },
        { $set: { status: "Completed", completedAt: new Date() } }
      );

      const [bookings, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),

        collection.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        count: bookings.length,
        total,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
        data: bookings,
      });
    } catch (error) {
      console.error("Fetch My Bookings Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch bookings.",
      });
    }
  }
);

// ==========================================
// Get Owner Bookings (Studio Owner) (JWT Protected + Pagination)
// ==========================================

app.get(
  "/api/owner-bookings",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(
        50,
        Math.max(1, Number(req.query.limit) || 10)
      );

      const skip = (page - 1) * limit;

      const filter = {
        ownerEmail: req.user!.email,
      };

      const collection = db.collection("bookings");

      // Keep owner and customer dashboards consistent about completed bookings.
      const today = new Date().toISOString().slice(0, 10);
      await collection.updateMany(
        { ...filter, status: "Confirmed", bookingDate: { $lt: today } },
        { $set: { status: "Completed", completedAt: new Date() } }
      );

      const [bookings, total] = await Promise.all([
        collection
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray(),

        collection.countDocuments(filter),
      ]);

      return res.status(200).json({
        success: true,
        count: bookings.length,
        total,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          limit,
          hasNextPage: page * limit < total,
          hasPreviousPage: page > 1,
        },
        data: bookings,
      });
    } catch (error) {
      console.error("Fetch Owner Bookings Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to fetch owner bookings.",
      });
    }
  }
);

// ==========================================
// Cancel Pending Booking (Customer Only)
// ==========================================

app.patch(
  "/api/bookings/:id/cancel",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      const result = await db.collection("bookings").updateOne(
        {
          _id: new ObjectId(id),
          customerEmail: req.user!.email,
          status: "Pending",
        },
        {
          $set: {
            status: "Cancelled",
            cancelledAt: new Date(),
          },
        }
      );

      if (result.matchedCount === 0) {
        return res.status(404).json({
          success: false,
          message: "Pending booking not found or cannot be cancelled.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Booking cancelled successfully.",
      });
    } catch (error) {
      console.error("Cancel Booking Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to cancel booking.",
      });
    }
  }
);

// ==========================================
// Confirm Booking (Studio Owner Only)
// ==========================================

app.patch(
  "/api/bookings/:id/confirm",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    let bookingConflict = false;
    let bookingStatusChanged = false;
    const session = client.startSession();

    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

      // Find the pending booking first.
      const booking = await db.collection("bookings").findOne({
        _id: new ObjectId(id),
        ownerEmail: req.user!.email,
        status: "Pending",
      });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: "Pending booking not found or you are not the owner.",
        });
      }

      // Ensure the lock document exists before starting the transaction.
      const lockId = `${booking.studioId}:${booking.bookingDate}`;

      try {
        await db.collection("bookingLocks").updateOne(
          { lockKey: lockId },
          {
            $setOnInsert: {
              version: 0,
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      } catch (error) {
        // Concurrent upsert may create the same unique lock document.
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== 11000
        ) {
          throw error;
        }
      }

      await session.withTransaction(async () => {
        bookingConflict = false;
        bookingStatusChanged = false;

        // Write to the same lock document to serialize confirmations
        // for this studio and booking date.
        await db.collection("bookingLocks").updateOne(
          { lockKey: lockId },
          {
            $inc: { version: 1 },
            $set: { updatedAt: new Date() },
          },
          { session }
        );

        // Check overlapping confirmed bookings inside the transaction.
        const conflict = await db.collection("bookings").findOne(
          {
            _id: { $ne: new ObjectId(id) },
            studioId: booking.studioId,
            bookingDate: booking.bookingDate,
            status: "Confirmed",
            startTime: { $lt: booking.endTime },
            endTime: { $gt: booking.startTime },
          },
          { session }
        );

        if (conflict) {
          bookingConflict = true;
          throw new Error("BOOKING_CONFLICT");
        }

        const result = await db.collection("bookings").updateOne(
          {
            _id: new ObjectId(id),
            ownerEmail: req.user!.email,
            status: "Pending",
          },
          {
            $set: {
              status: "Confirmed",
              confirmedAt: new Date(),
            },
          },
          { session }
        );

        if (result.modifiedCount === 0) {
          bookingStatusChanged = true;
          throw new Error("BOOKING_STATUS_CHANGED");
        }
      });

      return res.status(200).json({
        success: true,
        message: "Booking confirmed successfully.",
      });
    } catch (error) {
      if (bookingConflict) {
        return res.status(409).json({
          success: false,
          message: "Another confirmed booking already occupies this time.",
        });
      }

      if (bookingStatusChanged) {
        return res.status(409).json({
          success: false,
          message: "Booking status changed. Please refresh and try again.",
        });
      }

      console.error(
        "Confirm Booking Error:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return res.status(500).json({
        success: false,
        message: "Failed to confirm booking.",
      });
    } finally {
      await session.endSession();
    }
  }
);

// ==========================================
// Start Server
// ==========================================

async function startServer() {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();
