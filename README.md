# Gabinete do Vavá 2.0

Simulador satírico de balcão político e audiência ao vivo (chat escrito com streaming + voz full-duplex) com o personagem 100% ficcional **Dep. Dr. Valdemar "Vavá" Braga (PMD/DF)** — Centrão raiz analógico, no Gabinete 412 do Anexo IV em Brasília.

**Produção (Cloudflare Pages):** https://gabinetedovava.pages.dev

## O que há de novo na versão 2.0

- **Arquitetura Dual-Brain (`gpt-6-luna` + `gpt-live-1.1`):**
  - Chat escrito via **SSE streaming** (`POST /api/chat`) + **AI Director** estruturado (`POST /api/director`) com JSON Schema estrito e fallback heurístico.
  - Voz ao vivo full-duplex WebRTC com **Standby Mode** (`wake_policy: speech`, `idle_timeout_s: 20`), deduplicação de transcrições, **injeção de eventos de bastidor ao vivo** (`session.instructions.append` + `session.commentary.append`) e **corte real do microfone** quando o Vavá aciona a Taquigrafia.
- **Motor Lúdico & 5 Crachás/Missões:** *Visita de Cortesia (Livre)*, *Operação Emenda PIX*, *Sabatinado na CPI*, *Salve a Restinga* e *Caça ao Cargo (DAS-6)* — com 4 medidores diegéticos (Apoio da Base, Risco de CPI, Emendas Liberadas, Paciência), progressão em 3 Atos, anti-repetição algorítmica (*Trope Cooldown*) e interrupções da Dona Neide / TCU / TV Câmara.
- **Documentos Oficiais & Fábrica de Cards PNG para WhatsApp:** Emendas de Relator com jabutis ocultos confrontáveis, Portarias no Diário Oficial da União (DOU), Dossiês da Gaveta, botão **"Aspas"** em cada fala e **Ata Final da Audiência** exportáveis em PNG 1080×1080.
- **Identidade 100% Brasília Analógica + Sound Design Procedural:** 6 retratos analógicos consistentes (`neutro`, `falando`, `acordo`, `crise`, `sussurro`, `telefone`) e sintetizador Web Audio (martelo de madeira, carimbo, corte de microfone, telefone fixo, interfone e plantão).

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

## Variáveis de ambiente (Cloudflare Pages / Workers)

- `OPENAI_API_KEY` *(Secret)* — chave da OpenAI
- `GPT_LIVE_MODEL` — padrão `gpt-live-1.1`
- `OPENAI_TEXT_MODEL` — padrão `gpt-6-luna`
- `DEFAULT_VOICE` — `voice_...` (Prompt-to-Voice) ou preset nativo (`tempo`, `bossa`)
- `ACCESS_CODE` *(Opcional)* — senha da portaria do gabinete
