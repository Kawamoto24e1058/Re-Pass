<script lang="ts">
    import { auth, db } from "$lib/firebase";
    import { doc, setDoc, serverTimestamp } from "firebase/firestore";
    import { goto } from "$app/navigation";

    async function selectPlan(plan: "free" | "premium") {
        const user = auth.currentUser;
        if (!user) return;

        try {
            // Save plan selection to Firestore
            await setDoc(
                doc(db, "users", user.uid),
                {
                    email: user.email,
                    displayName: user.displayName,
                    photoURL: user.photoURL,
                    plan: plan,
                    createdAt: serverTimestamp(),
                    lastLoginAt: serverTimestamp(),
                },
                { merge: true },
            );

            // Redirect to Home
            goto("/");
        } catch (error) {
            console.error("Error saving plan:", error);
            alert("エラーが発生しました。");
        }
    }
</script>

<div
    class="min-h-screen bg-[#F9FAFB] flex flex-col items-center justify-center p-6 font-sans"
>
    <div
        class="text-center mb-12 animate-in fade-in slide-in-from-bottom-4 duration-700"
    >
        <h1 class="text-3xl font-bold text-slate-900 mb-4">Choose Your Plan</h1>
        <p class="text-slate-500 max-w-md mx-auto">
            Select the plan that fits your academic needs. You can change this
            at any time.
        </p>
    </div>

    <div class="grid md:grid-cols-2 gap-6 w-full max-w-4xl">
        <!-- Free Plan -->
        <button
            on:click={() => selectPlan("free")}
            class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left group animate-in fade-in slide-in-from-bottom-8 delay-100"
        >
            <div
                class="w-12 h-12 bg-slate-100 rounded-2xl flex items-center justify-center mb-6 text-slate-600 group-hover:bg-slate-200 transition-colors"
            >
                <svg
                    class="w-6 h-6"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                    /></svg
                >
            </div>
            <h3 class="text-xl font-bold text-slate-900 mb-2">Starter</h3>
            <div class="text-3xl font-bold text-slate-900 mb-6">
                ¥0 <span class="text-sm text-slate-400 font-medium"
                    >/ month</span
                >
            </div>

            <ul class="space-y-3 mb-8 text-sm text-slate-600">
                <li class="flex items-center gap-2">
                    <svg
                        class="w-4 h-4 text-green-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                        /></svg
                    > 1 Lecture Analysis per month
                </li>
                <li class="flex items-center gap-2">
                    <svg
                        class="w-4 h-4 text-green-500"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M5 13l4 4L19 7"
                        /></svg
                    > Basic Summary Mode
                </li>
            </ul>

            <div
                class="w-full py-3 rounded-xl bg-slate-100 text-slate-700 font-bold text-center group-hover:bg-slate-200 transition-colors"
            >
                まずは1科目から試す
            </div>
        </button>

        <!-- Premium Plan -->
        <button
            on:click={() => selectPlan("premium")}
            class="relative bg-slate-900 rounded-3xl p-8 border border-slate-800 shadow-xl shadow-indigo-500/20 hover:shadow-2xl hover:shadow-indigo-500/30 hover:-translate-y-1 transition-all duration-300 text-left group overflow-hidden animate-in fade-in slide-in-from-bottom-8 delay-200"
        >
            <!-- Gradient Background -->
            <div
                class="absolute inset-0 bg-gradient-to-br from-indigo-900/50 to-purple-900/50 opacity-50"
            ></div>

            <div class="relative z-10">
                <div class="flex justify-between items-start mb-6">
                    <div
                        class="w-12 h-12 bg-indigo-500/20 border border-indigo-500/30 rounded-2xl flex items-center justify-center text-indigo-400"
                    >
                        <svg
                            class="w-6 h-6"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M13 10V3L4 14h7v7l9-11h-7z"
                            /></svg
                        >
                    </div>
                    <span
                        class="bg-indigo-500 text-white text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-wide"
                        >Popular</span
                    >
                </div>

                <h3 class="text-xl font-bold text-white mb-2">Re-Pass Pro</h3>
                <div class="text-3xl font-bold text-white mb-6">
                    ¥980 <span class="text-sm text-slate-400 font-medium"
                        >/ month</span
                    >
                </div>

                <ul class="space-y-3 mb-8 text-sm text-slate-300">
                    <li class="flex items-center gap-2">
                        <svg
                            class="w-4 h-4 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                            /></svg
                        > Unlimited Analysis
                    </li>
                    <li class="flex items-center gap-2">
                        <svg
                            class="w-4 h-4 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                            /></svg
                        > Advanced Report Modes
                    </li>
                    <li class="flex items-center gap-2">
                        <svg
                            class="w-4 h-4 text-indigo-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                            /></svg
                        > Cloud Sync & Folders
                    </li>
                </ul>

                <div
                    class="w-full py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-pink-600 text-white font-bold text-center shadow-lg shadow-indigo-600/30 group-hover:shadow-indigo-600/50 transition-all"
                >
                    全ての講義を資産にする
                </div>
            </div>
        </button>
    </div>
</div>
