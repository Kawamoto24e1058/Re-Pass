import { writable, derived } from 'svelte/store';

export const isRecording = writable<boolean>(false);
export const finalTranscript = writable<string>('');
export const interimTranscript = writable<string>('');

// Combined transcript for UI display
export const transcript = derived(
    [finalTranscript, interimTranscript],
    ([$final, $interim]) => $final + $interim
);

// --- UI State ---
export const isOverlayVisible = writable<boolean>(false); // Is the overlay open?
export const isOverlayExpanded = writable<boolean>(true); // Is it maximized (true) or minimized (false)?

// --- File & Input State ---
export const pdfFile = writable<File | null>(null);
export const txtFile = writable<File | null>(null);
export const audioFile = writable<File | null>(null);
export const imageFile = writable<File | null>(null);
export const videoFile = writable<File | null>(null);
export const targetUrl = writable<string>("");

// Course & Mode State
export const courseName = writable<string>("");
export const analysisMode = writable<string>("note"); // note, thoughts, report
export const selectedSyllabus = writable<any>(null);

export function resetTranscript() {
    finalTranscript.set('');
    interimTranscript.set('');
}

export function resetAll() {
    resetTranscript();
    isRecording.set(false);
    pdfFile.set(null);
    txtFile.set(null);
    audioFile.set(null);
    imageFile.set(null);
    videoFile.set(null);
    targetUrl.set("");
    courseName.set("");
    selectedSyllabus.set(null);
    // Keep analysisMode? Maybe reset to default?
    analysisMode.set("note");
}
