<script lang="ts">
    import { onMount } from "svelte";
    import { auth, db } from "$lib/firebase";
    import { doc, getDoc, onSnapshot } from "firebase/firestore";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import { subjects, lectures } from "$lib/stores";
    import { userProfile } from "$lib/userStore";
    import { fade, scale } from "svelte/transition";

    let authUser = $state<any>(null);
    let userData = $state<any>(null);
    let subDetails = $state<any>(null);
    let loading = $state(true);
    let portalLoading = $state(false);
    let showConfetti = $state(false);
    let successMessage = $state(false);
    let isSlowSync = $state(false);
    let planLevel = $derived.by(() => {
        const p = String(userData?.plan || "")
            .toLowerCase()
            .trim();
        if (p === "ultimate") return "ULTIMATE";
        if (p === "premium" || p === "pro" || p === "season") return "PREMIUM";
        return "FREE";
    });

    const isSuccess = $page.url.searchParams.get("success") === "true";

    onMount(() => {
        const unsubAuth = auth.onAuthStateChanged(async (currentUser) => {
            if (currentUser) {
                authUser = currentUser;

                // Set up real-time listener for user profile to handle instant updates
                const unsubProfile = onSnapshot(
                    doc(db, "users", currentUser.uid),
                    (docSnap) => {
                        if (docSnap.exists()) {
                            userData = docSnap.data();
                            userProfile.set(userData); // Keep global store in sync
                            console.log(
                                "Profile snapshot update received:",
                                userData.plan,
                            );
                        }
                    },
                );

                // Fetch expanded subscription details from our API
                fetchSubscriptionDetails(currentUser);

                if (isSuccess) {
                    await currentUser.getIdToken(true); // Force token refresh
                    triggerSuccessEffects();
                }
            } else {
                goto("/login");
            }
            // Ensure loading is resolved even if snap is delayed
            setTimeout(() => (loading = false), 1500);
        });

        return () => unsubAuth();
    });

    async function fetchSubscriptionDetails(user: any) {
        try {
            const token = await user.getIdToken();
            const res = await fetch("/api/subscription", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });
            subDetails = await res.json();
        } catch (e) {
            console.error("Failed to fetch subscription details", e);
        }
    }

    function triggerSuccessEffects() {
        showConfetti = true;
        successMessage = true;
        // Clean up URL params without refreshing
        const url = new URL(window.location.href);
        url.searchParams.delete("success");
        window.history.replaceState({}, "", url);

        setTimeout(() => {
            showConfetti = false;
        }, 5000);

        setTimeout(() => {
            successMessage = false;
        }, 8000);
    }

    import { Browser } from "@capacitor/browser";
    import { Capacitor } from "@capacitor/core";

    async function handlePortal() {
        if (!authUser) return;
        portalLoading = true;
        try {
            const token = await authUser.getIdToken();
            const res = await fetch("/api/portal", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });
            const data = await res.json();
            if (data.url) {
                if (Capacitor.isNativePlatform()) {
                    await Browser.open({ url: data.url });
                } else {
                    window.location.href = data.url;
                }
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (e: any) {
            console.error(e);
            alert(
                "ポータルへの移動に失敗しました: " +
                    (e.message || "不明なエラー"),
            );
        } finally {
            portalLoading = false;
        }
    }

    function formatDate(timestamp: number) {
        if (!timestamp) return "-";
        return new Date(timestamp * 1000).toLocaleDateString("ja-JP", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
    }

    async function handleLogout() {
        await auth.signOut();
        goto("/login");
    }

    async function forceRefresh() {
        if (!authUser) return;
        loading = true;
        try {
            const docSnap = await getDoc(doc(db, "users", authUser.uid));
            if (docSnap.exists()) {
                userData = docSnap.data();
                userProfile.set(userData);
                console.log("Force refresh successful:", userData.plan);
            }
        } catch (e) {
            console.error("Force refresh failed:", e);
        } finally {
            loading = false;
        }
    }

    // --- Redirection & Timeout Logic ---
    let showHomeButton = $state(false);

    function redirectionTimer(node: HTMLElement) {
        const timeout = setTimeout(() => {
            showHomeButton = true;
        }, 3000);

        const slowTimeout = setTimeout(() => {
            isSlowSync = true;
        }, 10000);

        const unsub = $effect.root(() => {
            $effect(() => {
                if (planLevel !== "FREE") {
                    console.log(
                        "Plan update detected (",
                        planLevel,
                        "). Triggering automatic redirection to Home.",
                    );
                    clearTimeout(timeout);
                    clearTimeout(slowTimeout);
                    setTimeout(() => goto("/"), 500); // Fast redirection
                }
            });
        });

        return {
            destroy() {
                clearTimeout(timeout);
                clearTimeout(slowTimeout);
                unsub();
            },
        };
    }

    function triggerConfetti(node: HTMLElement) {
        showConfetti = true;
        setTimeout(() => (showConfetti = false), 5000);
    }
</script>

<!-- Confetti Effect (Simple CSS and Svelte) -->
{#if showConfetti}
    <div class="fixed inset-0 pointer-events-none z-[100] overflow-hidden">
        {#each Array(50) as _, i}
            <div
                class="absolute w-2 h-2 rounded-sm animate-confetti"
                style="
                    left: {Math.random() * 100}%; 
                    background-color: {[
                    '#6366f1',
                    '#ec4899',
                    '#f59e0b',
                    '#10b981',
                    '#3b82f6',
                ][Math.floor(Math.random() * 5)]};
                    animation-delay: {Math.random() * 3}s;
                    animation-duration: {2 + Math.random() * 2}s;
                    --tx: {(Math.random() - 0.5) * 200}px;
                "
            ></div>
        {/each}
    </div>
{/if}

<!-- Success Toast -->
{#if successMessage}
    <div
        transition:fade
        class="fixed top-8 left-1/2 -translate-x-1/2 z-[110] w-full max-w-sm px-4"
    >
        <div
            class="bg-indigo-600 text-white rounded-2xl shadow-2xl p-4 flex items-center gap-4 border border-indigo-400"
        >
            <div class="bg-white/20 p-2 rounded-full">
                <svg
                    class="w-6 h-6"
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
                <p class="font-bold">ご購入ありがとうございます！</p>
                <p class="text-sm text-indigo-100">
                    プランが正常に反映されました。
                </p>
            </div>
        </div>
    </div>
{/if}

<div class="flex-1 relative overflow-y-auto bg-slate-50 pt-16 lg:pt-0">
    <main class="max-w-3xl mx-auto py-8 lg:py-12 px-4 lg:px-12">
        <nav
            class="flex items-center gap-2 text-sm font-medium text-slate-500 mb-6"
        >
            <button
                onclick={() => goto("/settings")}
                class="hover:text-slate-800 transition-colors">設定</button
            >
            <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                ><path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 5l7 7-7 7"
                /></svg
            >
            <span class="text-slate-900">サブスクリプション</span>
        </nav>

        <h1 class="text-3xl font-bold text-slate-900 mb-8 tracking-tight">
            サブスクリプション管理
        </h1>

        {#if loading}
            <div class="text-center py-24">
                <div
                    class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"
                ></div>
                <p class="mt-4 text-slate-500 font-medium animate-pulse">
                    読み込み中...
                </p>
            </div>
        {:else if isSuccess && planLevel === "FREE"}
            <!-- Redirection Logic with Timeout -->
            <div use:redirectionTimer></div>
            <!-- Improved Sync UX: Waiting for Webhook -->
            <div
                class="text-center py-24 bg-white rounded-[2rem] border border-indigo-100 shadow-sm animate-in fade-in zoom-in"
            >
                <div class="relative w-24 h-24 mx-auto mb-8">
                    <div
                        class="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-20"
                    ></div>
                    <div
                        class="relative bg-white rounded-full w-24 h-24 flex items-center justify-center border-4 border-indigo-500 shadow-inner"
                    >
                        <span class="text-4xl animate-bounce">⏳</span>
                    </div>
                </div>
                <h2 class="text-2xl font-black text-slate-900 mb-2">
                    プランを有効化しています...
                </h2>
                <p class="text-slate-500 mb-8 max-w-sm mx-auto px-4">
                    決済が完了しました。現在プランを反映させています。このまま数秒お待ちください。
                </p>
                <div class="flex flex-col items-center gap-4">
                    <div
                        class="flex items-center gap-2 text-indigo-600 font-bold text-sm"
                    >
                        <div
                            class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"
                        ></div>
                        <div
                            class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.2s]"
                        ></div>
                        <div
                            class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce [animation-delay:0.4s]"
                        ></div>
                        同期中
                    </div>

                    {#if showHomeButton}
                        <button
                            onclick={() => goto("/")}
                            class="w-full max-w-xs py-3 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-lg animate-in slide-in-from-bottom-2"
                        >
                            ホームへ戻る
                        </button>
                    {/if}

                    <button
                        onclick={() => window.location.reload()}
                        class="text-xs text-slate-400 font-medium underline hover:text-indigo-500 transition-colors"
                    >
                        画面が切り替わらない場合はこちら
                    </button>

                    {#if isSlowSync}
                        <button
                            onclick={forceRefresh}
                            class="mt-4 px-6 py-3 bg-indigo-50 text-indigo-700 rounded-xl font-bold text-sm hover:bg-indigo-100 transition-all border border-indigo-100 animate-in fade-in slide-in-from-top-2"
                        >
                            🔄 同期が遅れています（手動で更新を確認）
                        </button>
                    {/if}
                </div>
            </div>
        {:else}
            {#if isSuccess}
                <div use:triggerConfetti></div>
            {/if}
            <div class="space-y-6">
                <!-- Current Plan Card -->
                <div
                    class="bg-white rounded-3xl shadow-sm border border-slate-200 p-8 relative overflow-hidden"
                >
                    {#if planLevel !== "FREE"}
                        <div class="absolute top-0 right-0 p-6 opacity-10">
                            <svg
                                class="w-24 h-24"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                                ><path
                                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2z"
                                /></svg
                            >
                        </div>
                    {/if}

                    <div
                        class="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10"
                    >
                        <div>
                            <h3
                                class="text-sm font-bold text-slate-500 uppercase tracking-widest mb-1"
                            >
                                現在のプラン
                            </h3>
                            <div class="flex items-center gap-3">
                                <p
                                    class="text-4xl font-black text-slate-900 tracking-tight"
                                >
                                    {#if planLevel === "ULTIMATE"}
                                        アルティメットプラン
                                    {:else if planLevel === "PREMIUM"}
                                        プレミアムプラン
                                    {:else}
                                        フリープラン
                                    {/if}
                                </p>
                                {#if planLevel !== "FREE"}
                                    <span
                                        class="bg-indigo-600 text-white text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider"
                                        >Active</span
                                    >
                                {/if}
                            </div>
                        </div>

                        {#if planLevel === "FREE"}
                            <button
                                onclick={() => goto("/pricing")}
                                class="bg-indigo-600 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:-translate-y-0.5 transition-all active:translate-y-0"
                            >
                                プレミアムにアップグレード
                            </button>
                        {/if}
                    </div>

                    <div
                        class="mt-8 pt-8 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-8"
                    >
                        <div>
                            <h4
                                class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2"
                            >
                                利用可能機能
                            </h4>
                            <ul class="space-y-2">
                                {#if planLevel === "FREE"}
                                    <li
                                        class="flex items-center gap-2 text-sm text-slate-600"
                                    >
                                        <span class="text-indigo-500 font-bold"
                                            >✓</span
                                        > 授業分析（月5回まで）
                                    </li>
                                    <li
                                        class="flex items-center gap-2 text-sm text-slate-600"
                                    >
                                        <span class="text-indigo-500 font-bold"
                                            >✓</span
                                        > 文字数制限（500文字）
                                    </li>
                                {:else}
                                    <li
                                        class="flex items-center gap-2 text-sm text-slate-600"
                                    >
                                        <span class="text-indigo-500 font-bold"
                                            >✓</span
                                        > 授業分析（無制限）
                                    </li>
                                    {#if planLevel === "ULTIMATE"}
                                        <li
                                            class="flex items-center gap-2 text-sm text-slate-600"
                                        >
                                            <span
                                                class="text-indigo-500 font-bold"
                                                >✓</span
                                            > 動画・オーディオ分析
                                        </li>
                                    {/if}
                                    <li
                                        class="flex items-center gap-2 text-sm text-slate-600"
                                    >
                                        <span class="text-indigo-500 font-bold"
                                            >✓</span
                                        > 高度な分析モード
                                    </li>
                                    <li
                                        class="flex items-center gap-2 text-sm text-slate-600"
                                    >
                                        <span class="text-indigo-500 font-bold"
                                            >✓</span
                                        > 長文サポート
                                    </li>
                                {/if}
                            </ul>
                        </div>

                        {#if subDetails?.subscribed}
                            <div>
                                <h4
                                    class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2"
                                >
                                    {subDetails.cancel_at_period_end
                                        ? "利用終了予定日"
                                        : "次回の支払い予定日"}
                                </h4>
                                <p class="text-lg font-bold text-slate-800">
                                    {formatDate(subDetails.current_period_end)}
                                </p>
                                {#if subDetails.cancel_at_period_end}
                                    <p
                                        class="text-xs text-amber-600 font-medium mt-1 italic"
                                    >
                                        ※解約予約済みです
                                    </p>
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Actions Area -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {#if planLevel !== "FREE"}
                        <button
                            onclick={handlePortal}
                            disabled={portalLoading}
                            class="flex items-center justify-between p-6 bg-white rounded-2xl border border-slate-200 hover:bg-slate-50 transition-all group disabled:opacity-50"
                        >
                            <div class="flex items-center gap-4">
                                <div
                                    class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-white group-hover:shadow-sm transition-all"
                                >
                                    {#if portalLoading}
                                        <div
                                            class="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"
                                        ></div>
                                    {:else}
                                        <svg
                                            class="w-5 h-5"
                                            fill="none"
                                            viewBox="0 0 24 24"
                                            stroke="currentColor"
                                            ><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                                            /><path
                                                stroke-linecap="round"
                                                stroke-linejoin="round"
                                                stroke-width="2"
                                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                            /></svg
                                        >
                                    {/if}
                                </div>
                                <div class="text-left">
                                    <p class="font-bold text-slate-800">
                                        支払い・解約の管理
                                    </p>
                                    <p class="text-xs text-slate-400">
                                        Stripeポータルへ移動します
                                    </p>
                                </div>
                            </div>
                            <svg
                                class="w-5 h-5 text-slate-300 group-hover:translate-x-1 transition-transform"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                ><path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M9 5l7 7-7 7"
                                /></svg
                            >
                        </button>
                    {/if}

                    <button
                        onclick={() => goto("/pricing")}
                        class="flex items-center justify-between p-6 bg-white rounded-2xl border border-slate-200 hover:bg-slate-50 transition-all group"
                    >
                        <div class="flex items-center gap-4">
                            <div
                                class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-white group-hover:shadow-sm transition-all"
                            >
                                <svg
                                    class="w-5 h-5"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                    stroke="currentColor"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                                    /></svg
                                >
                            </div>
                            <div class="text-left">
                                <p class="font-bold text-slate-800">
                                    プラン一覧を表示
                                </p>
                                <p class="text-xs text-slate-400">
                                    料金プランを確認します
                                </p>
                            </div>
                        </div>
                        <svg
                            class="w-5 h-5 text-slate-300 group-hover:translate-x-1 transition-transform"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M9 5l7 7-7 7"
                            /></svg
                        >
                    </button>
                </div>

                <p class="text-center text-xs text-slate-400 py-8">
                    決済はすべて Stripe を通じて安全に行われます。<br />
                    ご不明な点はサポートまでお問い合わせください。
                </p>
            </div>
        {/if}
    </main>
</div>

<style>
    @keyframes confetti {
        0% {
            transform: translateY(-10vh) translateX(0) rotate(0deg);
            opacity: 1;
        }
        100% {
            transform: translateY(110vh) translateX(var(--tx)) rotate(720deg);
            opacity: 0;
        }
    }
    .animate-confetti {
        animation-name: confetti;
        animation-timing-function: ease-out;
        animation-fill-mode: forwards;
    }
</style>
