<script lang="ts">
    import { slide, fade } from "svelte/transition";
    import {
        isRecording,
        transcript,
        resetTranscript,
    } from "$lib/stores/recordingStore";
    import { recognitionService } from "$lib/services/recognitionService";
    import { streamingService } from "$lib/services/streamingService";

    // Local state for UI expansion
    let expanded = false;

    // Format seconds into MM:SS
    function formatTime(seconds: number) {
        const m = Math.floor(seconds / 60)
            .toString()
            .padStart(2, "0");
        const s = (seconds % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
    }

    // Timer logic
    let duration = 0;
    let timerInterval: any;

    // Watch isRecording to start/stop timer
    $: if ($isRecording) {
        if (!timerInterval) {
            // Reset or continue? If we want continuous session timing, we might need a store for duration too.
            // For now, let's just count up while this component is alive and recording is active.
            // Ideally, start time should be in store if we want persistence across reloads,
            // but user asked for "persistence across navigation" (SPA), so local var in layout-bound component is fine
            // IF the component isn't destroyed.
            // However, layout components MIGHT be destroyed/recreated? No, +layout.svelte is persistent.
            // Let's safe-guard:
            timerInterval = setInterval(() => {
                duration++;
            }, 1000);
        }
    } else {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
            duration = 0; // Reset on stop
        }
    }

    function toggleExpand() {
        expanded = !expanded;
    }

    function stopRecording() {
        streamingService.stop();
    }

    const streamingStatus = streamingService.status;
    const volumeLevel = streamingService.volumeLevel;
    const isVolumeTooLow = streamingService.isVolumeTooLow;
</script>

