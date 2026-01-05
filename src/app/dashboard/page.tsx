"use client";

import { useState, useEffect } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

// Utility function to safely access localStorage
const getToken = () => typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;

// Helper function to detect high duplication risk scenarios
const isHighDuplicationRisk = (questionLength: string, difficulty: string, numQuestions: number, model: string) => {
  const isShortQuestions = questionLength === 'short';
  const isEasyDifficulty = difficulty === 'easy';
  const isHighVolume = numQuestions > 30;
  const isWeakModel = !model.includes('70b') && !model.includes('8b');
  
  return isShortQuestions || isEasyDifficulty || isHighVolume || isWeakModel;
};

// Get risk factors for display
const getRiskFactors = (questionLength: string, difficulty: string, numQuestions: number, model: string) => {
  const factors = [];
  if (questionLength === 'short') factors.push('Short questions');
  if (difficulty === 'easy') factors.push('Easy difficulty');
  if (numQuestions > 30) factors.push('High volume');
  if (!model.includes('70b') && !model.includes('8b')) factors.push('Basic model');
  return factors;
};

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Home,
  History,
  LogOut,
  FileUp,
  Sparkles,
  Download,
  Save,
  X,
  Printer,
  FilterX,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import QuestionTable from "@/components/QuestionTable";
import { removeDuplicates, DuplicationContext } from "@/lib/duplicate-detector";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FeedbackPopup } from "@/components/ui/feedback-popup";
import {
  extractTextFromFile,
  extractTextFromMultipleFiles,
} from "@/lib/file-parser";
import {
  logMemoryUsage,
  isMemoryHighUsage,
  forceGarbageCollection,
} from "@/lib/memory-utils";
import { FileDropzoneWithList } from "@/components/ui/file-dropzone";

