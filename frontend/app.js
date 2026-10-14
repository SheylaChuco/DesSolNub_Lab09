const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 5 * 1024 * 1024;

const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');
const msg = document.getElementById('msg');
const gallery = document.getElementById('gallery');

function show(text, type) { msg.textContent = text; msg.className = 'msg ' + (type || ''); }

async function uploadFile(file) {
  // Validacion en el frontend
  if (!ALLOWED.includes(file.type)) return show('Tipo no permitido. Solo JPG, PNG o WEBP.', 'err');
  if (file.size >= MAX_SIZE) return show('El archivo debe pesar menos de 5 MB.', 'err');

  try {
    show('Pidiendo URL de carga...');
    const r = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size })
    });
    const data = await r.json();
    if (!r.ok) return show(data.error || 'Error al pedir la URL', 'err');

    show('Subiendo a S3...');
    const put = await fetch(data.url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!put.ok) return show('S3 rechazo la subida (' + put.status + ')', 'err');

    const c = await fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: data.key })
    });
    if (!c.ok) { const e = await c.json(); return show(e.error, 'err'); }

    show('Imagen subida correctamente.', 'ok');
    loadImages();
  } catch (e) {
    show('Error de red: ' + e.message, 'err');
  }
}

async function loadImages() {
  const r = await fetch('/api/images');
  const data = await r.json();
  gallery.innerHTML = '';
  if (!data.images || !data.images.length) {
    gallery.innerHTML = '<p class="empty">Todavia no hay imagenes.</p>';
    return;
  }
  data.images.forEach(img => {
    const card = document.createElement('div');
    card.className = 'card';
    const pic = document.createElement('img');
    pic.src = img.url; pic.alt = img.name;
    const info = document.createElement('div');
    info.className = 'info';
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = img.name; name.title = img.name;
    const btn = document.createElement('button');
    btn.textContent = 'Eliminar';
    btn.onclick = () => removeImage(img.name);
    info.append(name, btn);
    card.append(pic, info);
    gallery.appendChild(card);
  });
}

async function removeImage(name) {
  if (!confirm('Eliminar ' + name + '?')) return;
  const r = await fetch('/api/images/' + encodeURIComponent(name), { method: 'DELETE' });
  if (r.ok) { show('Imagen eliminada.', 'ok'); loadImages(); }
  else show('No se pudo eliminar.', 'err');
}

fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); fileInput.value = ''; });
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) uploadFile(f); });

loadImages();
