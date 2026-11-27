# Put KaamWala online for free

This guide puts the app on the internet at a link like `https://kaamwala.onrender.com`, for **Rs 0**.
(Yeh guide app ko bilkul free internet par daal degi. Koi card nahi chahiye.)

You need two free accounts. Neither asks for a payment card:

| What | Free service | Why |
|---|---|---|
| Runs the app | **Render** (render.com), free web service | Runs the Node server 24/7 from your GitHub repo |
| Keeps the data and photos | **Firebase Cloud Firestore**, free Spark plan | Render's free disk is wiped on every restart, so all data, photos and CNIC documents are saved in Firebase |

The app already knows how to use Firebase. You only create the accounts and paste in one key.
About 30 minutes in total.

> **Want Vercel instead?** That works too now, see [VERCEL.md](VERCEL.md). Render is still the simpler choice:
> it runs one normal server, so there is no risk of two copies clashing, and it accepts bigger uploads.

---

## Part 1: Firebase (the database), about 10 minutes

1. Open <https://console.firebase.google.com> and sign in with your Google (Gmail) account.
2. Click **Create a project**. Name it `kaamwala`. Turn **Google Analytics off**. Click **Create project**, then **Continue**.
3. In the left menu open **Build → Firestore Database** and click **Create database**.
   - Location: **asia-south1 (Mumbai)**, closest to Pakistan. (Yeh baad mein change nahi hoti.)
   - Choose **Start in production mode**, then **Create**.
4. Click the **gear icon** next to *Project Overview* → **Project settings** → **Service accounts** tab.
5. Click **Generate new private key** → **Generate key**. A `.json` file downloads.

**Keep this file secret.** (Yeh file kisi ko na dein, aur GitHub par upload na karein.) It is the password to
your database. You will paste its text into Render in Part 3. The project's `.gitignore` already stops it from
being committed if it sits in the app folder.

Stay on the free **Spark** plan. Do not click Upgrade.

---

## Part 2: Put the latest code on GitHub, about 5 minutes

The code on your GitHub repo (`shafiashafiq91-ship-it/KaamWala`) needs the new files from this update:

- `src/filestore.js` (new: saves photos and CNIC files in Firebase)
- `src/server.js`, `src/accounts.js`, `src/firestore.js` (changed)
- `test/firestore.test.js`, `test/helpers.js` (changed)
- `DEPLOY.md` (this guide)

Copy the whole `kaamwala` folder from the update over your local copy of the repo, then push
(GitHub Desktop: **Commit to main** → **Push origin**). Or on github.com: open the repo → **Add file → Upload files**,
drag in the files above into the same folders, and click **Commit changes**.

Do **not** upload the `data/` folder, `.env`, or the Firebase `.json` key.

---

## Part 3: Render (the server), about 10 minutes

1. Open <https://render.com> and click **Get Started**. Choose **Sign up with GitHub** and allow it.
2. Click **New +** → **Web Service**. Pick your **KaamWala** repo. (If it's not listed, click
   *Configure account* and give Render access to that repo.)
3. Fill in the form:

   | Field | What to type |
   |---|---|
   | Name | `kaamwala` (your link becomes `https://kaamwala.onrender.com`; if taken, try another name) |
   | Region | **Singapore** (closest to Pakistan) |
   | Branch | `main` |
   | Root Directory | Leave **empty** if `package.json` is at the top of your repo. If the app is inside a folder, type that folder, for example `kaamwala` or `app/kaamwala`. |
   | Runtime / Language | **Node** |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Instance Type | **Free** |

4. Scroll to **Environment Variables** and add these (click **Add Environment Variable** for each):

   | Key | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `FIREBASE_SERVICE_ACCOUNT_JSON` | Open the Firebase `.json` key file in Notepad, select all (Ctrl+A), copy, and paste the **whole text** here |
   | `BASE_URL` | Your Render link, for example `https://kaamwala.onrender.com` (no `/` at the end) |

   Do **not** add `PORT`; Render sets it by itself.

5. Click **Create Web Service** (or **Deploy Web Service**). Render builds and starts the app. Wait 2 to 5 minutes.

---

## Part 4: Check it works

1. In Render, open the **Logs** tab. You should see:
   - `Firestore: Firebase project kaamwala-xxxx was empty, uploaded ... records` (first time only), and
   - `KaamWala running on ...`
2. Open your link (shown at the top of the Render page). The KaamWala welcome screen should appear.
3. Register a new customer, log in, and book a worker with a photo.
4. In the Firebase console → **Firestore Database** you'll see collections like `users`, `bookings` and `_files`.
   Your new customer is in `users`. (Data Firebase mein save ho raha hai, matlab restart ke baad bhi rahega.)
5. In Render, click **Manual Deploy → Restart service**, wait a minute, and log in again. Your customer and photo are still there.

If something fails, the **Logs** tab says why. Common ones:
- `Firestore login failed` → the key text in `FIREBASE_SERVICE_ACCOUNT_JSON` is incomplete. Paste the whole file again.
- `Firestore 403` or `404` → the Firestore database wasn't created (Part 1, step 3).
- The page never loads → check **Root Directory** points to the folder that has `package.json`.

---

## Good to know (zaroori baatein)

- **Sleeps when idle.** On the free plan, Render puts the app to sleep after 15 minutes with no visitors. The next
  visitor waits about 1 minute while it wakes up. Data is not lost; it's in Firebase. (Pehli dafa khulne mein
  1 minute lag sakta hai, phir tez chalega.) To keep it awake you can make a free monitor at
  <https://uptimerobot.com> that opens your link every 10 minutes.
- **Run only one copy.** Keep the Render service at 1 instance (the free plan does this anyway).
- **Free limits** are plenty for testing and a pilot: Firebase free gives 1 GB of storage, 50,000 reads and 20,000
  writes a day; Render free gives 750 hours a month (enough for one app all month).
- **Login codes are still demo codes.** Until real SMS is set up, the code is always `1234`, so **anyone who knows a
  phone number can log in as that person, including the admin number**. That is fine for showing the app to testers
  and investors, but don't collect real customers' CNICs yet. Real SMS codes need Firebase Phone Login, which
  needs a card on the Blaze plan (see [FIREBASE.md](FIREBASE.md), Part 2), or a Pakistani SMS provider
  (`SMS_API_URL`, `SMS_API_KEY` in [.env.example](.env.example)).
- **Payments stay in simulator mode** until you add JazzCash / EasyPaisa merchant keys as more environment variables
  in Render (names are in [.env.example](.env.example)). Their return URL is your `BASE_URL`.
- **Updating the app later:** push to GitHub and Render redeploys by itself in a few minutes.
- **Your own domain** (like `kaamwala.pk`) can be added later in Render → **Settings → Custom Domains**; the domain
  itself costs money, the Render part is free. Then change `BASE_URL` to the new address.
