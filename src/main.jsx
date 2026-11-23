import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowDown, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleUserRound,
  Clapperboard, Compass, ExternalLink, Eye, EyeOff, Film, Heart, LibraryBig,
  LoaderCircle, LogOut, Menu, Plus, Search, Share2, Sparkles, Star, X
} from "lucide-react";
import "./styles.css";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;
const statusNames = {
  want_read: "Quero ler", reading: "Lendo", read: "Lidos",
  want_watch: "Quero assistir", watching: "Assistindo", watched: "Assistidos"
};
const statusOptions = {
  book: [["want_read", "Quero ler"], ["reading", "Lendo"], ["read", "Lidos"]],
  movie: [["want_watch", "Quero assistir"], ["watching", "Assistindo"], ["watched", "Assistidos"]]
};

function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("explore");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [genre, setGenre] = useState("");
  const [results, setResults] = useState([]);
  const [collections, setCollections] = useState([]);
  const [ownCollections, setOwnCollections] = useState([]);
  const [shelf, setShelf] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [ownReview, setOwnReview] = useState(null);
  const [offers, setOffers] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collectionModal, setCollectionModal] = useState(false);
  const [activeCollection, setActiveCollection] = useState(null);
  const [filterShelf, setFilterShelf] = useState("all");

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user || null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user || null));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    loadCollections();
    if (user) loadShelf();
    else setShelf([]);
  }, [user]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const slug = params.get("colecao");
    if (slug && supabase) loadSharedCollection(slug);
  }, []);

  async function loadCollections() {
    if (!supabase) return;
    const { data, error } = await supabase.from("collections").select("id,title,description,is_public,share_slug,user_id,created_at").eq("is_public", true).order("created_at", { ascending: false }).limit(12);
    if (error) setMessage(`Não foi possível carregar as estantes públicas: ${error.message}`);
    else setCollections(data || []);
    if (user) {
      const own = await supabase.from("collections").select("id,title,description,is_public,share_slug,user_id,created_at").eq("user_id", user.id).order("created_at", { ascending: false });
      if (own.error) setMessage(`Não foi possível carregar suas coleções: ${own.error.message}`);
      else setOwnCollections(own.data || []);
    } else setOwnCollections([]);
  }

  async function loadShelf() {
    if (!supabase || !user) return;
    const { data, error } = await supabase.from("shelf_items").select("*").order("created_at", { ascending: false });
    if (error) setMessage(`Não foi possível carregar sua estante: ${error.message}`);
    else setShelf(data || []);
  }

  async function loadSharedCollection(slug) {
    const { data, error } = await supabase.from("collections").select("id,title,description,is_public,share_slug,user_id").eq("share_slug", slug).eq("is_public", true).maybeSingle();
    if (error || !data) {
      setMessage(error?.message || "Esta estante não existe ou não está pública.");
      return;
    }
    const items = await supabase.from("collection_items").select("*").eq("collection_id", data.id).order("created_at", { ascending: false });
    if (items.error) {
      setMessage(`Não foi possível carregar as obras da estante: ${items.error.message}`);
      return;
    }
    setActiveCollection({ ...data, items: items.data || [] });
    setPage("public");
  }

  async function search(event) {
    event?.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setMessage("");
    setSelected(null);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&type=${type}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha na busca.");
      setResults(data.results || []);
    } catch (error) {
      setResults([]);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function openWork(item) {
    setSelected(item);
    setOffers(null);
    setAvailability(null);
    setReviews([]);
    setRatingSummary(null);
    setOwnReview(null);
    setMessage("");
    const detailRequest = fetch(`/api/work/${item.kind}/${encodeURIComponent(item.id)}`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os detalhes.");
      setSelected(data.work);
    }).catch((error) => setMessage(error.message));
    if (supabase) {
      const [publicReviews, own, summary] = await Promise.all([
        supabase.from("reviews").select("user_id,rating,review_text,spoiler,updated_at").eq("work_id", String(item.id)).eq("work_kind", item.kind).not("review_text", "is", null).order("updated_at", { ascending: false }).limit(50),
        user ? supabase.from("reviews").select("user_id,rating,review_text,spoiler,updated_at").eq("user_id", user.id).eq("work_id", String(item.id)).eq("work_kind", item.kind).maybeSingle() : Promise.resolve({ data: null, error: null }),
        supabase.from("work_rating_summary").select("rating_average,vote_count").eq("work_id", String(item.id)).eq("work_kind", item.kind).maybeSingle()
      ]);
      if (publicReviews.error) setMessage(`Não foi possível carregar as resenhas: ${publicReviews.error.message}`);
      else setReviews(publicReviews.data || []);
      if (own.error) setMessage(`Não foi possível carregar sua nota: ${own.error.message}`);
      else setOwnReview(own.data || null);
      if (summary.error) setMessage(`Não foi possível carregar a média da comunidade: ${summary.error.message}`);
      else setRatingSummary(summary.data || null);
    }
    if (item.kind === "book") {
      const params = new URLSearchParams({ isbn: item.isbn || "", title: item.title });
      fetch(`/api/availability/book?${params}`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Ofertas indisponíveis.");
        setOffers(data);
      }).catch((error) => setOffers({ error: error.message }));
    } else {
      fetch(`/api/availability/movie/${encodeURIComponent(item.id)}`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Disponibilidade indisponível.");
        setAvailability(data);
      }).catch((error) => setAvailability({ error: error.message }));
    }
    await detailRequest;
  }

  async function saveToShelf(status) {
    if (!user) return setAuthOpen(true);
    const { error } = await supabase.from("shelf_items").upsert({
      user_id: user.id, work_id: String(selected.id), work_kind: selected.kind, work_title: selected.title,
      work_cover: selected.cover, status
    }, { onConflict: "user_id,work_kind,work_id" });
    if (error) setMessage(`Não foi possível salvar na estante: ${error.message}`);
    else {
      setMessage(`Adicionado à sua estante: ${statusNames[status]}.`);
      loadShelf();
    }
  }

  async function saveReview(rating, reviewText = ownReview?.review_text || "", spoiler = ownReview?.spoiler || false) {
    if (!user) return setAuthOpen(true);
    const payload = {
      user_id: user.id, work_id: String(selected.id), work_kind: selected.kind, work_title: selected.title,
      rating, review_text: reviewText.trim() || null, spoiler
    };
    const { error } = await supabase.from("reviews").upsert(payload, { onConflict: "user_id,work_kind,work_id" });
    if (error) setMessage(`Não foi possível salvar sua avaliação: ${error.message}`);
    else {
      setMessage("Sua avaliação foi salva.");
      const [publicReviews, own, summary] = await Promise.all([
        supabase.from("reviews").select("user_id,rating,review_text,spoiler,updated_at").eq("work_id", String(selected.id)).eq("work_kind", selected.kind).not("review_text", "is", null).order("updated_at", { ascending: false }).limit(50),
        supabase.from("reviews").select("user_id,rating,review_text,spoiler,updated_at").eq("work_id", String(selected.id)).eq("work_kind", selected.kind).eq("user_id", user.id).maybeSingle(),
        supabase.from("work_rating_summary").select("rating_average,vote_count").eq("work_id", String(selected.id)).eq("work_kind", selected.kind).maybeSingle()
      ]);
      if (publicReviews.error || own.error || summary.error) {
        const error = publicReviews.error || own.error || summary.error;
        setMessage(`Sua avaliação foi salva, mas não foi possível atualizar os dados: ${error.message}`);
      } else {
        setReviews(publicReviews.data || []);
        setOwnReview(own.data || null);
        setRatingSummary(summary.data || null);
      }
    }
  }

  async function createCollection(event) {
    event.preventDefault();
    if (!user) return setAuthOpen(true);
    const form = new FormData(event.currentTarget);
    const { data, error } = await supabase.from("collections").insert({
      user_id: user.id, title: form.get("title"), description: form.get("description"),
      is_public: form.get("visibility") === "public"
    }).select().single();
    if (error) setMessage(`Não foi possível criar a coleção: ${error.message}`);
    else {
      setCollectionModal(false);
      setMessage("Coleção criada. Adicione obras a ela pela página de cada obra.");
      loadCollections();
      setActiveCollection({ ...data, items: [] });
      setPage("public");
    }
  }

  async function addToCollection(collectionId) {
    if (!selected) return;
    const { error } = await supabase.from("collection_items").upsert({
      collection_id: collectionId, work_id: String(selected.id), work_kind: selected.kind,
      work_title: selected.title, work_cover: selected.cover
    }, { onConflict: "collection_id,work_kind,work_id" });
    if (error) setMessage(`Não foi possível adicionar à coleção: ${error.message}`);
    else setMessage("Obra adicionada à coleção.");
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) setMessage(`Não foi possível sair: ${error.message}`);
  }

  const filteredResults = useMemo(() => results.filter((item) => !genre || item.genres?.includes(genre)), [results, genre]);
  const genres = useMemo(() => [...new Set(results.flatMap((item) => item.genres || []))].sort(), [results]);
  const average = ratingSummary ? Number(ratingSummary.rating_average) : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setPage("explore"); setSelected(null); }}>
          <span className="brand-mark"><BookOpen size={22} strokeWidth={1.7} /></span>
          <span>estante <b>aberta</b></span>
        </a>
        <button className="mobile-menu" aria-label="Abrir navegação" onClick={() => setMobileOpen(!mobileOpen)}><Menu /></button>
        <nav className={mobileOpen ? "main-nav is-open" : "main-nav"}>
          <button className={page === "explore" ? "nav-link active" : "nav-link"} onClick={() => { setPage("explore"); setSelected(null); setMobileOpen(false); }}><Compass size={17} /> Explorar</button>
          <button className={page === "public" ? "nav-link active" : "nav-link"} onClick={() => { setPage("public"); setSelected(null); setActiveCollection(null); setMobileOpen(false); }}><LibraryBig size={17} /> Estantes públicas</button>
          <button className={page === "shelf" ? "nav-link active" : "nav-link"} onClick={() => { if (!user) setAuthOpen(true); else { setPage("shelf"); setSelected(null); } setMobileOpen(false); }}><BookOpen size={17} /> Minha estante</button>
        </nav>
        <div className="account-area">
          {user ? <><span className="user-email">{user.email}</span><button className="icon-button" title="Sair" onClick={signOut}><LogOut size={18} /></button></> :
            <button className="login-button" onClick={() => setAuthOpen(true)}><CircleUserRound size={18} /> Entrar</button>}
        </div>
      </header>

      <main>
        {!selected && page === "explore" && <ExplorePage query={query} setQuery={setQuery} type={type} setType={setType} search={search}
          busy={busy} message={message} collections={collections} openWork={openWork} results={filteredResults}
          genre={genre} setGenre={setGenre} genres={genres} setPage={setPage} setActiveCollection={setActiveCollection}
          setSelected={setSelected} />}
        {!selected && page === "public" && <PublicPage collections={collections} activeCollection={activeCollection}
          setActiveCollection={setActiveCollection} setSelected={setSelected} setPage={setPage} openWork={openWork} user={user}
          onCreate={() => user ? setCollectionModal(true) : setAuthOpen(true)} setMessage={setMessage} />}
        {!selected && page === "shelf" && <ShelfPage shelf={shelf} user={user} openWork={openWork} filter={filterShelf}
          setFilter={setFilterShelf} onCreate={() => setCollectionModal(true)} />}
        {selected && <WorkPage work={selected} onBack={() => { setSelected(null); setMessage(""); }} user={user}
          onSave={saveToShelf} reviews={reviews} ownReview={ownReview} average={average} voteCount={ratingSummary?.vote_count || 0} onRate={saveReview}
          offers={offers} availability={availability} message={message} collections={ownCollections}
          onAddCollection={addToCollection} onCreateCollection={() => user ? setCollectionModal(true) : setAuthOpen(true)} />}
      </main>

      <footer><span>Um lugar para guardar histórias.</span><span>Feito para leitores, cinéfilos e curiosos.</span></footer>

      {authOpen && <AuthModal mode={authMode} setMode={setAuthMode} onClose={() => setAuthOpen(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!supabase) return setMessage("Configure as variáveis do Supabase para habilitar contas.");
          const form = new FormData(event.currentTarget);
          const method = authMode === "login" ? supabase.auth.signInWithPassword({ email: form.get("email"), password: form.get("password") })
            : supabase.auth.signUp({ email: form.get("email"), password: form.get("password") });
          const { error } = await method;
          if (error) setMessage(error.message);
          else { setAuthOpen(false); setMessage(authMode === "login" ? "Você entrou na sua conta." : "Conta criada. Verifique seu e-mail se a confirmação estiver ativada."); }
        }} />}

      {collectionModal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCollectionModal(false); }}>
        <form className="modal-card" onSubmit={createCollection}>
          <button type="button" className="modal-close" onClick={() => setCollectionModal(false)} aria-label="Fechar"><X /></button>
          <span className="eyebrow">SUA PRÓXIMA CURADORIA</span><h2>Nova coleção</h2>
          <label>Nome<input name="title" placeholder="Ex.: Para ver numa tarde chuvosa" maxLength="80" required /></label>
          <label>Descrição<textarea name="description" rows="3" placeholder="O que une essas histórias?" /></label>
          <label>Visibilidade<select name="visibility"><option value="public">Pública — qualquer pessoa pode ver</option><option value="private">Privada — só você pode ver</option></select></label>
          <button className="button-primary full-width" type="submit">Criar coleção <ArrowRight size={17} /></button>
        </form>
      </div>}
      {message && !selected && <div className="toast" role="status">{message}<button onClick={() => setMessage("")} aria-label="Fechar"><X size={15} /></button></div>}
    </div>
  );
}

