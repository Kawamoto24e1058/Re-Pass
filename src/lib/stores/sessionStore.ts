import { writable, derived } from 'svelte/store';

// --- Recording State ---
export const isRecording = writable<boolean>(false);
export const finalTranscript = writable<string>('');
export const interimTranscript = writable<string>('');

export const transcript = derived(
    [finalTranscript, interimTranscript],
    ([$final, $interim]) => $final + $interim
);

// --- Session/Input State ---
export const lectureTitle = writable<string>('');
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
    finalTranscript.set('');
    interimTranscript.set('');
    lectureTitle.set('');
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
