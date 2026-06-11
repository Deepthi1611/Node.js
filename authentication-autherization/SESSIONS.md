# Sessions in Authentication

## What are sessions?

A session is a server-side record that represents a user's authenticated state after they log in.

Instead of the user carrying all their identity information in the client, the server keeps track of who is logged in.

```
JWT approach:
User carries: "I am John, my ID is 123" (token)
Server: "OK, I believe you"

Session approach:
Server keeps: "Session ABC123 belongs to John (ID 123)"
User carries: "I have session ABC123" (cookie)
Server: "Let me check... yes, you're John"
```

---

## How sessions are used

### Step 1: User logs in

- User submits username and password.
- Server validates credentials.
- Server creates a session object with data such as:
  - sessionId
  - userId
  - login time
  - role or permissions
- Server stores the session in memory, a database, or a cache.

### Step 2: Server sends a session ID to the client

- Server responds with a cookie like:
  `Set-Cookie: sessionId=abc123xyz; HttpOnly; Secure; SameSite=Strict`
- The browser stores the cookie automatically.

### Step 3: User makes subsequent requests

- On later requests, the browser automatically sends the cookie to the server.
- Example request header:
  `Cookie: sessionId=abc123xyz`

### Step 4: Server validates the session

- The server reads `sessionId` from the request cookie.
- It looks up the matching session record.
- If the session exists and is valid, the request is authenticated.

---

## Session syntax in Express.js

### Setup

```js
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const redisClient = createClient();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60,
    path: '/'
  }
}));
```

### Login - creating a session

```js
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;

  res.json({ message: 'Logged in' });
});
```

### Protected route - using the session

```js
app.get('/profile', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({
    userId: req.session.userId,
    username: req.session.username,
  });
});
```

### Logout - destroying the session

```js
app.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).send('Error logging out');

    res.clearCookie('sessionId');
    res.json({ message: 'Logged out' });
  });
});
```

---

## Why use sessions when JWT exists?

### Sessions vs JWT comparison

| Feature | Sessions | JWT |
|---------|----------|-----|
| Storage | Server stores state | Token carries state |
| Revocation | Instant and easy | Harder; usually wait for expiry or use a blocklist |
| Scalability | Needs shared session store | Stateless, easier to scale |
| Data size | Small (just ID) | Can be larger |
| Logout | Simple (delete session) | Complex |
| Control | Centralized on server | Distributed verification |

### When sessions are better

Use sessions when:

- you need instant logout for all devices
- you want centralized session revocation
- you want to store server-side data safely
- you have a monolithic backend or a single trusted app

### When JWTs are better

Use JWTs when:

- you need stateless authentication across services
- you have mobile apps or microservices
- you want to avoid session store overhead

### When to use both

A hybrid approach is common:

- short-lived JWT access tokens for API calls
- long-lived refresh tokens or session records for renewal and control
- server can revoke refresh sessions while still using JWTs for stateless access

### Example flows

#### JWT-only flow

1. User logs in and receives a JWT from `/login`.
2. Client stores the JWT in memory or app state.
3. Client sends every protected request with:
   `Authorization: Bearer <accessToken>`
4. Server verifies the JWT signature and claims.
5. If the JWT is valid, the request succeeds.

- Logout/revocation is difficult because the token is stateless.
- The server usually waits for token expiry or uses a blacklist.
- Good for mobile apps, APIs, and services that need stateless auth.

#### Session-only flow

1. User logs in and server creates a session record.
2. Server stores a session ID in a cookie (`sessionId=abc123`).
3. Browser sends `Cookie: sessionId=abc123` on each request.
4. Server looks up the session and authenticates the user.
5. Logout is simple: delete the session and clear the cookie.

- The server keeps state in a session store.
- Revocation is immediate and central.
- This is common for traditional web apps.

#### Hybrid flow (current project)

1. User logs in and server returns a short-lived access token in the response body.
2. Server also sets a refresh token in an `httpOnly` cookie.
3. Client uses the access token for protected API calls.
4. When the access token expires, the client calls `/refresh`.
5. The browser sends the refresh cookie automatically to `/refresh`.
6. Server validates and rotates the refresh token, then issues a new access token.

- Access tokens are still stateless for API requests.
- Refresh control stays on the server for revocation and rotation.
- This gives stronger security than JWT-only, while avoiding full session state for every API call.

This project uses a hybrid pattern:

- Access token = short-lived JWT
- Refresh token = secure cookie used to get a new JWT
- Refresh control remains on the server to allow revocation

---

## Simple analogy

### Sessions

- Server stores the passport at home
- User carries a receipt or session ID
- The server checks the receipt and then validates the user

### JWTs

- User carries a signed letter that already says who they are
- Any trusted server can verify the signature without asking the original server
- Harder to revoke immediately

### Hybrid

- User carries a signed letter (JWT)
- The letter is refreshed using a stamp or secret held on the server
- The server can still block refreshes and revoke access if needed
