<script lang="ts">
    import { goto } from "$app/navigation";

    let {
        isOpen = false,
        onClose,
        title = "ULTIMATE限定機能",
        message = "動画解析・URL読み込み・共有ノートの閲覧は<br /><span class='text-indigo-900 font-bold'>Ultimateプラン</span>限定の機能です。",
    } = $props();

    function handleUpgrade() {
        goto("/pricing");
    }
</script>

{#if isOpen}
    <div
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
    >
        <!-- Backdrop -->
        <div
            class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
            onclick={onClose}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === "Escape" && onClose()}
        ></div>

        <!-- Modal Content -->
        <div
            class="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden transform transition-all scale-100 flex flex-col"
        >
            <!-- Header with Gradient -->
            <div
                class="bg-gradient-to-r from-slate-900 to-indigo-900 p-6 text-center relative overflow-hidden"
            >
                <div
                    class="absolute top-0 left-0 w-full h-full bg-[url('/noise.png')] opacity-10 mix-blend-overlay"
                ></div>
                <div class="relative z-10">
                    <div
                        class="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4 backdrop-blur-md border border-white/20 shadow-inner"
                    >
                        <span class="text-3xl">🔒</span>
                    </div>
                    <h2
                        class="text-2xl font-black text-white tracking-tight mb-1"
                    >
                        {title}
                    </h2>
                    <p class="text-indigo-200 text-sm font-bold">
                        大学生活を完全に攻略する。
                    </p>
                </div>
            </div>

            <!-- Body -->
            <div class="p-8">
                <p
                    class="text-slate-600 text-center mb-8 leading-relaxed font-medium"
                >
                    {@html message}
                </p>

                <ul class="space-y-4 mb-8">
                    <li class="flex items-start gap-3">
                        <div
                            class="bg-indigo-100 p-1 rounded-full text-indigo-600 mt-0.5"
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
                                    stroke-width="3"
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <div>
                            <span class="block text-sm font-bold text-slate-900"
                                >動画・音声・URL解析</span
                            >
                            <span class="text-xs text-slate-500"
                                >YouTubeやZoom録画を直接解析</span
                            >
                        </div>
                    </li>
                    <li class="flex items-start gap-3">
                        <div
                            class="bg-indigo-100 p-1 rounded-full text-indigo-600 mt-0.5"
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
                                    stroke-width="3"
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <div>
                            <span class="block text-sm font-bold text-slate-900"
                                >共有ノート閲覧 無制限</span
                            >
                            <span class="text-xs text-slate-500"
                                >先輩や友人のノートが見放題</span
                            >
                        </div>
                    </li>
                    <li class="flex items-start gap-3">
                        <div
                            class="bg-indigo-100 p-1 rounded-full text-indigo-600 mt-0.5"
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
                                    stroke-width="3"
                                    d="M5 13l4 4L19 7"
                                />
                            </svg>
                        </div>
                        <div>
                            <span class="block text-sm font-bold text-slate-900"
                                >優先サポート & 最新機能</span
                            >
                            <span class="text-xs text-slate-500"
                                >新機能をいち早く体験</span
                            >
                        </div>
                    </li>
                </ul>

                <div class="flex flex-col gap-3">
                    <button
                        onclick={handleUpgrade}
                        class="w-full py-4 rounded-xl bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-bold text-base shadow-lg shadow-indigo-500/30 hover:shadow-indigo-500/50 hover:scale-[1.02] transition-all flex items-center justify-center gap-2"
                    >
                        <span>プランを確認する</span>
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
                                d="M14 5l7 7m0 0l-7 7m7-7H3"
                            />
                        </svg>
                    </button>
                    <button
                        onclick={onClose}
                        class="w-full py-3 rounded-xl text-slate-400 font-bold text-sm hover:bg-slate-50 transition-colors"
                    >
                        閉じる
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
