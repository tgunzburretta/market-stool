const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { generateJobPdf } = require('./pdf');
const { sendReport } = require('./mailer');

const ROOT = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const REPORTS_DIR = path.join(ROOT, 'reports');
const PUBLIC_DIR = path.join(ROOT, 'public');

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const jobDir = path.join(UPLOADS_DIR, req.params.id);
    fs.mkdirSync(jobDir, { recursive: true });
    cb(null, jobDir);
  },
  filename: (req, file, cb) => {
    const type = req.body.type === 'before' ? 'before' : 'after';
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${req.params.index}-${type}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

function findProperty(dbData, id) {
  return dbData.properties.find((p) => p.id === id);
}

function findJob(dbData, id) {
  return dbData.jobs.find((j) => j.id === id);
}

// --- Properties ---

app.get('/api/properties', (req, res) => {
  const data = db.load();
  res.json(data.properties);
});

app.get('/api/properties/:id', (req, res) => {
  const data = db.load();
  const property = findProperty(data, req.params.id);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json(property);
});

app.post('/api/properties', (req, res) => {
  const { name, address, hostName, hostEmail, checklist } = req.body || {};
  if (!name || !address || !hostEmail) {
    return res.status(400).json({ error: 'name, address and hostEmail are required' });
  }
  if (!Array.isArray(checklist) || checklist.length === 0) {
    return res.status(400).json({ error: 'checklist must be a non-empty array of item names' });
  }

  const data = db.load();
  const property = {
    id: `prop_${crypto.randomBytes(6).toString('hex')}`,
    name,
    address,
    hostName: hostName || '',
    hostEmail,
    checklist: checklist.filter((item) => typeof item === 'string' && item.trim().length > 0),
  };
  data.properties.push(property);
  db.save(data);
  res.status(201).json(property);
});

// --- Jobs (changeovers) ---

app.post('/api/jobs', (req, res) => {
  const { propertyId, cleanerName } = req.body || {};
  if (!propertyId || !cleanerName) {
    return res.status(400).json({ error: 'propertyId and cleanerName are required' });
  }

  const data = db.load();
  const property = findProperty(data, propertyId);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const job = {
    id: uuidv4(),
    propertyId,
    cleanerName,
    status: 'in_progress',
    startedAt: Date.now(),
    completedAt: null,
    pdfUrl: null,
    emailSent: false,
    emailNote: null,
    items: property.checklist.map((name) => ({
      name,
      done: false,
      notes: '',
      beforePhoto: null,
      beforePhotoUrl: null,
      beforePhotoAt: null,
      afterPhoto: null,
      afterPhotoUrl: null,
      afterPhotoAt: null,
    })),
  };

  data.jobs.push(job);
  db.save(data);
  res.status(201).json(job);
});

app.get('/api/jobs/:id', (req, res) => {
  const data = db.load();
  const job = findJob(data, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/jobs/:id/items/:index/photo', (req, res) => {
  const data = db.load();
  const job = findJob(data, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed') return res.status(400).json({ error: 'Job already completed' });

  const index = Number(req.params.index);
  const item = job.items[index];
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });

    const type = req.body.type === 'before' ? 'before' : 'after';
    const relPath = path.relative(ROOT, req.file.path);
    const url = `/uploads/${req.params.id}/${req.file.filename}`;

    if (type === 'before') {
      item.beforePhoto = relPath;
      item.beforePhotoUrl = url;
      item.beforePhotoAt = Date.now();
    } else {
      item.afterPhoto = relPath;
      item.afterPhotoUrl = url;
      item.afterPhotoAt = Date.now();
    }

    db.save(data);
    res.json(item);
  });
});

app.patch('/api/jobs/:id/items/:index', (req, res) => {
  const data = db.load();
  const job = findJob(data, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed') return res.status(400).json({ error: 'Job already completed' });

  const index = Number(req.params.index);
  const item = job.items[index];
  if (!item) return res.status(404).json({ error: 'Checklist item not found' });

  const { done, notes } = req.body || {};
  if (typeof done === 'boolean') item.done = done;
  if (typeof notes === 'string') item.notes = notes;

  db.save(data);
  res.json(item);
});

app.post('/api/jobs/:id/complete', async (req, res) => {
  const data = db.load();
  const job = findJob(data, req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'completed') return res.status(400).json({ error: 'Job already completed' });

  const property = findProperty(data, job.propertyId);
  if (!property) return res.status(404).json({ error: 'Property not found' });

  const incomplete = job.items.filter((item) => !item.done || !item.afterPhoto);
  if (incomplete.length > 0) {
    return res.status(400).json({
      error: 'All items need an after photo and must be marked done before completing the job',
      incomplete: incomplete.map((i) => i.name),
    });
  }

  job.completedAt = Date.now();

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const pdfPath = path.join(REPORTS_DIR, `${job.id}.pdf`);
  await generateJobPdf(job, property, pdfPath);

  job.status = 'completed';
  job.pdfUrl = `/api/jobs/${job.id}/pdf`;

  try {
    const result = await sendReport({ toEmail: property.hostEmail, propertyName: property.name, pdfPath });
    job.emailSent = result.sent;
    job.emailNote = result.reason || null;
  } catch (err) {
    job.emailSent = false;
    job.emailNote = `Email send failed: ${err.message}`;
  }

  db.save(data);
  res.json(job);
});

app.get('/api/jobs/:id/pdf', (req, res) => {
  const pdfPath = path.join(REPORTS_DIR, `${req.params.id}.pdf`);
  if (!fs.existsSync(pdfPath)) return res.status(404).json({ error: 'Report not generated yet' });
  res.sendFile(pdfPath);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`CleanProof running on http://localhost:${PORT}`);
});
