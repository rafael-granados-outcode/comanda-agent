# Agente de comandas Shopify

Imprime automáticamente una comanda en la impresora térmica y muestra una notificación en Windows cada vez que entra un pedido en Shopify.

- Consulta Shopify cada 15 s (no requiere servidor, dominio ni webhooks).
- Imprime por red (ESC/POS, puerto 9100).
- Notificación de Windows: `Nuevo pedido #1045 - $58.000` + ítems, con sonido.
- Marca cada pedido con la etiqueta `comanda-impresa` para no imprimirlo dos veces.
- Si la impresora falla, avisa en la notificación y reintenta en el siguiente ciclo.

## Requisitos

- PC con Windows en la caja, encendido y con sesión iniciada.
- Node.js 18 o superior: https://nodejs.org
- Impresora térmica **de red** (Ethernet/WiFi) con IP fija en el router.
- App creada en el **Dev Dashboard** de Shopify con permisos `read_orders` y `write_orders`.

## 1. Crear la app en el Dev Dashboard

1. Dev Dashboard (dev.shopify.com) → **Apps → Crear app**.
2. Nombre: el que quieras. **URL de la app**: puede quedar `https://example.com` (la app no tiene interfaz). No marques *Incrustar app*.
3. **Alcances**: `read_orders,write_orders`.
4. **Crear app** → publica/lanza la versión.
5. **Instalar la app en la tienda** (desde el Dev Dashboard, opción de instalar en tu tienda).
6. En **Configuración** de la app copia el **Client ID** y el **Client secret** al `.env`.

El agente pide el token solo (client credentials grant) y lo renueva cada 24 h.

> La tienda debe pertenecer a la **misma organización** que la app en el Dev Dashboard. Si no, Shopify responde `shop_not_permitted`.

## 2. Instalar

Copia la carpeta a `C:\comanda-agent` y en una terminal (PowerShell):

```powershell
cd C:\comanda-agent
npm install
copy .env.example .env
notepad .env
```

## 3. Configurar `.env`

| Variable | Descripción |
|---|---|
| `SHOP` | Dominio de la tienda: `mitienda.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Client ID de la app (paso 1) |
| `SHOPIFY_CLIENT_SECRET` | Client secret de la app (paso 1) |
| `SHOPIFY_TOKEN` | Opcional. Solo para apps heredadas del admin con token fijo `shpat_` |
| `API_VERSION` | Versión de la API de Admin (ej. `2026-07`) |
| `PRINTER_HOST` | IP de la impresora (ej. `192.168.1.50`) |
| `PRINTER_PORT` | Normalmente `9100` |
| `POLL_SECONDS` | Cada cuántos segundos consulta pedidos |
| `PRINTED_TAG` | Etiqueta que se pone al pedido impreso |
| `ORDER_FILTER` | Qué pedidos imprimir. Contraentrega: `(financial_status:paid OR financial_status:pending)` |
| `COPIES` | Copias por pedido (`2` = caja + cocina) |
| `NOTIFY` | `true` / `false` para la notificación de Windows |
| `SOUND_FILE` | Opcional. Ruta a un `.wav` para una alerta más fuerte |
| `SOUND_REPEAT` | Veces que suena el `.wav` |

## 4. Probar

```powershell
npm run test-print   # debe imprimir "PRUEBA OK"
npm start            # deja el agente corriendo
```

Haz un pedido de prueba en la tienda: debe salir la notificación y la comanda en menos de 15 s.

> Solo procesa pedidos creados **después** de iniciar el agente; no imprime el historial.

## 5. Dejarlo corriendo siempre

```powershell
npm i -g pm2 pm2-windows-startup
pm2 start index.js --name comandas
pm2 save
pm2-startup install
```

Comandos útiles:

```powershell
pm2 logs comandas      # ver actividad y errores
pm2 restart comandas   # reiniciar tras cambiar .env o actualizar archivos
pm2 stop comandas      # detener
```

## Solución de problemas

- **No sale la notificación:** desactiva *No molestar / Asistente de concentración* en Windows. No instales el agente como servicio de Windows: debe correr en la sesión del usuario (así lo hace `pm2-windows-startup`).
- **`shop_not_permitted`:** la tienda no está en la misma organización que la app del Dev Dashboard.
- **Error 401/403 de Shopify:** revisa Client ID/secret, que la app esté instalada y que la versión tenga los alcances `read_orders,write_orders`.
- **No imprime:** verifica con `ping <IP>` y `npm run test-print`. Confirma que la IP no haya cambiado.
- **Caracteres raros:** las tildes y la ñ se quitan a propósito para compatibilidad con impresoras térmicas.
- **Reimprimir un pedido:** quítale la etiqueta `comanda-impresa` en Shopify (solo aplica si se creó después de iniciar el agente).
- **Impresora USB:** esta versión imprime por red. Para USB, cambia la función `print()` por la API de PrintNode.

## Archivos

- `index.js` — agente (consulta, impresión, notificación).
- `test-print.js` — prueba de conexión con la impresora.
- `.env.example` — plantilla de configuración.
- `package.json` — dependencias (`dotenv`, `node-notifier`).
