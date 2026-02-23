<script>
    import { fade } from "svelte/transition";
</script>

<div
    class="h-screen overflow-y-auto bg-[#F9FAFB] font-sans selection:bg-indigo-100"
>
    <main class="max-w-[800px] mx-auto py-12 px-6" in:fade={{ duration: 400 }}>
        <button
            on:click={() => history.back()}
            class="group mb-8 flex items-center gap-3 text-slate-500 hover:text-indigo-600 font-bold transition-all"
        >
            <div
                class="w-10 h-10 bg-white rounded-xl shadow-sm border border-slate-100 flex items-center justify-center group-hover:scale-110 group-hover:shadow-md transition-all"
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
            <span>戻る</span>
        </button>

        <div
            class="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden"
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
                            <ul class="list-none p-0 m-0 space-y-1">
                                <li>・Free: ¥0</li>
                                <li>
                                    ・Premium: ¥780/月 または
                                    ¥2,480/4ヶ月（シーズンパス）
                                </li>
                                <li>
                                    ・Ultimate: ¥1,480/月 または
                                    ¥4,980/4ヶ月（シーズンパス）
                                </li>
                            </ul>
                            <p class="mt-2 text-xs text-slate-400">
                                ※表示価格はすべて消費税込みです。
                            </p>
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
                            サービスの性質上，購入後のキャンセルや返金は原則受け付けません。月の途中やシーズンパス期間中の解約でも，日割り計算による返金は行わず，次回の更新日（有効期限）まで引き続き利用可能です。
                        </div>
                    </div>
                </div>

                <div class="mt-20 pt-10 border-t border-slate-100 text-center">
                    <p class="text-sm text-slate-400">
                        最終更新日：2026年2月23日
                    </p>
                </div>
            </div>
        </div>
    </main>
</div>
