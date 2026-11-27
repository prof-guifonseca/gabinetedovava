import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_LIVE_VOICE,
  LIVE_OPENING_CUE,
  inferMoodFromText,
  type AvatarMood,
  type RecentTurn,
} from "../shared/persona";

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
}

interface ConnectOptions {
  voice?: string;
  history?: RecentTurn[];
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
  onTranscriptDelta: (role: "user" | "assistant", delta: string) => void;
  onSystemEvent: (text: string) => void;
  onMoodHint: (mood: AvatarMood) => void;
  onUnauthorized?: () => void;
}) {
  const [status, setStatus] = useState<LiveConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
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
  const speakingHoldRef = useRef<number>(0);

  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
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
    setIsMuted(false);
    setIsSpeaking(false);
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
    async ({ voice = DEFAULT_LIVE_VOICE, history = [], accessCode }: ConnectOptions = {}) => {
      cleanup();
      setError(null);
      setStatus("connecting");

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
          }
        };

        const inBuf = new Uint8Array(inAnalyser.frequencyBinCount);
        const outBuf = new Uint8Array(128);

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
            outAnalyser.getByteTimeDomainData(outBuf);
            let outSum = 0;
            for (let i = 0; i < outBuf.length; i++) {
              const v = (outBuf[i] - 128) / 128;
              outSum += v * v;
            }
            const outRms = Math.min(1, Math.sqrt(outSum / outBuf.length) * 4.2);
            setOutputLevel(outRms);

            const now = performance.now();
            if (outRms > 0.055) {
              speakingHoldRef.current = now + 260;
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

            if (type === "session.started") {
              setStatus("live");
              callbacksRef.current.onSystemEvent(
                "Chamada de voz aberta — pode falar normalmente ou interromper o Vavá."
              );
              sendDataEvent({
                type: "session.commentary.append",
                event_id: makeId("open"),
                delegation_id: null,
                content: LIVE_OPENING_CUE,
              });
              return;
            }

            if (
              type === "session.output_transcript.delta" ||
              type === "response.audio_transcript.delta" ||
              type === "response.output_audio_transcript.delta"
            ) {
              const delta = String(msg.delta ?? "");
              if (delta) {
                callbacksRef.current.onTranscriptDelta("assistant", delta);
                const inferred = inferMoodFromText(delta, "falando");
                if (inferred === "crise" || inferred === "acordo") {
                  callbacksRef.current.onMoodHint(inferred);
                }
              }
              return;
            }

            if (
              type === "session.input_transcript.delta" ||
              type === "conversation.item.input_audio_transcription.delta"
            ) {
              const delta = String(msg.delta ?? "");
              if (delta) {
                callbacksRef.current.onTranscriptDelta("user", delta);
              }
              return;
            }

            if (
              type === "conversation.item.input_audio_transcription.completed"
            ) {
              const transcript = String(msg.transcript ?? "");
              if (transcript) {
                callbacksRef.current.onTranscriptDelta("user", transcript);
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
              disconnect("Chamada pausada após 5 minutos. Clique em 'Falar com o Vavá' para continuar.");
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } catch (err) {
        cleanup();
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? "Permissão de microfone negada. Você pode liberar o microfone ou conversar digitando abaixo."
            : err instanceof Error
            ? err.message
            : "Erro desconhecido ao abrir chamada de voz.";
        setError(message);
        setStatus("error");
      }
    },
    [cleanup, disconnect, sendDataEvent]
  );

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    setIsMuted((prev) => {
      const next = !prev;
      for (const track of stream.getAudioTracks()) {
        track.enabled = !next;
      }
      return next;
    });
  }, []);

  const extendSession = useCallback(() => {
    setRemainingSeconds((prev) => Math.min(600, prev + 180));
  }, []);

  const sendLiveTextMessage = useCallback(
    (text: string): boolean => {
      const ok1 = sendDataEvent({
        type: "session.thinking.append",
        event_id: makeId("txt-think"),
        content: `O visitante mandou esta mensagem no chat: "${text}". Responda agora em voz alta, curto e cortante (1 a 2 frases, ~180 caracteres), 100% no personagem Vavá sem prudência nem moderação.`,
      });
      const ok2 = sendDataEvent({
        type: "session.commentary.append",
        event_id: makeId("txt-comm"),
        delegation_id: null,
        content: `Responda em voz alta, no personagem Vavá sem filtro, à fala do visitante: "${text}"`,
      });
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
    isSpeaking,
    outputLevel,
    inputLevel,
    remainingSeconds,
    connect,
    disconnect,
    toggleMute,
    extendSession,
    sendLiveTextMessage,
  };
}

export { formatNow, makeId };