function FeaturedRow({ kind, openWork }) {
  const [works, setWorks] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/featured/" + kind, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        setWorks(data.works);
      })
      .catch(() => { if (!controller.signal.aborted) setWorks([]); });
    return () => controller.abort();
  }, [kind]);
  return <section className="section-block">
    <div className="section-heading"><h2>{kind === "book" ? "Livros em destaque" : "Filmes em destaque"}</h2></div>
    {works?.length ? <div className="book-row">{works.map(item =>
      <WorkCard key={item.id} item={item} onClick={() => openWork(item)} />
    )}</div> : <p className="muted" role="status">{works ? "Destaques indisponíveis no momento." : "Carregando destaques…"}</p>}
  </section>;
}
function ExplorePage({ query, setQuery, type, setType, search, busy, message, collections, openWork, results, genre, setGenre, genres, setPage, setActiveCollection }) {
  return <div className="page-wrap">
    <section className="hero">
      <div className="hero-copy"><span className="eyebrow"><Sparkles size={14} /> HISTÓRIAS QUE ENCONTRAM VOCÊ</span>
        <h1>O que vamos<br /><em>descobrir hoje?</em></h1>
        <p>Livros, filmes e as estantes de quem também ama boas histórias.</p>
        <form className="search-form" onSubmit={search}>
          <Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Busque por título, autor ou diretor" aria-label="Buscar obras" />
          <button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : "Buscar"}</button>
        </form>
        <div className="search-filters">
          <div className="segmented">
            {[["all", "Tudo"], ["book", "Livros"], ["movie", "Filmes"]].map(([value, label]) => <button key={value} className={type === value ? "selected" : ""} onClick={() => setType(value)} type="button">{label}</button>)}
          </div>
          {genres.length > 0 && <select value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="Filtrar por gênero"><option value="">Todos os gêneros</option>{genres.map((item) => <option key={item}>{item}</option>)}</select>}
        </div>
      </div>
      <div className="hero-art" aria-hidden="true"><div className="sun-disc" /><div className="hero-book book-one" /><div className="hero-book book-two" /><div className="hero-book book-three" /><div className="hero-caption">uma história<br />puxa a outra</div><div className="tiny-star">✳</div></div>
    </section>

    {message && <div className="inline-notice">{message}</div>}
    {results.length > 0 && <section className="section-block search-results">
      <div className="section-heading"><div><span className="eyebrow">CATÁLOGO</span><h2>Resultados da busca</h2></div><span className="result-count">{results.length} obras</span></div>
      {results.length ? <div className="book-row">{results.map((item) => <WorkCard key={`${item.kind}-${item.id}`} item={item} onClick={() => openWork(item)} />)}</div> : <p className="muted">Nenhuma obra encontrada para esse gênero.</p>}
    </section>}

    {type !== "movie" && <FeaturedRow kind="book" openWork={openWork} />}
    {type !== "book" && <FeaturedRow kind="movie" openWork={openWork} />}
    <section className="community-section section-block">
      <div className="section-heading"><div><span className="eyebrow">CURADORIAS DA COMUNIDADE</span><h2>Das estantes da comunidade</h2><p>Listas feitas por quem ama encontrar e compartilhar.</p></div>
        <button className="text-button" onClick={() => { setPage("public"); setActiveCollection(null); }}>Ver todas <ArrowRight size={16} /></button></div>
      <div className="collection-grid">{collections.length ? collections.slice(0, 3).map((collection, index) => <CollectionCard key={collection.id} collection={collection} index={index} onClick={() => { setActiveCollection(collection); setPage("public"); }} />) :
        <div className="empty-collections"><div className="empty-icon"><LibraryBig /></div><div><b>As próximas estantes começam por você.</b><p>Entre para criar uma coleção pública e compartilhar suas descobertas.</p></div></div>}</div>
    </section>
    <section className="quote-banner"><div className="quote-symbol">“</div><p>Há mundos inteiros esperando<br />por uma porta aberta.</p><span>ESTANTE ABERTA</span></section>
  </div>;
}

