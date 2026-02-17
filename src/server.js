// server.js : point d'entrée de l'API, configure Express, les routes, les middlewares et démarre le serveur
require("dotenv").config();

const express = require("express");
const cors = require("cors");

const adminRoutes = require("./routes/admin.routes.js");
const productsRoutes = require("./routes/products.routes.js");
const preordersRoutes = require("./routes/preorders.routes.js");

const path = require("path");


const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// Routes
app.use("/api/products", productsRoutes);
app.use("/api/preorders", preordersRoutes);
app.use("/api/admin", adminRoutes);


app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));


// 404 handler
app.use((req, res) => res.status(404).json({ error: "Not Found" }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server Error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));
