import { relations } from "drizzle-orm/relations";
import { user, account, exams, questions, session } from "./schema";

export const accountRelations = relations(account, ({one}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	sessions: many(session),
}));

export const questionsRelations = relations(questions, ({one}) => ({
	exam: one(exams, {
		fields: [questions.examId],
		references: [exams.id]
	}),
}));

export const examsRelations = relations(exams, ({many}) => ({
	questions: many(questions),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));