import { NextRequest, NextResponse } from "next/server";

type CatalogProduct = {
  id: string;
  name: string;
  domain_id?: string;
};

type ProductDetail = CatalogProduct & {
  permalink?: string;
  pictures?: Array<{ url?: string; secure_url?: string }>;
  buy_box_winner?: CatalogOffer | null;
};

type CatalogOffer = {
  item_id: string;
  price: number;
  condition?: string;
  seller_id?: number;
  official_store_id?: number | null;
  shipping?: { free_shipping?: boolean; cost?: number };
};

type Seller = { nickname?: string };
type OfficialStore = { name?: string };
type DomainPrediction = { domain_id?: string };
type SoloTodoProduct = {
  id: number;
  name: string;
  slug: string;
  category_id: number;
  picture_url?: string;
};
type SoloTodoBrowse = {
  results?: Array<{ product_entries?: Array<{ product: SoloTodoProduct }> }>;
};
type SoloTodoEntity = {
  id: number;
  name: string;
  store_id: number;
  external_url: string;
  condition?: string;
  is_visible?: boolean;
  picture_urls?: string[];
  best_coupon?: {
    code?: string;
    amount?: string;
    amount_type?: number;
    max_discount_amount?: string | null;
    price_type?: string;
  } | null;
  active_registry?: {
    is_available?: boolean;
    normal_price?: string;
    offer_price?: string;
  };
};
type SoloTodoAvailable = {
  results?: Array<{ product: SoloTodoProduct; entities?: SoloTodoEntity[] }>;
};
type SoloTodoStore = { id: number; name: string };

let cachedToken: { value: string; expiresAt: number } | null = null;
let cachedStores: { value: Map<number, string>; expiresAt: number } | null = null;

const normalize = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function soloTodo<T>(path: string): Promise<T> {
  const response = await fetch(`https://publicapi.solotodo.com${path}`, {
    headers: { accept: "application/json", "user-agent": "ComparaYa/1.0" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`SoloTodo respondió ${response.status}`);
  return response.json() as Promise<T>;
}

async function soloTodoStores() {
  if (cachedStores && cachedStores.expiresAt > Date.now()) return cachedStores.value;
  const stores = await soloTodo<SoloTodoStore[]>("/stores/");
  const value = new Map(stores.map((store) => [store.id, store.name]));
  cachedStores = { value, expiresAt: Date.now() + 60 * 60 * 1000 };
  return value;
}

function relevantSoloTodoProducts(products: SoloTodoProduct[], query: string) {
  const value = normalize(query);
  const consoleIntent = /\b(ps5|playstation\s*5|xbox|nintendo\s+switch)\b/.test(value);
  if (consoleIntent) {
    return products.filter((product) => {
      const name = normalize(product.name);
      if (product.category_id !== 33) return false;
      if (/\b(ps5|playstation\s*5)\b/.test(value)) return /\b(ps5|playstation\s*5)\b/.test(name);
      if (/\bxbox\b/.test(value)) return /\bxbox\b/.test(name);
      return /nintendo\s+switch|\bswitch\b/.test(name);
    });
  }
  const tokens = value.split(/\s+/).filter((token) => token.length > 2);
  const matched = products.filter((product) => {
    const name = normalize(product.name);
    return tokens.some((token) => name.includes(token));
  });
  return matched.length ? matched : products;
}

async function searchSoloTodo(query: string) {
  const params = new URLSearchParams({
    search: query,
    ordering: "relevance",
    page_size: "30",
    exclude_refurbished: "true",
  });
  const browse = await soloTodo<SoloTodoBrowse>(`/products/browse/?${params}`);
  const products = relevantSoloTodoProducts(
    (browse.results || []).flatMap((bucket) =>
      (bucket.product_entries || []).map((entry) => entry.product),
    ),
    query,
  ).slice(0, 8);
  if (!products.length) return [];

  const offerParams = new URLSearchParams({ exclude_with_monthly_payment: "1" });
  products.forEach((product) => offerParams.append("ids", String(product.id)));
  const [available, stores] = await Promise.all([
    soloTodo<SoloTodoAvailable>(`/products/available_entities/?${offerParams}`),
    soloTodoStores(),
  ]);

  return (available.results || []).flatMap(({ product, entities }) =>
    (entities || [])
      .filter((entity) =>
        entity.is_visible !== false &&
        entity.active_registry?.is_available &&
        entity.condition === "https://schema.org/NewCondition" &&
        Number(entity.active_registry.offer_price) > 0 &&
        /^https:\/\//.test(entity.external_url),
      )
      .map((entity) => ({
        id: `st-${entity.id}`,
        store: stores.get(entity.store_id) || `Tienda ${entity.store_id}`,
        marketplace: "SoloTodo",
        title: product.name,
        price: Math.round(Number(entity.active_registry?.offer_price)),
        shipping: null,
        url: entity.external_url,
        image: entity.picture_urls?.[0] || product.picture_url || "",
        condition: "new",
        stock: null,
      })),
  );
}

async function mercadoLibre<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.mercadolibre.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mercado Libre respondió ${response.status}`);
  return response.json() as Promise<T>;
}

async function getToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const clientId = process.env.MERCADOLIBRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIBRE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("La fuente oficial aún no está configurada");

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Mercado Libre rechazó la autenticación (${response.status})`);

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Mercado Libre no entregó una credencial temporal");
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 10_800) * 1000,
  };
  return cachedToken.value;
}