export default function DashboardPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [examTitle, setExamTitle] = useState("");
  const [academicYear, setAcademicYear] = useState("2025/2026");
  const [subject, setSubject] = useState("");
  const [coreTestingAreas, setCoreTestingAreas] = useState("");
  const [difficulty, setDifficulty] = useState("hard");
  const [questionLength, setQuestionLength] = useState("medium");
  const [scenarioFormat, setScenarioFormat] = useState("source-based");
  const [numQuestions, setNumQuestions] = useState(100);
  const [context, setContext] = useState("");
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [selectedModel, setSelectedModel] = useState("llama-3.1-8b-instant");
  const [questionTypes, setQuestionTypes] = useState({
    multiple_choice: true,
    true_false: false,
    short_answer: false,
  });

  const [questions, setQuestions] = useState<any[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string>("");
  const [streamingProgress, setStreamingProgress] = useState<number>(0);
  const [questionsGenerated, setQuestionsGenerated] = useState<number>(0);
  const [perDomainProgress, setPerDomainProgress] = useState<Record<string, { generated: number; target: number; blueprint?: any }>>({});
  const [enableStreaming, setEnableStreaming] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemovingDuplicates, setIsRemovingDuplicates] = useState(false);
  const [loadedExamId, setLoadedExamId] = useState<number | null>(null);
  const [streamReader, setStreamReader] = useState<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [domainDistribution, setDomainDistribution] = useState<{[key: string]: number}>({});
  
  // PDF metadata state variables for caching
  const [cachedSubtitle, setCachedSubtitle] = useState<string | null>(null);
  const [cachedExamOverview, setCachedExamOverview] = useState<string | null>(null);
  const [cachedExamFeatures, setCachedExamFeatures] = useState<string | null>(null);
  const [cachedCoreTestingAreasFormatted, setCachedCoreTestingAreasFormatted] = useState<string | null>(null);
  const [cachedDomainsMetadata, setCachedDomainsMetadata] = useState<string | null>(null);
  const [feedbackPopup, setFeedbackPopup] = useState({
    isOpen: false,
    success: false,
    title: "",
    message: "",
    questionsGenerated: 0,
  });

  // Load exam from sessionStorage if viewing from history
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const loadedExam = sessionStorage.getItem("loadedExam");
      if (loadedExam) {
        try {
          const exam = JSON.parse(loadedExam);
          console.log("Loading exam from sessionStorage:", exam);
          console.log("Questions in loaded exam:", exam.questions?.length || 0);
          setExamTitle(exam.title);
          setSubject(exam.subject);
          setCoreTestingAreas(exam.coreTestingAreas || '');
          setAcademicYear(exam.academicYear || '');
          setDifficulty(exam.difficulty);
          setQuestionLength(exam.questionLength || "medium");
          setScenarioFormat(exam.scenarioFormat || "mixed");
          setNumQuestions(exam.numQuestions);
          setQuestions(exam.questions || []);
          setLoadedExamId(exam.id);
          
          // Load cached PDF metadata if available
          setCachedSubtitle(exam.subtitle || null);
          setCachedExamOverview(exam.examOverview || null);
          setCachedExamFeatures(exam.examFeatures || null);
          setCachedCoreTestingAreasFormatted(exam.coreTestingAreasFormatted || null);
          setCachedDomainsMetadata(exam.domainsMetadata || null);
          
          console.log("Loaded cached PDF metadata:", {
            subtitle: exam.subtitle,
            examOverview: exam.examOverview,
            examFeatures: exam.examFeatures,
            coreTestingAreasFormatted: exam.coreTestingAreasFormatted,
            domainsMetadata: exam.domainsMetadata
          });
          sessionStorage.removeItem("loadedExam");
          toast.success(
            `Exam loaded successfully with ${exam.questions?.length || 0} questions`
          );
        } catch (error) {
          console.error("Failed to load exam:", error);
          toast.error("Failed to load exam");
        }
      }
    }
  }, []);

  // Debug useEffect to track questions state changes
  useEffect(() => {
    console.log("Questions state changed:", questions);
    console.log("Questions length:", questions.length);
    if (questions.length > 0) {
      console.log("First question structure:", questions[0]);
      console.log("Sample question keys:", Object.keys(questions[0] || {}));
    }
  }, [questions]);

  // Memory monitoring and cleanup
  useEffect(() => {
    const interval = setInterval(() => {
      logMemoryUsage("Dashboard");

      if (isMemoryHighUsage()) {
        console.warn("High memory usage detected");
        // Force garbage collection if available
        forceGarbageCollection();
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  // Cleanup effect for component unmount
  useEffect(() => {
    return () => {
      // Clear large context data on unmount but preserve questions
      setContext("");
      setSourceFiles([]);
      forceGarbageCollection();
    };
  }, []);

  // Effect to recalculate domain distribution when question count changes
  useEffect(() => {
    if (coreTestingAreas.trim() && numQuestions > 0) {
      // Remove question counts to get clean input for processing
      const cleanInput = coreTestingAreas
        .split('\n')
        .map(line => line.replace(/\s*\(\d+\)\s*$/, '').trim())
        .filter(line => line.length > 0)
        .join('\n');
      
      if (cleanInput.trim()) {
        const newDistribution = calculateDomainDistribution(cleanInput, numQuestions);
        setDomainDistribution(newDistribution);
        
        // Update the display with new question counts
        if (Object.keys(newDistribution).length > 0) {
          const formattedAreas = formatCoreAreasWithCounts(cleanInput, newDistribution);
          setCoreTestingAreas(formattedAreas);
        }
      }
    } else {
      setDomainDistribution({});
    }
  }, [numQuestions]); // Only trigger on numQuestions change to avoid infinite loop

  const handleSignOut = async () => {
    const token = getToken();
    const { error } = await authClient.signOut({
      fetchOptions: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    if (error?.code) {
      toast.error("Sign out failed");
    } else {
      if (typeof window !== 'undefined') {
        localStorage.removeItem("bearer_token");
      }
      router.push("/");
    }
  };

  const handleStopGeneration = async () => {
    console.log("🛑 Stopping generation...");
    setIsStopping(true);
    setStreamingStatus("Stopping generation and saving current progress...");
    
    // Cancel the stream reader
    if (streamReader) {
      try {
        await streamReader.cancel();
        console.log("🛑 Stream reader cancelled");
      } catch (error) {
        console.error("Error cancelling stream:", error);
      }
    }
    
    // Process current questions with auto-save (includes global duplicate detection)
    if (questions.length > 0) {
      console.log(`🛑 Processing ${questions.length} questions generated so far`);
      await handleAutoSave(questions);
      
      setFeedbackPopup({
        isOpen: true,
        success: true,
        title: "Generation Stopped",
        message: `Generation was stopped. ${questions.length} questions were saved and duplicates removed.`,
        questionsGenerated: questions.length,
      });
    }
    
    // Reset states
    setIsGenerating(false);
    setIsStreaming(false);
    setIsStopping(false);
    setStreamReader(null);
    setStreamingProgress(0);
    setStreamingStatus("");
    
    console.log("🛑 Generation stopped successfully");
  };



  const performStreamingGeneration = async (categories: {[key: string]: number}) => {
    console.log("🔄 Starting PER-DOMAIN sequential generation...");

    if (!examTitle.trim()) {
      console.log("🏷️ Generating exam title...");
      const generatedTitle = await generateExamTitle();
      setExamTitle(generatedTitle);
    }

    // Reset previous questions and states
    setQuestions([]);
    setIsStreaming(true);
    setIsGenerating(true);
    setStreamingStatus("Starting per-domain generation...");
    setStreamingProgress(0);
    setQuestionsGenerated(0);

    try {
      const selectedQuestionTypes = Object.entries(questionTypes)
        .filter(([_, isSelected]) => isSelected)
        .map(([type, _]) => type);

      const domainEntries = Object.entries(categories);
      const totalDomains = domainEntries.length;
      let cumulative = 0;

      // initialize per-domain progress
      const initialProgress: Record<string, { generated: number; target: number; blueprint?: any }> = {};
      domainEntries.forEach(([d, c]) => { initialProgress[d] = { generated: 0, target: Number(c), blueprint: undefined }; });
      setPerDomainProgress(initialProgress);

      for (let i = 0; i < domainEntries.length; i++) {
        const [domain, count] = domainEntries[i];
        const token = getToken(); // Get fresh token for each request
        
        if (!token) {
          toast.error('Authentication required. Please sign in.');
          router.push('/sign-in');
          return;
        }
        
        setStreamingStatus(`Generating ${domain}: ${count} questions (Domain ${i + 1}/${totalDomains})`);

        // Update progress to show current domain being processed
        setPerDomainProgress(prev => ({
          ...prev,
          [domain]: {
            ...(prev[domain] || { generated: 0, target: Number(count) }),
            generated: 0, // Reset to show it's starting
            blueprint: undefined
          }
        }));

        // Use streaming API to generate this domain so we receive incremental updates
        const requestBody = {
          examTitle,
          subject,
          coreTestingAreas,
          context,
          difficulty,
          questionLength,
          numQuestions: Number(count),
          questionTypes: selectedQuestionTypes,
          scenarioFormat,
          model: selectedModel,
          stream: true,
          domainDistribution: { [domain]: Number(count) },
        };

        console.log(`📤 Requesting (stream) domain ${domain}: ${count} questions`);

        const response = await fetch('/api/generate-questions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok || !response.body) {
          const errText = await response.text();
          console.error(`❌ Error starting stream for domain ${domain} (${response.status}):`, errText);
          if (response.status === 401) {
            toast.error('Authentication failed. Please sign in again.');
            router.push('/sign-in');
            return;
          }

          toast.error(`Failed to start streaming generation for ${domain}: ${response.status}`);
          setPerDomainProgress(prev => ({
            ...prev,
            [domain]: {
              ...(prev[domain] || { generated: 0, target: Number(count) }),
              generated: 0,
              blueprint: { error: `Generation failed (${response.status})` }
            }
          }));
          continue;
        }

        // Stream with retry/backoff in case of transient failures
        let streamAttempts = 0;
        const maxStreamAttempts = 4;
        let streamSucceeded = false;
        let generatedSoFar = 0;

        let blueprintForDomain: any = undefined;
        
        while (streamAttempts < maxStreamAttempts && generatedSoFar < Number(count)) {
          streamAttempts++;
          const remaining = Math.max(1, Number(count) - generatedSoFar);
          const streamRequestBody = { ...requestBody, numQuestions: remaining };

          try {
            const streamResponse = await fetch('/api/generate-questions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify(streamRequestBody),
            });

            if (!streamResponse.ok || !streamResponse.body) {
              const errText = await streamResponse.text();
              throw new Error(`Stream start failed: ${streamResponse.status} ${errText}`);
            }

            // Read SSE stream
            const reader = streamResponse.body.getReader();
            setStreamReader(reader);
            const decoder = new TextDecoder();
            let buffer = '';
            const domainAccumulated: any[] = [];

            const flushDomainBuffer = async (force = false) => {
              if (domainAccumulated.length === 0) return;
              const toSave = domainAccumulated.splice(0, force ? domainAccumulated.length : 10);
              try {
                await saveDomainQuestionsImmediate(domain, toSave);
                console.log(`✅ Persisted batch of ${toSave.length} questions for ${domain}`);
              } catch (err) {
                console.warn(`Failed to persist domain batch for ${domain}:`, err);
                domainAccumulated.unshift(...toSave);
              }
            };

            // Read loop
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });

                // Split by SSE record separator
                const parts = buffer.split('\n\n');
                buffer = parts.pop() || '';

                for (const part of parts) {
                  const line = part.trim();
                  if (!line) continue;
                  const dataPrefix = 'data:';
                  const idx = line.indexOf(dataPrefix);
                  const payload = idx !== -1 ? line.slice(idx + dataPrefix.length).trim() : line;
                  try {
                    const event = JSON.parse(payload);
                    if (event.type === 'question') {
                      const q = event.question;
                      const withDomainItem = { ...q, domain, domainIndex: i, questionInDomain: (domainAccumulated.length + 1) };
                      setQuestions(prev => [...prev, withDomainItem]);
                      domainAccumulated.push(withDomainItem);
                      cumulative += 1;
                      generatedSoFar += 1;
                      setQuestionsGenerated(cumulative);
                      setStreamingProgress(Math.round((cumulative / numQuestions) * 100));

                      // Flush immediately (per-question)
                      if (domainAccumulated.length >= 1) await flushDomainBuffer();
                    } else if (event.type === 'progress') {
                      setStreamingStatus(event.message || `Generating ${domain}...`);
                    } else if (event.type === 'global_deduplication') {
                      console.log('Global deduplication info:', event);
                    } else if (event.type === 'complete') {
                      const finalQs = event.questions || [];
                      for (const q of finalQs) {
                        const withDomainItem = { ...q, domain, domainIndex: i, questionInDomain: (domainAccumulated.length + 1) };
                        setQuestions(prev => [...prev, withDomainItem]);
                        domainAccumulated.push(withDomainItem);
                        cumulative += 1;
                        generatedSoFar += 1;
                      }
                      blueprintForDomain = event.domainBlueprint || blueprintForDomain;
                      await flushDomainBuffer(true);
                    } else if (event.type === 'error') {
                      throw new Error(event.message || 'Stream error');
                    }
                  } catch (err) {
                    console.warn('Failed to parse stream payload:', payload.substring ? payload.substring(0,200) : payload, err);
                  }
                }
              }
            } catch (streamErr) {
              // Close reader and rethrow to trigger retry/backoff
              try { await reader.cancel(); } catch (_) {}
              throw streamErr;
            }

            // Ensure any leftover questions persisted
            await flushDomainBuffer(true);

            // After finishing stream, derive domain questions from UI store
            const domainQuestions = questions.filter(q => q.domain === domain && q.domainIndex === i);
            const finalBlueprintForDomain = blueprintForDomain || undefined;
            const finalWithDomain = domainQuestions.map((q: any, idx: number) => ({ ...q, domainIndex: i, questionInDomain: idx + 1 }));

            // Append to UI immediately (may be redundant) and persist final domain
            setQuestions(prev => [...prev, ...finalWithDomain]);
            try {
              await saveDomainQuestionsImmediate(domain, finalWithDomain);
              console.log(`✅ Persisted ${finalWithDomain.length} questions for domain ${domain}`);
            } catch (saveErr) {
              console.warn(`Failed to persist domain ${domain}:`, saveErr);
            }

            // Update per-domain progress
            setPerDomainProgress(prev => ({
              ...prev,
              [domain]: {
                ...(prev[domain] || { generated: 0, target: Number(count) }),
                generated: generatedSoFar,
                blueprint: finalBlueprintForDomain
              }
            }));

            streamSucceeded = true;
            break; // exit retry loop for this domain
          } catch (err: any) {
            console.warn(`Stream attempt ${streamAttempts} for ${domain} failed:`, err?.message || err);
            if (streamAttempts >= maxStreamAttempts) {
              console.error(`Exceeded max stream attempts for domain ${domain}`);
              setPerDomainProgress(prev => ({
                ...prev,
                [domain]: {
                  ...(prev[domain] || { generated: 0, target: Number(count) }),
                  generated: generatedSoFar,
                  blueprint: { error: `Streaming failed after ${streamAttempts} attempts` }
                }
              }));
              // Persist whatever we have locally
              try { await saveDomainQuestionsImmediate(domain, questions.filter(q => q.domain === domain)); } catch(_) {}
              break;
            }

            const backoffMs = Math.min(60000, 1000 * Math.pow(2, streamAttempts));
            console.log(`Retrying stream for ${domain} in ${backoffMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue; // retry
          }
        }

        // After finishing stream, derive domain questions from UI store
        const domainQuestions = questions.filter(q => q.domain === domain && q.domainIndex === i);
        const finalBlueprintForDomain = blueprintForDomain || undefined;
        const finalWithDomain = domainQuestions.map((q: any, idx: number) => ({ ...q, domainIndex: i, questionInDomain: idx + 1 }));

        // Append to UI immediately
        setQuestions(prev => [...prev, ...finalWithDomain]);

        // Immediately persist this domain's questions to avoid losing progress
        try {
          await saveDomainQuestionsImmediate(domain, finalWithDomain);
          console.log(`✅ Persisted ${finalWithDomain.length} questions for domain ${domain}`);
        } catch (saveErr) {
          console.warn(`Failed to persist domain ${domain}:`, saveErr);
        }

        // Update per-domain progress with generated count and blueprint
        setPerDomainProgress(prev => ({
          ...prev,
          [domain]: {
            ...(prev[domain] || { generated: 0, target: Number(count) }),
            generated: finalWithDomain.length,
            blueprint: finalBlueprintForDomain
          }
        }));

        cumulative += finalWithDomain.length;
        setQuestionsGenerated(cumulative);
        setStreamingProgress(Math.round((cumulative / numQuestions) * 100));
        console.log(`✅ Generated ${finalWithDomain.length}/${count} questions for ${domain}`);
        
        // Update status to show completion of this domain
        setStreamingStatus(`✅ Completed ${domain}: ${finalWithDomain.length} questions generated`);
        
        // Small delay to show the completion status
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      setStreamingStatus(`🎉 Generation Complete! Generated ${cumulative} questions across ${totalDomains} domains`);
      setIsGenerating(false);
      setIsStreaming(false);
      setStreamReader(null);
      setStreamingProgress(100);

      // Auto-save with automatic global duplicate detection
      setStreamingStatus(`💾 Auto-saving with duplicate detection...`);
      await handleAutoSave(questions);
      
      // Show completion feedback
      setFeedbackPopup({ 
        isOpen: true, 
        success: true, 
        title: 'Generation Complete', 
        message: `Successfully generated and saved ${questions.length} questions across ${totalDomains} domains with automatic duplicate removal.`, 
        questionsGenerated: questions.length 
      });
      
      // Clear per-domain progress after a delay to show final state
      setTimeout(() => {
        setPerDomainProgress({});
      }, 5000);
    } catch (error) {
      console.error('Per-domain generation error:', error);
      toast.error('An error occurred during generation');
      setIsGenerating(false);
      setIsStreaming(false);
      setPerDomainProgress({});
    }
  };

  const performRegularGeneration = async (categories: {[key: string]: number}) => {
    console.log("🔄 Starting REGULAR generation...");
    
    // Generate title if not provided
    if (!examTitle.trim()) {
      console.log("🏷️ Generating exam title...");
      const generatedTitle = await generateExamTitle();
      setExamTitle(generatedTitle);
    }

    // Check for high duplication risk and warn user
    const isHighRisk = isHighDuplicationRisk(questionLength, difficulty, numQuestions, selectedModel);
    const riskFactors = getRiskFactors(questionLength, difficulty, numQuestions, selectedModel);
    
    if (isHighRisk && riskFactors.length > 0) {
      const proceed = window.confirm(
        `⚠️ High Duplication Risk Detected!\n\n` +
        `Risk Factors:\n${riskFactors.map(f => `• ${f}`).join('\n')}\n\n` +
        `Recommendations:\n` +
        `• Use "medium" or "long" question length\n` +
        `• Set difficulty to "medium" or "hard"\n` +
        `• Consider fewer questions (≤30)\n` +
        `• Use a stronger model (70b or 8b)\n\n` +
        `Continue anyway?`
      );
      
      if (!proceed) {
        return;
      }
    }

    setIsGenerating(true);
    try {
      const token = getToken();
      console.log("📤 Making API call to /api/generate-questions...");
      
      // Convert questionTypes object to array of selected types
      const selectedQuestionTypes = Object.entries(questionTypes)
        .filter(([_, isSelected]) => isSelected)
        .map(([type, _]) => type);
      
      console.log("📝 Selected question types:", selectedQuestionTypes);
      console.log("📝 Requested number of questions:", numQuestions);
      
      const requestBody = {
        examTitle,
        subject,
        coreTestingAreas,
        context,
        difficulty,
        questionLength,
        numQuestions,
        questionTypes: selectedQuestionTypes,
        scenarioFormat,
        model: selectedModel,
        domainDistribution: categories,
      };
      
      console.log("📤 Request body:", requestBody);

      const response = await fetch("/api/generate-questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
      });

      console.log("📥 Response status:", response.status);
      console.log("📥 Response ok:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ API Error response:", errorText);
        throw new Error(`Failed to generate questions: ${errorText}`);
      }

      const result = await response.json();

      console.log("✅ API Response:", result);
      console.log("✅ Questions in response:", result.questions);
      console.log("✅ Questions array length:", result.questions?.length || 0);
      
      if (!result.questions || !Array.isArray(result.questions)) {
        throw new Error("Invalid response format");
      }

      console.log("Setting questions state with:", result.questions);
      setQuestions(result.questions);

      // Auto-save the generated exam (includes automatic global duplicate detection)
      await handleAutoSave(result.questions);
      
      // Update domain distribution counts after auto-save deduplication
      // Note: handleAutoSave may have updated questions state with deduplicated results
      if (questions && questions.length > 0) {
        const updatedDistribution: { [key: string]: number } = {};
        questions.forEach((q: any) => {
          if (q.domain) {
            updatedDistribution[q.domain] = (updatedDistribution[q.domain] || 0) + 1;
          }
        });
        
        // Update domain distribution state to reflect actual question counts after deduplication
        if (Object.keys(updatedDistribution).length > 0) {
          setDomainDistribution(updatedDistribution);
          console.log('📊 Updated domain distribution after deduplication:', updatedDistribution);
        }
      }

      setFeedbackPopup({
        isOpen: true,
        success: true,
        title: "Generation Successful",
        message: "Questions have been generated successfully, auto-saved with automatic duplicate detection.",
        questionsGenerated: questions.length,
      });
    } catch (error: any) {
      console.error("Generation error:", error);
      setFeedbackPopup({
        isOpen: true,
        success: false,
        title: "Generation Failed",
        message: error.message || "Failed to generate questions. Please check your inputs and try again.",
        questionsGenerated: 0,
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Function to extract MAIN DOMAINS from any input format
  const extractMainTopics = (input: string): string[] => {
    if (!input.trim()) return [];
    
    const mainDomains: string[] = [];
    
    // Pattern 1: Structured headings (## **1. System Name** or # System Name)
    const headingMatches = input.match(/^#{1,3}\s*\*{0,2}\d*\.?\s*([^\n*]+?)\*{0,2}$/gm);
    if (headingMatches && headingMatches.length > 0) {
      headingMatches.forEach(match => {
        let domain = match
          .replace(/^#{1,3}\s*/, '') // Remove ## markup
          .replace(/^\*\*/, '') // Remove opening **
          .replace(/\*\*$/, '') // Remove closing **
          .replace(/^\d+\.\s*/, '') // Remove numbering
          .trim();
        
        if (domain && domain.length > 3) {
          mainDomains.push(domain);
        }
      });
    }
    
    // Pattern 2: Numbered/bulleted lists (1. System Name or • System Name)
    if (mainDomains.length === 0) {
      const lines = input.split('\n').map(line => line.trim()).filter(line => line.length > 0);
      
      for (const line of lines) {
        // Skip if it's clearly a subtopic (indented, starts with lowercase, or too descriptive)
        const isSubtopic = 
          line.startsWith('  ') || line.startsWith('\t') ||
          /^[\s]*[-•*]\s*[a-z]/.test(line) ||
          line.includes(' including ') || line.includes(' such as ') ||
          line.includes(' and ') && line.length > 40;
        
        if (!isSubtopic) {
          // Check if it's a main topic line
          const isMainTopic = 
            /^\d+\.\s*/.test(line) || // Numbered list
            /^[A-Z]/.test(line) && line.length < 50 || // Starts with capital, not too long
            /^[-•*]\s*[A-Z]/.test(line) && line.length < 50; // Bulleted with capital
          
          if (isMainTopic) {
            let domain = line
              .replace(/^\d+\.\s*/, '') // Remove numbering
              .replace(/^[-•*]\s*/, '') // Remove bullets
              .replace(/\s*\(\d+\)\s*$/, '') // Remove question counts
              .split(':')[0] // Take part before colon
              .split('(')[0] // Take part before parentheses
              .split('-')[0] // Take part before dash
              .trim();
            
            if (domain && domain.length > 3 && domain.length < 60) {
              mainDomains.push(domain);
            }
          }
        }
      }
    }
    
    // Pattern 3: Paragraph format - extract key topics
    if (mainDomains.length === 0) {
      // Look for common system/topic patterns in paragraphs
      const topicPatterns = [
        /\b(nervous|neurological?)\s+system\b/gi,
        /\b(cardiovascular|circulatory|cardiac)\s+system\b/gi,
        /\b(endocrine)\s+system\b/gi,
        /\b(respiratory|pulmonary)\s+system\b/gi,
        /\b(digestive|gastrointestinal|GI)\s+system\b/gi,
        /\b(urinary|renal|kidney)\s+system\b/gi,
        /\b(reproductive)\s+system\b/gi,
        /\b(immune|immunity|lymphatic)\s+system\b/gi,
        /\b(musculoskeletal|skeletal|muscular)\s+system\b/gi,
        /\b(integumentary|skin)\s+system\b/gi
      ];
      
      topicPatterns.forEach(pattern => {
        const matches = input.match(pattern);
        if (matches) {
          matches.forEach(match => {
            const domain = match.replace(/\b(system)\b/gi, 'System')
              .split(' ')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(' ');
            if (!mainDomains.some(d => d.toLowerCase().includes(domain.toLowerCase()))) {
              mainDomains.push(domain);
            }
          });
        }
      });
      
      // Also look for standalone topic words
      const standaloneTopics = input.match(/\b(pathophysiology|pharmacology|anatomy|physiology|biochemistry|genetics|immunology|microbiology)\b/gi);
      if (standaloneTopics) {
        standaloneTopics.forEach(topic => {
          const formattedTopic = topic.charAt(0).toUpperCase() + topic.slice(1).toLowerCase();
          if (!mainDomains.some(d => d.toLowerCase().includes(formattedTopic.toLowerCase()))) {
            mainDomains.push(formattedTopic);
          }
        });
      }
    }
    
    // Clean and format domains
    const cleanedDomains = mainDomains.map(domain => {
      return domain
        .replace(/\s+(System|Systems?)$/i, ' System') // Normalize "System" ending
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
    });
    
    // Remove duplicates
    const uniqueDomains: string[] = [];
    const seenDomains = new Set<string>();
    
    for (const domain of cleanedDomains) {
      const lowerDomain = domain.toLowerCase();
      if (!seenDomains.has(lowerDomain) && domain.length > 2) {
        seenDomains.add(lowerDomain);
        uniqueDomains.push(domain);
      }
    }
    
    return uniqueDomains;
  };

  // Function to calculate realistic domain question distribution
  const calculateDomainDistribution = (rawInput: string, totalQuestions: number) => {
    if (!rawInput.trim()) return {};
    
    const domains = extractMainTopics(rawInput);
    if (domains.length === 0) return {};
    
    const distribution: {[key: string]: number} = {};
    
    // Complexity-based weighting system
    const getComplexityWeight = (domain: string): number => {
      const lowerDomain = domain.toLowerCase();
      
      // High complexity domains (weight: 2.0 - 2.5)
      if (lowerDomain.includes('nervous') || lowerDomain.includes('neurologic') ||
          lowerDomain.includes('cardiovascular') || lowerDomain.includes('cardiac') ||
          lowerDomain.includes('pathophysiology') || lowerDomain.includes('pharmacology') ||
          lowerDomain.includes('critical care') || lowerDomain.includes('emergency') ||
          lowerDomain.includes('oncology') || lowerDomain.includes('immunology')) {
        return 2.2;
      }
      
      // Medium-high complexity (weight: 1.5 - 1.8)
      if (lowerDomain.includes('respiratory') || lowerDomain.includes('renal') ||
          lowerDomain.includes('endocrine') || lowerDomain.includes('gastrointestinal') ||
          lowerDomain.includes('musculoskeletal') || lowerDomain.includes('reproductive') ||
          lowerDomain.includes('hematologic') || lowerDomain.includes('integumentary')) {
        return 1.6;
      }
      
      // Medium complexity (weight: 1.0 - 1.3)
      if (lowerDomain.includes('mental health') || lowerDomain.includes('pediatric') ||
          lowerDomain.includes('maternal') || lowerDomain.includes('geriatric') ||
          lowerDomain.includes('assessment') || lowerDomain.includes('fundamentals')) {
        return 1.2;
      }
      
      // Lower complexity (weight: 0.6 - 0.9)
      if (lowerDomain.includes('communication') || lowerDomain.includes('ethics') ||
          lowerDomain.includes('legal') || lowerDomain.includes('professional') ||
          lowerDomain.includes('documentation') || lowerDomain.includes('leadership')) {
        return 0.8;
      }
      
      return 1.0; // Default weight
    };
    
    // Calculate weights and base distribution
    const weights = domains.map(domain => getComplexityWeight(domain));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    
    // Create realistic distribution with variation
    let remainingQuestions = totalQuestions;
    const minQuestionsPerDomain = Math.max(1, Math.floor(totalQuestions / (domains.length * 3)));
    
    // Distribute questions proportionally but ensure variation
    for (let i = 0; i < domains.length - 1; i++) {
      const domain = domains[i];
      let baseQuestions = Math.round((weights[i] / totalWeight) * totalQuestions);
      
      // Ensure minimum and apply realistic variation
      baseQuestions = Math.max(minQuestionsPerDomain, baseQuestions);
      
      // Add controlled randomness for realism (±15%)
      const variation = 0.85 + (Math.random() * 0.3); // 0.85 to 1.15
      let finalQuestions = Math.round(baseQuestions * variation);
      
      // Ensure we don't exceed remaining or go below minimum
      const maxAllowed = remainingQuestions - (domains.length - i - 1) * minQuestionsPerDomain;
      finalQuestions = Math.min(finalQuestions, maxAllowed);
      finalQuestions = Math.max(minQuestionsPerDomain, finalQuestions);
      
      distribution[domain] = finalQuestions;
      remainingQuestions -= finalQuestions;
    }
    
    // Assign remaining questions to last domain
    if (domains.length > 0) {
      const lastDomain = domains[domains.length - 1];
      distribution[lastDomain] = Math.max(minQuestionsPerDomain, remainingQuestions);
    }
    
    // Validate total equals requested questions
    const actualTotal = Object.values(distribution).reduce((sum, count) => sum + count, 0);
    if (actualTotal !== totalQuestions) {
      // Adjust the largest domain to match exact total
      const largestDomain = Object.entries(distribution)
        .sort(([,a], [,b]) => b - a)[0][0];
      const difference = totalQuestions - actualTotal;
      distribution[largestDomain] = Math.max(1, distribution[largestDomain] + difference);
    }
    
    return distribution;
  };

  // Function to format core testing areas with question counts in a clean, organized way
  const formatCoreAreasWithCounts = (areas: string, distribution: {[key: string]: number}): string => {
    if (!areas.trim() || Object.keys(distribution).length === 0) return areas;
    
    // Extract main topics using the intelligent extraction
    const mainTopics = extractMainTopics(areas);
    
    // Format with consistent bullet points and question counts
    const formattedTopics = mainTopics
      .map(topic => {
        const count = distribution[topic] || 0;
        return `${topic} (${count})`;
      })
      .join('\n');
    
    return formattedTopics;
  };

  // Handler for core testing areas changes with real-time distribution updates
  const handleCoreAreasChange = (value: string) => {
    // Always update the textarea value immediately for responsive typing
    setCoreTestingAreas(value);
    
    // Remove question counts from input to get clean input for processing
    const cleanValue = value
      .split('\n')
      .map(line => line.replace(/\s*\(\d+\)\s*$/, '').trim())
      .filter(line => line.length > 0)
      .join('\n');
    
    // Recalculate distribution if we have content and questions
    if (cleanValue.trim() && numQuestions > 0) {
      const newDistribution = calculateDomainDistribution(cleanValue, numQuestions);
      setDomainDistribution(newDistribution);
      
      // Update display with new counts after user stops typing (debounced)
      const timeoutId = setTimeout(() => {
        if (Object.keys(newDistribution).length > 0) {
          const formattedAreas = formatCoreAreasWithCounts(cleanValue, newDistribution);
          setCoreTestingAreas(formattedAreas);
        }
      }, 1000); // 1 second delay to avoid constant updates while typing
      
      // Store timeout ID for potential cleanup
      return () => clearTimeout(timeoutId);
    } else {
      // Clear distribution if no valid content
      setDomainDistribution({});
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Check total file size to prevent memory issues
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const maxTotalSize = 100 * 1024 * 1024; // 100MB total limit

    if (totalSize > maxTotalSize) {
      toast.error(
        `Total file size too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Maximum is 100MB.`
      );
      e.target.value = "";
      return;
    }

    setIsProcessingFiles(true);
    try {
      // Process files one by one to reduce memory usage
      const newFiles = [...sourceFiles];
      let extractedText = context;

      for (const file of files) {
        try {
          newFiles.push(file);
          const fileText = await extractTextFromFile(file);

          // Add file separator
          const separator = `=== Source: ${file.name} ===\n\n`;
          let newExtractedText = extractedText
            ? `${extractedText}\n\n${separator}${fileText}\n\n`
            : `${separator}${fileText}\n\n`;

          // Check context size limit (1MB limit for context)
          const maxContextSize = 1024 * 1024; // 1MB
          if (newExtractedText.length > maxContextSize) {
            // Truncate and show warning
            newExtractedText =
              newExtractedText.substring(0, maxContextSize) +
              "\n\n... [Content truncated due to size limit] ...";
            toast.warning(
              `Context truncated due to size limit. Consider using fewer or smaller files.`
            );
          }

          extractedText = newExtractedText;

          // Update UI incrementally for better UX
          setSourceFiles([...newFiles]);
          setContext(extractedText);
        } catch (fileError: any) {
          console.error(`Failed to process ${file.name}:`, fileError);
          toast.error(`Failed to process ${file.name}: ${fileError.message}`);
          // Continue with other files
        }
      }

      if (newFiles.length > sourceFiles.length) {
        toast.success(
          `Uploaded ${newFiles.length - sourceFiles.length} file(s) successfully`
        );
      }
    } catch (error: any) {
      // More specific error handling for PDF parsing issues
      if (
        error.message?.includes("pdf-parse") &&
        error.message?.includes("PDF.js")
      ) {
        toast.error(
          "PDF parsing failed. Please try a different PDF file or convert it to a text/DOCX format."
        );
      } else if (
        error.message?.includes("worker") ||
        error.message?.includes("fetch")
      ) {
        toast.error(
          "Network issue while processing PDF. Please check your internet connection and try again."
        );
      } else if (error.message?.includes("too large")) {
        toast.error(error.message);
      } else {
        toast.error(error.message || "Failed to process files");
      }

      // Remove the failed files from the list
      setSourceFiles(sourceFiles);
    } finally {
      setIsProcessingFiles(false);
      // Reset input to allow re-uploading same file
      e.target.value = "";

      // Force garbage collection hint
      if (window.gc) {
        window.gc();
      }
    }
  };

  const handleRemoveFile = async (index: number) => {
    try {
      // Extract context from all files except the one being removed
      const remainingFiles = sourceFiles.filter((_, i) => i !== index);
      setSourceFiles(remainingFiles);

      if (remainingFiles.length === 0) {
        setContext("");
        toast.success("File removed and context cleared");
      } else {
        // Re-extract text from remaining files
        setIsProcessingFiles(true);
        try {
          const extractedText = await extractTextFromMultipleFiles(
            remainingFiles
          );
          setContext(extractedText);
          toast.success("File removed and context updated");
        } catch (error: any) {
          toast.error(
            `File removed but failed to update context: ${error.message}`
          );
        } finally {
          setIsProcessingFiles(false);
        }
      }
    } catch (error: any) {
      toast.error(`Failed to remove file: ${error.message}`);
    }
  };

  const generateExamTitle = async () => {
    if (!subject.trim()) return examTitle;

    try {
      const token = getToken();
      const coreAreas = coreTestingAreas
        .split('\n')
        .map(area => area.trim())
        .filter(area => area)
        .slice(0, 7);

      const response = await fetch("/api/generate-coverpage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exam_title: subject,
          exam_subtitle: `Professional Assessment | Updated ${new Date().getFullYear()} Standards`,
          core_testing_areas: coreAreas,
          question_count: numQuestions,
          question_types: Object.entries(questionTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type.replace('_', ' ')),
          includes_answers: true,
          strict_mode: true
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.cover_page?.title) {
          return data.cover_page.title;
        }
      }
    } catch (error) {
      console.warn("Title generation failed, using fallback:", error);
    }

    // Fallback title format
    const year = new Date().getFullYear();
    return `${subject.toUpperCase()} UPDATED FINAL EXAM | ${year}/${year + 1} | Questions With Complete Solutions Graded A+ | ${subject} | Professional Certification`;
  };

  const handleAutoSave = async (questionsToSave: any[]) => {
    if (!examTitle.trim()) return;

    // Perform global duplicate detection before saving
    console.log(`🔍 Auto-save: Performing global duplicate check on ${questionsToSave.length} questions...`);
    
    const globalDeduplicationContext: DuplicationContext = {
      questionLength: questionLength as 'short' | 'medium' | 'long',
      difficulty,
      numQuestions: questionsToSave.length
    };

    const globalDeduplicationResult = removeDuplicates(questionsToSave, globalDeduplicationContext);
    const finalQuestions = globalDeduplicationResult.unique;
    
    if (globalDeduplicationResult.duplicatesRemoved > 0) {
      console.log(`🚫 Auto-save: Removed ${globalDeduplicationResult.duplicatesRemoved} global duplicates before saving`);
      
      // Update the UI with deduplicated questions
      setQuestions(finalQuestions);
      setQuestionsGenerated(finalQuestions.length);
      
      toast.info(`Auto-save: Removed ${globalDeduplicationResult.duplicatesRemoved} duplicate questions`, {
        description: `Saving ${finalQuestions.length} unique questions`
      });
    } else {
      console.log(`✅ Auto-save: No global duplicates found, saving all ${finalQuestions.length} questions`);
    }

    // Generate PDF metadata to avoid AI calls during exports
    console.log(`📄 Generating PDF metadata for future exports...`);
    let pdfMetadata = null;
    
    try {
      const token = getToken();
      const coreAreas = coreTestingAreas
        .split('\n')
        .map(area => area.trim())
        .filter(area => area)
        .slice(0, 7);

      // Generate comprehensive PDF metadata
      const coverPageResponse = await fetch("/api/generate-coverpage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          exam_title: subject,
          exam_subtitle: `Professional Assessment | Updated ${new Date().getFullYear()} Standards`,
          core_testing_areas: coreAreas,
          question_count: finalQuestions.length,
          question_types: Object.entries(questionTypes)
            .filter(([_, enabled]) => enabled)
            .map(([type]) => type.replace('_', ' ')),
          includes_answers: true,
          strict_mode: true
        }),
      });

      if (coverPageResponse.ok) {
        const coverData = await coverPageResponse.json();
        if (coverData.success && coverData.cover_page) {
          pdfMetadata = {
            subtitle: coverData.cover_page.subtitle || `Professional Assessment | Updated ${new Date().getFullYear()} Standards`,
            examOverview: coverData.cover_page.exam_overview || `Professional exam designed to validate knowledge and competency.`,
            examFeatures: JSON.stringify(coverData.cover_page.exam_features || [
              `✓ ${finalQuestions.length} Comprehensive Questions`,
              `✓ Multiple Question Types`,
              `✓ Detailed Answer Explanations`,
              `✓ Professional Assessment Standards`
            ]),
            coreTestingAreasFormatted: JSON.stringify(coverData.cover_page.exam_sections || coreAreas),
            domainsMetadata: JSON.stringify(domainDistribution)
          };
          console.log(`✅ PDF metadata generated successfully`);
        }
      }
    } catch (metadataError) {
      console.warn("PDF metadata generation failed, using fallbacks:", metadataError);
    }

    try {
      const token = getToken();
      const examData = {
        title: examTitle,
        subject: subject,
        coreTestingAreas,
        difficulty,
        questionLength,
        scenarioFormat,
        numQuestions,
        questions: finalQuestions, // Use deduplicated questions
        userId: session?.user?.id,
        update: loadedExamId ? true : false,
        examId: loadedExamId || undefined,
        // Include PDF metadata
        ...pdfMetadata
      };

      const response = await fetch("/api/exams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(examData),
      });

      if (!response.ok) {
        console.warn("Auto-save failed (non-critical)");
        return;
      }

      const result = await response.json();
      if (result.id && !loadedExamId) {
        setLoadedExamId(result.id);
      }
    } catch (error) {
      console.warn("Auto-save error (non-critical):", error);
    }
  };

  // Persist a single domain's questions immediately (create exam if needed, otherwise append)
  const saveDomainQuestionsImmediate = async (domainName: string, domainQuestions: any[]) => {
    if (!examTitle.trim() || domainQuestions.length === 0) return;

    try {
      const token = getToken();

      const examData: any = {
        title: examTitle,
        subject: subject,
        coreTestingAreas,
        difficulty,
        questionLength,
        scenarioFormat,
        numQuestions,
        questions: domainQuestions,
        userId: session?.user?.id,
        update: loadedExamId ? true : false,
        examId: loadedExamId || undefined,
        // Attach domain metadata so backend can mark domain on questions
      };

      const response = await fetch('/api/exams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(examData),
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Failed to persist domain ${domainName}: ${response.status} ${txt}`);
      }

      const result = await response.json();
      if (result && result.exam && result.exam.id) {
        if (!loadedExamId) setLoadedExamId(result.exam.id);
      } else if (result && result.id && !loadedExamId) {
        setLoadedExamId(result.id);
      }
    } catch (error: any) {
      console.warn('saveDomainQuestionsImmediate error:', error.message || error);
      throw error;
    }
  };

  const handleGenerateQuestionsStreaming = async () => {
    console.log("🔄 Starting STREAMING generation...");
    
    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }
    
    // Use domainDistribution from preview if available, otherwise calculate
    let categories = domainDistribution;
    if (Object.keys(categories).length === 0 && coreTestingAreas.trim()) {
      categories = calculateDomainDistribution(coreTestingAreas, numQuestions);
    }
    
    if (Object.keys(categories).length === 0) {
      toast.error("Please enter core testing areas to generate questions by domain");
      return;
    }
    
    console.log("🎯 Using domain distribution:", categories);
    await performStreamingGeneration(categories);
  };



  const handleGenerateQuestions = async () => {
    console.log("🔄 Starting REGULAR generation...");
    
    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }
    
    if (!coreTestingAreas.trim()) {
      toast.error("Please enter core testing areas");
      return;
    }
    
    // Calculate domain distribution and proceed directly
    const categories = calculateDomainDistribution(coreTestingAreas, numQuestions);
    await performRegularGeneration(categories);
  };



  const handleSaveExam = async () => {
    if (!examTitle.trim()) {
      toast.error("Please enter an exam title");
      return;
    }

    if (questions.length === 0) {
      toast.error("Please generate some questions first");
      return;
    }

    setIsSaving(true);
    try {
      const token = getToken();
      const examData = {
        title: examTitle,
        subject: subject,
        coreTestingAreas,
        academicYear,
        difficulty,
        questionLength,
        numQuestions,
        questions: questions,
        userId: session?.user?.id,
        update: loadedExamId ? true : false,
        examId: loadedExamId || undefined,
      };

      const response = await fetch("/api/exams", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(examData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save exam: ${errorText}`);
      }

      const result = await response.json();
      
      if (result.id && !loadedExamId) {
        setLoadedExamId(result.id);
      }

      toast.success(loadedExamId ? "Exam updated successfully!" : "Exam saved successfully!");
    } catch (error: any) {
      console.error("Save error:", error);
      toast.error(error.message || "Failed to save exam");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRemoveDuplicates = async () => {
    if (questions.length === 0) {
      toast.error("No questions to process");
      return;
    }

    setIsRemovingDuplicates(true);
    try {
      const context: DuplicationContext = {
        difficulty,
        questionLength: questionLength as "medium" | "short" | "long",
        numQuestions: numQuestions
      };

      const { unique: uniqueQuestions, duplicatesRemoved } = await removeDuplicates(
        questions,
        context
      );

      setQuestions(uniqueQuestions);
      
      // Auto-save after removing duplicates
      await handleAutoSave(uniqueQuestions);

      if (duplicatesRemoved > 0) {
        toast.success(`Removed ${duplicatesRemoved} duplicates. ${uniqueQuestions.length} questions remaining.`);
      } else {
        toast.info("No duplicate questions found!");
      }
    } catch (error: any) {
      console.error("Duplicate removal error:", error);
      toast.error(error.message || "Failed to remove duplicates");
    } finally {
      setIsRemovingDuplicates(false);
    }
  };

  // Auto-remove duplicates after generation (silent, no user toast)
  const autoRemoveDuplicatesAfterGeneration = async (generatedQuestions: any[]) => {
    if (generatedQuestions.length === 0) {
      return generatedQuestions;
    }

    try {
      const context: DuplicationContext = {
        difficulty,
        questionLength: questionLength as "medium" | "short" | "long",
        numQuestions: numQuestions
      };

      const { unique: uniqueQuestions, duplicatesRemoved } = await removeDuplicates(
        generatedQuestions,
        context
      );

      if (duplicatesRemoved > 0) {
        console.log(`🔄 Auto-removed ${duplicatesRemoved} duplicates. ${uniqueQuestions.length} questions remaining.`);
        setQuestions(uniqueQuestions);
        // Auto-save the cleaned questions
        await handleAutoSave(uniqueQuestions);
        return uniqueQuestions;
      } else {
        // No duplicates found, still update state with original questions
        setQuestions(generatedQuestions);
      }
      
      return generatedQuestions;
    } catch (error: any) {
      console.warn("Auto duplicate removal failed (non-critical):", error);
      return generatedQuestions;
    }
  };

  const handleExportPDF = async (version: "student" | "teacher") => {
    if (!questions.length) {
      toast.error("No questions to export");
      return;
    }

    setIsExporting(true);
    try {
      // First get the HTML content
      const htmlResponse = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: loadedExamId,
          version,
          examTitle: examTitle,
          includeAnswers: version === "teacher",
          subject: subject,
          coreTestingAreas,
          academicYear,
          scenarioFormat,
          domainDistribution: (() => {
            // Use actual question counts from dashboard UI instead of calculated distribution
            const actualCounts: {[key: string]: number} = {};
            questions.forEach(q => {
              const domain = (q as any).domain || 'General';
              actualCounts[domain] = (actualCounts[domain] || 0) + 1;
            });
            return Object.keys(actualCounts).length > 0 ? actualCounts : undefined;
          })(),
          domainBlueprints: Object.keys(perDomainProgress).length > 0 ? 
            Object.fromEntries(Object.entries(perDomainProgress)
              .filter(([_, info]) => info.blueprint && !info.blueprint.error)
              .map(([domain, info]) => [domain, info.blueprint])
            ) : undefined,
          questions: questions.map(q => ({
            id: q.id,
            questionText: q.questionText || q.question,
            questionType: q.questionType || 'multiple_choice',
            optionA: q.optionA || (q.options && q.options[0]),
            optionB: q.optionB || (q.options && q.options[1]), 
            optionC: q.optionC || (q.options && q.options[2]),
            optionD: q.optionD || (q.options && q.options[3]),
            correctAnswer: q.correctAnswer,
            rationale: q.rationale || q.explanation
          }))
        }),
      });

      if (!htmlResponse.ok) {
        throw new Error("Failed to generate HTML content");
      }

      const htmlContent = await htmlResponse.text();
      
      // Now generate the actual PDF using Puppeteer
      const pdfResponse = await fetch("/api/generate-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          htmlContent,
          examTitle,
          version
        })
      });

      if (!pdfResponse.ok) {
        throw new Error("Failed to generate PDF");
      }

      const blob = await pdfResponse.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `${examTitle}_${version}_version.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(`${version} version exported successfully!`);
    } catch (error: any) {
      console.error("Export error:", error);
      toast.error(error.message || "Failed to export PDF");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDirectPrint = async (version: "student" | "teacher" | "combined") => {
    if (!questions.length) {
      toast.error("No questions to print");
      return;
    }

    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: loadedExamId,
          version,
          examTitle: examTitle,
          includeAnswers: version === "teacher" || version === "combined",
          subject: subject,
          coreTestingAreas,
          academicYear,
          scenarioFormat,
          domainDistribution: (() => {
            // Use actual question counts from dashboard UI instead of calculated distribution
            const actualCounts: {[key: string]: number} = {};
            questions.forEach(q => {
              const domain = (q as any).domain || 'General';
              actualCounts[domain] = (actualCounts[domain] || 0) + 1;
            });
            return Object.keys(actualCounts).length > 0 ? actualCounts : undefined;
          })(),
          format: 'html', // Request HTML format
          questions: questions.map(q => ({
            id: q.id,
            questionText: q.questionText || q.question,
            questionType: q.questionType || 'multiple_choice',
            optionA: q.optionA || (q.options && q.options[0]),
            optionB: q.optionB || (q.options && q.options[1]), 
            optionC: q.optionC || (q.options && q.options[2]),
            optionD: q.optionD || (q.options && q.options[3]),
            correctAnswer: q.correctAnswer,
            rationale: q.rationale || q.explanation
          }))
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate exam for printing");
      }

      const htmlContent = await response.text();
      
      // Open HTML in new tab for printing
      const printWindow = window.open('', '_blank');
      
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        toast.success(`Exam opened in new tab for printing`);
      } else {
        toast.error("Popup blocked. Please allow popups for this site to print directly.");
      }
    } catch (error: any) {
      console.error("Print error:", error);
      toast.error("Failed to prepare file for printing");
    }
  };

  const handlePrint = async (version: "student" | "teacher" | "combined") => {
    if (!questions.length) {
      toast.error("No questions to print");
      return;
    }

    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          examId: loadedExamId,
          version,
          examTitle: examTitle,
          includeAnswers: version === "teacher" || version === "combined",
          subject: subject,
          coreTestingAreas,
          academicYear,
          scenarioFormat,
          domainDistribution: (() => {
            // Use actual question counts from dashboard UI instead of calculated distribution
            const actualCounts: {[key: string]: number} = {};
            questions.forEach(q => {
              const domain = (q as any).domain || 'General';
              actualCounts[domain] = (actualCounts[domain] || 0) + 1;
            });
            return Object.keys(actualCounts).length > 0 ? actualCounts : undefined;
          })(),
          format: 'html', // Request HTML format
          questions: questions.map(q => ({
            id: q.id,
            questionText: q.questionText || q.question,
            questionType: q.questionType || 'multiple_choice',
            optionA: q.optionA || (q.options && q.options[0]),
            optionB: q.optionB || (q.options && q.options[1]), 
            optionC: q.optionC || (q.options && q.options[2]),
            optionD: q.optionD || (q.options && q.options[3]),
            correctAnswer: q.correctAnswer,
            rationale: q.rationale || q.explanation
          }))
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate exam for printing");
      }

      const htmlContent = await response.text();
      
      // Open HTML in new tab
      const printWindow = window.open('', '_blank');
      
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        
        toast.success(`Exam opened in new tab for printing`);
      } else {
        toast.error("Popup blocked. Please allow popups for this site to print directly.");
      }
    } catch (error: any) {
      console.error("Print error:", error);
      toast.error(error.message || "Failed to print exam");
    }
  };

  if (isPending) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    router.push("/sign-in");
    return null;
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar>
          <SidebarContent>
            <div className="p-4 border-b">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                ExamForge
              </h2>
            </div>
            <SidebarGroup>
              <SidebarGroupLabel>Navigation</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <a href="/dashboard">
                        <Home className="h-4 w-4" />
                        <span>Dashboard</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                      <a href="/history">
                        <History className="h-4 w-4" />
                        <span>Exam History</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="mt-auto">
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={handleSignOut}>
                      <LogOut className="h-4 w-4" />
                      <span>Sign Out</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto bg-gradient-to-br from-background via-background to-muted/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 sm:mb-8 gap-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="hover:bg-accent/50 transition-colors" />
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  Welcome, {session.user?.name || session.user?.email}!
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">Create professional exams with AI</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-primary">
                {questions.length} Questions
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6 lg:gap-8 mb-6">
            <Card className="border-muted/40 shadow-lg hover:shadow-xl transition-shadow duration-300">
              <CardHeader className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FileUp className="h-5 w-5 text-primary" />
                  </div>
                  Exam Setup
                </CardTitle>
                <CardDescription className="text-sm">
                  Configure your exam parameters and upload source materials
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2.5">
                  <Label htmlFor="examTitle" className="text-sm font-semibold">Exam Title (Auto-Generated)</Label>
                  <Input
                    id="examTitle"
                    placeholder="Title will be auto-generated based on subject and core areas..."
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    disabled={isGenerating}
                    className="h-11 border-muted focus:border-primary/50 focus:ring-primary/20"
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <span className="text-base">🤖</span> AI will generate an eye-catching title automatically when you generate questions
                  </p>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="subject" className="text-sm font-semibold">Subject/University</Label>
                  <Input
                    id="subject"
                    placeholder="e.g., Harvard University Biology Department"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="h-11 border-muted focus:border-primary/50 focus:ring-primary/20"
                  />
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="academicYear" className="text-sm font-semibold">Academic Year</Label>
                  <Select value={academicYear} onValueChange={setAcademicYear}>
                    <SelectTrigger className="h-11 border-muted">
                      <SelectValue placeholder="Select academic year" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2024/2025">2024/2025</SelectItem>
                      <SelectItem value="2025/2026">2025/2026 (Current)</SelectItem>
                      <SelectItem value="2026/2027">2026/2027</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    📅 Select the academic year for your exam
                  </p>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="coreTestingAreas" className="text-sm font-semibold flex items-center justify-between">
                    <span>Core Testing Areas</span>
                    {Object.keys(domainDistribution).length > 0 && (
                      <span className="text-xs text-primary font-normal">
                        {Object.keys(domainDistribution).length} domains • {Object.values(domainDistribution).reduce((a, b) => a + b, 0)} questions
                      </span>
                    )}
                  </Label>
                  <Textarea
                    id="coreTestingAreas"
                    placeholder="Enter topics (AI will extract main topics and assign question counts):

