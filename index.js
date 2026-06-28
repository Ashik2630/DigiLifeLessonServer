const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

app.use(cors());
app.use(express.json());

const port = process.env.PORT || 8000;

app.get("/", (req, res) => {
  res.send("Hello World!");
});

// ---------------- MongoDB Configuration ----------------
const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let lessonsCollection;
let LikesCollection;
let FavoritesCollection;
let CommentsCollection;
let ReportsCollection;
let userCollection;
let dbConnected = false;

// Function to initialize database connection and create indexes
async function initializeDatabase() {
  if (dbConnected) return;
  try {
    await client.connect();
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );

    const database = client.db("DigiLessons");
    lessonsCollection = database.collection("lessons");
    LikesCollection = database.collection("likes");
    FavoritesCollection = database.collection("favorites");
    CommentsCollection = database.collection("comments");
    ReportsCollection = database.collection("reports");
    userCollection = database.collection("user");

    await LikesCollection.createIndex(
      { lessonId: 1, userId: 1 },
      { unique: true },
    );
    await FavoritesCollection.createIndex(
      { lessonId: 1, userId: 1 },
      { unique: true },
    );

    dbConnected = true;
  } catch (error) {
    console.error("Database initialization failed:", error);
  }
}

// Middleware: Ensures the database is connected before handling any request
app.use(async (req, res, next) => {
  if (!dbConnected) {
    await initializeDatabase();
  }
  next();
});

// ---------------- Lesson Related Data ----------------

// [GET] Fetch all lessons or filter by a specific lessonId query parameter
app.get("/api/lessons", async (req, res) => {
  try {
    const query = {};
    if (req.query.lessonId) {
      query.lessonId = req.query.lessonId;
    }

    
    const allLessons = await lessonsCollection
      .find(query)
      .sort({ _id: -1 })
      .toArray();

    
    const options = {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };

    const todayStr = new Date().toLocaleDateString("en-CA", options);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA", options);

    console.log("Today:", todayStr, "Yesterday:", yesterdayStr);

    const recentQuery = {
      ...query,
      createdAt: { $in: [todayStr, yesterdayStr] },
    };

    const last24HoursLessons = await lessonsCollection
      .find(recentQuery)
      .toArray();

    res.json({
      allLessons: allLessons,
      last24HoursCount: last24HoursLessons.length,
    });
  } catch (error) {
    console.error("Error fetching lessons:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// [GET] Fetch details of a single lesson using its MongoDB document ID (_id)
app.get("/api/lessons/:id", async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const lesson = await lessonsCollection.findOne(query);
  res.json({ data: lesson });
});

// [POST] Create and upload a new lesson to the database
app.post("/api/lessons", async (req, res) => {
  const lesson = req.body;
  const result = await lessonsCollection.insertOne(lesson);
  res.json(result);
});

// [GET] Fetch all lessons created/uploaded by a specific user ID
app.get("/api/lessons/user/:userId", async (req, res) => {
  const userId = req.params.userId;
  const query = { userId: userId };
  const results = await lessonsCollection.find(query).toArray();
  res.json({ data: results });
});

// ---------------- Likes Related Data ----------------

// [GET] Get the total like count for a lesson and check if a specific user has liked it
app.get("/api/likes/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  const { userId } = req.query;

  if (!lessonId) {
    return res.status(400).json({ message: "lessonId is required" });
  }

  const count = await LikesCollection.countDocuments({ lessonId: lessonId });
  let liked = false;
  if (userId) {
    const existing = await LikesCollection.findOne({
      lessonId: lessonId,
      userId,
    });
    liked = !!existing;
  }
  return res.json({ liked, count });
});

// [POST] Toggle Like status: adds a like if it doesn't exist, removes it if it does
app.post("/api/likes", async (req, res) => {
  const { lessonId, userId } = req.body;

  if (!lessonId || !userId) {
    return res
      .status(400)
      .json({ message: "lessonId and userId are required" });
  }

  const existing = await LikesCollection.findOne({
    lessonId: lessonId,
    userId,
  });

  if (existing) {
    // If already liked, remove the like (unlike)
    await LikesCollection.deleteOne({ lessonId: lessonId, userId });
    const count = await LikesCollection.countDocuments({ lessonId: lessonId });
    return res.json({ liked: false, count });
  } else {
    // If not liked yet, add a new like
    await LikesCollection.insertOne({
      lessonId: lessonId,
      userId,
      createdAt: new Date(),
    });
    const count = await LikesCollection.countDocuments({ lessonId: lessonId });
    return res.json({ liked: true, count });
  }
});

// [GET] Fetch all the documents representing likes submitted by a specific user
app.get("/api/like/:userId", async (req, res) => {
  const userId = req.params.userId;
  const query = { userId: userId };
  const result = await LikesCollection.find(query).toArray();
  res.json({ result });
});

// ---------------- Favorites Related Data ----------------

// [GET] Check total saved count of a lesson and find if it's favorited by a specific user
app.get("/api/favorites/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  const { userId } = req.query;

  const count = await FavoritesCollection.countDocuments({
    lessonId: lessonId,
  });
  const saved = userId
    ? !!(await FavoritesCollection.findOne({ lessonId: lessonId, userId }))
    : false;

  res.json({ saved, count });
});

// [POST] Toggle Favorite status: saves a lesson to favorites or removes it if already saved
app.post("/api/favorites", async (req, res) => {
  const { lessonId, userId } = req.body;
  if (!lessonId || !userId) {
    return res
      .status(400)
      .json({ message: "lessonId and userId are required" });
  }

  const existing = await FavoritesCollection.findOne({
    lessonId: lessonId,
    userId,
  });
  if (existing) {
    // If already in favorites, remove it
    await FavoritesCollection.deleteOne({ lessonId: lessonId, userId });
    const count = await FavoritesCollection.countDocuments({
      lessonId: lessonId,
    });
    return res.json({ saved: false, count });
  } else {
    // If not in favorites, add it
    await FavoritesCollection.insertOne({
      lessonId: lessonId,
      userId,
      createdAt: new Date(),
    });
    const count = await FavoritesCollection.countDocuments({
      lessonId: lessonId,
    });
    return res.json({ saved: true, count });
  }
});

// [GET] Fetch all favorite entries for a user along with the full lesson details (via Aggregate Lookup)
app.get("/api/favorites/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const favorites = await FavoritesCollection.aggregate([
      { $match: { userId: userId } },
      {
        $lookup: {
          from: "lessons",
          let: { lessonId_str: "$lessonId" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$_id", { $toObjectId: "$$lessonId_str" }] },
              },
            },
          ],
          as: "lessonDetails",
        },
      },
      { $unwind: "$lessonDetails" },
    ]).toArray();

    res.json({ data: favorites });
  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).json({ message: "Server error", error });
  }
});

