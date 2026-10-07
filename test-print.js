// Prueba de conexión con las impresoras configuradas (red y/o USB): node test-print.js
import 'dotenv/config';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const { PRINTER_HOST, PRINTER_PORT = '9100', PRINTER_USB } = process.env;
const ticket = (donde) => Buffer.from(`\x1b@\x1ba\x01\x1b!\x30PRUEBA OK\n\x1b!\x00Agente de comandas\n${donde}\n\n\n\x1dV\x42\x00`, 'latin1');

if (!PRINTER_HOST && !PRINTER_USB) console.error('No hay impresoras configuradas: define PRINTER_HOST y/o PRINTER_USB en .env');

if (PRINTER_HOST) {
  const s = net.createConnection({ host: PRINTER_HOST, port: Number(PRINTER_PORT) }, () =>
    s.end(ticket('Cocina (red)'), () => console.log('Cocina: enviado a', `${PRINTER_HOST}:${PRINTER_PORT}`)));
  s.setTimeout(8000, () => { s.destroy(); console.error('Cocina: timeout'); });
  s.on('error', (e) => console.error('Cocina: error', e.message));
}

if (PRINTER_USB) {
  const file = path.join(os.tmpdir(), `comanda-prueba-${process.pid}.bin`);
  fs.writeFileSync(file, ticket('Caja (USB)'));
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('./usb-print.ps1', import.meta.url)), '-Printer', PRINTER_USB, '-Path', file],
      { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    console.log('Caja: enviado a USB', `"${PRINTER_USB}"`);
  } catch (e) {
    console.error('Caja: error', String(e.stderr || e.message).trim());
  } finally {
    fs.rmSync(file, { force: true });
  }
}
