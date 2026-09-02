const APPMAX_TOKEN = process.env.APPMAX_API_KEY || '867671B2-8DA3267A-01EDA295-14DBCC7E';

const PACK_PRICES = {
  1: 177.90,
  2: 297.90,
  3: 397.90
};

const PACK_NAMES = {
  1: '1x Quattro Spray',
  2: '2x Quattro Spray',
  3: '3x Quattro Spray'
};

function sendJson(res, statusCode, body) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (typeof res.status === 'function') {
    return res.status(statusCode).json(body);
  }
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const data = payload.data || payload;
    const { action, quantity = 1, cpf, card, contact, address, orderId: checkOrderId } = data;

    // Handle status check
    if (action === 'status') {
      if (checkOrderId) {
        try {
          const statusRes = await fetch(`https://admin.appmax.com.br/api/v3/order/${checkOrderId}?access-token=${APPMAX_TOKEN}`);
          const statusData = await statusRes.json();
          if (statusData.success && statusData.data) {
            const st = (statusData.data.status || '').toLowerCase();
            const isPaid = st === 'paid' || st === 'aprovado' || st === 'approved' || st === 'integralizado';
            return sendJson(res, 200, {
              ok: true,
              state: isPaid ? 'paid' : 'pending',
              status: statusData.data.status
            });
          }
        } catch (eStatus) {
          console.error('Status check error:', eStatus);
        }
      }
      return sendJson(res, 200, { ok: true, state: 'pending' });
    }

    // Clean CPF/phone
    const cleanCpf = (cpf || card?.document_number || '18521413793').replace(/\D/g, '');
    const cleanPhone = (contact?.phone || '11999999999').replace(/\D/g, '');
    const name = contact?.name || card?.holder || 'Cliente Quattro';
    const nameParts = name.trim().split(/\s+/);
    const firstname = nameParts[0] || 'Cliente';
    const lastname = nameParts.slice(1).join(' ') || 'Quattro';
    const email = contact?.email || 'cliente@quattrospray.com';

    // Calculate shipping/freight cost
    let shippingAmount = 0;
    if (typeof data.shippingCents === 'number') {
      shippingAmount = data.shippingCents / 100;
    } else if (typeof data.shipping === 'number') {
      shippingAmount = data.shipping;
    } else if (typeof data.shippingCents === 'string') {
      shippingAmount = parseFloat(data.shippingCents) / 100;
    }

    // 1. Create Customer in Appmax
    const customerRes = await fetch('https://admin.appmax.com.br/api/v3/customer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'access-token': APPMAX_TOKEN,
        firstname,
        lastname,
        email,
        telephone: cleanPhone,
        postcode: (address?.cep || '01001000').replace(/\D/g, ''),
        address: address?.street || 'Rua Principal',
        number: address?.number || '100',
        district: address?.district || 'Centro',
        city: address?.city || 'São Paulo',
        state: address?.state || 'SP'
      })
    });

    const customerData = await customerRes.json();
    if (!customerData.success || !customerData.data?.id) {
      return sendJson(res, 400, { ok: false, error: customerData.text || 'Erro ao cadastrar cliente na Appmax' });
    }

    const customerId = customerData.data.id;
    const price = PACK_PRICES[quantity] || PACK_PRICES[1];
    const packName = PACK_NAMES[quantity] || PACK_NAMES[1];

    // 2. Create Order in Appmax (including shipping cost)
    const orderRes = await fetch('https://admin.appmax.com.br/api/v3/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'access-token': APPMAX_TOKEN,
        customer_id: customerId,
        shipping: shippingAmount,
        products: [
          {
            sku: `QTR-${quantity}X`,
            name: packName,
            qty: 1,
            price: price
          }
        ]
      })
    });

    const orderData = await orderRes.json();
    if (!orderData.success || !orderData.data?.id) {
      return sendJson(res, 400, { ok: false, error: orderData.text || 'Erro ao criar pedido na Appmax' });
    }

    const orderId = orderData.data.id;
    const expiresAtIso = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 3. Process Payment (PIX or Credit Card)
    if (action === 'pix' || !card) {
      const pixRes = await fetch('https://admin.appmax.com.br/api/v3/payment/pix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'access-token': APPMAX_TOKEN,
          cart: { order_id: orderId },
          customer: { customer_id: customerId },
          payment: {
            pix: { document_number: cleanCpf }
          }
        })
      });

      const pixData = await pixRes.json();
      if (!pixData.success || !pixData.data) {
        return sendJson(res, 400, { ok: false, error: pixData.text || 'Erro ao gerar PIX na Appmax' });
      }

      const pixEmv = pixData.data.pix_emv || '';
      const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixEmv)}`;

      let base64Qr = '';
      try {
        const qrRes = await fetch(qrApiUrl);
        if (qrRes.status === 200) {
          const buf = Buffer.from(await qrRes.arrayBuffer());
          base64Qr = buf.toString('base64');
        }
      } catch (errQr) {
        console.error('QR code fetch error:', errQr);
      }

      const expDate = pixData.data.pix_expiration_date 
        ? new Date(pixData.data.pix_expiration_date.replace(' ', 'T')).toISOString()
        : expiresAtIso;

      return sendJson(res, 200, {
        ok: true,
        success: true,
        orderId: orderId,
        customerId: customerId,
        copyPaste: pixEmv,
        pix_emv: pixEmv,
        qrCodeUrl: qrApiUrl,
        qrCodeBase64: base64Qr,
        expiresAt: expDate,
        pix_expiration_date: pixData.data.pix_expiration_date || expDate
      });
    } else {
      // Credit Card Payment
      const [expMonth, expYearRaw] = (card.expiry || '12/2028').split('/');
      let expYear = (expYearRaw || '28').trim();
      if (expYear.length === 2) expYear = '20' + expYear;

      const cardRes = await fetch('https://admin.appmax.com.br/api/v3/payment/credit-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'access-token': APPMAX_TOKEN,
          cart: { order_id: orderId },
          customer: { customer_id: customerId },
          payment: {
            CreditCard: {
              number: (card.number || '').replace(/\D/g, ''),
              cvv: (card.cvv || '').trim(),
              month: (expMonth || '12').trim(),
              year: expYear,
              name: card.holder || name,
              document_number: cleanCpf,
              installments: parseInt(data.installments || 1, 10)
            }
          }
        })
      });

      const cardData = await cardRes.json();
      if (!cardData.success) {
        const errorMsg = cardData.text || cardData.data?.message || 'Cartão recusado. Confira os dados ou tente outro cartão.';
        return sendJson(res, 400, { ok: false, error: errorMsg, reason: errorMsg });
      }

      return sendJson(res, 200, {
        ok: true,
        success: true,
        orderId: orderId,
        customerId: customerId,
        status: cardData.data?.status || 'aprovado'
      });
    }
  } catch (err) {
    console.error('Appmax Handler Error:', err);
    return sendJson(res, 500, { ok: false, error: err.message });
  }
}