Example formats:
• Cell Biology, Genetics, Molecular Biology
• Chapter 1: Introduction to Biology
• Unit 2: Genetics and heredity including DNA structure, mutations, and inheritance patterns
• Pathophysiology - cardiovascular, respiratory, and neurological systems

AI will automatically:
✓ Extract main domains from your input
✓ Assign question counts based on topic complexity
✓ Display as: Topic Name (Question Count)"
                    value={coreTestingAreas}
                    onChange={(e) => handleCoreAreasChange(e.target.value)}
                    rows={6}
                    className="max-h-48 overflow-y-auto resize-none border-muted focus:border-primary/50 focus:ring-primary/20 font-mono text-sm"
                  />
                  <div className="text-xs text-muted-foreground space-y-2">
                    <div className="flex items-start gap-2">
                      <span>🎯</span>
                      <div>
                        <p className="font-medium">Smart Distribution Rules:</p>
                        <ul className="mt-1 space-y-0.5 text-xs">
                          <li>• High complexity topics (pathophysiology, pharmacology): More questions</li>
                          <li>• Medium complexity topics (anatomy, physiology): Balanced questions</li>
                          <li>• Lower complexity topics (introduction, ethics): Fewer questions</li>
                          <li>• Random variation within reasonable ranges for natural distribution</li>
                        </ul>
                      </div>
                    </div>
                    {Object.keys(domainDistribution).length > 0 && (
                      <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-3 rounded-lg border border-blue-200">
                        <p className="font-medium mb-2 text-blue-900 flex items-center gap-2">
                          <span>📊</span> Question Distribution Preview:
                        </p>
                        <div className="grid grid-cols-1 gap-2">
                          {Object.entries(domainDistribution)
                            .sort(([,a], [,b]) => b - a)
                            .map(([domain, count], index) => (
                              <div key={domain} className="flex justify-between items-center p-2 bg-white/60 rounded border border-blue-200/50">
                                <span className="text-sm font-medium text-blue-900 truncate" title={domain}>
                                  #{index + 1} {domain}
                                </span>
                                <span className="text-sm font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded">
                                  {count} questions
                                </span>
                              </div>
                            ))}
                        </div>
                        <div className="mt-2 text-xs text-blue-700 bg-blue-100/50 p-2 rounded">
                          💡 Total: {Object.values(domainDistribution).reduce((a, b) => a + b, 0)} questions across {Object.keys(domainDistribution).length} domains
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
                  <div className="space-y-2.5">
                    <Label htmlFor="difficulty" className="text-sm font-semibold">Difficulty</Label>
                    <Select value={difficulty} onValueChange={setDifficulty}>
                      <SelectTrigger className="h-11 border-muted">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">Easy</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="hard">Hard</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2.5">
                    <Label htmlFor="questionLength" className="text-sm font-semibold">Question Length: <span className="text-primary">{questionLength === 'hybrid' ? 'Hybrid (Mixed Lengths)' : questionLength.charAt(0).toUpperCase() + questionLength.slice(1)}</span></Label>
                    <div className="space-y-3">
                      <div className="px-3 py-2 bg-muted/30 rounded-lg">
                        <Slider
                          id="questionLength"
                          min={0}
                          max={7}
                          step={1}
                          value={[{
                            'very-short': 0,
                            'short': 1, 
                            'short-medium': 2,
                            'medium': 3,
                            'medium-long': 4,
                            'long': 5,
                            'very-long': 6,
                            'hybrid': 7
                          }[questionLength] || 3]}
                          onValueChange={(value) => {
                            const lengthMap = ['very-short', 'short', 'short-medium', 'medium', 'medium-long', 'long', 'very-long', 'hybrid'];
                            setQuestionLength(lengthMap[value[0]]);
                          }}
                          className="w-full"
                        />
                        <div className="flex justify-between text-[10px] sm:text-xs text-muted-foreground mt-2 px-1">
                          <span className="hidden sm:inline">Very Short</span>
                          <span className="sm:hidden">VS</span>
                          <span className="hidden sm:inline">Short</span>
                          <span className="sm:hidden">S</span>
                          <span className="hidden sm:inline">Medium</span>
                          <span className="sm:hidden">M</span>
                          <span className="hidden sm:inline">Long</span>
                          <span className="sm:hidden">L</span>
                          <span className="hidden sm:inline">Very Long</span>
                          <span className="sm:hidden">VL</span>
                          <span className="hidden sm:inline">Hybrid</span>
                          <span className="sm:hidden">H</span>
                        </div>
                      </div>
                      
                      {/* Description for each length */}
                      <div className="text-xs text-muted-foreground bg-gradient-to-r from-muted/50 to-muted/30 p-3 rounded-lg border border-muted/40">
                        {questionLength === 'very-short' && '⚡ Very concise questions (20-30 words), minimal context'}
                        {questionLength === 'short' && '📝 Brief questions (30-50 words), straightforward scenarios'}
                        {questionLength === 'short-medium' && '📄 Moderate questions (50-75 words), some context'}
                        {questionLength === 'medium' && '📋 Balanced questions (75-100 words), adequate detail'}
                        {questionLength === 'medium-long' && '📖 Detailed questions (100-150 words), rich context'}
                        {questionLength === 'long' && '📚 Comprehensive questions (150-200 words), extensive scenarios'}
                        {questionLength === 'very-long' && '📑 Complex questions (200+ words), detailed case studies'}
                        {questionLength === 'hybrid' && '🎯 Mixed lengths - combines all question lengths for variety'}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <Label htmlFor="scenarioFormat" className="text-sm font-semibold">Question Format: <span className="text-primary">{scenarioFormat === 'scenario' ? 'Scenario-Based' : scenarioFormat === 'normal' ? 'Direct Knowledge' : scenarioFormat === 'source-based' ? 'Source-Based' : 'Mixed Format'}</span></Label>
                    <Select
                      value={scenarioFormat}
                      onValueChange={setScenarioFormat}
                    >
                      <SelectTrigger className="h-11 border-muted">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="scenario">📋 Scenario-Based - Case studies, realistic situations</SelectItem>
                        <SelectItem value="normal">📝 Direct Knowledge - Facts, definitions, concepts</SelectItem>
                        <SelectItem value="mixed">🎯 Mixed Format - Combination of both (Recommended)</SelectItem>
                        <SelectItem value="source-based">📚 Source-Based - Match format from source materials</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {/* Description for each format */}
                    <div className="text-xs text-muted-foreground bg-gradient-to-r from-muted/50 to-muted/30 p-3 rounded-lg border border-muted/40">
                      {scenarioFormat === 'scenario' && '📋 All questions will present realistic scenarios, case studies, and situations requiring analysis and application'}
                      {scenarioFormat === 'normal' && '📝 All questions will be direct knowledge-based without complex scenarios - focusing on facts, definitions, and concepts'}
                      {scenarioFormat === 'mixed' && '🎯 Realistic exam progression: Start with 40% direct knowledge (foundation), then 60% scenarios (application) - mimics real exam structure'}
                      {scenarioFormat === 'source-based' && '📚 Questions will match the format and style found in your source materials or additional context - AI will analyze and replicate the pattern'}
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="numQuestions" className="text-sm font-semibold flex items-center justify-between">
                    <span>Number of Questions</span>
                    <span className="text-primary font-bold text-lg">{numQuestions}</span>
                  </Label>
                  <div className="px-3 py-3 bg-muted/30 rounded-lg">
                    <Slider
                      id="numQuestions"
                      min={1}
                      max={200}
                      step={1}
                      value={[numQuestions]}
                      onValueChange={(value) => setNumQuestions(value[0])}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                      <span>1</span>
                      <span>50</span>
                      <span>100</span>
                      <span>150</span>
                      <span>200</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <Label htmlFor="selectedModel" className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    AI Model
                  </Label>
                  <Select
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                  >
                    <SelectTrigger className="h-11 border-muted">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="llama-3.1-8b-instant">Llama 3.1 8B Instant (Default)</SelectItem>
                      <SelectItem value="openai/gpt-oss-20b">GPT OSS 20B</SelectItem>
                      <SelectItem value="openai/gpt-oss-120b">GPT OSS 120B</SelectItem>
                      <SelectItem value="llama-3.3-70b-versatile">Llama 3.3 70B Versatile</SelectItem>
                      <SelectItem value="meta-llama/llama-4-maverick-17b-128e-instruct">Llama 4 Maverick 17B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Duplication Risk Alert */}
                {isHighDuplicationRisk(questionLength, difficulty, numQuestions, selectedModel) && (
                  <Alert className="border-orange-300/50 bg-gradient-to-r from-orange-50 to-orange-100/50 shadow-md">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                    <AlertDescription className="text-orange-900">
                      <strong className="text-sm font-bold">High Duplication Risk Detected!</strong>
                      <div className="mt-2 text-xs flex flex-wrap gap-1">
                        <span className="font-medium">Risk factors:</span>
                        {getRiskFactors(questionLength, difficulty, numQuestions, selectedModel).map((factor, i) => (
                          <span key={i} className="px-2 py-1 bg-orange-200/50 rounded-full">{factor}</span>
                        ))}
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  <Label>Question Types</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="multiple_choice"
                        checked={questionTypes.multiple_choice}
                        onCheckedChange={(checked) =>
                          setQuestionTypes({
                            ...questionTypes,
                            multiple_choice: checked as boolean,
                          })
                        }
                      />
                      <Label htmlFor="multiple_choice">Multiple Choice</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="true_false"
                        checked={questionTypes.true_false}
                        onCheckedChange={(checked) =>
                          setQuestionTypes({
                            ...questionTypes,
                            true_false: checked as boolean,
                          })
                        }
                      />
                      <Label htmlFor="true_false">True/False</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="short_answer"
                        checked={questionTypes.short_answer}
                        onCheckedChange={(checked) =>
                          setQuestionTypes({
                            ...questionTypes,
                            short_answer: checked as boolean,
                          })
                        }
                      />
                      <Label htmlFor="short_answer">Short Answer</Label>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="enableStreaming"
                      checked={enableStreaming}
                      onCheckedChange={(checked) => setEnableStreaming(checked as boolean)}
                    />
                    <Label htmlFor="enableStreaming">Enable Real-time Generation</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    See questions generate in real-time (recommended for large question sets)
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileUp className="h-5 w-5" />
                  Source Materials
                </CardTitle>
                <CardDescription>
                  Upload PDFs, documents, or enter context manually
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FileDropzoneWithList
                  files={sourceFiles}
                  onFilesChange={(files) => {
                    const event = { target: { files } } as any;
                    handleFileUpload(event);
                  }}
                  onRemoveFile={handleRemoveFile}
                  isProcessing={isProcessingFiles}
                />

                <div className="space-y-2">
                  <Label htmlFor="context">Additional Context</Label>
                  <Textarea
                    id="context"
                    placeholder="Enter additional context, study materials, or specific topics to focus on..."
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    rows={6}
                    className="min-h-[120px] max-h-48 overflow-y-auto resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {context.length.toLocaleString()} characters
                    {context.length > 500000 && " (Large context may slow generation)"}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={enableStreaming ? handleGenerateQuestionsStreaming : handleGenerateQuestions}
                    disabled={isGenerating || !subject.trim()}
                    className="flex-1"
                    size="lg"
                  >
                    {isGenerating ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                        {isStopping ? "Stopping..." : isStreaming ? "Generating..." : "Processing..."}
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Generate Questions
                      </>
                    )}
                  </Button>
                  
                  {isGenerating && !isStopping && (
                    <Button
                      onClick={handleStopGeneration}
                      variant="destructive"
                      size="lg"
                      disabled={isStopping}
                    >
                      <X className="h-4 w-4 mr-2" />
                      Stop
                    </Button>
                  )}
                </div>

                {/* Generation Progress */}
                {(isGenerating || isStreaming) && (
                  <div className="space-y-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex justify-between text-sm font-medium">
                      <span className={isStopping ? "text-red-800" : "text-blue-800"}>
                        {isStopping ? "Stopping and saving progress..." : isStreaming ? streamingStatus : "Generating questions..."}
                      </span>
                      <span className={isStopping ? "text-red-600" : "text-blue-600"}>
                        {isStreaming ? `${questionsGenerated}/${numQuestions}` : "Processing..."}
                      </span>
                    </div>
                    <div className={`w-full rounded-full h-3 ${isStopping ? 'bg-red-200' : 'bg-blue-200'}`}>
                      <div
                        className={`h-3 rounded-full transition-all duration-500 ease-out ${
                          isStopping ? 'bg-red-600' : 'bg-blue-600'
                        }`}
                        style={{ 
                          width: isStreaming 
                            ? `${Math.min(streamingProgress, 100)}%` 
                            : "50%"
                        }}
                      ></div>
                    </div>
                    {isStreaming && (
                      <div className="text-xs text-blue-700">
                        Progress: {Math.round(streamingProgress)}% • Questions: {questionsGenerated}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Per-domain progress and blueprint summary */}
          {Object.keys(perDomainProgress).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" />
                  Generation Progress by Domain
                </CardTitle>
                <CardDescription className="text-sm">Live progress and blueprint summary for each domain</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(perDomainProgress).map(([d, info]) => {
                  const isCompleted = info.generated === info.target && info.generated > 0;
                  const isProcessing = info.generated === 0 && info.target > 0 && isGenerating;
                  const hasFailed = info.blueprint?.error;
                  
                  return (
                    <div key={d} className={`p-3 rounded-lg border transition-all ${
                      isCompleted ? 'bg-green-50 border-green-200' :
                      isProcessing ? 'bg-blue-50 border-blue-200 animate-pulse' :
                      hasFailed ? 'bg-red-50 border-red-200' :
                      'bg-white border-muted/30'
                    }`}>
                      <div className="flex justify-between items-center mb-2">
                        <div className="font-medium text-sm flex items-center gap-2">
                          {isCompleted && <span className="text-green-600">✅</span>}
                          {isProcessing && <span className="text-blue-600 animate-spin">⭕</span>}
                          {hasFailed && <span className="text-red-600">❌</span>}
                          <span className="truncate">{d}</span>
                        </div>
                        <div className={`text-xs font-medium ${
                          isCompleted ? 'text-green-700' :
                          isProcessing ? 'text-blue-700' :
                          hasFailed ? 'text-red-700' :
                          'text-muted-foreground'
                        }`}>
                          {info.generated}/{info.target}
                          {isProcessing && ' (generating...)'}
                        </div>
                      </div>
                      <div className="w-full bg-muted/20 rounded-full h-2 mb-2">
                        <div className={`h-2 rounded-full transition-all duration-500 ${
                          isCompleted ? 'bg-green-600' :
                          isProcessing ? 'bg-blue-600' :
                          hasFailed ? 'bg-red-600' :
                          'bg-primary'
                        }`} style={{ 
                          width: `${Math.min(100, Math.round((info.generated / Math.max(1, info.target)) * 100))}%` 
                        }} />
                      </div>
                      {info.blueprint && !info.blueprint.error && (
                        <div className="text-xs text-muted-foreground bg-muted/10 p-2 rounded">
                          <div className="font-medium text-muted-foreground">Blueprint Generated:</div>
                          <div className="text-[11px] mt-1">
                            <strong>Core Concepts:</strong> {(info.blueprint.coreConcepts || []).slice(0,4).join(', ')}
                            {info.blueprint.keywords && info.blueprint.keywords.length > 0 && (
                              <><br/><strong>Keywords:</strong> {(info.blueprint.keywords || []).slice(0,4).join(', ')}</>
                            )}
                          </div>
                        </div>
                      )}
                      {hasFailed && (
                        <div className="text-xs text-red-600 bg-red-50 p-2 rounded">
                          <strong>Error:</strong> {info.blueprint.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Generated Questions ({questions.length})
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleSaveExam}
                  disabled={isSaving || questions.length === 0}
                  variant="secondary"
                  size="sm"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {isSaving ? "Saving..." : loadedExamId ? "Update Exam" : "Save Exam"}
                </Button>

                <Button
                  onClick={handleRemoveDuplicates}
                  disabled={isRemovingDuplicates || questions.length === 0}
                  variant="secondary"
                  size="sm"
                >
                  <FilterX className="h-4 w-4 mr-2" />
                  {isRemovingDuplicates ? "Processing..." : "Remove Duplicates"}
                </Button>

                <div className="flex gap-2">
                  <Button
                    onClick={() => handleExportPDF("student")}
                    disabled={isExporting || questions.length === 0}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Student PDF
                  </Button>

                  <Button
                    onClick={() => handleExportPDF("teacher")}
                    disabled={isExporting || questions.length === 0}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export Teacher PDF
                  </Button>
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => handlePrint("student")}
                    variant="default"
                    size="sm"
                    disabled={questions.length === 0}
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Student
                  </Button>

                  <Button
                    onClick={() => handlePrint("teacher")}
                    variant="default"
                    size="sm"
                    disabled={questions.length === 0}
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Teacher
                  </Button>

                  <Button
                    onClick={() => handlePrint("combined")}
                    variant="default"
                    size="sm"
                    className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                    disabled={questions.length === 0}
                  >
                    <Printer className="h-4 w-4 mr-1" />
                    Print Teacher and Student
                  </Button>
                </div>
                
                <div className="flex gap-1 mt-2">
                  <Button
                    onClick={() => handleDirectPrint("student")}
                    variant="ghost"
                    size="sm"
                    disabled={questions.length === 0}
                    className="text-xs h-7 px-2"
                  >
                    📱 Download Student PDF
                  </Button>
                  <Button
                    onClick={() => handleDirectPrint("teacher")}
                    variant="ghost"
                    size="sm"
                    disabled={questions.length === 0}
                    className="text-xs h-7 px-2"
                  >
                    📱 Download Teacher PDF
                  </Button>
                </div>
                
                <p className="text-xs text-muted-foreground mt-1">
                  💡 Print buttons open PDF in new tab with automatic print dialog. Enable popups for best experience.
                </p>
              </div>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {/* Questions count display */}
              {questions.length > 0 && (
                <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-green-800 font-medium">
                    ✓ Generated {questions.length} questions successfully
                  </p>
                </div>
              )}
              
              <QuestionTable
                questions={questions}
                onQuestionsChange={setQuestions}
              />
            </CardContent>
          </Card>
        </main>
      </div>
      <FeedbackPopup
        isOpen={feedbackPopup.isOpen}
        onClose={() => setFeedbackPopup(prev => ({ ...prev, isOpen: false }))}
        success={feedbackPopup.success}
        title={feedbackPopup.title}
        message={feedbackPopup.message}
        questionsGenerated={feedbackPopup.questionsGenerated}
      />
      

      
      <Toaster />
    </SidebarProvider>
  );
}