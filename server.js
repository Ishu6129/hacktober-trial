const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOADS_DIR = path.join(ROOT, 'uploads');

ensureDirectory(UPLOADS_DIR);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sanitizeFileName(inputName) {
  const cleaned = (inputName || 'untitled-file')
    .replace(/[\\/]+/g, '-')
    .replace(/[<>:"|?*\x00-\x1F]/g, '-')
    .trim();

  return cleaned || 'untitled-file';
}

function sanitizeFolderName(inputName) {
  const cleaned = String(inputName || new Date().toISOString().slice(0, 10))
    .replace(/[\\/]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[<>:"|?*\x00-\x1F]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  return cleaned || 'general';
}

function parseMultipartBody(bodyBuffer, boundary) {
  const boundaryToken = Buffer.from(`--${boundary}`);
  const result = { fields: {}, files: [] };

  let cursor = bodyBuffer.indexOf(boundaryToken);
  if (cursor === -1) {
    return result;
  }

  cursor += boundaryToken.length;

  while (cursor < bodyBuffer.length) {
    if (bodyBuffer[cursor] === 13 && bodyBuffer[cursor + 1] === 10) {
      cursor += 2;
    }

    const headerEnd = bodyBuffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd === -1) {
      break;
    }

    const headers = bodyBuffer.slice(cursor, headerEnd).toString('utf8');
    const contentStart = headerEnd + 4;
    const nextBoundary = bodyBuffer.indexOf(boundaryToken, contentStart);

    if (nextBoundary === -1) {
      break;
    }

    const partData = bodyBuffer.slice(contentStart, nextBoundary - 2);
    const contentDisposition = (headers.match(/Content-Disposition:\s*([^\r\n]+)/i) || [])[1] || '';

    const nameMatch = contentDisposition.match(/name="([^"]+)"/i);
    const fileNameMatch = contentDisposition.match(/filename="([^"]*)"/i);

    if (fileNameMatch && fileNameMatch[1]) {
      const fieldName = nameMatch ? nameMatch[1] : 'file';
      result.files.push({
        fieldName,
        filename: sanitizeFileName(fileNameMatch[1]),
        data: Buffer.from(partData),
      });
    } else if (nameMatch) {
      const fieldName = nameMatch[1];
      const value = partData.toString('utf8').replace(/\r\n$/, '');
      result.fields[fieldName] = value;
    }

    cursor = nextBoundary + boundaryToken.length;

    if (bodyBuffer[cursor] === 45 && bodyBuffer[cursor + 1] === 45) {
      break;
    }

    if (bodyBuffer[cursor] === 13 && bodyBuffer[cursor + 1] === 10) {
      cursor += 2;
    }
  }

  return result;
}

function getUploadedFolderList() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    return [];
  }

  return fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const folderPath = path.join(UPLOADS_DIR, entry.name);
      const files = fs.readdirSync(folderPath)
        .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
        .sort((a, b) => a.localeCompare(b));

      return {
        name: entry.name,
        fileCount: files.length,
        files: files.map((fileName) => ({
          name: fileName,
          url: `/uploads/${encodeURIComponent(entry.name)}/${encodeURIComponent(fileName)}`,
        })),
      };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

function serveStaticFile(res, filePath) {
  fs.readFile(filePath, (error, fileData) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileData);
  });
}

function handleUpload(req, res) {
  const contentType = req.headers['content-type'] || '';

  if (!contentType.includes('multipart/form-data')) {
    sendJson(res, 400, { ok: false, message: 'Expected a multipart upload request.' });
    return;
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    sendJson(res, 400, { ok: false, message: 'Missing multipart boundary.' });
    return;
  }

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks = [];

  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(chunks);
    const parsed = parseMultipartBody(bodyBuffer, boundary);

    const selectedDate = parsed.fields.date || new Date().toISOString().slice(0, 10);
    const folderName = sanitizeFolderName(parsed.fields.folder || selectedDate);
    const folderPath = path.join(UPLOADS_DIR, folderName);

    ensureDirectory(folderPath);

    const savedFiles = [];

    for (const file of parsed.files) {
      const extension = path.extname(file.filename) || '.png';
      const baseName = path.basename(file.filename, extension);
      let finalFileName = `${baseName}${extension}`;
      let counter = 1;

      while (fs.existsSync(path.join(folderPath, finalFileName))) {
        finalFileName = `${baseName}-${counter}${extension}`;
        counter += 1;
      }

      const targetPath = path.join(folderPath, finalFileName);
      fs.writeFileSync(targetPath, file.data);
      savedFiles.push({
        originalName: file.filename,
        savedName: finalFileName,
        url: `/uploads/${encodeURIComponent(folderName)}/${encodeURIComponent(finalFileName)}`,
      });
    }

    sendJson(res, 200, {
      ok: true,
      folder: folderName,
      uploaded: savedFiles,
      total: savedFiles.length,
    });
  });

  req.on('error', () => {
    sendJson(res, 500, { ok: false, message: 'Upload failed while reading file stream.' });
  });
}

function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/folders') {
    sendJson(res, 200, { ok: true, folders: getUploadedFolderList() });
    return;
  }

  if (pathname.startsWith('/api/folder/')) {
    const folderName = decodeURIComponent(pathname.replace('/api/folder/', ''));
    const folderPath = path.join(UPLOADS_DIR, folderName);

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      sendJson(res, 404, { ok: false, message: 'Folder not found.' });
      return;
    }

    const files = fs.readdirSync(folderPath)
      .filter((fileName) => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
      .map((fileName) => ({
        name: fileName,
        url: `/uploads/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    sendJson(res, 200, { ok: true, folder: folderName, files });
    return;
  }

  if (pathname === '/api/upload') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, message: 'Only POST is supported for uploads.' });
      return;
    }

    handleUpload(req, res);
    return;
  }

  sendJson(res, 404, { ok: false, message: 'API route not found.' });
}

function serveUploadedFile(req, res, url) {
  const decodedPath = decodeURIComponent(url.pathname);
  const relative = decodedPath.replace(/^\/uploads\//, '');
  const cleanTarget = relative.split('/').filter(Boolean).join(path.sep);
  const safePath = path.join(UPLOADS_DIR, cleanTarget);

  if (!safePath.startsWith(UPLOADS_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(safePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File not found');
    return;
  }

  serveStaticFile(res, safePath);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  if (pathname.startsWith('/api/')) {
    handleApi(req, res, requestUrl);
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    serveUploadedFile(req, res, requestUrl);
    return;
  }

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      serveStaticFile(res, fallback);
      return;
    }

    serveStaticFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`Image manager running at http://localhost:${PORT}`);
});
