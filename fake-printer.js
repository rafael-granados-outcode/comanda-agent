// Impresora falsa para pruebas: escucha en el puerto 9100 como una térmica de red,
// interpreta los comandos ESC/POS y muestra el ticket en consola. Guarda cada ticket en ./tickets
// Uso: node fake-printer.js   (y en .env: PRINTER_HOST=127.0.0.1)
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.FAKE_PRINTER_PORT || 9100);
const WIDTH = 42;
const OUT_DIR = path.resolve('tickets');
fs.mkdirSync(OUT_DIR, { recursive: true });

const BOLD = '\x1b[1m', RESET = '\x1b[0m', YELLOW = '\x1b[33m';

// Convierte el buffer ESC/POS en líneas de texto { text, align, bold, big }
function decode(buf) {
  const tickets = [[]];
  let cur = '', align = 0, bold = false, big = false, lineBold = false, lineBig = false;
  const flush = () => {
    tickets.at(-1).push({ text: cur, align, bold: lineBold, big: lineBig });
    cur = ''; lineBold = lineBig = false;
  };

  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x1b) {                       // ESC
      const c = String.fromCharCode(buf[++i]);
      if (c === '@') { align = 0; bold = big = false; }
      else if (c === 'E') { bold = !!buf[++i]; }
      else if (c === 'a') { align = buf[++i] % 48; }
      else if (c === '!') { const n = buf[++i]; bold = !!(n & 0x08); big = !!(n & 0x30); }
      else if (c === 'd') { i++; flush(); } // avanzar n líneas
      else i++;                              // comando desconocido con 1 argumento
    } else if (b === 0x1d) {                // GS
      const c = String.fromCharCode(buf[++i]);
      if (c === '!') { big = buf[++i] !== 0; }
      else if (c === 'V') {                 // corte de papel
        const m = buf[++i];
        if (m === 0x41 || m === 0x42) i++;
        if (cur) flush();
        tickets.push([]);
      } else i++;
    } else if (b === 0x0a) {
      flush();
    } else if (b >= 0x20) {
      cur += String.fromCharCode(b);
      lineBold ||= bold; lineBig ||= big;
    }
  }
  if (cur) flush();
  for (const t of tickets) while (t.length && !t.at(-1).text.trim()) t.pop();
  return tickets.filter((t) => t.length);
}

function render(lines, color) {
  const pad = (l) => {
    const t = l.text.slice(0, WIDTH);
    const space = WIDTH - t.length;
    if (l.align === 1) return ' '.repeat(Math.floor(space / 2)) + t + ' '.repeat(Math.ceil(space / 2));
    if (l.align === 2) return ' '.repeat(space) + t;
    return t + ' '.repeat(space);
  };
  const top = '┌' + '─'.repeat(WIDTH + 2) + '┐';
  const bottom = '└' + '─'.repeat(WIDTH + 2) + '┘  ✂';
  const body = lines.map((l) => {
    const txt = pad(l);
    const styled = color && (l.bold || l.big) ? BOLD + (l.big ? YELLOW : '') + txt + RESET : txt;
    return `│ ${styled} │`;
  });
  return [top, ...body, bottom].join('\n');
}

let count = 0;
net.createServer((sock) => {
  const chunks = [], from = sock.remoteAddress;
  sock.on('data', (d) => chunks.push(d));
  sock.on('error', () => {});
  sock.on('close', () => {
    const buf = Buffer.concat(chunks);
    if (!buf.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(OUT_DIR, `${stamp}.bin`), buf);
    const tickets = decode(buf);
    fs.writeFileSync(path.join(OUT_DIR, `${stamp}.txt`), tickets.map((t) => render(t, false)).join('\n\n') + '\n');
    for (const t of tickets) {
      console.log(`\n#${++count}  ${new Date().toLocaleTimeString('es-CO')}  desde ${from}  (${buf.length} bytes)`);
      console.log(render(t, true));
    }
  });
}).on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`El puerto ${PORT} ya está en uso: probablemente ya hay otra impresora falsa abierta en otra terminal.`);
  process.exit(1);
}).listen(PORT, () => console.log(`Impresora falsa escuchando en el puerto ${PORT}. Tickets en ${OUT_DIR}`));
