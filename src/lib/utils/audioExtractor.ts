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

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GB

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
    console.log(`[AudioExtractor] Starting extraction for: ${videoFile.name} (${videoFile.size} bytes)`);

    if (videoFile.size > MAX_FILE_SIZE) {
        throw new Error(`ファイルサイズが大きすぎます（${(videoFile.size / (1024 * 1024 * 1024)).toFixed(2)}GB）。1GB以下のファイルを使用してください。`);
    }

    // 1. Read file using FileReader (More robust than arrayBuffer() on some systems)
    const arrayBuffer = await readFileAsArrayBuffer(videoFile);
    console.log(`[AudioExtractor] File read successfully: ${arrayBuffer.byteLength} bytes`);

    // 2. Decode Audio Data
    const audioContext = new AudioContext(); // Standard AudioContext for decoding
    onProgress({ stage: 'decoding', progress: 20, message: '音声をデコード中...' });
    console.log(`[AudioExtractor] Decoding audio data...`);

    try {
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        console.log(`[AudioExtractor] Audio decoded: ${audioBuffer.duration}s, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz`);

        // 3. Resample to 16kHz Mono using OfflineAudioContext
        const targetSampleRate = 16000;
        // Calculate new length based on target sample rate
        const newLength = Math.ceil(audioBuffer.duration * targetSampleRate);
        const offlineContext = new OfflineAudioContext(1, newLength, targetSampleRate);

        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);
        source.start();

        onProgress({ stage: 'resampling', progress: 50, message: '16kHzに変換中...' });
        console.log(`[AudioExtractor] Resampling to 16kHz Mono...`);

        const renderedBuffer = await offlineContext.startRendering();
        console.log(`[AudioExtractor] Resampling complete.`);

        // 5. Validation: Check for silence or too short duration
        if (renderedBuffer.duration < 0.5) {
            throw new Error('音声が短すぎるか、検出されませんでした（0.5秒未満）。');
        }
        // Optional: Check for silence (RMS amplitude) could be added here if needed, 
        // but duration check covers most "empty" cases from extraction failures.

        // 6. Encode to WAV
        onProgress({ stage: 'encoding', progress: 80, message: 'WAV形式に変換中...' });
        console.log(`[AudioExtractor] Encoding to WAV...`);
        const wavBlob = encodeWAV(renderedBuffer);
        console.log(`[AudioExtractor] WAV created: ${wavBlob.size} bytes`);

        onProgress({ stage: 'complete', progress: 100, message: '完了！' });

        return {
            blob: wavBlob,
            duration: audioBuffer.duration,
            sizeBytes: wavBlob.size,
            format: 'audio/wav'
        };

    } catch (e: any) {
        console.error(`[AudioExtractor] Error:`, e);
        throw new Error('音声の抽出に失敗しました: ' + e.message);
    } finally {
        await audioContext.close();
        console.log(`[AudioExtractor] AudioContext closed.`);
    }
}

/**
 * Reads a File as ArrayBuffer using FileReader with Promise wrapper
 */
function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
                resolve(reader.result);
            } else {
                reject(new Error('ファイルの読み込み結果が不正です'));
            }
        };

        reader.onerror = () => {
            console.error('[FileReader] Error:', reader.error);
            // Specific handling for NotReadableError
            if (reader.error?.name === 'NotReadableError') {
                reject(new Error('ファイルの読み込みに失敗しました（NotReadableError）。ファイルが他のアプリで開かれていないか確認し、もう一度選択し直してください。'));
            } else {
                reject(new Error(`ファイルの読み込みに失敗しました: ${reader.error?.message}`));
            }
        };

        reader.readAsArrayBuffer(file);
    });
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
