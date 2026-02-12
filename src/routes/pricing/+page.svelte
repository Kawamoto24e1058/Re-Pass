<script lang="ts">
    import { auth, db } from "$lib/firebase";
    import { doc, setDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import {
        PUBLIC_STRIPE_PUBLISHABLE_KEY,
        PUBLIC_STRIPE_PRICE_PREMIUM,
        PUBLIC_STRIPE_PRICE_SEASON,
    } from "$env/static/public";

    let isLoading = ""; // "Premium" or "Season" or empty

    onMount(() => {
        if (
            !PUBLIC_STRIPE_PUBLISHABLE_KEY ||
            PUBLIC_STRIPE_PUBLISHABLE_KEY === "pk_test_placeholder"
        ) {
            console.warn("Stripe API Key is missing. Check your .env file.");
        }
    });

    async function handlePurchase(priceId: string, planName: string) {
        const user = auth.currentUser;
        if (!user) {
            goto("/login");
            return;
        }

        isLoading = planName;

        try {
            const response = await fetch("/api/checkout", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    priceId,
                    userId: user.uid,
                    email: user.email,
                }),
            });

            const data = await response.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error(data.error || "Checkout failed");
            }
        } catch (error) {
            console.error("Error initiating checkout:", error);
            alert("決済システムの準備中です。しばらくお待ちください。");
        } finally {
            // We don't necessarily reset isLoading here if redirecting,
            // but it's good practice.
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
</script>

<div
    class="min-h-screen bg-[#F9FAFB] flex flex-col items-center py-20 px-6 font-sans selection:bg-indigo-100 relative"
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
        class="text-center mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700"
    >
        <h1
            class="text-4xl md:text-5xl font-black text-slate-900 mb-6 tracking-tight"
        >
            学割価格で、<span
                class="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-pink-600"
                >講義を資産に。</span
            >
        </h1>
        <p class="text-slate-500 max-w-xl mx-auto text-lg leading-relaxed">
            Re-Passは大学生の「学び」を徹底サポートします。<br />
            スタバ1杯分の投資で、テスト前の徹夜を卒業しましょう。
        </p>
    </div>

    <div class="grid lg:grid-cols-3 gap-8 w-full max-w-6xl">
        <!-- Starter Plan -->
        <div
            class="bg-white rounded-[2rem] p-10 border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-500 flex flex-col group animate-in fade-in slide-in-from-bottom-8 delay-100"
        >
            <div class="mb-8">
                <h3
                    class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                >
                    Starter
                </h3>
                <div class="text-4xl font-black text-slate-900">
                    ¥0 <span class="text-sm text-slate-400 font-medium"
                        >/ ずっと無料</span
                    >
                </div>
            </div>

            <p class="text-slate-500 text-sm mb-8 leading-relaxed">
                まずは使い心地を体験。<br />
                月1回までの分析が可能です。
            </p>

            <ul class="space-y-4 mb-12 flex-1">
                <li class="flex items-center gap-3 text-sm text-slate-600">
                    <div
                        class="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0"
                    >
                        <svg
                            class="w-3 h-3 text-slate-500"
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
                    <span>月1件の講義解析</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-slate-600">
                    <div
                        class="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0"
                    >
                        <svg
                            class="w-3 h-3 text-slate-500"
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
                    <span>PDF / 画像解析 (回数限定)</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-slate-400">
                    <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M6 18L18 6M6 6l12 12"
                        /></svg
                    >
                    <span class="line-through">高度なレポート作成</span>
                </li>
            </ul>

            <button
                onclick={selectFreePlan}
                class="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
            >
                無料で始める
            </button>
        </div>

        <!-- Premium Plan (Monthly) -->
        <div
            class="bg-white rounded-[2rem] p-10 border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-500 flex flex-col relative group animate-in fade-in slide-in-from-bottom-8 delay-200"
        >
            <div class="mb-8">
                <h3
                    class="text-xs font-bold text-indigo-500 uppercase tracking-widest mb-4"
                >
                    Monthly Premium
                </h3>
                <div class="text-4xl font-black text-slate-900">
                    ¥480 <span class="text-sm text-slate-400 font-medium"
                        >/ 1ヶ月</span
                    >
                </div>
                <div
                    class="mt-2 inline-block px-3 py-1 bg-amber-50 text-amber-600 text-[10px] font-bold rounded-lg border border-amber-100 uppercase"
                >
                    ☕️ スタバ1杯分で1ヶ月の講義を資産に
                </div>
            </div>

            <ul class="space-y-4 mb-12 flex-1">
                <li class="flex items-center gap-3 text-sm text-slate-600">
                    <div
                        class="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0"
                    >
                        <svg
                            class="w-3 h-3 text-indigo-600"
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
                    <span>講義分析 無制限</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-slate-600">
                    <div
                        class="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0"
                    >
                        <svg
                            class="w-3 h-3 text-indigo-600"
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
                    <span>高度なレポート & 感想作成</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-slate-600">
                    <div
                        class="w-5 h-5 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0"
                    >
                        <svg
                            class="w-3 h-3 text-indigo-600"
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
                    <span>PDF / 動画 / URL読み込み放題</span>
                </li>
            </ul>

            <button
                onclick={() =>
                    handlePurchase(PUBLIC_STRIPE_PRICE_PREMIUM, "Premium")}
                disabled={isLoading !== ""}
                class="w-full py-4 rounded-2xl bg-white border-2 border-slate-900 text-slate-900 font-bold text-sm hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if isLoading === "Premium"}
                    Stripeへ移動中...
                {:else}
                    プレミアムに参加
                {/if}
            </button>
        </div>

        <!-- Season Plan (4 Months) -->
        <div
            class="bg-slate-900 rounded-[2rem] p-10 border border-slate-800 shadow-2xl shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:-translate-y-2 transition-all duration-500 flex flex-col relative group overflow-hidden animate-in fade-in slide-in-from-bottom-8 delay-300"
        >
            <!-- Highlight Gradient -->
            <div class="absolute top-0 right-0 p-6">
                <span
                    class="bg-indigo-500 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg shadow-indigo-500/50"
                >
                    Best Value
                </span>
            </div>

            <div class="mb-8 relative z-10">
                <h3
                    class="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-4"
                >
                    Season Pass (6 Months)
                </h3>
                <div class="text-4xl font-black text-white">
                    ¥1,500 <span
                        class="text-xs text-slate-500 font-bold ml-1 uppercase"
                        >一括払い</span
                    >
                </div>
                <div class="mt-3 flex items-center gap-2">
                    <div
                        class="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-pink-400"
                    >
                        月あたり ¥250
                    </div>
                    <div
                        class="px-2 py-0.5 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold rounded border border-indigo-500/30"
                    >
                        48% OFF
                    </div>
                </div>
            </div>

            <p
                class="text-slate-400 text-sm mb-10 leading-relaxed relative z-10"
            >
                1学期＋α（6ヶ月）フルサポート。<br />
                一度の支払いで、テスト期間の不安を解消します。
            </p>

            <ul class="space-y-4 mb-12 flex-1 relative z-10">
                <li class="flex items-center gap-3 text-sm text-slate-300">
                    <div
                        class="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0"
                    >
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
                    <span>プレミアム全機能を開放</span>
                </li>
                <li class="flex items-center gap-3 text-sm text-slate-300">
                    <div
                        class="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0"
                    >
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
                    <span>6ヶ月間(1学期＋α)使い放題</span>
                </li>
                <li
                    class="flex items-center gap-3 text-sm text-slate-300 pt-3 mt-3 border-t border-slate-700/50"
                >
                    <div
                        class="h-6 w-16 bg-white/10 rounded flex items-center justify-center"
                    >
                        <svg
                            viewBox="0 0 78 24"
                            class="h-3.5 w-auto"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                d="M15.54 2.8H21.41L14.77 13.91L13.11 11.23L15.54 2.8Z"
                                fill="#fff"
                            />
                            <path
                                d="M7.83997 2.8H13.71L10.25 8.52L6.15997 15.34L7.83997 2.8Z"
                                fill="#fff"
                            />
                            <path
                                d="M2.8 2.8H6.55L4.87 15.34H1.12L2.8 2.8Z"
                                fill="#fff"
                            />
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M26.24 7.42001C26.96 7.42001 27.65 7.74001 28.09 8.28001L29.74 6.02001C28.89 5.09001 27.65 4.62001 26.24 4.62001H21.42L20.45 11.85L20.1 14.46H22.95L23.11 13.24H25.07C27.91 13.24 29.84 11.39 29.84 8.78001C29.84 7.91001 29.58 7.15001 29.11 6.54001C29.07 6.49001 29.04 6.44001 29 6.39001L27.56 8.36001C27.27 8.01001 26.83 7.77001 26.29 7.77001H24.58L24.16 10.87H23.47L23.95 7.42001H26.24ZM32.32 10.37C32.32 9.07001 33.38 8.01001 34.68 8.01001C35.54 8.01001 36.3 8.47001 36.71 9.16001L38.41 7.27001C37.58 6.09001 36.23 5.33001 34.68 5.33001C31.9 5.33001 29.64 7.59001 29.64 10.37C29.64 11.77 30.21 13.03 31.12 13.94L32.74 12.01C32.47 11.54 32.32 10.97 32.32 10.37ZM49.12 4.62001L44.82 14.46H47.67L48.51 12.39H52.57L53.07 14.46H55.95L51.68 4.62001H49.12ZM51.78 9.06001L51.58 8.24001L50.55 8.25001L50.06 9.45001L49.65 10.39L51.78 9.06001ZM56.3 4.62001L58.6 11.85L59.43 14.46H62.29L64.24 4.62001H61.46L60.59 10.74L58.94 4.62001H56.3ZM67.07 11.66C67.07 11.08 67.54 10.61 68.12 10.61H69.58L70.36 4.80001H67.44L67.24 6.27001C66.82 5.33001 65.85 4.62001 64.69 4.62001C62.72 4.62001 61.12 6.22001 61.12 8.19001C61.12 10.16 62.72 11.76 64.69 11.76C65.51 11.76 66.25 11.41 66.8 10.85V11.23V11.66V13.88C66.8 14.65 66.45 15 65.75 15H64.7L64.35 17.63H65.75C68.34 17.63 69.51 16.03 69.51 13.88V11.66H67.07ZM64.69 9.87001C63.76 9.87001 63.01 9.12001 63.01 8.19001C63.01 7.26001 63.76 6.51001 64.69 6.51001C65.62 6.51001 66.37 7.26001 66.37 8.19001C66.37 9.12001 65.62 9.87001 64.69 9.87001ZM75.63 7.42001C76.35 7.42001 77.04 7.74001 77.48 8.28001L79.13 6.02001C78.28 5.09001 77.04 4.62001 75.63 4.62001H70.81L69.84 11.85L69.49 14.46H72.34L72.5 13.24H74.46C77.3 13.24 79.23 11.39 79.23 8.78001C79.23 7.91001 78.97 7.15001 78.5 6.54001C78.46 6.49001 78.43 6.44001 78.39 6.39001L76.95 8.36001C76.66 8.01001 76.22 7.77001 75.68 7.77001H73.97L73.55 10.87H72.86L73.34 7.42001H75.63Z"
                                fill="#fff"
                            />
                        </svg>
                    </div>
                    <span class="text-white font-bold text-xs"
                        >PayPay 利用可能</span
                    >
                </li>
            </ul>

            <button
                onclick={() =>
                    handlePurchase(PUBLIC_STRIPE_PRICE_SEASON, "Season")}
                disabled={isLoading !== ""}
                class="w-full py-5 rounded-2xl bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-bold text-base hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-indigo-600/30 relative z-10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {#if isLoading === "Season"}
                    Stripeへ移動中...
                {:else}
                    PayPay・カードで今すぐ購入
                {/if}
            </button>
            <p
                class="text-center text-[10px] text-slate-500 mt-4 relative z-10"
            >
                ※¥1,500（6ヶ月分）の一括決済となります。追加費用はありません。
            </p>
        </div>
    </div>
</div>
