/**
 * Audio Extraction Utility
 * Extracts audio from video files using OfflineAudioContext for high-speed processing
 * and converts to 16kHz Mono WAV.
 */

export interface AudioExtractionProgress {
    stage: 'decoding' | 'resampling' | 'encoding' | 'complete';
    progress: number; // 0-100
    message: string;
}

export interface AudioExtractionResult {
    blob: Blob;
    duration: number;
    sizeBytes: number;
    format: string;
}

/**
 * Extract audio from video file using OfflineAudioContext
 * @param videoFile - Video file to extract audio from
 * @param onProgress - Progress callback
 * @returns Extracted audio as WAV Blob (16kHz Mono)
 */
export async function extractAudioFromVideo(
    videoFile: File,
    onProgress: (progress: AudioExtractionProgress) => void
): Promise<AudioExtractionResult> {

    onProgress({ stage: 'decoding', progress: 0, message: '動画を読み込んでいます...' });

    // 1. Read file as ArrayBuffer
    const arrayBuffer = await videoFile.arrayBuffer();

    // 2. Decode Audio Data
    const audioContext = new AudioContext();
    onProgress({ stage: 'decoding', progress: 20, message: '音声をデコード中...' });

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // 3. Resample to 16kHz Mono using OfflineAudioContext
        const targetSampleRate = 16000;
        const duration = audioBuffer.duration;
        const offlineContext = new OfflineAudioContext(1, duration * targetSampleRate, targetSampleRate);

        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start();

        onProgress({ stage: 'resampling', progress: 50, message: '16kHzに変換中...' });

        const renderedBuffer = await offlineContext.startRendering();

        // 4. Encode to WAV
        onProgress({ stage: 'encoding', progress: 80, message: 'WAV形式に変換中...' });
        const wavBlob = encodeWAV(renderedBuffer);

        onProgress({ stage: 'complete', progress: 100, message: '完了！' });

        return {
            blob: wavBlob,
            duration: duration,
            sizeBytes: wavBlob.size,
            format: 'audio/wav'
        };

    } catch (e: any) {
        throw new Error('音声の抽出に失敗しました: ' + e.message);
    } finally {
        audioContext.close();
    }
}

/**
 * Encode AudioBuffer to WAV (16-bit PCM)
 */
function encodeWAV(audioBuffer: AudioBuffer): Blob {
    const numChannels = 1; // Always mono for this use case
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const samples = audioBuffer.getChannelData(0);
    const bufferLength = samples.length * 2; // 2 bytes per sample
    const arrayBuffer = new ArrayBuffer(44 + bufferLength);
    const view = new DataView(arrayBuffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // RIFF chunk length
    view.setUint32(4, 36 + bufferLength, true);
    // RIFF type
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, format, true);
    // channel count
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * numChannels * (bitDepth / 8), true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, numChannels * (bitDepth / 8), true);
    // bits per sample
    view.setUint16(34, bitDepth, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, bufferLength, true);

    // Float to 16-bit PCM
    floatTo16BitPCM(view, 44, samples);

    return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
    for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
}
