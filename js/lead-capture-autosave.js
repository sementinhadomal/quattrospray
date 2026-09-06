(function() {
  'use strict';

  // Prevent multiple injections
  if (window.__quattroLeadCaptureInitialized) return;
  window.__quattroLeadCaptureInitialized = true;

  var leadDebounceTimer = null;

  function getUTMParams() {
    try {
      var p = new URLSearchParams(window.location.search);
      return {
        utmSource: p.get('utm_source') || p.get('src') || '',
        utmMedium: p.get('utm_medium') || '',
        utmCampaign: p.get('utm_campaign') || ''
      };
    } catch(e) {
      return { utmSource: '', utmMedium: '', utmCampaign: '' };
    }
  }

  function getSiteVersion() {
    var path = window.location.pathname.toLowerCase();
    if (path.indexOf('/1') === 0 || path.indexOf('/quiz2') === 0 || window.location.href.indexOf('/1') !== -1 || window.location.href.indexOf('/quiz2') !== -1) {
      return 'v2';
    }
    return 'v1';
  }

  function cleanDigits(str) {
    return str ? String(str).replace(/\D/g, '') : '';
  }

  function extractLeadFromDOM() {
    var lead = {
      name: '',
      email: '',
      phone: '',
      cpf: '',
      address: {
        street: '',
        number: '',
        complement: '',
        district: '',
        city: '',
        state: '',
        zip: ''
      },
      kit: '',
      version: getSiteVersion(),
      quizAnswers: null,
      status: 'Incompleto'
    };

    // Load quiz answers from localStorage if available
    try {
      var savedQuiz = localStorage.getItem('quattro_quiz_answers') || localStorage.getItem('quiz_answers');
      if (savedQuiz) {
        lead.quizAnswers = JSON.parse(savedQuiz);
      }
    } catch(e) {}

    // Load draft lead from localStorage
    try {
      var draft = localStorage.getItem('quattro_lead_draft');
      if (draft) {
        var parsed = JSON.parse(draft);
        if (parsed && typeof parsed === 'object') {
          lead = Object.assign(lead, parsed);
        }
      }
    } catch(e) {}

    // Scan all input elements on page
    var inputs = document.querySelectorAll('input, select, textarea');
    inputs.forEach(function(inp) {
      var val = (inp.value || '').trim();
      if (!val) return;

      var name = (inp.name || '').toLowerCase();
      var id = (inp.id || '').toLowerCase();
      var placeholder = (inp.placeholder || '').toLowerCase();
      var type = (inp.type || '').toLowerCase();

      // Name
      if (name.indexOf('name') !== -1 || name.indexOf('nome') !== -1 || id.indexOf('name') !== -1 || id.indexOf('nome') !== -1 || placeholder.indexOf('nome completo') !== -1 || placeholder.indexOf('seu nome') !== -1) {
        lead.name = val;
      }
      // Email
      else if (type === 'email' || name.indexOf('email') !== -1 || id.indexOf('email') !== -1 || placeholder.indexOf('email') !== -1 || placeholder.indexOf('e-mail') !== -1) {
        lead.email = val;
      }
      // Phone / WhatsApp
      else if (type === 'tel' || name.indexOf('phone') !== -1 || name.indexOf('tel') !== -1 || name.indexOf('whatsapp') !== -1 || id.indexOf('phone') !== -1 || id.indexOf('tel') !== -1 || id.indexOf('whatsapp') !== -1 || placeholder.indexOf('whatsapp') !== -1 || placeholder.indexOf('telefone') !== -1 || placeholder.indexOf('celular') !== -1) {
        lead.phone = val;
      }
      // CPF
      else if (name.indexOf('cpf') !== -1 || name.indexOf('document') !== -1 || id.indexOf('cpf') !== -1 || placeholder.indexOf('cpf') !== -1) {
        lead.cpf = val;
      }
      // CEP
      else if (name.indexOf('cep') !== -1 || name.indexOf('zip') !== -1 || id.indexOf('cep') !== -1 || placeholder.indexOf('cep') !== -1) {
        lead.address.zip = val;
      }
      // Street / Logradouro
      else if (name.indexOf('street') !== -1 || name.indexOf('rua') !== -1 || name.indexOf('address') !== -1 || name.indexOf('logradouro') !== -1 || id.indexOf('street') !== -1 || id.indexOf('rua') !== -1 || placeholder.indexOf('endereço') !== -1 || placeholder.indexOf('rua') !== -1) {
        lead.address.street = val;
      }
      // Number
      else if (name.indexOf('number') !== -1 || name.indexOf('numero') !== -1 || id.indexOf('number') !== -1 || id.indexOf('numero') !== -1 || placeholder.indexOf('número') !== -1) {
        lead.address.number = val;
      }
      // Complement
      else if (name.indexOf('complement') !== -1 || name.indexOf('complemento') !== -1 || id.indexOf('complemento') !== -1) {
        lead.address.complement = val;
      }
      // District / Bairro
      else if (name.indexOf('bairro') !== -1 || name.indexOf('district') !== -1 || id.indexOf('bairro') !== -1) {
        lead.address.district = val;
      }
      // City
      else if (name.indexOf('cidade') !== -1 || name.indexOf('city') !== -1 || id.indexOf('cidade') !== -1) {
        lead.address.city = val;
      }
      // State / UF
      else if (name.indexOf('uf') !== -1 || name.indexOf('state') !== -1 || name.indexOf('estado') !== -1 || id.indexOf('uf') !== -1) {
        lead.address.state = val;
      }
    });

    // Detect selected kit if present in DOM or localStorage
    try {
      var kitSelected = localStorage.getItem('selected_kit') || localStorage.getItem('quattro_kit');
      if (kitSelected) {
        lead.kit = kitSelected;
      } else {
        var activeKitEl = document.querySelector('.kit-option.active, [data-kit-selected="true"], .selected-pack');
        if (activeKitEl) {
          lead.kit = activeKitEl.innerText.trim();
        }
      }
    } catch(e) {}

    // Add UTM parameters
    var utms = getUTMParams();
    lead.utmSource = utms.utmSource;
    lead.utmMedium = utms.utmMedium;
    lead.utmCampaign = utms.utmCampaign;

    return lead;
  }

  function saveLeadToServer(customStatus) {
    var leadData = extractLeadFromDOM();
    if (customStatus) {
      leadData.status = customStatus;
    }

    // Must have at least a phone, email, or name to be a valid lead
    var hasPhone = cleanDigits(leadData.phone).length >= 8;
    var hasEmail = leadData.email && leadData.email.indexOf('@') !== -1;
    var hasName = leadData.name && leadData.name.trim().length >= 2;

    if (!hasPhone && !hasEmail && !hasName) {
      return;
    }

    // Save to localStorage as draft
    try {
      localStorage.setItem('quattro_lead_draft', JSON.stringify(leadData));
    } catch(e) {}

    // Send POST to /api/leads
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([JSON.stringify(leadData)], { type: 'application/json' });
        navigator.sendBeacon('/api/leads', blob);
      } else {
        fetch('/api/leads', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadData),
          keepalive: true
        }).catch(function(){});
      }
    } catch(e) {}
  }

  function debouncedSave() {
    if (leadDebounceTimer) clearTimeout(leadDebounceTimer);
    leadDebounceTimer = setTimeout(function() {
      saveLeadToServer('Incompleto');
    }, 600);
  }

  // Global listeners on inputs
  document.addEventListener('input', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
      debouncedSave();
    }
  }, true);

  document.addEventListener('blur', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
      saveLeadToServer('Incompleto');
    }
  }, true);

  document.addEventListener('change', function(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) {
      saveLeadToServer('Incompleto');
    }
  }, true);

  // Global listener on buttons to update status on click
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('button, a, [role="button"]');
    if (!btn) return;

    var text = (btn.innerText || btn.textContent || '').toLowerCase();

    // PIX button click
    if (text.indexOf('pix') !== -1 || text.indexOf('gerar pix') !== -1 || text.indexOf('pagar com pix') !== -1) {
      saveLeadToServer('PIX Gerado');
    }
    // Credit card / Order submit button click
    else if (text.indexOf('cartão') !== -1 || text.indexOf('cartao') !== -1 || text.indexOf('finalizar') !== -1 || text.indexOf('concluir compra') !== -1 || text.indexOf('comprar agora') !== -1) {
      saveLeadToServer('Tentativa de Cartão');
    }
    else {
      // General submit/continue button click
      debouncedSave();
    }
  }, true);

  // Initial check after page loads
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(debouncedSave, 1500); });
  } else {
    setTimeout(debouncedSave, 1500);
  }

})();
