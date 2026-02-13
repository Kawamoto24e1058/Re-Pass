<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { storage, auth, db } from "$lib/firebase";
  import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
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
    deleteDoc,
    serverTimestamp,
  } from "firebase/firestore";
  import { goto } from "$app/navigation";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import { signOut } from "firebase/auth";
  import { subjects, lectures, currentBinder } from "$lib/stores";
  import {
    isRecording,
    transcript,
    finalTranscript,
    interimTranscript,
    resetTranscript,
  } from "$lib/stores/recordingStore";
  import { recognitionService } from "$lib/services/recognitionService";
  import { page } from "$app/stores";

  // --- State Variables (Runes) ---
  let pdfFile = $state<File | null>(null);
  let txtFile = $state<File | null>(null);
  let audioFile = $state<File | null>(null); // New: Audio File
  let imageFile = $state<File | null>(null);
  let videoFile = $state<File | null>(null);
  let targetUrl = $state("");
  let analyzing = $state(false);
  let result = $state("");
  let categoryTag = $state(""); // AI generated category
  let analyzedTitle = $state(""); // AI generated title
  let analyzedCategory = $state(""); // AI generated category raw
  let draggingLectureId = $state<string | null>(null);
  let showUpgradeModal = $state(false);
  let isDragOverMainTarget = $state(false);

  // Advanced Organization State
  let selectedLectureIds = $state(new Set<string>());
  let movingLectureId = $state<string | null>(null);
  let analysisProposal = $state<{
    lectureId: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);

  // View Mode State
  let isEditing = $state(true);

  // User & Data State
  let user = $state<any>(null);
  let userData = $state<any>(null);
  // subjects managed via store
  let currentLectureId = $state<string | null>(null);
  // selectedSubjectId is now derived from store or synced
  let selectedSubjectId = $state<string | null>(null);

  // Sync state with store
  $effect(() => {
    selectedSubjectId = $currentBinder;
  });
  let lectureTitle = $state("");
  let unsubscribeUser: () => void;
  // unsubscribeLectures removed as it is now managed via list

  // UI State
  let toastMessage = $state<string | null>(null);
  let resultContainer = $state<HTMLElement | null>(null); // For auto-scroll
  let resultTextContainer = $state<HTMLElement | null>(null); // For individual copy
  let finalResultContainer = $state<HTMLElement | null>(null); // For final copy
  let isMobileOpen = $state(false);

  // Speech Recognition State - Moved to global recordingStore
  // let isRecording = $state(false);
  // let transcript = $state("");
  // let finalTranscript = $state("");
  // let recognition: any;

  // Analysis Settings
  let analysisMode = $state<"note" | "thoughts" | "report">("note");
  let targetLength = $state(1000);

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

  // Copy result to clipboard
  function copyToClipboard() {
    if (!finalResultContainer) return;

    // Use innerText to get the rendered, clean text (strips Markdown symbols)
    const rawText = finalResultContainer.innerText;

    // Basic cleaning: remove excessive vertical spacing and trim each line
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

  // Copy individual lecture note to clipboard
  function copyResultToClipboard() {
    if (!resultTextContainer) return;

    // Use innerText to get the rendered, clean text
    const rawText = resultTextContainer.innerText;

    const cleanText = rawText
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    navigator.clipboard.writeText(cleanText).then(() => {
      isResultCopied = true;
      setTimeout(() => (isResultCopied = false), 2000);
    });
  }

  // --- Derived State for UI ---
  let manuscriptPages = $derived(Math.ceil(targetLength / 400));
  let thumbPosition = $derived((targetLength / 4000) * 100);

  let dailyRemaining = $derived.by(() => {
    if (
      userData?.plan === "premium" ||
      userData?.plan === "season" ||
      userData?.isPro === true
    ) {
      return Infinity;
    }
    const today = new Date().toISOString().split("T")[0];
    const dailyUsage = userData?.dailyUsage || {
      count: 0,
      lastResetDate: today,
    };
    if (dailyUsage.lastResetDate !== today) return 3;
    return Math.max(0, 3 - dailyUsage.count);
  });

  let selectedSummary = $derived.by(() => {
    const parts = [];
    if (pdfFile) parts.push("PDF");
    if (txtFile) parts.push("TXT");
    if (audioFile) parts.push("Audio");
    if (imageFile) parts.push("Image");
    if (videoFile) parts.push("Video");
    if (targetUrl) parts.push("URL");
    const transcriptLen = $transcript.length;
    if (transcriptLen > 0 && !$isRecording) parts.push("Transcript");

    if (parts.length === 0) return null;
    return parts.join(" + ");
  });

  let headerTitle = $derived(
    analysisMode === "note"
      ? "講義ノート (復習用)"
      : analysisMode === "thoughts"
        ? "感想・リアクション (提出用)"
        : "学術レポート (課題用)",
  );

  let containerBgColor = $derived(
    analysisMode === "note"
      ? "bg-white/60"
      : analysisMode === "thoughts"
        ? "bg-amber-50/60"
        : "bg-slate-50/60",
  );

  // --- Lifecycle & Auth ---
  onMount(() => {
    const authUnsub = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        user = currentUser;

        unsubscribeUser = onSnapshot(doc(db, "users", user.uid), (docSnap) => {
          if (docSnap.exists()) {
            userData = docSnap.data();
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
        "✨ プレミアムプランへようこそ！全ての講義を資産に変えましょう。";
      setTimeout(() => (toastMessage = null), 6000);

      // Clean up the URL parameter
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete("session_id");
      window.history.replaceState({}, "", newUrl);
    }

    // ... (rest of onMount)

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

  // --- Functions ---

  function startProgress() {
    progressValue = 0;
    progressStatus = "音声データを解析中...";

    // Simulate realistic progress steps
    progressInterval = setInterval(() => {
      if (progressValue < 30) {
        progressValue += Math.random() * 2;
        progressStatus = "音声データを解析中...";
      } else if (progressValue < 60) {
        progressValue += Math.random() * 1.5;
        progressStatus = "講義の構造を分析中...";
      } else if (progressValue < 85) {
        progressValue += Math.random() * 0.5;
        progressStatus =
          analysisMode === "thoughts"
            ? "想いを言語化中..."
            : analysisMode === "report"
              ? "論理構成を構築中..."
              : "ノートをまとめています...";
      } else if (progressValue < 95) {
        progressValue += 0.1;
        progressStatus = "仕上げ中...";
      }
    }, 200);
  }

  async function stopProgress() {
    clearInterval(progressInterval);
    // Smoothly animate to 100%
    const remaining = 100 - progressValue;
    const steps = 10;
    const stepSize = remaining / steps;

    for (let i = 0; i < steps; i++) {
      progressValue += stepSize;
      await new Promise((r) => setTimeout(r, 20)); // Fast animation
    }
    progressValue = 100;
    progressStatus = "完了";
    await new Promise((r) => setTimeout(r, 500)); // Show 100% momentarily
  }

  function setAnalysisMode(newMode: "note" | "thoughts" | "report") {
    const isPremium =
      userData?.plan === "premium" || userData?.plan === "season";
    if ((newMode === "thoughts" || newMode === "report") && !isPremium) {
      showUpgradeModal = true;
      return;
    }
    analysisMode = newMode;
  }

  function handleLengthChange(e: Event) {
    let val = parseInt((e.target as HTMLInputElement).value);
    if (val < 100) val = 100; // Snap to 100 min

    const isPremium =
      userData?.plan === "premium" || userData?.plan === "season";

    if (!isPremium && val > 500) {
      showUpgradeModal = true;
      toastMessage = "フリープランは500文字までです";
      setTimeout(() => (toastMessage = null), 3000);
      targetLength = 500; // Force back
      return;
    }
    targetLength = val;
  }

  function toggleRecording() {
    recognitionService.toggle();
  }

  function handleFileChange(
    event: Event,
    type: "pdf" | "txt" | "audio" | "image" | "video",
  ) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      if (type === "pdf") pdfFile = input.files[0];
      else if (type === "txt") txtFile = input.files[0];
      else if (type === "audio") audioFile = input.files[0];
      else if (type === "image") imageFile = input.files[0];
      else if (type === "video") videoFile = input.files[0];
    }
  }

  async function handleAnalyze() {
    if (
      !pdfFile &&
      !txtFile &&
      !audioFile &&
      !imageFile &&
      !videoFile &&
      !targetUrl &&
      !$transcript
    ) {
      alert("学習素材（ファイル、URL、音声）を入力してください。");
      return;
    }

    // Usage Quota Check
    const isPremium =
      userData?.plan === "premium" || userData?.plan === "season";
    const usageCount = userData?.usageCount || 0;

    if (!isPremium && usageCount >= 5) {
      showUpgradeModal = true;
      toastMessage = "今月の制限に達しました";
      setTimeout(() => (toastMessage = null), 4000);
      return;
    }

    // Feature Gating: Relaxed PDF analysis (2 trials)
    if (pdfFile && !isPremium) {
      const pdfUsage = $lectures.filter((l: any) => l.hasPdf).length;
      if (pdfUsage >= 2) {
        showUpgradeModal = true;
        return;
      }
    }

    analyzing = true;
    startProgress(); // Start visual feedback
    result = "";
    toastMessage = null; // Clear previous toast

    try {
      console.log("Starting analysis...");

      const formData = new FormData();
      if (pdfFile) formData.append("pdf", pdfFile as Blob);
      if (txtFile) formData.append("txt", txtFile as Blob);
      if (audioFile) formData.append("audio", audioFile as Blob);
      if (imageFile) formData.append("image", imageFile as Blob);
      if (videoFile) formData.append("video", videoFile as Blob);
      if (targetUrl) formData.append("url", targetUrl);

      formData.append("transcript", $transcript);
      formData.append("mode", analysisMode); // Send specific mode
      formData.append("plan", userData?.plan || "free");
      formData.append("targetLength", targetLength.toString());

      console.log("Analyzing...");
      const idToken = await user.getIdToken();
      const response = await fetch("/api/analyze", {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      if (response.status === 403) {
        const errorData = await response.json();
        showUpgradeModal = true;
        toastMessage = errorData.error || "本日の上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) {
        throw new Error("Analysis failed");
      }

      const data = await response.json();

      // Handle JSON Response (Title + Category + Summary + Glossary)
      if (data.result && typeof data.result === "object") {
        const { title, category, summary, glossary } = data.result;

        // Auto-Title
        if (title) {
          analyzedTitle = title;
          if (!lectureTitle || lectureTitle.startsWith("講義 20")) {
            lectureTitle = title;
          }
        }

        // Auto-Category / Folder Sorting
        if (category) {
          analyzedCategory = category;
          const matchedSubject = $subjects.find(
            (s: any) =>
              s.name.toLowerCase().includes(analyzedCategory.toLowerCase()) ||
              analyzedCategory.toLowerCase().includes(s.name.toLowerCase()),
          );

          if (matchedSubject) {
            // PROPOSAL: Don't move yet, just suggest
            categoryTag = category; // Keep tag as visual hint
            // Store proposal to be displayed
            // Note: docSnap.id is only available after save, but we can set it here if we await save first
          } else {
            categoryTag = category;
            currentBinder.set(null); // Keep in Inbox but keep tag
          }
        }

        let finalMarkdown = summary || "";

        if (glossary && Array.isArray(glossary) && glossary.length > 0) {
          finalMarkdown +=
            `\n\n<div class="card-glossary mt-8">\n<h3 class="text-lg font-bold mb-4">【用語辞典】</h3>\n<dl class="space-y-4">\n` +
            glossary
              .map(
                (item: any) =>
                  `<div class="border-l-4 border-indigo-200 pl-4 py-1">
                      <dt class="font-bold text-indigo-900">${item.term}</dt>
                      <dd class="text-sm text-slate-600 mt-1">${item.definition}</dd>
                    </div>`,
              )
              .join("\n") +
            `\n</dl>\n</div>`;
        }
        result = finalMarkdown;
      } else {
        // Fallback handling
        result = data.text || data.result;
      }

      // Legacy extraction fallback (if not in JSON)
      if (!lectureTitle || lectureTitle.startsWith("講義 20")) {
        const firstLine = result.split("\n")[0].trim();
        if (firstLine.startsWith("# ")) {
          const extractedTitle = firstLine
            .replace(/^#\s*/, "")
            .replace(/^【|】$/g, "")
            .trim();
          lectureTitle = extractedTitle;
        }
      }

      const savedLectureId = await saveLecture();

      // Set proposal after save so we have the ID
      if (analyzedCategory) {
        const matchedSubject = $subjects.find(
          (s: any) =>
            s.name.toLowerCase().includes(analyzedCategory.toLowerCase()) ||
            analyzedCategory
              .toLowerCase()
              .includes(analyzedCategory.toLowerCase()),
        );
        if (matchedSubject && savedLectureId) {
          analysisProposal = {
            lectureId: savedLectureId as string,
            subjectId: matchedSubject.id,
            subjectName: matchedSubject.name,
          };
        }
      }

      // Toast & Auto-scroll
      toastMessage = "解析が完了しました";
      setTimeout(() => {
        toastMessage = null;
      }, 3000);

      await tick();
      if (resultContainer) {
        (resultContainer as HTMLElement).scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }

      // Increment Usage Count (Free tier)
      if (!isPremium && user) {
        const userRef = doc(db, "users", user.uid);
        await setDoc(userRef, { usageCount: usageCount + 1 }, { merge: true });
      }
    } catch (e) {
      console.error(e);
      alert("解析エラーが発生しました: " + (e as Error).message);
    } finally {
      await stopProgress();
      analyzing = false;
    }
  }

  function toggleLectureSelection(lectureId: string) {
    if (selectedLectureIds.has(lectureId)) {
      selectedLectureIds.delete(lectureId);
    } else {
      selectedLectureIds.add(lectureId);
    }
    // Svelte 5 Set reactivity: re-assign to trigger updates if needed,
    // but Set is not reactive in Svelte 5 by default unless using a proxy or re-assignment.
    // Let's use re-assignment for now.
    selectedLectureIds = new Set(selectedLectureIds);
  }

  async function bulkMoveLectures(targetSubjectId: string | null) {
    const ids = Array.from(selectedLectureIds);
    if (ids.length === 0) return;

    const count = ids.length;
    toastMessage = `${count}件を移動中...`;

    try {
      await Promise.all(ids.map((id) => moveLecture(id, targetSubjectId)));
      selectedLectureIds = new Set();
      toastMessage = `${count}件を移動しました`;
      setTimeout(() => (toastMessage = null), 2000);
    } catch (e) {
      console.error("Bulk move error", e);
      alert("一括移動中にエラーが発生しました");
    }
  }

  async function saveLecture() {
    if (!user) return null;

    const lectureData = {
      title: lectureTitle || `講義 ${new Date().toLocaleString()}`,
      content: $transcript,
      analysis: result,
      analysisMode: analysisMode,
      targetLength: targetLength,
      categoryTag: categoryTag || null,
      updatedAt: serverTimestamp(),
      subjectId: $currentBinder || null, // Ensure subjectId is saved
    };

    try {
      if (currentLectureId) {
        // Find the existing lecture to get its path
        const existingLecture = $lectures.find(
          (l) => l.id === currentLectureId,
        );

        let docRef;
        if (existingLecture && existingLecture.path) {
          docRef = doc(db, existingLecture.path);
        } else {
          // Fallback to root (shouldn't happen with new logic, but for safety)
          console.warn(
            "Could not find path for existing lecture, defaulting to root",
          );
          docRef = doc(db, `users/${user.uid}/lectures`, currentLectureId);
        }

        await setDoc(docRef, lectureData, { merge: true });
      } else {
        // New Lecture
        const collectionPath = $currentBinder
          ? `users/${user.uid}/subjects/${$currentBinder}/lectures`
          : `users/${user.uid}/lectures`;

        const docRef = await addDoc(collection(db, collectionPath), {
          ...lectureData,
          createdAt: serverTimestamp(),
        });
        currentLectureId = docRef.id;
        return docRef.id;
      }
      return currentLectureId;
    } catch (e) {
      console.error("Error saving lecture:", e);
      alert("保存に失敗しました。");
      return null;
    }
  }

  async function handleGenerateSeriesSummary() {
    const isPremium = userData?.plan === "premium";
    if (!isPremium) {
      showUpgradeModal = true;
      return;
    }

    if (!selectedSubjectId) return;

    const subjectLectures = $lectures.filter(
      (l) => l.subjectId === selectedSubjectId,
    );
    if (subjectLectures.length === 0) {
      alert("No lectures in this subject to analyze.");
      return;
    }

    analyzingSeries = true;
    seriesSummary = null;

    try {
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      const response = await fetch("/api/analyze-series", {
        method: "POST",
        body: JSON.stringify({
          uid: user.uid,
          subjectId: selectedSubjectId,
          subjectName: subject?.name || "Unknown Subject",
          customInstructions: customAnalysisInstructions, // Pass custom instructions
          lectures: subjectLectures.map((l) => ({
            id: l.id,
            title: l.title,
            date: l.createdAt
              ? new Date(l.createdAt.toDate()).toLocaleDateString()
              : "Unknown Date",
            content: l.content,
          })),
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
      });

      if (response.status === 403) {
        showUpgradeModal = true;
        toastMessage = "本日の解析上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) throw new Error("Failed to generate summary");

      const data = await response.json();
      seriesSummary = data;
    } catch (e) {
      console.error(e);
      alert("Failed to generate series summary.");
    } finally {
      analyzingSeries = false;
    }
  }

  async function generateFinalSummary() {
    if (!selectedSubjectId || analyzingFinal) return;

    try {
      analyzingFinal = true;
      const subject = $subjects.find((s) => s.id === selectedSubjectId);
      const subjectLectures = $lectures.filter(
        (l) => l.subjectId === selectedSubjectId && l.analysis,
      );

      if (subjectLectures.length === 0) {
        alert("要約済みの講義がありません。まずは各講義を解析してください。");
        return;
      }

      const response = await fetch("/api/analyze-final", {
        method: "POST",
        body: JSON.stringify({
          subjectName: subject?.name || "Unknown Subject",
          customInstructions: customAnalysisInstructions,
          analyses: subjectLectures.map((l) => ({
            title: l.title,
            analysis: l.analysis,
          })),
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user.getIdToken()}`,
        },
      });

      if (response.status === 403) {
        showUpgradeModal = true;
        toastMessage = "本日の解析上限に達しました";
        setTimeout(() => (toastMessage = null), 5000);
        return;
      }

      if (!response.ok) throw new Error("まとめの生成に失敗しました");
      const data = await response.json();

      // Store result and switch to final exam view
      finalExamResult = data.result;
      finalExamView = true;
    } catch (e: any) {
      console.error(e);
      alert(e.message);
    } finally {
      analyzingFinal = false;
    }
  }

  async function loadLecture(lecture: any) {
    if ($isRecording) recognitionService.stop();

    currentLectureId = lecture.id;
    // Don't auto-deselect subject, keep context
    lectureTitle = lecture.title;
    // Update global transcript store when loading a lecture
    resetTranscript();
    finalTranscript.set(lecture.content || "");

    // Restore settings with defaults
    const modeMap: Record<string, "note" | "thoughts" | "report"> = {
      summary: "note",
      analysis: "report",
      note: "note",
      thoughts: "thoughts",
      report: "report",
    };
    analysisMode = modeMap[lecture.analysisMode] || "note";
    targetLength = lecture.targetLength || 1000;

    result = lecture.analysis || "";
    isEditing = false; // Switch to View Mode

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
    lectureTitle = "";
    resetTranscript();
    result = "";
    pdfFile = null;
    txtFile = null;
    audioFile = null;
    imageFile = null;
    videoFile = null;
    targetUrl = "";
    localStorage.removeItem("transcript");
  }

  function startNewLecture() {
    if ($isRecording) recognitionService.stop();

    currentLectureId = null;
    currentBinder.set(null); // Clear subject selection
    lectureTitle = "";
    resetTranscript();
    result = "";
    pdfFile = null;
    txtFile = null;
    audioFile = null;
    imageFile = null;
    videoFile = null;
    targetUrl = "";
    analysisMode = "note";
    targetLength = 1000;

    isEditing = true; // Switch to Edit Mode

    const pdfInput = document.getElementById("pdf-upload") as HTMLInputElement;
    if (pdfInput) pdfInput.value = "";
    const txtInput = document.getElementById("txt-upload") as HTMLInputElement;
    if (txtInput) txtInput.value = "";

    localStorage.removeItem("transcript");
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

  let parsedHtml = $derived(result ? marked.parse(result) : "");

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

  {#snippet ResultDisplay()}
    {#if result}
      <div
        bind:this={resultContainer}
        class="relative bg-white rounded-3xl shadow-sm border border-slate-100 p-10 md:p-14 animate-in fade-in slide-in-from-bottom-8 duration-700 overflow-hidden {analysisMode ===
        'note'
          ? 'bg-graph-paper'
          : ''}"
      >
        <div class="absolute top-8 right-8 flex items-center gap-4 z-20">
          {#if result}
            <button
              onclick={copyResultToClipboard}
              class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200 text-slate-500 hover:bg-white hover:border-indigo-300 hover:text-indigo-600 transition-all shadow-sm active:scale-95"
            >
              {#if isResultCopied}
                <span class="text-[10px] font-bold text-emerald-600"
                  >✅ コピー完了</span
                >
              {:else}
                <span class="text-xs">📋</span>
                <span class="text-[10px] font-bold uppercase tracking-wider"
                  >コピー</span
                >
              {/if}
            </button>
          {/if}
          <span
            class="text-[10px] font-bold text-slate-300 uppercase tracking-widest"
            >{analysisMode}</span
          >
        </div>

        <article
          bind:this={resultTextContainer}
          class="relative z-10 prose prose-slate prose-lg max-w-none
          prose-headings:font-bold prose-headings:tracking-tight
          prose-h1:text-3xl prose-h1:mb-6 prose-h1:bg-gradient-to-r prose-h1:from-indigo-700 prose-h1:to-pink-600 prose-h1:bg-clip-text prose-h1:text-transparent
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-l-4 prose-h2:border-indigo-600 prose-h2:pl-4 prose-h2:text-slate-800
          prose-p:text-slate-600 prose-p:leading-loose
          prose-li:text-slate-600 prose-strong:text-slate-900 prose-strong:font-bold
          prose-table:border-collapse prose-th:text-slate-900 prose-td:text-slate-600
          prose-blockquote:border-l-pink-400 prose-blockquote:bg-pink-50/50 md:prose-blockquote:py-1
       "
        >
          {@html parsedHtml}
        </article>
      </div>
    {/if}
  {/snippet}

  <!-- Mobile Header -->
  <header
    class="lg:hidden fixed top-0 left-0 right-0 h-16 bg-white/70 backdrop-blur-md border-b border-slate-200/50 z-40 flex items-center justify-between px-4"
  >
    <button
      onclick={() => (isMobileOpen = true)}
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
      class="font-bold text-xl bg-gradient-to-r from-indigo-700 to-pink-600 bg-clip-text text-transparent"
      >Re-Pass</a
    >

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
          {userData?.nickname?.substring(0, 1).toUpperCase() || "U"}
        {/if}
      </div>
    </a>
  </header>

  <!-- Sidebar Component & Overlay -->
  {#if isMobileOpen}
    <div
      class="lg:hidden fixed inset-0 bg-black/20 backdrop-blur-sm z-[90] animate-in fade-in duration-300"
      onclick={() => (isMobileOpen = false)}
      onkeydown={(e) => e.key === "Escape" && (isMobileOpen = false)}
      role="button"
      tabindex="0"
    ></div>
  {/if}

  {#if user}
    <Sidebar
      {user}
      lectures={$lectures}
      subjects={$subjects}
      {currentLectureId}
      {selectedSubjectId}
      {isMobileOpen}
      onClose={() => (isMobileOpen = false)}
      onLoadLecture={(lecture) => {
        loadLecture(lecture);
        isMobileOpen = false;
      }}
      onSelectSubject={(id) => {
        handleSelectSubject(id);
        isMobileOpen = false;
      }}
      onSignOut={() => signOut(auth)}
      onDragStart={(id: string) => (draggingLectureId = id)}
      onDragEnd={handleDragEnd}
      {draggingLectureId}
    />
  {/if}

  <!-- Main Content -->
  <div
    class="flex-1 relative overflow-y-auto h-full bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:20px_20px] pt-16 lg:pt-0"
  >
    <main
      class="max-w-5xl mx-auto py-8 lg:py-12 px-4 lg:px-16 pb-32 animate-in fade-in duration-700 slide-in-from-bottom-4"
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
      {:else if !selectedSubjectId && !isEditing}
        <!-- Unassigned Dashboard (Inbox) -->
        <div class="mb-10">
          <div class="flex items-center justify-between mb-8">
            <div>
              <h1 class="text-4xl font-bold text-slate-900 tracking-tight">
                未分類の履歴
              </h1>
              <p class="text-slate-500 mt-2">
                {$lectures.filter((l) => !l.subjectId).length} 件の講義が整理を待っています
              </p>
            </div>
            <button
              onclick={() => startNewLecture()}
              class="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center gap-2"
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
              新しい講義を記録
            </button>
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
        </div>
      {:else}
        <!-- Input Form Mode (isEditing is true) -->
        <!-- ... (Keep existing Top Section & Inputs) ... -->
        <div class="mb-10 space-y-8">
          <div>
            <input
              type="text"
              bind:value={lectureTitle}
              placeholder="講義タイトル"
              class="bg-transparent border-none w-full text-4xl font-bold text-slate-900 placeholder-slate-300 focus:outline-none focus:ring-0 p-0 tracking-tight"
            />
            <!-- Momoyama Gradient Accent -->
            <div
              class="h-1.5 w-24 bg-gradient-to-r from-indigo-600 to-pink-400 mt-4 rounded-full opacity-90"
            ></div>
          </div>

          <!-- Waveform Animation (Visible only when Recording) -->
          {#if $isRecording}
            <div
              class="flex items-center justify-center gap-1.5 h-12 mb-4 animate-in fade-in duration-500"
            >
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-1 h-3"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-2 h-6"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-3 h-4"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-2 h-8"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-1 h-5"
              ></div>
              <div
                class="w-1.5 bg-red-500 rounded-full animate-waveform-3 h-3"
              ></div>
            </div>
            <p
              class="text-center text-red-500 font-bold text-[10px] tracking-widest uppercase animate-pulse mb-6"
            >
              Recording...
            </p>
          {/if}

          <!-- Controls Container -->
          {#if isEditing}
            <div
              class="{containerBgColor} backdrop-blur-sm rounded-2xl border border-white/50 p-6 transition-colors duration-500"
            >
              <!-- Settings Row -->
              <div class="flex flex-col md:flex-row gap-6 mb-6">
                <!-- 1. Segmented Control (Mode) -->
                <div class="flex-1">
                  <span
                    class="role-label text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block"
                    >生成モード</span
                  >
                  <div class="bg-indigo-50/50 p-1 rounded-xl flex shadow-inner">
                    <button
                      onclick={() => setAnalysisMode("note")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all {analysisMode ===
                      'note'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      ノート
                    </button>
                    <button
                      onclick={() => setAnalysisMode("thoughts")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all relative {analysisMode ===
                      'thoughts'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      感想
                      {#if userData?.plan === "free"}
                        <svg
                          class="w-3 h-3 text-amber-500 inline-block ml-1 mb-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      {/if}
                    </button>
                    <button
                      onclick={() => setAnalysisMode("report")}
                      class="flex-1 py-2 rounded-lg text-sm font-bold transition-all relative {analysisMode ===
                      'report'
                        ? 'bg-white text-indigo-900 shadow-sm'
                        : 'text-slate-500 hover:text-indigo-600'}"
                    >
                      レポート
                      {#if userData?.plan === "free"}
                        <svg
                          class="w-3 h-3 text-amber-500 inline-block ml-1 mb-0.5"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                      {/if}
                    </button>
                  </div>
                  {#if analysisMode === "report"}
                    <p
                      class="text-[10px] text-slate-400 mt-1 ml-1 animate-in fade-in"
                    >
                      ※「だ・である」調で論理的に記述します
                    </p>
                  {/if}
                </div>

                <!-- 2. Character Length Slider -->
                <div class="flex-1">
                  <div class="flex justify-between items-center mb-2">
                    <label
                      for="target-length-slider"
                      class="text-xs font-bold text-slate-500 uppercase tracking-wide"
                      >目標文字数</label
                    >
                    <div class="flex items-center gap-2">
                      <span
                        class="text-[10px] font-bold text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full"
                        >原稿用紙 {manuscriptPages}枚分</span
                      >
                    </div>
                  </div>

                  <div class="relative pt-6 pb-2">
                    <!-- Tooltip -->
                    <div
                      class="absolute top-0 -translate-x-1/2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg pointer-events-none transition-all duration-75"
                      style="left: {thumbPosition}%"
                    >
                      {targetLength}文字
                      <div
                        class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-indigo-600"
                      ></div>
                    </div>

                    <input
                      id="target-length-slider"
                      type="range"
                      min="0"
                      max="4000"
                      step="100"
                      bind:value={targetLength}
                      oninput={handleLengthChange}
                      class="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                    />

                    <!-- Fixed Labels Alignment -->
                    <div class="relative w-full h-4 mt-1">
                      <span
                        class="absolute -translate-x-1/2 text-[10px] text-slate-400"
                        style="left: 2.5%">100</span
                      >
                      <span
                        class="absolute -translate-x-1/2 text-[10px] text-slate-400 whitespace-nowrap"
                        style="left: 12.5%"
                      >
                        500
                        {#if userData?.plan === "free"}
                          <svg
                            class="w-2.5 h-2.5 text-amber-500 inline-block ml-1 mb-0.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </span>
                      <span
                        class="absolute -translate-x-1/2 text-[10px] font-bold text-indigo-500 whitespace-nowrap"
                        style="left: 50%"
                      >
                        2000
                        {#if userData?.plan === "free"}
                          <svg
                            class="w-2.5 h-2.5 text-amber-500 inline-block ml-0.5 mb-0.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        {/if}
                      </span>
                      <span class="absolute right-0 text-[10px] text-slate-400"
                        >4000</span
                      >
                    </div>
                  </div>
                </div>
              </div>

              {#if !analyzing}
                <div class="space-y-8 mt-6 px-4">
                  <!-- 1. Learning Materials (PDF / Image / Text) -->
                  <div>
                    <h3
                      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2"
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
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <!-- PDF -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{pdfFile
                            ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                            : 'border-slate-200 hover:border-indigo-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              PDF
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {pdfFile ? pdfFile.name : "スライド・資料"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept=".pdf"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "pdf")}
                          />
                        </div>
                      </label>

                      <!-- Image -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{imageFile
                            ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200'
                            : 'border-slate-200 hover:border-emerald-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              Image
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {imageFile ? imageFile.name : "板書・写真"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "image")}
                          />
                        </div>
                      </label>

                      <!-- Text -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{txtFile
                            ? 'border-slate-500 bg-slate-50 ring-2 ring-slate-200'
                            : 'border-slate-200 hover:border-slate-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              Text
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {txtFile ? txtFile.name : "メモ・レジュメ"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept=".txt"
                            class="hidden"
                            onchange={(e) => handleFileChange(e, "txt")}
                          />
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- 2. Multimedia & Links (Audio / Video / URL) -->
                  <div>
                    <h3
                      class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2"
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
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <!-- Video/Audio Input -->
                      <label class="cursor-pointer group block">
                        <div
                          class="{videoFile || audioFile
                            ? 'border-pink-500 bg-pink-50 ring-2 ring-pink-200'
                            : 'border-slate-200 hover:border-pink-300'} flex items-center gap-3 p-3 rounded-xl bg-white border shadow-sm transition-all relative overflow-hidden h-full"
                        >
                          <div
                            class="w-8 h-8 rounded-full bg-pink-100 text-pink-600 flex items-center justify-center relative z-10 flex-shrink-0"
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
                                d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                              /><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              /></svg
                            >
                          </div>
                          <div class="relative z-10 flex-1 min-w-0">
                            <div
                              class="text-[10px] font-bold text-slate-400 uppercase"
                            >
                              Video / Audio
                            </div>
                            <div
                              class="text-xs font-bold text-slate-700 truncate"
                            >
                              {videoFile
                                ? videoFile.name
                                : audioFile
                                  ? audioFile.name
                                  : "動画・音声ファイル"}
                            </div>
                          </div>
                          <input
                            type="file"
                            accept="video/*,audio/*"
                            class="hidden"
                            onchange={(e) => {
                              const f = (e.target as HTMLInputElement)
                                .files?.[0];
                              if (f) {
                                if (f.type.startsWith("audio"))
                                  handleFileChange(e, "audio");
                                else handleFileChange(e, "video");
                              }
                            }}
                          />
                        </div>
                      </label>

                      <!-- URL Input -->
                      <div
                        class="flex-1 bg-white border border-slate-200 rounded-xl px-4 flex items-center gap-3 shadow-sm focus-within:ring-2 focus-within:ring-indigo-100 transition-all"
                      >
                        <svg
                          class="w-4 h-4 text-slate-400 flex-shrink-0"
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
                          bind:value={targetUrl}
                          placeholder="URL (YouTube / Web)"
                          class="flex-1 py-3 text-sm font-medium text-slate-700 placeholder-slate-400 bg-transparent border-none focus:ring-0 px-0"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div class="flex justify-end p-4 pt-0">
                  <button
                    onclick={handleAnalyze}
                    class="bg-slate-900 text-white px-8 py-3 rounded-xl text-sm font-bold shadow-lg shadow-slate-900/10 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 active:shadow-sm transition-all flex items-center gap-2"
                  >
                    解析を開始
                    {#if selectedSummary}
                      <span
                        class="ml-2 bg-white/20 px-2 py-0.5 rounded text-xs font-normal opacity-90"
                        >{selectedSummary}</span
                      >
                    {/if}
                    <svg
                      class="w-4 h-4 ml-1"
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
                </div>
              {/if}

              {#if analyzing}
                <div class="p-8 text-center animate-in fade-in">
                  <div class="mb-4">
                    <div
                      class="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden"
                    >
                      <div
                        class="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                        style="width: {progressValue}%"
                      ></div>
                    </div>
                  </div>
                  <p
                    class="text-slate-600 font-bold text-sm tracking-wide animate-pulse"
                  >
                    {progressStatus}
                  </p>
                  <p class="text-xs text-slate-400 mt-2">
                    {Math.floor(progressValue)}% Completed
                  </p>
                </div>
              {/if}
            </div>
          {/if}
        </div>

        <!-- Transcript Preview -->
        {#if $transcript || $isRecording}
          <div class="mb-8 animate-in fade-in slide-in-from-bottom-2">
            <div
              class="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm relative overflow-hidden group"
            >
              <!-- ... -->
              <div class="pl-4">
                <div class="flex items-center justify-between mb-2">
                  <h3 class="text-xs font-bold text-slate-400 uppercase">
                    Live Transcript
                  </h3>
                </div>
                <p
                  class="text-sm text-slate-600 font-mono leading-relaxed line-clamp-3 hover:line-clamp-none transition-all"
                >
                  {$transcript}
                </p>
              </div>
            </div>
          </div>
        {/if}

        <!-- Result Card -->
        {#if !analyzing}
          {@render ResultDisplay()}
        {/if}
      {/if}
    </main>
  </div>

  <!-- FAB: Recording & Analysis Buttons (Bottom Right) -->
  {#if user}
    <div class="fixed bottom-8 right-8 flex flex-col items-end gap-4 z-50">
      <!-- Analysis FAB (Only if inputs exist and not already analyzing) -->
      {#if selectedSummary && !analyzing && isEditing}
        <button
          onclick={handleAnalyze}
          class="flex items-center gap-3 bg-slate-900 text-white pl-6 pr-4 py-4 rounded-full shadow-2xl hover:shadow-indigo-200/50 hover:-translate-y-1 transition-all active:scale-95 group border border-white/10 relative overflow-hidden"
        >
          {#if dailyRemaining !== Infinity}
            <div
              class="absolute top-0 right-0 bg-indigo-500/50 px-2 py-0.5 text-[8px] font-bold rounded-bl-lg"
            >
              残り {dailyRemaining}
            </div>
          {/if}
          <span class="text-sm font-bold tracking-tight">解析して保存</span>
          <div
            class="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center shadow-inner"
          >
            <svg
              class="w-5 h-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="3"
                d="M14 5l7 7m0 0l-7 7m7-7H3"
              />
            </svg>
          </div>
        </button>
      {/if}

      <!-- Recording FAB -->
      <button
        onclick={toggleRecording}
        class="w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all active:scale-95 group border border-white/10
        {$isRecording
          ? 'bg-red-500 text-white ring-4 ring-red-500/20'
          : 'bg-white text-red-500 hover:bg-slate-50'}"
        title={$isRecording ? "Stop Recording" : "Start Recording"}
      >
        {#if $isRecording}
          <div class="w-6 h-6 bg-white rounded-md animate-pulse"></div>
        {:else}
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
            {#if !selectedSummary && !$isRecording}
              <div
                class="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white animate-bounce"
              ></div>
            {/if}
          </div>
        {/if}
      </button>
    </div>
  {/if}

  <!-- Upgrade Modal (Triggered by Limit) -->
  {#if showUpgradeModal}
    <div
      class="fixed inset-0 z-[100] bg-black/40 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-300 px-6"
    >
      <div
        class="bg-white rounded-[2.5rem] shadow-2xl p-10 max-w-sm w-full text-center border border-white/50 animate-in zoom-in-95 duration-500 relative overflow-hidden"
      >
        <!-- Decor -->
        <div
          class="absolute -top-10 -right-10 w-32 h-32 bg-indigo-50 rounded-full blur-3xl opacity-50"
        ></div>
        <div
          class="absolute -bottom-10 -left-10 w-32 h-32 bg-pink-50 rounded-full blur-3xl opacity-50"
        ></div>

        <div
          class="w-20 h-20 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl mx-auto mb-8 flex items-center justify-center text-white shadow-xl shadow-indigo-200 rotate-3"
        >
          <svg
            class="w-10 h-10"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2.5"
              d="M13 10V3L4 14h7v7l9-11h-7z"
            /></svg
          >
        </div>

        <h2 class="text-2xl font-black text-slate-900 mb-4 tracking-tight">
          制限なしで学び放題に
        </h2>
        <p class="text-sm text-slate-500 mb-8 leading-relaxed">
          スタバ1杯分（¥480）で、月間無制限の講義解析、PDF読み込み、高度なレポート作成が使い放題になります。
        </p>

        <div class="space-y-4">
          <button
            onclick={() => goto("/pricing")}
            class="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-2xl transition-all shadow-xl shadow-slate-200 hover:-translate-y-0.5 active:scale-95"
          >
            学割プラン ¥480 で始める
          </button>
          <button
            onclick={() => (showUpgradeModal = false)}
            class="w-full text-slate-400 hover:text-slate-600 text-sm font-bold py-2 tracking-wide"
          >
            後で検討する
          </button>
        </div>
      </div>
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
  </style>
</div>
