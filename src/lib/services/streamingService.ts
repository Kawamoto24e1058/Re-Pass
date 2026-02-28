import { writable, get } from 'svelte/store';
import { transcript, interimTranscript, isRecording, analysisCountdown, analysisStatus } from '../stores/sessionStore';
import { user } from '../userStore';
import { recognitionService } from './recognitionService';

class StreamingService {
    private mediaRecorder: MediaRecorder | null = null;
    private stream: MediaStream | null = null;
    private chunkInterval = 5000; // 5 seconds
    private lastTranscribedText = '';
    private isAnalyzing = writable(false);

    // Web Audio API components
    private audioContext: AudioContext | null = null;
    private sourceNode: MediaStreamAudioSourceNode | null = null;
    private destinationNode: MediaStreamAudioDestinationNode | null = null;
    private gainNode: GainNode | null = null;
    private lowCutFilter: BiquadFilterNode | null = null;
    private voiceFilter: BiquadFilterNode | null = null;
    private analyser: AnalyserNode | null = null;
    private animationId: number | null = null;
    private countdownInterval: any = null;

    public status = writable('idle'); // idle, recording, analyzing
    public volumeLevel = writable(0); // 0.0 to 1.0 (normalized RMS)
    public isVolumeTooLow = writable(false);

    // Buffering and Optimization
    private chunkBuffer: Blob[] = [];
    private accumulatedSpeechDuration = 0;
    private readonly SEND_THRESHOLD = 20000; // 20 seconds
    private currentRMS = 0;
    private lastProcessedTimestamp = 0;

