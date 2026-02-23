<script lang="ts">
    import { auth, db } from "$lib/firebase";
    import { doc, updateDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";
    import { fade, fly } from "svelte/transition";
    import { userProfile } from "$lib/userStore";
    import { onMount } from "svelte";

    let university = $state("");
    let loading = $state(false);
    let error = $state("");

    // Common universities for quick selection (Japanese)
    const commonUniversities = [
        "東京大学",
        "京都大学",
        "早稲田大学",
        "慶應義塾大学",
        "一橋大学",
        "東京工業大学",
        "大阪大学",
        "名古屋大学",
        "九州大学",
        "東北大学",
        "北海道大学",
        "筑波大学",
        "明治大学",
        "青山学院大学",
        "立教大学",
        "中央大学",
        "法政大学",
        "関西大学",
        "関西学院大学",
        "同志社大学",
        "立命館大学",
    ];

    let filteredUniversities = $derived(
        university.length > 0
            ? commonUniversities.filter(
                  (u) => u.includes(university) && u !== university,
              )
            : [],
    );

    async function handleSave() {
        if (!university.trim()) {
            error = "大学名を入力してください。";
            return;
        }

        loading = true;
        error = "";

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("User not found");

            await updateDoc(doc(db, "users", user.uid), {
                university: university.trim(),
                updatedAt: serverTimestamp(),
            });

            // Update local store
            userProfile.update((p: any) => ({
                ...p,
                university: university.trim(),
            }));

            await goto("/");
        } catch (e: any) {
            console.error(e);
            error = "保存に失敗しました。もう一度お試しください。";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        if (!auth.currentUser) {
            // Wait a bit or let layout handle it, but for safety:
            setTimeout(() => {
                if (!auth.currentUser) goto("/login");
            }, 2000);
        }
    });

    function selectUni(uni: string) {
        university = uni;
    }
</script>

<div
    class="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-6 font-sans"
>
    <!-- Background Decor -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none opacity-40">
        <div
            class="absolute -top-[10%] -left-[5%] w-[40%] h-[40%] rounded-full bg-indigo-200 blur-[120px]"
        ></div>
        <div
            class="absolute top-[30%] -right-[10%] w-[35%] h-[35%] rounded-full bg-pink-100 blur-[100px]"
        ></div>
    </div>

    <div
        class="relative w-full max-w-[480px] bg-white/80 backdrop-blur-2xl border border-white rounded-[2.5rem] shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] p-10"
        in:fade={{ duration: 400 }}
    >
        <div class="text-center mb-10">
            <div
                class="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white mb-6 mx-auto shadow-xl shadow-indigo-100/50 rotate-3 transition-transform hover:rotate-0"
            >
                <svg class="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="white" />
                    <path
                        d="M2 17L12 22L22 17"
                        stroke="white"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                    <path
                        d="M2 12L12 17L22 12"
                        stroke="white"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                </svg>
            </div>
            <h1 class="text-3xl font-black text-slate-900 tracking-tight mb-3">
                Re-Passへようこそ！
            </h1>
            <p class="text-slate-500 text-sm leading-relaxed">
                あなたの大学を設定しましょう。<br />
                同じ大学の仲間のデータに基づいた最適なサジェストが提供されます。
            </p>
        </div>

        <div class="space-y-6">
            <div class="relative">
                <label
                    for="university"
                    class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-4 mb-2 block"
                >
                    所属大学
                </label>
                <input
                    id="university"
                    type="text"
                    bind:value={university}
                    placeholder="大学名を入力 (例: 東京大学)"
                    class="w-full px-6 py-5 bg-slate-50 border border-slate-100 rounded-[1.5rem] text-base font-bold text-slate-700 focus:bg-white focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all placeholder:text-slate-300 placeholder:font-normal"
                />

                {#if filteredUniversities.length > 0}
                    <div
                        class="absolute z-10 w-full bg-white border border-slate-100 rounded-2xl shadow-xl mt-2 overflow-hidden animate-in fade-in slide-in-from-top-2"
                        in:fly={{ y: -10, duration: 200 }}
                    >
                        {#each filteredUniversities as uni}
                            <button
                                on:click={() => selectUni(uni)}
                                class="w-full text-left px-6 py-3 hover:bg-indigo-50 text-sm font-bold text-slate-700 transition-colors border-b border-slate-50 last:border-0"
                            >
                                {uni}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>

            {#if error}
                <div
                    in:fade
                    class="bg-red-50 text-red-600 px-4 py-3 rounded-2xl text-[11px] font-bold border border-red-100 flex items-center gap-2"
                >
                    <svg
                        class="w-4 h-4 flex-shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                    >
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                    </svg>
                    {error}
                </div>
            {/if}

            <button
                on:click={handleSave}
                disabled={loading || !university.trim()}
                class="w-full py-5 rounded-2xl bg-indigo-600 text-white font-black text-sm shadow-xl shadow-indigo-200 hover:bg-indigo-500 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:scale-100 disabled:shadow-none"
            >
                {loading ? "設定中..." : "学習を始める"}
            </button>
        </div>

        <p class="mt-10 text-[10px] text-slate-300 text-center leading-relaxed">
            ※所属大学は後から設定画面で変更することも可能です。
        </p>
    </div>
</div>
