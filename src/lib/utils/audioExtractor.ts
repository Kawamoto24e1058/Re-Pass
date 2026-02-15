/**
 * Audio Extraction Utility
 * Extracts audio from video files using Web Audio API and compresses to MP3
 */

export interface AudioExtractionProgress {
    stage: 'loading' | 'extracting' | 'encoding' | 'complete';
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
 * Extract audio from video file
 * @param videoFile - Video file to extract audio from
 * @param onProgress - Progress callback
 * @param targetBitrate - Target bitrate in kbps (default: auto-detect based on duration)
 * @returns Extracted and compressed audio as Blob
 */
export async function extractAudioFromVideo(
    videoFile: File,
    onProgress: (progress: AudioExtractionProgress) => void,
    targetBitrate?: number
): Promise<AudioExtractionResult> {

    return new Promise(async (resolve, reject) => {
        try {
            onProgress({ stage: 'loading', progress: 10, message: '動画を読み込んでいます...' });

            // Create video element to load the file
            const videoUrl = URL.createObjectURL(videoFile);
            const video = document.createElement('video');
            video.src = videoUrl;
            video.load();

            await new Promise((res, rej) => {
                video.onloadedmetadata = () => res(true);
                video.onerror = () => rej(new Error('動画の読み込みに失敗しました'));
            });

            const duration = video.duration;

            // Optimized bitrate for size/quality balance
            let bitrate = targetBitrate;
            if (!bitrate) {
                if (duration > 3600) { // > 1 hour
                    bitrate = 48; // Highly compressed
                } else {
                    bitrate = 64; // Standard for speech
                }
            }

            onProgress({
                stage: 'extracting',
                progress: 30,
                message: `音声を抽出中... (${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒, ${bitrate}kbps)`
            });

            // Create audio context
            const audioContext = new AudioContext();
            const source = audioContext.createMediaElementSource(video);
            const destination = audioContext.createMediaStreamDestination();
            source.connect(destination);

            // Record the audio stream
            const mediaRecorder = new MediaRecorder(destination.stream, {
                mimeType: 'audio/webm;codecs=opus',
                audioBitsPerSecond: bitrate * 1000
            });

            const chunks: Blob[] = [];
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                onProgress({ stage: 'encoding', progress: 80, message: '音声を圧縮しています...' });

                const audioBlob = new Blob(chunks, { type: 'audio/webm' });

                // Convert to MP3 if possible (for better compatibility)
                // For now, return WebM as-is (browsers support it well)
                // TODO: Add actual MP3 encoding using lamejs if needed

                onProgress({ stage: 'complete', progress: 100, message: '完了！' });

                URL.revokeObjectURL(videoUrl);

                resolve({
                    blob: audioBlob,
                    duration: duration,
                    sizeBytes: audioBlob.size,
                    format: 'audio/webm'
                });
            };

            mediaRecorder.onerror = (error) => {
                reject(new Error(`音声抽出に失敗しました: ${error}`));
            };

            // Start recording
            mediaRecorder.start();
            video.play();

            // Stop recording when video ends
            video.onended = () => {
                mediaRecorder.stop();
                video.pause();
            };

            // Monitor progress during playback
            const progressInterval = setInterval(() => {
                if (video.currentTime > 0 && duration > 0) {
                    const extractProgress = Math.min(95, 30 + (video.currentTime / duration) * 50);
                    onProgress({
                        stage: 'extracting',
                        progress: extractProgress,
                        message: `音声を抽出中... (${Math.floor(video.currentTime)}/${Math.floor(duration)}秒)`
                    });
                }
            }, 500);

            video.onended = () => {
                clearInterval(progressInterval);
            };

        } catch (error: any) {
            reject(new Error(`音声抽出エラー: ${error.message || error}`));
        }
    });
}

/**
 * Convert audio file to different format or compress
 * (Placeholder - can be enhanced with actual conversion libraries)
 */
export async function compressAudio(
    audioBlob: Blob,
    targetBitrate: number
): Promise<Blob> {
    // For now, just return the same blob
    // TODO: Implement actual compression using lamejs or similar
    return audioBlob;
}

/**
 * Estimate the cost of analyzing an audio file
 */
export function estimateAnalysisCost(durationSeconds: number, targetLength: number): {
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCostUSD: number;
} {
    // Rough estimates for Gemini 2.0 Flash
    // Audio: ~10 tokens per second (very rough estimate)
    const inputTokens = Math.ceil(durationSeconds * 10);
    const outputTokens = Math.ceil(targetLength * 3) + 500;

    // Pricing: $0.075 per 1M input tokens, $0.30 per 1M output tokens
    const inputCost = (inputTokens / 1000000) * 0.075;
    const outputCost = (outputTokens / 1000000) * 0.30;
    const totalCost = inputCost + outputCost;

    return {
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: outputTokens,
        estimatedCostUSD: Number(totalCost.toFixed(4))
    };
}
