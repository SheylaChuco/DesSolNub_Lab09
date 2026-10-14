require('dotenv').config();
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand,
  ListObjectsV2Command, HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const REGION = process.env.AWS_REGION || 'us-east-1';
const BUCKET = process.env.S3_BUCKET;
const PORT = process.env.PORT || 3001;
const PREFIX = 'originales/';
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_EXPIRES = 300;  // 5 minutos
const VIEW_EXPIRES = 900;    // 15 minutos

if (!BUCKET) { console.error('Falta S3_BUCKET en el archivo .env'); process.exit(1); }

// Las credenciales las toma el SDK del perfil (AWS_PROFILE) o de variables de entorno.
const s3 = new S3Client({ region: REGION });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));
app.use('/api/', rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

function cleanName(name) {
  const base = path.basename(String(name || 'imagen'));
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

// 1) Presigned URL de carga (PUT, 5 min)
app.post('/api/upload-url', async (req, res) => {
  try {
    const { filename, contentType, size } = req.body || {};
    if (!filename || !contentType) return res.status(400).json({ error: 'Falta filename o contentType' });
    if (!ALLOWED.includes(contentType)) return res.status(400).json({ error: 'Tipo no permitido. Solo JPEG, PNG o WEBP' });
    const n = Number(size);
    if (!Number.isFinite(n) || n <= 0) return res.status(400).json({ error: 'Tamano invalido' });
    if (n >= MAX_SIZE) return res.status(400).json({ error: 'El archivo debe pesar menos de 5 MB' });

    const key = `${PREFIX}${Date.now()}-${cleanName(filename)}`;
    const command = new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType, ContentLength: n });
    const url = await getSignedUrl(s3, command, { expiresIn: UPLOAD_EXPIRES });
    res.json({ url, key, expiresIn: UPLOAD_EXPIRES });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo generar la URL de carga' });
  }
});

// Validacion posterior a la carga: revisa tipo y tamano reales en S3
app.post('/api/confirm', async (req, res) => {
  try {
    const key = String((req.body || {}).key || '');
    if (!key.startsWith(PREFIX)) return res.status(400).json({ error: 'Clave invalida' });
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    if (!ALLOWED.includes(head.ContentType) || head.ContentLength >= MAX_SIZE) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
      return res.status(422).json({ error: 'Archivo invalido, fue eliminado' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo verificar el archivo' });
  }
});

// 2) Listar imagenes con presigned URL de visualizacion (GET, 15 min)
app.get('/api/images', async (req, res) => {
  try {
    const out = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: PREFIX }));
    const items = (out.Contents || []).filter(o => o.Key !== PREFIX && /\.(jpe?g|png|webp)$/i.test(o.Key));
    const images = await Promise.all(items.map(async o => ({
      name: o.Key.slice(PREFIX.length),
      size: o.Size,
      lastModified: o.LastModified,
      url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: o.Key }), { expiresIn: VIEW_EXPIRES })
    })));
    images.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
    res.json({ images, expiresIn: VIEW_EXPIRES });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo listar las imagenes' });
  }
});

// 3) Eliminar imagen
app.delete('/api/images/:key', async (req, res) => {
  try {
    const name = path.basename(req.params.key);
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: PREFIX + name }));
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'No se pudo eliminar la imagen' });
  }
});

const server = app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));
server.on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`El puerto ${PORT} esta ocupado. Cambia PORT en .env`);
  else console.error(err);
  process.exit(1);
});
