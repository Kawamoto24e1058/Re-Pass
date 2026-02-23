<script lang="ts">
    import { subjects } from "$lib/stores";

    export let lecture: any;
    export let selectedLectureIds: Set<string>;
    export let movingLectureId: string | null = null;
    export let draggingLectureId: string | null = null;

    export let handleDragStartToSidebar: (e: DragEvent, id: string) => void;
    export let toggleLectureSelection: (id: string) => void;
    export let setMovingLectureId: (id: string | null) => void;
    export let moveLecture: (
        lectureId: string,
        subjectId: string | null,
    ) => void;
    export let loadLecture: (lecture: any) => void;
    export let handleDragEnd: (e: DragEvent) => void;
</script>

<div
    draggable="true"
    on:dragstart={(e) => handleDragStartToSidebar(e, lecture.id)}
    class="contents"
    role="article"
>
    <div class="group relative">
        <!-- Checkbox (Overlay on hover or persistent if selected) -->
        <div
            class="absolute top-4 left-4 z-20 transition-all duration-300
      {selectedLectureIds.has(lecture.id)
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'}"
        >
            <button
                on:click={(e) => {
                    e.stopPropagation();
                    toggleLectureSelection(lecture.id);
                }}
                class="w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all
        {selectedLectureIds.has(lecture.id)
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg'
                    : 'bg-white border-slate-200 hover:border-indigo-400'}"
            >
                {#if selectedLectureIds.has(lecture.id)}
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
                {/if}
            </button>
        </div>

        <!-- Quick Move Folder Icon -->
        <div
            class="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
        >
            <div class="relative group/mover">
                <button
                    on:click={(e) => {
                        e.stopPropagation();
                        setMovingLectureId(
                            movingLectureId === lecture.id ? null : lecture.id,
                        );
                    }}
                    class="w-10 h-10 rounded-full bg-white shadow-md border border-slate-100 flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                    title="フォルダへ移動"
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
                            d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                        />
                    </svg>
                </button>

                <!-- Dropdown -->
                {#if movingLectureId === lecture.id}
                    <div
                        class="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 z-50 animate-in zoom-in-95 duration-200"
                    >
                        <div
                            class="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                        >
                            移動先
                        </div>
                        {#each $subjects as subject (subject.id)}
                            <button
                                on:click={(e) => {
                                    e.stopPropagation();
                                    moveLecture(lecture.id, subject.id);
                                    setMovingLectureId(null);
                                }}
                                class="w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                            >
                                <div
                                    class="w-2 h-2 rounded-full {subject.color}"
                                ></div>
                                <span class="text-xs text-slate-700"
                                    >{subject.name}</span
                                >
                            </button>
                        {/each}
                        <div class="h-px bg-slate-100 my-1"></div>
                        <button
                            on:click={(e) => {
                                e.stopPropagation();
                                moveLecture(lecture.id, null);
                                setMovingLectureId(null);
                            }}
                            class="w-full text-left px-4 py-2 hover:bg-red-50 text-red-600 text-xs transition-colors"
                        >
                            インボックスに戻す
                        </button>
                    </div>
                {/if}
            </div>
        </div>

        <button
            on:click={() => loadLecture(lecture)}
            on:dragend={handleDragEnd}
            class="w-full text-left bg-white p-8 rounded-3xl border border-slate-100 shadow-sm hover:shadow-xl transition-all overflow-hidden relative
      {draggingLectureId === lecture.id
                ? 'opacity-40 scale-[0.98] rotate-[1deg] shadow-none pointer-events-none'
                : 'hover:-translate-y-1'}
      {selectedLectureIds.has(lecture.id)
                ? 'ring-2 ring-indigo-600 bg-indigo-50/10'
                : ''}"
        >
            <div class="pl-2">
                <h3
                    class="font-bold text-slate-800 mb-3 truncate group-hover:text-indigo-600 transition-colors text-lg"
                >
                    {lecture.title || "無題の講義"}
                </h3>
                <p class="text-xs text-slate-400 flex items-center gap-2">
                    <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                    </svg>
                    {lecture.createdAt
                        ? new Date(
                              lecture.createdAt.toDate(),
                          ).toLocaleDateString()
                        : "下書き"}
                </p>
                <div class="mt-6 flex flex-wrap gap-2">
                    <span
                        class="text-[10px] px-2.5 py-1 bg-slate-100 text-slate-500 rounded-lg border border-slate-200 uppercase font-bold tracking-wider"
                    >
                        {lecture.analysisMode === "thoughts"
                            ? "感想"
                            : lecture.analysisMode === "report"
                              ? "レポート"
                              : "ノート"}
                    </span>
                    {#if lecture.categoryTag}
                        <span
                            class="text-[10px] px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100 font-bold"
                        >
                            🏷️ {lecture.categoryTag}
                        </span>
                    {/if}
                </div>
            </div>
        </button>
    </div>
</div>
