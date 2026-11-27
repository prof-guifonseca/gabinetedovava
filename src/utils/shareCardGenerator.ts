import {
  classifyVisitorArchetype,
  type AvatarMood,
  type CabinetDocument,
  type SessionLedger,
} from "../shared/gameState";
import { SCENARIOS } from "../shared/scenarios";

const AVATAR_PATHS: Record<AvatarMood, string> = {
  neutro: "/avatars/vava-neutro.jpg",
  falando: "/avatars/vava-falando.jpg",
  acordo: "/avatars/vava-acordo.jpg",
  crise: "/avatars/vava-crise.jpg",
  sussurro: "/avatars/vava-sussurro.jpg",
  telefone: "/avatars/vava-telefone.jpg",
};

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;!?]*$/, "")}…`;
  }
  return lines;
}

function drawStamp(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = "#b91c1c",
  angleRad = -0.14
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);
  ctx.font = '700 32px "IBM Plex Mono", monospace';
  const width = ctx.measureText(text).width + 44;
  const height = 62;
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.lineWidth = 2;
  ctx.strokeRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 12);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 0, 2);
  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Falha ao renderizar PNG."));
    }, "image/png");
  });
}

async function ensureFontsReady(): Promise<void> {
  try {
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // proceed with fallback fonts
  }
}

export async function generateQuoteCard(params: {
  quote: string;
  mood: AvatarMood;
  badge?: string;
}): Promise<Blob> {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;

  // Background jacaranda
  const bg = ctx.createLinearGradient(0, 0, 0, 1080);
  bg.addColorStop(0, "#19120e");
  bg.addColorStop(1, "#0d0907");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1080);

  // Portrait top half
  const img = await loadImage(AVATAR_PATHS[params.mood] || AVATAR_PATHS.neutro);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(56, 56, 968, 520);
    ctx.clip();
    const scale = Math.max(968 / img.width, 520 / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    ctx.drawImage(
      img,
      56 + (968 - drawW) / 2,
      56 + (520 - drawH) * 0.2,
      drawW,
      drawH
    );
    const fade = ctx.createLinearGradient(0, 340, 0, 580);
    fade.addColorStop(0, "rgba(18, 12, 9, 0)");
    fade.addColorStop(1, "rgba(18, 12, 9, 0.96)");
    ctx.fillStyle = fade;
    ctx.fillRect(56, 340, 968, 240);
    ctx.restore();
  }

  // Brass border around card
  ctx.strokeStyle = "#c89b3c";
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, 1008, 1008);

  // TV Câmara live badge
  ctx.fillStyle = "#b91c1c";
  ctx.fillRect(82, 82, 340, 44);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 20px "IBM Plex Mono", monospace';
  ctx.fillText("● AO VIVO • TV CÂMARA", 102, 111);

  if (params.badge) {
    ctx.fillStyle = "rgba(13, 59, 46, 0.92)";
    ctx.fillRect(720, 82, 278, 44);
    ctx.strokeStyle = "#d4a843";
    ctx.lineWidth = 2;
    ctx.strokeRect(720, 82, 278, 44);
    ctx.fillStyle = "#f4e6c2";
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.textAlign = "center";
    ctx.fillText(params.badge.toUpperCase().slice(0, 22), 859, 111);
    ctx.textAlign = "left";
  }

  // Quote body
  ctx.fillStyle = "#d4a843";
  ctx.font = '700 84px "Newsreader", Georgia, serif';
  ctx.fillText("“", 76, 638);

  ctx.fillStyle = "#f7f1e3";
  ctx.font = '600 40px "Newsreader", Georgia, serif';
  const lines = wrapText(ctx, params.quote, 880, 6);
  lines.forEach((line, idx) => {
    ctx.fillText(line, 112, 636 + idx * 54);
  });

  // Footer nameplate
  ctx.fillStyle = "#0d3b2e";
  ctx.fillRect(56, 916, 968, 96);
  ctx.strokeStyle = "#d4a843";
  ctx.lineWidth = 2;
  ctx.strokeRect(56, 916, 968, 96);

  ctx.fillStyle = "#f5ecd7";
  ctx.font = '700 28px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('Dep. Dr. Valdemar "Vavá" Braga (PMD/DF)', 84, 956);

  ctx.fillStyle = "#d4a843";
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillText("PRESIDENTE DA CÂMARA • GABINETE 412", 84, 990);

  ctx.fillStyle = "#d7e6de";
  ctx.textAlign = "right";
  ctx.fillText("gabinetedovava.pages.dev", 996, 976);
  ctx.textAlign = "left";

  return canvasToBlob(canvas);
}

export async function generateDocumentCard(doc: CabinetDocument): Promise<Blob> {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;

  // Aged official paper texture
  ctx.fillStyle = "#f4eedc";
  ctx.fillRect(0, 0, 1080, 1080);

  // Subtle paper frame
  ctx.strokeStyle = "#2b2118";
  ctx.lineWidth = 6;
  ctx.strokeRect(42, 42, 996, 996);
  ctx.strokeStyle = "#8a6d3b";
  ctx.lineWidth = 2;
  ctx.strokeRect(56, 56, 968, 968);

  // Header
  ctx.fillStyle = "#1c1510";
  ctx.textAlign = "center";
  ctx.font = '700 22px "IBM Plex Mono", monospace';
  ctx.fillText("REPÚBLICA SATÍRICA DO BALCÃO • BRASÍLIA - DF", 540, 114);

  const isEmenda = doc.action.type === "carimbar_emenda";
  const isDou = doc.action.type === "nomear_dou";

  ctx.font = '700 44px "Newsreader", Georgia, serif';
  ctx.fillText(
    isDou
      ? "DIÁRIO OFICIAL DA UNIÃO — SEÇÃO 2"
      : isEmenda
      ? "EMENDA DE RELATOR (URGÊNCIA)"
      : "GAVETA DA PRESIDÊNCIA — CONFIDENCIAL",
    540,
    172
  );

  ctx.fillStyle = "#5c4c3a";
  ctx.font = '500 20px "IBM Plex Mono", monospace';
  ctx.fillText(
    `GABINETE 412 • ANEXO IV • REGISTRO ${doc.createdAt} • SÁTIRA FICCIONAL`,
    540,
    212
  );

  ctx.strokeStyle = "#2b2118";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(90, 236);
  ctx.lineTo(990, 236);
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.fillStyle = "#1c1510";

  if (doc.action.type === "carimbar_emenda") {
    ctx.font = '700 26px "IBM Plex Mono", monospace';
    ctx.fillText(`PROTOCOLO: ${doc.action.protocolo}`, 96, 296);

    ctx.fillStyle = "#0d3b2e";
    ctx.font = '700 68px "Newsreader", Georgia, serif';
    ctx.fillText(`R$ ${doc.action.valorMilhoes},0 MILHÕES`, 96, 386);

    ctx.fillStyle = "#1c1510";
    ctx.font = '600 32px "Newsreader", Georgia, serif';
    const destLines = wrapText(
      ctx,
      `DESTINO DECLARADO: ${doc.action.destino}`,
      880,
      3
    );
    destLines.forEach((l, i) => ctx.fillText(l, 96, 464 + i * 44));

    // Fine print jabuti box
    ctx.fillStyle = "#ebe1c7";
    ctx.fillRect(96, 636, 888, 196);
    ctx.strokeStyle = "#b91c1c";
    ctx.lineWidth = 2;
    ctx.strokeRect(96, 636, 888, 196);

    ctx.fillStyle = "#b91c1c";
    ctx.font = '700 20px "IBM Plex Mono", monospace';
    ctx.fillText("PARÁGRAFO ÚNICO (JABUTI TÉCNICO INSERIDO ÀS 03h14):", 118, 676);

    ctx.fillStyle = "#33261b";
    ctx.font = '500 24px "IBM Plex Mono", monospace';
    const jabLines = wrapText(ctx, doc.action.jabutiOculto, 844, 4);
    jabLines.forEach((l, i) => ctx.fillText(l, 118, 718 + i * 32));

    drawStamp(ctx, "CARIMBADO EM URGÊNCIA", 760, 415, "#b91c1c", -0.15);
  } else if (doc.action.type === "nomear_dou") {
    ctx.font = '700 24px "IBM Plex Mono", monospace';
    ctx.fillText(`PORTARIA Nº 4.171/PMD • CARGO ${doc.action.simbolo}`, 96, 298);

    ctx.font = '700 36px "Newsreader", Georgia, serif';
    const bodyText = `O PRESIDENTE DA CÂMARA DOS DEPUTADOS, no uso de suas atribuições de balcão e consenso regimental, RESOLVE NOMEAR ${doc.action.nomeado.toUpperCase()} para exercer o cargo em comissão de ${doc.action.cargo}, código ${doc.action.simbolo}, com remuneração mensal de ${doc.action.salarioMensal}.`;
    const bodyLines = wrapText(ctx, bodyText, 880, 7);
    bodyLines.forEach((l, i) => ctx.fillText(l, 96, 368 + i * 48));

    ctx.fillStyle = "#4d3e30";
    ctx.font = 'italic 26px "Newsreader", Georgia, serif';
    const justLines = wrapText(
      ctx,
      `Justificativa oficial: "${doc.action.justificativa}"`,
      880,
      3
    );
    justLines.forEach((l, i) => ctx.fillText(l, 96, 738 + i * 36));

    drawStamp(ctx, "PUBLICADO NO DOU", 760, 780, "#0d3b2e", -0.12);
  } else {
    ctx.fillStyle = "#b91c1c";
    ctx.font = '700 34px "Newsreader", Georgia, serif';
    const titleLines = wrapText(ctx, doc.action.titulo, 880, 2);
    titleLines.forEach((l, i) => ctx.fillText(l, 96, 314 + i * 44));

    ctx.fillStyle = "#1c1510";
    ctx.font = '500 30px "Newsreader", Georgia, serif';
    const resLines = wrapText(ctx, doc.action.resumo, 880, 5);
    resLines.forEach((l, i) => ctx.fillText(l, 96, 444 + i * 42));

    ctx.fillStyle = "#5c1b1b";
    ctx.font = '700 24px "IBM Plex Mono", monospace';
    const threatLines = wrapText(
      ctx,
      `CONTRA-ATAQUE NA GAVETA: ${doc.action.ameaca}`,
      880,
      4
    );
    threatLines.forEach((l, i) => ctx.fillText(l, 96, 690 + i * 34));

    drawStamp(ctx, "CONFIDENCIAL", 780, 320, "#b91c1c", 0.14);
  }

  // Signature line
  ctx.strokeStyle = "#2b2118";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(96, 932);
  ctx.lineTo(540, 932);
  ctx.stroke();

  ctx.fillStyle = "#1c1510";
  ctx.font = '700 22px "Newsreader", Georgia, serif';
  ctx.fillText('Dep. Dr. Valdemar "Vavá" Braga — Presidente', 96, 966);

  ctx.fillStyle = "#6e5a44";
  ctx.font = '600 20px "IBM Plex Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText("gabinetedovava.pages.dev", 984, 966);
  ctx.textAlign = "left";

  return canvasToBlob(canvas);
}

export async function generateDossierCard(ledger: SessionLedger): Promise<Blob> {
  await ensureFontsReady();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;

  const arch = classifyVisitorArchetype(ledger);
  const scenario = SCENARIOS[ledger.scenarioId] ?? SCENARIOS.livre;

  // Dark mahogany + emerald congressional card
  const bg = ctx.createLinearGradient(0, 0, 1080, 1080);
  bg.addColorStop(0, "#17110d");
  bg.addColorStop(1, "#0b241c");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.strokeStyle = "#d4a843";
  ctx.lineWidth = 4;
  ctx.strokeRect(36, 36, 1008, 1008);

  // Header
  ctx.fillStyle = "#d4a843";
  ctx.font = '700 22px "IBM Plex Mono", monospace';
  ctx.fillText(
    `ATA DA AUDIÊNCIA • ${scenario.title.toUpperCase()} • GABINETE 412`,
    76,
    102
  );

  // Small portrait right
  const mood = ledger.bestQuote?.mood || "acordo";
  const img = await loadImage(AVATAR_PATHS[mood] || AVATAR_PATHS.neutro);
  if (img) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(756, 76, 248, 248, 16);
    ctx.clip();
    ctx.drawImage(img, 756, 76, 248, 248);
    ctx.restore();
    ctx.strokeStyle = "#d4a843";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(756, 76, 248, 248, 16);
    ctx.stroke();
  }

  // Archetype headline
  ctx.fillStyle = "#f7f1e3";
  ctx.font = '700 54px "Newsreader", Georgia, serif';
  const titleLines = wrapText(ctx, arch.title, 640, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 76, 178 + i * 62));

  ctx.fillStyle = "#c9bca7";
  ctx.font = '500 26px "Plus Jakarta Sans", system-ui, sans-serif';
  const subLines = wrapText(ctx, arch.subtitle, 640, 3);
  subLines.forEach((l, i) => ctx.fillText(l, 76, 304 + i * 36));

  // 4 Meters Grid
  const stats = [
    { label: "APOIO DA BASE", value: `${ledger.meters.apoioBase}%`, color: "#28b47c" },
    { label: "RISCO DE CPI", value: `${ledger.meters.riscoCpi}%`, color: "#e04f5f" },
    { label: "VERBA LIBERADA", value: `R$ ${ledger.meters.verbaMilhoes}M`, color: "#d4a843" },
    { label: "JABUTIS ENGOLIDOS", value: `${ledger.jabutisEngolidos}`, color: "#e5c17b" },
  ];

  stats.forEach((st, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 76 + col * 474;
    const y = 420 + row * 124;
    ctx.fillStyle = "rgba(255, 248, 232, 0.05)";
    ctx.fillRect(x, y, 454, 102);
    ctx.strokeStyle = "rgba(212, 168, 67, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, 454, 102);

    ctx.fillStyle = "#b5a690";
    ctx.font = '600 18px "IBM Plex Mono", monospace';
    ctx.fillText(st.label, x + 22, y + 36);

    ctx.fillStyle = st.color;
    ctx.font = '700 42px "IBM Plex Mono", monospace';
    ctx.fillText(st.value, x + 22, y + 84);
  });

  // Best quote
  const quoteText =
    ledger.bestQuote?.text ||
    "Na política, meu caro, a gente estabelece consensos pra todo mundo sair maior do que entrou!";
  ctx.fillStyle = "rgba(13, 59, 46, 0.48)";
  ctx.fillRect(76, 686, 928, 210);
  ctx.strokeStyle = "rgba(212, 168, 67, 0.45)";
  ctx.strokeRect(76, 686, 928, 210);

  ctx.fillStyle = "#d4a843";
  ctx.font = '700 18px "IBM Plex Mono", monospace';
  ctx.fillText("ASPAS DE DESTAQUE DA TAQUIGRAFIA:", 104, 724);

  ctx.fillStyle = "#f7f1e3";
  ctx.font = 'italic 30px "Newsreader", Georgia, serif';
  const qLines = wrapText(ctx, `“${quoteText}”`, 872, 4);
  qLines.forEach((l, i) => ctx.fillText(l, 104, 770 + i * 38));

  drawStamp(ctx, arch.stamp, 810, 954, "#d4a843", -0.08);

  ctx.fillStyle = "#c9bca7";
  ctx.font = '600 22px "IBM Plex Mono", monospace';
  ctx.fillText("gabinetedovava.pages.dev", 76, 976);

  return canvasToBlob(canvas);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyImageOrDownload(
  blob: Blob,
  filename: string
): Promise<"copied" | "downloaded"> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      "write" in navigator.clipboard &&
      typeof ClipboardItem !== "undefined"
    ) {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      return "copied";
    }
  } catch {
    // fall back to download
  }
  downloadBlob(blob, filename);
  return "downloaded";
}

export async function shareImageNativeOrCopy(
  blob: Blob,
  filename: string,
  title = "Gabinete do Vavá",
  text = "Olha o que o Dr. Vavá aprontou no Gabinete 412: https://gabinetedovava.pages.dev"
): Promise<"shared" | "copied" | "downloaded"> {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof File !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      const file = new File([blob], filename, { type: "image/png" });
      if (
        typeof navigator.canShare === "function" &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({ files: [file], title, text });
        return "shared";
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return "shared";
    }
  }
  return copyImageOrDownload(blob, filename);
}
