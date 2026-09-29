// Agente de comandas: Shopify -> impresora térmica de caja/cocina (ESC/POS por red, puerto 9100)
// Corre en el PC de la caja. No necesita servidor público ni webhooks.
import 'dotenv/config';
import net from 'node:net';
import { execFile } from 'node:child_process';
import notifier from 'node-notifier';
import { fileURLToPath } from 'node:url';

const {
  SHOP,                       // mitienda.myshopify.com
  SHOPIFY_CLIENT_ID,          // Dev Dashboard -> App -> Configuración
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_TOKEN,              // opcional: token fijo shpat_ (apps heredadas del admin)
  API_VERSION = '2026-07',
  PRINTER_HOST,               // IP de la impresora térmica, ej. 192.168.1.50
  PRINTER_PORT = '9100',
  POLL_SECONDS = '15',
  PRINTED_TAG = 'comanda-impresa',
  ORDER_FILTER = 'financial_status:paid',
  COPIES = '1',               // 2 = una para caja y otra para cocina
  NOTIFY = 'true',            // notificación de Windows al entrar un pedido
  SOUND_FILE = '',            // opcional: ruta a un .wav para una alerta más fuerte
  SOUND_REPEAT = '2',         // veces que suena el .wav
} = process.env;

const ICON = fileURLToPath(new URL('./logo.png', import.meta.url)); // icono de la notificación

const START = new Date().toISOString(); // solo pedidos creados desde que arranca el agente

// Token por client credentials (apps del Dev Dashboard). Dura 24 h: se cachea y se renueva antes.
let token = SHOPIFY_TOKEN || null;
let tokenExpiresAt = SHOPIFY_TOKEN ? Infinity : 0;

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return token;
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token Shopify ${res.status}: ${await res.text()}`);
  const { access_token, expires_in } = await res.json();
  token = access_token;
  tokenExpiresAt = Date.now() + expires_in * 1000;
  console.log('Token de Shopify renovado');
  return token;
}

async function gql(query, variables = {}) {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 && !SHOPIFY_TOKEN) tokenExpiresAt = 0; // fuerza renovación en el próximo ciclo
  if (!res.ok) throw new Error(`Shopify API ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

const ORDERS_QUERY = `#graphql
query Pending($q: String!) {
  orders(first: 20, query: $q, sortKey: CREATED_AT) {
    nodes {
      id name createdAt note phone
      customer { displayName }
      shippingAddress { address1 address2 city phone }
      shippingLine { title }
      customAttributes { key value }
      totalPriceSet { shopMoney { amount } }
      lineItems(first: 50) {
        nodes { name quantity variantTitle customAttributes { key value } }
      }
    }
  }
}`;

const TAG_MUTATION = `#graphql
mutation Tag($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { message } }
}`;

// ---------- ESC/POS ----------
const ESC = '\x1b', GS = '\x1d';
const CMD = {
  init: ESC + '@',
  bold: (on) => ESC + 'E' + (on ? '\x01' : '\x00'),
  big: (on) => GS + '!' + (on ? '\x11' : '\x00'),
  center: ESC + 'a\x01',
  left: ESC + 'a\x00',
  cut: '\n\n\n' + GS + 'V\x42\x00',
};
// Las térmicas baratas no manejan bien UTF-8: quitamos tildes
const clean = (s = '') => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const line = '-'.repeat(42);

