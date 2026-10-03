# HomeBar Studio — Firebase + Vercel integration

This package keeps the existing HomeBar Studio UI/features and adds:

- Firebase Email/Password Authentication
- Administrator-issued access keys
- Access-key start/end dates, active/inactive state, maximum account count
- Server-side key hashing and activation
- Per-user cloud persistence for cellar, non-alcoholic ingredients, recipes, substitutions, and IBA personal metadata
- Admin-only shared catalog CRUD
- Firestore Security Rules for user/admin separation
- Vercel serverless API routes

## 1. Firebase

1. Create/select a Firebase project.
2. Enable Authentication → Sign-in method → Email/Password.
3. Create a Cloud Firestore database.
4. Deploy `firestore.rules`.
5. Register a Web App and copy its web configuration into the Vercel environment variables.
6. Create a Firebase service account and use its `project_id`, `client_email`, and `private_key` as the server environment variables.

## 2. Vercel environment variables

Copy `.env.example` into your Vercel project settings and fill every value.

`FIREBASE_PRIVATE_KEY` must contain the service-account private key. Keep it server-only.

Set `ADMIN_BOOTSTRAP_EMAIL` to the first administrator's Firebase Authentication email. When that account signs in, the server grants the `admin` custom claim.

Set a long random `ACCESS_KEY_PEPPER`. Do not reuse a Firebase credential or password for this value.

After changing environment variables, redeploy the Vercel project.

## 3. Install/deploy

The project uses `firebase-admin` for Vercel serverless routes.

```bash
npm install
vercel
```

## 4. First login

- Open the deployed site.
- Sign up/sign in using the email configured as `ADMIN_BOOTSTRAP_EMAIL`.
- Open `관리자 센터`.
- Issue an access key.
- Share the generated key with a normal user.

Administrators bypass the access-key gate; normal users must have an active, non-expired access key.

## 5. Data model

```text
catalog/{itemId}
users/{uid}/data/main
users/{uid}/access/meta
accessKeys/{keyId}
```

The client can write only its own user data. Catalog writes are administrator-only. Access metadata and access-key documents are server-managed.
