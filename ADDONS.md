# Add-On Service / Additional Work Request

## 1. What it does

Sometimes a worker on a job finds a second problem. For example, a plumber fixing a tap finds a cracked pipe.
The worker can't charge for it or start it on their own. They send an add-on request in the app with the
problem, the proposed work, labour and material costs, photos and the extra time it needs. The customer
sees the old and new totals side by side. They can approve it, reject it or ask a question first. An
approved add-on is paid into the same JazzCash / EasyPaisa escrow as the original booking. It appears as a
separate line on the final itemized invoice, and every step is saved in the booking's price history.

This builds on the existing booking and escrow code. Nothing else in the app was rebuilt.

## 2. User flow

**Worker**
1. Opens an active booking (confirmed, on the way, or in progress) and taps **Request add-on service**.
2. Fills in the problem found, the proposed work, labour (Rs), materials (Rs), extra time, and optional photos or a short video.
   The form shows the current total, this add-on and the new total. If the increase is large, it warns the worker that the customer
   will see a price warning.
3. If the problem is an immediate safety hazard, they tick **This is an immediate safety hazard** and must explain the risk.
   They may make the area safe for free, for example by switching off a circuit. Any paid repair still needs approval.
4. Sends the request. The customer gets a notification. The worker sees "Waiting for customer", can answer questions, and
   can withdraw the request while it is pending, or after approval if it hasn't been paid yet.
5. Starts the extra work only when it shows **Approved · Paid**. The job can't be marked completed while an add-on is
   pending or approved but unpaid.

**Customer**
1. Gets a notification (bell on Home) and a banner on the booking: "Add-on request needs your approval" (red for safety issues).
2. Opens the request and sees the problem, the work, photos, extra time and a price comparison:
   original booking, add-ons already approved, this add-on's labour and materials, the new total, and the increase in Rs and %.
   A warning appears when the booking would go more than 100% over the original price or over Rs 5,000 in add-ons (both configurable).
3. Chooses one of:
   - **Approve & pay**: records consent (who, when, price), raises the approved total, then opens JazzCash / EasyPaisa to pay into escrow.
     If payment fails or is abandoned, the add-on stays "Approved · Unpaid" with a **Pay now** button.
   - **Reject add-on**: optional reason. The add-on stays on record at Rs 0 and the total doesn't change. The worker is told to carry
     on with the original job only if it is safe.
   - **Ask a question first**: opens a Q&A thread on the request. The worker is notified and the request stays pending.
4. After the job, **Invoice** shows the original service, each approved add-on (labour, materials, when it was approved,
   Paid / Unpaid / Refunded), the add-ons that weren't charged, the totals, and the full price history. It can be printed or saved as a PDF.
5. **Report an unauthorized charge** (on the invoice or the add-on): if the money is still in escrow, it is frozen as a dispute
   for admin review. If it was already released, it goes to the complaints queue.

**Admin** (`/admin.html` → **Add-on review**)
- Every add-on with flags: *over price limit*, *safety*, *disputed*.
- Per-worker stats for the last 30 days: requested, approved, rejected, disputed, over the limit, and approved value. A worker is
  flagged "Repeated misuse?" at 3+ rejected/disputed add-ons or 3+ over the limit, with a **Suspend** button.
- **History** shows any booking's full price trail: who did what, when, the amount, and the approved total after each step.
- Add-on disputes appear under **Disputes** labelled with the add-on. A refund is applied to that add-on first.

## 3. Screens

All screens are in the existing app (English and اردو), mobile-first:

| Screen | Route |
|---|---|
| Customer booking details (add-on banner, price breakdown) | `#/booking/:id` |
| Worker booking / dashboard with **Request add-on service** | `#/booking/:id`, Home |
| Add-on request form (worker) | `#/addon-new/:bookingId` |
| Approval screen: comparison, warning, approve / reject / ask, Q&A | `#/addon/:id` |
| Itemized invoice and price history | `#/invoice/:bookingId` |
| Notifications | `#/notifications` |
| Admin add-on review, disputes, history | `/admin.html#addons` |

## 4. Database and backend changes

