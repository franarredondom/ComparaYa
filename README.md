# ComparaYa

Comparador de precios para Chile. Busca productos en comercios nacionales,
normaliza las ofertas disponibles y ordena los resultados por precio.

## Funciones

- Búsqueda de productos por nombre o modelo.
- Comparación de ofertas activas en múltiples tiendas chilenas.
- Enlaces directos a cada comercio.
- Precios expresados en pesos chilenos.
- Mercado Libre Chile como fuente de respaldo.

## Requisitos

- Node.js 22.13 o superior.
- Credenciales de Mercado Libre para habilitar la fuente de respaldo.

## Configuración

Crea un archivo `.env.local`:

```env
MERCADOLIBRE_CLIENT_ID=tu_client_id
MERCADOLIBRE_CLIENT_SECRET=tu_client_secret
```

## Desarrollo

```bash
npm install
npm run dev
```

La aplicación estará disponible en `http://localhost:3000`.

## Compilación

```bash
npm run build
npm start
```

## Tecnologías

- Next.js
- React
- TypeScript
- Vite y vinext
- Cloudflare Workers
