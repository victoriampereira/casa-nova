// Casa Nova: função "imovel".
// Recebe { url } de um anúncio de aluguel (ZAP, Viva Real, OLX, QuintoAndar, imobiliárias)
// e devolve o que conseguir ler: título, endereço, bairro, aluguel, condomínio, IPTU,
// área, quartos, banheiros, vagas e foto.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const PREVIEW = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";

function decode(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;| /g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();
}
const strip = (s: string) => decode(s.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " "));
function meta(html: string, key: string): string | undefined {
  const a = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)["']`, "i"));
  const b = html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"));
  const m = a || b; return m ? decode(m[1]) : undefined;
}
function money(s?: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/); if (!m) return undefined;
  const n = parseFloat(m[1].replace(/\./g, "").replace(",", ".")); return isFinite(n) && n > 0 ? n : undefined;
}
function byTestId(html: string, id: string): string | undefined {
  const m = html.match(new RegExp(`data-testid=["']${id}["'][^>]*>([\\s\\S]{0,300}?)</(?:p|span|div|h\\d|li)>`, "i"));
  return m ? strip(m[1]) : undefined;
}
function near(text: string, label: RegExp): number | undefined {
  const m = text.match(new RegExp(label.source + "[^R]{0,40}(R\\$\\s*[\\d.]+(?:,\\d{1,2})?)", "i"));
  return m ? money(m[1]) : undefined;
}
function count(text: string, word: string): number | undefined {
  const m = text.match(new RegExp(`(\\d{1,2})\\s*${word}`, "i")); return m ? Number(m[1]) : undefined;
}

async function get(url: string, ua: string) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": ua, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pt-BR,pt;q=0.9" } });
    return r.ok ? (await r.text()).slice(0, 4_000_000) : "";
  } catch { return ""; }
}
// Alguns sites bloqueiam o servidor das funções mas não o do banco: lê por lá.
async function viaDb(url: string, ua: string) {
  try {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/buscar_html`, { method: "POST", signal: AbortSignal.timeout(20000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ url, ua }) });
    if (!r.ok) return "";
    const rows = await r.json(); const row = Array.isArray(rows) ? rows[0] : rows;
    return row && row.status >= 200 && row.status < 300 ? String(row.content || "") : "";
  } catch { return ""; }
}
const blocked = (h: string) => {
  if (!h || h.length < 2000) return true;
  const t = (h.match(/<title>([^<]*)/i) || [])[1] || "";
  return /suspicious-traffic-frontend/.test(h.slice(0, 3000)) || /just a moment|access denied|attention required|captcha/i.test(t);
};

const SITES: Record<string, string> = { zapimoveis: "ZAP Imóveis", vivareal: "Viva Real", olx: "OLX", quintoandar: "QuintoAndar",
  imovelweb: "Imovelweb", chavesnamao: "Chaves na Mão", loft: "Loft", wimoveis: "Wimoveis" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") || "", apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "" },
  }).catch(() => null);
  if (!who || !who.ok) return json({ error: "faça login no app" }, 401);

  let target: URL;
  try { target = new URL(String((await req.json()).url)); } catch { return json({ error: "link inválido" }); }
  if (!/^https?:$/.test(target.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(target.hostname)) return json({ error: "link inválido" });
  target.hash = "";

  let html = await get(target.toString(), CHROME);
  if (blocked(html)) html = await viaDb(target.toString(), CHROME);
  if (blocked(html)) html = await viaDb(target.toString(), PREVIEW);
  if (blocked(html)) html = await get(target.toString(), PREVIEW);
  if (blocked(html)) return json({ error: "o site bloqueou a leitura" });

  const host = target.hostname.replace(/^www\./, "");
  const key = Object.keys(SITES).find((k) => host.includes(k));
  const site = key ? SITES[key] : host.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());

  const body = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  const text = strip(body);
  const h1 = (body.match(/<h1[^>]*>([\s\S]{0,300}?)<\/h1>/i) || [])[1];
  const desc = meta(html, "description") || meta(html, "og:description") || "";

  const title = (h1 && strip(h1)) || meta(html, "og:title") || (html.match(/<title>([^<]+)/i) || [])[1];
  const address = byTestId(html, "location-address") || byTestId(html, "address") || "";
  let neighborhood = "";
  const am = address.match(/-\s*([^,]+),\s*[^,]+-\s*[A-Z]{2}/);
  if (am) neighborhood = am[1].trim();
  else if (title) { const tm = title.match(/[-–]\s*([^-–|]+)$/); if (tm) neighborhood = tm[1].trim(); }

  let rent = money((desc.match(/por\s+R\$\s*[\d.,]+/i) || [])[0]) ?? near(text, /Aluguel/);
  const priceJson = html.match(/"price"\s*:\s*"?(\d{3,6}(?:\.\d+)?)/);
  if (rent === undefined && priceJson) rent = Number(priceJson[1]);
  const condo = money(byTestId(html, "condoFee")) ?? near(text, /Condom[íi]nio/);
  const iptu = money(byTestId(html, "iptu")) ?? near(text, /IPTU/);

  const area = (() => { const m = (title + " " + text).match(/(\d{2,4})\s*m²/); return m ? Number(m[1]) : undefined; })();
  const bedrooms = count(title + " " + text, "quartos?");
  const bathrooms = count(text, "banheiros?");
  const parking = count(text, "vagas?");

  let photo = meta(html, "og:image") || meta(html, "twitter:image");
  if (!photo) {
    const m = html.match(/https:\/\/resizedimgs\.[a-z]+\.com\.br\/[^"'\s]+?\.(?:webp|jpe?g|png)/i)
      || html.match(/https:\/\/[^"'\s]+?\/(?:img|images|fotos?)\/[^"'\s]+?\.(?:webp|jpe?g)/i);
    if (m) photo = decode(m[0]);
  }
  if (photo && /resizedimgs/.test(photo)) photo = photo.split("?")[0] + "?action=fit-in&dimension=870x707";

  return json({ site, title: title ? decode(title).replace(/\s*\|.*$/, "") : undefined, address, neighborhood,
    rent, condo, iptu, area, bedrooms, bathrooms, parking, photo });
});
