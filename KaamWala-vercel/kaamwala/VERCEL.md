# Put KaamWala on Vercel

This guide puts the app online at a link like `https://kaamwala.vercel.app`.
(Yeh guide app ko Vercel par online kar degi. Vercel ka free "Hobby" plan card nahi maangta.)

You need two free accounts, and your code on GitHub:

| What | Service | Why |
|---|---|---|
| Runs the app | **Vercel** (vercel.com), Hobby plan | Runs the app from your GitHub repo |
| Keeps the data and photos | **Firebase Cloud Firestore**, free Spark plan | Vercel keeps no files, so **all** data, photos and CNIC documents live in Firebase. Without Firebase the app will not start on Vercel. |

About 30 minutes in total.

---

## Read this first (pehle yeh parhein)

The app works on Vercel, but Vercel is a different kind of host from Render. Honest list of what that means:

1. **Firebase is required.** Vercel throws its files away all the time, so the app refuses to start there without
   the Firebase key. It shows a page saying `KaamWala is not set up yet` until you add it.
   (Firebase ke baghair Vercel par app nahi chalegi.)
2. **Vercel may run several copies of the app at the same time** when many people use it. Each copy keeps a
   working copy of the data in memory. Before every action the copy checks Firebase, and reloads if another copy
   changed something, and every change is saved to Firebase before the app answers. That keeps copies in step.
   There is still a small risk: if two people create something (for example two bookings) on two different
   copies in the **same fraction of a second**, one of them can overwrite the other. With a few test users this
   is very unlikely; with real traffic it can happen. (Kam users ke saath masla nahi, zyada traffic par data
   takra sakta hai.) For real customers, Render (one server, see [DEPLOY.md](DEPLOY.md)) or a proper hosted
   database is safer.
3. **Uploads are limited to about 4 MB per file.** Vercel rejects bigger requests. Phone photos are usually fine;
   videos and very large photos will fail. (4 MB se bari file upload nahi hogi, video aksar fail hogi.)
4. **A bit slower.** Each action talks to Firebase first, and the first visit after a quiet period takes a few
   seconds while Vercel starts a copy and loads the data from Firebase. The more data you have, the longer that
   first load takes.
5. **Uses more of the Firebase free limit.** Every action costs at least one Firestore read, and each time a copy
   starts or reloads it reads every record. The free limit (50,000 reads a day) is plenty for testing.
6. **Hobby plan is for non-commercial use.** Vercel's free plan terms say personal, non-commercial projects. Testing
   and showing investors is fine; once KaamWala takes real money from customers, Vercel expects the paid Pro plan
   (about USD 20 a month). (Asal karobar shuru hone par Vercel Pro plan maangta hai.)
7. **Escrow auto-release** (after 72 hours) runs when someone uses the app, not on a timer, so a due release
   happens with the next visit.
8. **Not yet tried on a real Vercel account.** It was tested on this computer with a pretend Vercel and a pretend
   Firebase (all 57 tests pass, including two copies sharing one database). The first real deploy is the real
   test, so check Part 5 carefully.

---

## Part 1: Firebase (the database), about 10 minutes

If you already did Part 1 of [DEPLOY.md](DEPLOY.md), skip this and use the same `.json` key.

1. Open <https://console.firebase.google.com> and sign in with your Google (Gmail) account.
2. Click **Create a project**, name it `kaamwala`, turn **Google Analytics off**, click **Create project**, then **Continue**.
3. Left menu: **Build → Firestore Database → Create database**.
   - Location: **asia-south1 (Mumbai)**. The app on Vercel also runs in Mumbai, so they are close and fast.
     (Location baad mein change nahi hoti.)
   - **Start in production mode** → **Create**.
4. **Gear icon** next to *Project Overview* → **Project settings** → **Service accounts** tab.
5. **Generate new private key** → **Generate key**. A `.json` file downloads.

**Keep this file secret.** (Yeh file kisi ko na dein aur GitHub par upload na karein.) Stay on the free **Spark** plan.

---

## Part 2: Put the new files on GitHub, about 5 minutes

Your repo is `shafiashafiq91-ship-it/KaamWala`. Add these files from this update (new or changed):

| File | |
|---|---|
| `api/index.js` | new: the Vercel entry |
| `vercel.json` | new: tells Vercel to send every request to `api/index.js` |
| `.vercelignore` | new: keeps test files and private files off Vercel |
| `src/firestore.js` | changed: keeps several copies of the app in step |
| `test/vercel.test.js`, `test/fake-google.js` | new tests |
| `test/firestore.test.js` | changed |
| `VERCEL.md`, `README.md`, `DEPLOY.md` | guides |

**Important:** `vercel.json`, `.vercelignore` and the `api` folder must sit **next to `package.json`** (in the same
folder as `src` and `public`). (Yeh teeno usi folder mein hon jahan `package.json` hai.)

How: copy the whole `kaamwala` folder from the update over your local copy of the repo, then in GitHub Desktop click
**Commit to main** → **Push origin**. Or on github.com: open the repo → go into the folder that has `package.json` →
**Add file → Upload files** → drag the files in (keep the `api` and `test` folders) → **Commit changes**.

