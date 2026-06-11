# Authentication + Authorization Example

This project is a Node.js authentication and authorization example using:

- `Express` for the HTTP server
- `Prisma` as ORM for PostgreSQL
- `bcryptjs` for password hashing
- `jsonwebtoken` for JWT access and refresh tokens
- `cookie-parser` for refresh-token cookies

It demonstrates:

- Signup and login
- Access token authentication
- Refresh token rotation
- Role-based authorization
- Token revocation and safe cookie usage

---

## Project structure

Important files:

- `package.json`
- `prisma.config.ts`
- `prisma/schema.prisma`
- `src/prisma.js`
- `src/app.js`
- `src/server.js`
- `src/controllers/auth.controller.js`
- `src/middlewares/auth.middleware.js`
- `src/middlewares/role.middleware.js`
- `src/utils/hash.js`
- `src/utils/tokens.js`

---

## Prisma + PostgreSQL setup

### 1. Initialize npm

```bash
npm init -y
```

This creates `package.json` with defaults.

### 2. Install dependencies

```bash
npm install express bcryptjs cookie-parser dotenv jsonwebtoken @prisma/client
npm install --save-dev prisma typescript nodemon
```

### 3. Initialize TypeScript

```bash
npx tsc --init
```

Then update `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "rootDir": "src",
    "outDir": "dist",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

### 4. Add scripts to `package.json`

Example:

```json
"scripts": {
  "build": "tsc -b",
  "start": "node ./dist/index.js",
  "dev": "nodemon src/server.js",
  "prisma:migrate": "prisma migrate dev --name init",
  "prisma:studio": "prisma studio"
}
```

> In this repository the current entrypoint is `src/server.js`, so `dev` uses `nodemon src/server.js`.

### 5. Initialize Prisma

```bash
npx prisma init
```

This creates:

- `.env`
- `prisma/schema.prisma`
- `prisma/.gitignore`

### 6. Configure `.env`

Add:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/auth_demo"
ACCESS_TOKEN_SECRET="your_access_secret"
REFRESH_TOKEN_SECRET="your_refresh_secret"
PORT=5000
```

### 7. Write the Prisma schema

`prisma/schema.prisma` should contain:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  USER
  ADMIN
}

model User {
  id            Int      @id @default(autoincrement())
  username      String   @unique
  passwordHash  String
  role          Role     @default(USER)
  createdAt     DateTime @default(now())

  refreshTokens RefreshToken[]
}

