<script lang="ts">
    export let isOpen = false;
    export let onClose: () => void;
    export let onConfirm: () => void;
</script>

{#if isOpen}
    <div
        class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200"
    >
        <div
            class="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
        >
            <div class="px-8 py-8">
                <div
                    class="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-6"
                >
                    <svg
                        class="w-6 h-6"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                    </svg>
                </div>
                <h2
                    class="text-2xl font-bold text-slate-800 mb-3 tracking-tight"
                >
                    文字起こしのリセット
                </h2>
                <p class="text-slate-500 leading-relaxed mb-8">
                    これまでの文字起こしデータを削除します。この操作は取り消せません。よろしいですか？
                </p>

                <div class="flex items-center gap-3">
                    <button
                        on:click={onClose}
                        class="flex-1 px-4 py-3 rounded-2xl text-sm font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                    >
                        キャンセル
                    </button>
                    <button
                        on:click={onConfirm}
                        class="flex-1 px-4 py-3 rounded-2xl text-sm font-bold text-white bg-red-500 hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
                    >
                        リセットする
                    </button>
                </div>
            </div>
        </div>
    </div>
{/if}
