# JssFind

![HTML](https://img.shields.io/badge/HTML-e34f26?style=flat&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-f7df1e?style=flat&logo=javascript&logoColor=black)
![Firebase](https://img.shields.io/badge/Firebase-11-ffca28?style=flat&logo=firebase&logoColor=black)
![Cloudinary](https://img.shields.io/badge/Cloudinary-uploads-3448c5?style=flat&logo=cloudinary&logoColor=white)

---

A campus lost-and-found board for posting, browsing, and searching lost or found items. Google sign-in and listing data are handled by Firebase; item photos are uploaded to Cloudinary.

## Features

- Search and browse lost-and-found listings.
- Sign in with Google to post and manage listings.
- Upload item photos with a signed Cloudinary upload.
- Restrict listing access and edits with Firestore security rules.

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | HTML, CSS, JavaScript modules |
| Authentication and data | Firebase Authentication, Cloud Firestore |
| Image uploads | Cloudinary |
| Local server and API | Node.js |
| Deployment configuration | Vercel |

## Project structure

```text
.
├── api/
│   └── cloudinary-signature.js
├── lib/
│   └── cloudinary.js
├── public/
│   ├── assets/
│   ├── app.js
│   ├── browse.html
│   ├── firebase-config.js
│   ├── index.html
│   └── styles.css
├── dev-server.js
├── firestore.rules
├── vercel.json
└── README.md
```

## Configuration

1. In Firebase Authentication, enable Google sign-in and authorize the domains where the app will run.
2. Publish `firestore.rules` to the Firebase project.
3. Set the Firebase web configuration in `public/firebase-config.js`. This client configuration is public; Firestore rules protect listing data.
4. Set this server-side environment variable to enable photo uploads:

| Variable | Purpose | Example format |
| --- | --- | --- |
| `CLOUDINARY_URL` | Cloudinary credentials for signing uploads | `cloudinary://<api_key>:<api_secret>@<cloud_name>` |

Keep `CLOUDINARY_URL` out of source control and browser code. Without it, browsing and listings still work, but photo uploads are unavailable.

## Run locally

Requires Node.js 20 or later. No package installation is needed.

```sh
CLOUDINARY_URL='cloudinary://<api_key>:<api_secret>@<cloud_name>' node dev-server.js
```

Open `/` for the landing page or `/browse` for listings. The server listens on port `5000` by default.

## Deployment

Deploy the project root to Vercel. The `api/` directory provides the upload-signing endpoint; configure `CLOUDINARY_URL` in the deployment environment and authorize the deployed domain in Firebase.
