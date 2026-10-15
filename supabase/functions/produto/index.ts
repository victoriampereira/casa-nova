// Casa Nova: função "produto".
// Recebe { url } com o link de um produto e devolve { title, brand, price, image }
// lendo os dados públicos da página da loja (JSON-LD e metatags og/product).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function decode(s: string) {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

function meta(html: string, key: string): string | undefined {
  const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i");
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${key}["']`, "i");
  const m = html.match(re1) || html.match(re2);
  return m ? decode(m[1]) : undefined;
}

function toPrice(v: unknown): number | undefined {
  if (typeof v === "number" && isFinite(v) && v > 0) return v;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[^\d,.]/g, "");
  if (!s) return undefined;
  if (s.includes(",") && s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : undefined;
}

function findProduct(node: any): any {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n); if (p) return p; } return undefined; }
  const t = node["@type"];
  if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return node;
  for (const k of ["@graph", "mainEntity", "itemListElement", "item"]) { const p = findProduct(node[k]); if (p) return p; }
  return undefined;
}

function offerPrice(offers: any): number | undefined {
  if (!offers) return undefined;
  const list = Array.isArray(offers) ? offers : [offers];
  const prices: number[] = [];
  for (const o of list) {
    for (const v of [o?.price, o?.lowPrice, o?.priceSpecification?.price]) { const p = toPrice(v); if (p) prices.push(p); }
    if (o?.offers) { const p = offerPrice(o.offers); if (p) prices.push(p); }
  }
  return prices.length ? Math.min(...prices) : undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  // Só aceita quem está logado no app.
  const auth = req.headers.get("Authorization") || "";
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  }).catch(() => null);
  if (!who || !who.ok) return json({ error: "faça login no app" }, 401);
  try {
    const { url } = await req.json();
    let target: URL;
    try { target = new URL(String(url)); } catch { return json({ error: "link inválido" }); }
    if (!/^https?:$/.test(target.protocol)) return json({ error: "link inválido" });
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(target.hostname)) return json({ error: "link inválido" });

    const res = await fetch(target.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return json({ error: `a loja respondeu ${res.status}` });
    const html = (await res.text()).slice(0, 3_000_000);

    let title: string | undefined, brand: string | undefined, price: number | undefined, image: string | undefined;

    for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const p = findProduct(JSON.parse(m[1].trim()));
        if (!p) continue;
        title ??= typeof p.name === "string" ? decode(p.name) : undefined;
        brand ??= typeof p.brand === "string" ? p.brand : p.brand?.name;
        price ??= offerPrice(p.offers);
        const img = Array.isArray(p.image) ? p.image[0] : p.image;
        image ??= typeof img === "string" ? img : img?.url;
        if (title && price && image) break;
      } catch { /* JSON-LD inválido: ignora */ }
    }

    title ??= meta(html, "og:title");
    image ??= meta(html, "og:image") || meta(html, "og:image:secure_url") || meta(html, "twitter:image");
    price ??= toPrice(meta(html, "product:price:amount") || meta(html, "og:price:amount") || meta(html, "price"));
    brand ??= meta(html, "product:brand") || meta(html, "og:brand");

    if (image) { try { image = new URL(image, target).toString(); } catch { image = undefined; } }
    if (title) title = title.replace(/\s*[|\-–]\s*(Magazine Luiza|Magalu|Mercado Livre|Casas Bahia|Shopee|Amazon\.com\.br).*$/i, "").trim();

    if (!title && !price && !image) return json({ error: "a página não mostrou os dados do produto" });
    return json({ title, brand: brand ? decode(String(brand)) : undefined, price, image });
  } catch (e) {
    return json({ error: "não foi possível ler a página", detail: String(e) });
  }
});
