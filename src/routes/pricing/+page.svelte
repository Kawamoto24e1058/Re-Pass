<script lang="ts">
    import { auth, db } from "$lib/firebase";
    import { doc, setDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { userProfile } from "$lib/stores";
    import {
        PUBLIC_STRIPE_PUBLISHABLE_KEY,
        PUBLIC_STRIPE_PRICE_PREMIUM,
        PUBLIC_STRIPE_PRICE_SEASON,
        PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY,
        PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON,
    } from "$env/static/public";

    // Local placeholders removed, using env vars

    let isLoading = $state(""); // "Premium_Monthly", "Ultimate_Season", etc. or empty
    let billingCycle = $state("season"); // "monthly" | "season" (Default to Season for upsell)

    onMount(() => {
        if (
            !PUBLIC_STRIPE_PUBLISHABLE_KEY ||
            PUBLIC_STRIPE_PUBLISHABLE_KEY === "pk_test_placeholder"
        ) {
            console.warn("Stripe API Key is missing. Check your .env file.");
        }
    });

    import { Browser } from "@capacitor/browser";
    import { Capacitor } from "@capacitor/core";

    let currentPlan = $derived($userProfile?.plan || "free");
    let isPremiumUser = $derived(currentPlan === "premium");

    async function handlePurchase(
        priceId: string,
        planId: string,
        isUpgrade: boolean = false,
    ) {
        const user = auth.currentUser;
        if (!user) {
            goto("/login");
            return;
        }

        // Check for placeholder keys
        if (priceId.includes("placeholder")) {
            alert("このプランは現在準備中です。");
            return;
        }

        isLoading = planId;

        try {
            const token = await user.getIdToken();
            const response = await fetch("/api/checkout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    priceId,
                    userId: user.uid,
                    email: user.email,
                    isUpgrade,
                }),
            });

            const data = await response.json();
            if (data.url) {
                if (Capacitor.isNativePlatform()) {
                    await Browser.open({ url: data.url });
                } else {
                    window.location.href = data.url;
                }
            } else {
                throw new Error(data.error || "Checkout failed");
            }
        } catch (error) {
            console.error("Error initiating checkout:", error);
            alert("決済システムの準備中です。しばらくお待ちください。");
        } finally {
            setTimeout(() => {
                if (window.location.pathname === "/pricing") {
                    isLoading = "";
                }
            }, 5000);
        }
    }

    async function selectFreePlan() {
        const user = auth.currentUser;
        if (!user) {
            goto("/login");
            return;
        }

        try {
            await setDoc(
                doc(db, "users", user.uid),
                {
                    plan: "free",
                    updatedAt: serverTimestamp(),
                },
                { merge: true },
            );
            goto("/");
        } catch (e) {
            alert("エラーが発生しました。");
        }
    }

    let promoCode = $state("");
    let isRedeeming = $state(false);
    let redeemError = $state<string | null>(null);
    let redeemSuccess = $state(false);
    let redeemedPlanName = $state("");

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
            setTimeout(() => {
                goto("/");
            }, 2000);
        } catch (e: any) {
            redeemError = e.message;
        } finally {
            isRedeeming = false;
        }
    }
</script>

<div
    class="min-h-screen bg-[#F9FAFB] flex flex-col items-center pt-20 pb-40 px-6 font-sans selection:bg-indigo-100 relative overflow-y-auto"
    style="height: auto !important;"
