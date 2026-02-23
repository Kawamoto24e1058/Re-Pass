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
    getDoc,
    getDocs,
    limit,
    deleteDoc,
    serverTimestamp,
    startAt,
    endAt,
  } from "firebase/firestore";
  import { goto } from "$app/navigation";
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
  } from "$lib/stores/sessionStore";
  import { recognitionService } from "$lib/services/recognitionService";
  import { page } from "$app/stores";
  import UpgradeModal from "$lib/components/UpgradeModal.svelte";
  import EnrollModal from "$lib/components/EnrollModal.svelte";
  import { isEnrollModalOpen } from "$lib/stores";

  // --- Simplified State Variables ---
  let isEditing = $state(false);
  let isCourseDropdownOpen = $state(false);
  // lectureTitle is managed by sessionStore
  let currentLectureId = $state<string | null>(null);
  let selectedSubjectId = $state<string | null>(null);
  let draggingLectureId = $state<string | null>(null);
  let isDragOverMainTarget = $state(false);
  let selectedLectureIds = $state(new Set<string>());
  let movingLectureId = $state<string | null>(null);

  // User & Data State
  let user = $state<any>(null);
  let userData = $state<any>(null);

  // Sync state with store
  $effect(() => {
    user = $userStore;
    userData = $userProfile; // Restore this for global data access
    selectedSubjectId = $currentBinder;
  });

  // Debug logging for dropdown data
  $effect(() => {
    console.log("Dropdown Debug: userData", userData);
    console.log("Dropdown Debug: Enrolled Courses", userData?.enrolledCourses);
  });

  // Derived courses for display (with retry/fallback)
  let enrolledCoursesList = $state<any[]>([]);
  let unsubscribeEnrolledCourses: any = null;

  $effect(() => {
    if (user) {
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
    return () => {
      if (unsubscribeEnrolledCourses) unsubscribeEnrolledCourses();
    };
  });

  // UI State
  let toastMessage = $state<string | null>(null);
  let analysisProposal = $state<{
    lectureId: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);

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

  let upgradeModalTitle = $state("ULTIMATE限定機能");
  let upgradeModalMessage = $state("");
  let showUpgradeModal = $state(false);
  let showUltimateModal = $state(false);
  let analyzing = $state(false);
  let cancellationController = $state<AbortController | null>(null);

  type AnalysisResult =
    | {
        title?: string;
        category?: string;
        summary: string;
        glossary?: { term: string; definition: string }[];
      }
    | string;

  let result = $state<AnalysisResult>("");
  let analyzedTitle = $state("");
  let analyzedCategory = $state("");

  // --- Derivative Generation State ---
  let lectureAnalyses = $state<Record<string, AnalysisResult>>({});
  let initialGenerationDone = $state(false);
  let derivativeAnalyzing = $state(false);

  let resultTextContainer = $state<HTMLElement | null>(null); // For individual copy
  let resultContainer = $state<HTMLElement | null>(null); // For auto-scroll
  let finalResultContainer = $state<HTMLElement | null>(null); // For final copy

  let unsubscribeUser: any = null;
  let previewVideoUrl = $state<string | null>(null);
  let videoPlayer = $state<HTMLVideoElement | null>(null);

  // Speech Recognition State - Moved to global recordingStore
  // let isRecording = $state(false);
  // let transcript = $state("");
  // let finalTranscript = $state("");
  // let recognition: any;

  // Analysis Settings
  // Managed by sessionStore: analysisMode, targetLength

  // Series Analysis State
  let analyzingSeries = $state(false);
  let seriesSummary = $state<{
    story: string;
    unresolved: string;
    exam: string;
  } | null>(null);

  // Progress State
  let progressValue = $state(0);
  let progressStatus = $state("準備中...");
  let progressInterval: any;
  let customAnalysisInstructions = $state("");
  let analyzingFinal = $state(false);
  let finalExamView = $state(false); // Toggle between lecture list and final exam
  let finalExamResult = $state(""); // Store AI-generated final exam summary
  let isCopied = $state(false); // Feedback state for summary copy
  let isResultCopied = $state(false); // Feedback state for individual results

  // Copy result to clipboard (AnalysisResult aware)
  let strategyContent = $derived.by(() => {
    const ca = lectureAnalyses[$analysisMode];
    if (!ca || typeof ca !== "object" || !ca.summary) return null;
    const match = ca.summary.match(
      /\[A_STRATEGY_START\]([\s\S]*?)\[A_STRATEGY_END\]/,
    );
    return match ? match[1].trim() : null;
  });

  let displaySummary = $derived.by(() => {
    const ca = lectureAnalyses[$analysisMode];
    if (!ca) return "";
    if (typeof ca === "string") return ca;
    if (!ca.summary) return "";
    return ca.summary
      .replace(/\[A_STRATEGY_START\][\s\S]*?\[A_STRATEGY_END\]/g, "")
      .trim();
  });

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
    const currentData = lectureAnalyses[$analysisMode] || result;

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

      // Ideally call a shared service or API
      const idToken = await user.getIdToken();
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          text: $transcript || lecture.content,
          mode: mode,
          length: targetLength,
        }),
      });

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data = await response.json();
      const newResult = data.analysis;

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

  // --- Derived State for UI ---
  let manuscriptPages = $derived(Math.ceil($targetLength / 400));

  let isUltimate = $derived(
    String(userData?.plan || "")
      .trim()
      .toLowerCase() === "ultimate",
  );
  let isPremium = $derived(
    isUltimate ||
      String(userData?.plan || "")
        .trim()
        .toLowerCase() === "premium",
  );
  let isFree = $derived(!isPremium);

  let dailyRemaining = $derived.by(() => {
    if (isPremium) return Infinity;
    const today = new Date().toISOString().split("T")[0];
    const dailyUsage = userData?.dailyUsage || {
      count: 0,
      lastResetDate: today,
    };
    if (dailyUsage.lastResetDate !== today) return 3;
    return Math.max(0, 3 - dailyUsage.count);
  });

  let headerTitle = $derived(
    $analysisMode === "note"
      ? "講義ノート (復習用)"
      : $analysisMode === "thoughts"
        ? "感想・リアクション (提出用)"
        : "学術レポート (課題用)",
  );

  let containerBgColor = $derived(
    $analysisMode === "note"
      ? "bg-white/60"
      : $analysisMode === "thoughts"
        ? "bg-amber-50/60"
        : "bg-slate-50/60",
  );

  // --- Lifecycle & Auth ---
  let wakeLock = $state<WakeLockSentinel | null>(null);

  // Wake Lock & Navigation Warning
  $effect(() => {
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
  });

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

    // ... (rest of onMount)

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

  // ... (Keep existing onMount logic) ...

  // Global SpeechRecognition is managed in +layout via recognitionService

  // --- Timer & Progress ---
  let duration = $state(0);
  let timerInterval: any;

  $effect(() => {
    if ($isRecording) {
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
  });

  function formatTime(seconds: number) {
    const m = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function startProgress() {
    progressValue = 0;
    progressStatus = "音声データを解析中...";
    progressInterval = setInterval(() => {
      if (progressValue < 30) {
        progressValue += Math.random() * 2;
        progressStatus = "音声データを解析中...";
      } else if (progressValue < 60) {
        progressValue += Math.random() * 1.5;
        progressStatus = "講義の構造を分析中...";
      } else if (progressValue < 85) {
        progressValue += Math.random() * 0.5;
        progressStatus = "ノートをまとめています...";
      } else if (progressValue < 95) {
        progressValue += 0.1;
        progressStatus = "仕上げ中...";
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
      !$transcript
    ) {
      toastMessage = "学習素材を入力してください";
      return;
    }

    // Quota Checks
    const usageCount = userData?.usageCount || 0;
    if (!isPremium && usageCount >= 5) {
      showUpgradeModal = true;
      return;
    }
    if (($videoFile || $audioFile || $targetUrl) && !isUltimate) {
      showUpgradeModal = true;
      toastMessage = "動画・音声解析はアルティメットプラン限定です";
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

      const formData = new FormData();
      if (audioUrl) formData.append("audioUrl", audioUrl);
      if (videoUrl) formData.append("videoUrl", videoUrl);
      if (pdfUrl) formData.append("pdfUrl", pdfUrl);
      if (imageUrl) formData.append("imageUrl", imageUrl);
      if ($txtFile) formData.append("txt", $txtFile);
      if ($targetUrl) formData.append("url", $targetUrl);
      formData.append("transcript", $transcript);
      formData.append("mode", $analysisMode);
      formData.append("plan", userData?.plan || "free");
      // targetLength is passed implicitly or we should add it if API supports it
      // formData.append("targetLength", $targetLength.toString());

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
        createdAt: serverTimestamp(),
        subjectId: selectedSubjectId || null,
        uid: user.uid,
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
    } catch (e: any) {
      console.error(e);
      toastMessage = "エラー: " + e.message;
      analyzing = false;
      stopProgress();
    }
  }

  // --- Functions ---

  // --- File Handlers ---
  let isExtractingAudio = $state(false);
  let extractionProgress = $state<AudioExtractionProgress | null>(null);

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
    if (input.files && input.files[0]) {
      const file = input.files[0];
      if (type === "pdf") pdfFile.set(file);
      if (type === "txt") txtFile.set(file);
      if (type === "image") imageFile.set(file);
      if (type === "audio") audioFile.set(file);
      if (type === "video") {
        videoFile.set(file);
        extractAudio(file);
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

    // targetUrl was removed in declaration, so remove usage
    localStorage.removeItem("transcript");
  }

  // --- Simplified Dashboard Logic ---

  onMount(() => {
    const urlId = $page.url.searchParams.get("lectureId");
    if (urlId && urlId !== currentLectureId) {
      loadLectureById(urlId);
    }
  });

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

  let parsedHtml = $derived(
    result
      ? typeof result === "object"
        ? marked.parse(result.summary)
        : marked.parse(result)
      : "",
  );

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
          onclick={() => {
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
          onclick={() => (analysisProposal = null)}
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
                onclick={() => bulkMoveLectures(subject.id)}
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
              onclick={() => bulkMoveLectures(null)}
              class="w-full text-left px-4 py-2.5 hover:bg-red-50 text-red-600 flex items-center gap-3 transition-colors"
            >
              <span class="text-xs font-medium">インボックスに戻す</span>
            </button>
          </div>
        </div>

        <button
          onclick={() => {
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
  {#snippet LectureItem(lecture: any)}
    <div
      draggable="true"
      ondragstart={(e) => handleDragStartToSidebar(e, lecture.id)}
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
            onclick={(e) => {
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
              onclick={(e) => {
                e.stopPropagation();
                movingLectureId =
                  movingLectureId === lecture.id ? null : lecture.id;
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
                    onclick={(e) => {
                      e.stopPropagation();
                      moveLecture(lecture.id, subject.id);
                      movingLectureId = null;
                    }}
                    class="w-full text-left px-4 py-2 hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                  >
                    <div class="w-2 h-2 rounded-full {subject.color}"></div>
                    <span class="text-xs text-slate-700">{subject.name}</span>
                  </button>
                {/each}
                <div class="h-px bg-slate-100 my-1"></div>
                <button
                  onclick={(e) => {
                    e.stopPropagation();
                    moveLecture(lecture.id, null);
                    movingLectureId = null;
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
          onclick={() => loadLecture(lecture)}
          ondragend={handleDragEnd}
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
                ? new Date(lecture.createdAt.toDate()).toLocaleDateString()
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
  {/snippet}

  {#snippet FileInputCard(
    id: string,
    label: string,
    iconColorClass: string,
    fileStore: File | null,
    accept: string,
    iconPath: string,
  )}
    <button
      onclick={() => document.getElementById(`file-input-${id}`)?.click()}
      class="relative group flex items-center gap-3 p-3 w-full h-20 rounded-xl border-2 transition-all duration-200 {fileStore
        ? 'bg-white border-indigo-200 ring-1 ring-indigo-200'
        : 'bg-slate-50 border-gray-200 hover:bg-gray-100'} hover:brightness-95 active:scale-[0.98]"
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
        onchange={(e) =>
          handleFileChange(
            e,
            id as "pdf" | "image" | "txt" | "audio" | "video",
          )}
      />
    </button>
  {/snippet}

  {#snippet ResultDisplay()}
    {@const currentAnalysis = lectureAnalyses[$analysisMode] || result}
    {#if currentAnalysis}
      <div
        bind:this={resultContainer}
        class="relative bg-white rounded-3xl shadow-sm border border-slate-100 p-8 md:p-12 animate-in fade-in slide-in-from-bottom-8 duration-700 overflow-hidden {$analysisMode ===
        'note'
          ? 'bg-article-paper'
          : ''}"
      >
        <div class="absolute top-6 right-6 flex items-center gap-4 z-20">
          {#if !derivativeAnalyzing}
            <button
              onclick={copyResultToClipboard}
              class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-500 hover:bg-white hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm active:scale-95 group"
            >
              {#if isResultCopied}
                <span
                  class="text-[10px] font-bold text-emerald-600 animate-in fade-in"
                  >✅ コピー完了</span
                >
              {:else}
                <span class="text-xs group-hover:scale-110 transition-transform"
                  >📋</span
                >
                <span class="text-[10px] font-bold uppercase tracking-wider"
                  >コピー</span
                >
              {/if}
            </button>
          {/if}
        </div>

        {#if derivativeAnalyzing}
          <div class="py-20 text-center animate-in fade-in">
            <!-- ... existing loading ... -->
            <p class="text-slate-400">生成中...</p>
          </div>
        {:else}
          <!-- Video Player (Sticky) -->
          {#if previewVideoUrl && $analysisMode === "note"}
            <div
              class="mb-8 sticky top-4 z-30 bg-white/95 backdrop-blur-md p-2 rounded-2xl shadow-lg border border-indigo-50 transition-all max-w-2xl mx-auto ring-1 ring-slate-900/50"
            >
              <video
                bind:this={videoPlayer}
                src={previewVideoUrl}
                controls
                class="w-full h-auto max-h-[300px] rounded-xl bg-black shadow-inner"
              >
                <track kind="captions" />
              </video>
              <p class="text-[10px] text-center text-slate-400 mt-1 font-bold">
                ノート内の <span
                  class="text-indigo-600 bg-indigo-50 px-1 rounded"
                  >[00:00]</span
                > をクリックしてシーク再生
              </p>
            </div>
          {/if}

          <!-- Rich Structured Display -->
          {#if typeof currentAnalysis === "object"}
            {@const isVideoSource =
              $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
                "video" ||
              $lectures.find((l) => l.id === currentLectureId)?.sourceType ===
                "audio"}

            <header class="mb-8 border-b border-indigo-50 pb-6">
              <div
                class="flex flex-wrap gap-2 mb-3 justify-between items-start"
              >
                <div class="flex gap-2">
                  {#if currentAnalysis.category}
                    <span
                      class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100"
                    >
                      {currentAnalysis.category}
                    </span>
                  {/if}
                  <span
                    class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-50 text-slate-500 border border-slate-100 uppercase tracking-wider"
                  >
                    {$analysisMode === "note"
                      ? "Lecture Note"
                      : $analysisMode === "thoughts"
                        ? "Reflections"
                        : "Academic Report"}
                  </span>
                </div>

                <button
                  onclick={() => {
                    isEditing = true;
                    finalExamView = false;
                  }}
                  class="text-xs font-bold text-slate-400 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg
                    class="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    ><path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    /></svg
                  >
                  編集に戻る
                </button>
              </div>

              <h1
                class="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight"
              >
                {currentAnalysis.title || analyzedTitle || "Analysis Result"}
              </h1>
            </header>

            <!-- Main Content (Summary) -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <article
              bind:this={resultTextContainer}
              onclick={handleTimestampClick}
              class="prose prose-slate max-w-none
                prose-p:text-slate-700 prose-p:leading-8 prose-p:text-[17px]
                prose-headings:font-bold prose-headings:text-slate-900 prose-headings:tracking-tight
                prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-indigo-500 prose-h2:pl-3
                prose-h3:text-lg prose-h3:text-indigo-900
                prose-ul:my-6 prose-li:my-1 prose-li:text-slate-700
                prose-strong:text-indigo-900 prose-strong:font-bold
                prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:underline
                prose-blockquote:border-l-indigo-300 prose-blockquote:bg-indigo-50/30 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg"
            >
              {@html (
                marked.parse(
                  isVideoSource
                    ? displaySummary
                    : displaySummary.replace(
                        /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                        "",
                      ),
                ) as string
              ).replace(
                /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none border border-indigo-100/50" data-timestamp="$1">▶ $1</button>',
              )}
            </article>

            <!-- Strategy Guide -->
            {#if strategyContent}
              <div
                class="mt-8 relative group overflow-hidden rounded-2xl border-2 transition-all duration-500 {isPremium
                  ? 'border-amber-400 bg-amber-50'
                  : 'border-slate-200 bg-slate-50'}"
              >
                <!-- Header -->
                <div
                  class="bg-gradient-to-r {isPremium
                    ? 'from-amber-400 to-amber-500 text-white'
                    : 'from-slate-200 to-slate-300 text-slate-500'} px-6 py-3 font-bold flex items-center gap-2"
                >
                  <span class="text-xl">{isPremium ? "🏆" : "🔒"}</span>
                  <span>A評価攻略ガイド</span>
                  {#if isPremium}
                    <span
                      class="ml-auto text-xs bg-white/20 px-2 py-0.5 rounded text-amber-50 font-normal"
                      >{isUltimate ? "Ultimate" : "Premium"}</span
                    >
                  {/if}
                </div>

                <!-- Content -->
                <div class="p-6 relative">
                  <div
                    class="prose prose-sm max-w-none prose-p:text-slate-700 prose-headings:text-amber-900 {isPremium
                      ? ''
                      : 'blur-sm select-none opacity-50 pointer-events-none'}"
                  >
                    {@html marked.parse(strategyContent)}
                  </div>

                  <!-- Lock Overlay for Free Users -->
                  {#if !isPremium}
                    <div
                      class="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center"
                    >
                      <div
                        class="bg-white/90 backdrop-blur-sm p-6 rounded-2xl shadow-xl border border-white/50 max-w-sm"
                      >
                        <div
                          class="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl"
                        >
                          🔒
                        </div>
                        <h3 class="font-bold text-slate-900 mb-2">
                          A評価攻略ガイドをアンロック
                        </h3>
                        <p class="text-xs text-slate-500 mb-4 leading-relaxed">
                          この講義の「評価基準」に基づいた、具体的な高評価獲得戦略（レポートのキーワードやテスト対策など）を表示します。
                        </p>
                        <button
                          onclick={() => (showUpgradeModal = true)}
                          class="w-full bg-slate-900 text-white py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 transition-all"
                        >
                          プレミアムプランにアップグレード
                        </button>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {/if}

            <!-- Glossary Section (Conditional) -->
            {#if currentAnalysis.glossary && currentAnalysis.glossary.length > 0}
              <section class="mt-16 pt-10 border-t border-slate-200/60">
                <h3
                  class="flex items-center gap-2 text-lg font-bold text-slate-900 mb-6"
                >
                  <span class="text-xl">📚</span> 用語辞典
                </h3>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {#each currentAnalysis.glossary as item}
                    <div
                      class="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-indigo-100 hover:shadow-sm transition-all group"
                    >
                      <dt
                        class="font-bold text-indigo-900 text-[15px] mb-1 group-hover:text-indigo-700 flex items-baseline justify-between"
                      >
                        {item.term}
                      </dt>
                      <dd
                        class="text-sm text-slate-600 leading-relaxed text-[13px]"
                      >
                        {item.definition}
                      </dd>
                    </div>
                  {/each}
                </div>
              </section>
            {/if}
          {:else}
            <!-- Legacy String Rendering -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <article
              bind:this={resultTextContainer}
              onclick={handleTimestampClick}
              class="prose prose-slate max-w-none prose-headings:font-bold prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600 prose-a:text-indigo-600 prose-strong:text-indigo-700 prose-strong:font-bold prose-code:text-pink-600 prose-code:bg-pink-50 prose-code:px-1 prose-code:rounded prose-pre:bg-slate-900 prose-pre:rounded-2xl prose-img:rounded-2xl prose-hr:border-slate-100 marker:text-indigo-400"
            >
              {@html (
                marked.parse(currentAnalysis as string) as string
              ).replace(
                /\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g,
                '<button class="timestamp-link inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded-md text-xs font-bold hover:bg-indigo-100 hover:text-indigo-800 transition-colors cursor-pointer select-none" data-timestamp="$1">▶ $1</button>',
              )}
            </article>
          {/if}

          <div class="mt-12 pt-8 border-t border-slate-100">
            <p
              class="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 text-center"
            >
              他の形式も作成する
            </p>
            <div class="flex flex-wrap justify-center gap-4">
              <button
                onclick={() => handleDerivativeGenerate("note")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {$analysisMode === 'note'
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                  : lectureAnalyses['note']
                    ? 'bg-white border border-indigo-200 text-indigo-600'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}"
              >
                {lectureAnalyses["note"] ? "✅ " : ""}ノート形式
              </button>
              <button
                onclick={() => handleDerivativeGenerate("thoughts")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {$analysisMode === 'thoughts'
                  ? 'bg-amber-500 text-white shadow-lg shadow-amber-100'
                  : lectureAnalyses['thoughts']
                    ? 'bg-white border border-amber-200 text-amber-600'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'}"
              >
                {lectureAnalyses["thoughts"] ? "✅ " : ""}感想文形式
              </button>
              <button
                onclick={() => handleDerivativeGenerate("report")}
                class="px-6 py-3 rounded-2xl font-bold transition-all flex items-center gap-2
                {$analysisMode === 'report'
                  ? 'bg-slate-800 text-white shadow-lg shadow-slate-200'
                  : lectureAnalyses['report']
                    ? 'bg-white border border-slate-400 text-slate-800'
                    : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-800 hover:text-slate-800'}"
              >
                {lectureAnalyses["report"] ? "✅ " : ""}レポート形式
              </button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}

  {#if user}
    <UpgradeModal
      isOpen={showUpgradeModal}
      onClose={() => (showUpgradeModal = false)}
      title={upgradeModalTitle}
      message={upgradeModalMessage}
    />
    <EnrollModal
      isOpen={$isEnrollModalOpen}
      onClose={() => ($isEnrollModalOpen = false)}
    />
  {/if}

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
            onclick={() => {
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

          {@render ResultDisplay()}
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
                onclick={() => {
                  finalExamView = false;
                }}
                class="px-6 py-3 font-bold transition-all relative {!finalExamView
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-slate-400 hover:text-slate-600'}"
              >
                📚 講義一覧
              </button>
              <button
                onclick={() => {
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
                        onclick={generateFinalSummary}
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
                      onclick={copyToClipboard}
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
                  {@render LectureItem(lecture)}
                {/each}
                {#if $lectures.filter((l) => l.subjectId === selectedSubjectId).length === 0}
                  <div
                    ondragover={handleMainTargetDragOver}
                    ondragleave={handleMainTargetDragLeave}
                    ondrop={handleMainTargetDrop}
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
                    onclick={() => (isEditing = true)}
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
                onclick={(e) => {
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
                  onclick={() => (isCourseDropdownOpen = false)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
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
                          onclick={() => {
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
                          onclick={() => {
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
                      onclick={() => setAnalysisMode("note")}
                      class="flex-1 py-3 rounded-xl text-sm font-bold transition-all {$analysisMode ===
                      'note'
                        ? 'bg-white text-indigo-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}">ノート</button
                    >
                    <button
                      onclick={() => setAnalysisMode("thoughts")}
                      class="flex-1 py-3 rounded-xl text-sm font-bold transition-all {$analysisMode ===
                      'thoughts'
                        ? 'bg-white text-amber-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-700'}">感想</button
                    >
                    <button
                      onclick={() => setAnalysisMode("report")}
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
                        oninput={handleLengthChange}
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
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {@render FileInputCard(
                      "pdf",
                      "PDF",
                      "text-red-400",
                      $pdfFile,
                      ".pdf",
                      "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", // FileText
                    )}
                    {@render FileInputCard(
                      "image",
                      "IMAGE",
                      "text-blue-400",
                      $imageFile,
                      "image/*",
                      "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", // Image
                    )}
                    {@render FileInputCard(
                      "txt",
                      "TEXT",
                      "text-emerald-400",
                      $txtFile,
                      ".txt",
                      "M4 6h16M4 12h16M4 18h7", // Menu/Text
                    )}
                  </div>
                </div>

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
                    {@render FileInputCard(
                      "video",
                      "VIDEO",
                      "text-purple-400",
                      $videoFile,
                      "video/*",
                      "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z", // PlayCircle
                    )}
                    {@render FileInputCard(
                      "audio",
                      "AUDIO",
                      "text-pink-400",
                      $audioFile,
                      "audio/*",
                      "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z", // Mic
                    )}
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
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    /></svg
                  >
                  文字起こし (リアルタイム編集)
                </h3>
                <textarea
                  value={$transcript + $interimTranscript}
                  oninput={(e) => transcript.set(e.currentTarget.value)}
                  use:actionTextAreaAutoscroll
                  class="w-full h-48 p-4 bg-gray-50 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 outline-none resize-none text-sm text-slate-700 leading-relaxed custom-scrollbar"
                  placeholder="ここに文字起こしが表示されます... (手動で修正可能)"
                ></textarea>
              </div>

              <!-- Action Button -->
              <div
                class="mt-8 flex flex-col md:flex-row justify-end items-center gap-6"
              >
                <!-- Share Toggle -->
                <label class="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    bind:checked={$isShared}
                    class="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-colors"
                  />
                  <span
                    class="text-xs font-bold text-slate-400 group-hover:text-slate-600 transition-colors"
                    >データの共有・改善への協力を許可する</span
                  >

                  {#if analyzing}
                    <!-- Progress Bar -->
                    <div class="w-full max-w-md ml-auto">
                      <div
                        class="flex justify-between text-xs font-bold text-slate-500 mb-2"
                      >
                        <span>{progressStatus}</span>
                        <span>{progressValue}%</span>
                      </div>
                      <div
                        class="h-2 w-full bg-slate-100 rounded-full overflow-hidden"
                      >
                        <div
                          class="h-full bg-indigo-600 transition-all duration-300"
                          style="width: {progressValue}%"
                        ></div>
                      </div>
                      <button
                        onclick={handleCancelAnalysis}
                        class="mt-2 text-xs text-slate-400 hover:text-red-500 underline"
                        >キャンセル</button
                      >
                    </div>
                  {:else}
                    <button
                      onclick={handleAnalyze}
                      disabled={!$courseId &&
                        !$isRecording &&
                        !$pdfFile &&
                        !$imageFile &&
                        !$txtFile &&
                        !$videoFile &&
                        !$targetUrl &&
                        !$transcript}
                      class="bg-slate-900 text-white px-10 py-4 rounded-2xl font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 hover:translate-y-[-2px] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3"
                    >
                      <span class="text-lg">解析を開始</span>
                      <svg
                        class="w-5 h-5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        ><path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M14 5l7 7m0 0l-7 7m7-7H3"
                        /></svg
                      >
                    </button>
                  {/if}
                </label>
              </div>

              <!-- Floating Mic Button (Bottom Right) -->
              <button
                onclick={toggleRecording}
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
            {@render LectureItem(lecture)}
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
        onclick={toggleRecording}
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

  <!-- Global Styles for Waveform Animations -->
  <style>
    @keyframes waveform-1 {
      0%,
      100% {
        height: 10px;
      }
      50% {
        height: 20px;
      }
    }
    @keyframes waveform-2 {
      0%,
      100% {
        height: 15px;
      }
      50% {
        height: 35px;
      }
    }
    @keyframes waveform-3 {
      0%,
      100% {
        height: 12px;
      }
      50% {
        height: 25px;
      }
    }
    .animate-waveform-1 {
      animation: waveform-1 1s infinite ease-in-out;
    }
    .animate-waveform-2 {
      animation: waveform-2 1.2s infinite ease-in-out;
    }
    .animate-waveform-3 {
      animation: waveform-3 0.8s infinite ease-in-out;
    }

    /* Graph Paper Background */
    .bg-graph-paper {
      background-color: #ffffff;
      background-image: linear-gradient(#e5e7eb 1px, transparent 1px),
        linear-gradient(90deg, #e5e7eb 1px, transparent 1px);
      background-size: 20px 20px;
      background-position: center top;
    }

    /* Gentle Pulse Animation for Loading Icon */
    @keyframes gentlePulse {
      0%,
      100% {
        transform: scale(1);
        opacity: 1;
      }
      50% {
        transform: scale(1.05);
        opacity: 0.95;
      }
    }

    /* Glow Pulse Animation */
    @keyframes glowPulse {
      0%,
      100% {
        opacity: 0.3;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.1);
      }
    }
  </style>
</div>
