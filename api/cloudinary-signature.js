const {
  InvalidFirebaseTokenError,
  MissingCloudinaryConfigurationError,
  createCloudinaryUploadSignature,
} = require("../lib/cloudinary");

function respond(res, statusCode, payload) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(statusCode).json(payload);
    return;
  }

  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  res.setHeader?.("Cache-Control", "no-store");
  res.setHeader?.("X-Content-Type-Options", "nosniff");

  if (req.method !== "POST") {
    res.setHeader?.("Allow", "POST");
    respond(res, 405, { error: "Use POST to request an upload signature." });
    return;
  }

  const authorization = req.headers?.authorization || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    respond(res, 401, { error: "Sign in before uploading a photo." });
    return;
  }

  try {
    const signature = await createCloudinaryUploadSignature(
      tokenMatch[1],
      process.env.CLOUDINARY_URL,
    );
    respond(res, 200, signature);
  } catch (error) {
    if (error instanceof InvalidFirebaseTokenError) {
      respond(res, 401, { error: "Your sign-in has expired. Sign in again and retry." });
      return;
    }

    if (error instanceof MissingCloudinaryConfigurationError) {
      respond(res, 503, { error: "Cloudinary uploads are not configured on this server." });
      return;
    }

    respond(res, 503, { error: "Could not prepare the photo upload. Please try again." });
  }
}

module.exports = handler;
