<script lang="ts">
	import "../app.css";
	import favicon from "$lib/assets/favicon.svg";
	import { onMount } from "svelte";
	import { auth, db } from "$lib/firebase";
	import {
		doc,
		getDoc,
		collection,
		query,
		orderBy,
		onSnapshot,
	} from "firebase/firestore";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";
	import Sidebar from "$lib/components/Sidebar.svelte";
	import { subjects, lectures, isSidebarOpen } from "$lib/stores";
	import {
		user as userStore,
		userProfile,
		authLoading,
	} from "$lib/userStore";
	import { isRecording, transcript } from "$lib/stores/recordingStore";
	import { recognitionService } from "$lib/services/recognitionService";
	import PwaInstallPrompt from "$lib/components/PwaInstallPrompt.svelte";
	import LoadingScreen from "$lib/components/LoadingScreen.svelte";
	import RecordingBar from "$lib/components/RecordingBar.svelte";

	let { children } = $props<{ children: any }>();
	let loading = $state(true); // App state
	let user = $state<any>(null);
	let lectureUnsubscribes: (() => void)[] = [];
	let lecturesMap = $state<Record<string, any[]>>({});

	$effect(() => {
		const allLectures = Object.values(lecturesMap)
			.flat()
			.sort((a, b) => {
				const tA = a.createdAt?.seconds || 0;
				const tB = b.createdAt?.seconds || 0;
				return tB - tA;
			});
		lectures.set(allLectures);
	});

	function cleanupLectureListeners() {
		lectureUnsubscribes.forEach((unsub) => unsub());
		lectureUnsubscribes = [];
	}

	$effect(() => {
		if (!user) {
			cleanupLectureListeners();
			lecturesMap = {};
			return;
		}

		cleanupLectureListeners();

		// 1. Root Lectures
		const rootQuery = query(
			collection(db, `users/${user.uid}/lectures`),
			orderBy("createdAt", "desc"),
		);
		const unsubRoot = onSnapshot(rootQuery, (snapshot) => {
			lecturesMap["root"] = snapshot.docs.map((d) => ({
				id: d.id,
				path: d.ref.path,
				...d.data(),
			}));
			console.log(
				"📚 [+layout] Root lectures fetched:",
				lecturesMap["root"].length,
			);
		});
		lectureUnsubscribes.push(unsubRoot);

		// 2. Subject Lectures
		if ($subjects.length > 0) {
			$subjects.forEach((subject) => {
				const subQuery = query(
					collection(
						db,
						`users/${user.uid}/subjects/${subject.id}/lectures`,
					),
					orderBy("createdAt", "desc"),
				);
				const unsubSub = onSnapshot(subQuery, (snapshot) => {
					lecturesMap[subject.id] = snapshot.docs.map((d) => ({
						id: d.id,
						path: d.ref.path,
						subjectId: subject.id,
						...d.data(),
					}));
				});
				lectureUnsubscribes.push(unsubSub);
			});
		}
	});

	onMount(() => {
		let unsubscribeSubjects: () => void;

		const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
			user = currentUser;
			userStore.set(currentUser);
			// Small delay to ensure minimum splash time for branding feel
			await new Promise((r) => setTimeout(r, 1500));

			const path = $page.url.pathname;

			if (!currentUser) {
				subjects.set([]); // Clear subjects
				userProfile.set(null);
				authLoading.set(false);

				// Allow public access to legal pages
				const publicRoutes = [
					"/login",
					"/terms",
					"/privacy",
					"/legal/notation",
				];
				if (!publicRoutes.includes(path)) {
					await goto("/login");
				}
			} else {
				// User is logged in, check if they have a profile doc (onboarded)
				try {
					const unsubProfile = onSnapshot(
						doc(db, "users", currentUser.uid),
						async (docSnap) => {
							if (!docSnap.exists()) {
								userProfile.set(null);
								if (path !== "/pricing" && path !== "/login")
									await goto("/pricing");
							} else {
								const profile = docSnap.data() as any;
								userProfile.set(profile);

								// Onboarding check: If university is not set, redirect to /setup
								const currentPath = $page.url
									.pathname as string;
								if (
									!profile.university &&
									currentPath !== "/setup" &&
									currentPath !== "/login" &&
									currentPath !== "/pricing"
								) {
									await goto("/setup");
								} else if (
									(currentPath === "/login" ||
										currentPath === "/pricing" ||
										(currentPath === "/setup" &&
											profile.university)) &&
									!$isRecording
								) {
									await goto("/");
								}
							}
						},
						(error) => {
							console.error("Profile listener error:", error);
						},
					);

					// Store for cleanup if not already handled by onMount return
					// Actually we can add it to the cleanup logic
					if (typeof window !== "undefined") {
						(window as any)._unsubProfile = unsubProfile;
					}

					// Fetch Subjects Globally
					const qSubjects = query(
						collection(db, `users/${currentUser.uid}/subjects`),
						orderBy("createdAt", "asc"),
					);
					unsubscribeSubjects = onSnapshot(qSubjects, (snapshot) => {
						const subs = snapshot.docs.map((doc) => ({
							id: doc.id,
							...doc.data(),
						}));
						subjects.set(subs);
					});
				} catch (e) {
					console.error("Error setting up profile listener", e);
				} finally {
					authLoading.set(false);
				}
			}

			// Transition handled by LoadingScreen
		});

		return () => {
			unsubscribe();
			if (unsubscribeSubjects) unsubscribeSubjects();
			if (
				typeof window !== "undefined" &&
				(window as any)._unsubProfile
			) {
				(window as any)._unsubProfile();
			}
			cleanupLectureListeners();
		};
	});

	function toggleSidebar() {
		isSidebarOpen.update((v) => !v);
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div
	class="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900 selection:bg-indigo-100 selection:text-indigo-700"
>
	<!-- Mobile Header (Global) -->
	<header
		class="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/50 z-40 flex items-center justify-between px-4"
	>
		<button
			onclick={toggleSidebar}
			class="p-2 text-slate-600 hover:text-indigo-600 transition-colors"
			aria-label="メニューを開く"
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
					d="M4 6h16M4 12h16M4 18h16"
				/>
			</svg>
		</button>

		<a
			href="/"
			class="font-bold text-xl bg-gradient-to-r from-indigo-700 to-pink-600 bg-clip-text text-transparent border-none bg-transparent p-0 cursor-pointer"
		>
			Re-Pass
		</a>

		<!-- User Profile Icon (Placeholder or Link to settings) -->
		<a href="/settings" class="p-1">
			<div
				class="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-100 to-pink-100 border border-white shadow-sm flex items-center justify-center text-xs font-bold text-indigo-600 overflow-hidden"
			>
				{#if user?.photoURL}
					<img
						src={user.photoURL}
						alt="User"
						class="w-full h-full object-cover"
					/>
				{:else}
					<span>{(user?.displayName || "U")[0].toUpperCase()}</span>
				{/if}
			</div>
		</a>
	</header>

	<div
		class="flex-1 flex flex-col lg:flex-row relative pt-16 lg:pt-0 overflow-hidden"
	>
		<!-- Sidebar Component & Overlay -->
		{#if $isSidebarOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="lg:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-[90] animate-in fade-in duration-300"
				onclick={() => isSidebarOpen.set(false)}
			></div>
		{/if}

		{#if user}
			<Sidebar
				{user}
				lectures={$lectures}
				subjects={$subjects}
				onClose={() => isSidebarOpen.set(false)}
				onLoadLecture={(lecture: any) => {
					// Handle lecture load - might need to dispatch or rely on store
					isSidebarOpen.set(false);
				}}
				onSelectSubject={(subjectId: string | null) => {
					isSidebarOpen.set(false);
				}}
				onSignOut={async () => {
					await auth.signOut();
					goto("/login");
				}}
			/>
		{/if}

		<div class="flex-1 flex flex-col min-w-0 relative">
			<main class="flex-1">
				{@render children()}
			</main>

			<!-- Global Footer -->
			<footer
				class="mt-auto py-12 px-6 border-t border-slate-200/50 bg-white/50 backdrop-blur-sm"
			>
				<div
					class="max-w-4xl mx-auto flex flex-col items-center justify-center gap-4 text-center"
				>
					<div
						class="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[10px] sm:text-xs font-bold text-slate-400"
					>
						<span>© 2026 Re-Pass</span>
						<span class="hidden sm:inline">/</span>
						<a
							href="/terms"
							class="hover:text-indigo-600 transition-colors"
							>利用規約</a
						>
						<span>/</span>
						<a
							href="/privacy"
							class="hover:text-indigo-600 transition-colors"
							>プライバシーポリシー</a
						>
						<span>/</span>
						<a
							href="/legal/notation"
							class="hover:text-indigo-600 transition-colors"
							>特定商取引法に基づく表記</a
						>
					</div>
				</div>
			</footer>
		</div>
	</div>
</div>

<!-- Splash Screen -->
{#if loading}
	<LoadingScreen onComplete={() => (loading = false)} />
{/if}

<!-- Global Recording Indicator -->
{#if $isRecording}
	<div
		class="fixed top-6 left-1/2 -translate-x-1/2 z-[50] animate-in fade-in slide-in-from-top-4 duration-500"
	>
		<div
			class="bg-slate-900/90 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-4 text-white hover:bg-slate-800 transition-all group"
		>
			<div class="flex items-center gap-2">
				<div class="relative w-3 h-3">
					<div
						class="absolute inset-0 bg-red-500 rounded-full animate-ping opacity-75"
					></div>
					<div class="relative w-3 h-3 bg-red-500 rounded-full"></div>
				</div>
				<span class="text-xs font-black tracking-widest uppercase"
					>Recording</span
				>
			</div>

			<div class="h-4 w-px bg-white/20"></div>

			<p
				class="text-[10px] text-slate-300 font-medium truncate max-w-[200px] italic"
			>
				{$transcript || "音声を待機中..."}
			</p>

			<button
				onclick={() => recognitionService.stop()}
				class="bg-white/10 hover:bg-red-500 text-white px-3 py-1.5 rounded-xl text-[10px] font-black transition-all"
			>
				STOP
			</button>
		</div>
	</div>
{/if}

<PwaInstallPrompt />