    async start(recordingMode: 'lecture' | 'meeting' = 'lecture') {
        if (get(isRecording)) return;

        try {
            // Start Web Speech API for real-time interim results
            recognitionService.start(recordingMode);

            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: recordingMode === 'meeting',
                    noiseSuppression: recordingMode === 'meeting',
                    autoGainControl: true,
                    sampleRate: 16000,
                    channelCount: 1, // Mono to save data/tokens
                }
            });

            // Set up Web Audio API pipeline
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);

            // 1. High-pass filter (cut below 100Hz)
            this.lowCutFilter = this.audioContext.createBiquadFilter();
            this.lowCutFilter.type = 'highpass';
            this.lowCutFilter.frequency.value = 100;

            // 2. Voice emphasis filter (boost 300Hz-3000Hz slightly)
            this.voiceFilter = this.audioContext.createBiquadFilter();
            this.voiceFilter.type = 'peaking';
            this.voiceFilter.frequency.value = 1500;
            this.voiceFilter.Q.value = 0.5;
            this.voiceFilter.gain.value = 3; // +3dB boost

            // 3. Gain node (Normalize/Boost)
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0; // Initial

            // 4. Analyser for volume monitoring
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;

            // 5. Destination for MediaRecorder
            this.destinationNode = this.audioContext.createMediaStreamDestination();

            // Connect pipeline: Source -> lowCut -> voiceFilter -> Gain -> Analyser -> Destination
            this.sourceNode.connect(this.lowCutFilter);
            this.lowCutFilter.connect(this.voiceFilter);
            this.voiceFilter.connect(this.gainNode);
            this.gainNode.connect(this.analyser);
            this.analyser.connect(this.destinationNode);

            this.mediaRecorder = new MediaRecorder(this.destinationNode.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });

            this.mediaRecorder.ondataavailable = async (event) => {
                if (event.data.size > 0) {
                    // Silence Cutting: Only buffer if current volume is above threshold
                    if (this.currentRMS > 0.005) {
                        this.chunkBuffer.push(event.data);
                        this.accumulatedSpeechDuration += this.chunkInterval;

                        // Send when threshold reached
                        if (this.accumulatedSpeechDuration >= this.SEND_THRESHOLD) {
                            const combinedBlob = new Blob(this.chunkBuffer, { type: 'audio/webm;codecs=opus' });
                            this.chunkBuffer = [];
                            this.accumulatedSpeechDuration = 0;
                            analysisCountdown.set(20);
                            await this.processChunk(combinedBlob);
                        }
                    } else {
                        console.log('Skipping silent chunk...');
                    }
                }
            };

            this.startVolumeMonitoring();
            this.startCountdown();

            this.mediaRecorder.start(this.chunkInterval);
            isRecording.set(true);
            this.status.set('recording');
            analysisStatus.set('buffering');
            analysisCountdown.set(20);
        } catch (error) {
            console.error('Failed to start streaming recording:', error);
            this.stop();
            throw error;
        }
    }

    private startCountdown() {
        if (this.countdownInterval) clearInterval(this.countdownInterval);
        this.countdownInterval = setInterval(() => {
            if (get(isRecording) && get(analysisStatus) === 'buffering') {
                analysisCountdown.update(n => Math.max(0, n - 1));
            }
        }, 1000);
    }

    private startVolumeMonitoring() {
        if (!this.analyser || !this.gainNode) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        let lowVolumeCount = 0;

        const checkVolume = () => {
            if (!get(isRecording)) return;

            this.analyser!.getByteTimeDomainData(dataArray);

            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const val = (dataArray[i] - 128) / 128; // Normalize to -1 to 1
                sum += val * val;
            }
            const rms = Math.sqrt(sum / bufferLength);
            this.currentRMS = rms; // Store for silence cutting

            // Auto gain: if too quiet, boost gain (up to 3x)
            if (rms < 0.05 && rms > 0) {
                this.gainNode!.gain.value = Math.min(3.0, this.gainNode!.gain.value + 0.05);
            } else if (rms > 0.2) {
                this.gainNode!.gain.value = Math.max(1.0, this.gainNode!.gain.value - 0.05);
            }

            this.volumeLevel.set(rms * 5); // Scale for UI visibility

            // Check if level is still too low after boost
            if (rms < 0.01) {
                lowVolumeCount++;
                if (lowVolumeCount > 100) { // Approx 2-3 seconds of consistent silence/low volume
                    this.isVolumeTooLow.set(true);
                }
            } else {
                lowVolumeCount = 0;
                this.isVolumeTooLow.set(false);
            }

            this.animationId = requestAnimationFrame(checkVolume);
        };

        checkVolume();
    }

    private async processChunk(blob: Blob) {
        const currentUser = get(user);
        if (!currentUser) return;

        this.isAnalyzing.set(true);
        this.status.set('analyzing');
        analysisStatus.set('processing');

        try {
            // Frontend Guard: Ensure we actually have data to send
            if (blob.size < 1000) { // Approx 1KB is a very small Opus chunk
                console.log('[StreamingService] Skipping chunk: blob too small');
                return;
            }

            const now = Date.now();
            if (now - this.lastProcessedTimestamp < 1000) { // 1 second debounce
                console.log('[StreamingService] Skipping duplicate chunk');
                return;
            }
            this.lastProcessedTimestamp = now;

            const idToken = await currentUser.getIdToken();
            const formData = new FormData();
            formData.append('audio', blob, 'chunk.webm');
            formData.append('context', this.lastTranscribedText);

            const response = await fetch('/api/transcribe-chunk', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                },
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                if (data.text) {
                    const newText = data.text.trim();
                    // When Gemini provides high-quality text, we clear the interim Web Speech text
                    // and append the refined text to the main transcript with newlines.
                    recognitionService.reset();
                    interimTranscript.set('');
                    transcript.update(prev => {
                        const current = prev.trim();
                        return current ? `${current}\n\n${newText}` : newText;
                    });
                    this.lastTranscribedText = newText;
                }
            } else if (response.status === 204) {
                console.log('[StreamingService] API returned 204: No meaningful speech detected');
            }
        } catch (error) {
            console.error('Chunk processing failed:', error);
        } finally {
            this.isAnalyzing.set(false);
            this.status.set('recording');
            analysisStatus.set('buffering');
            analysisCountdown.set(20);
        }
    }

    async stop() {
        // Stop Web Speech API
        recognitionService.stop();

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Send remaining buffer if any
        if (this.chunkBuffer.length > 0) {
            const combinedBlob = new Blob(this.chunkBuffer, { type: 'audio/webm;codecs=opus' });
            this.chunkBuffer = [];
            this.accumulatedSpeechDuration = 0;
            await this.processChunk(combinedBlob);
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
        }

        // Web Audio API cleanup
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        this.sourceNode = null;
        this.destinationNode = null;
        this.gainNode = null;
        this.lowCutFilter = null;
        this.voiceFilter = null;
        this.analyser = null;
        this.audioContext = null;

        isRecording.set(false);
        this.status.set('idle');
        analysisStatus.set('idle');
        this.lastTranscribedText = '';
        this.isVolumeTooLow.set(false);
        interimTranscript.set('');
    }

    toggle(recordingMode: 'lecture' | 'meeting' = 'lecture') {
        if (get(isRecording)) {
            this.stop();
        } else {
            this.start(recordingMode);
        }
    }
}

export const streamingService = new StreamingService();
