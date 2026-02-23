<script lang="ts">
    import { onMount } from "svelte";
    import { fade, fly } from "svelte/transition";

    let deferredPrompt: any = null;
    let showInstallPrompt = false;
    let isIOS = false;
    let isStandalone = false;

    // LocalStorage key
    const PWA_DISMISSED_KEY = "pwa-install-dismissed";

    onMount(() => {
        // Check if already dismissed
        if (localStorage.getItem(PWA_DISMISSED_KEY) === "true") {
            return;
        }

        // Check if running in standalone mode (already installed)
        isStandalone =
            window.matchMedia("(display-mode: standalone)").matches ||
            (window.navigator as any).standalone === true;
        if (isStandalone) return;

        // Android / Desktop (Chrome)
        window.addEventListener("beforeinstallprompt", (e) => {
            e.preventDefault();
            deferredPrompt = e;
            showInstallPrompt = true;
        });

        // iOS Detection
        const userAgent = window.navigator.userAgent.toLowerCase();
        isIOS = /iphone|ipad|ipod/.test(userAgent);

        if (isIOS) {
            // Show prompt for iOS if not standalone (and not dismissed)
            // waiting a bit to not be intrusive immediately
            setTimeout(() => {
                showInstallPrompt = true;
            }, 2000);
        }
    });

    async function installPWA() {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === "accepted") {
                deferredPrompt = null;
                showInstallPrompt = false;
            }
        }
    }

    function dismissPrompt() {
        showInstallPrompt = false;
        localStorage.setItem(PWA_DISMISSED_KEY, "true");
    }
</script>

{#if showInstallPrompt}
    <div
        class="fixed bottom-0 left-0 right-0 z-50 p-4 flex justify-center pointer-events-none"
    >
        {#if isIOS}
            <!-- iOS Prompt -->
            <div
                transition:fly={{ y: 50, duration: 500 }}
                class="pointer-events-auto bg-white/90 backdrop-blur-md border border-slate-200 shadow-2xl rounded-2xl p-4 max-w-sm w-full mx-4 mb-6 relative"
            >
                <button
                    on:click={dismissPrompt}
                    class="absolute top-2 right-2 text-slate-400 hover:text-slate-600 p-1"
                >
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        />
                    </svg>
                </button>
                <div class="flex items-start gap-4 pr-6">
                    <img
                        src="/icon-192.png"
                        alt="Re-Pass"
                        class="w-12 h-12 rounded-xl shadow-md flex-shrink-0"
                    />
                    <div>
                        <h3 class="font-bold text-slate-900 text-sm mb-1">
                            ホーム画面に追加
                        </h3>
                        <p class="text-xs text-slate-600 leading-relaxed">
                            画面下の<span class="inline-block mx-1"
                                ><svg
                                    class="w-4 h-4 inline text-blue-500"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                                    /></svg
                                ></span
                            >ボタンをタップして「ホーム画面に追加」を選択してください。
                        </p>
                    </div>
                </div>
                <!-- Arrow pointing down -->
                <div
                    class="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-white/90 backdrop-blur-md border-b border-r border-slate-200 rotate-45"
                ></div>
            </div>
        {:else}
            <!-- Android / Desktop Prompt -->
            <div
                transition:fly={{ y: 50, duration: 500 }}
                class="pointer-events-auto"
            >
                <button
                    on:click={installPWA}
                    class="bg-slate-900 hover:bg-slate-800 text-white font-bold py-3 px-6 rounded-full shadow-lg flex items-center gap-3 transition-transform active:scale-95"
                >
                    <img
                        src="/icon-192.png"
                        alt=""
                        class="w-6 h-6 rounded-md"
                    />
                    <span>Re-Passをインストール</span>
                    <div
                        on:click={(e) => {
                            e.stopPropagation();
                            dismissPrompt();
                        }}
                        class="ml-2 pl-2 border-l border-slate-700 text-slate-400 hover:text-white"
                    >
                        <svg
                            class="w-4 h-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </div>
                </button>
            </div>
        {/if}
    </div>
{/if}
