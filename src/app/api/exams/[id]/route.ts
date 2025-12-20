import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { exams, questions } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check authentication - use request.headers to support Bearer tokens
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch exam
    const [exam] = await db
      .select()
      .from(exams)
      .where(
        and(eq(exams.id, parseInt(id)), eq(exams.userId, session.user.id))
      );

    if (!exam) {
      return NextResponse.json({ error: "Exam not found" }, { status: 404 });
    }

    // Fetch questions with proper ordering
    const examQuestions = await db
      .select()
      .from(questions)
      .where(eq(questions.examId, exam.id))
      .orderBy(asc(questions.orderIndex));

    console.log(
      `Fetching exam ${exam.id}: Found ${examQuestions.length} questions`
    );
    console.log(
      "Questions:",
      examQuestions.map((q) => ({
        id: q.id,
        text: q.questionText.substring(0, 50) + "...",
      }))
    );

    return NextResponse.json({
      success: true,
      exam: {
        ...exam,
        questions: examQuestions,
      },
    });
  } catch (error: any) {
    console.error("Error fetching exam:", error);
    return NextResponse.json(
      { error: "Failed to fetch exam", details: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check authentication - use request.headers to support Bearer tokens
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Delete questions first (foreign key constraint)
    await db.delete(questions).where(eq(questions.examId, parseInt(id)));

    // Delete exam
    await db
      .delete(exams)
      .where(
        and(eq(exams.id, parseInt(id)), eq(exams.userId, session.user.id))
      );

    return NextResponse.json({
      success: true,
      message: "Exam deleted successfully",
    });
  } catch (error: any) {
    console.error("Error deleting exam:", error);
    return NextResponse.json(
      { error: "Failed to delete exam", details: error.message },
      { status: 500 }
    );
  }
}
