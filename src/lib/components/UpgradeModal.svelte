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
                title: "アプリ内の全機能が使い放題",
                desc: "ノート生成や課題アシストが無制限になります",
            },
            {
                title: "動画・音声ファイルの完全解析",
                desc: "音声・動画等の録画講義の無制限解析が可能に",
            },
            {
                title: "講義ノート検索・試験対策",
                desc: "みんなのノートが見放題、バインダーでまとめ機能が解禁",
            },
        ],
    } = $props();
    import { auth } from "$lib/firebase";
    import { userProfile } from "$lib/stores";

    let isPremiumUser = $derived($userProfile?.plan === "premium");

    let promoCode = $state("");
    let isRedeeming = $state(false);
    let redeemError = $state<string | null>(null);
    let redeemSuccess = $state(false);
    let redeemedPlanName = $state("");

    function handleUpgrade() {
        goto("/pricing");
    }

    async function redeemCode() {
        if (!promoCode.trim()) return;
        isRedeeming = true;
        redeemError = null;

        try {
            const user = auth.currentUser;
            if (!user) {
                redeemError = "ログインが必要です";
                return;
            }
            const token = await user.getIdToken();
            const res = await fetch("/api/redeem-code", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ code: promoCode }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "適用に失敗しました");
            }

            const rawPlan = data.targetPlan?.toLowerCase() || "";
            redeemedPlanName =
                rawPlan === "ultimate"
                    ? "アルティメットプラン"
                    : "プレミアムプラン";

            redeemSuccess = true;
            // 短時間待ってから閉じてリロード
            setTimeout(() => {
                onClose();
                window.location.reload();
            }, 2000);
        } catch (e: any) {
            redeemError = e.message;
        } finally {
            isRedeeming = false;
        }
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
                        <span
                            >{isPremiumUser
                                ? "お得にアップグレードする"
                                : "プランを確認する"}</span
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

                    <!-- Promo Code Section -->
                    <div class="mt-4 pt-4 border-t border-slate-100">
                        {#if redeemSuccess}
                            <div
                                class="text-center p-3 bg-emerald-50 rounded-xl border border-emerald-100"
                            >
                                <p class="text-emerald-600 font-bold text-sm">
                                    🎉 {redeemedPlanName}にアップグレードされました！
                                </p>
                                <p class="text-xs text-emerald-500 mt-1">
                                    画面を更新します...
                                </p>
                            </div>
                        {:else}
                            <p
                                class="text-xs font-bold text-slate-500 mb-2 flex items-center justify-between"
                            >
                                プロモコードでプレミアムへアップグレード
                                {#if redeemError}
                                    <span class="text-red-500 font-medium"
                                        >{redeemError}</span
                                    >
                                {/if}
                            </p>
                            <div class="flex gap-2">
                                <input
                                    type="text"
                                    bind:value={promoCode}
                                    placeholder="コードを入力..."
                                    class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono uppercase"
                                    disabled={isRedeeming}
                                />
                                <button
                                    onclick={redeemCode}
                                    disabled={isRedeeming || !promoCode.trim()}
                                    class="px-4 py-2 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[5rem]"
                                >
                                    {#if isRedeeming}
                                        <div
                                            class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mx-auto"
                                        ></div>
                                    {:else}
                                        適用
                                    {/if}
                                </button>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>
    </div>
{/if}
