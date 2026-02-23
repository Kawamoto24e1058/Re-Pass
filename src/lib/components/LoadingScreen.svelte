<script lang="ts">
    import { onMount } from "svelte";
    import { fade } from "svelte/transition";

    export let onComplete: () => void;
    let progress = 0;

    onMount(() => {
        // Prevent scrolling while loading
        document.body.style.overflow = "hidden";

        const duration = 3000; // 3 seconds
        const interval = 30; // 30ms for smooth animation
        const steps = duration / interval;
        const increment = 100 / steps;

        const timer = setInterval(() => {
            progress += increment;
            if (progress >= 100) {
                progress = 100;
                clearInterval(timer);
                setTimeout(() => {
                    document.body.style.overflow = "";
                    onComplete();
                }, 200); // Small buffer
            }
        }, interval);

        return () => {
            clearInterval(timer);
            document.body.style.overflow = "";
        };
    });
</script>

<div
    class="fixed inset-0 z-[10000] bg-[#F9FAFB] flex flex-col items-center justify-center p-6 selection:bg-indigo-100"
    transition:fade={{ duration: 500 }}
>
    <!-- Brand Logo/Icon with Pulse Animation -->
    <div class="mb-12 relative animate-in zoom-in duration-700">
        <!-- App Icon with Pulse Animation -->
        <img
            src="/icon-512.png"
            alt="Re-Pass"
            class="w-24 h-24 rounded-3xl shadow-2xl animate-pulse"
            style="animation: gentlePulse 2s ease-in-out infinite;"
        />
        <!-- Decorative Glow -->
        <div
            class="absolute -inset-6 bg-indigo-400/30 blur-3xl rounded-full -z-10"
            style="animation: glowPulse 2s ease-in-out infinite;"
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
    /* Gentle Pulse Animation for Icon */
    @keyframes gentlePulse {
        0%,
        100% {
            transform: scale(1);
            opacity: 1;
        }
        50% {
            transform: scale(1.05);
            opacity: 0.95;
        }
    }

    /* Glow Pulse Animation */
    @keyframes glowPulse {
        0%,
        100% {
            opacity: 0.3;
            transform: scale(1);
        }
        50% {
            opacity: 0.5;
            transform: scale(1.1);
        }
    }
</style>
