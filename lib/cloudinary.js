const crypto = require("node:crypto");

const FIREBASE_PROJECT_ID = "shreya-lostandfound";
const CLOUDINARY_FOLDER = "jssfind/items";
const FIREBASE_CERTS_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let firebaseCertificates = null;
let firebaseCertificatesExpireAt = 0;

class InvalidFirebaseTokenError extends Error {}

class MissingCloudinaryConfigurationError extends Error {}

function parseCloudinaryUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new MissingCloudinaryConfigurationError("CLOUDINARY_URL is not set.");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new MissingCloudinaryConfigurationError("CLOUDINARY_URL is invalid.");
  }

  if (
    parsed.protocol !== "cloudinary:" ||
    !parsed.username ||
    !parsed.password ||
    !parsed.hostname
  ) {
    throw new MissingCloudinaryConfigurationError("CLOUDINARY_URL is invalid.");
  }

  return {
    apiKey: decodeURIComponent(parsed.username),
    apiSecret: decodeURIComponent(parsed.password),
    cloudName: parsed.hostname,
  };
}

function createCloudinarySignature({ timestamp, folder, publicId, apiSecret }) {
  const parameters = { folder, public_id: publicId, timestamp };
  const parameterString = Object.keys(parameters)
    .sort()
    .map((key) => `${key}=${parameters[key]}`)
    .join("&");

  return crypto
    .createHash("sha1")
    .update(`${parameterString}${apiSecret}`)
    .digest("hex");
}

function decodeJwtPart(part) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new InvalidFirebaseTokenError("Malformed Firebase ID token.");
  }
}

async function getFirebaseCertificates() {
  if (firebaseCertificates && Date.now() < firebaseCertificatesExpireAt) {
    return firebaseCertificates;
  }

  const response = await fetch(FIREBASE_CERTS_URL, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error("Could not retrieve Firebase signing certificates.");
  }

  const certificates = await response.json();
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 3600);

  firebaseCertificates = certificates;
  firebaseCertificatesExpireAt = Date.now() + Math.min(Math.max(maxAge, 60), 21600) * 1000;
  return certificates;
}

async function verifyFirebaseIdToken(token) {
  if (typeof token !== "string" || token.length > 12000) {
    throw new InvalidFirebaseTokenError("Invalid Firebase ID token.");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new InvalidFirebaseTokenError("Malformed Firebase ID token.");
  }

  const header = decodeJwtPart(parts[0]);
  const claims = decodeJwtPart(parts[1]);
  const now = Math.floor(Date.now() / 1000);

  if (
    header.alg !== "RS256" ||
    typeof header.kid !== "string" ||
    claims.aud !== FIREBASE_PROJECT_ID ||
    claims.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}` ||
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    claims.sub.length > 128 ||
    !Number.isFinite(claims.exp) ||
    !Number.isFinite(claims.iat) ||
    !Number.isFinite(claims.auth_time) ||
    claims.exp <= now ||
    claims.iat > now + 300 ||
    claims.auth_time > now + 300
  ) {
    throw new InvalidFirebaseTokenError("Invalid or expired Firebase ID token.");
  }

  const certificates = await getFirebaseCertificates();
  const certificate = certificates[header.kid];
  if (!certificate) {
    throw new InvalidFirebaseTokenError("Unknown Firebase signing key.");
  }

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();

  let validSignature = false;
  try {
    validSignature = verifier.verify(
      new crypto.X509Certificate(certificate).publicKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    throw new InvalidFirebaseTokenError("Invalid Firebase ID token signature.");
  }

  if (!validSignature) {
    throw new InvalidFirebaseTokenError("Invalid Firebase ID token signature.");
  }

  return claims;
}

async function createCloudinaryUploadSignature(token, cloudinaryUrl, now = Date.now()) {
  await verifyFirebaseIdToken(token);
  const credentials = parseCloudinaryUrl(cloudinaryUrl);
  const timestamp = Math.floor(now / 1000);
  const publicId = crypto.randomUUID();

  return {
    apiKey: credentials.apiKey,
    cloudName: credentials.cloudName,
    folder: CLOUDINARY_FOLDER,
    publicId,
    timestamp,
    signature: createCloudinarySignature({
      timestamp,
      folder: CLOUDINARY_FOLDER,
      publicId,
      apiSecret: credentials.apiSecret,
    }),
  };
}

module.exports = {
  InvalidFirebaseTokenError,
  MissingCloudinaryConfigurationError,
  createCloudinarySignature,
  createCloudinaryUploadSignature,
  parseCloudinaryUrl,
  verifyFirebaseIdToken,
};
