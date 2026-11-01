import dns from "node:dns";
import { ObjectId } from "mongodb";
import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { MongoClient } from "mongodb";
import { verifyJWT, AuthRequest } from "./middleware.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// Middleware
// ==========================================

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

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

  // ==========================================
  // MongoDB Index Optimization
  // ==========================================

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
        $regex: category.trim(),
        $options: "i",
      };
    }

    if (typeof search === "string" && search.trim()) {
      const searchRegex = {
        $regex: search.trim(),
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
// Booking System
// ==========================================

// Create New Booking (JWT Protected)

app.post(
  "/api/bookings",
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
// Get My Bookings (Customer) (JWT Protected)
// ==========================================

app.get(
  "/api/my-bookings",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const bookings = await db
        .collection("bookings")
        .find({
          customerEmail: req.user!.email,
        })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        count: bookings.length,
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
// Get Owner Bookings (Studio Owner) (JWT Protected)
// ==========================================

app.get(
  "/api/owner-bookings",
  verifyJWT,
  async (req: AuthRequest, res: Response) => {
    try {
      const bookings = await db
        .collection("bookings")
        .find({
          ownerEmail: req.user!.email,
        })
        .sort({ createdAt: -1 })
        .toArray();

      return res.status(200).json({
        success: true,
        count: bookings.length,
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
    try {
      const id = String(req.params.id);

      if (!ObjectId.isValid(id)) {
        return res.status(400).json({
          success: false,
          message: "Invalid booking ID.",
        });
      }

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

      // Check for overlapping confirmed bookings
      const conflict = await db.collection("bookings").findOne({
        _id: { $ne: new ObjectId(id) },
        studioId: booking.studioId,
        bookingDate: booking.bookingDate,
        status: "Confirmed",
        startTime: { $lt: booking.endTime },
        endTime: { $gt: booking.startTime },
      });

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: "Another confirmed booking already occupies this time.",
        });
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
        }
      );

      if (result.modifiedCount === 0) {
        return res.status(409).json({
          success: false,
          message: "Booking status changed. Please refresh and try again.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Booking confirmed successfully.",
      });
    } catch (error) {
      console.error("Confirm Booking Error:", error);

      return res.status(500).json({
        success: false,
        message: "Failed to confirm booking.",
      });
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
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();