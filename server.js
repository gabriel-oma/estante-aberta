import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3001);
const here = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
const CACHE_TTL = 1000 * 60 * 30;

app.use(express.json());

function cached(key, fetcher) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.savedAt < CACHE_TTL) {
    return Promise.resolve({ ...entry.value, cachedAt: new Date(entry.savedAt).toISOString() });
  }
  return fetcher().then((value) => {
    cache.set(key, { value, savedAt: Date.now() });
    return { ...value, cachedAt: new Date().toISOString() };
  });
}

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Serviço externo respondeu ${response.status}`);
  return response.json();
}

function tmdbUrl(endpoint, params = {}) {
  const search = new URLSearchParams({ ...params, api_key: process.env.TMDB_API_KEY });
  return `https://api.themoviedb.org/3${endpoint}?${search}`;
}

const charts = {
  book: { name: "toppaidebooks", genres: [9031, 9003, 9007, 9018, 9020, 9027, 9032, 9033, 9035, 9037, 9002, 9012] },
  movie: { name: "topmovies", genres: [4401, 4402, 4403, 4404, 4405, 4406, 4407, 4408, 4409, 4410, 4411, 4412, 4413, 4415, 4416, 4417] }
};
function cover(url = "") {
  return url.replace(/\d+x\d+bb(?=\.)/, "300x450bb");
}

function featuredCatalog(kind) {
  return cached("featured:" + kind, async () => {
    const { name, genres } = charts[kind];
    const paths = [name + "/limit=100", ...genres.map(id => name + "/limit=100/genre=" + id)];
    if (kind === "book") paths.push("topfreeebooks/limit=100");
    const entries = new Map();
    for (let offset = 0; offset < paths.length; offset += 6) {
      const batch = await Promise.allSettled(paths.slice(offset, offset + 6).map(async path => {
        const { feed } = await getJson("https://itunes.apple.com/br/rss/" + path + "/json", { signal: AbortSignal.timeout(5000) });
        return feed.entry || [];
      }));
      for (const result of batch) {
        if (result.status !== "fulfilled") continue;
        for (const entry of result.value) {
          const id = entry.id?.attributes?.["im:id"];
          if (id && !entries.has(id)) entries.set(id, entry);
        }
      }
    }
    if (!entries.size) throw new Error("Catálogo indisponível");
    const works = Array.from(entries.values(), entry => ({
      id: "apple-" + entry.id.attributes["im:id"], kind, title: entry["im:name"].label,
      authors: kind === "book" ? [entry["im:artist"]?.label].filter(Boolean) : [],
      director: kind === "movie" ? entry["im:artist"]?.label : "",
      year: entry["im:releaseDate"]?.label.slice(0, 4),
      cover: cover(entry["im:image"].at(-1)?.label), genres: [entry.category?.attributes.label].filter(Boolean)
    }));
    return { works };
  });
}

app.get("/api/featured/:kind", async (req, res) => {
  const kind = req.params.kind;
  if (!Object.hasOwn(charts, kind)) return res.sendStatus(404);
  try {
    const data = await featuredCatalog(kind);
    res.set("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=86400").json(data);
  } catch {
    res.status(502).json({ error: "Destaques temporariamente indisponíveis." });
  }
});

async function appleItem(id) {
  return cached("apple:" + id, async () => {
    const data = await getJson("https://itunes.apple.com/lookup?country=br&id=" + id.slice(6), { signal: AbortSignal.timeout(10000) });
    if (!data.results[0]) throw new Error("Obra indisponível");
    return { item: data.results[0] };
  });
}

