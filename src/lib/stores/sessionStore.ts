import { writable, derived } from 'svelte/store';

// --- Recording State ---
export const isRecording = writable<boolean>(false);
// "transcript" is the "Vault" (金庫) - Persists finalized AI corrected text
export const transcript = writable<string>('');
// "interimTranscript" is the "Workspace" (作業場) - Volatile real-time interim results
export const interimTranscript = writable<string>('');

// --- Session/Input State ---
export const lectureTitle = writable<string>('');
export const courseId = writable<string>(''); // Added courseId
export const isShared = writable<boolean>(true); // Default to true
export const courseName = writable<string>('');
export const analysisMode = writable<"note" | "thoughts" | "report">("note");
export const targetLength = writable<number>(500);
// "userPlan" tracks the tier of the user to determine transcription logic (Phase 11)
export const userPlan = writable<'free' | 'premium' | 'ultimate' | 'season' | 'pro'>('free');

// --- UX Progress State ---
export const analysisCountdown = writable<number>(20);
export const analysisStatus = writable<string>('idle'); // idle, buffering, processing

// --- File Inputs ---
export const pdfFile = writable<File | null>(null);
export const txtFile = writable<File | null>(null);
export const audioFile = writable<File | null>(null);
export const imageFile = writable<File | null>(null);
export const videoFile = writable<File | null>(null);
export const targetUrl = writable<string>("");
export const stagedImages = writable<File[]>([]);
export const taskText = writable<string>("");

// --- Actions ---
export function resetSession() {
    isRecording.set(false);
    transcript.set('');
    interimTranscript.set('');
    lectureTitle.set('');
    courseId.set('');
    isShared.set(true);
    courseName.set('');
    analysisMode.set('note');
    targetLength.set(500);
    analysisCountdown.set(20);
    analysisStatus.set('idle');
    pdfFile.set(null);
    txtFile.set(null);
    audioFile.set(null);
    imageFile.set(null);
    videoFile.set(null);
    targetUrl.set("");
    stagedImages.set([]);
    taskText.set("");
}
