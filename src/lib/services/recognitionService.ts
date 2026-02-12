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
                this.recognition.interimResults = true;
                this.recognition.lang = 'ja-JP';

                this.recognition.onresult = (event: any) => {
                    let currentInterim = '';
                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalTranscript.update(prev => prev + event.results[i][0].transcript);
                        } else {
                            currentInterim += event.results[i][0].transcript;
                        }
                    }
                    interimTranscript.set(currentInterim);
                };

                this.recognition.onerror = (event: any) => {
                    console.error('Speech recognition error:', event.error);
                    if (event.error === 'not-allowed') {
                        alert('マイクの使用が許可されていません。');
                        isRecording.set(false);
                    }
                    // 'aborted' is common when tab is hidden or network drops
                };

                this.recognition.onend = () => {
                    console.log('Speech recognition ended. isRecording:', get(isRecording));
                    // Continuous restart if isRecording is still true
                    if (get(isRecording)) {
                        // Clear any existing timer
                        if (this.restartTimer) clearTimeout(this.restartTimer);

                        // Add a small delay before restart to avoid browser throttling
                        this.restartTimer = setTimeout(() => {
                            if (get(isRecording)) {
                                try {
                                    this.recognition.start();
                                    console.log('Recognition restarted');
                                } catch (e) {
                                    console.error('Failed to restart recognition:', e);
                                }
                            }
                        }, 300);
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

    start() {
        if (!this.recognition) {
            alert('このブラウザは音声認識をサポートしていません。');
            return;
        }
        if (get(isRecording)) return;

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