Do **not** upload the `data/` folder, `.env`, or the Firebase `.json` key.

Note which folder `package.json` is in on GitHub: at the top of the repo, or inside a folder like `kaamwala` or
`app/kaamwala`. You need it in Part 3.

---

## Part 3: Vercel, about 10 minutes

1. Open <https://vercel.com/signup>. Choose **Hobby**, type your name, then **Continue with GitHub** and allow it.
2. On the dashboard click **Add New… → Project**. Find **KaamWala** and click **Import**.
   (If it isn't listed: **Adjust GitHub App Permissions** → give Vercel access to the KaamWala repo.)
3. On the **Configure Project** page:

   | Field | What to choose |
   |---|---|
   | Project Name | `kaamwala` (your link becomes `https://kaamwala.vercel.app`; if taken, Vercel adds letters) |
   | Framework Preset | **Other** |
   | Root Directory | Click **Edit** and pick the folder that has `package.json`. If it's at the top of the repo, leave it as `./` |
   | Build and Output Settings | Leave everything as it is (no build command needed) |

4. Open **Environment Variables** on the same page and add:

   | Key | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Open the Firebase `.json` key in Notepad, **Ctrl+A**, copy, and paste the **whole text** |

   That's the only required one. Optional ones, add them only if you need them:

   | Key | When |
   |---|---|
   | `BASE_URL` | Only if you use your own domain (like `https://kaamwala.pk`). Without it the app uses your `.vercel.app` link. No `/` at the end. |
   | `JAZZCASH_MERCHANT_ID`, `JAZZCASH_PASSWORD`, `JAZZCASH_INTEGRITY_SALT` | When you get JazzCash merchant keys (until then, the payment simulator is used) |
   | `EASYPAISA_STORE_ID`, `EASYPAISA_HASH_KEY`, … | When you get EasyPaisa keys (full list in [.env.example](.env.example)) |
   | `SMS_API_URL`, `SMS_API_KEY` or `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY` | For real SMS login codes (see [FIREBASE.md](FIREBASE.md)) |

   Do **not** add `PORT`, and do not add `FIREBASE_SERVICE_ACCOUNT` (without `_JSON`): there is no key file on Vercel.

5. Click **Deploy**. Wait 1 to 2 minutes until you see **Congratulations**.

## Part 4: Set Node.js to version 22 or newer

The app needs Node.js 22.5 or newer (it uses Node's built-in SQLite).

1. In your Vercel project open **Settings → Build and Deployment** (on some accounts: **Settings → General**).
2. Find **Node.js Version** and choose **22.x** (or **24.x**). Click **Save**.
3. If you changed it: **Deployments** tab → the **⋯** menu on the top deployment → **Redeploy**.

---

## Part 5: Check it works

1. Open your link (shown on the Vercel project page, like `https://kaamwala.vercel.app`). The KaamWala welcome
   screen should appear. The first open can take 5 to 10 seconds.
2. Register a new customer, log in, and book a worker with a **small** photo.
3. In the Firebase console → **Firestore Database** you'll see collections like `users`, `bookings`, `_files`
   and `_meta`. Your new customer is in `users`. (Data Firebase mein save ho raha hai.)
4. Open the link on your phone too, log in as the same customer, and check the booking is there.

If something fails, open Vercel → your project → **Logs** (or **Deployments → the deployment → Runtime Logs**). Common ones:

| You see | Fix |
|---|---|
| Page says `KaamWala is not set up yet` | `FIREBASE_SERVICE_ACCOUNT_JSON` is missing. Add it (Settings → Environment Variables), then **Redeploy**. |
| Log says `Firestore login failed` | The key text is incomplete. Paste the whole file again, then Redeploy. |
| Log says `Firestore 403` or `404` | The Firestore database wasn't created (Part 1, step 3). |
| Log says `No such built-in module: node:sqlite` | Node.js version is too old. Do Part 4. |
| `404: NOT_FOUND` from Vercel on every page | Root Directory is wrong, or `vercel.json` is not next to `package.json`. |
| Upload fails with `413` or `FUNCTION_PAYLOAD_TOO_LARGE` | The file is over about 4 MB (see "Read this first", point 3). |

---

## Good to know (zaroori baatein)

- **Updating the app:** push to GitHub `main`; Vercel deploys by itself in a minute or two.
- **Your own domain:** Vercel → project → **Settings → Domains**. Then set `BASE_URL` to that address and Redeploy.
- **Login codes are still demo codes.** Until real SMS is set up the code is always `1234`, so **anyone who knows a
  phone number can log in as that person, including the admin**. Fine for testers and investors; don't collect real
  customers' CNICs yet.
- **Payments stay in simulator mode** until you add merchant keys. Their return address is your Vercel link.
- **Don't run Render and Vercel on the same Firebase project at the same time.** Both would write to the same data
  and could overwrite each other. Use one host, or a second Firebase project for the other.