| Table | What changed |
|---|---|
| `extras` (add-on requests) | Rebuilt with: `worker_id`, `problem`, `work`, `labour`, `materials`, `amount` (= labour + materials, set by the server), `est_minutes`, `urgent_safety`, `safety_risk`, `status` (pending / approved / rejected / cancelled / disputed), `pay_status` (unpaid / paid / refunded / partly_refunded), `refunded_amount`, `over_threshold`, `reject_reason`, `decided_by`, `decided_at`, `client_key` (unique per booking, for duplicate protection). Older databases are upgraded automatically on start. |
| `price_events` (new) | Audit trail: booking, add-on, actor, role, event, amount, **approved total after**, note, time. |
| `addon_messages` (new) | Clarification Q&A per add-on. |
| `media` (new) | Uploaded photos/videos (random 128-bit ids, owner, add-on, type, size). |
| `notifications` (new) | In-app notifications for customers and workers. |
| `disputes` | New `extra_id` column, so a dispute can be about one add-on. |

The original booking price (`bookings.visit_fee`) is never changed. Add-ons are separate rows, and the approved total is always
calculated from them.

New endpoints (all checked on the server):

```
POST /api/bookings/:id/addons     worker on that booking only; labour/materials/problem/work/est_minutes/urgent_safety/safety_risk/media_ids/client_key
GET  /api/addons/:id              booking parties only; includes the comparison and price breakdown
POST /api/addons/:id/approve      that booking's customer only; optional provider → returns a payment link
POST /api/addons/:id/reject       that booking's customer only
POST /api/addons/:id/pay          customer; only approved + unpaid; amount taken from the record
POST /api/addons/:id/cancel       requesting worker; only pending, or approved + unpaid
POST /api/addons/:id/messages     customer or worker on the booking
POST /api/addons/:id/dispute      customer
POST /api/uploads                 worker; raw image/video body (8 MB photo, 20 MB video)
GET  /api/notifications           (+ POST /api/notifications/read)
GET  /api/admin/addons            admin review list and worker misuse stats
GET  /api/admin/bookings/:id/history
```

Code: `src/addons.js` (rules), `src/escrow.js` (payments, refunds and disputes now update add-ons), `src/server.js` (routes),
`src/db.js` (schema, migration, demo data), `public/app.js` / `public/i18n.js` / `public/styles.css` / `public/admin.html` (screens).

## 5. Anti-fraud rules and where they are enforced

| Rule | How |
|---|---|
| Every add-on linked to its booking | `extras.booking_id`; the worker must be that booking's worker |
| Worker can't change the original price | No endpoint edits `visit_fee` or an existing add-on. Withdrawing and re-requesting is logged. |
| Every price change saved | `price_events` row for request, approve, reject, withdraw, pay, refund, dispute and Q&A |
| Customer notified on every request | `notifications` row (and the bell count). Safety requests are marked urgent. |
| Rejected add-ons kept at Rs 0 | Status `rejected`, excluded from the approved total |
| Worker can't approve | Approve and reject need the booking's own customer (403 otherwise) |
| Total calculated on the server | `amount = labour + materials`. Any `amount` / `total` sent by the app is ignored. Whole rupees only, no negatives, capped. |
| No double counting | Decisions use `UPDATE … WHERE status='pending'`, so a second approve gets 409. Payments are idempotent per transaction. |
| Duplicate requests | Same `client_key` returns the original request; the same pending work is refused (409); at most 5 per booking |
| Paid only on provider confirmation | `pay_status` only changes inside the provider callback (JazzCash hash-checked, EasyPaisa inquiry API) or the sandbox simulator, which switches off once real credentials are set. Workers have no endpoint to mark anything paid. |
| No charge without consent | Approving doesn't take money. Paying is a separate wallet step the customer confirms. |
| Large increase warning | Over `ADDON_WARN_PERCENT` (default 100%) of the original or `ADDON_WARN_AMOUNT` (Rs 5,000) of add-ons: shown to the customer, flagged for admins |
| Safety hazards | Need a written risk explanation, are shown in red, are never auto-approved, and follow the free "make it safe" policy |
| Withdrawn while the customer was paying | Withdraw is blocked for 30 minutes after a payment starts. A payment that still arrives for a withdrawn add-on is refunded straight away. |
| Disputes | Customer disputes one add-on, escrow freezes, and the admin refunds or releases. The refund goes to that add-on first. |
| Repeated misuse | Admin flags and suspend button |

