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

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );

    const database = client.db("DigiLessons");
    const lessonsCollection = database.collection("lessons");
    // likes and favorites collections
    const LikesCollection = database.collection("likes");
    const FavoritesCollection = database.collection("favorites");
    const CommentsCollection = database.collection("comments");
    const ReportsCollection = database.collection("reports");
    await LikesCollection.createIndex(
      { recipeId: 1, userId: 1 },
      { unique: true },
    );
    await FavoritesCollection.createIndex(
      { recipeId: 1, userId: 1 },
      { unique: true },
    );

    // like related all fetch

    // GET - fetch like status and count for a lesson
    app.get("/api/likes/:lessonId", async (req, res) => {
      const { lessonId } = req.params;
      const { userId } = req.query;

      if (!lessonId) {
        return res.status(400).json({ message: "lessonId is required" });
      }

      const count = await LikesCollection.countDocuments({
        recipeId: lessonId,
      });
      let liked = false;
      if (userId) {
        const existing = await LikesCollection.findOne({
          recipeId: lessonId,
          userId,
        });
        liked = !!existing;
      }
      return res.json({ liked, count });
    });

    // POST - toggle like/unlike
    app.post("/api/likes", async (req, res) => {
      const { lessonId, userId } = req.body;

      if (!lessonId || !userId) {
        return res
          .status(400)
          .json({ message: "lessonId and userId are required" });
      }

      const existing = await LikesCollection.findOne({
        recipeId: lessonId,
        userId,
      });

      if (existing) {
        // Unlike
        await LikesCollection.deleteOne({ recipeId: lessonId, userId });
        const count = await LikesCollection.countDocuments({
          recipeId: lessonId,
        });
        return res.json({ liked: false, count });
      } else {
        // Like
        await LikesCollection.insertOne({
          recipeId: lessonId,
          userId,
          createdAt: new Date(),
        });
        const count = await LikesCollection.countDocuments({
          recipeId: lessonId,
        });
        return res.json({ liked: true, count });
      }
    });

    // lesson reletade all fech
    app.get("/api/lessons", async (req, res) => {
      const query = {};
      if (req.query.lessonId) {
        query.lessonId = req.query.lessonId;
      }
      const cursor = lessonsCollection.find(query);
      const results = await cursor.toArray();
      res.json(results);
    });

    app.get("/api/lessons/:id", async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const lesson = await lessonsCollection.findOne(query);
      res.json({ data: lesson });
    });

    app.post("/api/lessons", async (req, res) => {
      const lesson = req.body;
      const result = await lessonsCollection.insertOne(lesson);
      res.json(result);
    });

    // get lesson by user id
    app.get("/api/lessons/user/:userId", async (req, res) => {
      const userId = req.params.userId;
      const query = { userId: userId };

      const results = await lessonsCollection.find(query).toArray();
      res.json({ data: results });
    });

    // get like count by user id
    app.get("/api/like/:userId", async (req, res) => {
      const userId = req.params.userId;
      const query = { userId: userId };
      const result = await LikesCollection.find(query).toArray();
      res.json({ result });
    });

    // --- FAVORITES ---

    // GET - check if saved + total count
    app.get("/api/favorites/:lessonId", async (req, res) => {
      const { lessonId } = req.params;
      const { userId } = req.query;

      const count = await FavoritesCollection.countDocuments({
        recipeId: lessonId,
      });
      const saved = userId
        ? !!(await FavoritesCollection.findOne({ recipeId: lessonId, userId }))
        : false;

      res.json({ saved, count });
    });

    // POST - toggle save/unsave
    app.post("/api/favorites", async (req, res) => {
      const { lessonId, userId } = req.body;
      if (!lessonId || !userId) {
        return res
          .status(400)
          .json({ message: "lessonId and userId are required" });
      }

      const existing = await FavoritesCollection.findOne({
        recipeId: lessonId,
        userId,
      });
      if (existing) {
        await FavoritesCollection.deleteOne({ recipeId: lessonId, userId });
        const count = await FavoritesCollection.countDocuments({
          recipeId: lessonId,
        });
        return res.json({ saved: false, count });
      } else {
        await FavoritesCollection.insertOne({
          recipeId: lessonId,
          userId,
          createdAt: new Date(),
        });
        const count = await FavoritesCollection.countDocuments({
          recipeId: lessonId,
        });

        return res.json({ saved: true, count });
      }
    });

    // GET - all saved lessons by a user
    app.get("/api/favorites/user/:userId", async (req, res) => {
      const { userId } = req.params;

      try {
        const favorites = await FavoritesCollection.aggregate([
          { $match: { userId: userId } },
          {
            $lookup: {
              from: "lessons",
              let: { recipeId_str: "$recipeId" },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$_id", { $toObjectId: "$$recipeId_str" }] },
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

    // --- COMMENTS Get api---
    app.get("/api/comments/:lessonId", async (req, res) => {
      const { lessonId } = req.params;
      const comments = await CommentsCollection.find({ lessonId })
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ data: comments });
    });

    // --- COMMENTS Post api---
    app.post("/api/comments", async (req, res) => {
      const { lessonId, userId, userName, userImage, text } = req.body;
      if (!lessonId || !text) {
        return res
          .status(400)
          .json({ message: "lessonId and text are required" });
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

    // POST - submit a report
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

    // GET - all reports (admin)
    app.get("/api/reports", async (req, res) => {
      const reports = await ReportsCollection.find({})
        .sort({ createdAt: -1 })
        .toArray();
      res.json({ data: reports });
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
