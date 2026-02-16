<script lang="ts">
    import { fade } from "svelte/transition";
</script>

<div class="min-h-screen bg-[#F9FAFB] font-sans selection:bg-indigo-100 pb-20">
    <!-- Navigation -->
    <nav
        class="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4"
    >
        <div class="max-w-4xl mx-auto flex items-center justify-between">
            <a href="/login" class="flex items-center gap-2 group">
                <div
                    class="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm group-hover:scale-110 transition-transform"
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
                            d="M15 19l-7-7 7-7"
                        />
                    </svg>
                </div>
                <span class="font-bold text-slate-600">戻る</span>
            </a>
            <a
                href="/"
                class="text-xl font-black text-slate-900 tracking-tighter no-underline hover:opacity-80 transition-opacity"
            >
                Re-Pass <span class="text-indigo-600">Privacy</span>
            </a>
        </div>
    </nav>

    <main class="max-w-4xl mx-auto mt-12 px-6" in:fade={{ duration: 400 }}>
        <div
            class="bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden"
        >
            <!-- Header section -->
            <div
                class="bg-gradient-to-br from-indigo-600 to-slate-900 p-12 text-white"
            >
                <h1 class="text-4xl font-black tracking-tight mb-4">
                    プライバシーポリシー
                </h1>
                <p class="text-indigo-100 text-lg">
                    Re-Passは、お客様のプライバシーを尊重し、個人情報の保護に努めます。
                </p>
            </div>

            <div class="p-12 prose prose-slate max-w-none">
                <div class="space-y-12">
                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >01</span
                            >
                            収集する情報と利用目的
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-6"
                        >
                            <div
                                class="p-6 bg-slate-50 rounded-2xl border border-slate-100"
                            >
                                <h3
                                    class="font-bold text-slate-900 mb-3 flex items-center gap-2"
                                >
                                    <svg
                                        class="w-5 h-5 text-indigo-500"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                                        />
                                    </svg>
                                    認証情報の取り扱い
                                </h3>
                                <p class="text-sm">
                                    GoogleまたはMicrosoftアカウントを通じたサインインの際、サービス提供のために必要な最小限のプロフィール情報（表示名、メールアドレス、プロフィール画像等）を取得します。これらの情報は、ユーザーアカウントの作成、本人確認、およびカスタマイズされたサービス提供のために利用されます。
                                </p>
                            </div>

                            <div
                                class="p-6 bg-slate-50 rounded-2xl border border-slate-100"
                            >
                                <h3
                                    class="font-bold text-slate-900 mb-3 flex items-center gap-2"
                                >
                                    <svg
                                        class="w-5 h-5 text-indigo-500"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                    >
                                        <path
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                                        />
                                    </svg>
                                    決済情報の取り扱い
                                </h3>
                                <p class="text-sm">
                                    有料プランの決済には外部決済代行サービス「Stripe」を利用します。当方のサーバーにカード情報が保存されることはありません。決済情報の処理はStripeのプライバシーポリシーに従って安全に行われます。当方は、Stripeから提供される決済完了通知（顧客ID、プラン名等）のみを取得し、契約管理に利用します。
                                </p>
                            </div>
                        </div>
                    </section>

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >02</span
                            >
                            データの利用および保存
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                アップロードされた講義データ（PDF、音声、テキスト等）は、AIによる解析目的でのみ利用されます。解析結果はFirestore上に保存され、ユーザー自身の管理下で閲覧・削除が可能です。
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >03</span
                            >
                            第三者提供について
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                当方は、法令に基づく場合を除き、ユーザーの同意なく個人情報を第三者に提供することはありません。ただし、本サービスの提供および利便性向上のため、以下の外部サービスへ必要最小限のデータを提供することがあります。
                            </p>
                            <ul class="list-disc space-y-2 ml-4">
                                <li>
                                    <strong>Google Cloud SDK / Firebase</strong
                                    >:
                                    ユーザー認証（Google/Microsoftアカウント等）およびデータの保存・同期のため
                                </li>
                                <li>
                                    <strong>Stripe</strong>:
                                    決済処理および本人確認のため
                                </li>
                                <li>
                                    <strong>Google Gemini API</strong>:
                                    アップロードされた資料のAI解析・要約のため
                                </li>
                            </ul>
                            <p class="mt-4">
                                アップロードされた資料は，AI解析のみを目的に一次的に利用されます。
                            </p>
                        </div>
                    </section>
                </div>

                <div class="mt-20 pt-10 border-t border-slate-100 text-center">
                    <p class="text-sm text-slate-400">
                        最終更新日：2026年2月12日
                    </p>
                </div>
            </div>
        </div>
    </main>
</div>
