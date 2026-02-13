<script lang="ts">
    import { onMount } from "svelte";
    import { fade } from "svelte/transition";

    let { onComplete } = $props<{ onComplete: () => void }>();
    let progress = $state(0);

    onMount(() => {
        const duration = 3000; // 3 seconds
        const interval = 30; // 30ms for smooth animation
        const steps = duration / interval;
        const increment = 100 / steps;

        const timer = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(timer);
                setTimeout(onComplete, 200); // Small buffer
            }
        }, interval);

        return () => clearInterval(timer);
    });
</script>

<div
    class="fixed inset-0 z-[10000] bg-[#F9FAFB] flex flex-col items-center justify-center p-6 selection:bg-indigo-100"
    transition:fade={{ duration: 500 }}
>
    <!-- Brand Logo/Symbol -->
    <div class="mb-12 relative animate-in zoom-in duration-700">
        <div
            class="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center text-white shadow-2xl shadow-indigo-200 rotate-6"
        >
            <svg class="w-12 h-12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white" />
                <path
                    d="M2 17L12 22L22 17"
                    stroke="white"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
                <path
                    d="M2 12L12 17L22 12"
                    stroke="white"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </div>
        <!-- Decorative Glow -->
        <div
            class="absolute -inset-4 bg-indigo-400/20 blur-2xl rounded-full -z-10 animate-pulse"
        ></div>
    </div>

    <!-- Text Header -->
    <div class="text-center mb-8">
        <h1 class="text-3xl font-black text-slate-900 tracking-tighter mb-2">
            Re-Pass
        </h1>
        <p
            class="text-indigo-500 text-[10px] font-black tracking-[0.2em] uppercase"
        >
            Academic Intelligence
        </p>
    </div>

    <!-- Setup Message & Progress -->
    <div class="w-full max-w-[280px]">
        <div class="flex justify-between items-end mb-3">
            <span class="text-[11px] font-bold text-slate-500 animate-pulse"
                >Re-Pass セットアップ中...</span
            >
            <span class="text-[10px] font-black text-indigo-600 tabular-nums"
                >{Math.round(progress)}%</span
            >
        </div>

        <!-- Progress Bar Container -->
        <div
            class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-50 shadow-inner"
        >
            <div
                class="h-full bg-gradient-to-r from-indigo-600 to-pink-500 rounded-full transition-all duration-300 ease-out"
                style="width: {progress}%"
            ></div>
        </div>
    </div>

    <!-- Background Decor -->
    <div
        class="fixed inset-0 overflow-hidden pointer-events-none -z-10 opacity-20"
    >
        <div
            class="absolute -top-[10%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-200 blur-[120px]"
        ></div>
        <div
            class="absolute bottom-[0%] -right-[10%] w-[40%] h-[40%] rounded-full bg-pink-100 blur-[100px]"
        ></div>
    </div>
</div>

<style>
    /* Prevent scrolling or interactions while loading */
    :global(body) {
        overflow: hidden;
    }
</style>