## 6. Test scenarios

`test/addons.test.js` has 19 automated scenarios (run `npm test`; all 29 tests in the project pass):

1. Spec example: Rs 1,000 + Rs 700 labour + Rs 300 materials = Rs 2,000, with the expected audit trail
2. Totals sent by the client are ignored; negative, decimal, empty and huge amounts are refused
3. Rejection keeps the record at Rs 0, and it can't be approved or paid later
4. Three simultaneous approvals give one 200 and two 409s, and the total is counted once
5. A retried submit returns the original; the same pending work is refused; only one notification is sent
6. Worker can't approve; other customers and workers get 403; customers can't create add-ons
7. Approved amounts can't be edited; paid add-ons can't be withdrawn; approved-but-unpaid can
8. Payment amount comes from the record; worker can't pay or mark paid; a failed payment stays unpaid; no double payment
9. Completion is blocked by pending and by approved-but-unpaid add-ons
10. Large increases are flagged to the customer and the admin
11. Safety requests need an explanation and stay pending
12. Clarification Q&A notifies the other side and leaves the request pending
13. Add-on dispute freezes escrow; admin refund marks that add-on refunded
14. Cancelling the booking refunds paid add-ons too
15. A payment for an add-on withdrawn meanwhile is refunded immediately
16. At most 5 add-ons per booking
17. Photo upload: workers only, allowed types only, one request per photo, viewable by the customer
18. Admin sees repeated misuse; customers can't open the admin API
19. Old databases are upgraded in place

**Manual check** (demo data is created on first start):
1. Log in as the customer `03001234567` (code 1234). The bell shows 1. Open **KW-1024** and you'll see the banner for the pipe add-on (Rs 700 + Rs 300).
2. Ask a question, then log in as plumber Usman `03044444444` in another browser and answer it on the same add-on.
3. As Usman, open KW-1024 → **Request add-on service**, add a photo and tick the safety box.
4. As the customer, approve the pipe add-on and pay in the simulator, then reject the safety add-on. Open **Invoice**.
5. Open **KW-1025** (completed) to see an invoice with an approved and paid add-on plus a rejected one, then try **Report an unauthorized charge**.
6. Log in as admin `03000000000` → **Add-on review** → **History**.

## 7. Running it

```bash
npm start     # http://localhost:3000 ; needs Node.js 22.5+
npm test
```

Settings in `.env`: `ADDON_WARN_PERCENT`, `ADDON_WARN_AMOUNT`, `UPLOAD_DIR`, plus the existing payment settings.
Delete `data/` to reset the demo data.

## 8. Assumptions and what still needs outside approval

- **Payments:** the JazzCash and EasyPaisa code follows their hosted-checkout guides and is tested for signing and verification,
  but it hasn't been run against the providers' sandboxes. That needs merchant accounts and credentials from JazzCash and EasyPaisa.
  Until then, payments go through the built-in simulator and **no real money moves**.
- **Refunds and worker payouts** are recorded and listed in Admin → Escrow & payouts for staff to send from the merchant portals.
  Sending them automatically needs a disbursement / refund API agreement with each provider.
- **Notifications** are in-app only. SMS or push (e.g. an SMS gateway or Firebase) needs an account with that provider.
- **Login** still uses the demo code 1234 and needs a real SMS OTP provider.
- **Photos** are stored on the server's disk and viewed through unguessable links. For production, move them to private
  cloud storage with expiring links.
- **Emergency policy:** the "make it safe for free, any paid repair needs approval" wording is a starting policy. Have it
  reviewed before launch.
- **Warning line:** an add-on equal to the original price (like the spec example) doesn't trigger the warning by default. Anything
  above that does. Change `ADDON_WARN_PERCENT` if you want it stricter.
