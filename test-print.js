// Prueba de conexión con la impresora: node test-print.js
import 'dotenv/config';
import net from 'node:net';

const { PRINTER_HOST, PRINTER_PORT = '9100' } = process.env;
const buf = Buffer.from('\x1b@\x1ba\x01\x1b!\x30PRUEBA OK\n\x1b!\x00Agente de comandas\n\n\n\x1dV\x42\x00', 'latin1');

const s = net.createConnection({ host: PRINTER_HOST, port: Number(PRINTER_PORT) }, () =>
  s.end(buf, () => console.log('Enviado a', PRINTER_HOST)));
s.on('error', (e) => console.error('Error:', e.message));
