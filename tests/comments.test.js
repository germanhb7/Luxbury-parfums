const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { app } = require('../server.js');

async function request(path, options = {}) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const body = await response.text();
    return {
      status: response.status,
      body: body ? JSON.parse(body) : null,
    };
  } finally {
    server.close();
  }
}

test('POST /api/comentarios guarda un comentario con país/ciudad', async () => {
  const result = await request('/api/comentarios', {
    method: 'POST',
    body: JSON.stringify({
      nombre: 'Ana',
      email: 'ana@test.com',
      pais: 'Buenos Aires',
      texto: 'Me encantó la fragancia.',
    }),
  });

  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.nombre, 'Ana');
  assert.equal(result.body.data.pais, 'Buenos Aires');
  assert.equal(result.body.data.texto, 'Me encantó la fragancia.');
});

test('GET /api/comentarios devuelve la lista con país', async () => {
  const result = await request('/api/comentarios');

  assert.equal(result.status, 200);
  assert.equal(Array.isArray(result.body), true);
  if (result.body.length > 0) {
    assert.ok(result.body[0].pais !== undefined);
  }
});

test.after(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
});
