"use client";

import React, { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Question {
  id?: number;
  examId?: number;
  questionText: string;
  questionType: string;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  correctAnswer: string;
  rationale?: string | null;
  points: number;
  orderIndex: number;
}

interface QuestionTableProps {
  questions: Question[];
  onQuestionsChange: (questions: Question[]) => void;
}

export default function QuestionTable({
  questions,
  onQuestionsChange,
}: QuestionTableProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editedQuestion, setEditedQuestion] = useState<Question | null>(null);

  const handleEdit = (index: number) => {
    setEditingIndex(index);
    setEditedQuestion({ ...questions[index] });
  };

  const handleSave = () => {
    if (editingIndex !== null && editedQuestion) {
      const updatedQuestions = [...questions];
      updatedQuestions[editingIndex] = editedQuestion;
      onQuestionsChange(updatedQuestions);
      setEditingIndex(null);
      setEditedQuestion(null);
    }
  };

  const handleCancel = () => {
    setEditingIndex(null);
    setEditedQuestion(null);
  };

  const handleDelete = (index: number) => {
    const updatedQuestions = questions.filter((_, i) => i !== index);
    // Update orderIndex for remaining questions
    updatedQuestions.forEach((q, i) => {
      q.orderIndex = i;
    });
    onQuestionsChange(updatedQuestions);
  };

  const getQuestionTypeBadge = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "outline"> = {
      multiple_choice: "default",
      true_false: "secondary",
      short_answer: "outline",
    };
    const labels: Record<string, string> = {
      multiple_choice: "Multiple Choice",
      true_false: "True/False",
      short_answer: "Short Answer",
    };
    return (
      <Badge variant={variants[type] || "default"}>
        {labels[type] || type}
      </Badge>
    );
  };

  console.log("QuestionTable received questions:", questions);
  console.log("QuestionTable questions length:", questions.length);
  console.log("About to map questions:", questions);

  // Debug rendering
  if (!questions) {
    console.log("Questions is null or undefined");
  } else if (questions.length === 0) {
    console.log("Questions array is empty");
  } else {
    console.log("Questions array has items, first question:", questions[0]);
    console.log("First question keys:", Object.keys(questions[0] || {}));
  }

  // Group questions by domain for rendering
  const groupedQuestions: Record<string, any[]> = {};
  if (Array.isArray(questions)) {
    for (const q of questions) {
      const d = (q as any).domain || 'General';
      if (!groupedQuestions[d]) groupedQuestions[d] = [];
      groupedQuestions[d].push(q);
    }
  }

  return (
    <>
      {/* Debug section */}
      <div className="mb-4 p-4 bg-yellow-100 border border-yellow-300 rounded">
        <h4 className="font-bold text-yellow-800">Debug Info:</h4>
        <p>Questions received: {questions ? 'YES' : 'NO'}</p>
        <p>Questions length: {questions?.length || 0}</p>
        <p>Questions type: {Array.isArray(questions) ? 'Array' : typeof questions}</p>
        {questions && questions.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-yellow-800">First question data:</summary>
            <pre className="text-xs bg-white p-2 rounded mt-1 overflow-auto max-h-40">
              {JSON.stringify(questions[0], null, 2)}
            </pre>
          </details>
        )}
      </div>
      
      <div className="w-full overflow-x-auto">
        <div className="rounded-md border min-w-[800px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="min-w-[400px]">Question</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-24">Points</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions && questions.length > 0 ? (
                (() => {
                  let cumulativeIndex = 0;
                  return Object.keys(groupedQuestions).flatMap((domain, di) => {
                    const qs = groupedQuestions[domain];
                    const startIndex = cumulativeIndex;
                    cumulativeIndex += qs.length;
                    return [
                      <TableRow key={`domain-${domain}`}>
                        <TableCell colSpan={5} className="bg-gray-100">
                          <div className="flex items-center justify-between">
                            <div className="font-semibold">{domain} ({qs.length} Questions)</div>
                            <div className="text-sm text-muted-foreground">Domain</div>
                          </div>
                        </TableCell>
                      </TableRow>,
                      ...qs.map((question: any, idx: number) => (
                        <TableRow key={question.id || `${domain}-${idx}`}>
                          <TableCell className="font-medium">{startIndex + idx + 1}</TableCell>
                          <TableCell className="max-w-0">
                            <div className="space-y-1">
                              <p className="font-medium break-words">{question.questionText}</p>
                              {question.questionType === "multiple_choice" && (
                                <div className="text-sm text-muted-foreground space-y-0.5 mt-2">
                                  {question.optionA && <div className="break-words">A) {question.optionA}</div>}
                                  {question.optionB && <div className="break-words">B) {question.optionB}</div>}
                                  {question.optionC && <div className="break-words">C) {question.optionC}</div>}
                                  {question.optionD && <div className="break-words">D) {question.optionD}</div>}
                                  {!question.optionA && !question.optionB && !question.optionC && !question.optionD && (
                                    <div className="text-blue-600 italic">(This appears to be a True/False or Short Answer question formatted as Multiple Choice)</div>
                                  )}
                                  <div className="text-green-600 font-medium mt-1 break-words">✓ Correct: {question.correctAnswer}</div>
                                </div>
                              )}
                              {question.questionType === "true_false" && (
                                <div className="text-sm text-muted-foreground mt-2">
                                  <div className="text-green-600 font-medium break-words">✓ Correct: {question.correctAnswer}</div>
                                </div>
                              )}
                              {question.questionType === "short_answer" && (
                                <div className="text-sm text-muted-foreground mt-2">
                                  <div className="text-green-600 font-medium break-words">✓ Answer: {question.correctAnswer}</div>
                                </div>
                              )}
                              {question.rationale && (
                                <div className="mt-3 p-3 bg-muted/50 rounded-md border border-border">
                                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Rationale</p>
                                  <p className="text-sm text-foreground/90 italic break-words">{question.rationale}</p>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{getQuestionTypeBadge(question.questionType)}</TableCell>
                          <TableCell>{question.points}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(startIndex + idx)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(startIndex + idx)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    ];
                  });
                })()
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No questions generated yet. Use the "Generate Questions" button to create your exam.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog
        open={editingIndex !== null}
        onOpenChange={(open) => !open && handleCancel()}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
            <DialogDescription>
              Make changes to the question below.
            </DialogDescription>
          </DialogHeader>
          {editedQuestion && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-question">Question Text</Label>
                <Textarea
                  id="edit-question"
                  value={editedQuestion.questionText}
                  onChange={(e) =>
                    setEditedQuestion({
                      ...editedQuestion,
                      questionText: e.target.value,
                    })
                  }
                  rows={3}
                  className="overflow-y-auto"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-type">Question Type</Label>
                <Select
                  value={editedQuestion.questionType}
                  onValueChange={(value) =>
                    setEditedQuestion({
                      ...editedQuestion,
                      questionType: value,
                    })
                  }
                >
                  <SelectTrigger id="edit-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">
                      Multiple Choice
                    </SelectItem>
                    <SelectItem value="true_false">True/False</SelectItem>
                    <SelectItem value="short_answer">Short Answer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {editedQuestion.questionType === "multiple_choice" && (
                <div className="space-y-3">
                  <Label>Options</Label>
                  <div className="space-y-2">
                    <Input
                      placeholder="Option A"
                      value={editedQuestion.optionA || ""}
                      onChange={(e) =>
                        setEditedQuestion({
                          ...editedQuestion,
                          optionA: e.target.value,
                        })
                      }
                    />
                    <Input
                      placeholder="Option B"
                      value={editedQuestion.optionB || ""}
                      onChange={(e) =>
                        setEditedQuestion({
                          ...editedQuestion,
                          optionB: e.target.value,
                        })
                      }
                    />
                    <Input
                      placeholder="Option C"
                      value={editedQuestion.optionC || ""}
                      onChange={(e) =>
                        setEditedQuestion({
                          ...editedQuestion,
                          optionC: e.target.value,
                        })
                      }
                    />
                    <Input
                      placeholder="Option D"
                      value={editedQuestion.optionD || ""}
                      onChange={(e) =>
                        setEditedQuestion({
                          ...editedQuestion,
                          optionD: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {editedQuestion.questionType === "true_false" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-tf-answer">Correct Answer</Label>
                  <Select
                    value={editedQuestion.correctAnswer}
                    onValueChange={(value) =>
                      setEditedQuestion({
                        ...editedQuestion,
                        correctAnswer: value,
                      })
                    }
                  >
                    <SelectTrigger id="edit-tf-answer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="True">True</SelectItem>
                      <SelectItem value="False">False</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="edit-answer">Correct Answer</Label>
                {editedQuestion.questionType === "multiple_choice" ? (
                  <Select
                    value={editedQuestion.correctAnswer}
                    onValueChange={(value) =>
                      setEditedQuestion({
                        ...editedQuestion,
                        correctAnswer: value,
                      })
                    }
                  >
                    <SelectTrigger id="edit-answer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={editedQuestion.optionA || "option-a"}>
                        {editedQuestion.optionA || "Option A"}
                      </SelectItem>
                      <SelectItem value={editedQuestion.optionB || "option-b"}>
                        {editedQuestion.optionB || "Option B"}
                      </SelectItem>
                      <SelectItem value={editedQuestion.optionC || "option-c"}>
                        {editedQuestion.optionC || "Option C"}
                      </SelectItem>
                      <SelectItem value={editedQuestion.optionD || "option-d"}>
                        {editedQuestion.optionD || "Option D"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : editedQuestion.questionType !== "true_false" ? (
                  <Input
                    id="edit-answer"
                    value={editedQuestion.correctAnswer}
                    onChange={(e) =>
                      setEditedQuestion({
                        ...editedQuestion,
                        correctAnswer: e.target.value,
                      })
                    }
                  />
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-rationale">Rationale (Optional)</Label>
                <Textarea
                  id="edit-rationale"
                  placeholder="Explain why this is the correct answer (2 sentences recommended)"
                  value={editedQuestion.rationale || ""}
                  onChange={(e) =>
                    setEditedQuestion({
                      ...editedQuestion,
                      rationale: e.target.value,
                    })
                  }
                  rows={3}
                  className="overflow-y-auto"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-points">Points</Label>
                <Input
                  id="edit-points"
                  type="number"
                  min="1"
                  max="10"
                  value={editedQuestion.points}
                  onChange={(e) =>
                    setEditedQuestion({
                      ...editedQuestion,
                      points: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button onClick={handleSave}>
              <Check className="h-4 w-4 mr-2" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
