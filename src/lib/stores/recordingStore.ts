import { writable, derived } from 'svelte/store';

export const isRecording = writable<boolean>(false);
export const finalTranscript = writable<string>('');
export const interimTranscript = writable<string>('');

// Combined transcript for UI display
export const transcript = derived(
    [finalTranscript, interimTranscript],
    ([$final, $interim]) => $final + $interim
);

export function resetTranscript() {
    finalTranscript.set('');
    interimTranscript.set('');
}
