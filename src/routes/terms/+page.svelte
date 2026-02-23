<script lang="ts">
    import { fade } from "svelte/transition";
</script>

<div
    class="h-screen overflow-y-auto bg-[#F9FAFB] font-sans selection:bg-indigo-100"
>
    <main class="max-w-5xl mx-auto py-12 px-6" in:fade={{ duration: 400 }}>
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
                                    サービスの性質上，購入後のキャンセルや返金は原則受け付けません。月の途中やシーズンパス期間中の解約でも，日割り計算による返金は行わず，次回の更新日（有効期限）まで引き続き利用可能です。
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
                                        >自己のアカウントを第三者に譲渡，貸与，または共有する行為（複数人での使い回しを含みます）</span
                                    >
                                </li>
                                <li>
                                    本サービスを利用して，所属する教育機関の規則に反する不正行為（AIの出力をそのまま自身の成果物として提出するなど）を行う行為
                                </li>
                                <li>
                                    当方のサーバーまたはネットワークの機能を破壊したり，妨害したりする行為
                                </li>
                                <li>
                                    本サービスの運営を妨害するおそれのある行為
                                </li>
                            </ul>
                        </div>
                    </section>

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

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >07</span
                            >
                            知的財産権とユーザーの責任
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                ユーザーが本サービスにアップロード，共有，または作成する資料（講義スライド，過去問，ノート等）に関連して，著作権侵害を含む第三者の知的財産権等の権利侵害が生じた場合，ユーザーは自己の責任と費用で解決するものとし，当方は一切の責任を負いません。
                            </p>
                            <p>
                                当方は，知的財産権侵害の疑いがある等，相当な理由があると判断した場合，ユーザーに通知することなく，当該データの削除または非公開化を行うことができるものとします。
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >08</span
                            >
                            AI機能に関する免責
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                生成AIが提供する出力内容（課題アシスト，要約，試験対策情報等）は統計的な確率に基づいて生成されるものであり，その正確性，完全性，有用性を保証するものではありません。
                            </p>
                            <p>
                                本サービスは学習を支援するツールであり，特定の単位取得，成績向上，または試験の合格を約束または保証するものではありません。最終的な事実確認や学習への利用はユーザーの自己責任で行うものとします。
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >09</span
                            >
                            不正行為（アカデミック・ディスオネスト）の禁止
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                ユーザーは，所属する大学その他の教育機関の規則・ポリシーを遵守する責任を負います。AIの生成物をそのまま自身の成果物として提出する等の，教育機関により禁止される不正行為に本サービスを利用することを禁じます。
                            </p>
                            <p>
                                本サービスの利用の結果，ユーザーが所属機関から停学，退学その他の処分を受けた場合でも，当方は一切関与せず，何らの補償も行わないものとします。
                            </p>
                        </div>
                    </section>

                    <section>
                        <h2
                            class="text-2xl font-black text-slate-900 mb-6 flex items-center gap-3"
                        >
                            <span
                                class="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-sm"
                                >10</span
                            >
                            サービスの停止・中断の免責
                        </h2>
                        <div
                            class="pl-11 text-slate-600 leading-relaxed space-y-4"
                        >
                            <p>
                                当方は，以下のいずれかの事由があると判断した場合，ユーザーに事前に通知することなく本サービスの全部または一部の提供を停止または中断することができるものとします。
                            </p>
                            <ul class="list-disc space-y-2 ml-4">
                                <li>システムの保守点検または更新を行う場合</li>
                                <li>
                                    AI提供企業のAPI障害，サーバー障害，通信回線等の停止が生じた場合
                                </li>
                                <li>
                                    天災地変等の不可抗力または不慮の事故によりサービスの提供が困難な場合
                                </li>
                            </ul>
                            <p>
                                当方は，本サービスの提供の停止または中断により，ユーザーまたは第三者が被ったいかなる不利益（試験準備の遅延，機会の損失等）または損害についても，理由を問わず一切の責任を負わないものとします。
                            </p>
                        </div>
                    </section>
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