app.get("/api/work/:kind/:id", async (req, res, next) => {
  const { id, kind } = req.params;
  if (!/^apple-\d+$/.test(id)) return next();
  try {
    const { item } = await appleItem(id);
    if (kind !== (item.kind === "ebook" ? "book" : "movie")) return res.sendStatus(404);
    res.json({ work: { id, kind, title: item.trackName, authors: kind === "book" ? [item.artistName] : [],
      director: kind === "movie" ? item.artistName : "", cover: cover(item.artworkUrl100),
      year: item.releaseDate?.slice(0, 4), genres: item.genres || [item.primaryGenreName].filter(Boolean),
      description: (item.longDescription || item.description || item.shortDescription || "").replace(/<[^>]+>/g, " ")
    } });
  } catch {
    res.status(502).json({ error: "Detalhes temporariamente indisponíveis." });
  }
});
async function searchGoogleBooks(query) {
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=16&langRestrict=pt`, { signal: AbortSignal.timeout(3500) });
  return (data.items || []).map((item) => {
    const info = item.volumeInfo || {};
    return {
      id: item.id, kind: "book", title: info.title || "Título indisponível",
      authors: info.authors || [], year: (info.publishedDate || "").slice(0, 4),
      description: info.description || "", cover: info.imageLinks?.thumbnail?.replace("http://", "https://") || "",
      genres: info.categories || [], isbn: info.industryIdentifiers?.find((id) => id.type === "ISBN_13")?.identifier || info.industryIdentifiers?.[0]?.identifier || "",
      pageCount: info.pageCount || null
    };
  });
}

async function searchTmdb(query) {
  const [data, genreData, people] = await Promise.all([
    getJson(tmdbUrl("/search/movie", { query, language: "pt-BR", region: "BR", include_adult: "false" })),
    getJson(tmdbUrl("/genre/movie/list", { language: "pt-BR" })),
    getJson(tmdbUrl("/search/person", { query, language: "pt-BR", include_adult: "false" }))
  ]);
  const genreNames = new Map((genreData.genres || []).map((item) => [item.id, item.name]));
  const movieResults = [...(data.results || [])];
  const directors = (people.results || []).filter((person) => person.known_for_department === "Directing" || person.known_for_department === "Acting").slice(0, 3);
  const directed = await Promise.all(directors.map((person) =>
    getJson(tmdbUrl("/discover/movie", { with_crew: person.id, language: "pt-BR", region: "BR", sort_by: "popularity.desc" }))
  ));
  for (const result of directed) movieResults.push(...(result.results || []));
  const uniqueMovies = [...new Map(movieResults.map((item) => [item.id, item])).values()];
  return uniqueMovies.map((item) => ({
    id: String(item.id), kind: "movie", title: item.title || item.original_title || "Título indisponível",
    authors: [], year: (item.release_date || "").slice(0, 4), description: item.overview || "",
    cover: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
    genres: (item.genre_ids || []).map((id) => genreNames.get(id)).filter(Boolean), director: ""
  }));
}

function normalizeText(text) {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

async function searchCatalog(kind, words) {
  const { works } = await featuredCatalog(kind);
  return works.filter(work => {
    const fields = normalizeText([work.title, ...(work.authors || []), work.director].filter(Boolean).join(" "));
    return words.every(word => fields.includes(word));
  });
}

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  const text = normalizeText(query);
  if (!text) return res.json({ results: [] });
  const kinds = ["book", "movie"].includes(req.query.type) ? [req.query.type] : ["book", "movie"];
  const sources = kinds.map(kind => searchCatalog(kind, text.split(" ")));
  if (kinds.includes("book")) sources.push(searchGoogleBooks(query));
  if (kinds.includes("movie") && process.env.TMDB_API_KEY) sources.push(searchTmdb(query));
  const responses = await Promise.allSettled(sources);
  const available = responses.filter(response => response.status === "fulfilled");
  if (!available.length) return res.status(503).json({ error: "A busca está temporariamente indisponível. Tente novamente." });
  const results = available.flatMap(response => response.value);
  function rank(work) {
    const title = normalizeText(work.title);
    if (title === text) return 0;
    return title.startsWith(text) ? 1 : 2;
  }
  results.sort((a, b) => rank(a) - rank(b));
  res.json({ results });
});
app.get("/api/work/movie/:id", async (req, res) => {
  if (!process.env.TMDB_API_KEY) return res.status(503).json({ error: "Configure TMDB_API_KEY para consultar filmes." });
  try {
    const [movie, credits] = await Promise.all([
      getJson(tmdbUrl(`/movie/${encodeURIComponent(req.params.id)}`, { language: "pt-BR" })),
      getJson(tmdbUrl(`/movie/${encodeURIComponent(req.params.id)}/credits`, { language: "pt-BR" }))
    ]);
    const director = (credits.crew || []).find((person) => person.job === "Director")?.name || "";
    res.json({
      work: {
        id: String(movie.id), kind: "movie", title: movie.title, director,
        year: (movie.release_date || "").slice(0, 4), description: movie.overview || "",
        cover: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : "",
        genres: (movie.genres || []).map((genre) => genre.name), runtime: movie.runtime || null
      }
    });
  } catch (error) {
    res.status(502).json({ error: `Não foi possível carregar o filme: ${error.message}` });
  }
});

app.get("/api/work/book/:id", async (req, res) => {
  try {
    const data = await getJson(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(req.params.id)}`);
    const info = data.volumeInfo || {};
    res.json({ work: {
      id: data.id, kind: "book", title: info.title || "Título indisponível", authors: info.authors || [],
      year: (info.publishedDate || "").slice(0, 4), description: info.description || "",
      cover: info.imageLinks?.thumbnail?.replace("http://", "https://") || "",
      genres: info.categories || [], isbn: info.industryIdentifiers?.find((item) => item.type === "ISBN_13")?.identifier || info.industryIdentifiers?.[0]?.identifier || "",
      pageCount: info.pageCount || null
    } });
  } catch (error) {
    res.status(502).json({ error: `Não foi possível carregar o livro: ${error.message}` });
  }
});

