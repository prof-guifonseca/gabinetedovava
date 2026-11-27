# Gabinete do Vavá

Interface web de diálogo escrito e por voz ao vivo com o personagem satírico 100% ficcional **Dep. Dr. Valdemar "Vavá" Braga (PGB/DF)** — Centrão raiz analógico, onde a mamatinha vem antes da tecnologia.

**Produção (Cloudflare Pages):** https://gabinetedovava.pages.dev

## Arquitetura

- **Frontend:** React 19 + Vite + CSS customizado (avatar reativo em 4 humores + chat limpo sem spoilers)
- **Backend:** Hono em **Cloudflare Pages Functions / Workers** (`worker/index.ts`)
- **Chat escrito (`POST /api/chat`):** OpenAI Responses API com **`gpt-6-luna`** (respostas curtas e adaptativas)
- **Voz ao vivo (`POST /api/live/session`):** OpenAI **`gpt-live-1.1`** full-duplex via WebRTC com voz masculina brasileira madura customizada via Prompt-to-Voice (`voice_...`)

## Rodando localmente

1. Copie `.dev.vars.example` para `.dev.vars` e informe sua `OPENAI_API_KEY`:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
2. Instale dependências e rode o servidor de desenvolvimento:
   ```bash
   npm install
   npm run dev
   ```
3. Validação e testes:
   ```bash
   npm run check
   npm test
   npm run build
   ```

## Variáveis de ambiente (Cloudflare Pages)

- `OPENAI_API_KEY` *(Secret)* — chave da OpenAI
- `GPT_LIVE_MODEL` — padrão `gpt-live-1.1`
- `OPENAI_TEXT_MODEL` — padrão `gpt-6-luna`
- `DEFAULT_VOICE` — `voice_...` (Prompt-to-Voice) ou preset nativo (`tempo`, `bossa`)
- `ACCESS_CODE` *(Opcional)* — senha de acesso ao gabinete
