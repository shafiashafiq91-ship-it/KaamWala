# Customer and Worker Accounts

## 1. What it does

KaamWala now opens on a welcome screen with the logo, the line **"Trusted Workers, Safer Homes."** and two choices:

- **I Need a Service**: "Find trusted professionals for your home." → **Continue as Customer**
- **I Want to Provide Services**: "Join KaamWala and grow your service business." → **Continue as Worker**

Each choice leads to its own sign-up. After that, customers and workers get different dashboards and profiles in the same
app and design (navy/teal, English/اردو). One person can hold both roles on **one account**, with one phone number and
one login, and switch between them. The customer profile and the worker profile stay separate.

This builds on the existing app. Booking, escrow, add-on requests, the JazzCash/EasyPaisa flow and the admin panel all
work as before. All 29 earlier tests still pass, and 16 new ones were added.

## 2. Flows

**Customer sign-up** (2 steps): profile picture (optional), full name, mobile number (+92 shown, any of `0300…`, `300…`,
`+92 300…` accepted), email (optional), password (8+ characters, letters and numbers), city → phone code → account created → home.

**Worker sign-up** (4 steps):
1. Account: picture (optional), name, mobile, email (optional), password.
2. Work: city, service area, main service, additional skills, years of experience, short bio, starting price, working
   days, working hours, preferred locations.
3. Phone code and acceptance of the worker terms.
4. Verification documents: CNIC front and back (required), selfie with CNIC and certificate/licence (optional). This step can be skipped and done later.

The new worker profile starts as **Not verified yet**. It changes to **Verification pending** once a document is uploaded.
It is **hidden from customers** in search, categories, profile pages and booking until an admin verifies it.

**Admin verification** (`/admin.html` → Worker verification): a queue of new workers with their details and private
document buttons. **Verify** needs both CNIC sides on file and sets the profile to **Verified**, which lists it and shows
the **Verified Worker** badge. **Reject** needs a note, which the worker sees, and keeps the profile hidden. A new upload
sends the profile back to the queue. The worker gets an in-app notification for either decision.

**Second role**: a customer taps **Become a KaamWala worker** on their profile and fills in the work details (same
account, separate worker profile, needs verification). A worker taps **Book services as a customer**. Once both
roles exist, the same card says **Switch to worker account** / **Switch to customer account**. The active role is saved
in the database, so the user comes back to it after logging out and in.

**Login**: mobile + password, or mobile + one-time code. Five wrong attempts lock that number for 15 minutes.

## 3. Screens

| Screen | Route |
|---|---|
| Welcome / role choice | `#/welcome` |
| Login (password or code) | `#/login` |
| Customer sign-up / worker sign-up | `#/register/customer`, `#/register/worker` |
| Customer home: search, categories, nearby verified workers with rating, price, next slot, **Book Now** | `#/home` |
| Worker public profile: photo, Verified badge (only if verified), rating, completed jobs, bio, checks, prices, hours, portfolio, reviews, favourite, report, block | `#/worker/:id` |
| Booking form: problem, **photos**, date/time, saved-address chips, JazzCash/EasyPaisa | `#/book/:workerId` |
| My bookings: Upcoming / Completed / Cancelled | `#/bookings` |
| Customer profile: picture, name, +92 phone, city, edit, role card, bookings, saved addresses, favourites, reviews given, payments, help, report a problem, blocked people, password, language, logout | `#/profile` |
| Edit profile, saved addresses, favourites, reviews given, payments, blocked people, help, password | `#/edit-profile`, `#/addresses`, `#/favourites`, `#/my-reviews`, `#/payments`, `#/blocked`, `#/help`, `#/password` |
| Worker dashboard: earnings in escrow, released this month, completed jobs, rating; verification banner; **available on/off**; new requests with **Accept / Decline**; upcoming and ongoing; earnings and payout status; disputes and support | `#/home` (worker) |
| Worker jobs: New / Upcoming / Ongoing / Completed / Cancelled | `#/bookings` (worker) |
| Worker profile: picture, name, verification status, category, skills, experience, area, prices, hours, rating, reviews, completed jobs, portfolio, bio, documents, payout wallet, edit | `#/profile` (worker) |
| Edit worker profile (availability, hours, prices, skills, area, bio, picture) | `#/worker-edit` |
| Verification documents (private) | `#/documents` |
| Become a worker (adds the worker role) | `#/become-worker` |
| Admin verification queue | `/admin.html#workers` |

**Booking statuses** shown to both sides: Pending → Accepted → On the way → In progress → Awaiting customer approval
(job marked done, money still in escrow until the customer confirms or 72 h pass) → Completed. Plus Cancelled and Disputed.
The worker sees the customer's **phone and full address only after accepting**. Before that they see the area, the
problem and the photos.

## 4. Database and API

New tables: `user_roles` (one row per role per user), `customer_profiles`, `addresses`, `favourites`, `blocks`,
`worker_documents`, `otp_codes`.
New columns:
- `users`: `email`, `password_hash`, `created_at`
- `workers`: `verification` (unsubmitted / pending / verified / rejected), `verification_note`, `verified_at`, `verified_by`, `bio`, `city`, `hours_from`, `hours_to`, `work_days`, `preferred_locations`, `available`, `photo_id`
- `media`: `purpose`, `booking_id`
- `sessions`: `expires_at`

Existing databases are upgraded automatically on start. Workers that were already CNIC-checked become `verified`.

