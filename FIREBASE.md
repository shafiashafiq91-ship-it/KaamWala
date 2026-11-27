# Connecting KaamWala to Firebase

The app is ready for two Firebase features:

- **Part 1: Firebase database (Firestore).** All app data (accounts, workers, bookings, payments,
  escrow, reviews, messages) is saved in Firebase, and you can see it in the Firebase console.
- **Part 2: Real SMS login codes (optional).** Firebase sends the login code by SMS instead of `1234`.

Until you add the settings below, the app works exactly as before.

# Part 1: Firebase database

## Step 1: Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Name it `kaamwala` and click **Continue**.
4. Google Analytics is not needed. You can turn it off. Click **Create project**, wait, then **Continue**.

## Step 2: Create the database

1. In the left menu, open **Build → Firestore Database** and click **Create database**.
2. Location: choose **asia-south1 (Mumbai)**, the closest to Pakistan. This can't be changed later.
3. Choose **Start in production mode** and click **Create**.
   (Production mode locks the database to outsiders. The app still gets in with its own key from Step 3.)

## Step 3: Download the app's key

1. Click the gear icon next to **Project Overview**, then **Project settings**.
2. Open the **Service accounts** tab.
3. Click **Generate new private key**, then **Generate key**. A `.json` file downloads.
4. Rename it to `firebase-service-account.json` and put it in the `kaamwala` folder (next to `package.json`).
5. Open the `.env` file in the `kaamwala` folder (copy `.env.example` to `.env` if you don't have one)
   and add this line:

   ```
   FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
   ```

6. Start the app (`npm start`).

**Keep this key file secret.** Anyone who has it can read and change all your data. Don't email it,
upload it to GitHub, or share it in chats. If it leaks, delete it in the same Service accounts tab and
make a new one.

## Step 4: Check it worked

When the app starts, it prints one of these:

- `Firestore: Firebase project kaamwala-xxxxx was empty, uploaded ... records` on the first start.
  All the data the app had (including the demo accounts) is now in Firebase.
- `Firestore: loaded data from Firebase project kaamwala-xxxxx` on every start after that.

In the Firebase console, open **Firestore Database**. You'll see collections like `users`, `workers`,
`bookings` and `payments`. Each record is one document. New sign-ups and bookings appear within a
second or two.

## Good to know

- **Cost:** the free plan includes 50,000 reads and 20,000 writes a day, which is plenty for a pilot.
  Each app start reads every record once.
- **Run one copy of the app at a time** against the same Firebase project.
- **Don't edit records by hand in the console while the app is running.** The app won't see the edit
  until it restarts, and may overwrite it.
- **Photos and CNIC documents** are still stored as files on the server, not in Firebase. Moving them
  to Firebase Storage is a separate step.
- **Hosting sites (Render, Railway and so on):** you can't upload a key file there. Instead, add a
  setting called `FIREBASE_SERVICE_ACCOUNT_JSON` and paste the whole text of the key file as its value.
- **If the app says "Could not reach Firebase"** when starting, check the internet connection and that
  the key file path in `.env` is right.

# Part 2: Real SMS login codes (optional)

Do Part 1 first. You use the same Firebase project.

## Step A: Add a payment card (Blaze plan)

Firebase only sends real SMS on the pay-as-you-go plan.

1. At the bottom left, click **Upgrade** (or the "Spark" plan label).
2. Choose **Blaze** and add your card.
3. Set a **budget alert**, for example $10 a month, so you get an email if costs go up.

You only pay for SMS that are actually sent. Firebase shows the price for each country on its
pricing page. Test numbers (Step D) are free.

## Step B: Turn on phone login

1. In the left menu, open **Build → Authentication** and click **Get started**.
2. Open the **Sign-in method** tab, click **Phone**, switch it **on**, and click **Save**.
3. Open the **Settings** tab, then **SMS region policy**. Choose **Allow** and pick only **Pakistan**.
   This stops people from abroad running up your SMS bill.
4. Still in **Settings**, open **Authorized domains**. `localhost` is already there. When the app has a
   real web address (for example `kaamwala.pk`), add it here, or SMS login won't work on that site.

## Step C: Get the two values for the app

1. Click the gear icon next to **Project Overview**, then **Project settings**.
2. Under **Your apps**, click the web icon **`</>`**.
3. Name it `KaamWala web`. Leave "Firebase Hosting" unticked. Click **Register app**.
4. You'll see a block of code with `firebaseConfig`. Copy these values from it:
   - `apiKey`
   - `projectId`
   - `appId` (optional)
5. Add these lines to the `.env` file:

   ```
   FIREBASE_PROJECT_ID=kaamwala-xxxxx
   FIREBASE_API_KEY=AIza...
   FIREBASE_APP_ID=1:1234567890:web:abc123
   ```

6. Restart the app (`npm start`).

These values are not secret passwords. Every Firebase website shows them to the browser. They are
still yours, so don't post them publicly.

## Step D: Test it for free first (recommended)

1. In **Authentication → Sign-in method → Phone**, open **Phone numbers for testing**.
2. Add a number, for example `+92 300 1234567`, with code `123456`. Save.
3. In the app, log in with that number using **One-time code**. Tap **Send code**, type `123456`.
   No SMS is sent and nothing is charged.
4. Then try your own real mobile number. You should get an SMS from Firebase within a few seconds.

## What changes in the app with SMS login

- **Log in with code** and **sign up** now send a real 6-digit SMS code. The code `1234` stops working.
- **Password login** works the same as before.
- Firebase may sometimes show a short "I'm not a robot" check. That is Google's spam protection.
- The online demo link stays in demo mode with code `1234`. Only your own copy of the app with the
  `.env` values uses Firebase.

## If something goes wrong

| What you see | What to do |
|---|---|
| "Could not start SMS login" | Check the internet connection. Ad blockers can also block Google's login script. |
| SMS never arrives | Check Step A (Blaze plan) and Step B (Phone switched on, Pakistan allowed). |
| Works on your computer but not on the website | Add the website's address to **Authorized domains** (Step B.4). |
| "Too many tries from this phone" | Firebase blocks a phone for a while after many attempts. Wait, or use a test number. |
