# KaamWala

**Trusted Workers, Safer Homes.** KaamWala is a home services marketplace for Pakistan (starting in Lahore).
Customers find and book verified workers: electricians, plumbers, AC technicians, carpenters, painters,
appliance repair and cleaning. The visit fee is paid through **JazzCash or EasyPaisa** into escrow, and the money
is released to the worker only after the job is done.

In short:

- **Customers** search by category, compare verified workers (checks, rating, visit fee), book with photos, track the job, pay into escrow, release payment and leave a review.
- **Workers** sign up, upload their CNIC for verification, accept or decline requests, request paid **add-ons** when they find extra work on site, and see their earnings and payouts.
- **Login** is by mobile number with a password or a one-time SMS code. Real codes are sent with **Firebase Phone Auth** once it is set up; until then the demo code `1234` works.
- **Worker verification**: new workers stay hidden from customers until an admin checks their CNIC documents.
- **Admin panel** (`/admin.html`): worker verification, add-on review, disputes, escrow and payouts, complaints.
- English and Urdu (right-to-left), mobile-first web app that can be installed as a PWA.

The app was built from `KaamWala_MVP_Pitch_Deck.pptx` (the app demo is slides 8–10).

## Tech

- Node.js 22.5+ with **no npm dependencies** (built-in `node:http`, `node:sqlite`, `node:test`).
- **Database: SQLite**, one file at `data/kaamwala.db` (change with `DB_FILE`). Uploaded photos and private
  CNIC documents are stored on disk in `data/uploads` (change with `UPLOAD_DIR`).
- Optional: a copy of all data (and uploaded files) in Firebase Cloud Firestore, and Firebase Phone Auth for SMS codes ([FIREBASE.md](FIREBASE.md)).
- Free hosting on Render + Firebase, step by step: [DEPLOY.md](DEPLOY.md).
- Plain HTML/CSS/JS front end in `public/`, served by the same server.

## Run it

1. Install Node.js 22.5 or newer (`node -v` to check). There is no `npm install` step.
2. Optional: copy the settings file. Without it, everything runs in demo mode (payment simulator, code `1234`).
   ```bash
   cp .env.example .env
   ```
3. Start the app and open <http://localhost:3000>:
   ```bash
   npm start
   ```
   The database is created and filled with demo workers on the first start.
4. Run the tests (accounts, add-ons, escrow, payment signing, Firebase):
   ```bash
   npm test
   ```

To start again with fresh demo data, stop the app and delete the `data/` folder (if Firestore is connected, the app reloads data from Firebase instead).

The app opens on a welcome screen: **I Need a Service** (customer sign-up) or **I Want to Provide Services** (worker sign-up).

Demo logins: password `kaam1234` (where shown) or the one-time code `1234` (only while Firebase Phone Auth and SMS are not set up):

| Role     | Mobile        | Password |
|----------|---------------|----------|
| Customer (Ahmed Khan) | 03001234567 | kaam1234 |
| Worker + customer (Ali Raza, electrician; one account, two roles) | 03011111111 | kaam1234 |
| Worker (Usman Khalid, plumber; has the add-on demo) | 03044444444 | code only |
| Admin    | 03000000000   | kaam1234 |

Accounts, roles, profiles and worker verification are described in [ACCOUNTS.md](ACCOUNTS.md).

## What's in it

From the deck:
- Home: location (Lahore area), search, the 7 service categories, nearby verified workers
- Worker list with Verified ID / 4.5+ rating / Today filters and visit fee shown up front
- Worker profile with separate checks (CNIC, phone & address, references, skill assessment), documented vs self-reported experience, est. charges, today's slots
- Confirm booking (visit fee, repair quoted on site, extra work needs approval) and tracking: Requested → Confirmed → Worker on the way (ETA) → Work in progress → Completed, with Call and Support
- Reviews only from completed bookings; complaints / misconduct reports
- Messages per booking, Bookings history, Profile
- Full English / Urdu (right-to-left) switch
- **Accounts** (see [ACCOUNTS.md](ACCOUNTS.md)): welcome screen, customer and worker registration with phone code and password, one account with both roles, customer profile (addresses, favourites, reviews given, payments, blocking), worker profile and dashboard, private verification documents and admin verification
- Worker app: new requests with accept/decline, job tabs, availability on/off, hours and prices, portfolio, earnings and payout status, add-on requests
- **Add-on service requests** (extra work found on site, approved by the customer before it starts): see [ADDONS.md](ADDONS.md)
- Itemized invoice with price history, in-app notifications
- Admin panel (`/admin.html`): worker verification, add-on review, disputes, escrow and payouts, complaints

