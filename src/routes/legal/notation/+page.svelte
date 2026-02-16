<script>
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
                Re-Pass <span class="text-indigo-600">Legal</span>
            </a>
        </div>
    </nav>

    <main class="max-w-4xl mx-auto mt-12 px-6" in:fade={{ duration: 400 }}>
        <div
            class="bg-white rounded-[2.5rem] shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden"
        >
            <!-- Header section -->
            <div class="bg-slate-900 p-12 text-white">
                <h1
                    class="text-4xl font-black tracking-tight mb-4 text-indigo-400"
                >
                    特定商取引法に基づく表記
                </h1>
                <p class="text-slate-400 text-lg">
                    法令に基づき、本サービスに関する重要事項を記載します。
                </p>
            </div>

            <div class="p-12 prose prose-slate max-w-none">
                <div class="space-y-0 border-t border-slate-100">
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            事業者名
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            川本 晴春
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">所在地</div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            消費者からの請求に基づき、遅滞なく電子メール等により開示いたします。
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">連絡先</div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            消費者からの請求に基づき、遅滞なく電子メール等により開示いたします。
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            運営責任者
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            川本 晴春
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            メールアドレス
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            repass114@gmail.com
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            販売価格
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            各プランの購入ページに表示された価格（消費税込み）
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            対価以外に必要となる費用
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            インターネット接続料金、その他通信回線上の費用
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            代金の支払時期
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            利用登録およびプラン変更のお申し込み時に即時決済されます。サブスクリプションプランは各周期の開始時に自動課金されます。
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            支払方法
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            クレジットカード決済（Stripe）
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            役務の提供時期
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            決済手続き完了後、直ちにご利用いただけます。
                        </div>
                    </div>
                    <div class="flex border-b border-slate-100 py-6">
                        <div class="w-1/3 font-bold text-slate-900">
                            返品・キャンセルについて
                        </div>
                        <div class="w-2/3 text-slate-600 font-medium">
                            デジタルコンテンツの性質上、決済完了後の返品・返金・キャンセルには応じられません。解約は設定画面よりいつでも可能です（次回更新が停止されます）。
                        </div>
                    </div>
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