app.get("/api/availability/book", async (req, res) => {
  const isbn = String(req.query.isbn || "").trim();
  const title = String(req.query.title || "").trim();
  if (!process.env.SERPAPI_API_KEY) return res.status(503).json({ error: "Comparação de ofertas indisponível. Configure SERPAPI_API_KEY." });
  if (!isbn && !title) return res.status(400).json({ error: "Informe ISBN ou título para buscar ofertas." });
  const key = `book:${isbn || title}`;
  try {
    const result = await cached(key, async () => {
      const params = new URLSearchParams({ engine: "google_shopping", q: isbn || title, gl: "br", hl: "pt-BR", api_key: process.env.SERPAPI_API_KEY });
      const data = await getJson(`https://serpapi.com/search.json?${params}`);
      const offers = (data.shopping_results || []).filter((item) => item.link).map((item) => ({
        title: item.title || "", store: item.source || "Loja informada pelo provedor",
        price: item.extracted_price ?? null,
        priceText: item.price || (Number.isFinite(item.extracted_price) ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(item.extracted_price) : ""),
        link: item.link, isbn: isbn || "",
        format: /e-?book|digital|kindle/i.test(item.title || "") ? "Digital" :
          /audiobook|audiolivro/i.test(item.title || "") ? "Audiolivro" :
          /hardcover|capa dura/i.test(item.title || "") ? "Capa dura" :
          /paperback|brochura|capa comum/i.test(item.title || "") ? "Capa comum" : "Formato não informado"
      }));
      return { offers, checkedAt: new Date().toISOString() };
    });
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: `Não foi possível consultar ofertas agora: ${error.message}` });
  }
});

app.get("/api/availability/movie/:id", async (req, res) => {
  if (/^apple-\d+$/.test(req.params.id)) {
    try {
      const { item, cachedAt } = await appleItem(req.params.id);
      const providers = [];
      for (const [category, price] of [["Comprar", item.trackPrice], ["Alugar", item.trackRentalPrice]]) {
        if (Number.isFinite(price) && price >= 0 && item.trackViewUrl)
          providers.push({ category, provider: "Apple TV", link: item.trackViewUrl });
      }
      return res.json({ providers, checkedAt: cachedAt });
    } catch {
      return res.status(502).json({ error: "Disponibilidade temporariamente indisponível." });
    }
  }
  if (!process.env.TMDB_API_KEY) return res.status(503).json({ error: "Disponibilidade indisponível. Configure TMDB_API_KEY." });
  try {
    const result = await cached(`movie:${req.params.id}`, async () => {
      const data = await getJson(tmdbUrl(`/movie/${encodeURIComponent(req.params.id)}/watch/providers`));
      const br = data.results?.BR || {};
      const groups = [
        ["subscription", "Incluído na assinatura"],
        ["rent", "Alugar"],
        ["buy", "Comprar"]
      ].flatMap(([key, label]) => (br[key] || []).map((provider) => ({
        category: label, provider: provider.provider_name,
        link: br.link || "", price: null
      })));
      return { providers: groups, checkedAt: new Date().toISOString() };
    });
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: `Não foi possível consultar disponibilidade agora: ${error.message}` });
  }
});

if (!process.env.VERCEL) {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(here, "dist")));
    app.get("*", (_req, res) => res.sendFile(path.join(here, "dist", "index.html")));
  }
  app.listen(port, () => console.log(`Estante Aberta API disponível em http://localhost:${port}`));
}

export default app;
