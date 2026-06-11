# Security Concepts for Authentication / Authorization

This file explains how authentication, refresh tokens, and CSRF protection work together in this project.

## Summary

This project separates two token flows:

- Access tokens are stored in memory on the frontend and sent in `Authorization: Bearer <accessToken>` headers for protected API calls.
- Refresh tokens are stored in an `httpOnly` cookie and used only by the `/refresh` endpoint to mint new access tokens.

There are two main scenarios:

- Same-site flow:
  - Use `SameSite="Strict"` (or `Lax` when needed) for the refresh cookie when frontend and backend are same-origin or same-site.
  - The browser will only send the refresh cookie on same-site requests, which blocks cross-site CSRF attempts.
  - The refresh endpoint validates and rotates the refresh token, while protected APIs use the access token header.

- Cross-site flow:
  - Use `SameSite="None"`, `Secure: true`, and `httpOnly` for the refresh cookie when the frontend and backend are on different origins.
  - The backend must allow only the trusted frontend origin via CORS and set `credentials: true`.
  - The frontend must call `/refresh` with `credentials: 'include'`.
  - `credentials: 'include'` allows the browser to attach cookies on that request, but it is not the same thing as `Secure: true`.
  - Without `credentials: 'include'`, cookies are not automatically attached to every cross-origin fetch request.

Key protections in both cases:

- `httpOnly` protects the refresh cookie from JavaScript access and XSS extraction.
- `SameSite` mitigates CSRF by controlling when the browser sends the cookie.
- `path: "/refresh"` limits the cookie to the refresh route.
- CORS and origin validation add extra safety for cross-site requests.
- Storing access tokens in memory and using header auth for APIs avoids CSRF for normal requests.

---

## 1. Where to store the access token in the frontend

### Recommended storage: in memory

“In memory” means the access token is kept only in the running JavaScript application, such as:

- a variable in a module
- React state or context
- a Redux store
- any runtime-only object

This is the safest option because the token is not written to persistent browser storage.

### What memory storage means

- the token exists only while the page/tab is open
- it is not saved to `localStorage`, `sessionStorage`, or cookies
- it is lost on page refresh, tab close, or browser shutdown

### Why in-memory storage is preferred

- it reduces XSS exposure
- JavaScript on other pages cannot read it if it is not persisted
- it forces a refresh flow or login after reload

### Alternative storage options (less safe)

- `localStorage`
  - persists across reloads
  - vulnerable to XSS if the site is compromised
- `sessionStorage`
  - persists across reloads in the same tab only
  - still vulnerable to XSS
- cookies
  - can be protected with `httpOnly`
  - but if used for access tokens, CSRF becomes a risk

### Best practice for this project

- store the access token in memory
- send it in `Authorization: Bearer <accessToken>` headers for protected API calls
- use the refresh token only to mint new access tokens

---

## 2. What is CSRF?

CSRF stands for Cross-Site Request Forgery.

### How it works

- the user is logged into `example.com`
- the browser stores the site cookie for `example.com`
- an attacker creates a malicious page on `evil.com`
- the malicious page causes the browser to send a request to `example.com`
- because the browser automatically attaches cookies, `example.com` sees the request as authenticated

The attacker does not need to know the cookie value. The browser sends it automatically.

### Why CSRF is dangerous

CSRF can make authenticated users perform actions they did not intend, such as:

- changing account settings
- making transactions
- logging out other sessions
- refreshing tokens if the refresh endpoint is not protected

---

## 3. Why cookies can be vulnerable to CSRF

Cookies are automatically sent by the browser when:

- the request goes to the cookie’s domain
- the request path matches the cookie path
- the cookie is not expired
- same-site rules allow it

That means if a refresh token is stored in a cookie, a malicious site may be able to trigger a request to `/refresh` or another endpoint and the browser will attach the cookie.

Even if the cookie is `httpOnly`, CSRF still works because the attacker does not need JavaScript access to the cookie.

> `httpOnly` protects against XSS, but not CSRF.

---

## 4. How to protect cookies from CSRF attacks

### 4.1 Use `SameSite` cookies

Set the cookie attribute to `SameSite=Strict` whenever possible.

Example:

