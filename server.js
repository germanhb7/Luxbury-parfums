require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mercadopago = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const reservationsFile = path.join(dataDir, 'reservas.json');

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN || '',
});

const planPrices = {
  Essence: 4900,
  Velvet: 9900,
  Maison: 17900,
  'Reserva general': 1500,
};

const planNames = {
  Essence: 'Essence',
  Velvet: 'Velvet',
  Maison: 'Maison',
  'Reserva general': 'Reserva general',
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(reservationsFile)) {
    fs.writeFileSync(reservationsFile, JSON.stringify([], null, 2));
  }
}

function readReservations() {
  ensureDataFile();
  const raw = fs.readFileSync(reservationsFile, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeReservations(reservations) {
  ensureDataFile();
  fs.writeFileSync(reservationsFile, JSON.stringify(reservations, null, 2));
}

function sanitizeCardNumber(value) {
  const digits = (value || '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : 'No indicado';
}

function addReservation(data) {
  const reservations = readReservations();
  reservations.unshift(data);
  writeReservations(reservations);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Servidor de Luxbury activo' });
});

app.get('/api/reservas', (req, res) => {
  res.json(readReservations());
});

app.post('/api/create-payment', async (req, res) => {
  const {
    nombre,
    email,
    telefono,
    membresia,
    comentario,
    tarjetaNombre,
    tarjetaNumero,
    tarjetaVencimiento,
    tarjetaCvv,
  } = req.body || {};

  if (!nombre || !email || !telefono) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios: nombre, email y teléfono.',
    });
  }

  if (!process.env.MP_ACCESS_TOKEN) {
    return res.status(500).json({
      ok: false,
      message: 'Mercado Pago no está configurado aún. Agrega MP_ACCESS_TOKEN en el archivo .env.',
    });
  }

  const planKey = membresia || 'Reserva general';
  const unitPrice = planPrices[planKey] || planPrices['Reserva general'];

  try {
    const preference = {
      items: [
        {
          id: planKey,
          title: `${planNames[planKey] || 'Reserva Luxbury'} - Luxbury Parfums`,
          quantity: 1,
          unit_price: Number(unitPrice) / 100,
          currency_id: 'ARS',
        },
      ],
      payer: {
        name: nombre,
        email,
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?payment=success`,
        failure: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?payment=cancelled`,
        pending: `${process.env.FRONTEND_URL || 'http://localhost:3000'}?payment=pending`,
      },
      auto_return: 'approved',
      metadata: {
        nombre,
        email,
        telefono,
        membresia: planKey,
        comentario: comentario || 'Sin comentario',
        tarjetaNombre: tarjetaNombre || 'No indicado',
        tarjetaNumero: sanitizeCardNumber(tarjetaNumero),
        tarjetaVencimiento: tarjetaVencimiento || 'No indicado',
        tarjetaCvv: tarjetaCvv ? '***' : 'No indicado',
      },
    };

    const response = await mercadopago.preferences.create(preference);

    res.json({
      ok: true,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point,
    });
  } catch (error) {
    console.error('Error creating Mercado Pago preference:', error);
    res.status(500).json({
      ok: false,
      message: 'No se pudo iniciar el pago con Mercado Pago.',
    });
  }
});

app.post('/api/reservas', (req, res) => {
  const {
    nombre,
    email,
    telefono,
    membresia,
    comentario,
    tarjetaNombre,
    tarjetaNumero,
    tarjetaVencimiento,
    tarjetaCvv,
  } = req.body || {};

  if (!nombre || !email || !telefono) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios: nombre, email y teléfono.',
    });
  }

  const newReservation = {
    id: Date.now(),
    nombre,
    email,
    telefono,
    membresia: membresia || 'Reserva general',
    comentario: comentario || 'Sin comentario',
    tarjeta: {
      nombre: tarjetaNombre || 'No indicado',
      numero: sanitizeCardNumber(tarjetaNumero),
      vencimiento: tarjetaVencimiento || 'No indicado',
      cvv: tarjetaCvv ? '***' : 'No indicado',
    },
    createdAt: new Date().toISOString(),
  };

  addReservation(newReservation);

  res.status(201).json({
    ok: true,
    message: 'Reserva guardada exitosamente.',
    data: newReservation,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
