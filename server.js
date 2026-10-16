require('dotenv').config();
const dns = require('dns');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const mercadopago = require('mercadopago');

// Configuración DNS para evitar ECONNREFUSED en registros SRV de MongoDB Atlas en Windows / redes locales
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // Ignorar si el entorno no permite modificar servidores DNS
}

const app = express();
const PORT = process.env.PORT || 3000;
const dataDir = path.join(__dirname, 'data');
const reservationsFile = path.join(dataDir, 'reservas.json');
const commentsFile = path.join(dataDir, 'comentarios.json');

// --- Configuración de Mercado Pago ---
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

// --- Middlewares ---
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(__dirname));

// --- Conexión a MongoDB Atlas con Mongoose ---
const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI) {
  mongoose
    .connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    })
    .then(() => {
      console.log('✅ Conectado exitosamente a MongoDB Atlas (Luxbury)');
    })
    .catch((err) => {
      console.error('⚠️ No se pudo conectar a MongoDB Atlas:', err.message);
      console.log('ℹ️ Operando en modo de respaldo con almacenamiento local JSON.');
    });
} else {
  console.log('ℹ️ MONGODB_URI no definida. Operando con almacenamiento local JSON.');
}

// --- Modelos de Mongoose ---
const comentarioSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true },
  texto: { type: String, required: true },
  rating: { type: Number, default: 5 },
  createdAt: { type: Date, default: Date.now },
});

const Comentario = mongoose.models.Comentario || mongoose.model('Comentario', comentarioSchema);

const reservaSchema = new mongoose.Schema({
  nombre: { type: String, required: true },
  email: { type: String, required: true },
  telefono: { type: String, required: true },
  membresia: { type: String, default: 'Reserva general' },
  comentario: { type: String, default: 'Sin comentario' },
  tarjeta: {
    nombre: { type: String, default: 'No indicado' },
    numero: { type: String, default: 'No indicado' },
    vencimiento: { type: String, default: 'No indicado' },
    cvv: { type: String, default: 'No indicado' },
  },
  createdAt: { type: Date, default: Date.now },
});

const Reserva = mongoose.models.Reserva || mongoose.model('Reserva', reservaSchema);

// --- Helpers para persistencia de respaldo en JSON local ---
function ensureDataFile(filePath) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify([], null, 2));
  }
}

