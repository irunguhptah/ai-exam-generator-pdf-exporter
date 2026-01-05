import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams, questions, idempotency_keys } from '@/db/schema';
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
			domainsMetadata,
			// idempotency
			idempotencyKey,
			idempotencyDomain,
			metadata,
		} = body;

		// Validate input
		if (!title || !subject || !difficulty || !numQuestions) {
			return NextResponse.json(
				{ error: 'Missing required fields' },
				{ status: 400 }
			);
		}

		// If this is an update/append call
		if (body.update && body.examId) {
			const examIdNum = Number(body.examId);

			// Verify ownership
			const [existingExam] = await db
				.select()
				.from(exams)
				.where(eq(exams.id, examIdNum));

			if (!existingExam || existingExam.userId !== session.user.id) {
				return NextResponse.json({ error: 'Exam not found or unauthorized' }, { status: 404 });
			}

			try {
				const updatedExam = await db.transaction(async (tx) => {
					// Check idempotency
					if (idempotencyKey) {
						const existing = await tx.select().from(idempotency_keys).where(eq(idempotency_keys.key, idempotencyKey));
						if (existing && existing.length > 0) {
							// Already processed
							const [freshExam] = await tx.select().from(exams).where(eq(exams.id, examIdNum));
							return freshExam;
						}
					}

					await tx
						.update(exams)
						.set({
							title,
							subject,
							coreTestingAreas: coreTestingAreas || existingExam.coreTestingAreas,
							difficulty,
							questionLength: questionLength || existingExam.questionLength,
							scenarioFormat: scenarioFormat || existingExam.scenarioFormat,
							numQuestions,
							subtitle: subtitle || existingExam.subtitle,
							examOverview: examOverview || existingExam.examOverview,
							examFeatures: examFeatures || existingExam.examFeatures,
							coreTestingAreasFormatted: coreTestingAreasFormatted || existingExam.coreTestingAreasFormatted,
							domainsMetadata: domainsMetadata || existingExam.domainsMetadata,
						})
						.where(eq(exams.id, examIdNum));

					if (examQuestions && Array.isArray(examQuestions) && examQuestions.length > 0) {
						const questionsToInsert = examQuestions.map((q: any, index: number) => ({
							examId: examIdNum,
							questionText: q.questionText,
							questionType: q.questionType,
							correctAnswer: q.correctAnswer,
							optionA: q.optionA || null,
							optionB: q.optionB || null,
							optionC: q.optionC || null,
							optionD: q.optionD || null,
							points: q.points || 1,
							rationale: q.rationale || null,
							orderIndex: q.orderIndex ?? null,
						}));

						await tx.insert(questions).values(questionsToInsert);
					}

					// Record idempotency key if provided
					if (idempotencyKey) {
						await tx.insert(idempotency_keys).values({
							key: idempotencyKey,
							examId: examIdNum,
							domain: idempotencyDomain || null,
							metadata: metadata ? JSON.stringify(metadata) : null,
							createdAt: new Date().toISOString(),
						});
					}

					const [freshExam] = await tx
						.select()
						.from(exams)
						.where(eq(exams.id, examIdNum));

					return freshExam;
				});

				return NextResponse.json({ success: true, exam: updatedExam });
			} catch (txErr: any) {
				console.error('Transaction failed while updating exam:', txErr);
				return NextResponse.json({ error: 'Failed to update exam within transaction', details: txErr.message }, { status: 500 });
			}
		}

		// Create new exam inside a transaction so exam creation and question inserts are atomic
		try {
			const newExam = await db.transaction(async (tx) => {
				// For create idempotency: if key provided and exists, return existing exam
				if (idempotencyKey) {
					const existing = await tx.select().from(idempotency_keys).where(eq(idempotency_keys.key, idempotencyKey));
					if (existing && existing.length > 0) {
						const existingExamId = existing[0].examId;
						if (existingExamId !== null) {
							const [existingExam] = await tx.select().from(exams).where(eq(exams.id, existingExamId));
							return existingExam;
						}
					}
				}

				const [created] = await tx
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
						subtitle: subtitle || null,
						examOverview: examOverview || null,
						examFeatures: examFeatures || null,
						coreTestingAreasFormatted: coreTestingAreasFormatted || null,
						domainsMetadata: domainsMetadata || null,
					})
					.returning();

				if (examQuestions && Array.isArray(examQuestions) && examQuestions.length > 0) {
					const questionsToInsert = examQuestions.map((q: any, index: number) => ({
						examId: created.id,
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

					await tx.insert(questions).values(questionsToInsert);
				}

				// Record idempotency key if provided
				if (idempotencyKey) {
					await tx.insert(idempotency_keys).values({
						key: idempotencyKey,
						examId: created.id,
						domain: idempotencyDomain || null,
						metadata: metadata ? JSON.stringify(metadata) : null,
						createdAt: new Date().toISOString(),
					});
				}

				return created;
			});

			return NextResponse.json({ success: true, exam: newExam });
		} catch (txErr: any) {
			console.error('Transaction failed during exam creation:', txErr);
			return NextResponse.json({ error: 'Failed to create exam within transaction', details: txErr.message }, { status: 500 });
		}
	} catch (error: any) {
		console.error('Error creating exam:', error);
		return NextResponse.json(
			{ error: 'Failed to create exam', details: error.message },
			{ status: 500 }
		);
	}
}