>
    <!-- Back Button -->
    <div class="absolute top-8 left-8">
        <button
            onclick={() => history.back()}
            class="group flex items-center gap-2 text-slate-400 hover:text-slate-600 transition-colors text-sm font-bold"
        >
            <div
                class="w-8 h-8 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-sm group-hover:shadow group-hover:-translate-x-0.5 transition-all"
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
                        d="M15 19l-7-7 7-7"
                    />
                </svg>
            </div>
            戻る
        </button>
    </div>

    <!-- Header -->
    <div
        class="text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700"
    >
        <span
            class="text-indigo-600 font-bold tracking-wider uppercase text-xs mb-2 block"
        >
            Pricing Plans
        </span>
        <h1
            class="text-3xl md:text-5xl font-black text-slate-900 mb-6 tracking-tight"
        >
            学生生活を、<span
                class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-pink-600"
                >圧倒的に効率化。</span
            >
        </h1>
        <p class="text-slate-500 max-w-xl mx-auto text-lg leading-relaxed">
            必要な機能に合わせて選べる3つのプラン。<br />
            4ヶ月パスなら、1学期分をお得にカバーできます。
        </p>
    </div>

    <!-- Billing Toggle -->
    <div
        class="flex items-center justify-center gap-4 mb-12 animate-in fade-in zoom-in duration-500 delay-100"
    >
        <button
            onclick={() => (billingCycle = "monthly")}
            class="text-sm font-bold px-4 py-2 rounded-full transition-all {billingCycle ===
            'monthly'
                ? 'bg-slate-900 text-white shadow-lg'
                : 'text-slate-500 hover:bg-slate-100'}"
        >
            月額払い
        </button>
        <button
            onclick={() => (billingCycle = "season")}
            class="text-sm font-bold px-4 py-2 rounded-full transition-all flex items-center gap-2 {billingCycle ===
            'season'
                ? 'bg-gradient-to-r from-indigo-600 to-pink-600 text-white shadow-lg shadow-indigo-500/30'
                : 'text-slate-500 hover:bg-slate-100'}"
        >
            4ヶ月パス
            <span
                class="bg-white/20 text-white px-2 py-0.5 rounded text-[10px] uppercase tracking-wider backdrop-blur-sm"
                >Save 37%</span
            >
        </button>
    </div>

    <div class="grid lg:grid-cols-3 gap-6 w-full max-w-7xl items-start">
        <!-- 1. FREE -->
        <div
            class="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm hover:shadow-lg transition-all duration-300 flex flex-col group animate-in fade-in slide-in-from-bottom-8 delay-100 order-2 lg:order-1"
        >
            <div class="mb-6">
                <h3
                    class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                >
                    Free
                </h3>
                <div class="text-4xl font-black text-slate-900 mb-2">¥0</div>
                <p class="text-xs text-slate-500 font-medium h-4">ずっと無料</p>
                <p class="text-slate-500 text-sm mt-4 leading-relaxed h-10">
                    1日3回まで。まずはお試し。<br />基本機能でサクッと要約。
                </p>
            </div>

            <ul class="space-y-3 mb-8 flex-1">
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span>ノート生成（1日1回まで）</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span>PDF・画像・Webサイト(URL)の解析</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span>リアルタイム音声文字起こし</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through"
                        >課題・問題アシスト（AI家庭教師）</span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through">動画・音声ファイルの解析</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through">みんなの講義ノート検索</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through">試験対策まとめ機能</span>
                </li>
            </ul>

            <button
                onclick={selectFreePlan}
                disabled={currentPlan === "free"}
                class="w-full py-3 rounded-xl transition-all font-bold text-sm {currentPlan ===
                'free'
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}"
            >
                {currentPlan === "free" ? "加入中" : "無料で始める"}
            </button>
        </div>

        <!-- 2. PREMIUM -->
        <div
            class="bg-white rounded-[2rem] p-8 border-2 border-indigo-100 shadow-xl shadow-indigo-100/50 hover:shadow-2xl hover:shadow-indigo-200/50 transition-all duration-300 flex flex-col group animate-in fade-in slide-in-from-bottom-8 delay-200 order-2 lg:order-2 relative"
        >
            <!-- Standard Badge -->
            <div class="absolute top-0 right-0 p-5">
                <span
                    class="bg-indigo-50 text-indigo-600 text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border border-indigo-200 shadow-sm"
                >
                    Standard
                </span>
            </div>

            <div class="mb-6 relative z-10">
                <h3
                    class="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-4"
                >
                    Premium
                </h3>
                <div
                    class="text-4xl font-black text-slate-900 mb-2 transition-all duration-300"
                >
                    {#if billingCycle === "monthly"}
                        ¥780<span
                            class="text-sm text-slate-400 font-medium ml-1"
                            >/月</span
                        >
                    {:else}
                        ¥2,480<span
                            class="text-sm text-slate-400 font-medium ml-1"
                            >/4ヶ月</span
                        >
                    {/if}
                </div>
                <p class="text-xs text-indigo-600 font-bold h-4">
                    {#if billingCycle === "season"}月あたり ¥495 (超お得!){/if}
                </p>
                <p class="text-slate-500 text-sm mt-4 leading-relaxed h-10">
                    生成・アシスト機能が無制限。<br
                    />日々の課題や講義を完璧にサポート。
                </p>
            </div>

            <ul class="space-y-3 mb-8 flex-1 relative z-10">
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span
                        >ノート生成 <strong class="text-indigo-600"
                            >無制限</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span
                        >課題・問題アシスト（AI家庭教師）<strong
                            class="text-indigo-600">無制限</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-indigo-500 mt-0.5">✔</span>
                    <span>シラバス画像からの自動履修登録</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-600">
                    <span class="text-amber-500 mt-0.5 font-bold">⚠</span>
                    <span
                        >動画・音声ファイルの解析<br /><span
                            class="text-xs text-slate-400">（1日3回まで）</span
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through">みんなの講義ノート検索</span>
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-400">
                    <span class="text-slate-300 mt-0.5">✕</span>
                    <span class="line-through">試験対策まとめ機能</span>
                </li>
            </ul>

            <button
                onclick={() =>
                    handlePurchase(
                        billingCycle === "monthly"
                            ? PUBLIC_STRIPE_PRICE_PREMIUM
                            : PUBLIC_STRIPE_PRICE_SEASON,
                        billingCycle === "monthly"
                            ? "Premium_Monthly"
                            : "Premium_Season",
                    )}
                disabled={isLoading !== "" || currentPlan !== "free"}
                class="w-full py-3 rounded-xl transition-all font-bold text-sm {currentPlan ===
                'free'
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'} disabled:opacity-50"
            >
                {#if isLoading === "Premium_Monthly" || isLoading === "Premium_Season"}
                    処理中...
                {:else if currentPlan === "premium"}
                    加入中
                {:else if currentPlan === "ultimate"}
                    上位プランに加入中
                {:else}
                    PREMIUMを選択
                {/if}
            </button>
            <p
                class="mt-4 text-[10px] text-slate-400 text-center leading-relaxed"
            >
                購入を確定することで、
                <a
                    href="/terms"
                    target="_blank"
                    class="text-indigo-600 hover:underline">利用規約</a
                >
                および
                <a
                    href="/legal/notation"
                    target="_blank"
                    class="text-indigo-600 hover:underline"
                    >特定商取引法に基づく表記</a
                >
                （返金ポリシー含む）に同意したものとみなされます。
            </p>
        </div>

        <!-- 3. ULTIMATE -->
        <div
            class="bg-slate-900 rounded-[2rem] p-8 border border-slate-800 shadow-2xl shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:-translate-y-1 transition-all duration-300 flex flex-col group animate-in fade-in slide-in-from-bottom-8 delay-300 relative overflow-hidden order-1 lg:order-3"
        >
            <!-- Badge -->
            <div class="absolute top-0 right-0 p-5">
                <span
                    class="bg-gradient-to-r from-indigo-500 to-pink-500 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest shadow-lg"
                >
                    Best Value
                </span>
            </div>

            <div class="mb-6 relative z-10">
                <h3
                    class="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4"
                >
                    Ultimate {isPremiumUser ? "(アップグレード)" : ""}
                </h3>
                <div
                    class="text-4xl font-black text-white mb-2 transition-all duration-300"
                >
                    {#if billingCycle === "monthly"}
                        {#if isPremiumUser}
                            <div
                                class="text-sm text-slate-400 line-through mb-1"
                            >
                                通常価格 ¥1,480/月
                            </div>
                            <div class="text-red-500 font-bold text-lg">
                                プレミアム限定：＋¥700/月で動画無制限＆検索解放
                            </div>
                        {:else}
                            ¥1,480<span
                                class="text-sm text-slate-400 font-medium ml-1"
                                >/月</span
                            >
                        {/if}
                    {:else if isPremiumUser}
                        <div class="text-sm text-slate-400 line-through mb-1">
                            通常価格 ¥4,980/4ヶ月
                        </div>
                        <div class="text-red-500 font-bold text-lg">
                            プレミアム限定：＋¥2,500で今学期をフルアンロック
                        </div>
                    {:else}
                        ¥4,980<span
                            class="text-sm text-slate-400 font-medium ml-1"
                            >/4ヶ月</span
                        >
                    {/if}
                </div>
                <p class="text-xs text-pink-400 font-bold h-4">
                    {#if billingCycle === "season" && !isPremiumUser}月あたり
                        約¥570 (Premiumよりお得!){/if}
                </p>
                <p class="text-slate-300 text-sm mt-4 leading-relaxed h-10">
                    大学攻略の完全版。<br />全ての機能が使い放題。
                </p>
            </div>

            <ul class="space-y-3 mb-8 flex-1 relative z-10">
                <li class="flex items-start gap-3 text-sm text-slate-300">
                    <div class="bg-indigo-500/20 p-0.5 rounded-full">
                        <svg
                            class="w-3 h-3 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            /></svg
                        >
                    </div>
                    <span
                        >ノート生成 <strong
                            class="text-white border-b border-indigo-500/50"
                            >完全無制限</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-300">
                    <div class="bg-indigo-500/20 p-0.5 rounded-full">
                        <svg
                            class="w-3 h-3 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            /></svg
                        >
                    </div>
                    <span
                        >動画・音声ファイルの解析 <strong
                            class="text-white border-b border-indigo-500/50"
                            >完全無制限</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-300">
                    <div class="bg-indigo-500/20 p-0.5 rounded-full">
                        <svg
                            class="w-3 h-3 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            /></svg
                        >
                    </div>
                    <span
                        >みんなの講義ノート検索 <strong
                            class="text-white border-b border-indigo-500/50"
                            >（見放題）</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-300">
                    <div class="bg-indigo-500/20 p-0.5 rounded-full">
                        <svg
                            class="w-3 h-3 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            /></svg
                        >
                    </div>
                    <span
                        >バインダーでの<strong class="text-white"
                            >試験対策まとめ機能</strong
                        ></span
                    >
                </li>
                <li class="flex items-start gap-3 text-sm text-slate-300">
                    <div class="bg-indigo-500/20 p-0.5 rounded-full">
                        <svg
                            class="w-3 h-3 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="3"
                                d="M5 13l4 4L19 7"
                            /></svg
                        >
                    </div>
                    <span
                        >アプリ内の<strong class="text-white"
                            >全機能が使い放題</strong
                        ></span
                    >
                </li>
            </ul>

            <div
                class="text-[10px] text-slate-500 mt-4 leading-relaxed opacity-60 px-2 mb-4"
            >
                ※Ultimateプランのメディア解析は原則無制限ですが、システム保護のため、常識の範囲を大きく超える機械的な大量アップロードが検知された場合、一時的に制限をかける場合があります。
            </div>

            <button
                onclick={() =>
                    handlePurchase(
                        billingCycle === "monthly"
                            ? PUBLIC_STRIPE_PRICE_ULTIMATE_MONTHLY
                            : PUBLIC_STRIPE_PRICE_ULTIMATE_SEASON,
                        billingCycle === "monthly"
                            ? "Ultimate_Monthly"
                            : "Ultimate_Season",
                        isPremiumUser,
                    )}
                disabled={isLoading !== "" || currentPlan === "ultimate"}
                class="w-full py-4 rounded-xl transition-all shadow-lg font-bold text-sm {currentPlan ===
                'ultimate'
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-indigo-600 to-pink-600 text-white hover:scale-[1.02] shadow-indigo-600/20'} disabled:opacity-50"
            >
                {#if isLoading === "Ultimate_Monthy" || isLoading === "Ultimate_Season"}
                    処理中...
                {:else if currentPlan === "ultimate"}
                    加入中
                {:else if isPremiumUser}
                    お得にアップグレードする
                {:else}
                    Ultimateに参加
                {/if}
            </button>
            <p
                class="mt-4 text-[10px] text-slate-300 text-center leading-relaxed opacity-60"
            >
                購入を確定することで、
                <a
                    href="/terms"
                    target="_blank"
                    class="text-indigo-400 hover:underline">利用規約</a
                >
                および
                <a
                    href="/legal/notation"
                    target="_blank"
                    class="text-indigo-400 hover:underline"
                    >特定商取引法に基づく表記</a
                >
                （返金ポリシー含む）に同意したものとみなされます。
            </p>
        </div>
    </div>

    <!-- Promo Code Section -->
    <div
        class="mt-8 w-full max-w-md mx-auto bg-white rounded-3xl p-6 border border-slate-200 shadow-sm relative z-20 animate-in fade-in slide-in-from-bottom-8 delay-300"
    >
        <h3
            class="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 text-center"
        >
            プロモコードでプレミアムへアップグレード
        </h3>

        {#if redeemSuccess}
            <div
                class="text-center p-4 bg-emerald-50 rounded-2xl border border-emerald-100"
            >
                <p class="text-emerald-600 font-bold text-sm">
                    🎉 {redeemedPlanName}にアップグレードされました！
                </p>
                <p class="text-xs text-emerald-500 mt-1">
                    ホーム画面へ移動します...
                </p>
            </div>
        {:else}
            {#if redeemError}
                <div
                    class="mb-3 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl border border-red-100 text-center"
                >
                    {redeemError}
                </div>
            {/if}
            <div class="flex gap-2">
                <input
                    type="text"
                    bind:value={promoCode}
                    placeholder="招待コードを入力..."
                    class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all font-mono"
                    disabled={isRedeeming}
                />
                <button
                    onclick={redeemCode}
                    disabled={isRedeeming || !promoCode.trim()}
                    class="px-5 py-3 bg-slate-900 text-white font-bold text-sm rounded-xl hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-w-[6rem] shadow-sm"
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

    <!-- Payment Methods -->
    <div
        class="mt-12 flex items-center gap-6 opacity-60 grayscale hover:grayscale-0 transition-all"
    >
        <div
            class="h-6 w-16 bg-white rounded border border-slate-200 flex items-center justify-center p-1"
        >
            <span class="text-[10px] font-bold text-red-600">PayPay</span>
        </div>
        <div class="flex gap-2">
            <div
                class="h-6 w-10 bg-slate-200 rounded flex items-center justify-center text-[10px] font-bold text-slate-500"
            >
                VISA
            </div>
            <div
                class="h-6 w-10 bg-slate-200 rounded flex items-center justify-center text-[10px] font-bold text-slate-500"
            >
                JCB
            </div>
        </div>
        <span class="text-xs text-slate-400 font-bold"
            >Secure Payment via Stripe</span
        >
    </div>
</div>

<style>
    /* このページのみグローバルのスクロール制限を強制解除 */
    :global(body),
    :global(html) {
        overflow: auto !important;
        height: auto !important;
        overscroll-behavior-y: auto !important;
        -webkit-overflow-scrolling: touch;
    }
</style>
