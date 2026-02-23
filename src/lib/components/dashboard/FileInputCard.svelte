<script lang="ts">
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let id: string;
    export let label: string;
    export let iconColorClass: string;
    export let fileStore: File | null;
    export let accept: string;
    export let iconPath: string;
    export let isDisabled: boolean = false;

    // Since we're in Svelte 4, we'll dispatch events for parent actions
    function handleClick() {
        if (isDisabled) {
            dispatch("upgrade", { label });
            return;
        }
        const input = document.getElementById(`file-input-${id}`);
        if (input) input.click();
    }

    function onFileChange(e: Event) {
        dispatch("change", { event: e, id });
    }
</script>

<button
    on:click={handleClick}
    class="relative group flex items-center gap-3 p-3 w-full h-20 rounded-xl border-2 transition-all duration-200 {fileStore
        ? 'bg-white border-indigo-200 ring-1 ring-indigo-200'
        : isDisabled
          ? 'bg-slate-50 border-gray-100 opacity-60'
          : 'bg-slate-50 border-gray-200 hover:bg-gray-100'} {!isDisabled
        ? 'hover:brightness-95 active:scale-[0.98]'
        : ''}"
>
    <!-- Icon Container -->
    <div
        class="flex-shrink-0 w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm"
    >
        <svg
            class="w-5 h-5 {iconColorClass}"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
        >
            <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d={iconPath}
            />
        </svg>
    </div>

    <!-- Label & Filename -->
    <div class="flex-1 text-left overflow-hidden">
        <div
            class="text-xs font-bold text-slate-500 opacity-70 tracking-wider mb-0.5"
        >
            {label}
        </div>
        <div class="text-sm font-bold text-slate-700 truncate max-w-full">
            {fileStore ? fileStore.name : "選択"}
        </div>
    </div>

    <!-- Active Check Badge -->
    {#if fileStore}
        <div
            class="absolute -top-2 -right-2 w-5 h-5 bg-indigo-500 text-white rounded-full flex items-center justify-center shadow-sm border border-white"
        >
            <svg
                class="w-3 h-3"
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
    {/if}

    <input
        type="file"
        id="file-input-{id}"
        hidden
        {accept}
        multiple={id === "staged_image" ? true : undefined}
        capture={id === "staged_image" ? "environment" : undefined}
        on:change={onFileChange}
    />
</button>