model RefreshToken {
  id        Int      @id @default(autoincrement())
  tokenHash String   @unique
  revoked   Boolean  @default(false)
  createdAt DateTime @default(now())
  expiresAt DateTime

  userId Int
  user   User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

### 8. Migrate schema

```bash
npx prisma migrate dev --name init
```

This creates SQL migrations, applies them to PostgreSQL, and regenerates the Prisma client.

### 9. Generate Prisma Client

```bash
npx prisma generate
```

This creates the generated client under `node_modules/@prisma/client`.

> `prisma generate` does not create a top-level `generate` folder unless you explicitly configure a different output path.

---

## What Prisma does in this project

- `prisma.config.ts` configures Prisma CLI, schema location, migrations, and `DATABASE_URL`.
- `prisma/schema.prisma` defines the DB models and datasource.
- `src/prisma.js` exports a `PrismaClient` instance used by the backend.
- `@prisma/client` is the generated client package that exposes methods like `prisma.user.create()`.

### `@@index([userId])`

This creates a database index on the `userId` field in the `RefreshToken` table.

Why:

- makes queries by `userId` faster
- speeds up lookup when validating or revoking refresh tokens
- optimizes joins between `RefreshToken` and `User`

---

## Authentication flow

### Signup (`POST /signup`)

Controller: `src/controllers/auth.controller.js`

1. Client sends `username` and `password`.
2. Password is hashed with `bcrypt.hash(password, 10)`.
3. The user record is created in `User`.
4. Response:
   - `201 Created`
   - `{ id, username }`
5. If username already exists:
   - `409 Conflict`
   - `{ error: "Username already exists" }`

### Login (`POST /login`)

1. Client sends `username` and `password`.
2. Server finds user by username.
3. Password checked with `bcrypt.compare()`.
4. If invalid credentials:
   - `401 Unauthorized`
   - `{ error: "Invalid user name" }` or `{ error: "Invalid password" }`
5. If valid:
   - generate access token
   - generate refresh token
   - hash the refresh token
   - store the refresh token hash in DB
   - set refresh token as an HTTP-only cookie
   - respond with `accessToken`

Example response body:

```json
{ "accessToken": "..." }
```

### Why use cookie for refresh token?

The refresh token is sensitive, so it is stored in a cookie to protect it from JavaScript access.

Cookie options used:

- `httpOnly: true` — browser JS cannot read the cookie
- `secure: false` — should be `true` in production over HTTPS
- `sameSite: "strict"` — reduces cross-site request risks (CSRF)
- `maxAge: 7 * 24 * 60 * 60 * 1000` — cookie expires after 7 days

This means:

- the access token is returned in response body and used by the frontend for normal API calls
- the refresh token is stored in a cookie and used only to refresh the access token

### Does the browser send the cookie only for `/refresh`?

No — by default, cookies are sent for all matching requests on the same origin and path.

Since this cookie does not set `path`, its default path is `/`, so the browser may send it on any same-origin request.

However, the server only reads the cookie for the refresh/logout endpoints.

### How to send the refresh cookie only for `/refresh`

Set the cookie `path`:

```js
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: false,
  sameSite: "strict",
  path: "/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

That restricts the cookie to requests whose path begins with `/refresh`.

---

## Tokens used in this project

### Access token

- created by `generateAccessToken(user)` in `src/utils/tokens.js`
- payload contains `userId` and `role`
- expires in `15m`
- returned to frontend in JSON
- used by frontend in `Authorization: Bearer <accessToken>` header

### Refresh token

- created by `generateRefreshToken(user)` in `src/utils/tokens.js`
- payload contains `userId`
- expires in `7d`
- stored in DB as hashed value
- sent to browser as an HTTP-only cookie
- used only to refresh access tokens

### `getRefreshExpiry()`

The login code currently expects `getRefreshExpiry()` to return a future Date, for example:

```js
const getRefreshExpiry = () => {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
};
```

This value should match the refresh token lifetime and is used to populate the `expiresAt` field in the database.

---

## `/refresh` API flow (current implementation)

### Backend flow

1. Frontend calls `POST /refresh`.
2. Browser automatically sends the `refreshToken` cookie.
3. Server reads `req.cookies.refreshToken`.
4. If no cookie:
   - `401 Unauthorized`
   - `{ error: "Unauthorized" }`
5. Verify JWT using `REFRESH_TOKEN_SECRET`.
6. Hash the provided token with `hashToken(token)`.
7. Look up `RefreshToken` record by `tokenHash`.
8. If no record or `revoked`:
   - revoke all refresh tokens for that user
   - `403 Forbidden`
   - `{ error: "Invalid refresh token" }`
9. If valid:
   - mark the current refresh token record as revoked
   - load the user from `User`
   - issue a new access token
   - issue a new refresh token
   - store the new hashed refresh token in DB
   - set a new refresh token cookie
   - respond with `{ accessToken: newAccessToken }`

### Why the current token rotation logic exists

- the old refresh token is invalidated after use
- a new refresh token is created for the next refresh
- this prevents reuse of a token that has already been used
- if an attacker tries to reuse an old refresh token, the system can revoke all tokens for the user

### Status codes for refresh

- `200 OK` — refresh succeeded and a new access token is returned
- `401 Unauthorized` — no refresh cookie present
- `403 Forbidden` — invalid/expired/used refresh token

### Frontend flow

1. Use the current `accessToken` on API requests.
2. If a protected request fails because the token is expired or invalid, call `/refresh`.
3. Browser sends the refresh cookie automatically.
4. If refresh succeeds:
   - save the new access token
   - retry the failed request
5. If refresh fails:
   - treat the session as expired
   - clear any stored access token or auth state
   - redirect the user to the login page
   - optionally show a message like `Session expired, please log in again`

### What if the refresh token itself expires?

- `jwt.verify()` fails
- server returns `403 Invalid token`
- refresh does not succeed
- frontend must clear auth state and prompt login again

This is the point where the user is forced to log in again.

---

## Two refresh API designs

### Version 1: refresh API with token rotation (current)

This is the implementation in the project.

Frontend:

- `accessToken` is stored client-side and used for normal API requests
- refresh token is stored as an HTTP-only cookie
- frontend calls `POST /refresh` when the access token expires or fails
- browser sends the refresh cookie automatically

Backend:

- reads the refresh token from `req.cookies.refreshToken`
- verifies the JWT with `REFRESH_TOKEN_SECRET`
- hashes the token and looks up the DB record
- if the token is invalid, missing, or already revoked:
  - rejects with `403 Forbidden`
- if valid:
  - mark the current refresh token record as revoked
  - generate a new refresh token and a new access token
  - store the new refresh token hash in DB
  - set a new refresh cookie
  - return the new access token

Advantages:

- refresh token is not accessible from JavaScript
- safer against XSS
- explicit reuse detection and revocation
- automatically replaces the refresh token on each refresh

Disadvantages:

- DB stores multiple refresh token records unless cleaned up
- browser cookie is sent on matching same-origin requests unless the cookie path is restricted

### Version 2: refresh API without token rotation

This variant uses a long-lived refresh token that is reused until it expires.

Frontend:

- `accessToken` is stored client-side and used for normal API requests
- refresh token can still be stored in an HTTP-only cookie or sent in request body/header
- frontend calls `POST /refresh` when the access token expires

Backend:

- reads the refresh token from cookie or request body/header
- verifies the JWT and DB record
- if valid:
  - optionally keep the existing refresh token record unchanged
  - generate a new access token only
  - return the new access token
- if invalid or expired:
  - reject with `403 Forbidden`

Advantages:

- DB stays smaller because old refresh tokens are not retained for rotation
- simpler refresh logic

Disadvantages:

- if the refresh token is stolen, it can be reused until expiry
- less secure than rotation
- replay detection is weaker because the same token remains valid

### Which design is better?

For security, token rotation is generally better:

- it prevents reuse of a token after refresh
- it allows the server to revoke a specific refresh token after use
- it provides a stronger signal when reuse is detected

For simplicity, no-rotation refresh is easier, but it is less robust.

### Cookie path restriction for refresh-only delivery

If you keep the refresh token in a cookie and want it sent only for `/refresh`, set `path: "/refresh"`:

```js
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: false,
  sameSite: "strict",
  path: "/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

This makes the cookie eligible only for requests whose path begins with `/refresh`.

### Practical recommendation

- use token rotation if you want stronger security and reuse detection
- use an HTTP-only cookie for the refresh token when possible
- restrict the cookie path if you want the cookie to be sent only on refresh API calls
- if you choose no rotation, still expire the refresh token and handle `403` by forcing a login

---

## Authorization flow

### Middleware

- `src/middlewares/auth.middleware.js` implements `protect`
- `src/middlewares/role.middleware.js` implements `authorize(...)`

### `protect`

1. reads `Authorization` header
2. expects `Bearer <accessToken>`
3. verifies token with `ACCESS_TOKEN_SECRET`
4. stores decoded payload in `req.user`
5. if missing or invalid:
   - `401 Unauthorized` if no header
   - `403 Forbidden` if token verification fails

### `authorize(...allowedRoles)`

1. checks `req.user`
2. if not present:
   - `401 Unauthorized`
3. if `req.user.role` is not allowed:
   - `403 Forbidden`
4. otherwise allows access

### Example protected routes in `src/app.js`

```js
app.get('/profile', protect, (req, res) => {
  res.json({ message: 'User profile', user: req.user });
});

app.delete('/admin/delete-user/:id', protect, authorize('ADMIN'), async (req, res) => {
  res.json({ message: 'User deleted (Admin only)' });
});

app.get('/dashboard', protect, authorize('ADMIN', 'USER'), (req, res) => {
  res.json({ message: 'Dashboard access allowed' });
});
```

### Status codes in protected routes

- `401 Unauthorized` — missing or malformed access token
- `403 Forbidden` — invalid access token or role not allowed
- `200 OK` — authorized access granted

---

## Cookie lifetime and expiry

`maxAge: 7 * 24 * 60 * 60 * 1000` means the refresh cookie is valid for 7 days.

After that age crosses:

- the browser marks the cookie expired
- it will stop sending it automatically
- it is effectively removed from browser storage
- on the next refresh attempt, the user will need to log in again if the token is expired

---

## Refresh token rotation and database growth

The current implementation does create a new `RefreshToken` row each time refresh occurs.

That means the DB can accumulate rows over time for a user.

### Why the code marks tokens revoked instead of deleting them

When a refresh token is used:

```js
await prisma.refreshToken.update({
  where: { id: storedToken.id },
  data: { revoked: true },
});
```

This is used instead of deleting because:

- it preserves an audit trail
- it explicitly marks "used before"
- it differentiates revoked tokens from tokens that were never issued
- reuse detection is easier and safer

### Will the user never be forced to login again?

No.

The refresh token itself still has an expiry (`7d`).
If the client stops refreshing before that expiry, the refresh token will expire and the user must log in again.

This means:

- normal use with regular refresh requests can keep the session alive
- inactivity longer than the refresh token lifetime forces re-authentication

### Recommended production improvement

- periodically delete old revoked/expired refresh tokens
- or keep only the latest refresh token per device/session
- add absolute session expiry if you want a hard maximum login time

---

## Frontend behavior summary

### Normal request flow

1. User logs in.
2. Frontend stores `accessToken`.
3. Browser stores `refreshToken` cookie automatically.
4. Frontend sends protected requests with `Authorization: Bearer <accessToken>`.

### On access token expiry

Option 1: detect by token expiry

- decode the JWT
- compare `exp` to now
- refresh before it expires

Option 2: detect by server response

- make a request
- if response is `401` or `403`, call `/refresh`

### Refresh request

- frontend calls `POST /refresh`
- browser sends cookie automatically
- backend rotates refresh token and returns a new access token
- frontend saves the new access token and retries protected calls

### If refresh fails

- refresh token is expired or invalid
- backend returns `403`
- frontend should clear auth state and ask the user to log in again

---

## Backend flow summary

### Signup
- create `User`
- hash password
- respond `201`

### Login
- verify credentials
- generate access token
- generate refresh token
- store refresh token hash in DB
- set refresh token cookie
- respond `200` with access token

### Protect route
- read `Authorization` header
- verify access token
- set `req.user`
- allow or deny access

### Authorize route
- check `req.user.role`
- allow only the permitted roles

### Refresh
- read refresh cookie
- verify refresh JWT
- validate DB token hash
- revoke current token row
- create new refresh token row
- set new refresh cookie
- return new access token

### Logout
- read refresh cookie
- revoke matching token rows
- clear cookie
- return `204 No Content`

---

## Status codes used in this project

- `201 Created` — signup success
- `200 OK` — login success, refresh success, dashboard/profile success
- `204 No Content` — logout success or no refresh token present during logout
- `401 Unauthorized` — missing credentials or missing cookie
- `403 Forbidden` — invalid token, invalid refresh token, or unauthorized role
- `409 Conflict` — signup username already exists

---

## Notes for this repository

- `prisma generate` generates the client under `node_modules/@prisma/client`
- `res.cookie(...)` with no `path` means the refresh cookie is available for same-origin requests by default
- to restrict it to only refresh endpoint, use `path: "/refresh"`
- `getRefreshExpiry()` should be implemented in `src/utils/tokens.js` if not already present

---

## Recommended next step

If you want, the next step is to add a `README` section with example frontend code for:

- storing the access token
- calling protected APIs
- calling `/refresh`
- retrying a failed request after refresh
- logging the user out
