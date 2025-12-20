import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams, questions } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    // Check authentication - use request.headers to support Bearer tokens
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's exams
    const userExams = await db
      .select()
      .from(exams)
      .where(eq(exams.userId, session.user.id))
      .orderBy(desc(exams.createdAt));

    // Fetch question counts for each exam
    const examsWithCounts = await Promise.all(
      userExams.map(async (exam) => {
        const examQuestions = await db
          .select()
          .from(questions)
          .where(eq(questions.examId, exam.id));

        return {
          ...exam,
          questionCount: examQuestions.length,
        };
      })
    );

    return NextResponse.json({
      success: true,
      exams: examsWithCounts,
    });
  } catch (error: any) {
    console.error('Error fetching exams:', error);
    return NextResponse.json(
      { error: 'Failed to fetch exams', details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication - use request.headers to support Bearer tokens
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      title, 
      subject, 
      coreTestingAreas, 
      difficulty, 
      questionLength, 
      scenarioFormat, 
      numQuestions, 
      questions: examQuestions,
      // PDF metadata fields
      subtitle,
      examOverview,
      examFeatures,
      coreTestingAreasFormatted,
      domainsMetadata
    } = body;

    // Validate input
    if (!title || !subject || !difficulty || !numQuestions) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Create exam
    const [newExam] = await db
      .insert(exams)
      .values({
        userId: session.user.id,
        title,
        subject,
        coreTestingAreas: coreTestingAreas || '',
        difficulty,
        questionLength: questionLength || 'medium',
        scenarioFormat: scenarioFormat || 'mixed',
        numQuestions,
        createdAt: new Date().toISOString(),
        // PDF metadata fields
        subtitle: subtitle || null,
        examOverview: examOverview || null,
        examFeatures: examFeatures || null,
        coreTestingAreasFormatted: coreTestingAreasFormatted || null,
        domainsMetadata: domainsMetadata || null,
      })
      .returning();

    // Insert questions if provided
    if (examQuestions && Array.isArray(examQuestions) && examQuestions.length > 0) {
      const questionsToInsert = examQuestions.map((q, index) => ({
        examId: newExam.id,
        questionText: q.questionText,
        questionType: q.questionType,
        correctAnswer: q.correctAnswer,
        optionA: q.optionA || null,
        optionB: q.optionB || null,
        optionC: q.optionC || null,
        optionD: q.optionD || null,
        points: q.points || 1,
        rationale: q.rationale || null,
        orderIndex: index,
      }));

      await db.insert(questions).values(questionsToInsert);
    }

    return NextResponse.json({
      success: true,
      exam: newExam,
    });
  } catch (error: any) {
    console.error('Error creating exam:', error);
    return NextResponse.json(
      { error: 'Failed to create exam', details: error.message },
      { status: 500 }
    );
  }
}