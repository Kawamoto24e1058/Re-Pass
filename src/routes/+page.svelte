<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { storage, auth, db } from "$lib/firebase";
  import {
    ref,
    uploadBytes,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject,
  } from "firebase/storage";
  import {
    extractAudioFromVideo,
    type AudioExtractionProgress,
  } from "$lib/utils/audioExtractor";
  import { retryOperation } from "$lib/utils/retry";
  import { marked } from "marked";
  import {
    collection,
    addDoc,
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    setDoc,
    updateDoc,
    getDoc,
    getDocs,
    limit,
    deleteDoc,
    serverTimestamp,
    startAt,
    endAt,
    collectionGroup,
    Timestamp,
  } from "firebase/firestore";
  import { goto } from "$app/navigation";
  import { browser } from "$app/environment";
  import { signOut } from "firebase/auth";
  import { subjects, lectures, currentBinder } from "$lib/stores";
  import { user as userStore, userProfile } from "$lib/userStore";
  import {
    isRecording,
    transcript,
    isShared,
    courseId,
    resetSession, // Renamed from resetTranscript/resetAll
    lectureTitle,
    analysisMode,
    targetLength,
    pdfFile,
    txtFile,
    audioFile,
    imageFile,
    videoFile,
    targetUrl,
    interimTranscript,
    stagedImages,
    taskText,
  } from "$lib/stores/sessionStore";
  import { recognitionService } from "$lib/services/recognitionService";
  import { page } from "$app/stores";
  import UpgradeModal from "$lib/components/UpgradeModal.svelte";
  import EnrollModal from "$lib/components/EnrollModal.svelte";
  import { isEnrollModalOpen } from "$lib/stores";
  import TranscriptResetModal from "$lib/components/dashboard/TranscriptResetModal.svelte";
  import { normalizeCourseName } from "$lib/utils/textUtils";

  // Dashboard Components
  import LectureCard from "$lib/components/dashboard/LectureCard.svelte";
  import FileInputCard from "$lib/components/dashboard/FileInputCard.svelte";
  import ResultView from "$lib/components/dashboard/ResultView.svelte";

  // --- Contextual Search State ---
  let contextualSharedNotes: any[] = [];
  let isSearchingNotes = false;
  let hasSearchedNotes = false;

  // --- Simplified State Variables ---
  let isEditing = false;
  let isCourseDropdownOpen = false;
  // lectureTitle is managed by sessionStore
  let currentLectureId: string | null = null;
  let selectedSubjectId: string | null = null;
  let draggingLectureId: string | null = null;
  let isDragOverMainTarget = false;
  let selectedLectureIds = new Set<string>();
  let movingLectureId: string | null = null;
  let selectedDerivativeMode: "note" | "thoughts" | "report" | null = null;
  let derivativeTargetLength = 400;

  // User & Data State
  let user: any = null;
  let userData: any = null;

  // Sync state with store
  $: {
    user = $userStore;
    userData = $userProfile; // Restore this for global data access
    selectedSubjectId = $currentBinder;
  }

  // Derived courses for display (with retry/fallback)
  let enrolledCoursesList: any[] = [];
  let unsubscribeEnrolledCourses: any = null;

  $: if (user) {
    if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
    const q = query(
      collection(db, `users/${user.uid}/enrolled_courses`),
      orderBy("createdAt", "desc"),
    );
    unsubscribeEnrolledCourses = onSnapshot(q, (snapshot) => {
      enrolledCoursesList = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));
    });
  }

  onDestroy(() => {
    if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
  });

  // UI State
  let toastMessage: string | null = null;
  let analysisProposal: {
    lectureId: string;
    subjectId: string;
    subjectName: string;
  } | null = null;

  // Action for auto-scrolling textarea
  function actionTextAreaAutoscroll(node: HTMLTextAreaElement) {
    function scroll() {
      node.scrollTop = node.scrollHeight;
    }

    // Scroll on update
    return {
      update() {
        scroll();
      },
    };
  }

  let upgradeModalTitle = "ULTIMATE限定機能";
  let upgradeModalMessage = "";
  let showUpgradeModal = false;
  let showUltimateModal = false;
  let showTranscriptResetModal = false;
  let analyzing = false;
  let cancellationController: AbortController | null = null;

  type AnalysisResult =
    | {
        title?: string;
        category?: string;
        summary: string;
        glossary?: { term: string; definition: string }[];
      }
    | string;

  let result: AnalysisResult = "";
  let analyzedTitle = "";
  let analyzedCategory = "";

  // --- Derivative Generation State ---
  let lectureAnalyses: Record<string, AnalysisResult> = {};
  let initialGenerationDone = false;
  let derivativeAnalyzing = false;

  // --- Interactive QA State ---
  let isAskingQuestion = false;
  let qaInput = "";
  let qaHistory: { role: "user" | "assistant"; content: string }[] = [];

  let resultTextContainer: HTMLElement | null = null; // For individual copy
  let resultContainer: HTMLElement | null = null; // For auto-scroll
  let finalResultContainer: HTMLElement | null = null; // For final copy

  let unsubscribeUser: any = null;
  let previewVideoUrl: string | null = null;
  let videoPlayer: HTMLVideoElement | null = null;

  // Speech Recognition State - Moved to global recordingStore
  // let isRecording = $state(false);
  // let transcript = $state("");
  // let finalTranscript = $state("");
  // let recognition: any;

  // Analysis Settings
  // Managed by sessionStore: analysisMode, targetLength

  // Series Analysis State
  let analyzingSeries = false;
  let seriesSummary: {
    story: string;
    unresolved: string;
    exam: string;
  } | null = null;

  // Progress State
  let progressValue = 0;
  let progressStatus = "準備中...";
  let progressInterval: any;
  let customAnalysisInstructions = "";
  let analyzingFinal = false;
  let finalExamView = false; // Toggle between lecture list and final exam
  let finalExamResult = ""; // Store AI-generated final exam summary
  let isCopied = false; // Feedback state for summary copy
  let isResultCopied = false; // Feedback state for individual results

  // Copy result to clipboard (AnalysisResult aware)
  $: strategyContent = (() => {
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const ca = lectureAnalyses[activeMode] || result;
    if (!ca || typeof ca !== "object" || !ca.summary) return null;
    const match = ca.summary.match(
      /\[A_STRATEGY_START\]([\s\S]*?)\[A_STRATEGY_END\]/,
    );
    return match ? match[1].trim() : null;
  })();

  $: displaySummary = (() => {
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const ca = lectureAnalyses[activeMode] || result;
    if (!ca) return "";
    if (typeof ca === "string") return ca;
    if (!ca.summary) return "";
    return ca.summary
      .replace(/\[A_STRATEGY_START\][\s\S]*?\[A_STRATEGY_END\]/g, "")
      .trim();
  })();

  function copyToClipboard() {
    if (!finalResultContainer) return;

    // Use innerText as a fallback, but ideally we reconstruct from data if available
    const rawText = finalResultContainer.innerText;
    const cleanText = rawText
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    navigator.clipboard.writeText(cleanText).then(() => {
      isCopied = true;
      setTimeout(() => (isCopied = false), 2000);
    });
  }

  // Copy individual lecture note to clipboard (AnalysisResult aware)
  function copyResultToClipboard() {
    let cleanText = "";

    // If we have structured data, construct a nice report
    const activeMode = selectedDerivativeMode || $analysisMode || "note";
    const currentData = lectureAnalyses[activeMode] || result;

    if (typeof currentData === "object" && currentData !== null) {
      const { title, category, summary, glossary } = currentData;
      cleanText += `${title || "無題"}\n`;
      if (category) cleanText += `カテゴリ: ${category}\n`;
      cleanText += `\n${summary}\n`;

      if (glossary && glossary.length > 0) {
        cleanText += `\n【用語辞典】\n`;
        glossary.forEach((item: any) => {
          cleanText += `・${item.term}: ${item.definition}\n`;
        });
      }
    } else {
      // Legacy or string fallback
      if (!resultTextContainer) return;
      cleanText = resultTextContainer.innerText
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }

    navigator.clipboard.writeText(cleanText).then(() => {
      isResultCopied = true;
      setTimeout(() => (isResultCopied = false), 2000);
    });
  }

  async function handleDerivativeGenerate(
    mode: "note" | "thoughts" | "report",
  ) {
    if (!currentLectureId) return;
    if (derivativeAnalyzing) return;

    // Premium check
    if ((mode === "thoughts" || mode === "report") && !isPremium) {
      showUpgradeModal = true;
      upgradeModalTitle = "プレミアムプラン限定";
      upgradeModalMessage =
        "感想文やレポート形式の出力はプレミアムプラン以上の機能です。";
      return;
    }

    try {
      derivativeAnalyzing = true;
      toastMessage = "生成を開始しました...";

      const lecture = $lectures.find((l) => l.id === currentLectureId);
      if (!lecture) throw new Error("Lecture not found");

      const idToken = await user.getIdToken();

      const formData = new FormData();
      formData.append("mode", mode);
      formData.append("targetLength", derivativeTargetLength.toString());
      formData.append("documentText", $transcript || lecture.content || "");
      formData.append("plan", userData?.plan || "free");

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data = await response.json();
      const newResult = data.result;

      if (!newResult) {
        throw new Error("Invalid response format from server");
      }

      // Update store
      lectureAnalyses[mode] = newResult;

      // Save to Firestore
      const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
      await setDoc(
        ref,
        {
          analyses: lectureAnalyses,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      toastMessage = "生成が完了しました";

      await tick();
      if (resultContainer) {
        resultContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e) {
      console.error(e);
      toastMessage = "エラーが発生しました";
    } finally {
      derivativeAnalyzing = false;
      setTimeout(() => (toastMessage = null), 3000);
    }
  }

  async function generateFinalSummary() {
    if (selectedLectureIds.size === 0) {
      toastMessage = "講義が選択されていません";
      return;
    }

    analyzingFinal = true;
    try {
      const idToken = await user.getIdToken();
      const selectedLectures = $lectures.filter((l) =>
        selectedLectureIds.has(l.id),
      );

      const response = await fetch("/api/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          lectures: selectedLectures.map((l) => ({
            title: l.title,
            summary:
              typeof l.analysis === "string" ? l.analysis : l.analysis?.summary,
            date: l.createdAt,
          })),
          instructions: customAnalysisInstructions,
        }),
      });

      if (!response.ok) throw new Error("Failed to generate summary");

      const data = await response.json();
      finalExamResult = data.summary;
    } catch (e) {
      console.error(e);
      toastMessage = "生成に失敗しました";
    } finally {
      analyzingFinal = false;
    }
  }

  // --- Interactive QA Logic ---
  async function askQuestion() {
    if (!qaInput.trim() || isAskingQuestion || !currentLectureId) return;

    qaHistory = [...qaHistory, { role: "user", content: qaInput }];
    const currentQuestion = qaInput;
    qaInput = "";
    isAskingQuestion = true;

    try {
      const activeMode = selectedDerivativeMode || $analysisMode || "note";
      const currentData = lectureAnalyses[activeMode] || result;
      let contextText = "";

      if (
        typeof currentData === "object" &&
        currentData !== null &&
        currentData.summary
      ) {
        contextText = currentData.summary;
      } else if (typeof currentData === "string") {
        contextText = currentData;
      }

      const idToken = await user.getIdToken();
      const formData = new FormData();
      formData.append("documentText", contextText); // Context is the generated note
      formData.append("taskText", currentQuestion); // The specific question
      formData.append("isTaskAssist", "true"); // Trigger TA mode in API

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to get answer");
      const data = await response.json();

      const answer =
        typeof data.result === "string"
          ? data.result
          : data.result.summary || "回答を生成できませんでした。";

      qaHistory = [...qaHistory, { role: "assistant", content: answer }];

      // Save QA history to Firestore seamlessly
      const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
      await setDoc(
        ref,
        { qaHistory, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.error(e);
      toastMessage = "エラーが発生しました";
      qaHistory = [
        ...qaHistory,
        { role: "assistant", content: "エラーが発生しました。" },
      ];
    } finally {
      isAskingQuestion = false;
      await tick();
      // Auto-scroll to bottom of QA
      const qaContainer = document.getElementById("qa-container");
      if (qaContainer) qaContainer.scrollTop = qaContainer.scrollHeight;
    }
  }

  // --- Derived State for UI ---
  $: manuscriptPages = Math.ceil($targetLength / 400);

  $: isUltimate =
    String(userData?.plan || "")
      .trim()
      .toLowerCase() === "ultimate";
  $: isPremium =
    isUltimate ||
    String(userData?.plan || "")
      .trim()
      .toLowerCase() === "premium";
  $: isFree = !isPremium;

  $: dailyRemaining = (() => {
    if (isPremium) return Infinity;
    const today = new Date().toISOString().split("T")[0];
    const dailyUsage = userData?.dailyUsage || {
      count: 0,
      lastResetDate: today,
    };
    if (dailyUsage.lastResetDate !== today) return 3;
    return Math.max(0, 3 - dailyUsage.count);
  })();

  $: headerTitle =
    $analysisMode === "note"
      ? "講義ノート (復習用)"
      : $analysisMode === "thoughts"
        ? "感想・リアクション (提出用)"
        : "学術レポート (課題用)";

  $: containerBgColor =
    $analysisMode === "note"
      ? "bg-white/60"
      : $analysisMode === "thoughts"
        ? "bg-amber-50/60"
        : "bg-slate-50/60";

  // --- Lifecycle & Auth ---
  let wakeLock: WakeLockSentinel | null = null;

  // Wake Lock & Navigation Warning
  $: if (browser) {
    if (analyzing) {
      // 1. Prevent Navigation
      window.onbeforeunload = (e) => {
        e.preventDefault();
        e.returnValue = "解析処理を中断しますか？";
        return "解析処理を中断しますか？";
      };

      // 2. Request Wake Lock
      if ("wakeLock" in navigator && !wakeLock) {
        navigator.wakeLock
          .request("screen")
          .then((sentinel) => {
            wakeLock = sentinel;
          })
          .catch((err) => console.error("Wake Lock rejected:", err));
      }
    } else {
      // Cleanup
      window.onbeforeunload = null;
      if (wakeLock) {
        wakeLock.release().then(() => (wakeLock = null));
      }
    }
  }

  onMount(() => {
    const authUnsub = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        user = currentUser;

        unsubscribeUser = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
          if (docSnap.exists()) {
            userData = docSnap.data();
            console.log(`👤 User Plan Updated: ${userData.plan || "free"}`);
          }
        });
      } else {
        goto("/login");
      }
    });

    // Handle Stripe Success Redirect
    const sessionId = $page.url.searchParams.get("session_id");
    if (sessionId) {
      toastMessage =
        "✨ アップグレードありがとうございます！全ての講義を資産に変えましょう。";
      setTimeout(() => (toastMessage = null), 6000);

      // Clean up the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("session_id");
      window.history.replaceState({}, "", newUrl);
    }

    // Handle Course Context for Search
    const courseContextParam = $page.url.searchParams.get("courseContext");
    if (courseContextParam) {
      const decodedCourse = decodeURIComponent(courseContextParam);
      // Set the title for the new note
      $lectureTitle = decodedCourse;
      // Ensure we are in dashboard/creation mode
      currentLectureId = null;
      isEditing = false;

      // Fetch related shared notes
      fetchContextualNotes(decodedCourse);

      // Clean up the URL quietly so it doesn't trigger repeatedly on reloads during editing
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("courseContext");
      window.history.replaceState({}, "", newUrl);
    }

    // Handle Shared Lecture Path
    const path = $page.url.searchParams.get("path");
    if (path) {
      try {
        const docRef = doc(db, path);
        getDoc(docRef).then((snap) => {
          if (snap.exists()) {
            const data = snap.data();
            // Basic access check already enforced by security rules, but UI should be graceful
            loadLecture({ id: snap.id, path: snap.ref.path, ...data });
          } else {
            toastMessage = "ノートが見つからないか、アクセス権がありません";
            setTimeout(() => (toastMessage = null), 4000);
          }
        });
      } catch (e) {
        console.error("Error loading shared note", e);
      }
    }

    // Handle URL Lecture ID
    const urlId = $page.url.searchParams.get("lectureId");
    if (urlId && urlId !== currentLectureId) {
      loadLectureById(urlId);
    }

    // Global click listener to close move menus
    const handleGlobalClick = (e: MouseEvent) => {
      if (movingLectureId) {
        movingLectureId = null;
      }
    };
    window.addEventListener("click", handleGlobalClick);

    return () => {
      authUnsub();
      if (unsubscribeUser) unsubscribeUser();
      window.removeEventListener("click", handleGlobalClick);
    };
  });

  async function fetchContextualNotes(courseName: string) {
    if (!courseName || !user) return;

    isSearchingNotes = true;
    hasSearchedNotes = true;
    contextualSharedNotes = [];

    try {
      const q = normalizeCourseName(courseName);

      // Target shared lectures globally
      const lecturesQuery = query(
        collectionGroup(db, "lectures"),
        where("isShared", "==", true),
        limit(50), // Fetch a bit more to allow for client-side filtering
      );

      const snapshot = await getDocs(lecturesQuery);
      let results = snapshot.docs.map(
        (docSnap) =>
          ({
            id: docSnap.id,
            path: docSnap.ref.path,
            ...docSnap.data(),
          }) as any,
      );

      // Client-side Filter
      results = results.filter((l) => {
        const normCourse =
          l.normalizedCourseName || normalizeCourseName(l.courseName || "");
        return normCourse.includes(q);
      });

      // We only want others' notes, typically, but showing own shared notes is okay too
      // Take top 10 recent
      results.sort((a, b) => b.createdAt?.seconds - a.createdAt?.seconds);
      results = results.slice(0, 10);

      // Calculate access status (same rules applied in old search)
      const currentYear = new Date().getFullYear();
      const academicYearStart = new Date(
        currentYear - (new Date().getMonth() < 3 ? 1 : 0),
        3,
        1,
      );

      contextualSharedNotes = results.map((l) => {
        const createdAt =
          l.createdAt instanceof Timestamp
            ? l.createdAt.toDate()
            : new Date(l.createdAt);
        const isPastYear = createdAt < academicYearStart;
        let accessStatus = "granted";
        if (isPastYear && !isPremium) {
          accessStatus = "premium_locked";
        }
        // We assume if they clicked it from their enrolled list, they are enrolled.
        return { ...l, accessStatus, isPastYear };
      });
    } catch (e) {
      console.error("Error fetching contextual notes", e);
    } finally {
      isSearchingNotes = false;
    }
  }

  // ... (Keep existing onMount logic) ...

  // Global SpeechRecognition is managed in +layout via recognitionService

  // --- Timer & Progress ---
  let duration = 0;
  let timerInterval: any;

  $: if ($isRecording) {
    if (!timerInterval) {
      timerInterval = setInterval(() => duration++, 1000);
    }
  } else {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
      duration = 0;
    }
  }

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function startProgress() {
    progressValue = 0;
    progressStatus = "講義データの準備中...";
    progressInterval = setInterval(() => {
      if (progressValue < 20) {
        progressValue += Math.random() * 2;
        progressStatus = "講義データの準備中...";
      } else if (progressValue < 50) {
        progressValue += Math.random() * 1.5;
        progressStatus = "AIが講義内容を分析中...";
      } else if (progressValue < 80) {
        progressValue += Math.random() * 0.5;
        progressStatus = "先生の補足発言を抽出中...";
      } else if (progressValue < 95) {
        progressValue += 0.1;
        progressStatus = "学習ノートを構成中...";
      }
    }, 200);
  }

  async function stopProgress() {
    clearInterval(progressInterval);
    progressValue = 100;
    progressStatus = "完了";
    await new Promise((r) => setTimeout(r, 500));
  }

  async function handleAnalyze() {
    if (analyzing || isExtractingAudio) return;

    if (!$lectureTitle.trim()) {
      toastMessage = "講義名を入力してください";
      return;
    }

    if (
      !$pdfFile &&
      !$txtFile &&
      !$audioFile &&
      !$imageFile &&
      !$videoFile &&
      !$targetUrl &&
      !$transcript &&
      $stagedImages.length === 0 &&
      !$taskText.trim()
    ) {
      toastMessage = "学習素材を入力してください";
      return;
    }

    // Quota Checks
    const usageCount = userData?.usageCount || 0;

    // Free plan: MAX 1 total generate per day
    const today = new Date().toISOString().split("T")[0];
    const dailyCount = userData?.dailyUsageCount || 0; // Read from DB, assuming sync or fallback

    if (!isPremium && usageCount >= 1) {
      // Adjusted from 5 to 1 for Free Plan
      showUpgradeModal = true;
      upgradeModalTitle = "無料プランの解析上限";
      upgradeModalMessage =
        "Freeプランでのノート解析は「1日1回」までとなります。プレミアムプランなら無制限にご利用いただけます。";
      toastMessage = "無料枠(1回)を使い切りました";
      return;
    }

    // Premium plan MEDIA limits: MAX 3 media analyses per day
    if (isPremium && !isUltimate && ($videoFile || $audioFile)) {
      const mediaUsageCount = userData?.mediaUsageCount || 0;
      if (mediaUsageCount >= 3) {
        showUpgradeModal = true;
        upgradeModalTitle = "メディア解析上限";
        upgradeModalMessage =
          "プレミアムプランのメディア解析は「1日3回」までとなります。アルティメットプランなら完全無制限にご利用いただけます。";
        toastMessage = "本日のメディア解析上限(3回)に達しました";
        return;
      }
    }

    if (($videoFile || $audioFile) && !isPremium) {
      showUpgradeModal = true;
      toastMessage = "メディア解析はプレミアムプラン以上の機能です";
      return;
    }

    analyzing = true;
    startProgress();
    toastMessage = null;

    try {
      const idToken = await user.getIdToken();

      let audioUrl = "";
      let videoUrl = "";
      let pdfUrl = "";
      let imageUrl = "";

      cancellationController = new AbortController();
      const signal = cancellationController.signal;

      // Uploads (using our update uploadToStorage)
      if ($audioFile) audioUrl = await uploadToStorage($audioFile);
      if ($videoFile) videoUrl = await uploadToStorage($videoFile);
      if ($pdfFile) pdfUrl = await uploadToStorage($pdfFile);
      if ($imageFile) imageUrl = await uploadToStorage($imageFile);

      // Upload Staged Images
      let stagedImageUrls: string[] = [];
      if ($stagedImages && $stagedImages.length > 0) {
        toastMessage = "画像をアップロード中...";
        for (const img of $stagedImages) {
          const sUrl = await uploadToStorage(img);
          stagedImageUrls.push(sUrl);
        }
      }

      const formData = new FormData();
      if (audioUrl) formData.append("audioUrl", audioUrl);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (pdfUrl) formData.append("pdfUrl", pdfUrl);
      if (imageUrl) formData.append("imageUrl", imageUrl);

      // Append each staged image URL using the same key
      stagedImageUrls.forEach((url) => {
        formData.append("imageUrl", url);
      });

      // Explicitly separate text inputs for the prompt
      let documentText = "";
      if ($txtFile) {
        documentText = await $txtFile.text();
      }

      formData.append("documentText", documentText);
      formData.append("audioText", $transcript);
      formData.append("url", $targetUrl || "");
      formData.append("mode", $analysisMode);
      formData.append("plan", userData?.plan || "free");

      const res = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        headers: { Authorization: `Bearer ${idToken}` },
        signal,
      });

      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();

      // Save Logic
      const generatedSubtitle =
        data.result?.subtitle || data.result?.title || "要約";
      const combinedTitle = `${$lectureTitle} : ${generatedSubtitle}`;

      // 1. Find the selected course ID from enrolledCoursesList
      const selectedCourse = Object.values(enrolledCoursesList || {}).find(
        (c: any) => c.courseName === $lectureTitle,
      ) as any;
      const selectedCourseId = selectedCourse ? selectedCourse.id : null;

      const lectureData = {
        title: combinedTitle,
        lectureTitle: combinedTitle,
        courseName: $lectureTitle || "未分類", // Update to handle empty as "未分類"
        courseId: selectedCourseId, // Add the binder ID
        content: $transcript,
        analysis: data.result,
        analyses: { [$analysisMode]: data.result },
        isShared: $isShared ?? true,
        createdAt: serverTimestamp(),
        subjectId: selectedSubjectId || null,
        uid: user.uid,
        authorName:
          userData?.nickname ||
          user.displayName ||
          user.email?.split("@")[0] ||
          "匿名ユーザー",
        sourceType: $videoFile
          ? "video"
          : $audioFile
            ? "audio"
            : $targetUrl
              ? "url"
              : "text",
      };

      const docRef = await addDoc(
        collection(db, `users/${user.uid}/lectures`),
        lectureData,
      );

      toastMessage = "解析完了！";
      await stopProgress();
      analyzing = false;
      resetSession();

      // Navigate to the new lecture
      // We are already on the page, just load it
      loadLecture({ id: docRef.id, ...lectureData });

      await tick();
      if (resultContainer) {
        resultContainer.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (e: any) {
      console.error(e);
      toastMessage = "エラー: " + e.message;
      analyzing = false;
      stopProgress();
    }
  }

  // --- Functions ---

  // --- File Handlers ---
  let isExtractingAudio = false;
  let extractionProgress: AudioExtractionProgress | null = null;

  async function uploadToStorage(file: File): Promise<string> {
    const originalName = file.name || "file";
    const filename = `${Date.now()}_${originalName}`;
    if (!$userStore) throw new Error("User not authenticated");
    const storageRef = ref(storage, `uploads/${$userStore.uid}/${filename}`);

    return retryOperation(async () => {
      return new Promise((resolve, reject) => {
        const uploadTask = uploadBytesResumable(storageRef, file);

        if (cancellationController?.signal.aborted) {
          uploadTask.cancel();
          reject(new DOMException("Upload cancelled", "AbortError"));
          return;
        }

        const abortHandler = () => {
          uploadTask.cancel();
          reject(new DOMException("Upload cancelled", "AbortError"));
        };
        cancellationController?.signal.addEventListener("abort", abortHandler);

        uploadTask.on(
          "state_changed",
          (snapshot) => {
            // Optional: Update progress
          },
          (error) => {
            cancellationController?.signal.removeEventListener(
              "abort",
              abortHandler,
            );
            reject(error);
          },
          async () => {
            cancellationController?.signal.removeEventListener(
              "abort",
              abortHandler,
            );
            const url = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(url);
          },
        );
      });
    });
  }

  async function extractAudio(file: File) {
    try {
      isExtractingAudio = true;
      const result = await extractAudioFromVideo(file, (p) => {
        extractionProgress = p;
      });
      const extractedFile = new File(
        [result.blob],
        file.name.replace(/\.[^/.]+$/, "") + ".wav",
        { type: "audio/wav" },
      );
      audioFile.set(extractedFile);
      videoFile.set(null); // Prioritize audio
      toastMessage = "🎥 デジタル高速抽出完了 (WAV 16kHz)";
      setTimeout(() => (toastMessage = null), 3000);
    } catch (e: any) {
      console.error(e);
      toastMessage = "音声抽出失敗: " + e.message;
    } finally {
      isExtractingAudio = false;
      extractionProgress = null;
    }
  }

  function handleFileChange(e: Event, type: string) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      if (type === "pdf") pdfFile.set(input.files[0]);
      if (type === "txt") txtFile.set(input.files[0]);
      if (type === "audio") audioFile.set(input.files[0]);
      if (type === "video") {
        // Changed mapping for the integrated MEDIA button
        videoFile.set(input.files[0]);
        extractAudio(input.files[0]);
      }
      if (type === "single_image") {
        imageFile.set(input.files[0]);
      }
      if (type === "staged_image") {
        // Append to existing staged images
        const newFiles = Array.from(input.files);
        stagedImages.update((current) => [...current, ...newFiles]);
      }
    }
  }

  async function deleteFromStorage(downloadUrl: string) {
    if (!downloadUrl) return;
    try {
      const fileRef = ref(storage, downloadUrl);
      await deleteObject(fileRef);
      console.log(`Deleted from storage: ${downloadUrl}`);
    } catch (e) {
      console.error("Error deleting from storage:", e);
      // Don't alert user as this is a background cleanup task
    }
  }

  function setAnalysisMode(newMode: "note" | "thoughts" | "report") {
    if ((newMode === "thoughts" || newMode === "report") && !isPremium) {
      showUpgradeModal = true;
      return;
    }
    $analysisMode = newMode;
  }

  function handleLengthChange(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value);

    // Plan Enforcement
    if (!isPremium && val > 500) {
      showUpgradeModal = true;
      upgradeModalTitle = "プレミアムプラン限定";
      upgradeModalMessage =
        "フリープランの解析上限は500文字です。<br />プレミアムプランなら2000文字、アルティメットプランなら4000文字まで拡張されます。";
      toastMessage = "フリープランは500文字までです";
      setTimeout(() => (toastMessage = null), 3000);
      $targetLength = 500; // Force back
      return;
    }

    if (!isUltimate && val > 2000) {
      showUpgradeModal = true;
      upgradeModalTitle = "アルティメットプラン限定";
      upgradeModalMessage =
        "アルティメットプランなら、最大4000文字（原稿用紙10枚分）の超ロング解析が可能です。";
      toastMessage = "2000文字以上はアルティメット限定です";
      setTimeout(() => (toastMessage = null), 3000);
      $targetLength = 2000; // Force back
      return;
    }
  }

  function toggleRecording() {
    recognitionService.toggle();
  }

  function handleCancelAnalysis() {
    if (cancellationController) {
      cancellationController.abort();
      cancellationController = null;
      analyzing = false;
      result = "";
      toastMessage = "解析を中断しました";
      setTimeout(() => (toastMessage = null), 3000);
    }
  }

  // --- Simplified Dashboard Logic ---
  // Most complex analysis logic has moved to GlobalRecordingOverlay.

  // Handle URL Lecture ID
  onMount(() => {
    const urlId = $page.url.searchParams.get("lectureId");
    if (urlId && urlId !== currentLectureId) {
      // Load lecture logic (reused from existing or implemented here)
      // We might need to fetch the lecture doc.
      loadLectureById(urlId);
    }
  });

  async function loadLecture(lecture: any) {
    if ($isRecording) recognitionService.stop();

    currentLectureId = lecture.id;
    // Don't auto-deselect subject, keep context
    $lectureTitle = lecture.title;
    // Update global transcript store when loading a lecture
    resetSession();
    transcript.set(lecture.content || "");

    // Restore settings with defaults
    const modeMap: Record<string, "note" | "thoughts" | "report"> = {
      summary: "note",
      analysis: "report",
      note: "note",
      thoughts: "thoughts",
      report: "report",
    };
    $analysisMode = modeMap[lecture.analysisMode] || "note";
    $targetLength = lecture.targetLength || 1000;

    result = lecture.analysis || "";
    lectureAnalyses =
      lecture.analyses || (result ? { [$analysisMode]: result } : {});
    initialGenerationDone = !!result;

    // Restore Interactive QA state
    qaHistory = lecture.qaHistory || [];
    qaInput = "";
    isAskingQuestion = false;

    isEditing = false; // Switch to View Mode

    // Set preview video if available
    previewVideoUrl = lecture.downloadUrl || lecture.sourceUrl || null; // Simplified assumption

    localStorage.setItem("transcript", $transcript);

    // Auto-scroll to top of main content area
    await tick();
    const mainArea = document.querySelector("main");
    if (mainArea) {
      mainArea.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function handleSelectSubject(subjectId: string | null) {
    if ($isRecording) recognitionService.stop();
    currentBinder.set(subjectId);
    currentLectureId = null; // Clear lecture selection

    // Show Dashboard
    isEditing = false;

    // Reset editor state
    $lectureTitle = "";
    resetSession();
    result = "";
    // Removed file inputs state clearing as they are gone

    localStorage.removeItem("transcript");
  }

  function handleTranscriptReset() {
    if (!$transcript) return;
    showTranscriptResetModal = true;
  }

  async function confirmTranscriptReset() {
    // Reset UI state
    transcript.set("");

    // Reset database if we are viewing a saved lecture
    if (currentLectureId && user) {
      try {
        const ref = doc(db, `users/${user.uid}/lectures/${currentLectureId}`);
        await updateDoc(ref, {
          content: "",
          updatedAt: serverTimestamp(),
        });
        toastMessage = "文字起こしをリセットしました";
      } catch (e) {
        console.error("Error resetting transcript:", e);
        toastMessage = "リセットに失敗しました";
      } finally {
        setTimeout(() => (toastMessage = null), 3000);
      }
    } else {
      toastMessage = "文字起こしをクリアしました";
      setTimeout(() => (toastMessage = null), 3000);
    }
    showTranscriptResetModal = false;
  }

  // --- Simplified Dashboard Logic ---

  async function loadLectureById(id: string) {
    if (!user) return;
    const ref = doc(db, `users/${user.uid}/lectures/${id}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      loadLecture({ id: snap.id, ...snap.data() });
    }
  }

  function startNewLecture() {
    resetSession();
    // Ensure we stay in dashboard mode
    isEditing = false;
    currentLectureId = null;
    currentBinder.set(null);
    contextualSharedNotes = [];
    hasSearchedNotes = false;
    qaHistory = [];
    qaInput = "";
    isAskingQuestion = false;
  }

  /**
   * Complete Reset & Force Home Navigation
   */
  function handleLogoClick() {
    startNewLecture();
    goto("/", { invalidateAll: true });
  }

  /**
   * REUSABLE MOVEMENT LOGIC
   */
  async function moveLecture(
    lectureId: string,
    targetSubjectId: string | null,
  ) {
    const lecture = $lectures.find((l: any) => l.id === lectureId);
    if (!lecture) return;

    // If target is "unassigned" (null), handle it
    const finalTargetSubjectId =
      targetSubjectId === "unassigned" ? null : targetSubjectId;

    if (lecture.subjectId === finalTargetSubjectId) return;

    try {
      const oldPath = lecture.path;
      const newPath = finalTargetSubjectId
        ? `users/${user.uid}/subjects/${finalTargetSubjectId}/lectures/${lectureId}`
        : `users/${user.uid}/lectures/${lectureId}`;

      // 1. Get current data
      const sourceRef = doc(db, oldPath);
      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) return;

      const data = sourceSnap.data();

      // 2. Set in new location
      const targetRef = doc(db, newPath);
      await setDoc(targetRef, {
        ...data,
        subjectId: finalTargetSubjectId,
        categoryTag: finalTargetSubjectId ? null : data.categoryTag || null,
        updatedAt: serverTimestamp(),
      });

      // 3. Delete from old location
      await deleteDoc(sourceRef);

      toastMessage = finalTargetSubjectId
        ? "科目に移動しました"
        : "インボックスに移動しました";
      setTimeout(() => (toastMessage = null), 2000);

      // Reset proposal if this was the proposed lecture
      if (analysisProposal?.lectureId === lectureId) {
        analysisProposal = null;
      }
    } catch (e) {
      console.error("Error moving lecture", e);
      alert("移動に失敗しました");
    }
  }

  async function bulkMoveLectures(targetSubjectId: string | null) {
    if (selectedLectureIds.size === 0) return;

    const promises = Array.from(selectedLectureIds).map((id) =>
      moveLecture(id, targetSubjectId),
    );

    await Promise.all(promises);
    selectedLectureIds.clear(); // svelte 5 set clear triggers reactivity? yes if using Svelte Set... wait, it's native Set.
    // If it's a native Set in a rune, we need to reassign or mutate.
    // $state(new Set()) -> mutation works if we use Svelte 5 Set? No, Svelte 5 proxies Set.
    // simpler: selectedLectureIds = new Set();
    selectedLectureIds = new Set();

    toastMessage = "一括移動しました";
    setTimeout(() => (toastMessage = null), 2000);
  }

  function toggleLectureSelection(id: string) {
    if (selectedLectureIds.has(id)) {
      selectedLectureIds.delete(id);
    } else {
      selectedLectureIds.add(id);
    }
    selectedLectureIds = new Set(selectedLectureIds); // Trigger reactivity
  }

  function handleTimestampClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.classList.contains("timestamp-link")) {
      const timestamp = target.dataset.timestamp;
      if (timestamp && videoPlayer) {
        const parts = timestamp.split(":").map(Number);
        const seconds =
          parts.length === 2
            ? parts[0] * 60 + parts[1]
            : parts[0] * 3600 + parts[1] * 60 + parts[2];
        videoPlayer.currentTime = seconds;
        videoPlayer.play();
      }
    }
  }

  $: parsedHtml = result
    ? typeof result === "object"
      ? marked.parse(result.summary)
      : marked.parse(result)
    : "";

  function handleDragStartToSidebar(e: DragEvent, lectureId: string) {
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", lectureId);
      e.dataTransfer.effectAllowed = "move";
      draggingLectureId = lectureId;
    }
  }

  function handleDragEnd() {
    draggingLectureId = null;
  }

  function handleMainTargetDragOver(e: DragEvent) {
    e.preventDefault();
    isDragOverMainTarget = true;
  }

  function handleMainTargetDragLeave() {
    isDragOverMainTarget = false;
  }

  async function handleMainTargetDrop(e: DragEvent) {
    e.preventDefault();
    isDragOverMainTarget = false;
    const lectureId = e.dataTransfer?.getData("text/plain");
    if (!lectureId || !selectedSubjectId) return;

    await moveLecture(lectureId, selectedSubjectId);
  }
  function handleUpgradeRequest(label: string) {
    showUpgradeModal = true;
    upgradeModalTitle = "プレミアムプラン限定";
    upgradeModalMessage =
      label === "MEDIA"
        ? "動画や音声の解析はプレミアムプラン以上の機能です。"
        : label === "📝 課題・問題"
          ? "課題アシスト機能はプレミアムプラン以上の機能です。"
          : "この機能はプレミアムプラン限定です。";
  }
</script>

<!-- Toast Notification -->
{#if toastMessage}
  <div
    class="fixed top-4 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-top-4 fade-in duration-300"
  >
    <div
      class="bg-white/90 backdrop-blur-md text-slate-800 px-6 py-3 rounded-full shadow-2xl border border-white/50 flex items-center gap-3"
    >
      <div class="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
      <span class="text-sm font-bold">{toastMessage}</span>
    </div>
  </div>
{/if}

<!-- Smart Move Proposal Banner -->
{#if analysisProposal}
  <div
    class="fixed top-20 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 duration-500"
  >
    <div
      class="bg-indigo-600 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-6 border border-white/20 backdrop-blur-md"
    >
      <div class="flex items-center gap-3">
        <span class="text-2xl">✨</span>
        <div>
          <p class="text-xs font-medium opacity-80">AIによる自動分類</p>
          <p class="text-sm font-bold">
            この講義を「{analysisProposal.subjectName}」に移動しますか？
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2 border-l border-white/20 pl-4">
        <button
          on:click={() => {
            if (analysisProposal) {
              moveLecture(
                analysisProposal.lectureId,
                analysisProposal.subjectId,
              );
              analysisProposal = null;
            }
          }}
          class="bg-white text-indigo-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-colors"
        >
          移動する
        </button>
        <button
          on:click={() => (analysisProposal = null)}
          class="text-white/60 hover:text-white px-3 py-2 text-xs font-medium transition-colors"
        >
          あとで
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Selection Action Bar -->
{#if selectedLectureIds.size > 0}
  <div
    class="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-bottom-10 duration-300"
  >
    <div
      class="bg-slate-900 border border-slate-800 text-white px-6 py-4 rounded-3xl shadow-2xl flex items-center gap-8"
    >
      <div class="flex items-center gap-3">
        <div
          class="bg-indigo-500 text-white w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm"
        >
          {selectedLectureIds.size}
        </div>
        <p class="text-sm font-medium">個を選択中</p>
      </div>

      <div class="flex items-center gap-2 border-l border-slate-700 pl-6">
        <div class="relative group">
          <button
            class="bg-slate-800 hover:bg-slate-700 text-white px-5 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2"
          >
            <span>フォルダへ移動</span>
            <svg
              class="w-4 h-4 opacity-50"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          <!-- Quick Move Dropdown -->
          <div
            class="absolute bottom-full left-0 mb-3 w-56 bg-white rounded-2xl shadow-2xl border border-slate-100 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all"
          >
            <div
              class="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider"
            >
              移動先を選択
            </div>
            {#each $subjects as subject (subject.id)}
              <button
                on:click={() => bulkMoveLectures(subject.id)}
                class="w-full text-left px-4 py-2.5 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
              >
                <div class="w-2.5 h-2.5 rounded-full {subject.color}"></div>
                <span class="text-xs text-slate-700 font-medium"
                  >{subject.name}</span
                >
              </button>
            {/each}
            <div class="h-px bg-slate-100 my-1"></div>
            <button
              on:click={() => bulkMoveLectures(null)}
              class="w-full text-left px-4 py-2.5 hover:bg-red-50 text-red-600 flex items-center gap-3 transition-colors"
            >
              <span class="text-xs font-medium">インボックスに戻す</span>
            </button>
          </div>
        </div>

        <button
          on:click={() => {
            selectedLectureIds = new Set();
          }}
          class="text-slate-400 hover:text-white px-4 py-2.5 text-xs font-medium transition-colors"
        >
          選択解除
        </button>
      </div>
    </div>
  </div>
{/if}

<div
  class="flex h-screen overflow-hidden bg-[#F9FAFB] text-slate-800 font-sans selection:bg-indigo-100 selection:text-indigo-700 relative"
>
  {#if user}
    <UpgradeModal
      isOpen={showUpgradeModal || showUltimateModal}
      onClose={() => {
        showUpgradeModal = false;
        showUltimateModal = false;
      }}
      title={upgradeModalTitle}
      message={upgradeModalMessage}
      billingCycle="monthly"
    />
    <EnrollModal
      isOpen={$isEnrollModalOpen}
      onClose={() => ($isEnrollModalOpen = false)}
    />
  {/if}

  <!-- Custom Transcript Reset Modal -->
  <TranscriptResetModal
    isOpen={showTranscriptResetModal}
    onClose={() => (showTranscriptResetModal = false)}
    onConfirm={confirmTranscriptReset}
  />

  <!-- Main Content -->
  <div
    class="flex-1 relative overflow-x-hidden overflow-y-auto h-full bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:20px_20px] pt-16 lg:pt-0"
  >
    <main
      class="w-full py-8 lg:py-12 px-4 lg:px-16 pb-32 animate-in fade-in duration-700 slide-in-from-bottom-4"
    >
      {#if currentLectureId && !isEditing}
        <!-- Viewing Result Mode -->
        <div class="mb-10">
          <button
            on:click={() => {
              currentLectureId = null;
              isEditing = false; // Show dashboard
            }}
            class="mb-8 text-sm font-bold text-slate-400 hover:text-indigo-600 flex items-center gap-2 transition-colors"
          >
            ← 履歴リストへ戻る
          </button>

          <div class="mb-10">
            <h1 class="text-4xl font-bold text-slate-900 tracking-tight mb-2">
              {lectureTitle}
            </h1>
            <div
              class="h-1.5 w-24 bg-gradient-to-r from-indigo-600 to-pink-400 mt-4 rounded-full opacity-90"
            ></div>
          </div>

          <ResultView
            {lectureAnalyses}
            {result}
            {derivativeAnalyzing}
            {isResultCopied}
            {previewVideoUrl}
            {currentLectureId}
            {isPremium}
            {isUltimate}
            {selectedDerivativeMode}
            {derivativeTargetLength}
            bind:qaInput
            {isAskingQuestion}
            on:copy={copyResultToClipboard}
            on:edit={() => (isEditing = true)}
            on:select_derivative={(
              e: CustomEvent<"note" | "thoughts" | "report">,
            ) => (selectedDerivativeMode = e.detail)}
            on:length_change={(e: CustomEvent<string | number>) =>
              (derivativeTargetLength = Number(e.detail))}
            on:generate={(e: CustomEvent<"note" | "thoughts" | "report">) =>
              handleDerivativeGenerate(e.detail)}
            on:upgrade_request={() => (showUpgradeModal = true)}
            on:ask_question={askQuestion}
          />

          <!-- Interactive QA History Section (Input is now in sticky toolbar) -->
          <div
            class="mt-12 bg-white rounded-3xl p-6 lg:p-8 shadow-sm border border-slate-200"
          >
            <h3
              class="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"
            >
              <span class="text-2xl">💬</span> AIアシスタントとの対話履歴
            </h3>

            <div
              id="qa-container"
              class="space-y-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2"
            >
              {#if qaHistory.length === 0}
                <div class="text-center py-8 text-slate-400">
                  <p class="text-sm">
                    上部のツールバーから質問や課題を入力すると、ここに回答が表示されます。
                  </p>
                </div>
              {:else}
                {#each qaHistory as msg}
                  <div
                    class="flex flex-col {msg.role === 'user'
                      ? 'items-end'
                      : 'items-start'}"
                  >
                    <div
                      class="max-w-[85%] rounded-2xl p-4 {msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : 'bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-none'}"
                    >
                      <div
                        class="prose prose-sm {msg.role === 'user'
                          ? 'prose-invert'
                          : 'prose-slate'} max-w-none"
                      >
                        {@html marked.parse(msg.content)}
                      </div>
                    </div>
                  </div>
                {/each}
              {/if}

              {#if isAskingQuestion}
                <div class="flex flex-col items-start">
                  <div
                    class="max-w-[85%] rounded-2xl p-4 bg-slate-50 border border-slate-100 text-slate-700 rounded-bl-none flex items-center gap-3"
                  >
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                    ></div>
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                      style="animation-delay: 0.1s"
                    ></div>
                    <div
                      class="w-2 h-2 rounded-full bg-slate-400 animate-bounce"
                      style="animation-delay: 0.2s"
                    ></div>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>
      {:else if selectedSubjectId && !isEditing}
        {@const subject = $subjects.find((s) => s.id === selectedSubjectId)}
        {#if subject}
          <!-- Subject Dashboard -->
          <div class="mb-10">
            <div class="flex items-center gap-4 mb-4">
              <div class="w-8 h-8 rounded-full {subject.color} shadow-sm"></div>
              <h1 class="text-4xl font-bold text-slate-900 tracking-tight">
                {subject.name}
              </h1>
            </div>
            <p class="text-slate-500">
              {$lectures.filter((l: any) => l.subjectId === selectedSubjectId)
                .length}
              講義がこの科目にあります
            </p>

            <!-- Tab Switcher -->
            <div class="mt-8 flex gap-2 border-b border-slate-200">
              <button
                on:click={() => {
                  finalExamView = false;
                }}
                class="px-6 py-3 font-bold transition-all relative {!finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                📚 講義一覧
              </button>
              <button
                on:click={() => {
                  finalExamView = true;
                }}
                class="px-6 py-3 font-bold transition-all relative flex items-center gap-2 {finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                🔥 期末試験対策
                {#if analyzingFinal}
                  <svg
                    class="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      class="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      stroke-width="4"
                    ></circle>
                    <path
                      class="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                {/if}
              </button>
            </div>

            {#if finalExamView}
              <!-- Final Exam Summary Section -->
              <div class="mt-8 animate-in fade-in slide-in-from-bottom-4">
                <!-- Regenerate Section -->
                <div
                  class="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-3xl p-6 mb-8 border border-indigo-100"
                >
                  <div class="flex items-start justify-between gap-6">
                    <div class="flex-1">
                      <h3 class="text-lg font-bold text-slate-900 mb-2">
                        🎓 試験対策ノート生成
                      </h3>
                      <p class="text-sm text-slate-600 mb-4">
                        各講義の要約を統合して、最短で試験準備が完了できる対策ノートを生成します。
                      </p>

                      <!-- Custom Instructions -->
                      <div class="mb-4">
                        <label
                          for="final-exam-instructions"
                          class="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2"
                          >AIへの追加指示（オプション）</label
                        >
                        <textarea
                          id="final-exam-instructions"
                          bind:value={customAnalysisInstructions}
                          placeholder="例：○○的な視点を重視して、××の用語を多めに..."
                          class="w-full bg-white border border-slate-200 rounded-xl p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all resize-none"
                          rows="2"
                        ></textarea>
                      </div>

                      <button
                        on:click={(e) => {
                          if (!isUltimate) {
                            e.preventDefault();
                            upgradeModalTitle = "アルティメットプラン限定機能";
                            upgradeModalMessage =
                              "「試験対策ノート生成」機能はアルティメットプラン専用です。複数の講義をまたいだ高度な要約を作成するには、アップグレードを行ってください。";
                            showUltimateModal = true;
                            return;
                          }
                          generateFinalSummary();
                        }}
                        disabled={analyzingFinal}
                        class="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {#if analyzingFinal}
                          <svg
                            class="animate-spin h-5 w-5 text-white"
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle
                              class="opacity-25"
                              cx="12"
                              cy="12"
                              r="10"
                              stroke="currentColor"
                              stroke-width="4"
                            ></circle>
                            <path
                              class="opacity-75"
                              fill="currentColor"
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                            ></path>
                          </svg>
                          AIが対策ノートを編集中...
                        {:else}
                          {finalExamResult
                            ? "🔄 再生成する"
                            : "✨ 対策ノートを生成する"}
                        {/if}
                      </button>

                      {#if dailyRemaining !== Infinity}
                        <div class="mt-4 flex items-center gap-2">
                          <span
                            class="text-[10px] font-bold px-2 py-0.5 rounded-full {dailyRemaining >
                            0
                              ? 'bg-indigo-100 text-indigo-600'
                              : 'bg-rose-100 text-rose-600'}"
                          >
                            本日あと {dailyRemaining} 回
                          </span>
                          <span class="text-[10px] text-slate-400">
                            （無料枠 上限 3回/日）
                          </span>
                        </div>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Final Exam Result Display -->
                {#if finalExamResult}
                  <div class="flex justify-end mb-3 mt-4">
                    <button
                      on:click={copyToClipboard}
                      class="flex items-center gap-2 px-4 py-2 rounded-xl {isCopied
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-white hover:bg-slate-700'} transition-all shadow-md active:scale-95 font-bold"
                    >
                      {#if isCopied}
                        ✅ コピーしました！
                      {:else}
                        📋 対策ノートをコピー
                      {/if}
                    </button>
                  </div>

                  <div
                    class="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm"
                  >
                    <div
                      bind:this={finalResultContainer}
                      class="prose prose-slate prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-700 prose-li:text-slate-700 prose-strong:text-slate-900 max-w-none"
                    >
                      {@html marked.parse(finalExamResult)}
                    </div>
                  </div>
                {:else if !analyzingFinal}
                  <div
                    class="text-center py-12 text-slate-400 border-2 border-dashed border-slate-200 rounded-3xl"
                  >
                    <p class="text-lg font-bold mb-2">
                      試験対策ノートがまだ生成されていません
                    </p>
                    <p class="text-sm">
                      上のボタンをクリックして生成してください
                    </p>
                  </div>
                {/if}
              </div>
            {:else}
              <!-- Lecture Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-10">
                {#each $lectures.filter((l: any) => l.subjectId === selectedSubjectId) as lecture (lecture.id)}
                  <LectureCard
                    {lecture}
                    {selectedLectureIds}
                    {movingLectureId}
                    {draggingLectureId}
                    {handleDragStartToSidebar}
                    {toggleLectureSelection}
                    setMovingLectureId={(id) => (movingLectureId = id)}
                    {moveLecture}
                    {loadLecture}
                    {handleDragEnd}
                  />
                {/each}
                {#if $lectures.filter((l) => l.subjectId === selectedSubjectId).length === 0}
                  <div
                    on:dragover={handleMainTargetDragOver}
                    on:dragleave={handleMainTargetDragLeave}
                    on:drop={handleMainTargetDrop}
                    role="region"
                    aria-label="講義のドロップエリア"
                    class="col-span-full text-center py-12 text-slate-400 border-2 border-dashed rounded-3xl transition-all duration-300
                  {isDragOverMainTarget
                      ? 'bg-indigo-50 border-indigo-400 scale-[1.01] text-indigo-500 ring-4 ring-indigo-500/10'
                      : 'border-slate-200'}"
                  >
                    この科目にはまだ講義がありません。<br />
                    サイドバーから講義をドラッグして追加してください。
                  </div>

                  <button
                    on:click={() => (isEditing = true)}
                    class="col-span-full mt-4 w-full py-4 rounded-2xl border-2 border-dashed border-slate-200 text-slate-400 font-bold hover:border-indigo-300 hover:text-indigo-500 hover:bg-indigo-50/30 transition-all flex items-center justify-center gap-2"
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
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                    この科目に新しい講義を追加
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- Input Section Only (History moved to /history) -->
        <div class="mb-10">
          <!-- 1. Header Area: Course Select (Mandatory) -->
          <div class="mb-6 px-4">
            <label
              for="course-select"
              class="block text-xl font-bold text-slate-700 mb-2"
              >履修中の講義を選択 <span class="text-red-500 text-sm align-top"
                >必須</span
              ></label
            >
            <!-- Custom Dropdown Wrapper -->
            <div class="relative w-full z-50">
              <button
                type="button"
                id="course-dropdown-trigger"
                on:click={(e) => {
                  e.stopPropagation();
                  isCourseDropdownOpen = !isCourseDropdownOpen;
                }}
                class="w-full flex items-center justify-between p-4 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50 text-left transition-all"
              >
                <span
                  class="text-gray-700 font-medium text-lg {$lectureTitle
                    ? 'text-slate-800'
                    : 'text-slate-400'}"
                >
                  {$lectureTitle || "講義を選択してください"}
                </span>
                <svg
                  class="w-5 h-5 text-gray-400 transition-colors {isCourseDropdownOpen
                    ? 'rotate-180'
                    : ''}"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>

              <!-- Custom Dropdown Menu -->
              {#if isCourseDropdownOpen}
                <!-- Backdrop for click-outside -->
                <div
                  class="fixed inset-0 z-40"
                  on:click={() => (isCourseDropdownOpen = false)}
                  role="button"
                  tabindex="0"
                  on:keydown={(e) => {
                    if (e.key === "Escape") isCourseDropdownOpen = false;
                  }}
                ></div>

                <div
                  class="absolute top-full left-0 w-full mt-2 bg-white border border-gray-100 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                >
                  <div class="max-h-60 overflow-y-auto custom-scrollbar">
                    {#if enrolledCoursesList && enrolledCoursesList.length > 0}
                      {#each enrolledCoursesList as course}
                        <button
                          type="button"
                          on:click={() => {
                            $lectureTitle = course.courseName;
                            isCourseDropdownOpen = false;
                          }}
                          class="w-full text-left px-4 py-3 hover:bg-purple-50 hover:text-purple-600 transition-colors border-b border-gray-50 last:border-0 flex items-center justify-between group {$lectureTitle ===
                          course.courseName
                            ? 'bg-purple-50 text-purple-700 font-bold'
                            : 'text-slate-700'}"
                        >
                          <span class="text-lg">
                            {course.courseName}
                            {#if course.instructor}
                              <span class="text-xs text-slate-500 ml-2"
                                >({course.instructor})</span
                              >
                            {/if}
                          </span>
                          {#if $lectureTitle === course.courseName}
                            <svg
                              class="w-5 h-5 text-purple-600"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2.5"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          {/if}
                        </button>
                      {/each}
                    {:else}
                      <div class="p-6 text-center text-slate-500 text-sm">
                        <p class="font-bold mb-2 text-slate-600">
                          履修中の講義がありません
                        </p>
                        <p class="text-xs mb-4">
                          時間割から講義を追加して、AIに学習させましょう。
                        </p>
                        <button
                          type="button"
                          on:click={() => {
                            isCourseDropdownOpen = false;
                            $isEnrollModalOpen = true;
                          }}
                          class="bg-indigo-600 text-white font-bold py-2 px-4 rounded-xl shadow-sm hover:bg-indigo-700 transition"
                        >
                          ⚙️ 履修講義を登録する
                        </button>
                      </div>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          </div>
        </div>

        <!-- Input Section -->
        <div
          class="mb-10 bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden relative"
        >
          <div class="p-8">
            <div class="p-8 md:p-12 relative">
              <!-- 2. Mode & Settings (2 Columns) -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-12 mb-10">
                <!-- Left: Mode -->
                <div>
                  <span
                    class="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                    >生成モード</span
                  >
                  <div class="flex bg-slate-100/80 p-1.5 rounded-2xl">
                    <button
                      on:click={() => setAnalysisMode("note")}
                      class="flex-1 py-3 rounded-xl text-sm font-bold transition-all {$analysisMode ===
                      'note'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}">ノート</button
                    >
                    <button
                      on:click={() => setAnalysisMode("thoughts")}
                      class="flex-1 py-3 rounded-xl text-sm font-bold transition-all {$analysisMode ===
                      'thoughts'
                        ? 'bg-white text-amber-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}">感想</button
                    >
                    <button
                      on:click={() => setAnalysisMode("report")}
                      class="flex-1 py-3 rounded-xl text-sm font-bold transition-all {$analysisMode ===
                      'report'
                        ? 'bg-white text-slate-800 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}"
                      >レポート</button
                    >
                  </div>
                </div>

                <!-- Right: Length -->
                <div>
                  {#if $analysisMode !== "note"}
                    <div class="flex justify-between items-center mb-4">
                      <label
                        for="target-length"
                        class="block text-xs font-bold text-slate-400 uppercase tracking-widest"
                        >目標文字数</label
                      >
                      <span
                        class="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg"
                        >{manuscriptPages}枚分</span
                      >
                    </div>

                    <div class="relative w-full pt-6 pb-2">
                      <span
                        class="absolute -top-3 px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg transform -translate-x-1/2 transition-all"
                        style="left: {(($targetLength - 100) / 3900) * 100}%"
                      >
                        {$targetLength}文字
                      </span>
                      <input
                        id="target-length"
                        type="range"
                        min="100"
                        max="4000"
                        step="50"
                        bind:value={$targetLength}
                        on:input={handleLengthChange}
                        class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 hover:accent-indigo-500 relative z-10 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                      />

                      <div
                        class="relative w-full mt-2 text-xs text-slate-400 font-bold"
                      >
                        <span
                          class="absolute"
                          style="left: 0%; transform: translateX(0);">100</span
                        >
                        <span
                          class="absolute"
                          style="left: 10.25%; transform: translateX(-50%);"
                          >500</span
                        >
                        <span
                          class="absolute"
                          style="left: 48.71%; transform: translateX(-50%);"
                          >2000</span
                        >
                        <span
                          class="absolute"
                          style="right: 0%; transform: translateX(0);"
                          >4000</span
                        >
                      </div>
                    </div>
                  {:else}
                    <div
                      class="h-full flex items-center justify-center p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200"
                    >
                      <p class="text-xs font-bold text-slate-400 text-center">
                        ノート作成モードでは文字数制限はありません。<br />
                        網羅的に詳細なノートを作成します。
                      </p>
                    </div>
                  {/if}
                </div>
              </div>

              <!-- 3. File Inputs (Compact) -->
              <div class="space-y-10 mb-10">
                <!-- Group A: Learning Materials -->
                <div>
                  <h3
                    class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                  >
                    <svg
                      class="w-4 h-4"
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
                    学習資料 (A系統)
                  </h3>
                  <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <FileInputCard
                      id="pdf"
                      label="PDF"
                      iconColorClass="text-red-400"
                      fileStore={$pdfFile}
                      accept=".pdf"
                      iconPath="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      on:change={(e) =>
                        handleFileChange(e.detail.event, e.detail.id)}
                      on:upgrade={(e) => handleUpgradeRequest(e.detail.label)}
                    />
                    <FileInputCard
                      id="single_image"
                      label="IMAGE"
                      iconColorClass="text-blue-400"
                      fileStore={$imageFile}
                      accept="image/*"
                      iconPath="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                      on:change={(e) =>
                        handleFileChange(e.detail.event, e.detail.id)}
                      on:upgrade={(e) => handleUpgradeRequest(e.detail.label)}
                    />
                    <!-- NEW CAMERA BUTTON -->
                    <FileInputCard
                      id="staged_image"
                      label="CAMERA"
                      iconColorClass="text-orange-400"
                      fileStore={null}
                      accept="image/*"
                      iconPath="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                      on:change={(e) =>
                        handleFileChange(e.detail.event, e.detail.id)}
                      on:upgrade={(e) => handleUpgradeRequest(e.detail.label)}
                    />
                    <FileInputCard
                      id="txt"
                      label="TEXT"
                      iconColorClass="text-emerald-400"
                      fileStore={$txtFile}
                      accept=".txt"
                      iconPath="M4 6h16M4 12h16M4 18h7"
                      on:change={(e) =>
                        handleFileChange(e.detail.event, e.detail.id)}
                      on:upgrade={(e) => handleUpgradeRequest(e.detail.label)}
                    />
                  </div>
                </div>

                <!-- Staging Area for Multiple Images -->
                {#if $stagedImages.length > 0}
                  <div
                    class="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl"
                  >
                    <h4
                      class="text-xs font-bold text-slate-500 mb-3 flex items-center justify-between"
                    >
                      <span>📸 撮影された画像 ({$stagedImages.length}枚)</span>
                      <button
                        on:click={() =>
                          document
                            .getElementById(`file-input-staged_image`)
                            ?.click()}
                        class="text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded-full flex items-center gap-1 transition-colors"
                      >
                        <svg
                          class="w-3 h-3"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          ><path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 4v16m8-8H4"
                          /></svg
                        >
                        追加撮影
                      </button>
                    </h4>
                    <div
                      class="flex overflow-x-auto gap-3 pb-2 custom-scrollbar"
                    >
                      {#each $stagedImages as img, idx}
                        <div
                          class="relative w-24 h-24 flex-shrink-0 bg-white rounded-lg border border-slate-200 p-1 group"
                        >
                          <img
                            src={URL.createObjectURL(img)}
                            alt={`Captured ${idx}`}
                            class="w-full h-full object-cover rounded-md"
                          />
                          <button
                            on:click={() => {
                              stagedImages.update((current) =>
                                current.filter((_, i) => i !== idx),
                              );
                            }}
                            aria-label="画像を削除"
                            class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                          >
                            <svg
                              class="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                              /></svg
                            >
                          </button>
                        </div>
                      {/each}
                    </div>
                  </div>
                {/if}

                <!-- Group B: Multimedia -->
                <div>
                  <h3
                    class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      /></svg
                    >
                    マルチメディア (B系統)
                  </h3>
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FileInputCard
                      id="video"
                      label="MEDIA"
                      iconColorClass="text-purple-400"
                      fileStore={$videoFile || $audioFile}
                      accept="video/*,audio/*"
                      iconPath="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      isDisabled={!isPremium}
                      on:change={(e) =>
                        handleFileChange(e.detail.event, e.detail.id)}
                      on:upgrade={(e) => handleUpgradeRequest(e.detail.label)}
                    />
                  </div>
                </div>

                <!-- URL Analysis -->
                <div>
                  <h3
                    class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest mb-4"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      /></svg
                    >
                    URLから解析
                  </h3>
                  <div
                    class="h-16 rounded-xl border-2 border-dashed border-slate-200 hover:border-indigo-300 flex items-center px-4 transition-colors relative group"
                  >
                    <svg
                      class="w-5 h-5 text-slate-400 mr-3"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      /></svg
                    >
                    <input
                      type="text"
                      bind:value={$targetUrl}
                      placeholder="URLを入力 (Webサイトのみ)"
                      class="w-full bg-transparent border-none focus:outline-none text-sm font-bold text-slate-600 placeholder:text-slate-300"
                    />
                  </div>
                </div>
              </div>

              <!-- 4. Transcript Area (Realtime Edit) -->
              <div class="mb-10">
                <div class="flex items-center justify-between mb-4">
                  <h3
                    class="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-widest"
                  >
                    <svg
                      class="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                      /></svg
                    >
                    文字起こし (リアルタイム編集)
                  </h3>

                  {#if $transcript || $interimTranscript}
                    <button
                      on:click={handleTranscriptReset}
                      class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
                    >
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
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                      リセット
                    </button>
                  {/if}
                </div>
                <textarea
                  value={$transcript + $interimTranscript}
                  on:input={(e) => transcript.set(e.currentTarget.value)}
                  use:actionTextAreaAutoscroll
                  class="w-full h-48 p-4 bg-gray-50 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none resize-none text-sm text-slate-700 leading-relaxed custom-scrollbar"
                  placeholder="ここに文字起こしが表示されます... (手動で修正可能)"
                ></textarea>
              </div>

              <div
                class="mt-8 flex flex-col md:flex-row justify-end items-center gap-6"
              >
                {#if analyzing}
                  <!-- Main Analysis Progress & Skeleton -->
                  <div
                    class="w-full bg-white/50 backdrop-blur-sm p-6 rounded-2xl border border-indigo-50 shadow-sm animate-in fade-in slide-in-from-bottom-2"
                  >
                    <div class="flex items-center gap-4 mb-6">
                      <div
                        class="w-6 h-6 rounded-full border-4 border-indigo-100 border-t-indigo-600 animate-spin"
                      ></div>
                      <p
                        class="text-sm font-bold text-indigo-900 transition-all duration-300 flex-1"
                      >
                        {progressStatus}
                      </p>
                      <span class="text-sm font-bold text-slate-400"
                        >{Math.floor(progressValue)}%</span
                      >
                    </div>

                    <div
                      class="h-2 w-full bg-slate-100 rounded-full overflow-hidden mb-8 shadow-inner"
                    >
                      <div
                        class="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 transition-all duration-300"
                        style="width: {progressValue}%"
                      ></div>
                    </div>

                    <!-- Ambient Skeleton Layout -->
                    <div
                      class="space-y-6 opacity-40 mix-blend-multiply flex flex-col items-center"
                    >
                      <div
                        class="w-3/4 max-w-md h-6 bg-slate-200/80 rounded-lg animate-pulse"
                      ></div>
                      <div class="space-y-3 w-full max-w-lg">
                        <div
                          class="w-full h-3 bg-slate-200/60 rounded animate-pulse"
                        ></div>
                        <div
                          class="w-full h-3 bg-slate-200/60 rounded animate-pulse"
                        ></div>
                        <div
                          class="w-4/5 h-3 bg-slate-200/60 rounded animate-pulse"
                        ></div>
                      </div>
                    </div>

                    <div class="mt-6 text-center md:text-right">
                      <button
                        on:click={handleCancelAnalysis}
                        class="text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-red-500 transition-colors bg-white px-3 py-1.5 rounded-lg border border-slate-100 shadow-sm"
                        >キャンセル</button
                      >
                    </div>
                  </div>
                {:else}
                  <div class="flex flex-col items-center gap-4">
                    <button
                      on:click={handleAnalyze}
                      disabled={analyzing ||
                        (!$pdfFile &&
                          !$imageFile &&
                          !$txtFile &&
                          !$videoFile &&
                          !$audioFile &&
                          !$targetUrl &&
                          !$transcript.trim() &&
                          $stagedImages.length === 0)}
                      class="bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 hover:translate-y-[-2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                    >
                      <span class="text-lg">解析を開始</span>
                    </button>

                    <!-- isShared Toggle Switch -->
                    <label
                      class="flex items-center gap-2 cursor-pointer bg-white px-4 py-2 rounded-full shadow-sm border border-slate-100 transition-all hover:border-indigo-100"
                    >
                      <input
                        type="checkbox"
                        bind:checked={$isShared}
                        class="sr-only peer"
                      />
                      <div
                        class="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500 relative"
                      ></div>
                      <span class="text-sm font-bold text-slate-600"
                        >このノートをみんなに公開する</span
                      >
                    </label>
                  </div>
                {/if}
              </div>

              <!-- Floating Mic Button (Bottom Right) -->
              <button
                on:click={toggleRecording}
                class="fixed bottom-8 right-8 z-50 w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all duration-300 hover:scale-110 active:scale-95 border-4 border-white
                  {$isRecording
                  ? 'bg-red-500 shadow-red-300 animate-pulse'
                  : 'bg-white text-indigo-600 shadow-indigo-200'}"
              >
                {#if $isRecording}
                  <div class="w-6 h-6 bg-white rounded-md"></div>
                {:else}
                  <svg
                    class="w-8 h-8"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    /></svg
                  >
                {/if}
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between mb-8">
          <div>
            <h1 class="text-2xl font-bold text-slate-900 tracking-tight">
              未分類の履歴
            </h1>
            <p class="text-slate-500 mt-2">
              {$lectures.filter((l) => !l.subjectId).length} 件の講義が整理を待っています
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          {#each $lectures.filter((l: any) => !l.subjectId) as lecture (lecture.id)}
            <LectureCard
              {lecture}
              {selectedLectureIds}
              {movingLectureId}
              {draggingLectureId}
              {handleDragStartToSidebar}
              {toggleLectureSelection}
              setMovingLectureId={(id) => (movingLectureId = id)}
              {moveLecture}
              {loadLecture}
              {handleDragEnd}
            />
          {/each}
          {#if $lectures.filter((l) => !l.subjectId).length === 0}
            <div
              class="col-span-full text-center py-20 text-slate-300 border-2 border-dashed border-slate-100 rounded-3xl"
            >
              <p class="text-lg font-medium mb-1">未分類の履歴はありません</p>
              <p class="text-sm">
                全ての講義が科目バインダーに整理されています。
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </main>
  </div>

  <!-- FAB: Recording Start Button (Only visible when NOT recording, Global Bar handles Stop) -->
  {#if user && !$isRecording}
    <div class="fixed bottom-8 right-8 flex flex-col items-end gap-4 z-40">
      <button
        on:click={toggleRecording}
        class="w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-105 active:scale-95 group border border-white/10 bg-white text-red-500 hover:bg-slate-50"
        title="Start Recording"
      >
        <div class="relative">
          <svg
            class="w-8 h-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
            />
          </svg>
        </div>
      </button>
    </div>
  {/if}
</div>
