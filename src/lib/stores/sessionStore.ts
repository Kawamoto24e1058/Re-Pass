import { writable, derived } from 'svelte/store';

// --- Recording State ---
export const isRecording = writable<boolean>(false);
// "transcript" is now the main writable store for the committed text (editable).
export const transcript = writable<string>('');
export const interimTranscript = writable<string>('');

// --- Session/Input State ---
export const lectureTitle = writable<string>('');
export const isShared = writable<boolean>(false); // Added isShared
export const courseName = writable<string>('');
export const analysisMode = writable<"note" | "thoughts" | "report">("note");
export const targetLength = writable<number>(500);

// --- File Inputs ---
export const pdfFile = writable<File | null>(null);
export const txtFile = writable<File | null>(null);
export const audioFile = writable<File | null>(null);
export const imageFile = writable<File | null>(null);
export const videoFile = writable<File | null>(null);
export const targetUrl = writable<string>("");

// --- Actions ---
export function resetSession() {
    isRecording.set(false);
    transcript.set('');
    interimTranscript.set('');
    lectureTitle.set('');
    isShared.set(false);
    courseName.set('');
    analysisMode.set('note');
    targetLength.set(500);
    pdfFile.set(null);
    txtFile.set(null);
    audioFile.set(null);
    imageFile.set(null);
    videoFile.set(null);
    targetUrl.set("");
}
