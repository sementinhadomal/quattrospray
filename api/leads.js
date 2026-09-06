const fs = require('fs');
const path = require('path');

const STORAGE_FILE = path.join('/tmp', 'quattrospray_leads.json');
const CLOUD_STORAGE_URL = 'https://api.restful-api.dev/objects/ff808181a067127101a07852d5f12ae1';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'quattro123';

// Status hierarchy (higher rank replaces lower rank)
const STATUS_RANK = {
  'Incompleto': 1,
  'PIX Gerado': 2,
  'Tentativa de Cartão': 3,
  'Compra Concluída': 4
};

function sendJson(res, statusCode, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-password');

  if (typeof res.status === 'function') {
    return res.status(statusCode).json(body);
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// In-memory cache for fast Lambda responses
let memoryLeadsCache = null;
let lastCacheFetch = 0;

async function getLeads() {
  const now = Date.now();
  if (memoryLeadsCache && (now - lastCacheFetch < 3000)) {
    return memoryLeadsCache;
  }

  // 1. Try local disk /tmp cache first
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed) && parsed.length > 0) {
        memoryLeadsCache = parsed;
        lastCacheFetch = now;
        return memoryLeadsCache;
      }
    }
  } catch (e) {
    console.error('Error reading local storage file:', e);
  }

  // 2. Fetch from Cloud storage
  try {
    const cloudRes = await fetch(CLOUD_STORAGE_URL);
    if (cloudRes.ok) {
      const cloudData = await cloudRes.json();
      if (cloudData && cloudData.data && Array.isArray(cloudData.data.leads)) {
        memoryLeadsCache = cloudData.data.leads;
        lastCacheFetch = now;
        // Save to local /tmp
        try { fs.writeFileSync(STORAGE_FILE, JSON.stringify(memoryLeadsCache, null, 2)); } catch (_) {}
        return memoryLeadsCache;
      }
    }
  } catch (e) {
    console.error('Error fetching cloud leads:', e);
  }

  memoryLeadsCache = memoryLeadsCache || [];
  return memoryLeadsCache;
}

async function saveLeads(leads) {
  memoryLeadsCache = leads;
  lastCacheFetch = Date.now();

  // Save to /tmp
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(leads, null, 2));
  } catch (e) {
    console.error('Error writing /tmp storage file:', e);
  }

  // Async sync to Cloud storage
  try {
    await fetch(CLOUD_STORAGE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'quattrospray_leads',
        data: { leads }
      })
    });
  } catch (e) {
    console.error('Error updating cloud storage:', e);
  }
}

function cleanDigits(str) {
  return str ? String(str).replace(/\D/g, '') : '';
}