## Escrow

1. Customer picks JazzCash or EasyPaisa and pays the visit fee when booking. It is **held** in escrow.
2. The worker can only accept once money is held.
3. Add-ons: the worker requests extra work, the customer approves it, then pays it into escrow. The job can't be marked completed while an add-on is pending or approved but unpaid. Full rules are in [ADDONS.md](ADDONS.md).
4. After completion the customer taps **Release** (or raises a dispute). If they do nothing, it auto-releases after 72 h (`AUTO_RELEASE_HOURS`).
5. Release pays the worker the held amount minus commission (`COMMISSION_RATE`, 10% per the deck).
6. Cancelling before the worker sets off refunds everything. A dispute freezes the money until an admin resolves it as a full refund, full release or a split.

Every movement is in the `ledger` table. Payouts to workers and refunds to customers show up in
Admin → Escrow & payouts as "to send". They're sent from the JazzCash / EasyPaisa merchant portal
(or a disbursement API once you have that agreement) and then marked sent.

## Payment integration

- **JazzCash**: Hosted Checkout v1.1 (page redirection). The request is signed with `pp_SecureHash`
  (HMAC-SHA256 with your integrity salt). The return POST is checked against the hash and amount
  before any money is marked held. See `src/payments/jazzcash.js`.
- **EasyPaisa**: Easypay hosted checkout. `merchantHashedReq` is AES-128-ECB with your hash key,
  then the Index.jsf → Confirm.jsf redirect. The final redirect is unsigned, so the result is
  confirmed with the Inquire Transaction API before money is marked held. See `src/payments/easypaisa.js`.
- **No credentials set**: `/pay.html` is a sandbox simulator so you can click through the whole flow.
  The simulator turns itself off for a provider as soon as that provider's credentials are set.

To go live: get merchant accounts from both providers, put the sandbox credentials in `.env`, set
`BASE_URL` to a public HTTPS address (the providers redirect back to it), test, then switch `*_MODE=live`.
Check the field names against the integration guide each provider sends with your merchant account,
since they occasionally revise them.

## Before launch (not done in this MVP)

- Phone codes use a fixed demo code until Firebase Phone Login is set up ([FIREBASE.md](FIREBASE.md)) or another SMS provider is set (`SMS_API_URL`, `SMS_API_KEY`; see ACCOUNTS.md).
- Automatic payouts need a JazzCash / EasyPaisa disbursement agreement.
- The app is a mobile-first web app (installable as a PWA). The deck suggests Flutter or React Native for the store apps; this API can back those unchanged.
- Data can be saved to the Firebase database (Cloud Firestore): set `FIREBASE_SERVICE_ACCOUNT`, steps in [FIREBASE.md](FIREBASE.md). Without it, data is only in the local SQLite file.

## Hosting

The server needs to run as **one long-running Node.js process with a disk that persists**, because the
SQLite database and uploads are local files. A VPS or a host with a persistent volume (for example a small
Linux server, Railway, Render or Fly.io with a volume) works. Set `BASE_URL` to the public HTTPS address so
JazzCash and EasyPaisa can redirect customers back.

**Vercel is not a good fit as it stands.** Vercel runs serverless functions with no persistent disk, so the
SQLite file and uploads would be lost between requests, and the Firestore sync also assumes a single server
instance. To deploy there you would first need to move the database to a hosted one (for example Postgres,
or Firestore as the main database) and move uploads to cloud storage.

## Layout

```
src/server.js       API, payment redirects, static files
src/escrow.js       escrow rules and ledger
src/addons.js       add-on service requests: rules, audit trail, price breakdown
src/accounts.js     registration, login, roles, customer/worker profiles, documents, verification
src/auth.js         password hashing, phone numbers, sessions, one-time codes, lockout
src/db.js           SQLite schema + seed data (workers from the deck)
src/firebase.js     Firebase Phone Auth (SMS login codes)
src/firestore.js    optional copy of all data in Cloud Firestore
src/payments/       JazzCash and EasyPaisa
public/             customer/worker app, admin panel, payment simulator
test/               node:test suite
```