function readJson(filePath) {
  ensureDataFile(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeJson(filePath, value) {
  ensureDataFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readReservations() {
  return readJson(reservationsFile);
}

function writeReservations(reservations) {
  writeJson(reservationsFile, reservations);
}

function readComments() {
  return readJson(commentsFile);
}

function writeComments(comments) {
  writeJson(commentsFile, comments);
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

function addComment(data) {
  const comments = readComments();
  comments.unshift(data);
  writeComments(comments);
}

// --- Endpoints de la API ---

// Estado del servidor y de la base de datos
app.get('/api/health', (req, res) => {
  const isMongoReady = mongoose.connection.readyState === 1;
  res.json({
    ok: true,
    message: 'Servidor de Luxbury activo',
    database: isMongoReady ? 'Conectado a MongoDB Atlas' : 'Almacenamiento local (JSON)',
    mongoReadyState: mongoose.connection.readyState,
  });
});

// Obtener todas las reservas (desde MongoDB con fallback a JSON)
app.get('/api/reservas', async (req, res) => {
  if (MONGODB_URI) {
    try {
      const reservas = await Reserva.find().sort({ createdAt: -1 }).lean();
      if (reservas && reservas.length > 0) {
        return res.json(
          reservas.map((r) => ({
            id: r._id,
            nombre: r.nombre,
            email: r.email,
            telefono: r.telefono,
            membresia: r.membresia,
            comentario: r.comentario,
            tarjeta: r.tarjeta,
            createdAt: r.createdAt,
          }))
        );
      }
    } catch (error) {
      console.error('Error al consultar reservas en MongoDB Atlas:', error.message);
    }
  }
  res.json(readReservations());
});

// Obtener todos los comentarios (desde MongoDB con fallback a JSON)
app.get('/api/comentarios', async (req, res) => {
  if (MONGODB_URI) {
    try {
      const comentarios = await Comentario.find().sort({ createdAt: -1 }).lean();
      if (comentarios && comentarios.length > 0) {
        return res.json(
          comentarios.map((c) => ({
            id: c._id,
            nombre: c.nombre,
            email: c.email,
            texto: c.texto,
            rating: c.rating,
            createdAt: c.createdAt,
          }))
        );
      }
    } catch (error) {
      console.error('Error al consultar comentarios en MongoDB Atlas:', error.message);
    }
  }
  res.json(readComments());
});

// Guardar un nuevo comentario
app.post('/api/comentarios', async (req, res) => {
  const { nombre, email, texto, rating } = req.body || {};

  if (!nombre || !email || !texto) {
    return res.status(400).json({
      ok: false,
      message: 'Faltan datos obligatorios: nombre, email y comentario.',
    });
  }

  const commentData = {
    nombre: String(nombre).trim(),
    email: String(email).trim(),
    texto: String(texto).trim(),
    rating: Number(rating) || 5,
    createdAt: new Date().toISOString(),
    id: Date.now(),
  };

  if (MONGODB_URI) {
    try {
      const nuevo = new Comentario({
        nombre: commentData.nombre,
        email: commentData.email,
        texto: commentData.texto,
        rating: commentData.rating,
        createdAt: commentData.createdAt,
      });
      const doc = await nuevo.save();
      commentData.id = doc._id;
    } catch (err) {
      console.error('Error guardando comentario en MongoDB Atlas:', err.message);
    }
  }

  // Guardamos también en JSON de respaldo para redundancia
  addComment(commentData);

  res.status(201).json({
    ok: true,
    message: 'Comentario guardado exitosamente.',
    data: commentData,
  });
});

// Guardar reserva directa
app.post('/api/reservas', async (req, res) => {
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

  const reservationData = {
    nombre: String(nombre).trim(),
    email: String(email).trim(),
    telefono: String(telefono).trim(),
    membresia: membresia || 'Reserva general',
    comentario: comentario || 'Sin comentario',
    tarjeta: {
      nombre: tarjetaNombre || 'No indicado',
      numero: sanitizeCardNumber(tarjetaNumero),
      vencimiento: tarjetaVencimiento || 'No indicado',
      cvv: tarjetaCvv ? '***' : 'No indicado',
    },
    createdAt: new Date().toISOString(),
    id: Date.now(),
  };

  if (MONGODB_URI) {
    try {
      const nueva = new Reserva(reservationData);
      const doc = await nueva.save();
      reservationData.id = doc._id;
    } catch (err) {
      console.error('Error guardando reserva en MongoDB Atlas:', err.message);
    }
  }

  addReservation(reservationData);

  res.status(201).json({
    ok: true,
    message: 'Reserva guardada exitosamente.',
    data: reservationData,
  });
});

// Crear sesión de pago en Mercado Pago y registrar reserva
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

  const reservationRecord = {
    nombre: String(nombre).trim(),
    email: String(email).trim(),
    telefono: String(telefono).trim(),
    membresia: membresia || 'Reserva general',
    comentario: comentario || 'Sin comentario',
    tarjeta: {
      nombre: tarjetaNombre || 'No indicado',
      numero: sanitizeCardNumber(tarjetaNumero),
      vencimiento: tarjetaVencimiento || 'No indicado',
      cvv: tarjetaCvv ? '***' : 'No indicado',
    },
    createdAt: new Date().toISOString(),
    id: Date.now(),
  };

  // Guardamos la reserva en MongoDB Atlas y en JSON
  if (MONGODB_URI) {
    try {
      const nueva = new Reserva(reservationRecord);
      const doc = await nueva.save();
      reservationRecord.id = doc._id;
    } catch (err) {
      console.error('Error guardando reserva en MongoDB Atlas:', err.message);
    }
  }
  addReservation(reservationRecord);

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

module.exports = { app };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor Luxbury corriendo en http://localhost:${PORT}`);
  });
}
