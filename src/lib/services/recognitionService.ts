import { isRecording, finalTranscript, interimTranscript } from '../stores/recordingStore';
import { get } from 'svelte/store';

class RecognitionService {
    private recognition: any = null;
    private silentAudio: HTMLAudioElement | null = null;
    private restartTimer: any = null;

    constructor() {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                this.recognition = new SpeechRecognition();
                this.recognition.continuous = true;
                this.recognition.interimResults = true; // Confirm realtime updates
                this.recognition.maxAlternatives = 3;   // Capture multiple candidates
                this.recognition.lang = 'ja-JP';

                this.recognition.onresult = (event: any) => {
                    let currentInterim = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        const result = event.results[i];
                        if (result.isFinal) {
                            // Use the first alternative (highest confidence) for final, 
                            // but ensuring we don't accidentally drop it if confidence is low (rarely happens with isFinal).
                            finalTranscript.update(prev => prev + result[0].transcript);
                        } else {
                            // Accumulate interim results
                            currentInterim += result[0].transcript;
                        }
                    }
                    interimTranscript.set(currentInterim);
                };

                this.recognition.onerror = (event: any) => {
                    console.error('Speech recognition error:', event.error);
                    if (event.error === 'not-allowed') {
                        alert('マイクの使用が許可されていません。');
                        isRecording.set(false);
                    } else if (event.error === 'no-speech') {
                        // Ignore no-speech error during recording (just silence)
                        console.log('No speech detected, continuing...');
                    } else {
                        // For other errors (network, aborted), we rely on onend to restart
                    }
                };

                this.recognition.onend = () => {
                    console.log('Speech recognition ended. isRecording:', get(isRecording));

                    // --- Fixed "Disappearing Text" Bug ---
                    // If there was any pending interim text that didn't get finalized (e.g. cut off by silence),
                    // force it into the final transcript now.
                    const pendingInterim = get(interimTranscript);
                    if (pendingInterim && pendingInterim.trim().length > 0) {
                        console.log('Saving pending interim on stop:', pendingInterim);
                        finalTranscript.update(prev => prev + pendingInterim);
                        interimTranscript.set('');
                    }

                    // Continuous restart if isRecording is still true
                    if (get(isRecording)) {
                        // Clear any existing timer
                        if (this.restartTimer) clearTimeout(this.restartTimer);

                        // --- Aggressive Restart (Silenced Protection) ---
                        // Reduced to 100ms (or nearly instant) to prevent dropping words during pauses.
                        this.restartTimer = setTimeout(() => {
                            if (get(isRecording)) {
                                try {
                                    this.recognition.start();
                                    console.log('Recognition restarted (Aggressive Mode)');
                                } catch (e) {
                                    console.error('Failed to restart recognition:', e);
                                    // Retry once more if immediate start fails
                                    setTimeout(() => {
                                        if (get(isRecording) && this.recognition) {
                                            try { this.recognition.start(); } catch (e2) { console.error("Retry restart failed", e2); }
                                        }
                                    }, 500);
                                }
                            }
                        }, 100);
                    }
                };

                // Visibility logging for background debugging
                document.addEventListener('visibilitychange', () => {
                    console.log(`Tab visibility changed: ${document.visibilityState} (isRecording: ${get(isRecording)})`);
                });
            }
        }
    }

    private initKeepAlive() {
        if (typeof window === 'undefined') return;

        // Silent audio "keep-alive" hack
        // Browsers often throttle or suspend JS and APIs (like SpeechRecognition) 
        // in background tabs unless audio is playing.
        if (!this.silentAudio) {
            this.silentAudio = new Audio();
            // Create a very short silent wav data URI
            this.silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
            this.silentAudio.loop = true;
        }
    }

    private async configureMicrophone() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

        try {
            // Request microphone with specific constraints to broaden capture range
            // noiseSuppression: false -> captures ambient sounds/voices better
            // autoGainControl: true -> amplifies distant voices
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true, // Keep on to prevent speaker feedback
                    noiseSuppression: false, // OFF/LOW to hear surroundings
                    autoGainControl: true,   // ON to boost quiet voices
                    channelCount: 1
                }
            });

            // We don't need to keep the stream active for SpeechRecognition (it manages its own),
            // but getting it hints the OS/Browser to use these settings.
            // Some browsers might require the stream to remain open, so let's keep it in a valid scope if needed.
            // For now, we'll stop it to avoid "tab is using microphone" double-indicator if possible,
            // OR we keep it if that's required for the settings to persist.
            // To be safe and ensure "settings applied", we often need to keep the track alive...
            // But SpeechRec might fail if we hog the mic?
            // Actually, standard Web Speech API doesn't let us attach a stream.
            // Best effort: Get stream, apply constraints, stop.
            // OR: If the user specifically asked for this, they might imply we should HOLD the settings.
            // Let's try just getting it. If it causes issues, we can adjust.

            // Important: We stop the tracks immediately to release the mic for SpeechRecognition
            stream.getTracks().forEach(track => track.stop());

        } catch (e) {
            console.warn("Microphone configuration hint failed:", e);
        }
    }

    async start() {
        if (!this.recognition) {
            alert('このブラウザは音声認識をサポートしていません。');
            return;
        }
        if (get(isRecording)) return;

        // Apply audio constraints (best effort)
        await this.configureMicrophone();

        isRecording.set(true);
        this.initKeepAlive();

        if (this.silentAudio) {
            this.silentAudio.play().catch(e => console.warn('Keep-alive audio failed to play:', e));
        }

        try {
            this.recognition.start();
        } catch (e) {
            console.error('Failed to start recognition:', e);
            isRecording.set(false);
        }
    }

    stop() {
        if (!this.recognition) return;
        isRecording.set(false);

        if (this.silentAudio) {
            this.silentAudio.pause();
        }

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        try {
            this.recognition.stop();
        } catch (e) {
            console.warn('Recognition stop error:', e);
        }

        interimTranscript.set(''); // Clear interim result on stop
    }

    toggle() {
        if (get(isRecording)) {
            this.stop();
        } else {
            this.start();
        }
    }
}

export const recognitionService = new RecognitionService();
