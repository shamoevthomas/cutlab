// TypeScript's DOM lib ships the video half of WebCodecs only; Chromium has the audio half too.
interface AudioEncoderConfig { codec: string; sampleRate: number; numberOfChannels: number; bitrate?: number }
interface AudioDataInit { format: 'f32-planar' | 'f32' | 's16'; sampleRate: number; numberOfFrames: number; numberOfChannels: number; timestamp: number; data: BufferSource }
declare class AudioData { constructor(init: AudioDataInit); close(): void }
declare class EncodedAudioChunk { readonly byteLength: number; readonly timestamp: number }
interface EncodedAudioChunkMetadata { decoderConfig?: { codec: string; sampleRate: number; numberOfChannels: number; description?: BufferSource } }
declare class AudioEncoder {
  constructor(init: { output: (chunk: EncodedAudioChunk, meta?: EncodedAudioChunkMetadata) => void; error: (e: DOMException) => void });
  static isConfigSupported(cfg: AudioEncoderConfig): Promise<{ supported: boolean; config?: AudioEncoderConfig }>;
  configure(cfg: AudioEncoderConfig): void; encode(d: AudioData): void; flush(): Promise<void>; close(): void;
}