```js
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

`SameSite=Strict` prevents the browser from sending the cookie on cross-site requests.

### 4.2 Restrict the cookie path

Set `path: "/refresh"` to limit the cookie to the refresh endpoint.

This helps ensure the cookie is not sent on unrelated requests.

### 4.3 Use CSRF tokens for state-changing requests

For any endpoint that uses cookies for authentication or authorization, require a CSRF token in the request.

Flow:

1. server issues a CSRF token to the frontend
2. frontend stores it in JavaScript-accessible storage
3. frontend sends it as a header or body field
4. server validates it before processing the request

### 4.4 Require custom headers + CORS policies

If your API requires a custom header such as:

- `Authorization`
- `X-CSRF-Token`

then browsers only send those headers on cross-site requests if the server explicitly allows the origin via CORS.

This makes CSRF attacks harder because malicious sites cannot add custom headers without permission.

### 4.5 Validate `Origin` / `Referer`

As an additional layer, verify that requests come from your expected origin.

If the `Origin` or `Referer` header does not match your frontend domain, reject the request.

---

## 5. How these concepts apply to this project

### Recommended design

- store access tokens in memory on the frontend
- use `Authorization: Bearer <accessToken>` for protected APIs
- store refresh tokens in `httpOnly` cookies only for `/refresh`
- protect the refresh cookie with `SameSite="strict"` and `path: "/refresh"`

### If cookies are used for refresh

- `httpOnly` protects against XSS
- `SameSite` helps protect against CSRF
- `path: "/refresh"` limits exposure
- the refresh route should still validate tokens and revoke invalid ones

### What to do if CSRF protection is needed beyond cookies

- use CSRF tokens on sensitive state-changing endpoints
- enforce CORS and custom request headers
- validate request origin

---

## Cross-site refresh flow

When the frontend and backend are on different origins, the refresh cookie must be allowed cross-site and the backend must permit only the trusted frontend.

### Backend cookie settings

```js
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "none",
  path: "/refresh",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
```

This tells the browser it may send the refresh cookie across origins.

### Backend CORS policy

Configure CORS so only your frontend origin is allowed:

```js
const cors = require('cors');

app.use(cors({
  origin: 'https://app.example.com',
  credentials: true,
}));
```

### Frontend request

The frontend must include credentials when calling `/refresh`:

```js
const response = await fetch('https://api.example.com/refresh', {
  method: 'POST',
  credentials: 'include',
});
```

#### What `credentials: 'include'` means

- it instructs the browser to send cookies with this request, even across origins
- it is required for cross-site requests when the backend depends on cookies
- without it, the browser will not attach the refresh cookie on the request

#### Why `Secure: true` and `credentials: 'include'` are different

- `Secure: true` is a cookie attribute. It means the browser will only send that cookie over HTTPS.
- `credentials: 'include'` is a fetch option. It means the browser should attach cookies to this cross-origin request, otherwise cookies are not automatically attached to every cross-origin fetch request by default
- both are needed for secure cross-site refresh, but they solve different problems.
- `Secure: true` protects the cookie transport; `credentials: 'include'` enables cookie sending for the request.

#### How this works

- the browser will only attach the refresh cookie if the request is made with credentials
- the backend must also allow credentials via CORS: `Access-Control-Allow-Credentials: true`
- both sides must agree before cross-site cookie-based auth works

### Why this is secure

- `SameSite=None` allows cross-site cookie sending only for this cookie
- `Secure` requires HTTPS
- CORS allows only the trusted frontend origin
- the browser sends the cookie only when the request includes credentials

### Recommended additional check

On the backend, validate the `Origin` header:

```js
const origin = req.get('Origin');
if (origin !== 'https://app.example.com') {
  return res.status(403).json({ error: 'Forbidden origin' });
}
```

This prevents other sites from using your refresh endpoint even if the browser sends cookies.
---

## 6. Summary

This project separates two token flows:

- Access tokens are stored in memory and sent in `Authorization: Bearer <accessToken>` headers.
- Refresh tokens are stored in `httpOnly` cookies and used only by the `/refresh` endpoint.

For same-site deployments:

- prefer `SameSite="Strict"` (or `Lax` when appropriate) for the refresh cookie.
- the browser only sends the cookie on same-site requests, reducing CSRF risk.
- protected APIs remain safe because they use the access token header.

For cross-site deployments:

- set `SameSite="None"`, `Secure: true`, and `httpOnly` on the refresh cookie.
- allow only the trusted frontend origin in CORS and `Access-Control-Allow-Credentials: true`.
- use `fetch(..., { credentials: 'include' })` on the frontend so the browser sends the refresh cookie.
- `credentials: 'include'` is not the same as `Secure: true`; both are required for secure cross-site refresh.

Key defenses:

- `httpOnly` protects refresh tokens from JavaScript/XSS access.
- `SameSite` controls when the browser includes cookies, mitigating CSRF.
- `path: "/refresh"` limits cookie exposure to the refresh endpoint.
- CORS and origin validation add an extra layer for cross-site flows.
- storing access tokens in memory keeps normal API requests free from CSRF risk.