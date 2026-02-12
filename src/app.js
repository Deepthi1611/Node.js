const express = require("express");
const cookieParser = require("cookie-parser");

const authController = require("./controllers/auth.controller");
const { protect } = require("./middlewares/auth.middleware");
const { authorize } = require("./middlewares/role.middleware");

const app = express();

app.use(express.json());
app.use(cookieParser());

/* -------- AUTH ROUTES -------- */

app.post("/signup", authController.signup);
app.post("/login", authController.login);
app.post("/refresh", authController.refresh);
app.post("/logout", authController.logout);

/* -------- PROTECTED ROUTES -------- */

app.get("/profile", protect, (req, res) => {
  res.json({
    message: "User profile",
    user: req.user,
  });
});

/* -------- ADMIN ONLY -------- */

app.delete(
  "/admin/delete-user/:id",
  protect,
  authorize("ADMIN"),
  async (req, res) => {
    res.json({ message: "User deleted (Admin only)" });
  }
);

/* -------- ADMIN OR USER -------- */

app.get(
  "/dashboard",
  protect,
  authorize("ADMIN", "USER"),
  (req, res) => {
    res.json({ message: "Dashboard access allowed" });
  }
);

module.exports = app;