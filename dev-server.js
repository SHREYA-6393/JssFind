const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cloudinarySignatureHandler = require("./api/cloudinary-signature");

const publicRoot = path.join(__dirname, "public");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};
const publicRootFiles = new Set([
  "app.js",
  "browse.html",
  "firebase-config.js",
  "index.html",
  "styles.css",
]);

function sendNotFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
}

function serveStatic(req, res, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    sendNotFound(res);
    return;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const pathParts = relativePath.split(/[\\/]/);
  if (pathParts.some((part) => !part || part.startsWith("."))) {
    sendNotFound(res);
    return;
  }

  const isAllowed = pathParts.length === 1
    ? publicRootFiles.has(pathParts[0])
    : pathParts[0] === "assets";
  if (!isAllowed) {
    sendNotFound(res);
    return;
  }

  const filePath = path.resolve(publicRoot, relativePath);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) {
    sendNotFound(res);
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendNotFound(res);
      return;
    }

    const contentType = contentTypes[path.extname(filePath).toLowerCase()];
    if (!contentType) {
      sendNotFound(res);
      return;
    }

    res.writeHead(200, {
      "Content-Length": stats.size,
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    sendNotFound(res);
    return;
  }

  if (url.pathname === "/api/cloudinary-signature") {
    cloudinarySignatureHandler(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  const pathname = url.pathname === "/browse" || url.pathname === "/browse/"
    ? "/browse.html"
    : url.pathname;
  serveStatic(req, res, pathname);
});

const port = Number(process.env.PORT || 5000);
server.listen(port, "0.0.0.0", () => {
  console.log(`JssFind is ready on port ${port}`);
});
