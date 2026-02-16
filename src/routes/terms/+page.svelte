<script lang="ts">
    import { fade } from "svelte/transition";
</script>

<div
    class="h-screen overflow-y-auto bg-[#F9FAFB] font-sans selection:bg-indigo-100"
>
    <main class="max-w-[800px] mx-auto py-12 px-6" in:fade={{ duration: 400 }}>
        <div
            class="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden"
        >
            <!-- Header section -->
            <div
                class="bg-gradient-to-br from-indigo-600 to-purple-600 p-12 text-white"
            >
                <h1 class="text-4xl font-black tracking-tight mb-4">
                    利用規約
                </h1>
                <p class="text-indigo-100 text-lg">
                    Re-Passをご利用いただくためのルールと条件をご説明します。
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
                            適用範囲
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                この利用規約（以下，「本規約」といいます。）は，Re-Pass（以下，「本サービス」といいます。）の利用条件を定めるものです。登録ユーザーの皆様（以下，「ユーザー」といいます。）には，本規約に従って，本サービスをご利用いただきます。
                            </p>
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
                            AI解析に関する免責事項
                        </h2>
                        <div class="pl-11 text-slate-600 leading-relaxed">
                            <div
                                class="p-6 bg-amber-50 border border-amber-100 rounded-2xl text-amber-900 text-sm leading-relaxed"
                            >
                                <p class="font-bold mb-2">
                                    【重要】AI解析の性質・免責事項について
                                </p>
                                <p>
                                    本サービスは人工知能（AI）を使用して講義内容の解析・要約を行います。AIの性質上，出力される情報の正確性，完全性，有用性を保証するものではありません。
                                </p>
                                <p class="mt-4 font-black text-red-600">
                                    本サービス（AIの出力内容）を利用した結果生じた，成績不振，単位の未取得，学則による処分，およびその他一切の不利益について，運営者は損害賠償を含めいかなる責任も負わないものとします。ユーザーは自己の責任において内容を精査し利用するものとします。
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
                                >03</span
                            >
                            利用料金および支払方法
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                ユーザーは，本サービスの有料プラン利用の対価として，当方が別途定め，本ウェブサイトに表示する利用料金を，当方が指定する支払方法により支払うものとします。
                            </p>
                        </div>
                    </section>

                    <section id="article-4">
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >04</span
                            >
                            返金に関する規定
                        </h2>
                        <div class="pl-11 text-slate-600 leading-relaxed">
                            <div
                                class="p-6 bg-red-50 border border-red-100 rounded-2xl text-red-900 text-sm leading-relaxed"
                            >
                                <p class="font-bold mb-2">
                                    【重要】返金不可について
                                </p>
                                <p>
                                    本サービスはデジタルコンテンツおよびサービスの性質上，決済完了後のユーザー都合によるキャンセル・返金には一切応じられません。サブスクリプションの解約は次回の更新を停止するものであり，既に支払われた期間分の料金の返金は行わないものとします。プラン購入前にサービス内容を十分にご確認ください。
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
                                >05</span
                            >
                            禁止事項
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                ユーザーは，本サービスの利用にあたり，以下の行為をしてはなりません。
                            </p>
                            <ul class="list-disc space-y-2 ml-4">
                                <li>法令または公序良俗に違反する行為</li>
                                <li>犯罪行為に関連する行為</li>
                                <li>
                                    本サービスの内容等，本サービスに含まれる著作権，商標権ほか知的財産権を侵害する行為
                                </li>
                                <li>
                                    <span class="font-bold underline"
                                        >自己のアカウントを第三者に譲渡，貸与，または共有する行為</span
                                    >
                                </li>
                                <li>
                                    当方のサーバーまたはネットワークの機能を破壊したり，妨害したりする行為
                                </li>
                                <li>
                                    本サービスの運営を妨害するおそれのある行為
                                </li>
                            </ul>
                        </div>
                        <section>
                            <h2
                                class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                            >
                                <span
                                    class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                    >06</span
                                >
                                未成年者の利用
                            </h2>
                            <div class="pl-11 text-slate-600 leading-relaxed">
                                <p>
                                    ユーザーが未成年者である場合は，親権者など法定代理人の同意を得た上で本サービスを利用するものとします。本規約に同意した時点で，法定代理人の同意を得ているものとみなします。
                                </p>
                            </div>
                        </section>
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
