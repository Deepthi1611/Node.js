const prisma = require("../prisma");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const {
  generateAccessToken,
  generateRefreshToken,
  getRefreshExpiry,
} = require("../utils/tokens");

const { hashToken } = require("../utils/hash");

/* ---------------- SIGNUP ---------------- */

exports.signup = async (req, res) => {
  const { username, password } = req.body;

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { username, passwordHash },
    });

    res.status(201).json({ id: user.id, username: user.username });
  } catch (err) {
    console.error(err);
    res.status(409).json({ error: "Username already exists" });
  }
};

/* ---------------- LOGIN ---------------- */

exports.login = async (req, res) => {
  const { username, password } = req.body;

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return res.status(401).json({ error: "Invalid user name" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: "Invalid password" });

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  const refreshTokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      tokenHash: refreshTokenHash,
      userId: user.id,
      expiresAt: getRefreshExpiry(),
    },
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: false,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ accessToken });
};

/* ---------------- REFRESH TOKEN ---------------- */

exports.refresh = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);

    const hashed = hashToken(token);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashed },
    });

    if (!storedToken || storedToken.revoked) {
      // Reuse detected — revoke all
    //   revoked true represents using old token which is already used once, 
    // so we revoke all tokens of that user to prevent further misuse
      await prisma.refreshToken.updateMany({
        where: { userId: payload.userId },
        data: { revoked: true },
      });

      return res.status(403).json({ error: "Invalid refresh token" });
    }

    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
    });

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken(user);
    const newHash = hashToken(newRefreshToken);

    await prisma.refreshToken.create({
      data: {
        tokenHash: newHash,
        userId: user.id,
        expiresAt: getRefreshExpiry(),
      },
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ accessToken: newAccessToken });
  } catch (err) {
    console.error(err);
    return res.status(403).json({ error: "Invalid token" });
  }
};

/* ---------------- LOGOUT ---------------- */

exports.logout = async (req, res) => {
  const token = req.cookies.refreshToken;
  if (!token) return res.sendStatus(204);

  const hashed = hashToken(token);

  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashed },
    data: { revoked: true },
  });

  res.clearCookie("refreshToken");
  res.sendStatus(204);
};