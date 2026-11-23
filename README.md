# Estante Aberta

Aplicação responsiva em português para descobrir livros e filmes, organizar uma estante pessoal, publicar coleções e avaliações.

## Requisitos

- Node.js 20 ou superior
- Projeto Supabase
- Chave de API v3 do TMDB para busca, detalhes e disponibilidade de filmes
- Chave da SerpApi para ofertas de livros do Google Shopping no Brasil

## Configuração

1. Instale as dependências com `npm install`.
2. Copie `.env.example` para `.env` e preencha as chaves do servidor:

   ```env
   PORT=3001
   TMDB_API_KEY=sua_chave_tmdb
   SERPAPI_API_KEY=sua_chave_serpapi
   ```

3. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente usado para compilar a aplicação. A chave anon/public é apropriada para o navegador quando as políticas RLS estão habilitadas; nunca use a service-role key no frontend.
4. Execute [supabase/schema.sql](./supabase/schema.sql) no SQL Editor do Supabase.
5. Em Supabase Authentication, habilite e configure autenticação por e-mail e senha. Para desenvolvimento local, ajuste a confirmação de e-mail conforme a política desejada.
6. Rode `npm run dev`. O Vite serve a interface e encaminha `/api` ao servidor local. Para produção, defina as variáveis de build do Supabase, rode `npm run build` e execute `npm start`.

O Google Books é usado sem chave para catálogo de livros. O TMDB e a SerpApi são chamados somente pelo servidor. Respostas externas de disponibilidade e ofertas ficam em cache por 30 minutos; cada resultado informa o horário de consulta. Se um provedor falhar ou não estiver configurado, sua seção mostra a indisponibilidade sem bloquear estantes e avaliações.

## Publicar na Vercel

1. Envie o projeto para um repositório GitHub e importe esse repositório em [vercel.com/new](https://vercel.com/new).
2. A Vercel detecta o Vite e usa `npm run build` com a pasta de saída `dist`; o `vercel.json` também encaminha as rotas do site para a aplicação.
3. Em **Settings → Environment Variables**, cadastre:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `TMDB_API_KEY`
   - `SERPAPI_API_KEY`
4. Marque os ambientes Production e Preview conforme necessário e faça um novo deploy após salvar as variáveis.
5. No Supabase, adicione o domínio de produção da Vercel à lista de URLs permitidas para autenticação e configure a URL de redirecionamento do site.

A chave anon do Supabase é pública e é incorporada ao frontend; as políticas RLS devem permanecer habilitadas. Nunca cadastre a chave service-role no frontend. As chaves TMDB e SerpApi são usadas pela função da API no servidor.

## Funcionalidades implementadas

- Busca de livros por título, autor ou ISBN no Google Books e filmes por título no TMDB; filtro de tipo e gênero.
- Detalhes de obras, autoria/direção, ano, sinopse e capas/pôsteres.
- Estante pessoal com estados independentes para livros e filmes, salva no Supabase.
- Coleções temáticas públicas ou privadas; coleções públicas têm link compartilhável (`?colecao=<slug>`).
- Notas inteiras de 1 a 5, uma por pessoa e obra, com edição via upsert. A média e a contagem são derivadas das avaliações persistidas e visíveis publicamente.
- Resenhas editáveis com flag de spoiler. Resenhas marcadas ficam ocultas até a pessoa selecionar “Revelar spoiler”.
- Ofertas com loja, preço retornado, edição/formato, ISBN disponível e link; disponibilidade de streaming por categoria no Brasil.

## Testes manuais sugeridos

1. Configure Supabase, execute o esquema e crie duas contas com e-mails distintos.
2. Busque uma obra e abra a página dela. Salve a obra na estante, escolha uma nota e publique uma resenha.
3. Na segunda conta, atribua outra nota. Notas 4 e 5 devem resultar em `4,5 de 5 · 2 avaliações`.
4. Na primeira conta, altere a nota para 3. O resultado deve passar a `4,0 de 5 · 2 avaliações`, mantendo dois votos.
5. Crie uma coleção pública, adicione uma obra a ela e abra o link compartilhado em uma janela sem sessão.
6. Publique uma resenha com spoiler e confirme que o texto só aparece após a ação de revelar.

## Segurança e limitações dos provedores

As tabelas usam RLS. Qualquer visitante pode ler notas/resenhas e coleções públicas; cada usuário só pode alterar a própria avaliação e os próprios dados de estante/coleção. A restrição única é `(user_id, work_kind, work_id)` e a nota tem `CHECK (rating between 1 and 5)`. A SerpApi retorna resultados do Shopping e pode não encontrar ofertas para toda edição; a aplicação não cria preços fictícios. O TMDB pode fornecer categoria e link sem preço; nesses casos é mostrado “Consultar preço no serviço”.