// [DELETE] Manually remove a specific lesson from a user's favorite list
app.delete("/api/favorites/:userId/:lessonId", async (req, res) => {
  try {
    const { userId, lessonId } = req.params;
    console.log("DELETE HIT:", req.params);

    const query = {
      userId: ObjectId.isValid(userId) ? new ObjectId(userId) : userId,
      lessonId: ObjectId.isValid(lessonId) ? new ObjectId(lessonId) : lessonId,
    };

    const result = await FavoritesCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Item not found in database",
      });
    }

    res.json({
      success: true,
      message: "Deleted successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// ---------------- Comments Related Data ----------------

// [GET] Retrieve all comments for a specific lesson, sorted with newest comments first
app.get("/api/comments/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  const comments = await CommentsCollection.find({ lessonId })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ data: comments });
});

// [POST] Post a new comment under a specific lesson
app.post("/api/comments", async (req, res) => {
  const { lessonId, userId, userName, userImage, text } = req.body;
  if (!lessonId || !text) {
    return res.status(400).json({ message: "lessonId and text are required" });
  }
  const result = await CommentsCollection.insertOne({
    lessonId,
    userId,
    userName,
    userImage,
    text,
    createdAt: new Date(),
  });
  res.json({ success: true, id: result.insertedId });
});

// ---------------- Reports Related Data ----------------

// [POST] Submit a report against an objectionable or rule-breaking lesson
app.post("/api/reports", async (req, res) => {
  const { lessonId, userId, reason } = req.body;
  if (!lessonId || !reason) {
    return res
      .status(400)
      .json({ message: "lessonId and reason are required" });
  }
  await ReportsCollection.insertOne({
    lessonId,
    userId: userId || null,
    reason,
    status: "pending",
    createdAt: new Date(),
  });
  return res.json({ success: true });
});

// [GET] Retrieve all submitted reports for admin review, ordered by newest first
app.get("/api/reports", async (req, res) => {
  const reports = await ReportsCollection.find({})
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ data: reports });
});

// -------------Admin User Management Related Data ----------------

// get all users
app.get("/api/users", async (req, res) => {
  const users = await userCollection.find({}).toArray();
  res.json({ data: users });
});

// ------------------ Admin User Management Related Data ----------------

// Update a user's role (admin or user) based on the provided user ID and new role in the request body
app.patch("/api/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const { role } = req.body;

    if (!["admin", "user"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role must be either admin or user",
      });
    }

    const filter = { _id: new ObjectId(userId) };
    const updateDoc = { $set: { role } };

    const result = await userCollection.updateOne(filter, updateDoc);

    if (result.modifiedCount > 0) {
      return res.json({ success: true, message: "User role updated successfully!" });
    }

    return res.status(404).json({ success: false, message: "User not found or no change made." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


// delete admin management user
app.delete("/api/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    const filter = { _id: new ObjectId(userId) };

    const result = await userCollection.deleteOne(filter);

    if (result.deletedCount > 0) {
      return res.json({ success: true, message: "User deleted successfully!" });
    }

    return res.status(404).json({ success: false, message: "User not found." });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// ---------------- Server Initialization ----------------
initializeDatabase().catch(console.error);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

module.exports = app;
