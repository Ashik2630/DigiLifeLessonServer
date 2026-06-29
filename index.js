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

// 1. [GET] Top Contributors of the Week
app.get("/api/top-contributors", async (req, res) => {
  try {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7); // Use this to filter data from the last 7 days

    const topContributors = await lessonsCollection
      .aggregate([
        // { $match: { createdAt: { $gte: oneWeekAgo } } }, // Remove this line if you want to include data from the last 1 week
        {
          $group: {
            _id: "$userEmail", // Group by user email
            userName: { $first: "$userName" },
            userImage: { $first: "$userImage" },
            lessonCount: { $sum: 1 }, // Count how many lessons the user created
          },
        },
        { $sort: { lessonCount: -1 } }, // Users with the most lessons will appear at the top
        { $limit: 5 }, // Select the top 5 contributors
      ])
      .toArray();

    res.json({ success: true, data: topContributors });
  } catch (error) {
    console.error("Error fetching top contributors:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// 2. [GET] Most Saved Lessons
app.get("/api/most-saved-lessons", async (req, res) => {
  try {
    const mostSaved = await FavoritesCollection.aggregate([
      {
        $group: {
          _id: "$lessonId", // Group by lesson ID
          savedCount: { $sum: 1 }, // Count how many times it was saved
        },
      },
      {
        $addFields: {
          lessonObjId: {
            $cond: {
              if: { $eq: [{ $strLenCP: "$_id" }, 24] }, // ObjectId validation check
              then: { $toObjectId: "$_id" },
              else: "$_id",
            },
          },
        },
      },
      {
        // Fetch lesson details from the lessons collection
        $lookup: {
          from: "lessons",
          localField: "lessonObjId",
          foreignField: "_id",
          as: "lessonDetails",
        },
      },
      { $unwind: "$lessonDetails" },
      { $sort: { savedCount: -1 } }, // The most saved lessons will appear first
      { $limit: 4 }, // Select the top 4 lessons
    ]).toArray();

    res.json({ success: true, data: mostSaved });
  } catch (error) {
    console.error("Error fetching most saved lessons:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

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

// get all featured lessons
app.get("/api/lessons/featured", async (req, res) => {
  try {
    const featuredLessons = await lessonsCollection
      .find({ isFeatured: true })
      .toArray();
    res.json({ success: true, data: featuredLessons });
  } catch (error) {
    console.error("Error fetching featured lessons:", error);
    res.status(500).json({ success: false, error: "Server Error" });
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

// ---------------- My Lesson Update & Delete Related ----------------

// [PATCH] API to update the data of a specific lesson (for editing a user's own lesson)
app.patch("/api/lessons/:id", async (req, res) => {
  try {
    const lessonId = req.params.id;
    const updatedData = req.body;

    // For security, remove the main database _id from req.body before updating
    if (updatedData._id) {
      delete updatedData._id;
    }

    const filter = { _id: new ObjectId(lessonId) };
    const updateDoc = {
      $set: updatedData, // All data sent from the frontend will be updated here
    };

    const result = await lessonsCollection.updateOne(filter, updateDoc);

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Lesson not found" });
    }

    res.json({
      success: true,
      message: "Lesson updated successfully!",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Error updating lesson:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
});

// [DELETE] API to delete a specific lesson from the database
app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const lessonId = req.params.id;

    // Check whether the ID format is valid
    if (!ObjectId.isValid(lessonId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid Lesson ID format" });
    }

    const query = { _id: new ObjectId(lessonId) };
    const result = await lessonsCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Lesson not found or already deleted",
      });
    }

    // Send the response
    res.json({
      success: true,
      message: "Lesson deleted successfully!",
    });
  } catch (error) {
    console.error("Error deleting lesson:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
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
      userId: userId,
      lessonId: lessonId,
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

// 1. [GET] Group all reports in frontend format and include the lesson title
app.get("/api/reports", async (req, res) => {
  try {
    const groupedReports = await ReportsCollection.aggregate([
      { $match: { status: "pending" } }, // Only pending reports will be processed
      {
        // Convert the lesson ID from string to ObjectId if it is stored as ObjectId in the database
        $addFields: {
          lessonObjId: { $toObjectId: "$lessonId" },
        },
      },
      {
        // Fetch lesson title and other info from the lessons collection
        $lookup: {
          from: "lessons", // Enter the name of your lessons collection here
          localField: "lessonObjId",
          foreignField: "_id",
          as: "lessonDetails",
        },
      },
      { $unwind: "$lessonDetails" }, // Convert the array into an object
      {
        // Group data in a mock frontend format
        $group: {
          _id: "$lessonId",
          title: { $first: "$lessonDetails.title" },
          reportCount: { $sum: 1 },
          latestReportDate: { $max: "$createdAt" },
          reports: {
            $push: {
              reporter: { $ifNull: ["$userEmail", "Anonymous"] }, // Use the email from the report if available; otherwise use userId
              date: "$createdAt",
              reason: "$reason",
              details: {
                $ifNull: ["$details", "No additional details provided."],
              },
            },
          },
        },
      },
      {
        // Match the fields with frontend variables
        $project: {
          _id: 0,
          id: "$_id",
          title: 1,
          reportCount: 1,
          latestReportDate: {
            $dateToString: { format: "%m/%d/%Y", date: "$latestReportDate" },
          },
          reports: 1,
        },
      },
    ]).toArray();

    res.json({ success: true, data: groupedReports });
  } catch (error) {
    console.error("Error fetching reports:", error);
    res.status(500).json({ success: false, error: "Server Error" });
  }
});

// 2. [POST] Submit a new lesson report by a user
app.post("/api/reports", async (req, res) => {
  try {
    const { userId, userEmail, lessonId, reason, details } = req.body;

    console.log("Incoming Report Data:", req.body);

    // 1. Validate whether the required fields were received from the frontend
    if (!userId || !lessonId || !reason) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields. userId, lessonId, and reason are mandatory.",
      });
    }

    // 2. Create an object to save in the database (matching your GET API structure)
    const newReport = {
      userId: userId,
      userEmail: userEmail || "Anonymous", // Use 'Anonymous' if the user email is not available
      lessonId: lessonId, // This will be stored as a string so that $toObjectId can be applied in the GET aggregation
      reason: reason,
      details: details || "No additional details provided.",
      status: "pending", // Default status remains 'pending' so it appears in the GET API
      createdAt: new Date(), // Required for the aggregation's $max: "$createdAt"
    };

    // 3. Insert report data into the reports collection
    const result = await ReportsCollection.insertOne(newReport);

    // 4. Send a success response
    res.status(201).json({
      success: true,
      message: "Report submitted successfully. Admin will review it shortly.",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error("Backend Report Insertion Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error while processing the report.",
    });
  }
});

// 3. [DELETE] Delete a report (delete the offending lesson and all its reports)
app.delete("/api/reports/action/delete/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  try {
    // a) Delete the main lesson from the lessons collection
    await lessonsCollection.deleteOne({ _id: new ObjectId(lessonId) });
    // b) Delete all reports for this lesson from the reports collection
    await ReportsCollection.deleteMany({ lessonId: lessonId });

    res.json({
      success: true,
      message: "Lesson and associated reports deleted successfully.",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 4. [PATCH] Ignore or dismiss a report (the lesson remains, only the report status becomes 'dismissed')
app.patch("/api/reports/action/ignore/:lessonId", async (req, res) => {
  const { lessonId } = req.params;
  try {
    // Change the status of all reports for this lesson from pending to dismissed
    await ReportsCollection.updateMany(
      { lessonId: lessonId },
      { $set: { status: "dismissed" } },
    );
    res.json({
      success: true,
      message: "All reports for this lesson have been dismissed.",
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
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
      return res.json({
        success: true,
        message: "User role updated successfully!",
      });
    }

    return res
      .status(404)
      .json({ success: false, message: "User not found or no change made." });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
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
    return res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
});

// 1. API to update the review status (Approved / Reviewed)
app.patch("/api/lessons/review/:id", async (req, res) => {
  try {
    const lessonId = req.params.id;
    const { isReviewed } = req.body; // true or false will come from the request body

    const result = await lessonsCollection.updateOne(
      { _id: new ObjectId(lessonId) },
      { $set: { isReviewed: isReviewed } },
    );

    res.json({ success: true, message: "Review status updated!" });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

// 2. API to mark or unmark a lesson as featured
app.patch("/api/lessons/featured/:id", async (req, res) => {
  try {
    const lessonId = req.params.id;
    const { isFeatured } = req.body;

    const result = await lessonsCollection.updateOne(
      { _id: new ObjectId(lessonId) },
      { $set: { isFeatured: isFeatured } },
    );

    res.json({ success: true, message: "Featured status updated!" });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
  }
});

// 3. API to delete a lesson
app.delete("/api/lessons/:id", async (req, res) => {
  try {
    const lessonId = req.params.id;
    const result = await lessonsCollection.deleteOne({
      _id: new ObjectId(lessonId),
    });
    res.json({ success: true, message: "Lesson deleted successfully!" });
  } catch (error) {
    res.status(500).json({ error: "Server Error" });
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