function PublicPage({ collections, activeCollection, setActiveCollection, setSelected, setPage, openWork, user, onCreate, setMessage }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!activeCollection || activeCollection.items) {
      setItems(activeCollection?.items || []);
      return;
    }
    let active = true;
    setLoading(true);
    supabase.from("collection_items").select("*").eq("collection_id", activeCollection.id).order("created_at", { ascending: false})
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setItems([]);
          setLoading(false);
          return;
        }
        setItems(data || []);
        setLoading(false);
      });
    return () => { active = false; };
  }, [activeCollection]);
  const shareUrl = activeCollection ? `${location.origin}${location.pathname}?colecao=${activeCollection.share_slug}` : "";
  return <div className="page-wrap interior-page">
    <div className="page-title-row"><div><span className="eyebrow">FEITAS PARA COMPARTILHAR</span><h1>Estantes públicas</h1><p>Descubra seleções de livros e filmes criadas pela comunidade.</p></div>
      {user && <button className="button-primary" onClick={onCreate}><Plus size={18} /> Nova coleção</button>}</div>
    {activeCollection ? <section className="active-collection">
      <button className="back-link" onClick={() => setActiveCollection(null)}><ArrowLeft size={16} /> Todas as estantes</button>
      <div className="active-collection-title"><div><span className="eyebrow">ESTANTE DA COMUNIDADE</span><h2>{activeCollection.title}</h2><p>{activeCollection.description || "Uma coleção de histórias para descobrir."}</p></div>
        {activeCollection.is_public && <button className="button-outline" onClick={async () => {
          try {
            await navigator.clipboard.writeText(shareUrl);
            setMessage("Link da coleção copiado.");
          } catch {
            setMessage(`Compartilhe este link: ${shareUrl}`);
          }
        }}><Share2 size={16} /> Compartilhar</button>}</div>
      {loading ? <Loading /> : items.length ? <div className="book-row">{items.map((item) => <WorkCard key={item.id} item={item} onClick={() => openWork(item)} />)}</div> : <div className="empty-state">Esta estante ainda não tem obras.</div>}
    </section> : <div className="public-grid">{collections.length ? collections.map((collection, index) => <CollectionCard key={collection.id} collection={collection} index={index} onClick={() => setActiveCollection(collection)} />) :
      <div className="empty-state">Ainda não há coleções públicas. Volte em breve para novas descobertas.</div>}</div>}
  </div>;
}

