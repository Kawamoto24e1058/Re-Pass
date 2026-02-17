<script lang="ts">
    import { goto } from "$app/navigation";
    import { fade, fly } from "svelte/transition";

    let {
        isOpen = false,
        onClose,
        title = "機能をアンロック",
        message = "この機能を利用するにはプランのアップグレードが必要です。",
        features = [
            {
                title: "高度な解析モード",
                desc: "レポートや感想文形式での書き出し",
            },
            { title: "上限の拡張", desc: "文字数制限や回数制限の解除" },
            { title: "優先サポート", desc: "不具合対応や要望の優先受領" },
        ],
    } = $props();

    function handleUpgrade() {
        goto("/pricing");
    }

    $effect(() => {
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
        };
    });
</script>

{#if isOpen}
    <div
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
        role="dialog"
        aria-modal="true"
    >
        <!-- Backdrop -->
        <div
            transition:fade={{ duration: 200 }}
            class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onclick={onClose}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === "Escape" && onClose()}
        ></div>

        <!-- Modal Content -->
        <div
            transition:fly={{ y: 20, duration: 400 }}
            class="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col"
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
                        <span class="text-3xl">✨</span>
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
                    {#each features as feature}
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
                                <span
                                    class="block text-sm font-bold text-slate-900"
                                    >{feature.title}</span
                                >
                                <span class="text-xs text-slate-500"
                                    >{feature.desc}</span
                                >
                            </div>
                        </li>
                    {/each}
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
