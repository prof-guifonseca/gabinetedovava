import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LIVE_VOICE,
  LIVE_OPENING_CUE,
  inferMoodFromText,
  type AvatarMood,
  type RecentTurn,
} from "../shared/persona";
import type { SessionLedger } from "../shared/gameState";

export type LiveConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "error";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  source: "live" | "text";
  timestamp: string;
  mood?: AvatarMood;
  itemKey?: string;
}

interface ConnectOptions {
  voice?: string;
  history?: RecentTurn[];
  ledger?: SessionLedger;
  openingCue?: string;
  accessCode?: string;
}

const SESSION_DURATION_SEC = 300;

function formatNow(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 2500
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      pc.removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    }, timeoutMs);

    function onStateChange() {
      if (pc.iceGatheringState === "complete") {
        window.clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", onStateChange);
        resolve();
      }
    }

    pc.addEventListener("icegatheringstatechange", onStateChange);
  });
}

export function useGptLiveSession(options: {
  onTranscriptDelta: (
    role: "user" | "assistant",
    delta: string,
    itemKey?: string,
    replaceFull?: boolean
  ) => void;
  onSystemEvent: (text: string) => void;
  onMoodHint: (mood: AvatarMood) => void;
  onLiveTurnComplete?: (userText: string, assistantText: string) => void;
  onUnauthorized?: () => void;
}) {
  const [status, setStatus] = useState<LiveConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isForceMuted, setIsForceMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStandby, setIsStandby] = useState(false);
  const [outputLevel, setOutputLevel] = useState(0);
  const [inputLevel, setInputLevel] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(SESSION_DURATION_SEC);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const forceMuteTimerRef = useRef<number | null>(null);
  const speakingHoldRef = useRef<number>(0);
  const userMutedPrefRef = useRef<boolean>(false);
  const openingCueRef = useRef<string>(LIVE_OPENING_CUE);

  // Accumulated turn buffers (fixes fragmented-delta regex & duplicate input transcripts)
  const lastUserUtteranceRef = useRef<string>("");
  const currentAssistantUtteranceRef = useRef<string>("");
  const inputDeltaItemIdsRef = useRef<Set<string>>(new Set());
  const turnFlushTimerRef = useRef<number | null>(null);

  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const flushCompletedLiveTurn = useCallback(() => {
    if (turnFlushTimerRef.current !== null) {
      window.clearTimeout(turnFlushTimerRef.current);
      turnFlushTimerRef.current = null;
    }
    const assistantText = currentAssistantUtteranceRef.current.trim();
    if (assistantText.length < 8) return;
    const userText = lastUserUtteranceRef.current.trim();
    currentAssistantUtteranceRef.current = "";
    callbacksRef.current.onLiveTurnComplete?.(userText, assistantText);
  }, []);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (forceMuteTimerRef.current !== null) {
      window.clearTimeout(forceMuteTimerRef.current);
      forceMuteTimerRef.current = null;
    }
    if (turnFlushTimerRef.current !== null) {
      window.clearTimeout(turnFlushTimerRef.current);
      turnFlushTimerRef.current = null;
    }
    if (dcRef.current) {
      try {
        dcRef.current.close();
      } catch {
        // ignore
      }
      dcRef.current = null;
    }
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {
        // ignore
      }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    userMutedPrefRef.current = false;
    lastUserUtteranceRef.current = "";
    currentAssistantUtteranceRef.current = "";
    inputDeltaItemIdsRef.current.clear();
    setIsMuted(false);
    setIsForceMuted(false);
    setIsSpeaking(false);
    setIsStandby(false);
    setOutputLevel(0);
    setInputLevel(0);
    setRemainingSeconds(SESSION_DURATION_SEC);
  }, []);

  const disconnect = useCallback(
    (reason?: string) => {
      cleanup();
      setStatus("idle");
      if (reason) {
        callbacksRef.current.onSystemEvent(reason);
      }
    },
    [cleanup]
  );

  const sendDataEvent = useCallback((payload: Record<string, unknown>): boolean => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(
    async ({
      voice = DEFAULT_LIVE_VOICE,
      history = [],
      ledger,
      openingCue = LIVE_OPENING_CUE,
      accessCode,
    }: ConnectOptions = {}) => {
      cleanup();
      setError(null);
      setStatus("connecting");
      openingCueRef.current = openingCue;

      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioCtx = new AudioCtx();
        await audioCtx.resume().catch(() => {});
        audioCtxRef.current = audioCtx;

        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        localStreamRef.current = localStream;

        const inSource = audioCtx.createMediaStreamSource(localStream);
        const inAnalyser = audioCtx.createAnalyser();
        inAnalyser.fftSize = 256;
        inSource.connect(inAnalyser);

        let outAnalyser: AnalyserNode | null = null;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        for (const track of localStream.getTracks()) {
          pc.addTrack(track, localStream);
        }

        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.setAttribute("playsinline", "true");
        audioElRef.current = audioEl;

        pc.ontrack = (event) => {
          const remoteStream = event.streams[0];
          if (!remoteStream) return;
          audioEl.srcObject = remoteStream;
          audioEl.play().catch(() => {});
          try {
            const outSource = audioCtx.createMediaStreamSource(remoteStream);
            outAnalyser = audioCtx.createAnalyser();
            outAnalyser.fftSize = 256;
            outAnalyser.smoothingTimeConstant = 0.65;
            outSource.connect(outAnalyser);
          } catch {
            // fallback if remote stream cannot bind to WebAudio
          }
        };

        pc.onconnectionstatechange = () => {
          if (
            pc.connectionState === "failed" ||
            pc.connectionState === "closed"
          ) {
            setStatus("idle");
            setIsStandby(false);
          }
        };

        const inBuf = new Uint8Array(inAnalyser.frequencyBinCount);
        const outTimeBuf = new Uint8Array(128);
        const outFreqBuf = new Uint8Array(128);

        const meterLoop = () => {
          if (!pcRef.current) return;

          inAnalyser.getByteTimeDomainData(inBuf);
          let inSum = 0;
          for (let i = 0; i < inBuf.length; i++) {
            const v = (inBuf[i] - 128) / 128;
            inSum += v * v;
          }
          setInputLevel(Math.min(1, Math.sqrt(inSum / inBuf.length) * 3.8));

          if (outAnalyser) {
            outAnalyser.getByteTimeDomainData(outTimeBuf);
            outAnalyser.getByteFrequencyData(outFreqBuf);

            let outSum = 0;
            for (let i = 0; i < outTimeBuf.length; i++) {
              const v = (outTimeBuf[i] - 128) / 128;
              outSum += v * v;
            }
            const rms = Math.sqrt(outSum / outTimeBuf.length) * 4.2;

            // Voice-band emphasis (~300Hz-3kHz) for expressive stage animation
            let voiceBandSum = 0;
            const startBin = 2;
            const endBin = Math.min(26, outFreqBuf.length);
            for (let i = startBin; i < endBin; i++) {
              voiceBandSum += outFreqBuf[i] / 255;
            }
            const voiceBand = voiceBandSum / Math.max(1, endBin - startBin);
            const blended = Math.min(1, rms * 0.65 + voiceBand * 0.55);
            setOutputLevel(blended);

            const now = performance.now();
            if (blended > 0.055) {
              speakingHoldRef.current = now + 280;
              setIsSpeaking(true);
            } else if (now > speakingHoldRef.current) {
              setIsSpeaking(false);
            }
          }

          rafRef.current = requestAnimationFrame(meterLoop);
        };
        rafRef.current = requestAnimationFrame(meterLoop);

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;

        dc.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as Record<string, unknown>;
            const type = String(msg.type ?? "");
            const itemKey = String(
              msg.item_id ?? msg.response_id ?? msg.utterance_id ?? ""
            ) || undefined;

            if (type === "session.started") {
              setStatus("live");
              setIsStandby(false);
              callbacksRef.current.onSystemEvent(
                "Microfone de mesa aberto — fale à vontade ou interrompa o Presidente."
              );
              sendDataEvent({
                type: "session.commentary.append",
                event_id: makeId("open"),
                delegation_id: null,
                content: openingCueRef.current,
              });
              return;
            }

            if (type === "session.paused") {
              setIsStandby(true);
              return;
            }

            if (type === "session.resumed") {
              setIsStandby(false);
              return;
            }

            // Assistant speech transcript deltas
            if (
              type === "session.output_transcript.delta" ||
              type === "response.audio_transcript.delta" ||
              type === "response.output_audio_transcript.delta"
            ) {
              const delta = String(msg.delta ?? "");
              if (delta) {
                setIsStandby(false);
                currentAssistantUtteranceRef.current += delta;
                callbacksRef.current.onTranscriptDelta(
                  "assistant",
                  delta,
                  itemKey ? `ast-${itemKey}` : undefined,
                  false
                );

                // Analyze ACCUMULATED phrase (fixes fragmented delta regex bug!)
                const inferred = inferMoodFromText(
                  currentAssistantUtteranceRef.current,
                  "falando"
                );
                if (inferred !== "falando") {
                  callbacksRef.current.onMoodHint(inferred);
                }

                // Debounced fallback flush in case no explicit .done event arrives
                if (turnFlushTimerRef.current !== null) {
                  window.clearTimeout(turnFlushTimerRef.current);
                }
                turnFlushTimerRef.current = window.setTimeout(
                  flushCompletedLiveTurn,
                  1800
                );
              }
              return;
            }

            // Assistant turn completion events
            if (
              type === "session.output_transcript.done" ||
              type === "response.audio_transcript.done" ||
              type === "response.output_audio_transcript.done" ||
              type === "response.done"
            ) {
              if (
                typeof msg.transcript === "string" &&
                msg.transcript.trim() &&
                !currentAssistantUtteranceRef.current.trim()
              ) {
                currentAssistantUtteranceRef.current = msg.transcript.trim();
                callbacksRef.current.onTranscriptDelta(
                  "assistant",
                  msg.transcript.trim(),
                  itemKey ? `ast-${itemKey}` : undefined,
                  true
                );
              }
              flushCompletedLiveTurn();
              return;
            }

            // User speech transcript deltas (deduplicated against .completed!)
            if (
              type === "session.input_transcript.delta" ||
              type === "conversation.item.input_audio_transcription.delta"
            ) {
              const delta = String(msg.delta ?? "");
              if (delta) {
                setIsStandby(false);
                const key = itemKey ? `usr-${itemKey}` : "usr-active";
                inputDeltaItemIdsRef.current.add(key);
                lastUserUtteranceRef.current += delta;
                callbacksRef.current.onTranscriptDelta("user", delta, key, false);
              }
              return;
            }

            if (
              type === "session.input_transcript.done" ||
              type === "conversation.item.input_audio_transcription.completed"
            ) {
              const transcript = String(msg.transcript ?? "").trim();
              const key = itemKey ? `usr-${itemKey}` : "usr-active";
              if (transcript) {
                lastUserUtteranceRef.current = transcript;
                // Replace cleanly if deltas arrived for this item, otherwise append once
                const hadDeltas = inputDeltaItemIdsRef.current.has(key);
                inputDeltaItemIdsRef.current.delete(key);
                callbacksRef.current.onTranscriptDelta(
                  "user",
                  transcript,
                  key,
                  hadDeltas
                );
              }
              return;
            }

            if (type === "error" || type === "session.error") {
              const errObj = msg.error as { message?: string } | undefined;
              const detail = errObj?.message || JSON.stringify(msg).slice(0, 220);
              setError(`Erro na chamada de voz: ${detail}`);
            }
          } catch {
            // ignore non-JSON frames
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitForIceGathering(pc);

        const localSdp = pc.localDescription?.sdp || offer.sdp;
        if (!localSdp) {
          throw new Error("Não foi possível iniciar a conexão WebRTC.");
        }

        const res = await fetch("/api/live/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sdp: localSdp,
            voice,
            history,
            ledger,
            accessCode,
          }),
        });

        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
          transport?: { sdp?: string };
        };

        if (res.status === 401) {
          cleanup();
          setStatus("idle");
          setError("Senha de gabinete inválida.");
          callbacksRef.current.onUnauthorized?.();
          return;
        }

        if (!res.ok || !data.transport?.sdp) {
          throw new Error(
            data.error
              ? `${data.error}${data.detail ? ` (${data.detail})` : ""}`
              : `Falha HTTP ${res.status} ao conectar voz.`
          );
        }

        await pc.setRemoteDescription({
          type: "answer",
          sdp: data.transport.sdp,
        });

        setStatus("live");
        setRemainingSeconds(SESSION_DURATION_SEC);

        timerRef.current = window.setInterval(() => {
          setRemainingSeconds((prev) => {
            if (prev <= 1) {
              disconnect(
                "Sessão de voz pausada após 5 minutos. Clique em 'Falar com o Vavá' para retomar."
              );
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (err) {
        cleanup();
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Permissão de microfone negada. Você pode liberar o microfone ou conversar digitando ao lado."
            : err instanceof Error
            ? err.message
            : "Erro desconhecido ao abrir chamada de voz.";
        setError(message);
        setStatus("error");
      }
    },
    [cleanup, disconnect, flushCompletedLiveTurn, sendDataEvent]
  );

  const toggleMute = useCallback(() => {
    if (isForceMuted) return;
    const stream = localStreamRef.current;
    if (!stream) return;
    setIsMuted((prev) => {
      const next = !prev;
      userMutedPrefRef.current = next;
      for (const track of stream.getAudioTracks()) {
        track.enabled = !next;
      }
      return next;
    });
  }, [isForceMuted]);

  /** Corta fisicamente o microfone do visitante quando Vavá aciona a Taquigrafia! */
  const forceMuteFor = useCallback((seconds: number) => {
    const stream = localStreamRef.current;
    setIsForceMuted(true);
    setIsMuted(true);
    if (stream) {
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
      }
    }

    if (forceMuteTimerRef.current !== null) {
      window.clearTimeout(forceMuteTimerRef.current);
    }

    forceMuteTimerRef.current = window.setTimeout(() => {
      forceMuteTimerRef.current = null;
      setIsForceMuted(false);
      const restoreMuted = userMutedPrefRef.current;
      setIsMuted(restoreMuted);
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getAudioTracks()) {
          track.enabled = !restoreMuted;
        }
      }
    }, Math.max(2000, seconds * 1000));
  }, []);

  const extendSession = useCallback(() => {
    setRemainingSeconds((prev) => Math.min(600, prev + 180));
  }, []);

  /** Envia texto digitado/Carta na Manga para o Vavá responder ao vivo (schema válido com delegation_id: null) */
  const sendLiveTextMessage = useCallback(
    (text: string): boolean => {
      lastUserUtteranceRef.current = text;
      setIsStandby(false);
      return sendDataEvent({
        type: "session.commentary.append",
        event_id: makeId("txt-comm"),
        delegation_id: null,
        content: `O visitante acabou de dizer na sua frente: "${text}". Responda agora em voz alta (1 a 2 frases curtas, ~180 caracteres), 100% no personagem Vavá sem filtro.`,
      });
    },
    [sendDataEvent]
  );

  /** Injeta eventos de bastidor (Dona Neide / TCU / Painel do Plenário) AO VIVO no meio da chamada! */
  const injectLiveEvent = useCallback(
    (instruction: string, commentary?: string): boolean => {
      const ok1 = sendDataEvent({
        type: "session.instructions.append",
        event_id: makeId("dir-inst"),
        content: instruction.slice(0, 900),
      });
      const ok2 = commentary
        ? sendDataEvent({
            type: "session.commentary.append",
            event_id: makeId("dir-comm"),
            delegation_id: null,
            content: commentary.slice(0, 500),
          })
        : false;
      return ok1 || ok2;
    },
    [sendDataEvent]
  );

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    status,
    error,
    isMuted,
    isForceMuted,
    isSpeaking,
    isStandby,
    outputLevel,
    inputLevel,
    remainingSeconds,
    connect,
    disconnect,
    toggleMute,
    forceMuteFor,
    extendSession,
    sendLiveTextMessage,
    injectLiveEvent,
  };
}

export { formatNow, makeId };
