"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
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
  Sparkles,
  Download,
  Trash2,
  Eye,
  Calendar,
  BookOpen,
  Target,
  MoreVertical,
  Grid3X3,
  List,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { authClient } from "@/lib/auth-client";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Exam {
  id: number;
  title: string;
  subject: string;
  coreTestingAreas?: string;
  difficulty: string;
  numQuestions: number;
  createdAt: string;
  questionCount: number;
}

export default function HistoryPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [exams, setExams] = useState<Exam[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteExamId, setDeleteExamId] = useState<number | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Pagination calculations
  const totalPages = Math.ceil(exams.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentExams = exams.slice(startIndex, endIndex);

  // Generate page numbers for pagination
  const generatePageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisiblePages = 5;
    
    if (totalPages <= maxVisiblePages) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) {
          pages.push(i);
        }
        if (totalPages > 5) pages.push("...");
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        if (totalPages > 5) pages.push("...");
        for (let i = totalPages - 3; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push(1);
        pages.push("...");
        for (let i = currentPage - 1; i <= currentPage + 1; i++) {
          pages.push(i);
        }
        pages.push("...");
        pages.push(totalPages);
      }
    }
    return pages;
  };

  const handleSignOut = async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;
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

  const fetchExams = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;
      const response = await fetch("/api/exams", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch exams");
      }

      setExams(data.exams);
    } catch (error: any) {
      toast.error(error.message || "Failed to load exam history");
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewExam = async (examId: number) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;
      const response = await fetch(`/api/exams/${examId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch exam");
      }

      console.log("Fetched exam data:", data);
      console.log(
        "Questions in fetched exam:",
        data.exam?.questions?.length || 0
      );

      // Store exam data in sessionStorage and redirect to dashboard
      if (typeof window !== 'undefined') {
        sessionStorage.setItem("loadedExam", JSON.stringify(data.exam));
      }
      router.push("/dashboard");
    } catch (error: any) {
      console.error("Error fetching exam:", error);
      toast.error(error.message || "Failed to load exam");
    }
  };

  const handleDeleteExam = async () => {
    if (!deleteExamId) return;

    setIsDeleting(true);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;
      const response = await fetch(`/api/exams/${deleteExamId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to delete exam");
      }

      toast.success("Exam deleted successfully");
      const updatedExams = exams.filter((exam) => exam.id !== deleteExamId);
      setExams(updatedExams);
      
      // Reset to page 1 if current page would be empty after deletion
      const newTotalPages = Math.ceil(updatedExams.length / itemsPerPage);
      if (currentPage > newTotalPages && newTotalPages > 0) {
        setCurrentPage(newTotalPages);
      } else if (updatedExams.length === 0) {
        setCurrentPage(1);
      }
      
      setDeleteExamId(null);
    } catch (error: any) {
      toast.error(error.message || "Failed to delete exam");
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExportPDF = async (
    exam: Exam,
    version: "student" | "teacher"
  ) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem("bearer_token") : null;

      // Fetch full exam with questions
      const examResponse = await fetch(`/api/exams/${exam.id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const examData = await examResponse.json();

      if (!examResponse.ok) {
        throw new Error(examData.error || "Failed to fetch exam");
      }

      // Export PDF
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          examId: exam.id, // Include examId to use cached PDF metadata
          examTitle: exam.title,
          subject: exam.subject,
          coreTestingAreas: exam.coreTestingAreas || '',
          difficulty: exam.difficulty,
          questions: examData.exam.questions,
          version,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to export PDF");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exam.title.replace(/[^a-z0-9]/gi, "_")}_${version}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(
        `${version === "student" ? "Student" : "Teacher"} PDF exported successfully`
      );
    } catch (error: any) {
      toast.error(error.message || "Failed to export PDF");
    }
  };

  useEffect(() => {
    if (!isPending && session?.user) {
      fetchExams();
    }
  }, [session, isPending]);

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  const getDifficultyBadge = (difficulty: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive"> = {
      easy: "secondary",
      medium: "default",
      hard: "destructive",
    };
    return (
      <Badge variant={variants[difficulty] || "default"}>
        {difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}
      </Badge>
    );
  };

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

        <main className="flex-1 overflow-hidden">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex-shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 lg:p-6">
                <div className="flex items-center gap-4">
                  <SidebarTrigger className="lg:hidden" />
                  <div>
                    <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Exam History</h1>
                    <p className="text-sm text-muted-foreground">
                      {exams.length} exam{exams.length !== 1 ? "s" : ""} generated
                    </p>
                  </div>
                </div>
                
                {/* View Toggle - Only show when there are exams */}
                {exams.length > 0 && (
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border p-1">
                      <Button
                        variant={viewMode === "grid" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("grid")}
                        className="h-8 px-3"
                      >
                        <Grid3X3 className="h-4 w-4" />
                        <span className="sr-only">Grid view</span>
                      </Button>
                      <Button
                        variant={viewMode === "list" ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setViewMode("list")}
                        className="h-8 px-3"
                      >
                        <List className="h-4 w-4" />
                        <span className="sr-only">List view</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 lg:p-6">
              {isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">Loading exams...</p>
                  </div>
                </div>
              ) : exams.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center max-w-md">
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                      <History className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <h3 className="text-xl font-semibold mb-2">No exams yet</h3>
                    <p className="text-muted-foreground mb-6">
                      Generate your first exam to get started on your learning journey
                    </p>
                    <Button onClick={() => router.push("/dashboard")} size="lg">
                      <Sparkles className="h-4 w-4 mr-2" />
                      Create Your First Exam
                    </Button>
                  </div>
                </div>
              ) : viewMode === "grid" ? (
                <div className="space-y-6">
                  <div className="grid gap-4 md:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4">
                    {currentExams.map((exam) => (
                      <Card key={exam.id} className="group hover:shadow-md transition-all duration-200 border-2 hover:border-primary/20 flex flex-col">
                        <CardHeader className="pb-3 flex-shrink-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <CardTitle className="text-base font-semibold line-clamp-2 leading-tight" title={exam.title}>
                                {exam.title}
                              </CardTitle>
                              <CardDescription className="flex items-center gap-2 mt-1">
                                <BookOpen className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate text-xs">{exam.subject}</span>
                              </CardDescription>
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <MoreVertical className="h-4 w-4" />
                                  <span className="sr-only">Actions</span>
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleViewExam(exam.id)}>
                                  <Eye className="h-4 w-4 mr-2" />
                                  View Exam
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => handleExportPDF(exam, "student")}>
                                  <Download className="h-4 w-4 mr-2" />
                                  Export Student Version
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleExportPDF(exam, "teacher")}>
                                  <Download className="h-4 w-4 mr-2 text-green-600" />
                                  Export Teacher Version
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem 
                                  onClick={() => setDeleteExamId(exam.id)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete Exam
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0 flex-1 flex flex-col">
                          <div className="space-y-3 flex-1">
                            <div className="flex items-center justify-between">
                              {getDifficultyBadge(exam.difficulty)}
                              <div className="flex items-center text-sm text-muted-foreground">
                                <Target className="h-3 w-3 mr-1" />
                                <span className="text-xs">{exam.questionCount}</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center text-sm text-muted-foreground">
                              <Calendar className="h-3 w-3 mr-1 flex-shrink-0" />
                              <span className="truncate text-xs">
                                {new Date(exam.createdAt).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: '2-digit'
                                })}
                              </span>
                            </div>
                          </div>

                          <div className="flex gap-1 pt-3 mt-auto">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleViewExam(exam.id)}
                              className="flex-1 text-xs"
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleExportPDF(exam, "student")}
                              className="flex-1 text-xs"
                            >
                              <Download className="h-3 w-3 mr-1" />
                              Export
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>

                  {/* Pagination for Grid View */}
                  {totalPages > 1 && (
                    <div className="flex justify-center">
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious 
                              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                              className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                          </PaginationItem>
                          
                          {generatePageNumbers().map((page, index) => (
                            <PaginationItem key={index}>
                              {page === "..." ? (
                                <PaginationEllipsis />
                              ) : (
                                <PaginationLink
                                  onClick={() => setCurrentPage(page as number)}
                                  isActive={currentPage === page}
                                  className="cursor-pointer"
                                >
                                  {page}
                                </PaginationLink>
                              )}
                            </PaginationItem>
                          ))}
                          
                          <PaginationItem>
                            <PaginationNext 
                              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                              className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-6">
                  <Card>
                    <div className="overflow-hidden">
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="min-w-[200px]">Title</TableHead>
                              <TableHead className="min-w-[120px]">Subject</TableHead>
                              <TableHead className="min-w-[100px]">Difficulty</TableHead>
                              <TableHead className="w-[80px] text-center">Questions</TableHead>
                              <TableHead className="min-w-[100px]">Date</TableHead>
                              <TableHead className="w-[60px] text-right">Actions</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {currentExams.map((exam) => (
                              <TableRow key={exam.id} className="hover:bg-muted/50">
                                <TableCell className="font-medium">
                                  <div className="truncate max-w-[200px]" title={exam.title}>
                                    {exam.title}
                                  </div>
                                </TableCell>
                                <TableCell>
                                  <div className="truncate max-w-[120px]" title={exam.subject}>
                                    {exam.subject}
                                  </div>
                                </TableCell>
                                <TableCell>{getDifficultyBadge(exam.difficulty)}</TableCell>
                                <TableCell className="text-center">{exam.questionCount}</TableCell>
                                <TableCell className="text-sm">
                                  {new Date(exam.createdAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: '2-digit'
                                  })}
                                </TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end">
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-8 w-8">
                                          <MoreVertical className="h-4 w-4" />
                                          <span className="sr-only">Actions</span>
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem onClick={() => handleViewExam(exam.id)}>
                                          <Eye className="h-4 w-4 mr-2" />
                                          View Exam
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handleExportPDF(exam, "student")}>
                                          <Download className="h-4 w-4 mr-2" />
                                          Export Student Version
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExportPDF(exam, "teacher")}>
                                          <Download className="h-4 w-4 mr-2 text-green-600" />
                                          Export Teacher Version
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem 
                                          onClick={() => setDeleteExamId(exam.id)}
                                          className="text-destructive focus:text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          Delete Exam
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </Card>

                  {/* Pagination for List View */}
                  {totalPages > 1 && (
                    <div className="flex justify-center">
                      <Pagination>
                        <PaginationContent>
                          <PaginationItem>
                            <PaginationPrevious 
                              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                              className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                          </PaginationItem>
                          
                          {generatePageNumbers().map((page, index) => (
                            <PaginationItem key={index}>
                              {page === "..." ? (
                                <PaginationEllipsis />
                              ) : (
                                <PaginationLink
                                  onClick={() => setCurrentPage(page as number)}
                                  isActive={currentPage === page}
                                  className="cursor-pointer"
                                >
                                  {page}
                                </PaginationLink>
                              )}
                            </PaginationItem>
                          ))}
                          
                          <PaginationItem>
                            <PaginationNext 
                              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                              className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                            />
                          </PaginationItem>
                        </PaginationContent>
                      </Pagination>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteExamId !== null}
        onOpenChange={() => setDeleteExamId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              exam and all its questions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteExam}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster />
    </SidebarProvider>
  );
}
