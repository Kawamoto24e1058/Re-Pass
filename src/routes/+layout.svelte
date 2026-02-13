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
	import { subjects, lectures } from "$lib/stores";
	import {
		user as userStore,
		userProfile,
		authLoading,
	} from "$lib/userStore";
	import { isRecording, transcript } from "$lib/stores/recordingStore";
	import { recognitionService } from "$lib/services/recognitionService";
	import PwaInstallPrompt from "$lib/components/PwaInstallPrompt.svelte";
	import LoadingScreen from "$lib/components/LoadingScreen.svelte";

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
					const userDoc = await getDoc(
						doc(db, "users", currentUser.uid),
					);

					if (!userDoc.exists()) {
						userProfile.set(null);
						if (path !== "/pricing" && path !== "/login")
							await goto("/pricing");
					} else {
						const profile = userDoc.data() as any;
						userProfile.set(profile);
						if (path === "/login" || path === "/pricing")
							await goto("/");
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
					console.error("Error fetching user profile", e);
				} finally {
					authLoading.set(false);
				}
			}

			// Transition handled by LoadingScreen
		});

		return () => {
			unsubscribe();
			if (unsubscribeSubjects) unsubscribeSubjects();
			cleanupLectureListeners();
		};
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

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

{@render children()}
