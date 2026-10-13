const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm'),
  {
    createRequire
  } = require('node:module');
process.env.CUSTOMER_JWT_SECRET = 'isolated-ticket-portal-test-secret';
function response() {
  return {
    code: 200,
    headers: {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    setHeader(key, value) {
      this.headers[key] = value;
    },
    cookie(name, value, options) {
      this.cookieResult = {
        name,
        value,
        options
      };
    },
    clearCookie(name, options) {
      this.cleared = {
        name,
        options
      };
    }
  };
}
function fixture() {
  let state = {
    challenges: [],
    shares: [],
    tickets: Array.from({
      length: 5
    }, (_, i) => ({
      id: 'ticket' + i,
      orderId: 'order',
      countryId: 'CIV',
      eventId: 'event',
      ticketTypeId: 'standard',
      ticketCode: 'TCK-' + i,
      qrToken: 'private-qr-' + i,
      status: 'ACTIVE',
      assignedGuestName: null,
      holderFullName: 'Acheteur privé',
      holderPhone: '0700000000',
      holderEmail: 'owner@example.test'
    })),
    orders: [{
      id: 'order',
      orderNumber: 'EVT-TEST-001',
      countryId: 'CIV',
      eventId: 'event',
      buyerEmail: 'owner@example.test',
      buyerPhone: '0700000000',
      buyerFullName: 'Acheteur privé',
      holderEmail: 'guest@example.test',
      quantity: 5,
      status: 'PAID',
      paymentStatus: 'SUCCEEDED',
      totalFcfa: 25000,
      createdAt: new Date()
    }],
    emails: [],
    serial: 0
  };
  let emailFails = false,
    queue = Promise.resolve();
  function match(row, where = {}) {
    return row && Object.entries(where).every(([key, value]) => {
      if (key === 'ticketId_requestId') return match(row, value);
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('equals' in value) return String(row[key]).toLowerCase() === String(value.equals).toLowerCase();
        if ('in' in value) return value.in.includes(row[key]);
      }
      return row[key] === value;
    });
  }
  const event = {
    title: 'Success Day',
    slug: 'success-day',
    startsAt: '2099-10-24T09:00:00Z',
    venueName: 'Abidjan',
    status: 'PUBLISHED',
    ticketTypes: []
  };
  function joinTicket(t) {
    return {
      ...t,
      ticketType: {
        label: 'Standard'
      },
      event,
      order: state.orders.find(o => o.id === t.orderId),
      shareEvents: state.shares.filter(s => s.ticketId === t.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
      _count: {
        shareEvents: state.shares.filter(s => s.ticketId === t.id).length
      }
    };
  }
  function joinOrder(o) {
    return o ? {
      ...o,
      event,
      country: {
        code: o.countryId
      },
      ticketType: {
        label: 'Standard'
      },
      tickets: state.tickets.filter(t => t.orderId === o.id).map(joinTicket),
      _count: {
        tickets: state.tickets.filter(t => t.orderId === o.id).length
      }
    } : null;
  }
  const db = {
    $queryRaw: async () => [],
    ticketPortalOtpChallenge: {
      deleteMany: async () => ({
        count: 0
      }),
      create: async ({
        data
      }) => {
        state.challenges.push({
          ...data,
          attempts: 0,
          consumedAt: null
        });
        return data;
      },
      updateMany: async ({
        where,
        data
      }) => {
        const rows = state.challenges.filter(r => match(r, where));
        rows.forEach(r => Object.assign(r, data));
        return {
          count: rows.length
        };
      },
      findUnique: async ({
        where
      }) => state.challenges.find(r => match(r, where)) || null,
      update: async ({
        where,
        data
      }) => {
        const row = state.challenges.find(r => match(r, where));
        if (data.attempts) row.attempts += data.attempts.increment;else Object.assign(row, data);
        return row;
      }
    },
    ticketOrder: {
      findFirst: async ({
        where
      }) => joinOrder(state.orders.find(o => match(o, where))),
      findMany: async ({
        where,
        skip = 0,
        take = 20
      }) => state.orders.filter(o => match(o, where)).slice(skip, skip + take).map(joinOrder),
      count: async ({
        where
      }) => state.orders.filter(o => match(o, where)).length,
      update: async ({
        where,
        data
      }) => {
        const row = state.orders.find(o => match(o, where));
        Object.assign(row, data);
        return joinOrder(row);
      }
    },
    ticket: {
      findUnique: async ({
        where
      }) => state.tickets.find(t => match(t, where)) || null,
      findFirst: async ({
        where
      }) => {
        const row = state.tickets.find(t => match(t, where));
        return row ? joinTicket(row) : null;
      },
      update: async ({
        where,
        data
      }) => {
        const row = state.tickets.find(t => match(t, where));
        Object.assign(row, data);
        return row;
      }
    },
    ticketShareEvent: {
      count: async ({
        where
      }) => state.shares.filter(s => match(s, where)).length,
      findUnique: async ({
        where
      }) => state.shares.find(s => match(s, where)) || null,
      findFirst: async ({
        where
      }) => state.shares.filter(s => match(s, where)).sort((a, b) => b.createdAt - a.createdAt)[0] || null,
      create: async ({
        data
      }) => {
        const row = {
          ...data,
          id: 'share' + ++state.serial,
          createdAt: new Date(Date.now() + state.serial)
        };
        state.shares.push(row);
        return row;
      }
    }
  };
  db.$transaction = fn => {
    const result = queue.then(async () => {
      const original = structuredClone(state);
      try {
        return await fn(db);
      } catch (error) {
        state = original;
        throw error;
      }
    });
    queue = result.catch(() => {});
    return result;
  };
  const modules = new Map();
  function load(relative) {
    const filename = path.resolve(__dirname, 'src', relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = {
      exports: {}
    };
    modules.set(filename, module);
    const normalRequire = createRequire(filename);
    function requireFake(id) {
      if (id === '../prisma' || id.endsWith('/prisma')) return db;
      if (id.endsWith('/email.service') || id === './email.service') return {
        normalizeEmail: value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : '',
        sendEmail: async input => {
          state.emails.push(input);
          return {
            accepted: !emailFails,
            errorCode: emailFails ? 'TEST_MAIL_FAILED' : null
          };
        }
      };
      if (id.includes('email-templates/layout')) return {
        renderLayout: ({
          bodyHtml
        }) => bodyHtml,
        renderHighlightBox: ({
          value
        }) => `<b>${value}</b>`
      };
      if (id.endsWith('/ticket-wave-payment.service')) return {};
      if (id.endsWith('/ticket-email-notifications.service')) return {};
      if (id.startsWith('.')) return load(path.relative(path.resolve(__dirname, 'src'), path.resolve(path.dirname(filename), id + '.js')));
      return normalRequire(id);
    }
    vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, {
      process,
      console,
      Buffer,
      URL,
      URLSearchParams,
      Date,
      Object,
      Set,
      Map
    }, {
      filename
    })(requireFake, module, module.exports);
    return module.exports;
  }
  const portal = load('controllers/ticketPortal.controller.js'),
    distribution = load('controllers/ticketDistribution.controller.js'),
    sessions = load('services/ticket-portal-session.service.js'),
    sign = load('services/ticket-order-ticketing.service.js');
  const request = (body = {}, patch = {}) => ({
    countryId: 'CIV',
    country: {
      code: 'CIV'
    },
    headers: {
      'x-country': 'CIV'
    },
    query: {
      token: sign.signTicketOrderAccessToken('EVT-TEST-001')
    },
    params: {
      orderNumber: 'EVT-TEST-001',
      ticketId: 'ticket0'
    },
    body,
    ...patch
  });
  async function call(handler, body = {}, patch = {}) {
    const res = response();
    await handler(request(body, patch), res);
    return res;
  }
  async function otp(email = 'owner@example.test') {
    const requested = await call(portal.requestOtp, {
      email
    });
    assert.equal(requested.code, 200);
    const code = state.emails.at(-1).body.match(/\b\d{6}\b/)[0];
    return {
      email,
      code,
      challengeId: requested.body.challengeId
    };
  }
  return {
    portal,
    distribution,
    sessions,
    sign,
    request,
    call,
    otp,
    get state() {
      return state;
    },
    failEmail() {
      emailFails = true;
    }
  };
}
test('email OTP works without an FBO, stores only a hash and creates an HttpOnly country-scoped session', async () => {
  const f = fixture(),
    input = await f.otp('OWNER@EXAMPLE.TEST');
  assert.notEqual(f.state.challenges[0].codeHash, input.code);
  const verified = await f.call(f.portal.verifyOtp, input);
  assert.equal(verified.code, 200);
  assert.equal(verified.body.email, 'owner@example.test');
  assert.equal(verified.cookieResult.options.httpOnly, true);
  assert.equal(verified.cookieResult.options.sameSite, 'lax');
  assert.equal(verified.cookieResult.options.path, '/api/ticketing');
  assert.equal(verified.body.token, undefined);
  assert.equal(f.sessions.readSession(f.request({}, {
    headers: {
      cookie: 'tpt=' + verified.cookieResult.value
    }
  })).email, 'owner@example.test');
});
test('OTP attempts, expiration, replacement and replay are enforced', async () => {
  const f = fixture(),
    input = await f.otp();
  for (let i = 0; i < 5; i++) assert.equal((await f.call(f.portal.verifyOtp, {
    ...input,
    code: input.code === '111111' ? '222222' : '111111'
  })).code, 400);
  assert.equal(f.state.challenges[0].attempts, 5);
  assert.equal((await f.call(f.portal.verifyOtp, input)).code, 400);
  const next = await f.otp();
  assert.ok(f.state.challenges[0].consumedAt);
  f.state.challenges.at(-1).expiresAt = new Date(0);
  assert.equal((await f.call(f.portal.verifyOtp, next)).code, 400);
  const fresh = await f.otp();
  const results = await Promise.all([f.call(f.portal.verifyOtp, fresh), f.call(f.portal.verifyOtp, fresh)]);
  assert.deepEqual(results.map(r => r.code).sort(), [200, 400]);
});
test('failed mail delivery does not report success or leave a usable challenge', async () => {
  const f = fixture();
  f.failEmail();
  const res = await f.call(f.portal.requestOtp, {
    email: 'owner@example.test'
  });
  assert.equal(res.code, 503);
  assert.ok(f.state.challenges[0].consumedAt);
  assert.equal(res.body.challengeId, undefined);
});
test('sessions reject tampering, another country and another token purpose', async () => {
  const f = fixture(),
    token = f.sessions.signSession('owner@example.test', 'CIV');
  assert.equal(f.sessions.readSession(f.request({}, {
    headers: {
      cookie: 'tpt=' + token
    },
    countryId: 'BFA'
  })), null);
  assert.equal(f.sessions.readSession(f.request({}, {
    headers: {
      cookie: 'tpt=' + token + 'bad'
    }
  })), null);
  assert.equal(f.sessions.readSession(f.request({}, {
    headers: {
      cookie: 'tpt=%ZZ'
    }
  })), null);
  const jwt = require('jsonwebtoken');
  const customer = jwt.sign({
    type: 'customer',
    email: 'owner@example.test',
    countryId: 'CIV'
  }, process.env.CUSTOMER_JWT_SECRET, {
    audience: 'ticket-portal'
  });
  assert.equal(f.sessions.readSession(f.request({}, {
    headers: {
      cookie: 'tpt=' + customer
    }
  })), null);
});
test('Mes tickets lists only buyer-email purchases in the verified country, never a guest email or phone match', async () => {
  const f = fixture();
  f.state.orders.push({
    ...f.state.orders[0],
    id: 'other',
    orderNumber: 'EVT-OTHER',
    buyerEmail: 'another@example.test',
    holderEmail: 'owner@example.test'
  });
  f.state.orders.push({
    ...f.state.orders[0],
    id: 'foreign',
    orderNumber: 'EVT-FOREIGN',
    countryId: 'BFA'
  });
  const r = await f.call(f.portal.listOrders, {}, {
    ticketPortal: {
      email: 'OWNER@EXAMPLE.TEST',
      countryId: 'CIV'
    },
    query: {
      page: '1'
    }
  });
  assert.equal(r.body.data.length, 1);
  assert.equal(r.body.data[0].orderNumber, 'EVT-TEST-001');
  assert.equal(r.body.data[0].buyerPhone, undefined);
});
test('guest attribution is isolated to one ticket, detects stale edits and preserves the QR', async () => {
  const f = fixture();
  const r = await f.call(f.distribution.assignGuest, {
    guestName: 'Marie Kouamé',
    expectedGuestName: ''
  });
  assert.equal(r.code, 200);
  assert.equal(f.state.tickets[0].assignedGuestName, 'Marie Kouamé');
  assert.equal(f.state.tickets[1].assignedGuestName, null);
  assert.equal(f.state.tickets[0].qrToken, 'private-qr-0');
  assert.equal((await f.call(f.distribution.assignGuest, {
    guestName: 'Autre invité',
    expectedGuestName: ''
  })).code, 409);
});
test('a confirmed share is idempotent; a second share requires the current snapshot and explicit acknowledgement', async () => {
  const f = fixture();
  await f.call(f.distribution.assignGuest, {
    guestName: 'Marie',
    expectedGuestName: ''
  });
  const body = {
    requestId: 'share_request_0001',
    channel: 'WHATSAPP',
    tickets: [{
      ticketId: 'ticket0',
      expectedLastShareId: null
    }]
  };
  const first = await f.call(f.distribution.recordShare, body);
  assert.equal(first.code, 200);
  assert.equal(first.body.tickets[0].shareCount, 1);
  assert.equal((await f.call(f.distribution.recordShare, body)).code, 200);
  assert.equal(f.state.shares.length, 1);
  assert.equal(f.state.shares[0].guestName, 'Marie');
  assert.equal((await f.call(f.distribution.recordShare, {
    ...body,
    requestId: 'share_request_0002',
    acknowledgeRepeat: true
  })).code, 409);
  const repeat = {
    ...body,
    requestId: 'share_request_0002',
    tickets: [{
      ticketId: 'ticket0',
      expectedLastShareId: f.state.shares[0].id
    }]
  };
  assert.equal((await f.call(f.distribution.recordShare, repeat)).code, 409);
  assert.equal((await f.call(f.distribution.recordShare, {
    ...repeat,
    acknowledgeRepeat: true
  })).code, 200);
  assert.equal(f.state.shares.length, 2);
});
test('changing an already shared attribution warns and preserves its historical guest', async () => {
  const f = fixture();
  await f.call(f.distribution.assignGuest, {
    guestName: 'Marie',
    expectedGuestName: ''
  });
  await f.call(f.distribution.recordShare, {
    requestId: 'share_request_0001',
    channel: 'EMAIL',
    tickets: [{
      ticketId: 'ticket0',
      expectedLastShareId: null
    }]
  });
  assert.equal((await f.call(f.distribution.assignGuest, {
    guestName: 'Paul',
    expectedGuestName: 'Marie'
  })).code, 409);
  assert.equal((await f.call(f.distribution.assignGuest, {
    guestName: 'Paul',
    expectedGuestName: 'Marie',
    acknowledgePreviousShares: true
  })).code, 200);
  assert.equal(f.state.shares[0].guestName, 'Marie');
  assert.equal(f.state.tickets[0].qrToken, 'private-qr-0');
});
test('used, unpaid, refunded and foreign tickets cannot be assigned or shared; a failed batch rolls back', async () => {
  const f = fixture(),
    body = {
      requestId: 'share_request_0001',
      channel: 'EMAIL',
      tickets: [{
        ticketId: 'ticket0',
        expectedLastShareId: null
      }, {
        ticketId: 'zzforeign',
        expectedLastShareId: null
      }]
    };
  assert.equal((await f.call(f.distribution.recordShare, body)).code, 404);
  assert.equal(f.state.shares.length, 0);
  f.state.tickets[0].status = 'USED';
  assert.equal((await f.call(f.distribution.assignGuest, {
    guestName: 'Marie',
    expectedGuestName: ''
  })).code, 409);
  f.state.tickets[0].status = 'ACTIVE';
  f.state.orders[0].paymentStatus = 'REFUNDED';
  assert.equal((await f.call(f.distribution.getShareLink)).code, 409);
  assert.equal((await f.call(f.distribution.getShareLink, {}, {
    countryId: 'BFA'
  })).code, 404);
  assert.equal((await f.call(f.distribution.getShareLink, {}, {
    query: {
      token: 'invalid'
    }
  })).code, 404);
});
test('guest links reveal exactly one ticket, no buyer contacts, other tickets, order access or share history', async () => {
  const f = fixture();
  await f.call(f.distribution.assignGuest, {
    guestName: 'Marie',
    expectedGuestName: ''
  });
  const link = await f.call(f.distribution.getShareLink);
  assert.equal(link.code, 200);
  const url = new URL(link.body.url),
    token = url.searchParams.get('token');
  assert.equal(f.sign.verifyTicketOrderAccessToken('EVT-TEST-001', token), false);
  const guest = await f.call(f.distribution.getSharedTicket, {}, {
    params: {
      ticketId: 'ticket0'
    },
    query: {
      token
    }
  });
  assert.equal(guest.code, 200);
  assert.equal(guest.body.ticket.holderFullName, 'Marie');
  assert.equal(guest.body.ticket.qrToken, 'private-qr-0');
  for (const secret of ['owner@example.test', '0700000000', 'Acheteur privé', 'private-qr-1', 'EVT-TEST-001']) assert.equal(JSON.stringify(guest.body).includes(secret), false);
  assert.equal(guest.body.accessToken, undefined);
  assert.equal(guest.body.ticket.shareHistory, undefined);
  assert.equal((await f.call(f.distribution.getSharedTicket, {}, {
    params: {
      ticketId: 'ticket1'
    },
    query: {
      token
    }
  })).code, 404);
  f.state.tickets[0].status = 'USED';
  const used = await f.call(f.distribution.getSharedTicket, {}, {
    params: {
      ticketId: 'ticket0'
    },
    query: {
      token
    }
  });
  assert.equal(used.code, 200);
  assert.equal(used.body.ticket.qrToken, undefined);
  f.state.orders[0].status = 'CANCELLED';
  assert.equal((await f.call(f.distribution.getSharedTicket, {}, {
    params: {
      ticketId: 'ticket0'
    },
    query: {
      token
    }
  })).code, 404);
});
test('concurrent share records using the same snapshot cannot silently record two distributions', async () => {
  const f = fixture();
  const body = {channel:'WHATSAPP',tickets:[{ticketId:'ticket0',expectedLastShareId:null}]};
  const responses = await Promise.all([
    f.call(f.distribution.recordShare,{...body,requestId:'parallel_request_0001'}),
    f.call(f.distribution.recordShare,{...body,requestId:'parallel_request_0002'}),
  ]);
  assert.deepEqual(responses.map(res=>res.code).sort(),[200,409]);
  assert.equal(f.state.shares.length,1);
});
test('portal middleware requires authentication and JSON mutations; production cookies are Secure', () => {
  const f = fixture(), unauthenticated = response(), form = response();
  f.sessions.requireSession(f.request({}, {headers:{}}), unauthenticated, ()=>assert.fail('Unexpected authenticated request'));
  assert.equal(unauthenticated.code,401);
  f.sessions.requireJson({is:()=>false},form,()=>assert.fail('Unexpected form submission'));
  assert.equal(form.code,415);
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try { assert.equal(f.sessions.cookieOptions().secure,true); }
  finally { if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous; }
});