function generateLeadId(phone, email) {
  const cleanP = cleanDigits(phone);
  const cleanE = (email || '').toLowerCase().trim();
  if (cleanP) return `lead_${cleanP}`;
  if (cleanE) return `lead_${cleanE.replace(/[^a-z0-9]/g, '_')}`;
  return `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function formatCSVField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function generateCSV(leads) {
  const headers = [
    'Data/Hora',
    'Status',
    'Nome',
    'Email',
    'WhatsApp (Telefone)',
    'CPF',
    'Kit Selecionado',
    'Versao Site',
    'Logradouro',
    'Numero',
    'Complemento',
    'Bairro',
    'Cidade',
    'UF',
    'CEP',
    'Respostas Quiz',
    'UTM Source',
    'UTM Medium',
    'UTM Campaign'
  ];

  const rows = leads.map(l => {
    const addr = l.address || {};
    const quiz = typeof l.quizAnswers === 'object' ? JSON.stringify(l.quizAnswers) : (l.quizAnswers || '');
    const dateFormatted = l.updatedAt ? new Date(l.updatedAt).toLocaleString('pt-BR') : '';

    return [
      formatCSVField(dateFormatted),
      formatCSVField(l.status || 'Incompleto'),
      formatCSVField(l.name || ''),
      formatCSVField(l.email || ''),
      formatCSVField(l.phone || ''),
      formatCSVField(l.cpf || ''),
      formatCSVField(l.kit || ''),
      formatCSVField(l.version || 'v1'),
      formatCSVField(addr.street || addr.address || ''),
      formatCSVField(addr.number || ''),
      formatCSVField(addr.complement || ''),
      formatCSVField(addr.district || addr.bairro || ''),
      formatCSVField(addr.city || ''),
      formatCSVField(addr.state || addr.uf || ''),
      formatCSVField(addr.zip || addr.cep || ''),
      formatCSVField(quiz),
      formatCSVField(l.utmSource || ''),
      formatCSVField(l.utmMedium || ''),
      formatCSVField(l.utmCampaign || '')
    ].join(',');
  });

  return '\uFEFF' + [headers.join(','), ...rows].join('\n'); // UTF-8 BOM for Excel
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  const leads = await getLeads();

  // GET Request: Admin dashboard lead listing or CSV export
  if (req.method === 'GET') {
    const password = req.headers['x-admin-password'] || req.query.password || req.query.pwd;
    if (password !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: 'Senha de acesso incorreta' });
    }

    if (req.query.action === 'export') {
      const csv = generateCSV(leads);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="leads-remarketing-quattrospray.csv"');
      if (typeof res.status === 'function') {
        return res.status(200).send(csv);
      }
      res.writeHead(200);
      return res.end(csv);
    }

    return sendJson(res, 200, {
      ok: true,
      total: leads.length,
      leads: leads.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    });
  }

  // POST Request: Save lead or delete lead
  if (req.method === 'POST') {
    let body = req.body || {};
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) {}
    }

    const password = req.headers['x-admin-password'] || body.password;
    
    // Check if delete action
    if (body.action === 'delete' || req.query.action === 'delete') {
      if (password !== ADMIN_PASSWORD) {
        return sendJson(res, 401, { ok: false, error: 'Senha incorreta' });
      }
      const targetId = body.leadId || body.id;
      let newLeads = leads;
      if (body.deleteAll) {
        newLeads = [];
      } else if (targetId) {
        newLeads = leads.filter(l => l.id !== targetId);
      }
      await saveLeads(newLeads);
      return sendJson(res, 200, { ok: true, leads: newLeads });
    }

    // Capture / Upsert Lead
    const {
      name,
      email,
      phone,
      cpf,
      address,
      kit,
      version,
      quizAnswers,
      status = 'Incompleto',
      utmSource,
      utmMedium,
      utmCampaign
    } = body;

    const cleanP = cleanDigits(phone);
    const cleanE = (email || '').toLowerCase().trim();
    const cleanC = cleanDigits(cpf);

    // Require at least name, phone, or email to save a meaningful lead
    if (!name && !cleanP && !cleanE && !cleanC) {
      return sendJson(res, 400, { ok: false, error: 'Sem dados suficientes para capturar lead' });
    }

    const leadId = body.id || generateLeadId(phone, email);
    const now = new Date().toISOString();

    let existingIndex = -1;
    if (leadId) {
      existingIndex = leads.findIndex(l => l.id === leadId);
    }
    if (existingIndex === -1 && cleanP && cleanP.length >= 8) {
      existingIndex = leads.findIndex(l => cleanDigits(l.phone) === cleanP);
    }
    if (existingIndex === -1 && cleanE) {
      existingIndex = leads.findIndex(l => (l.email || '').toLowerCase().trim() === cleanE);
    }

    if (existingIndex >= 0) {
      const existing = leads[existingIndex];
      // Compare status priority
      const currentRank = STATUS_RANK[existing.status] || 1;
      const newRank = STATUS_RANK[status] || 1;
      const finalStatus = newRank >= currentRank ? status : existing.status;

      leads[existingIndex] = {
        ...existing,
        id: leadId || existing.id,
        name: name || existing.name,
        email: email || existing.email,
        phone: phone || existing.phone,
        cpf: cpf || existing.cpf,
        address: {
          ...(existing.address || {}),
          ...(address || {})
        },
        kit: kit || existing.kit,
        version: version || existing.version || 'v1',
        quizAnswers: quizAnswers || existing.quizAnswers,
        status: finalStatus,
        utmSource: utmSource || existing.utmSource,
        utmMedium: utmMedium || existing.utmMedium,
        utmCampaign: utmCampaign || existing.utmCampaign,
        updatedAt: now
      };
    } else {
      const newLead = {
        id: leadId,
        name: name || 'Cliente sem nome',
        email: email || '',
        phone: phone || '',
        cpf: cpf || '',
        address: address || {},
        kit: kit || '',
        version: version || 'v1',
        quizAnswers: quizAnswers || null,
        status: status,
        utmSource: utmSource || '',
        utmMedium: utmMedium || '',
        utmCampaign: utmCampaign || '',
        createdAt: now,
        updatedAt: now
      };
      leads.unshift(newLead);
    }

    await saveLeads(leads);
    return sendJson(res, 200, { ok: true, leadId, totalLeads: leads.length });
  }

  return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
};