{#if $isRecording || ($transcript && $transcript.length > 0)}
    <!-- Floating Container -->
    <div
        class="fixed bottom-0 left-0 right-0 z-50 p-4 pointer-events-none flex flex-col items-center justify-end"
    >
        <!-- Expanded View (Overlay/Modal style) -->
        {#if expanded}
            <div
                transition:slide={{ duration: 300 }}
                class="w-full max-w-2xl bg-white shadow-2xl rounded-t-2xl border border-gray-200 pointer-events-auto flex flex-col max-h-[80vh]"
            >
                <!-- Header -->
                <div
                    class="flex items-center justify-between p-4 border-b border-gray-100"
                >
                    <h3 class="font-bold text-gray-700 flex items-center gap-2">
                        {#if $isRecording}
                            <span class="relative flex h-3 w-3">
                                <!-- <span
                                    class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"
                                ></span> -->
                                <span
                                    class="relative inline-flex rounded-full h-3 w-3 bg-red-500"
                                ></span>
                            </span>
                            Recording... {formatTime(duration)}
                        {:else}
                            <span class="text-gray-500">Recorded Text</span>
                        {/if}
                    </h3>
                    <button
                        on:click={toggleExpand}
                        class="p-2 hover:bg-gray-100 rounded-full text-gray-500"
                        aria-label="Toggle Expand"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-6 w-6"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M19 9l-7 7-7-7"
                            />
                        </svg>
                    </button>
                </div>

                <!-- Transcript Content -->
                <div
                    class="flex-1 overflow-y-auto p-6 bg-slate-50 min-h-[300px]"
                >
                    <p
                        class="whitespace-pre-wrap leading-relaxed text-gray-800 text-lg"
                    >
                        {$transcript ||
                            "音声認識を開始すると、ここにテキストが表示されます..."}
                    </p>
                </div>

                <!-- Footer Actions -->
                <div
                    class="p-4 border-t border-gray-100 bg-white flex justify-between items-center"
                >
                    <button
                        class="text-sm text-gray-500 hover:text-red-500 px-4 py-2"
                        on:click={() => {
                            if (confirm("テキストをクリアしますか？")) {
                                resetTranscript();
                                expanded = false;
                            }
                        }}
                    >
                        Clear text
                    </button>

                    {#if $isRecording}
                        <button
                            on:click={stopRecording}
                            class="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full font-bold shadow-lg transition-transform hover:scale-105 flex items-center gap-2"
                        >
                            <div class="w-3 h-3 bg-white rounded-sm"></div>
                            STOP
                        </button>
                    {:else}
                        <!-- Maybe a 'Copy' or 'Use' button? For now just close/expand toggle -->
                        <button
                            on:click={toggleExpand}
                            class="bg-gray-800 text-white px-6 py-2 rounded-full font-medium"
                        >
                            Close
                        </button>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- Mini Bar (Spotify-like) -->
        {#if !expanded}
            <div
                transition:slide={{ axis: "y", duration: 300 }}
                class="w-full max-w-lg bg-gray-900/90 backdrop-blur-md text-white shadow-xl rounded-full p-2 pr-4 mb-4 pointer-events-auto flex items-center gap-4 border border-white/10"
                on:click={toggleExpand}
                role="button"
                tabindex="0"
                on:keydown={(e) => e.key === "Enter" && toggleExpand()}
            >
                <!-- Status Icon -->
                <div
                    class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-gray-800"
                >
                    {#if $isRecording}
                        <div class="relative flex h-3 w-3">
                            <!-- <span
                                class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"
                            ></span> -->
                            <span
                                class="relative inline-flex rounded-full h-3 w-3 bg-red-500"
                            ></span>
                        </div>
                    {:else}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 text-gray-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                            />
                        </svg>
                    {/if}
                </div>

                <!-- Content Preview -->
                <div
                    class="flex-1 min-w-0 flex flex-col justify-center cursor-pointer group"
                >
                    <div
                        class="flex items-center gap-2 text-xs text-gray-400 font-mono"
                    >
                        {#if $isRecording}
                            <div class="flex items-center gap-2">
                                <span class="text-red-400 font-bold">● REC</span
                                >
                                <span>{formatTime(duration)}</span>
                                <!-- Mini Volume Bar -->
                                <div class="flex gap-0.5 h-2 items-end ml-1">
                                    {#each Array(4) as _, i}
                                        <div
                                            class="w-0.5 rounded-full transition-all duration-75"
                                            style="height: {Math.min(
                                                100,
                                                $volumeLevel * (i + 1) * 40,
                                            )}%; background-color: {$volumeLevel >
                                            0.05
                                                ? '#f87171'
                                                : '#4b5563'}"
                                        ></div>
                                    {/each}
                                </div>
                                {#if $isVolumeTooLow}
                                    <span
                                        class="text-amber-400 animate-pulse text-[10px] ml-1 flex items-center gap-1"
                                    >
                                        <svg
                                            class="w-3 h-3"
                                            fill="currentColor"
                                            viewBox="0 0 20 20"
                                            ><path
                                                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                            /></svg
                                        >
                                        遠すぎます
                                    </span>
                                {/if}
                            </div>
                        {:else}
                            <span class="text-blue-400">Analysis Ready</span>
                        {/if}
                    </div>
                    <div
                        class="text-sm font-medium truncate group-hover:text-white/80 transition-colors"
                    >
                        {$transcript ? $transcript.slice(-40) : "待機中..."}
                    </div>
                </div>

                <!-- Quick Action: Stop -->
                {#if $isRecording}
                    <button
                        on:click|stopPropagation={stopRecording}
                        class="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
                        title="Stop Recording"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-6 w-6 text-red-500"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                        >
                            <rect x="5" y="5" width="10" height="10" rx="1" />
                        </svg>
                    </button>
                {:else}
                    <!-- Quick Action: Expand -->
                    <button
                        on:click|stopPropagation={toggleExpand}
                        class="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
                        aria-label="Toggle Expand"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-5 w-5 text-gray-300"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 15l7-7 7 7"
                            />
                        </svg>
                    </button>
                {/if}
            </div>
        {/if}
    </div>
{/if}