```
POST /api/otp                     {phone, purpose: register|login}
POST /api/register                {role, name, phone, otp, password, email?, city, + worker fields}
POST /api/login                   {phone, password} or {phone, otp}
POST /api/logout
GET/PATCH /api/me                 account + roles + customer profile + worker profile
POST /api/me/password             {current, password}; signs out other devices
POST /api/me/roles                {role, ...}: add the other role to this account
POST /api/me/role                 {role}: switch active role (saved)
GET/POST /api/addresses, PATCH/DELETE /api/addresses/:id        customer
GET /api/favourites, POST/DELETE /api/favourites/:workerId      customer
GET/POST /api/blocks, DELETE /api/blocks/:userId                customer or worker
GET /api/me/reviews, GET /api/me/payments                       customer
GET /api/worker/profile, PATCH /api/worker                      worker (prices, hours, availability, …)
POST /api/worker/documents?kind=…  (raw image/PDF), DELETE /api/worker/documents/:id
GET /api/documents/:id            owner worker or admin only, never cached
DELETE /api/worker/portfolio/:id
POST /api/uploads?purpose=avatar|booking|portfolio|addon
GET /api/admin/verifications, POST /api/admin/workers/:id/verification {decision, note}
```

Code: `src/auth.js` (passwords, phones, tokens, codes, lockout), `src/accounts.js` (all of the above), changes in
`src/server.js` (listing rules, booking photos, statuses, privacy, notifications) and `src/db.js` (schema, migration, demo data),
`public/app.js`, `public/i18n.js`, `public/styles.css`, `public/admin.html`.

## 5. Security and the rules from the brief

| Rule | How it is enforced |
|---|---|
| Secure authentication | Passwords hashed with scrypt and a random salt per user; hashes never sent to the app. Session tokens are random and stored only as SHA-256 hashes, and expire after 30 days. Changing the password signs out other devices. |
| OTP | Codes are stored hashed, expire in 5 minutes, allow 5 tries, work once, and are limited to 5 per number per hour. With `SMS_API_URL`/`SMS_API_KEY` set, codes are random 6 digits sent by SMS and the demo code stops working. |
| Brute force | 5 wrong passwords or codes lock the number for 15 minutes. |
| No duplicate accounts | Phone numbers are unique. Sign-up with an existing number is refused, and a second role is added to the same account instead. |
| Role-based access | Every endpoint checks the active role on the server (customers can't edit worker profiles or upload documents; workers can't manage customer addresses; admins only for admin routes). |
| Private documents | Stored outside the public folder in `private/`, with random 128-bit ids. Only the uploading worker and admins can open them (`Cache-Control: no-store`). They are never listed on public profiles or reachable through the public media links. |
| No automatic verification | Uploading only moves the profile to *pending*. Only an admin's **Verify** (with both CNIC sides on file) sets *verified*, and only then is the badge shown and the worker listed. |
| Customer contact privacy | Phone and full address are hidden from the worker until they accept. Payout wallets and internal notes are never in public worker data. |
| Report and block | Report a problem / report worker go to Admin → Complaints. Blocking hides both sides from each other's search and stops new bookings and messages. A block reason is also filed as a complaint. A worker can only block customers who booked them. |
| Reviews | Only the booking's own customer, only after the job is completed. |
| Payments | Unchanged: shown as paid only after JazzCash/EasyPaisa confirm it (or the sandbox simulator when no credentials are set). Payment history shows *Paid · confirmed by JazzCash*, *Not completed* or *Failed* from the payment record. |
| Prices | Workers change prices for new bookings only. Bookings keep the agreed price. |

## 6. Tests

`test/accounts.test.js`: 16 scenarios. `npm test` runs all 45 (all passing):
customer sign-up with +92 number and hashed password; validation (duplicate number, weak password, wrong code, bad
email); lockout after 5 wrong passwords; codes single-use and expiring with an SMS provider set; worker sign-up hidden
until verified and upload not verifying; document privacy (owner/admin only, not via media links, stored outside
public); admin verify/reject rules and badge; two roles on one account with role kept after re-login and separate
photos; a worker can't book themself; addresses/favourites/payments/reviews given; reviews only after completion by
that customer; booking photos and customer details hidden before acceptance; blocking both ways; price and
availability changes; portfolio; password change signing out other devices.

**Manual check**: start the app (`npm start`) and open it. It shows the welcome screen. Sign up as a worker, upload two
photos as the CNIC, then log in as admin (`03000000000` / `kaam1234`) and verify them. Log in as Ahmed
(`03001234567` / `kaam1234`) and find the new worker. Log in as Ali (`03011111111` / `kaam1234`) to see a worker who
can switch to his customer account.

## 7. Needs outside setup before launch

- **SMS codes**: easiest is Firebase Phone Login, which is built in: set `FIREBASE_PROJECT_ID` and `FIREBASE_API_KEY` (steps in [FIREBASE.md](FIREBASE.md)). Firebase sends and checks the code, and the server checks Firebase's signed token and that its phone number matches. Or use another SMS gateway (for example a Pakistani bulk-SMS provider or Twilio). Set
  `SMS_API_URL`, `SMS_API_KEY`, and adapt `sendSms` in `src/auth.js` to that provider's request format. Until then the app
  is in demo mode and every code is `1234`.
- **Payments**: JazzCash and EasyPaisa still need merchant approval and credentials. Without them the simulator is used and no real money moves.
- **Document storage**: documents are on the server disk with owner/admin-only access. For production, use encrypted
  private cloud storage, and agree a retention period for CNIC copies.
- **CNIC checks** are manual by admins. Automated NADRA verification would need a separate agreement.
- **Your brief was cut off** in section 7 ("…"). Everything up to that point is built. Send the rest and I'll add it.