function buildTicket(o) {
  const hora = new Date(o.createdAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
  const addr = o.shippingAddress;
  let t = CMD.init + CMD.center + CMD.big(true) + CMD.bold(true);
  t += `COMANDA WEB\n${o.name}\n`;
  t += CMD.big(false) + CMD.bold(false) + `${hora} - ${o.shippingLine?.title ?? 'Recoger'}\n`;
  t += CMD.left + line + '\n';

  for (const li of o.lineItems.nodes) {
    t += CMD.bold(true) + CMD.big(true) + `${li.quantity} x ` + CMD.big(false) + `${li.name}\n` + CMD.bold(false);
    if (li.variantTitle && !li.name.includes(li.variantTitle)) t += `   ${li.variantTitle}\n`;
    for (const a of li.customAttributes) if (!a.key.startsWith('_')) t += `   > ${a.key}: ${a.value}\n`;
  }

  t += line + '\n';
  if (o.note) t += CMD.bold(true) + 'NOTA: ' + CMD.bold(false) + o.note + '\n' + line + '\n';
  t += `Cliente: ${o.customer?.displayName ?? '-'}\n`;
  t += `Tel: ${o.phone ?? addr?.phone ?? '-'}\n`;
  if (addr) t += `Dir: ${[addr.address1, addr.address2, addr.city].filter(Boolean).join(', ')}\n`;
  for (const a of o.customAttributes) t += `${a.key}: ${a.value}\n`;
  t += CMD.bold(true) + `TOTAL: $${Number(o.totalPriceSet.shopMoney.amount).toLocaleString('es-CO')}\n` + CMD.bold(false);
  t += CMD.cut;
  return Buffer.from(clean(t), 'latin1');
}

function print(buf) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: PRINTER_HOST, port: Number(PRINTER_PORT) }, () => {
      sock.end(buf, resolve);
    });
    sock.setTimeout(8000, () => { sock.destroy(); reject(new Error('Timeout impresora')); });
    sock.on('error', reject);
  });
}

// ---------- Notificación en el PC ----------
const money = (n) => '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 0 });

function playSound() {
  if (!SOUND_FILE || process.platform !== 'win32') return;
  const ps = `$p = New-Object Media.SoundPlayer '${SOUND_FILE.replace(/'/g, "''")}'; ` +
    `1..${Number(SOUND_REPEAT)} | ForEach-Object { $p.PlaySync() }`;
  execFile('powershell', ['-NoProfile', '-Command', ps], (e) => e && console.error('Sonido:', e.message));
}

function notify(o, printError) {
  if (NOTIFY !== 'true') return;
  const items = o.lineItems.nodes.map((li) => `${li.quantity}x ${li.name}`).join(', ');
  notifier.notify({
    title: `Nuevo pedido ${o.name} - ${money(o.totalPriceSet.shopMoney.amount)}`,
    message: (printError ? '⚠ NO SE IMPRIMIÓ: revisa la impresora\n' : '') + items.slice(0, 200),
    sound: !SOUND_FILE,  // si hay .wav propio, se usa ese en lugar del sonido de Windows
    wait: true,          // queda visible hasta que la cierren
    icon: ICON,
  });
  playSound();
}

// ---------- Loop ----------
const notified = new Set(); // evita repetir la alerta si la impresión falla y se reintenta
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const q = `${ORDER_FILTER} -tag:${PRINTED_TAG} -status:cancelled created_at:>='${START}'`;
    const { orders } = await gql(ORDERS_QUERY, { q });
    for (const o of orders.nodes) {
      let printError = null;
      try {
        const ticket = buildTicket(o);
        for (let i = 0; i < Number(COPIES); i++) await print(ticket);
      } catch (e) {
        printError = e;
      }

      if (!notified.has(o.id)) {
        notify(o, printError);
        notified.add(o.id);
      }

      if (printError) {
        console.error(new Date().toLocaleTimeString('es-CO'), o.name, 'Error impresora:', printError.message);
        continue; // sin tag: se reintenta la impresión en el siguiente ciclo
      }

      const { tagsAdd } = await gql(TAG_MUTATION, { id: o.id, tags: [PRINTED_TAG] });
      if (tagsAdd.userErrors.length) console.error(o.name, tagsAdd.userErrors);
      console.log(new Date().toLocaleTimeString('es-CO'), 'Impresa', o.name);
    }
  } catch (e) {
    console.error(new Date().toLocaleTimeString('es-CO'), e.message); // reintenta en el siguiente ciclo
  } finally {
    running = false;
  }
}

console.log(`Agente de comandas activo -> ${PRINTER_HOST}:${PRINTER_PORT} cada ${POLL_SECONDS}s`);
tick();
setInterval(tick, Number(POLL_SECONDS) * 1000);