function expectedDomain(query: string) {
  const value = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\b(ps5|playstation\s*5|xbox|nintendo\s+switch)\b/.test(value)) return "MLC-GAME_CONSOLES";
  if (/\b(iphone|smartphone|celular|galaxy\s+s\d+)\b/.test(value)) return "MLC-CELLPHONES";
  if (/\b(notebook|laptop)\b/.test(value)) return "MLC-NOTEBOOKS";
  if (/\b(air\s*fryer|freidora\s+de\s+aire)\b/.test(value)) return "MLC-AIR_FRYERS";
  return null;
}

async function discoverDomain(query: string, token: string) {
  const known = expectedDomain(query);
  if (known) return known;
  try {
    const predictions = await mercadoLibre<DomainPrediction[]>(
      `/sites/MLC/domain_discovery/search?limit=1&q=${encodeURIComponent(query)}`,
      token,
    );
    return predictions[0]?.domain_id || null;
  } catch {
    return null;
  }
}

async function sellerName(offer: CatalogOffer, token: string) {
  if (offer.official_store_id) {
    try {
      const store = await mercadoLibre<OfficialStore>(`/official_stores/${offer.official_store_id}`, token);
      if (store.name) return store.name;
    } catch {}
  }
  if (offer.seller_id) {
    try {
      const seller = await mercadoLibre<Seller>(`/users/${offer.seller_id}`, token);
      if (seller.nickname) return seller.nickname;
    } catch {}
  }
  return "Vendedor de Mercado Libre";
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim();
  if (!query || query.length < 2) {
    return NextResponse.json({ error: "Escribe al menos dos caracteres" }, { status: 400 });
  }

  try {
    try {
      const multiStoreOffers = (await searchSoloTodo(query))
        .filter((offer, index, all) =>
          all.findIndex((candidate) => candidate.url === offer.url) === index,
        )
        .sort((a, b) => a.price - b.price)
        .slice(0, 40);
      if (multiStoreOffers.length) {
        const stores = [...new Set(multiStoreOffers.map((offer) => offer.store))];
        return NextResponse.json({
          offers: multiStoreOffers,
          sources: stores,
          source: "Tiendas chilenas vía SoloTodo",
          fetchedAt: new Date().toISOString(),
          matchedDomain: "multitienda",
        });
      }
    } catch {}

    const token = await getToken();
    const targetDomain = await discoverDomain(query, token);
    const params = new URLSearchParams({
      site_id: "MLC",
      q: query,
      status: "active",
      limit: "50",
    });
    if (targetDomain) params.set("domain_id", targetDomain);

    const catalog = await mercadoLibre<{ results?: CatalogProduct[] }>(
      `/products/search?${params}`,
      token,
    );
    const products = (catalog.results || [])
      .filter((product) => !targetDomain || product.domain_id === targetDomain)
      .slice(0, 18);

    const batches = await Promise.allSettled(
      products.map(async (product) => {
        const detail = await mercadoLibre<ProductDetail>(`/products/${product.id}`, token);
        let raw = detail.buy_box_winner;
        if (!raw?.item_id) {
          try {
            const listed = await mercadoLibre<{ results?: CatalogOffer[] }>(
              `/products/${product.id}/items`,
              token,
            );
            raw = listed.results?.find((offer) => offer.item_id && Number.isFinite(offer.price)) || null;
          } catch {
            raw = null;
          }
        }
        if (!raw?.item_id || !Number.isFinite(raw.price)) return [];
        return [{
          id: raw.item_id,
          rawSeller: raw,
          marketplace: "Mercado Libre Chile",
          title: detail.name || product.name,
          price: Math.round(raw.price),
          shipping: raw.shipping?.free_shipping
            ? 0
            : typeof raw.shipping?.cost === "number"
              ? raw.shipping.cost
              : null,
          url: detail.permalink || `https://www.mercadolibre.cl/p/${product.id}`,
          image: detail.pictures?.[0]?.secure_url || detail.pictures?.[0]?.url || "",
          condition: raw.condition || "new",
          stock: null,
        }];
      }),
    );

    const candidates = batches
      .flatMap((batch) => (batch.status === "fulfilled" ? batch.value : []))
      .filter((offer, index, all) => all.findIndex((candidate) => candidate.id === offer.id) === index)
      .sort((a, b) => a.price - b.price)
      .slice(0, 7);
    const offers = await Promise.all(candidates.map(async ({ rawSeller, ...offer }) => ({
      ...offer,
      store: await sellerName(rawSeller, token),
    })));
    const stores = [...new Set(offers.map((offer) => offer.store))];

    return NextResponse.json({
      offers,
      sources: stores,
      source: "Mercado Libre Chile",
      fetchedAt: new Date().toISOString(),
      matchedDomain: targetDomain,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falló la consulta a Mercado Libre" },
      { status: 502 },
    );
  }
}