function ShelfPage({ shelf, user, openWork, filter, setFilter, onCreate }) {
  const filtered = shelf.filter((item) => filter === "all" || item.status === filter);
  return <div className="page-wrap interior-page">
    <div className="page-title-row"><div><span className="eyebrow">SEU CANTO, SUAS HISTÓRIAS</span><h1>Minha estante</h1><p>Um lugar para guardar o que você quer ler, está lendo e já leu.</p></div>
      <button className="button-primary" onClick={onCreate}><Plus size={18} /> Criar coleção</button></div>
    <div className="shelf-toolbar"><div className="shelf-tabs">{[["all", "Tudo"], ...Object.entries(statusNames)].map(([value, label]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><span>{filtered.length} {filtered.length === 1 ? "obra" : "obras"}</span></div>
    {filtered.length ? <div className="book-row shelf-row">{filtered.map((item) => <WorkCard key={item.id} item={{ ...item, kind: item.work_kind, title: item.work_title, cover: item.work_cover }} onClick={() => openWork({ ...item, kind: item.work_kind, id: item.work_id, title: item.work_title, cover: item.work_cover })} status={statusNames[item.status]} />)}</div> :
      <div className="empty-state shelf-empty"><div className="empty-icon"><BookOpen /></div><h3>{user ? "Sua estante está esperando a primeira história." : "Entre para ver sua estante."}</h3><p>Pesquise por um livro ou filme e salve aqui.</p></div>}
  </div>;
}

function WorkPage({ work, onBack, user, onSave, reviews, ownReview, average, voteCount, onRate, offers, availability, message, collections, onAddCollection, onCreateCollection }) {
  const [revealed, setRevealed] = useState({});
  const [text, setText] = useState(ownReview?.review_text || "");
  const [spoiler, setSpoiler] = useState(ownReview?.spoiler || false);
  const [status, setStatus] = useState("");
  const [savingReview, setSavingReview] = useState(false);
  useEffect(() => { setText(ownReview?.review_text || ""); setSpoiler(ownReview?.spoiler || false); }, [ownReview]);
  const groupedOffers = useMemo(() => {
    const groups = new Map();
    for (const offer of offers?.offers || []) {
      const key = `${offer.isbn || "sem-isbn"}-${offer.format || "formato não informado"}`;
      groups.set(key, [...(groups.get(key) || []), offer]);
    }
    return [...groups.entries()];
  }, [offers]);
  return <div className="page-wrap work-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Voltar para explorar</button>
    <section className="work-hero">
      <div className={`work-cover ${work.kind === "movie" ? "movie-cover" : ""}`}>{work.cover ? <img src={work.cover} alt={`Capa de ${work.title}`} /> : <div className="cover-placeholder">{work.kind === "book" ? <BookOpen /> : <Film />}</div>}</div>
      <div className="work-main">
        <span className="eyebrow">{work.kind === "book" ? "LIVRO" : "FILME"}{work.year ? ` · ${work.year}` : ""}</span>
        <h1>{work.title}</h1>
        <p className="work-author">{work.kind === "book" ? (work.authors || []).join(", ") || "Autoria não informada" : `Direção: ${work.director || "Não informada"}`}</p>
        <div className="work-meta">{work.genres?.slice(0, 3).map((item) => <span key={item}>{item}</span>)}{work.pageCount && <span>{work.pageCount} páginas</span>}{work.runtime && <span>{work.runtime} min</span>}</div>
        <p className="work-description">{work.description || "Sinopse não disponível no catálogo."}</p>
        <div className="work-actions">
          <label className="status-select-label"><BookOpen size={17} /><select value={status} onChange={(event) => { setStatus(event.target.value); if (event.target.value) onSave(event.target.value); }}>
            <option value="">Adicionar à minha estante</option>{statusOptions[work.kind]?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select><ChevronDown size={16} /></label>
          {user && collections.length > 0 && <select className="collection-select" defaultValue="" onChange={(event) => { if (event.target.value) onAddCollection(event.target.value); event.target.value = ""; }}><option value="">Adicionar à coleção</option>{collections.filter((item) => item.user_id === user.id).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
          {user && <button className="icon-button add-collection" title="Criar coleção" onClick={onCreateCollection}><Plus size={19} /></button>}
        </div>
        <div className="community-rating">
          <div><span className="eyebrow">MÉDIA DA COMUNIDADE</span><div className="average-line">{average === null ? <span>Sem avaliações</span> : <><Star size={19} fill="currentColor" /><b>{average.toFixed(1).replace(".", ",")}</b><span>de 5 · {voteCount} {voteCount === 1 ? "avaliação" : "avaliações"}</span></>}</div></div>
          <div className="your-rating"><span className="eyebrow">SUA NOTA</span><div className="star-picker" role="group" aria-label="Sua nota de 1 a 5">{[1, 2, 3, 4, 5].map((number) => <button key={number} aria-label={`${number} estrelas`} title={`${number} estrelas`} className={(ownReview?.rating || 0) >= number ? "star-active" : ""} onClick={async () => { setSavingReview(true); await onRate(number); setSavingReview(false); }}><Star size={24} fill={(ownReview?.rating || 0) >= number ? "currentColor" : "none"} /></button>)}</div></div>
        </div>
      </div>
    </section>
    {message && <div className="inline-notice">{message}</div>}

    <section className="review-section">
      <div className="section-heading"><div><span className="eyebrow">OPINIÕES DE QUEM JÁ CONHECE</span><h2>Resenhas da comunidade</h2></div><span className="result-count">{reviews.filter((item) => item.review_text).length} resenhas</span></div>
      {user ? <form className="review-editor" onSubmit={async (event) => { event.preventDefault(); setSavingReview(true); await onRate(ownReview?.rating || 5, text, spoiler); setSavingReview(false); }}>
        <div className="editor-top"><span>Sua resenha</span>{ownReview?.updated_at && <span className="muted">Editada em {new Date(ownReview.updated_at).toLocaleDateString("pt-BR")}</span>}</div>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder="O que essa história despertou em você?" rows="4" />
        <div className="editor-bottom"><label className="spoiler-toggle"><input type="checkbox" checked={spoiler} onChange={(event) => setSpoiler(event.target.checked)} /> <EyeOff size={16} /> Esta resenha contém spoiler</label>
          <button className="button-primary" disabled={savingReview || !ownReview?.rating}>{savingReview ? <LoaderCircle className="spin" size={16} /> : null} Publicar resenha</button></div>
        {!ownReview?.rating && <small className="muted">Escolha sua nota acima para publicar uma resenha.</small>}
      </form> : <div className="sign-in-prompt"><p>Entre para avaliar e escrever sua resenha.</p><span>Suas notas ficam salvas na sua conta em qualquer dispositivo.</span></div>}
      <div className="review-list">{reviews.filter((item) => item.review_text).map((review) => <article className="review-card" key={review.user_id}>
        <div className="review-person"><div className="avatar">{review.user_id === user?.id ? "Você" : "EA"}</div><div><b>{review.user_id === user?.id ? "Sua resenha" : "Pessoa da comunidade"}</b><span><Star size={13} fill="currentColor" /> {review.rating} de 5</span></div><small>{new Date(review.updated_at).toLocaleDateString("pt-BR")}</small></div>
        {review.spoiler && !revealed[review.user_id] ? <div className="spoiler-cover"><EyeOff size={17} /> Esta resenha contém spoiler <button onClick={() => setRevealed((value) => ({ ...value, [review.user_id]: true }))}>Revelar spoiler <Eye size={14} /></button></div> : <p>{review.review_text}</p>}
        {review.spoiler && revealed[review.user_id] && <button className="text-button hide-spoiler" onClick={() => setRevealed((value) => ({ ...value, [review.user_id]: false }))}><EyeOff size={14} /> Ocultar spoiler</button>}
      </article>)}</div>
    </section>

    <section className="availability-section">
      <div className="section-heading"><div><span className="eyebrow">ENCONTRE SUA PRÓXIMA HISTÓRIA</span><h2>{work.kind === "book" ? "Compare preços" : "Onde assistir"}</h2></div></div>
      {work.kind === "book" ? <div className="availability-box">
        {!offers && <Loading label="Consultando ofertas..." />}
        {offers?.error && <p className="service-error">{offers.error}</p>}
        {offers?.offers?.length === 0 && <p className="muted">Nenhuma oferta encontrada pelo provedor.</p>}
        {groupedOffers.map(([key, group]) => <div className="offer-group" key={key}><h3>{work.title}<small>{work.isbn ? `ISBN ${work.isbn}` : "Edição informada pelas lojas"} · {group[0].format}</small></h3>
          {group.map((offer, index) => <a className="offer-row" href={offer.link} target="_blank" rel="noreferrer" key={`${offer.store}-${index}`}><span>{offer.store}<small>{offer.title}</small></span><b>{offer.priceText || "Consultar preço na loja"}</b><ExternalLink size={16} /></a>)}</div>)}
        {offers?.checkedAt && <small className="checked-at">Consultado em {new Date(offers.checkedAt).toLocaleString("pt-BR")}</small>}
      </div> : <div className="availability-box">
        {!availability && <Loading label="Consultando disponibilidade no Brasil..." />}
        {availability?.error && <p className="service-error">{availability.error}</p>}
        {availability?.providers?.length === 0 && <p className="muted">Nenhuma disponibilidade confirmada pelo provedor no Brasil.</p>}
        {["Incluído na assinatura", "Alugar", "Comprar"].map((category) => {
          const providers = availability?.providers?.filter((item) => item.category === category) || [];
          return providers.length ? <div className="provider-group" key={category}><h3>{category}</h3>{providers.map((provider, index) => <div className="provider-row" key={`${provider.provider}-${index}`}><span>{provider.provider}</span><span>Consultar preço no serviço</span>{provider.link ? <a href={provider.link} target="_blank" rel="noreferrer" aria-label={`Abrir ${provider.provider}`}><ExternalLink size={16} /></a> : <span className="no-link">Link não informado</span>}</div>)}</div> : null;
        })}
        {availability?.checkedAt && <small className="checked-at">Consultado em {new Date(availability.checkedAt).toLocaleString("pt-BR")}</small>}
      </div>}
      <p className="data-note">Preços e disponibilidade são fornecidos por serviços externos e podem mudar.</p>
    </section>
  </div>;
}

function WorkCard({ item, onClick, status }) {
  const kind = item.kind || item.work_kind;
  const title = item.title || item.work_title;
  const cover = item.cover || item.work_cover;
  const id = item.work_id || item.id;
  return <button className="work-card" onClick={() => onClick({ ...item, id, kind, title, cover })}>
    <div className={`card-cover ${kind === "movie" ? "poster" : ""}`}>{cover ? <img loading="lazy" src={cover} alt="" /> : <span>{kind === "movie" ? <Film /> : <BookOpen />}</span>}
      {status && <small className="status-pill">{status}</small>}</div>
    <b>{title}</b><span>{kind === "movie" ? "Filme" : "Livro"}{item.year ? ` · ${item.year}` : ""}</span>
  </button>;
}

function CollectionCard({ collection, index, onClick }) {
  const colors = ["sage", "rose", "ochre"];
  return <button className="collection-card" onClick={onClick}>
    <div className={`collection-art ${colors[index % colors.length]}`}><span className="art-book a" /><span className="art-book b" /><span className="art-book c" /><span className="art-mark">✳</span><div className="collection-art-caption">ESTANTE<br />ABERTA</div></div>
    <div className="collection-info"><span className="eyebrow">COLEÇÃO PÚBLICA</span><h3>{collection.title}</h3><p>{collection.description || "Uma seleção feita pela comunidade."}</p><span className="collection-open">Explorar coleção <ArrowRight size={15} /></span></div>
  </button>;
}

function AuthModal({ mode, setMode, onClose, onSubmit }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="modal-card auth-card" onSubmit={onSubmit}>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar"><X /></button>
      <div className="auth-icon"><BookOpen /></div><span className="eyebrow">BEM-VINDA À COMUNIDADE</span><h2>{mode === "login" ? "Entre na sua estante" : "Crie sua conta"}</h2>
      <p>Suas notas e descobertas acompanham você.</p>
      <label>E-mail<input name="email" type="email" autoComplete="email" placeholder="voce@email.com" required /></label>
      <label>Senha<input name="password" type="password" minLength="6" autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Mínimo de 6 caracteres" required /></label>
      <button className="button-primary full-width" type="submit">{mode === "login" ? "Entrar" : "Criar conta"} <ArrowRight size={17} /></button>
      <p className="auth-switch">{mode === "login" ? "Ainda não tem conta?" : "Já tem conta?"} <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>{mode === "login" ? "Criar conta" : "Entrar"}</button></p>
    </form>
  </div>;
}

function Loading({ label = "Carregando..." }) {
  return <div className="loading-state"><LoaderCircle className="spin" size={18} /> {label}</div>;
}

createRoot(document.getElementById("root")).render(<App />);
